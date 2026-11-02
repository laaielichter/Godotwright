import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { GodotApi, closest } from "../api/api.js";
import { applySplices, blocksOf, contentEnd, propSpan, type Block, type Splice } from "../godot/blocks.js";
import { parseResourceFile, type Section } from "../godot/resource-file.js";
import { tryParse, typedValue } from "../godot/typed-value.js";
import { asString, formatVariant, parseValue, Reader, type Variant } from "../godot/variant.js";
import { loadGltf } from "../model/gltf.js";
import { fromResPath } from "../project/files.js";
import { findUsages } from "../usages/usages.js";
import { IMPORTER_CLASS, IMPORTER_SWITCH, PARAM_ENUMS, SUB_KINDS, SUB_OPTIONS, enumIndex, subOption, type SubKind } from "./import-options.js";
import type { TextPlan } from "./tres.js";
import { ResourceEditError, type ResourceOp } from "./types.js";

/** What a write must find in the .import after Godot reimported it. */
export type Expectation =
  | { what: "param"; key: string; value: string }
  | { what: "sub"; kind: string; name: string; key: string; value: string }
  | { what: "importer"; as: string };

export interface ImportTextPlan extends TextPlan {
  expect: Expectation[];
}

/** A _subresources dictionary with the leaf values kept as Godot wrote them (20.0 stays a float). */
type RawDict = Map<string, RawDict | string>;

function parseRawDict(r: Reader): RawDict {
  r.skipSpace();
  r.expect("{");
  const out: RawDict = new Map();
  for (;;) {
    r.skipSpace();
    if (r.peek() === "}") {
      r.next();
      return out;
    }
    const key = r.readString();
    r.skipSpace();
    r.expect(":");
    r.skipSpace();
    if (r.peek() === "{") out.set(key, parseRawDict(r));
    else {
      const start = r.pos;
      parseValue(r);
      out.set(key, r.src.slice(start, r.pos).trim());
    }
    r.skipSpace();
    if (r.peek() === ",") r.next();
  }
}

/** Writes the dictionary the way Godot does: one entry per line. */
function formatRawDict(d: RawDict): string {
  if (!d.size) return "{}";
  const entries = [...d].map(([k, v]) => `${JSON.stringify(k)}: ${typeof v === "string" ? v : formatRawDict(v)}`);
  return `{\n${entries.join(",\n")}\n}`;
}

interface ImportFile {
  sections: Section[];
  remap?: Section;
  params?: Section;
  importer: string;
}

function readImport(text: string): ImportFile {
  const sections = parseResourceFile(text);
  const remap = sections.find((s) => s.tag === "remap");
  const params = sections.find((s) => s.tag === "params");
  return { sections, remap, params, importer: asString(remap?.props["importer"]) ?? "" };
}

/** The importer whose option names a switch keeps (animation_library uses the scene importer's options). */
const optionImporter = (importer: string) => (importer === "animation_library" ? "scene" : importer);

interface ParamInfo {
  type?: string;
  defaultText?: string;
  enumNames?: string[];
  description?: string;
}

/** The documented options of an importer: name, type and default from the class reference, enum names from our table. */
function schemaOf(importer: string): Map<string, ParamInfo> {
  const out = new Map<string, ParamInfo>();
  const cls = IMPORTER_CLASS[importer];
  const api = GodotApi.load();
  for (const m of (cls ? api.getClass(cls)?.members : undefined) ?? []) {
    out.set(m.name, { type: m.type, ...(m.default !== undefined ? { defaultText: m.default } : {}), ...(m.description ? { description: m.description } : {}) });
  }
  for (const [key, names] of Object.entries(PARAM_ENUMS)) {
    const [owner, name] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (owner === optionImporter(importer)) out.set(name, { ...out.get(name), enumNames: names, type: "int" });
  }
  return out;
}

/** The type of a value Godot wrote, for options the class reference does not list. */
function typeOfText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const v = tryParse(text);
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return /[.eE]/.test(text) ? "float" : "int";
  if (typeof v === "string") return "String";
  return undefined;
}

/** A value checked against its type, with an enum choice given by name turned into its number. */
function checkedValue(label: string, raw: string, type: string | undefined, enumNames?: string[]): string {
  const value = raw.trim();
  if (enumNames && !/^-?\d+$/.test(value)) {
    const at = enumIndex(enumNames, value);
    if (at === undefined) throw new ResourceEditError(`${label} is one of ${enumNames.map((n, i) => `${i} ${n}`).join(", ")}; "${raw}" is not`);
    return String(at);
  }
  if (enumNames && (Number(value) < 0 || Number(value) >= enumNames.length)) throw new ResourceEditError(`${label} is one of ${enumNames.map((n, i) => `${i} ${n}`).join(", ")}; ${value} is out of range`);
  return typedValue(label, value, type || undefined, (m) => new ResourceEditError(m));
}

const choice = (names: string[] | undefined, value: string) => (names && /^\d+$/.test(value) && names[Number(value)] ? ` (${names[Number(value)]})` : "");

/**
 * The scene importer names a glTF mesh <file name>_<mesh name>, or <file name>_mesh when it has none (seen with Godot
 * 4.7.2: body in car.glb is car_body). Names that would clash get suffixes Godotwright does not predict.
 */
function meshNames(full: string, meshes: { name?: string }[]): string[] | undefined {
  const base = basename(full).replace(/\.[^.]+$/, "");
  const names = meshes.map((m) => `${base}_${m.name || "mesh"}`);
  return new Set(names).size === names.length ? names : undefined;
}

/** Names of the animations, meshes, materials and nodes in a glTF asset, as the scene importer names them. */
function assetNames(full: string): Record<SubKind, string[] | undefined> | undefined {
  if (![".glb", ".gltf"].includes(extname(full).toLowerCase()) || !existsSync(full)) return undefined;
  try {
    const json = loadGltf(full).json;
    const nodes: string[] = [];
    const walk = (index: number, prefix: string, depth: number) => {
      const node = json.nodes?.[index];
      if (!node || depth > 64) return;
      const name = `${prefix}${node.name ?? `Node${index}`}`;
      nodes.push(`PATH:${name}`);
      for (const child of node.children ?? []) walk(child, `${name}/`, depth + 1);
    };
    // One root node becomes the scene root on import, so node paths start below it.
    const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
    if (roots.length === 1) for (const child of json.nodes?.[roots[0] as number]?.children ?? []) walk(child, "", 0);
    else for (const root of roots) walk(root, "", 0);
    // Godot makes up names for unnamed items; a list with a gap is not used to refuse a name.
    const named = (list: { name?: string }[] | undefined) => ((list ?? []).every((x) => x.name) ? (list ?? []).map((x) => x.name as string) : undefined);
    return {
      animations: named(json.animations),
      meshes: meshNames(full, json.meshes ?? []),
      materials: named(json.materials),
      nodes: (json.nodes ?? []).every((n) => n.name) ? nodes : undefined,
    };
  } catch {
    return undefined;
  }
}

const ONE: Record<SubKind, string> = { animations: "animation", meshes: "mesh", materials: "material", nodes: "node" };

/** The text of one [params] value, as written. */
function paramText(lines: string[], block: Block | undefined, key: string): string | undefined {
  if (!block) return undefined;
  const span = propSpan(lines, block, key);
  return span ? lines.slice(span.start, span.start + span.count).join("\n").replace(/^[^=]*=/, "").trim() : undefined;
}

/**
 * Applies `ops` to a .import file as text. [params] names are checked against what Godot already wrote for this
 * asset and against the importer's class reference, values against their type (enum options by name), and
 * sub-resource options (per animation, mesh, material or node) against the names the scene importer reads and the
 * names in the asset. Only the changed lines are touched; Godot rewrites the whole file when it reimports.
 */
export function planImport(root: string, resPath: string, assetFull: string, original: string, ops: ResourceOp[]): ImportTextPlan {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  let text = original;
  const summaries: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const expect: Expectation[] = [];
  const asset = resPath.replace(/\.import$/, "");

  for (const edit of ops) {
    const lines = text.split(eol);
    const blocks = blocksOf(lines);
    const file = readImport(text);
    const params = blocks.find((b) => b.tag === "params");
    const remapBlock = blocks.find((b) => b.tag === "remap");
    const schema = schemaOf(file.importer);
    const written = new Set(Object.keys(file.params?.props ?? {}));
    const splices: Splice[] = [];

    const describe = (key: string): ParamInfo & { known: boolean } => {
      const s = schema.get(key);
      const type = s?.type ?? typeOfText(paramText(lines, params, key));
      return { ...s, ...(type ? { type } : {}), known: Boolean(s) || written.has(key) };
    };
    const needKey = (key: string): ParamInfo => {
      if (key === "_subresources") throw new ResourceEditError(`_subresources is edited per sub-resource: give sub (animations/<name>, meshes/<name>, materials/<name> or nodes/PATH:<node>)`);
      const d = describe(key);
      if (!d.known) {
        const names = [...new Set([...written, ...schema.keys()])].filter((k) => k !== "_subresources");
        if (!names.length) throw new ResourceEditError(`${asset} has no import options yet and its importer (${file.importer || "unknown"}) is not one Godotwright knows; import it once (godot_check) first`);
        const group = key.includes("/") ? names.filter((n) => n.startsWith(key.slice(0, key.indexOf("/") + 1))) : [];
        const near = closest(key, names, 3);
        throw new ResourceEditError(`the ${file.importer} importer has no option ${key}${near.length ? `; did you mean ${near.join(", ")}?` : group.length ? `; it has ${group.slice(0, 8).join(", ")}` : ""} (Godot drops unknown options without a word)`);
      }
      return d;
    };
    const setParam = (key: string, value: string) => {
      const line = `${key}=${value}`;
      const span = params ? propSpan(lines, params, key) : undefined;
      if (span) splices.push({ ...span, added: [line] });
      else if (params) splices.push({ start: contentEnd(lines, params), count: 0, added: [line] });
      else splices.push({ start: lines.length, count: 0, added: ["", "[params]", "", line] });
    };
    const subTarget = (sub: string): { kind: SubKind; name: string } => {
      const slash = sub.indexOf("/");
      const kind = sub.slice(0, slash < 0 ? undefined : slash) as SubKind;
      const name = slash < 0 ? "" : sub.slice(slash + 1);
      if (!SUB_KINDS.includes(kind) || !name) throw new ResourceEditError(`sub is kind/name with kind ${SUB_KINDS.join(", ")}: animations/run, meshes/body, materials/paint, nodes/PATH:Car/Wheel`);
      if (!["scene", "animation_library"].includes(file.importer)) throw new ResourceEditError(`only scene imports (.glb, .gltf, .fbx, .blend, .obj as scene) have per-${ONE[kind]} options; ${asset} uses the ${file.importer} importer`);
      return { kind, name };
    };
    const subDict = (): { dict: RawDict; span: { start: number; count: number } } => {
      const span = params ? propSpan(lines, params, "_subresources") : undefined;
      if (!span) return { dict: new Map(), span: { start: params ? contentEnd(lines, params) : lines.length, count: 0 } };
      const raw = lines.slice(span.start, span.start + span.count).join("\n").replace(/^[^=]*=/, "");
      return { dict: parseRawDict(new Reader(raw)), span };
    };
    const writeSubDict = (dict: RawDict, span: { start: number; count: number }) => {
      splices.push({ ...span, added: `_subresources=${formatRawDict(dict)}`.split("\n") });
    };

    switch (edit.op) {
      case "get":
      case "diff": {
        const md5 = destMd5(root, text);
        if (!info.length) info.push(`${asset}: importer ${file.importer || "?"}, type ${asString(file.remap?.props["type"]) ?? "?"}${asString(file.remap?.props["uid"]) ? `, ${asString(file.remap?.props["uid"])}` : ""}, ${md5 ? `imported (dest_md5 ${md5.md5.slice(0, 8)})` : "not imported yet"}`);
        if (edit.op === "get" && edit.sub) {
          const { kind, name } = subTarget(edit.sub);
          const entry = subDict().dict.get(kind);
          const own = entry instanceof Map ? entry.get(name) : undefined;
          info.push(`${kind}/${name}:${own instanceof Map && own.size ? "" : " no options set (the importer's defaults apply)"}`);
          if (own instanceof Map) for (const [k, v] of own) if (typeof v === "string" && !(/^(slice_|save_to_file\/|slices\/amount)/.test(k) && /^(""|0|false)$/.test(v)) && (!edit.key || k === edit.key)) info.push(`  ${k}=${v}${choice(subOption(kind, k)?.enum, v)}`);
          const names = assetNames(assetFull)?.[kind];
          if (names) info.push(`  ${kind} in the asset: ${names.slice(0, 20).join(", ") || "none"}`);
          break;
        }
        if (edit.op === "get" && edit.key) {
          const d = needKey(edit.key);
          const now = paramText(lines, params, edit.key);
          info.push(`${edit.key}=${now ?? "(not written yet)"}${choice(d.enumNames, now ?? "")}  type ${d.type ?? "?"}${d.defaultText !== undefined ? `, default ${d.defaultText}${choice(d.enumNames, d.defaultText)}` : ""}`);
          if (d.enumNames) info.push(`  choices: ${d.enumNames.map((n, i) => `${i} ${n}`).join(", ")}`);
          if (d.description) info.push(`  ${d.description.split("\n")[0]?.slice(0, 240)}`);
          break;
        }
        let same = 0;
        for (const key of Object.keys(file.params?.props ?? {})) {
          if (key === "_subresources") continue;
          const now = paramText(lines, params, key) ?? "";
          const d = describe(key);
          const differs = d.defaultText !== undefined && formatVariant(tryParse(now) ?? now) !== formatVariant(tryParse(d.defaultText) ?? d.defaultText);
          if (edit.op === "diff" && !differs) {
            same++;
            continue;
          }
          info.push(`${differs ? "*" : " "} ${key}=${now}${choice(d.enumNames, now)}${differs ? `  (default ${d.defaultText}${choice(d.enumNames, d.defaultText ?? "")})` : ""}`);
        }
        if (edit.op === "diff") info.push(`${same} option${same === 1 ? "" : "s"} at the default${info.length === 1 ? "; nothing differs" : ""}`);
        const subs = subDict().dict;
        for (const [kind, entries] of subs) {
          if (!(entries instanceof Map)) continue;
          for (const [name, opts] of entries) {
            if (!(opts instanceof Map)) continue;
            const set = [...opts].filter(([k, v]) => typeof v === "string" && !(/^(slice_|save_to_file\/|slices\/amount)/.test(k) && /^(""|0|false)$/.test(v)));
            info.push(`  ${kind}/${name}: ${set.map(([k, v]) => `${k}=${v as string}`).join(", ") || "defaults"}`);
          }
        }
        break;
      }
      case "set": {
        if (edit.sub) {
          const { kind, name } = subTarget(edit.sub);
          const key = edit.key.trim();
          const opt = subOption(kind, key);
          if (!opt) {
            const near = closest(key, Object.keys(SUB_OPTIONS[kind]), 3);
            throw new ResourceEditError(`${kind} have no import option ${key}${near.length ? `; did you mean ${near.join(", ")}?` : ""} (known: ${Object.keys(SUB_OPTIONS[kind]).slice(0, 8).join(", ")}${Object.keys(SUB_OPTIONS[kind]).length > 8 ? ", ..." : ""}); Godot keeps unknown keys without using them`);
          }
          const { dict, span } = subDict();
          const names = assetNames(assetFull)?.[kind];
          const kindDict = dict.get(kind);
          const known = kindDict instanceof Map && kindDict.has(name);
          if (names && !names.includes(name) && !known) {
            const near = closest(name, names, 3);
            const msg = `${asset} has no ${ONE[kind]} "${name}"; it has ${(near.length ? near : names).slice(0, 8).join(", ") || "none"}`;
            if (kind === "nodes") warnings.push(`${msg} (node names can differ after import; check with godot_scene_edit or the scan)`);
            else throw new ResourceEditError(msg);
          } else if (!names && !known) warnings.push(`Godotwright cannot list every ${ONE[kind]} name of ${asset}; "${name}" is not checked (Godot keeps options for a name it does not have, and ignores them)`);
          const value = checkedValue(`${kind}/${name} ${key}`, edit.value, opt.type, opt.enum);
          const k = kindDict instanceof Map ? kindDict : new Map<string, RawDict | string>();
          const entry = k.get(name);
          const e = entry instanceof Map ? entry : new Map<string, RawDict | string>();
          e.set(key, value);
          k.set(name, e);
          dict.set(kind, k);
          writeSubDict(dict, span);
          expect.push({ what: "sub", kind, name, key, value });
          summaries.push(`set ${kind}/${name} ${key}=${value}${choice(opt.enum, value)}`);
          break;
        }
        const key = edit.key.trim();
        const d = needKey(key);
        const value = checkedValue(key, edit.value, d.type, d.enumNames);
        if (d.defaultText !== undefined && formatVariant(tryParse(value) ?? value) === formatVariant(tryParse(d.defaultText) ?? d.defaultText) && paramText(lines, params, key) === undefined) warnings.push(`${value} is the default of ${key}`);
        setParam(key, value);
        expect.push({ what: "param", key, value });
        summaries.push(`set ${key}=${value}${choice(d.enumNames, value)}`);
        break;
      }
      case "unset": {
        if (edit.sub) {
          const { kind, name } = subTarget(edit.sub);
          const { dict, span } = subDict();
          const k = dict.get(kind);
          const e = k instanceof Map ? k.get(name) : undefined;
          if (!(e instanceof Map) || !e.has(edit.key)) throw new ResourceEditError(`${kind}/${name} does not set ${edit.key}; nothing to unset`);
          e.delete(edit.key);
          if (!e.size && k instanceof Map) k.delete(name);
          if (k instanceof Map && !k.size) dict.delete(kind);
          writeSubDict(dict, span);
          summaries.push(`unset ${kind}/${name} ${edit.key} (back to the importer's default)`);
          break;
        }
        const key = edit.key.trim();
        const d = needKey(key);
        if (d.defaultText === undefined) throw new ResourceEditError(`the default of ${key} is not in the class reference; set the value you want instead`);
        setParam(key, d.defaultText);
        expect.push({ what: "param", key, value: d.defaultText });
        summaries.push(`unset ${key} (default ${d.defaultText}${choice(d.enumNames, d.defaultText)})`);
        break;
      }
      case "importer": {
        const as = edit.as.trim();
        const sw = IMPORTER_SWITCH[as];
        if (as === file.importer) throw new ResourceEditError(`nothing to change: ${asset} already uses the ${as} importer`);
        if (as !== "keep" && !sw?.from.includes(file.importer)) {
          const can = Object.entries(IMPORTER_SWITCH).filter(([, s]) => s.from.includes(file.importer)).map(([id]) => id);
          throw new ResourceEditError(`Godotwright can switch the ${file.importer || "?"} importer to ${[...can, "keep"].join(" or ")}, not to ${as}`);
        }
        if (!remapBlock) throw new ResourceEditError(`${resPath} has no [remap] section`);
        const ip = propSpan(lines, remapBlock, "importer");
        if (!ip) throw new ResourceEditError(`${resPath} has no importer line`);
        splices.push({ ...ip, added: [`importer="${as}"`] });
        const tp = propSpan(lines, remapBlock, "type");
        if (sw && tp) splices.push({ ...tp, added: [`type="${sw.type}"`] });
        expect.push({ what: "importer", as });
        summaries.push(`importer ${file.importer} -> ${as}${sw ? ` (loads as ${sw.type})` : " (Godot keeps the last imported output and stops reimporting)"}`);
        if (as !== "keep") {
          warnings.push(`the old ${file.importer} output stays in .godot/imported as a stale file; the uid is kept`);
          try {
            const users = findUsages(root, asset).usages.filter((u) => u.file !== resPath);
            if (users.length) warnings.push(`${users.length} place${users.length === 1 ? "" : "s"} load ${asset} and will get ${sw?.type ?? "another type"} instead (${users.slice(0, 3).map((u) => `${u.file}:${u.line}`).join(", ")})`);
          } catch {
            // Usages are a hint only.
          }
        }
        break;
      }
      case "reimport":
        summaries.push(`reimport ${asset}`);
        break;
      default:
        throw new ResourceEditError(`${edit.op} works on .tres files, not on ${resPath}`);
    }
    if (splices.length) text = applySplices(lines, splices).join(eol);
  }
  if (text !== original) {
    try {
      parseResourceFile(text);
    } catch (error) {
      throw new ResourceEditError(`the change would leave ${resPath} unreadable (${(error as Error).message}); nothing was written`);
    }
  }
  return { text, summaries, warnings, info, expect };
}

/** The dest_md5 Godot keeps for an asset's imported output, and when that record was written. */
export function destMd5(root: string, importText: string): { md5: string; mtime: number } | undefined {
  const file = readImport(importText);
  const dest = asString(file.remap?.props["path"]) ?? (Array.isArray(file.sections.find((s) => s.tag === "deps")?.props["dest_files"]) ? asString((file.sections.find((s) => s.tag === "deps")?.props["dest_files"] as Variant[])[0]) : undefined);
  const m = dest ? /^(.*-[0-9a-f]{32})\.[^/]*$/.exec(dest) : null;
  if (!m?.[1]) return undefined;
  const full = fromResPath(root, `${m[1]}.md5`);
  try {
    const md5 = /dest_md5="([0-9a-f]+)"/.exec(readFileSync(full, "utf8"))?.[1];
    return md5 ? { md5, mtime: statSync(full).mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

/** Which expectations the reimported .import no longer meets, as "what (now X)". */
export function unmet(importText: string, expect: Expectation[]): string[] {
  const file = readImport(importText);
  const same = (a: Variant | undefined, b: string) => a !== undefined && formatVariant(a) === formatVariant(tryParse(b) ?? b);
  const out: string[] = [];
  let subs: RawDict | undefined;
  for (const e of expect) {
    if (e.what === "param") {
      const now = file.params?.props[e.key];
      if (!same(now, e.value)) out.push(`${e.key}=${e.value} (now ${now === undefined ? "gone" : formatVariant(now)})`);
    } else if (e.what === "importer") {
      if (file.importer !== e.as) out.push(`importer ${e.as} (now ${file.importer || "gone"})`);
    } else {
      if (!subs) {
        const lines = importText.split(/\r?\n/);
        const params = blocksOf(lines).find((b) => b.tag === "params");
        const raw = paramText(lines, params, "_subresources");
        subs = raw ? parseRawDict(new Reader(raw)) : new Map();
      }
      const kind = subs.get(e.kind);
      const entry = kind instanceof Map ? kind.get(e.name) : undefined;
      const now = entry instanceof Map ? entry.get(e.key) : undefined;
      if (typeof now !== "string" || !same(tryParse(now), e.value)) out.push(`${e.kind}/${e.name} ${e.key}=${e.value} (now ${typeof now === "string" ? now : "gone"})`);
    }
  }
  return out;
}

export { SUB_KINDS };
