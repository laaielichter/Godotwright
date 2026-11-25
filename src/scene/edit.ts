import { existsSync, readFileSync } from "node:fs";
import { JournalWriter } from "../journal/journal.js";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { GodotApi, closest } from "../api/api.js";
import { blocksOf, contentEnd, propSpan, type Block, type Splice } from "../godot/blocks.js";
import { parseResourceText, type SceneNode } from "../godot/scene.js";
import { typedValue } from "../godot/typed-value.js";
import { fromResPath, toResPath } from "../project/files.js";
import { reviewProject } from "../review/review.js";
import { lockedInstances } from "../review/checks/integrity.js";
import { loadProject, projectRootOf } from "../scan/scan.js";
import { findUsages } from "../usages/usages.js";
import { NODE_NAME, joinPath, lineHunks, structureEdit, type StructureEdit, type StructureResult } from "./structure.js";
import { generateUid, uidOf } from "./uid.js";

export class SceneError extends Error {}

/** One change to a .tscn. Node paths are relative to the scene root, which is ".". */
export type SceneEdit =
  | { op: "add_node"; parent: string; name: string; type?: string; instance?: string; makeEditable?: boolean }
  | { op: "remove_node"; node: string }
  | { op: "set"; node: string; property: string; value: string; makeEditable?: boolean }
  | { op: "connect"; from: string; signal: string; to: string; method: string; makeEditable?: boolean }
  | { op: "set_editable"; node: string; editable?: boolean }
  | { op: "disconnect"; from: string; signal: string; to: string; method: string }
  | { op: "attach_script"; node: string; script: string }
  | { op: "create_scene"; type?: string; instance?: string; name?: string; script?: string }
  | { op: "add_nodes"; nodes: NewNode[]; makeEditable?: boolean }
  | StructureEdit;

/** One node of add_nodes: like add_node, with its properties (as `set` takes them) and script in the same go. */
export interface NewNode {
  parent: string;
  name: string;
  type?: string;
  instance?: string;
  props?: Record<string, string>;
  script?: string;
}

type SingleEdit = Exclude<SceneEdit, { op: "create_scene" | "add_nodes" }>;

interface Planned {
  text: string;
  hunks: SceneHunk[];
  summary: string;
  warnings: string[];
}

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
  /** The journal entry of the write (godot_undo). */
  journal?: number;
  review?: { before: number; after: number };
}

/** Bottom-up order for applying splices; at the same line, a tail splice is applied first so it ends up last. */
export const spliceOrder = (a: Splice, b: Splice) => b.start - a.start || b.count - a.count || Number(b.tail ?? false) - Number(a.tail ?? false);

const inside = (path: string, root: string): boolean => root === "." || path === root || path.startsWith(`${root}/`);

/** What a script declares, read with simple patterns (enough for checks; Godot has the last word). */
export function scriptInfo(source: string): { extends?: string; signals: Map<string, string>; funcs: Map<string, { min: number; max: number }>; exports: Map<string, string | undefined> } {
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
export function resourceType(root: string, path: string, fallback?: string): string {
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

/**
 * Plans (and with `write`, applies) one change to a .tscn: add or remove a node, set a property, connect or
 * disconnect a signal, attach a script, rename, move or copy a node, set its groups, add several nodes, or make a new
 * scene. Only the lines of that change are touched (plus a new ext_resource and
 * load_steps when needed). Types, properties, signals and files are checked against Godot 4.7 and the project first.
 */
export function editScene(scenePath: string, edit: SceneEdit, options: { write?: boolean; project?: string } = {}): ScenePlan {
  if (edit.op === "create_scene") return createScene(scenePath, edit, options);
  const projectStart = options.project ?? (scenePath.startsWith("res://") ? process.cwd() : dirname(resolve(scenePath)));
  const root = projectRootOf(projectStart);
  const full = scenePath.startsWith("res://") ? fromResPath(root, scenePath) : isAbsolute(scenePath) ? scenePath : resolve(scenePath);
  if (!existsSync(full)) throw new SceneError(`${scenePath} does not exist`);
  if (!full.endsWith(".tscn")) throw new SceneError(`${scenePath} is not a text scene (.tscn)`);
  const resPath = toResPath(root, full);
  const original = readFileSync(full, "utf8");
  const planned = edit.op === "add_nodes" ? planBatch({ root, resPath }, original, edit) : planEdit({ root, resPath }, original, edit);
  return finish(root, full, resPath, planned, options.write === true);
}

/** The line end of a file, read from its first line: a stray \\r\\n further down in a Unix file does not make it a Windows file. */
function eolOf(text: string): string {
  const first = text.indexOf("\n");
  return first > 0 && text[first - 1] === "\r" ? "\r\n" : "\n";
}

/** Writes a planned change through the journal, with the review errors before and after. */
function finish(root: string, full: string, resPath: string, planned: Planned, write: boolean): ScenePlan {
  const { text, summary } = planned;
  const plan: ScenePlan = { summary, file: resPath, hunks: planned.hunks, warnings: planned.warnings, written: false };
  if (!write) return plan;
  const errors = () => reviewProject(root).categories.reduce((n, c) => n + c.errors, 0);
  const before = errors();
  const journal = new JournalWriter(root, "scene edit", `${summary} (${resPath})`);
  journal.write(full, text);
  const id = journal.commit();
  return { ...plan, written: true, ...(id ? { journal: id } : {}), review: { before, after: errors() } };
}

/** The Godot class a new node gets, checked against the reference. */
function nodeClass(api: GodotApi, type: string): string {
  const cls = api.getClass(type);
  if (!cls || cls.name !== type) {
    const near = api.closeClassNames(type).slice(0, 3);
    throw new SceneError(`${type} is not a Godot ${api.version} class${near.length ? `; did you mean ${near.join(", ")}?` : ""}`);
  }
  if (!api.inheritsFrom(cls.name, "Node")) throw new SceneError(`${cls.name} is not a Node, so it cannot be in a scene tree (use it as a property value)`);
  return cls.name;
}

/** The root type of a scene file, through the scenes it inherits from. */
function rootClassOf(root: string, path: string | undefined): string | undefined {
  for (let depth = 0; path && depth < 8; depth++) {
    if (!existsSync(fromResPath(root, path))) return undefined;
    const sub = parseResourceText(readFileSync(fromResPath(root, path), "utf8"));
    const top = sub.nodes[0];
    if (top?.type) return top.type;
    path = sub.extResources.find((e) => e.id === top?.instanceRef)?.path;
  }
  return undefined;
}

/** A new .tscn: a root node of a type (or an inherited scene), with a fresh uid. Never overwrites a file. */
function createScene(scenePath: string, edit: Extract<SceneEdit, { op: "create_scene" }>, options: { write?: boolean; project?: string }): ScenePlan {
  let start = options.project ?? (scenePath.startsWith("res://") ? process.cwd() : dirname(resolve(scenePath)));
  while (!existsSync(start) && dirname(start) !== start) start = dirname(start);
  const root = projectRootOf(start);
  const full = scenePath.startsWith("res://") ? fromResPath(root, scenePath) : isAbsolute(scenePath) ? scenePath : resolve(scenePath);
  if (!full.endsWith(".tscn")) throw new SceneError(`${scenePath} is not a text scene: give a path that ends in .tscn`);
  if (relative(root, full).startsWith("..")) throw new SceneError(`${scenePath} is outside the project at ${root}; a scene lives in the project folder`);
  const resPath = toResPath(root, full);
  if (existsSync(full)) throw new SceneError(`${resPath} already exists and create_scene never overwrites a file; change it with the other ops (add_node, set, ...), or give another path`);
  if (!edit.type === !edit.instance) throw new SceneError(`create_scene needs the root's type (Node2D), or an instance (res://base.tscn) for a scene that inherits from another, not both`);
  const api = GodotApi.load();
  const lines: string[] = [];
  let cls: string | undefined;
  const ext: string[] = [];
  let rootAttr: string;
  if (edit.type) {
    cls = nodeClass(api, edit.type.trim());
    rootAttr = ` type="${cls}"`;
  } else {
    const base = (edit.instance ?? "").trim();
    if (!/\.(tscn|scn)$/.test(base)) throw new SceneError(`an instance is a scene (.tscn or .scn); ${base} is not`);
    if (!existsSync(fromResPath(root, base))) throw new SceneError(`${base} does not exist in the project`);
    const uid = uidOf(root, base);
    ext.push(`[ext_resource type="PackedScene"${uid ? ` uid="${uid}"` : ""} path="${base}" id="1_base"]`);
    rootAttr = ` instance=ExtResource("1_base")`;
    cls = rootClassOf(root, base);
  }
  const fallback = basename(full, ".tscn").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  const name = (edit.name ?? fallback).trim() || cls || "Root";
  if (!NODE_NAME.test(name)) throw new SceneError(`"${name}" is not a usable node name (no . : @ / " or %)`);
  let scriptLine: string | undefined;
  if (edit.script) {
    const script = edit.script.trim();
    if (!/\.(gd|cs)$/.test(script)) throw new SceneError(`a script is a .gd or .cs file; ${script} is not`);
    if (!existsSync(fromResPath(root, script))) throw new SceneError(`${script} does not exist in the project; write the script first, then create the scene`);
    if (script.endsWith(".gd")) {
      const base = scriptInfo(readFileSync(fromResPath(root, script), "utf8")).extends ?? "RefCounted";
      if (cls && api.getClass(base) && !api.inheritsFrom(cls, base)) throw new SceneError(`the root is a ${cls}, but ${script} extends ${base}; Godot will not attach it`);
    }
    const id = `${ext.length + 1}_${basename(script).replace(/\.\w+$/, "").replace(/\W+/g, "_").toLowerCase() || "script"}`;
    const uid = uidOf(root, script);
    ext.push(`[ext_resource type="Script"${uid ? ` uid="${uid}"` : ""} path="${script}" id="${id}"]`);
    scriptLine = `script = ExtResource("${id}")`;
  }
  const uid = generateUid(new Set(loadProject(root).uidClaims.map((c) => c.uid)));
  lines.push(`[gd_scene format=3 uid="${uid}"]`, "");
  if (ext.length) lines.push(...ext, "");
  lines.push(`[node name="${name}"${rootAttr}]`, ...(scriptLine ? [scriptLine] : []));
  const text = `${lines.join("\n")}\n`;
  parseResourceText(text);
  const summary = `create ${resPath} with root ${name} (${edit.type ? cls : `inherits ${edit.instance}`})${edit.script ? ` and ${edit.script.trim()}` : ""}`;
  return finish(root, full, resPath, { text, hunks: [{ line: 1, removed: [], added: lines }], summary, warnings: [] }, options.write === true);
}

/** add_nodes: each node, its properties and its script in order on the text in memory, so it is all or nothing. */
function planBatch(ctx: { root: string; resPath: string }, original: string, edit: Extract<SceneEdit, { op: "add_nodes" }>): Planned {
  if (!edit.nodes.length) throw new SceneError(`add_nodes needs nodes: a list of { parent, name, type or instance, props, script }`);
  let text = original;
  const warnings: string[] = [];
  const names: string[] = [];
  const step = (one: SingleEdit): void => {
    const done = planEdit(ctx, text, one, true);
    text = done.text;
    for (const w of done.warnings) if (!warnings.includes(w)) warnings.push(w);
  };
  edit.nodes.forEach((item, i) => {
    try {
      if (typeof item.parent !== "string" || typeof item.name !== "string") throw new SceneError(`it needs parent and name`);
      const parent = item.parent.replace(/^\.\//, "") || ".";
      const path = joinPath(parent, item.name.trim());
      step({ op: "add_node", parent, name: item.name, ...(item.type ? { type: item.type } : {}), ...(item.instance ? { instance: item.instance } : {}), ...(edit.makeEditable ? { makeEditable: true } : {}) });
      for (const [property, value] of Object.entries(item.props ?? {})) step({ op: "set", node: path, property, value: String(value) });
      if (item.script) step({ op: "attach_script", node: path, script: item.script });
      names.push(path);
    } catch (error) {
      if (!(error instanceof SceneError)) throw error;
      throw new SceneError(`nodes[${i}]${typeof item.name === "string" ? ` (${item.name})` : ""}: ${error.message}. Nothing is changed: fix this node and send the whole list again.`);
    }
  });
  const eol = eolOf(original);
  const shown = names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ");
  return { text, hunks: lineHunks(original.split(eol), text.split(eol)), summary: `add ${names.length} node${names.length === 1 ? "" : "s"}: ${shown}`, warnings };
}

/**
 * Plans one change on the text of a scene. `batch` is a step of add_nodes: the check against instances that are not
 * editable is skipped where it cannot apply (it loads the whole project).
 */
function planEdit(ctx: { root: string; resPath: string }, original: string, edit: SingleEdit, batch = false): Planned {
  const { root, resPath } = ctx;
  const eol = eolOf(original);
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
    return rootClassOf(root, extPath(node.instanceRef));
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
    const text = `${property} = ${value}`;
    const span = propSpan(lines, block, property);
    splices.push(span ? { ...span, added: [text] } : { start: contentEnd(lines, block), count: 0, added: [text] });
  };

  const removeBlock = (block: Block): void => {
    splices.push({ start: block.start, count: block.end - block.start, added: [] });
  };

  /** The instanced scenes in the scene as `text`, and the ones it changes inside without [editable]. */
  const lockedOf = (text: string) => {
    const data = loadProject(root, { overrides: { [resPath]: text } });
    const scene = data.map.scenes.find((sc) => sc.path === resPath);
    const parsedScene = data.resources.get(resPath);
    return scene && parsedScene ? lockedInstances(scene, parsedScene, new Map(data.map.scenes.map((sc) => [sc.path, sc])), data.resources) : { roots: [], locked: [] };
  };
  /** Lines that add [editable path=...] entries at the end of the file. */
  const editableSplice = (paths: string[]): Splice => {
    let at = lines.length;
    while (at > 0 && (lines[at - 1] ?? "").trim() === "") at--;
    return { start: at, count: 0, added: paths.flatMap((p) => ["", `[editable path="${p}"]`]), tail: true };
  };

  let summary = "";
  let structured: StructureResult | undefined;
  /** [editable] entries a structure change needs at the end of the file. */
  const extraEditable: string[] = [];
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
        header = `[node name="${name}" type="${nodeClass(api, edit.type)}" parent="${parentAttr}"]`;
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
    case "set_editable": {
      const path = edit.node.replace(/^\.\//, "");
      const { roots } = lockedOf(original);
      if (!roots.includes(path)) throw new SceneError(`${path} is not an instanced scene in ${resPath}${roots.length ? `; instances: ${roots.slice(0, 8).join(", ")}` : ""}`);
      const existing = blocks.filter((b) => b.tag === "editable" && b.attrs["path"] === path);
      if (edit.editable === false) {
        if (!existing.length) throw new SceneError(`nothing to change: ${path} is not editable`);
        for (const b of existing) removeBlock(b);
        summary = `make ${path} not editable`;
      } else {
        if (existing.length) throw new SceneError(`nothing to change: ${path} is already editable`);
        splices.push(editableSplice([path]));
        summary = `make ${path} editable (its children can be changed in this scene)`;
      }
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
    case "rename_node":
    case "move_node":
    case "duplicate_node":
    case "set_groups": {
      /** Children a node only has through the scene it instances (through inherited scenes too). */
      const inheritedNames = (node: SceneNode): string[] => {
        const names: string[] = [];
        let path = extPath(node.instanceRef);
        for (let depth = 0; path && depth < 8 && existsSync(fromResPath(root, path)); depth++) {
          const sub = parseResourceText(readFileSync(fromResPath(root, path), "utf8"));
          for (const n of sub.nodes) if (n.path !== "." && !n.path.includes("/")) names.push(n.name);
          path = sub.extResources.find((e) => e.id === sub.nodes[0]?.instanceRef)?.path;
        }
        return names;
      };
      structured = structureEdit({ lines, blocks, scene, file: resPath, findNode, inheritedNames, fail: (m) => new SceneError(m) }, edit);
      summary = structured.summary;
      warnings.push(...structured.warnings);
      const scripts = structured.scripts;
      if (scripts) {
        // Scripts are reported, not changed: a path in code may be built from parts, or mean another scene's node.
        const uses = findUsages(root, scripts.name).usages.filter((u) => (u.kind === "node path" || u.kind === "string") && u.file !== resPath);
        const where = `${uses.slice(0, 3).map((u) => `${u.file}:${u.line}`).join(", ")}${uses.length > 3 ? ", ..." : ""}`;
        if (uses.length)
          warnings.push(
            edit.op === "rename_node"
              ? `"${scripts.name}" is named in ${uses.length} place${uses.length === 1 ? "" : "s"} outside this scene (${where}): $${scripts.from}, get_node("${scripts.from}") and %${scripts.name} are not changed here. Check them with godot_usages ${scripts.name}; godot_rename ${scripts.name} ${scripts.to.split("/").at(-1)} renames a node name everywhere`
              : `"${scripts.name}" is named in ${uses.length} place${uses.length === 1 ? "" : "s"} outside this scene (${where}): a path such as $${scripts.from} or get_node("${scripts.from}") must become ${scripts.to}. Check them with godot_usages ${scripts.name}`,
          );
        else warnings.push(`no script names "${scripts.name}" in a way Godotwright can see; paths built in code are not found, so check with godot_usages ${scripts.name} when in doubt`);
      }
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

  if (structured ? structured.lines.join("\n") === lines.join("\n") : splices.every((sp) => sp.added.join("\n") === lines.slice(sp.start, sp.start + sp.count).join("\n")))
    throw new SceneError(`nothing to change: ${summary} is already so`);
  const apply = (): string => {
    if (structured) {
      const out = [...structured.lines];
      let at = out.length;
      while (at > 0 && (out[at - 1] ?? "").trim() === "") at--;
      out.splice(at, 0, ...extraEditable.flatMap((p) => ["", `[editable path="${p}"]`]));
      return out.join(eol);
    }
    const out = [...lines];
    for (const sp of [...splices].sort(spliceOrder)) out.splice(sp.start, sp.count, ...sp.added);
    return out.join(eol);
  };
  let text = apply();
  try {
    const after = parseResourceText(text);
    const paths = after.nodes.map((n) => n.path);
    if (structured && new Set(paths).size !== paths.length && new Set(scene.nodes.map((n) => n.path)).size === scene.nodes.length) throw new Error("two nodes would get the same path");
  } catch (error) {
    throw new SceneError(`the change would leave ${resPath} unreadable (${(error as Error).message}); nothing was written`);
  }
  if (edit.op === "set_editable" && edit.editable === false) {
    const lost = lockedOf(text).locked.find((l) => l.root === edit.node.replace(/^\.\//, ""))?.count ?? 0;
    if (lost) warnings.push(`${lost} edit${lost === 1 ? "" : "s"} inside it will be dropped on the next save from the editor`);
  }
  // A change inside an instanced scene that is not editable: Godot would drop it on the next save from the editor.
  if (edit.op === "add_node" || edit.op === "set" || edit.op === "connect" || (structured && structured.touched.length)) {
    // The nodes this change is about: inside a locked instance when strictly below its root.
    const touched = structured ? structured.touched : edit.op === "add_node" ? [edit.parent.replace(/^\.\//, "")] : edit.op === "set" ? [edit.node.replace(/^\.\//, "")] : edit.op === "connect" ? [edit.from, edit.to] : [];
    // Only below an instance (or in an inherited scene) can a change be dropped; a node made in this batch was checked with its parent.
    const canLock = scene.nodes[0]?.instanceRef !== undefined || scene.nodes.some((n) => n.instanceRef && touched.some((t) => t.startsWith(`${n.path}/`)));
    const added =
      (batch && (edit.op === "set" || !canLock)) || (structured && !canLock)
        ? []
        : lockedOf(text)
            .locked.map((l) => l.root)
            .filter((r) => touched.some((t) => t.startsWith(`${r}/`)));
    const makeEditable = "makeEditable" in edit && edit.makeEditable === true;
    if (added.length && !makeEditable) {
      throw new SceneError(
        `this changes the inside of the instanced scene at ${added.map((r) => `"${r}"`).join(", ")}, which is not editable: Godot would drop it on the next save from the editor. Pass make_editable (adds [editable path="${added[0]}"]), or change the instanced scene itself.`,
      );
    }
    if (added.length) {
      if (structured) extraEditable.push(...added);
      else splices.push(editableSplice(added));
      text = apply();
      summary += ` (and make ${added.join(", ")} editable)`;
    }
  }
  splices.sort(spliceOrder);
  const hunks = structured ? lineHunks(lines, text.split(eol)) : [...splices].reverse().map((s) => ({ line: s.start + 1, removed: lines.slice(s.start, s.start + s.count), added: s.added }));
  return { text, hunks, summary, warnings };
}

/** The plan as a compact diff, with the warnings and, when written, the review errors before and after. */
export function formatScenePlan(plan: ScenePlan): string {
  const out = [`scene ${plan.summary}${plan.written ? ` (written${plan.journal ? `, journal #${plan.journal}: godot_undo reverts it` : ""})` : " (dry run: add --write to apply)"}`, plan.file];
  for (const h of plan.hunks) {
    h.removed.forEach((l, i) => out.push(`  ${i === 0 ? String(h.line).padStart(4) : "    "}  - ${l}`));
    h.added.forEach((l, i) => out.push(`  ${i === 0 && !h.removed.length ? String(h.line).padStart(4) : "    "}  + ${l}`));
  }
  for (const w of plan.warnings) out.push(`warning: ${w}`);
  if (plan.review) out.push(`review errors: ${plan.review.before} before, ${plan.review.after} after${plan.review.after > plan.review.before ? "  <- the change broke something: run godotwright review" : ""}`);
  return `${out.join("\n")}\n`;
}
