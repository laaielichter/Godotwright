import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { GodotApi, closest } from "../api/api.js";
import { applySplices, blocksOf, contentEnd, propSpan, type Block, type Splice } from "../godot/blocks.js";
import { parseResourceText } from "../godot/scene.js";
import { typedValue } from "../godot/typed-value.js";
import { asString } from "../godot/variant.js";
import { fromResPath, isInside } from "../project/files.js";
import { resourceType, scriptInfo } from "../scene/edit.js";
import { uidOf } from "../scene/uid.js";
import { ResourceEditError, type ResourceOp } from "./types.js";

export interface TextPlan {
  text: string;
  summaries: string[];
  warnings: string[];
  info: string[];
}

/** Godot's built-in value types: an ExtResource is never one of them. */
const BUILTIN = /^(bool|int|float|String|StringName|NodePath|Vector[234]i?|Rect2i?|Transform[23]D|Plane|Quaternion|AABB|Basis|Projection|Color|RID|Callable|Signal|Dictionary|Array|Packed\w+Array)$/;
const SUB_REF = /SubResource\(\s*"([^"]+)"\s*\)/g;
const EXT_REF = /ExtResource\(\s*"([^"]+)"\s*\)/g;

/** A sub_resource id the way the editor makes them: Type_ and five lowercase letters or digits. */
function newSubId(type: string, taken: Set<string>, seed: string): string {
  for (let n = 0; ; n++) {
    const id = `${type}_${createHash("sha1").update(`${seed}:${n}`).digest("hex").replace(/\d/g, (d) => "abcdefghij"[Number(d)] ?? d).slice(0, 5)}`;
    if (!taken.has(id)) return id;
  }
}

/** Short form of a value for listings. */
const short = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}...` : text);

/**
 * Applies `ops` to a .tres (or to the sub_resources of a .tscn) as text, one after the other, touching only the
 * lines of each change. Property names and types come from the Godot 4.7 reference (and the script's exports);
 * sub_resources stay ordered before their first use, and the uid lines are never rewritten.
 */
export function planTres(root: string, resPath: string, original: string, ops: ResourceOp[]): TextPlan {
  const api = GodotApi.load();
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const isScene = resPath.endsWith(".tscn");
  let text = original;
  const summaries: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  for (const edit of ops) {
    const lines = text.split(eol);
    const blocks = blocksOf(lines);
    const file = parseResourceText(text);
    const splices: Splice[] = [];
    const head = blocks[0];
    const resourceBlock = blocks.find((b) => b.tag === "resource");
    const subBlock = (id: string): Block => {
      const block = blocks.find((b) => b.tag === "sub_resource" && String(b.attrs["id"]) === id);
      if (!block) {
        const ids = file.subResources.map((s) => s.id);
        throw new ResourceEditError(`no sub_resource "${id}" in ${resPath}${ids.length ? `; it has ${closest(id, ids, 3).join(", ") || ids.slice(0, 6).join(", ")}` : ""}`);
      }
      return block;
    };
    const target = (sub?: string): { block: Block; cls?: string; label: string } => {
      if (sub) {
        const block = subBlock(sub);
        return { block, cls: asString(block.attrs["type"]), label: `sub_resource ${sub}` };
      }
      if (isScene) throw new ResourceEditError(`in a .tscn only sub_resources can be edited here (give sub); use godot_scene_edit for nodes`);
      if (!resourceBlock) throw new ResourceEditError(`${resPath} has no [resource] section`);
      return { block: resourceBlock, cls: asString(head?.attrs["type"]), label: "[resource]" };
    };

    /** An ext_resource for a file: the one the file has, or a new line after the others. */
    const extFor = (path: string, fallbackType?: string): string => {
      const have = file.extResources.find((e) => e.path === path);
      if (have) return have.id;
      if (!isInside(root, fromResPath(root, path))) throw new ResourceEditError(`${path} is outside the project`);
      if (!existsSync(fromResPath(root, path))) throw new ResourceEditError(`${path} does not exist in the project`);
      if (path === resPath) throw new ResourceEditError(`a resource cannot contain itself`);
      const type = resourceType(root, path, fallbackType);
      const ids = new Set(file.extResources.map((e) => e.id));
      const slug = basename(path).replace(/\.\w+$/, "").replace(/\W+/g, "_").toLowerCase() || "res";
      let n = ids.size + 1;
      while (ids.has(`${n}_${slug}`)) n++;
      const id = `${n}_${slug}`;
      const uid = uidOf(root, path);
      const line = `[ext_resource type="${type}"${uid ? ` uid="${uid}"` : ""} path="${path}" id="${id}"]`;
      const last = blocks.filter((b) => b.tag === "ext_resource").at(-1);
      if (last) splices.push({ start: last.start + 1, count: 0, added: [line] });
      else splices.push({ start: 1, count: 0, added: (lines[1] ?? "").trim() === "" ? ["", line] : ["", line, ""] });
      return id;
    };

    /** The type, enum constants and default of a property, from the script's exports or the class reference. */
    const propertyInfo = (block: Block, cls: string | undefined, property: string, label: string) => {
      // [resource] and each sub_resource can have their own script = ExtResource("id").
      const scriptSpan = propSpan(lines, block, "script");
      const scriptRef = scriptSpan ? /ExtResource\(\s*"([^"]+)"\s*\)/.exec(lines.slice(scriptSpan.start, scriptSpan.start + scriptSpan.count).join(" "))?.[1] : undefined;
      const scriptPath = file.extResources.find((e) => e.id === scriptRef)?.path;
      const script = scriptPath?.endsWith(".gd") && existsSync(fromResPath(root, scriptPath)) ? scriptInfo(readFileSync(fromResPath(root, scriptPath), "utf8")) : undefined;
      const enumValues: Record<string, number> = {};
      if (script?.exports.has(property)) return { type: script.exports.get(property), enumValues };
      if (property.includes("/")) {
        warnings.push(`${property} is not a property Godotwright can check (a dynamic name such as a theme item or a surface)`);
        return { enumValues };
      }
      if (!cls || !api.getClass(cls)) {
        warnings.push(`the class of ${label} is unknown, so ${property} is not checked`);
        return { enumValues };
      }
      const member = api.member(cls, property).find((e) => e.kind === "property");
      if (!member) {
        const names = new Set([...api.ancestors(cls).flatMap((c) => (c.members ?? []).map((m) => m.name)), ...(script?.exports.keys() ?? [])]);
        const near = closest(property, [...names], 3);
        throw new ResourceEditError(`${label} (${cls}) has no property ${property}${near.length ? `; did you mean ${near.join(", ")}?` : ""}`);
      }
      const item = member.item as { type: string; enum?: string; default?: string };
      if (item.enum) {
        const [owner, enumName] = item.enum.includes(".") ? item.enum.split(".") : ["@GlobalScope", item.enum];
        for (const c of api.getClass(owner ?? "")?.constants ?? []) if (c.enum === enumName) enumValues[c.name] = Number(c.value);
      }
      return { type: item.type, enumValues, defaultText: item.default };
    };

    switch (edit.op) {
      case "get": {
        if (edit.sub === undefined && isScene) {
          info.push(`${resPath}: scene, ${file.subResources.length} sub_resources`);
          for (const s of file.subResources) info.push(`  ${s.id} (${s.type})`);
          break;
        }
        const t = target(edit.sub);
        const props = Object.entries(t.block.propLines).sort((a, b) => a[1] - b[1]);
        if (!edit.sub) info.push(`${resPath}: ${t.cls ?? "Resource"}${file.uid ? ` ${file.uid}` : ""}, ${file.extResources.length} ext_resources, ${file.subResources.length} sub_resources`);
        if (!edit.sub) for (const s of file.subResources) info.push(`  sub ${s.id} (${s.type})`);
        info.push(`${t.label}:`);
        for (const [key] of props) {
          if (edit.key && key !== edit.key) continue;
          const span = propSpan(lines, t.block, key);
          const value = span ? lines.slice(span.start, span.start + span.count).join(" ").replace(/^[^=]*=\s*/, "") : "";
          info.push(`  ${key} = ${short(value)}`);
        }
        if (edit.key && !(edit.key in t.block.propLines)) info.push(`  ${edit.key} is not set (Godot uses its default)`);
        break;
      }
      case "set": {
        const t = target(edit.sub);
        const property = edit.key.trim();
        if (!property) throw new ResourceEditError(`set needs key`);
        if (property === "script") throw new ResourceEditError(`setting a script on a resource is not supported here`);
        const { type, enumValues, defaultText } = propertyInfo(t.block, t.cls, property, t.label);
        const raw = edit.value.trim();
        const isResource = type !== undefined && api.getClass(type) !== undefined && api.inheritsFrom(type, "Resource");
        let value: string;
        const subRef = /^SubResource\(\s*"([^"]+)"\s*\)$/.exec(raw);
        if (subRef) {
          const ref = subBlock(subRef[1] ?? "");
          const refType = asString(ref.attrs["type"]) ?? "";
          if (type && api.getClass(type) && api.getClass(refType) && !api.inheritsFrom(refType, type)) throw new ResourceEditError(`${property} takes a ${type}; sub_resource ${subRef[1]} is a ${refType}`);
          if (ref === t.block) throw new ResourceEditError(`a sub_resource cannot contain itself`);
          value = `SubResource("${subRef[1]}")`;
        } else if (isResource && raw.startsWith("res://")) {
          if (!isInside(root, fromResPath(root, raw))) throw new ResourceEditError(`${raw} is outside the project`);
          const fileType = resourceType(root, raw, type);
          if (type && api.getClass(fileType) && !api.inheritsFrom(fileType, type)) throw new ResourceEditError(`${property} takes a ${type}; ${raw} is a ${fileType}`);
          value = `ExtResource("${extFor(raw, type)}")`;
        } else if (/^ExtResource\(/.test(raw) && !(type && BUILTIN.test(type))) {
          const id = /^ExtResource\(\s*"([^"]+)"\s*\)$/.exec(raw)?.[1];
          const ext = id === undefined ? undefined : file.extResources.find((e) => e.id === id);
          if (!ext) {
            const ids = file.extResources.map((e) => e.id);
            throw new ResourceEditError(`${resPath} has no ext_resource ${id === undefined ? raw : `"${id}"`}${ids.length ? `; it has ${ids.slice(0, 8).join(", ")}` : ""}; give a res:// path instead`);
          }
          const extType = ext.type ?? "";
          if (type && api.getClass(type) && api.getClass(extType) && !api.inheritsFrom(extType, type)) throw new ResourceEditError(`${property} takes a ${type}; ext_resource ${id} is a ${extType}`);
          value = `ExtResource("${id}")`;
        } else if (isResource && raw === "null") value = "null";
        else if (isResource) throw new ResourceEditError(`${property} takes a ${type}: give a res:// file, SubResource("id") or null`);
        else value = typedValue(`${t.label}.${property}`, raw, isResource ? undefined : type, (m) => new ResourceEditError(m), enumValues);
        if (defaultText !== undefined && defaultText === value) warnings.push(`${value} is Godot's default for ${property}; the editor drops default values when it saves`);
        const span = propSpan(lines, t.block, property);
        const line = `${property} = ${value}`;
        splices.push(span ? { ...span, added: [line] } : { start: contentEnd(lines, t.block), count: 0, added: [line] });
        summaries.push(`set ${edit.sub ? `${edit.sub}.` : ""}${property} = ${short(value)}`);
        break;
      }
      case "unset": {
        const t = target(edit.sub);
        const span = propSpan(lines, t.block, edit.key.trim());
        if (!span) throw new ResourceEditError(`${t.label} does not set ${edit.key}; nothing to unset`);
        splices.push({ ...span, added: [] });
        summaries.push(`unset ${edit.sub ? `${edit.sub}.` : ""}${edit.key.trim()} (back to Godot's default)`);
        break;
      }
      case "add_sub": {
        const cls = api.getClass(edit.type);
        if (!cls || cls.name !== edit.type) {
          const near = api.closeClassNames(edit.type).slice(0, 3);
          throw new ResourceEditError(`${edit.type} is not a Godot ${api.version} class${near.length ? `; did you mean ${near.join(", ")}?` : ""}`);
        }
        if (!api.inheritsFrom(cls.name, "Resource")) throw new ResourceEditError(`${cls.name} is not a Resource, so it cannot be a sub_resource`);
        const taken = new Set(file.subResources.map((s) => s.id));
        const id = edit.id?.trim() || newSubId(cls.name, taken, `${resPath}:${text.length}`);
        if (!/^[\w-]+$/.test(id)) throw new ResourceEditError(`"${id}" is not a usable sub_resource id (letters, digits, _ and -)`);
        if (taken.has(id)) throw new ResourceEditError(`${resPath} already has a sub_resource "${id}"`);
        const header = `[sub_resource type="${cls.name}" id="${id}"]`;
        const lastSub = blocks.filter((b) => b.tag === "sub_resource").at(-1);
        const firstUse = blocks.find((b) => b.tag === "resource" || b.tag === "node");
        if (lastSub) splices.push({ start: lastSub.end, count: 0, added: (lines[lastSub.end - 1] ?? "").trim() === "" ? [header, ""] : ["", header] });
        else if (firstUse) splices.push({ start: firstUse.start, count: 0, added: [header, ""] });
        else splices.push({ start: lines.length, count: 0, added: ["", header] });
        summaries.push(`add sub_resource ${id} (${cls.name})`);
        break;
      }
      case "remove_sub": {
        const block = subBlock(edit.sub);
        const own = lines.slice(block.start, block.end).join("\n");
        const rest = [...lines.slice(0, block.start), ...lines.slice(block.end)].join("\n");
        const users = [...rest.matchAll(SUB_REF)].filter((m) => m[1] === edit.sub).length;
        if (users) throw new ResourceEditError(`sub_resource ${edit.sub} is still used ${users} time${users === 1 ? "" : "s"}; set or unset those properties first`);
        splices.push({ start: block.start, count: block.end - block.start, added: [] });
        summaries.push(`remove sub_resource ${edit.sub}${own.includes("SubResource(") ? " (sub_resources only it used stay; remove them too if unused)" : ""}`);
        break;
      }
      default:
        throw new ResourceEditError(`${edit.op} works on .import files, not on ${resPath}`);
    }
    if (splices.length) text = applySplices(lines, splices).join(eol);
  }

  if (text !== original) text = tidy(text, original, eol, resPath);
  return { text, summaries, warnings, info };
}

/**
 * After the edits: sub_resources ordered before their first use (Godot cannot load a forward reference),
 * ext_resources the edits left unused removed, and load_steps kept right when the file has it.
 */
function tidy(text: string, original: string, eol: string, resPath: string): string {
  let lines = text.split(eol);
  let blocks = blocksOf(lines);
  const subs = blocks.filter((b) => b.tag === "sub_resource");
  const idOf = (b: Block) => String(b.attrs["id"]);
  const pos = new Map(subs.map((b, i) => [idOf(b), i]));
  const needs = (b: Block) => [...lines.slice(b.start, b.end).join("\n").matchAll(SUB_REF)].map((m) => m[1] ?? "").filter((id) => pos.has(id) && id !== idOf(b));
  if (subs.some((b) => needs(b).some((id) => (pos.get(id) ?? 0) > (pos.get(idOf(b)) ?? 0)))) {
    // Stable depth-first order: each sub_resource after the ones it uses.
    const order: Block[] = [];
    const state = new Map<string, number>();
    const visit = (b: Block) => {
      const id = idOf(b);
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) throw new ResourceEditError(`sub_resource ${id} would contain itself through other sub_resources; Godot cannot load that`);
      state.set(id, 1);
      for (const dep of needs(b)) visit(subs[pos.get(dep) ?? 0] as Block);
      state.set(id, 2);
      order.push(b);
    };
    subs.forEach(visit);
    const first = subs[0] as Block;
    const last = subs.at(-1) as Block;
    const body = (b: Block) => {
      const chunk = lines.slice(b.start, contentEnd(lines, b));
      return [...chunk, ""];
    };
    const region = order.flatMap(body);
    const end = contentEnd(lines, last);
    lines = [...lines.slice(0, first.start), ...region.slice(0, -1), ...lines.slice(end)];
    blocks = blocksOf(lines);
  }

  const now = lines.join("\n");
  const was = original.split(eol).join("\n");
  const used = (src: string, id: string) => [...src.matchAll(EXT_REF)].some((m) => m[1] === id);
  const drop = blocks.filter((b) => b.tag === "ext_resource" && used(was, String(b.attrs["id"])) && !used(now, String(b.attrs["id"])));
  for (const b of [...drop].reverse()) {
    // The last ext_resource takes its blank line with it.
    const lone = (lines[b.start - 1] ?? "").trim() === "" && (lines[b.start + 1] ?? "").trim() === "";
    lines.splice(b.start, lone ? 2 : 1);
  }
  if (drop.length) blocks = blocksOf(lines);

  const head = blocks[0];
  if (head && /\bload_steps=\d+/.test(lines[head.start] ?? "")) {
    const count = blocks.filter((b) => b.tag === "ext_resource" || b.tag === "sub_resource").length + 1;
    lines[head.start] = (lines[head.start] ?? "").replace(/\bload_steps=\d+/, `load_steps=${count}`);
  }
  const out = lines.join(eol);
  try {
    parseResourceText(out);
  } catch (error) {
    throw new ResourceEditError(`the change would leave ${resPath} unreadable (${(error as Error).message}); nothing was written`);
  }
  return out;
}
