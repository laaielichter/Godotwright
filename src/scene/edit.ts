import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { GodotApi, closest } from "../api/api.js";
import { parseResourceFile, type Section } from "../godot/resource-file.js";
import { parseResourceText, type SceneNode } from "../godot/scene.js";
import { typedValue } from "../godot/typed-value.js";
import { findProjectRoot, fromResPath, toResPath } from "../project/files.js";
import { reviewProject } from "../review/review.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { findUsages } from "../usages/usages.js";

export class SceneError extends Error {}

/** One change to a .tscn. Node paths are relative to the scene root, which is ".". */
export type SceneEdit =
  | { op: "add_node"; parent: string; name: string; type?: string; instance?: string }
  | { op: "remove_node"; node: string }
  | { op: "set"; node: string; property: string; value: string }
  | { op: "connect"; from: string; signal: string; to: string; method: string }
  | { op: "disconnect"; from: string; signal: string; to: string; method: string }
  | { op: "attach_script"; node: string; script: string };

export interface SceneHunk {
  line: number;
  removed: string[];
  added: string[];
}

export interface ScenePlan {
  summary: string;
  file: string;
  hunks: SceneHunk[];
  warnings: string[];
  written: boolean;
  review?: { before: number; after: number };
}

/** A section of the file with its 0-based first line and the line where the next one starts. */
interface Block extends Section {
  start: number;
  end: number;
}

/** A change planned against the original lines; all are applied bottom-up so the line numbers stay true. */
interface Splice {
  start: number;
  count: number;
  added: string[];
}

const NODE_NAME = /^[^.:@/"%]+$/;

function blocksOf(lines: string[]): Block[] {
  const sections = parseResourceFile(lines.join("\n")).filter((s) => s.tag !== "");
  return sections.map((s, i) => ({ ...s, start: s.line - 1, end: (sections[i + 1]?.line ?? lines.length + 1) - 1 }));
}

/** The first line after a block's last non-blank line. */
function contentEnd(lines: string[], block: Block): number {
  let end = block.end;
  while (end > block.start + 1 && (lines[end - 1] ?? "").trim() === "") end--;
  return end;
}

const inside = (path: string, root: string): boolean => root === "." || path === root || path.startsWith(`${root}/`);

/** What a script declares, read with simple patterns (enough for checks; Godot has the last word). */
function scriptInfo(source: string): { extends?: string; signals: Map<string, string>; funcs: Map<string, { min: number; max: number }>; exports: Map<string, string | undefined> } {
  const signals = new Map<string, string>();
  const funcs = new Map<string, { min: number; max: number }>();
  const exports = new Map<string, string | undefined>();
  for (const m of source.matchAll(/^\s*signal\s+(\w+)\s*(\([^)]*\))?/gm)) signals.set(m[1] ?? "", m[2] ?? "()");
  for (const m of source.matchAll(/^\s*(?:static\s+)?func\s+(\w+)\s*\(([^)]*)\)/gm)) {
    const params = (m[2] ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    funcs.set(m[1] ?? "", { min: params.filter((p) => !p.includes("=")).length, max: params.length });
  }
  for (const m of source.matchAll(/^\s*@export\w*(?:\([^)]*\))?\s+(?:@\w+(?:\([^)]*\))?\s+)*var\s+(\w+)\s*(?::\s*([\w.]+))?/gm)) exports.set(m[1] ?? "", m[2]);
  return { extends: /^\s*extends\s+([A-Za-z_]\w*)/m.exec(source)?.[1], signals, funcs, exports };
}

/** The resource type an ext_resource line names for a file. */
function resourceType(root: string, path: string, fallback?: string): string {
  if (/\.(tscn|scn)$/.test(path)) return "PackedScene";
  if (path.endsWith(".gd") || path.endsWith(".cs")) return "Script";
  if (path.endsWith(".gdshader")) return "Shader";
  const full = fromResPath(root, path);
  if (/\.(tres|res)$/.test(path)) return /type="(\w+)"/.exec(readFileSync(full, "utf8").slice(0, 400))?.[1] ?? fallback ?? "Resource";
  if (existsSync(`${full}.import`)) {
    const type = /^type="(\w+)"/m.exec(readFileSync(`${full}.import`, "utf8"))?.[1];
    if (type === "CompressedTexture2D") return "Texture2D";
    if (type) return type;
  }
  return fallback ?? "Resource";
}

/** The uid of a file, from its .uid file, its .import file or its own header. */
function uidOf(root: string, path: string): string | undefined {
  const full = fromResPath(root, path);
  if (existsSync(`${full}.uid`)) return readFileSync(`${full}.uid`, "utf8").trim() || undefined;
  if (existsSync(`${full}.import`)) return /^uid="([^"]+)"/m.exec(readFileSync(`${full}.import`, "utf8"))?.[1];
  if (/\.(tscn|tres)$/.test(path)) return /^\[gd_\w+[^\]]*\buid="([^"]+)"/.exec(readFileSync(full, "utf8"))?.[1];
  return undefined;
}

/**
 * Plans (and with `write`, applies) one change to a .tscn: add or remove a node, set a property, connect or
 * disconnect a signal, or attach a script. Only the lines of that change are touched (plus a new ext_resource and
 * load_steps when needed). Types, properties, signals and files are checked against Godot 4.7 and the project first.
 */
export function editScene(scenePath: string, edit: SceneEdit, options: { write?: boolean; project?: string } = {}): ScenePlan {
  const projectStart = options.project ?? (scenePath.startsWith("res://") ? process.cwd() : dirname(resolve(scenePath)));
  const root = findProjectRoot(projectStart);
  if (!root) throw new ProjectNotFoundError(projectStart);
  const full = scenePath.startsWith("res://") ? fromResPath(root, scenePath) : isAbsolute(scenePath) ? scenePath : resolve(scenePath);
  if (!existsSync(full)) throw new SceneError(`${scenePath} does not exist`);
  if (!full.endsWith(".tscn")) throw new SceneError(`${scenePath} is not a text scene (.tscn)`);
  const resPath = toResPath(root, full);
  const original = readFileSync(full, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(eol);
  const blocks = blocksOf(lines);
  const scene = parseResourceText(original);
  const api = GodotApi.load();
  const splices: Splice[] = [];
  const warnings: string[] = [];
  const extAdded: { id: string; type: string; path: string }[] = [];

  const blockAt = (line: number): Block => {
    const block = blocks.find((b) => b.start === line - 1);
    if (!block) throw new SceneError(`internal: no section at line ${line}`);
    return block;
  };
  const findNode = (path: string): SceneNode => {
    const wanted = path.replace(/^\.\//, "") || ".";
    const node = scene.nodes.find((n) => n.path === wanted);
    if (!node) {
      const near = closest(wanted, scene.nodes.map((n) => n.path), 3);
      throw new SceneError(`no node "${path}" in ${resPath}${near.length ? `; did you mean ${near.join(", ")}?` : ""} (the root is ".")`);
    }
    return node;
  };
  const extPath = (id?: string) => scene.extResources.find((e) => e.id === id)?.path;

  /** The Godot class of a node: its type, or the root type of the scene it instances (and so on, down). */
  const classOf = (node: SceneNode): string | undefined => {
    if (node.type) return node.type;
    let path = extPath(node.instanceRef);
    for (let depth = 0; path && depth < 8; depth++) {
      if (!existsSync(fromResPath(root, path))) return undefined;
      const sub = parseResourceText(readFileSync(fromResPath(root, path), "utf8"));
      const top = sub.nodes[0];
      if (top?.type) return top.type;
      path = sub.extResources.find((e) => e.id === top?.instanceRef)?.path;
    }
    return undefined;
  };
  /** The script on a node, or on the root of the scene it instances. */
  const scriptOf = (node: SceneNode): ReturnType<typeof scriptInfo> | undefined => {
    let path = extPath(node.scriptRef);
    if (!path && node.instanceRef) {
      const scenePathOf = extPath(node.instanceRef);
      if (scenePathOf && existsSync(fromResPath(root, scenePathOf))) {
        const sub = parseResourceText(readFileSync(fromResPath(root, scenePathOf), "utf8"));
        path = sub.extResources.find((e) => e.id === sub.nodes[0]?.scriptRef)?.path;
      }
    }
    if (!path || !path.endsWith(".gd") || !existsSync(fromResPath(root, path))) return undefined;
    return scriptInfo(readFileSync(fromResPath(root, path), "utf8"));
  };

  /** An ext_resource for a file: the one the scene has, or a new line after the others. */
  const extFor = (path: string, fallbackType?: string): string => {
    const have = scene.extResources.find((e) => e.path === path) ?? extAdded.find((e) => e.path === path);
    if (have) return have.id;
    if (!existsSync(fromResPath(root, path))) throw new SceneError(`${path} does not exist in the project`);
    if (path === resPath) throw new SceneError(`a scene cannot contain itself`);
    const type = resourceType(root, path, fallbackType);
    const ids = new Set([...scene.extResources.map((e) => e.id), ...extAdded.map((e) => e.id)]);
    const slug = basename(path).replace(/\.\w+$/, "").replace(/\W+/g, "_").toLowerCase() || "res";
    let n = ids.size + 1;
    while (ids.has(`${n}_${slug}`)) n++;
    const id = `${n}_${slug}`;
    const uid = uidOf(root, path);
    extAdded.push({ id, type, path });
    const line = `[ext_resource type="${type}"${uid ? ` uid="${uid}"` : ""} path="${path}" id="${id}"]`;
    const last = blocks.filter((b) => b.tag === "ext_resource").at(-1);
    if (last) splices.push({ start: last.start + 1, count: 0, added: [line] });
    else splices.push({ start: 1, count: 0, added: (lines[1] ?? "").trim() === "" ? ["", line] : ["", line, ""] });
    return id;
  };

  /** Sets (or replaces) `property = value` inside a node block. */
  const setProp = (block: Block, property: string, value: string): void => {
    const keys = Object.entries(block.propLines).sort((a, b) => a[1] - b[1]);
    const at = keys.findIndex(([k]) => k === property);
    const text = `${property} = ${value}`;
    if (at < 0) {
      splices.push({ start: contentEnd(lines, block), count: 0, added: [text] });
      return;
    }
    const start = (keys[at]?.[1] ?? 0) - 1;
    const next = keys[at + 1];
    const stop = next ? next[1] - 1 : contentEnd(lines, block);
    splices.push({ start, count: stop - start, added: [text] });
  };

  const removeBlock = (block: Block): void => {
    splices.push({ start: block.start, count: block.end - block.start, added: [] });
  };

  let summary = "";
  switch (edit.op) {
    case "add_node": {
      const parent = findNode(edit.parent);
      const name = edit.name.trim();
      if (!NODE_NAME.test(name)) throw new SceneError(`"${edit.name}" is not a usable node name (no . : @ / " or %)`);
      const parentPath = parent.path;
      const siblingParent = (n: SceneNode) => (n.path === "." ? undefined : n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : ".");
      if (scene.nodes.some((n) => siblingParent(n) === parentPath && n.name === name)) throw new SceneError(`${parentPath} already has a child called ${name}`);
      if (!edit.type === !edit.instance) throw new SceneError(`give a type (Sprite2D) or an instance (res://enemy.tscn), not both`);
      let header: string;
      const parentAttr = parentPath === "." ? "." : parentPath;
      if (edit.type) {
        const cls = api.getClass(edit.type);
        if (!cls || cls.name !== edit.type) {
          const near = api.closeClassNames(edit.type).slice(0, 3);
          throw new SceneError(`${edit.type} is not a Godot ${api.version} class${near.length ? `; did you mean ${near.join(", ")}?` : ""}`);
        }
        if (!api.inheritsFrom(cls.name, "Node")) throw new SceneError(`${cls.name} is not a Node, so it cannot be in a scene tree (use it as a property value)`);
        header = `[node name="${name}" type="${cls.name}" parent="${parentAttr}"]`;
      } else {
        const instance = (edit.instance ?? "").trim();
        if (!/\.(tscn|scn)$/.test(instance)) throw new SceneError(`an instance is a scene (.tscn or .scn); ${instance} is not`);
        header = `[node name="${name}" parent="${parentAttr}" instance=ExtResource("${extFor(instance)}")]`;
      }
      // A new child goes after the last node of its parent's subtree, so Godot keeps parents before children.
      const subtree = scene.nodes.filter((n) => inside(n.path, parentPath)).map((n) => blockAt(n.line));
      const after = subtree.at(-1) ?? blockAt(parent.line);
      const at = after.end;
      const blankBefore = (lines[at - 1] ?? "").trim() === "";
      splices.push({ start: at, count: 0, added: [...(blankBefore ? [] : [""]), header, ...(at >= lines.length - 1 && !blankBefore ? [] : [""])] });
      summary = `add ${name} (${edit.type ?? edit.instance}) under ${parentPath}`;
      break;
    }
    case "remove_node": {
      const node = findNode(edit.node);
      if (node.path === ".") throw new SceneError(`the root node cannot be removed; delete the scene instead`);
      const gone = scene.nodes.filter((n) => inside(n.path, node.path));
      const removed = new Set<Block>(gone.map((n) => blockAt(n.line)));
      for (const c of scene.connections) if (inside(c.from, node.path) || inside(c.to, node.path)) removed.add(blockAt(c.line));
      for (const b of blocks) if (b.tag === "editable" && typeof b.attrs["path"] === "string" && inside(b.attrs["path"], node.path)) removed.add(b);
      // Resources only the removed nodes used go too, as the editor would drop them on save.
      for (let changed = true; changed; ) {
        changed = false;
        const kept = blocks.filter((b) => !removed.has(b) && b.tag !== "ext_resource" && b.tag !== "sub_resource");
        const keptResources = blocks.filter((b) => !removed.has(b) && (b.tag === "sub_resource" || b.tag === "ext_resource"));
        const text = (bs: Block[]) => bs.map((b) => lines.slice(b.start, b.end).join("\n")).join("\n");
        const used = text([...kept, ...keptResources.filter((b) => b.tag === "sub_resource")]);
        for (const b of keptResources) {
          const id = String(b.attrs["id"] ?? "");
          const ref = `${b.tag === "ext_resource" ? "ExtResource" : "SubResource"}("${id}")`;
          const selfText = lines.slice(b.start, b.end).join("\n");
          if (!used.replace(selfText, "").includes(ref)) {
            removed.add(b);
            changed = true;
          }
        }
      }
      for (const b of removed) removeBlock(b);
      const uses = findUsages(root, node.name).usages.filter((u) => u.kind === "node path" || u.kind === "string");
      if (uses.length) warnings.push(`scripts still name "${node.name}" in ${uses.length} place${uses.length === 1 ? "" : "s"} (${uses.slice(0, 3).map((u) => `${u.file}:${u.line}`).join(", ")}); see godotwright usages ${node.name}`);
      summary = `remove ${node.path}${gone.length > 1 ? ` and ${gone.length - 1} child node${gone.length > 2 ? "s" : ""}` : ""}`;
      break;
    }
    case "set": {
      const node = findNode(edit.node);
      const property = edit.property.trim();
      const cls = classOf(node);
      const script = scriptOf(node);
      let type: string | undefined;
      const enumValues: Record<string, number> = {};
      let defaultText: string | undefined;
      if (property === "script") throw new SceneError(`use attach_script to set a script`);
      if (script?.exports.has(property)) type = script.exports.get(property);
      else if (property.includes("/")) {
        // theme_override_*, shader_parameter/*, metadata/*: not in the class reference by name.
        if (!/^(theme_override_\w+|shader_parameter|metadata|surface_material_override|parameters)\//.test(property)) warnings.push(`${property} is not a property Godotwright can check`);
      } else if (cls) {
        const member = api.member(cls, property).find((e) => e.kind === "property");
        if (!member) {
          const names = new Set([...api.ancestors(cls).flatMap((c) => (c.members ?? []).map((m) => m.name)), ...(script?.exports.keys() ?? [])]);
          const near = closest(property, [...names], 3);
          throw new SceneError(`${node.path} (${cls}) has no property ${property}${near.length ? `; did you mean ${near.join(", ")}?` : ""}`);
        }
        const item = member.item as { type: string; enum?: string; default?: string };
        type = item.type;
        defaultText = item.default;
        if (item.enum) {
          const [owner, enumName] = item.enum.includes(".") ? item.enum.split(".") : ["@GlobalScope", item.enum];
          for (const c of api.getClass(owner ?? "")?.constants ?? []) if (c.enum === enumName) enumValues[c.name] = Number(c.value);
        }
      } else warnings.push(`the class of ${node.path} is unknown, so ${property} is not checked`);
      let value: string;
      const raw = edit.value.trim();
      const isResource = type !== undefined && api.getClass(type) !== undefined && api.inheritsFrom(type, "Resource");
      if (isResource && raw.startsWith("res://")) {
        const fileType = resourceType(root, raw, type);
        if (type && api.getClass(fileType) && !api.inheritsFrom(fileType, type)) throw new SceneError(`${property} takes a ${type}; ${raw} is a ${fileType}`);
        value = `ExtResource("${extFor(raw, type)}")`;
      } else if (isResource && raw === "null") value = "null";
      else if (isResource && !/^(ExtResource|SubResource)\(/.test(raw)) throw new SceneError(`${property} takes a ${type}: give a res:// file or null`);
      else value = typedValue(`${node.path}.${property}`, raw, isResource ? undefined : type, (m) => new SceneError(m), enumValues);
      if (defaultText !== undefined && defaultText === value) warnings.push(`${value} is Godot's default for ${property}; the editor drops default values when it saves`);
      setProp(blockAt(node.line), property, value);
      summary = `set ${node.path}.${property} = ${value}`;
      break;
    }
    case "connect":
    case "disconnect": {
      const from = findNode(edit.from);
      const to = findNode(edit.to);
      const existing = scene.connections.find((c) => c.from === from.path && c.to === to.path && c.signal === edit.signal && c.method === edit.method);
      const label = `${from.path}.${edit.signal} -> ${edit.method}() on ${to.path}`;
      if (edit.op === "disconnect") {
        if (!existing) throw new SceneError(`there is no connection ${label} in ${resPath}`);
        const block = blockAt(existing.line);
        const only = scene.connections.length === 1;
        splices.push({ start: only && (lines[block.start - 1] ?? "").trim() === "" ? block.start - 1 : block.start, count: only && (lines[block.start - 1] ?? "").trim() === "" ? 2 : 1, added: [] });
        summary = `disconnect ${label}`;
        break;
      }
      if (existing) throw new SceneError(`${label} is already connected`);
      if (!/^[A-Za-z_]\w*$/.test(edit.method)) throw new SceneError(`"${edit.method}" is not a method name`);
      const cls = classOf(from);
      const fromScript = scriptOf(from);
      const apiSignal = cls ? api.member(cls, edit.signal).find((e) => e.kind === "signal") : undefined;
      const scriptSignal = fromScript?.signals.get(edit.signal);
      if (!apiSignal && scriptSignal === undefined) {
        if (cls) {
          const names = [...api.ancestors(cls).flatMap((c) => (c.signals ?? []).map((s) => s.name)), ...(fromScript?.signals.keys() ?? [])];
          const near = closest(edit.signal, names, 3);
          throw new SceneError(`${from.path} (${cls}) has no signal ${edit.signal}${near.length ? `; did you mean ${near.join(", ")}?` : ""}`);
        }
        warnings.push(`the class of ${from.path} is unknown, so the signal is not checked`);
      }
      const toScript = scriptOf(to);
      const params = apiSignal
        ? ((apiSignal.item as { params?: { name: string; type: string }[] }).params ?? []).map((p) => `${p.name}: ${p.type}`).join(", ")
        : (scriptSignal ?? "()").replace(/^\(|\)$/g, "").trim();
      const argCount = params ? params.split(",").length : 0;
      const target = toScript?.funcs.get(edit.method);
      if (!target) warnings.push(`${to.path} ${toScript ? "has no" : "has no script, so no"} method ${edit.method}; Godot reports an error when the signal fires. Add: func ${edit.method}(${params}) -> void:`);
      else if (argCount < target.min || argCount > target.max)
        warnings.push(`${edit.signal} passes ${argCount} argument${argCount === 1 ? "" : "s"} (${params || "none"}), but ${edit.method}() takes ${target.min === target.max ? target.min : `${target.min} to ${target.max}`}; Godot reports an error when it fires`);
      const line = `[connection signal="${edit.signal}" from="${from.path}" to="${to.path}" method="${edit.method}"]`;
      const last = blocks.filter((b) => b.tag === "connection").at(-1);
      if (last) splices.push({ start: last.start + 1, count: 0, added: [line] });
      else {
        let at = lines.length;
        while (at > 0 && (lines[at - 1] ?? "").trim() === "") at--;
        splices.push({ start: at, count: 0, added: ["", line] });
      }
      summary = `connect ${label}`;
      break;
    }
    case "attach_script": {
      const node = findNode(edit.node);
      const script = edit.script.trim();
      if (!/\.(gd|cs)$/.test(script)) throw new SceneError(`a script is a .gd or .cs file; ${script} is not`);
      if (!existsSync(fromResPath(root, script))) throw new SceneError(`${script} does not exist in the project`);
      const cls = classOf(node);
      if (script.endsWith(".gd")) {
        const base = scriptInfo(readFileSync(fromResPath(root, script), "utf8")).extends ?? "RefCounted";
        if (cls && api.getClass(base) && !api.inheritsFrom(cls, base)) throw new SceneError(`${node.path} is a ${cls}, but ${script} extends ${base}; Godot will not attach it`);
      }
      setProp(blockAt(node.line), "script", `ExtResource("${extFor(script)}")`);
      summary = `attach ${script} to ${node.path}`;
      break;
    }
  }

  // load_steps counts the resources plus one; keep it right when it is there.
  const head = blocks[0];
  if (head && /\bload_steps=\d+/.test(lines[head.start] ?? "")) {
    const removedIds = new Set(splices.filter((s) => s.count > 0).flatMap((s) => lines.slice(s.start, s.start + s.count)).filter((l) => /^\[(ext|sub)_resource\b/.test(l)));
    const count = blocks.filter((b) => b.tag === "ext_resource" || b.tag === "sub_resource").length - removedIds.size + extAdded.length + 1;
    const updated = (lines[head.start] ?? "").replace(/\bload_steps=\d+/, `load_steps=${count}`);
    if (updated !== lines[head.start]) splices.push({ start: head.start, count: 1, added: [updated] });
  }

  if (splices.every((sp) => sp.added.join("\n") === lines.slice(sp.start, sp.start + sp.count).join("\n"))) throw new SceneError(`nothing to change: ${summary} is already so`);
  splices.sort((a, b) => b.start - a.start || b.count - a.count);
  const out = [...lines];
  for (const s of splices) out.splice(s.start, s.count, ...s.added);
  const text = out.join(eol);
  try {
    parseResourceText(text);
  } catch (error) {
    throw new SceneError(`the change would leave ${resPath} unreadable (${(error as Error).message}); nothing was written`);
  }
  const hunks = [...splices].reverse().map((s) => ({ line: s.start + 1, removed: lines.slice(s.start, s.start + s.count), added: s.added }));
  const plan: ScenePlan = { summary, file: resPath, hunks, warnings, written: false };
  if (!options.write) return plan;
  const errors = () => reviewProject(root).categories.reduce((n, c) => n + c.errors, 0);
  const before = errors();
  writeFileSync(full, text);
  return { ...plan, written: true, review: { before, after: errors() } };
}

/** The plan as a compact diff, with the warnings and, when written, the review errors before and after. */
export function formatScenePlan(plan: ScenePlan): string {
  const out = [`scene ${plan.summary}${plan.written ? " (written)" : " (dry run: add --write to apply)"}`, plan.file];
  for (const h of plan.hunks) {
    h.removed.forEach((l, i) => out.push(`  ${i === 0 ? String(h.line).padStart(4) : "    "}  - ${l}`));
    h.added.forEach((l, i) => out.push(`  ${i === 0 && !h.removed.length ? String(h.line).padStart(4) : "    "}  + ${l}`));
  }
  for (const w of plan.warnings) out.push(`warning: ${w}`);
  if (plan.review) out.push(`review errors: ${plan.review.before} before, ${plan.review.after} after${plan.review.after > plan.review.before ? "  <- the change broke something: run godotwright review" : ""}`);
  return `${out.join("\n")}\n`;
}
