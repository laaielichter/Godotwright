import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { GodotApi, closest, nearest } from "../api/api.js";
import { contentEnd, propSpan, type Block } from "../godot/blocks.js";
import { parseResourceText, type SceneNode } from "../godot/scene.js";
import { typedValue } from "../godot/typed-value.js";
import { isCall, type Variant } from "../godot/variant.js";
import { fromResPath } from "../project/files.js";
import { scriptInfo } from "../scene/edit.js";
import { TextEditError, blockAt, extFor, finishPlan, formatTextPlan, openDoc, rawProp, removeProp, setProp, type Doc, type OpenOptions, type TextEditPlan } from "../tilemap/plan.js";
import { arrayItems, dictEntries, formatDict, keyName, oneLine } from "./raw.js";

export class AnimationError extends TextEditError {}

const fail = (message: string) => new AnimationError(message);

const LOOP_MODES = ["none", "linear", "pingpong"] as const;
const INTERPOLATIONS = ["nearest", "linear", "cubic", "linear_angle", "cubic_angle"] as const;
const UPDATE_MODES = ["continuous", "discrete", "capture"] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

/** One keyframe. A value track takes `value`; a method track takes `method` and `args` (or `value: {method, args}`). */
export interface KeyInput {
  time: number;
  /** A number, true/false, or Godot value text: "Vector2(10, 20)", "Color(1, 0, 0, 1)", a res:// file for a resource. */
  value?: unknown;
  method?: string;
  args?: unknown[];
  /** Easing of the key (default 1, linear). */
  transition?: number;
}

/** One change to the animations of an AnimationPlayer, an AnimationLibrary .tres or an Animation .tres. */
export type AnimationEdit =
  | { op: "create"; name: string; length?: number; loop_mode?: LoopMode | number; step?: number }
  | { op: "add_track"; animation: string; type?: "value" | "method"; path: string; keys: KeyInput[]; interp?: string | number; update?: string | number; loop_wrap?: boolean }
  | ({ op: "set_key"; animation: string; track: number | string } & KeyInput)
  | { op: "remove_key"; animation: string; track: number | string; time: number }
  | { op: "remove_track"; animation: string; track: number | string }
  | { op: "remove"; animation: string }
  | { op: "set"; animation: string; length?: number; loop_mode?: LoopMode | number; step?: number };

/** Where the animation lives: `player` is the AnimationPlayer's node path (not needed when the scene has one), `library` its library ("" by default). */
export interface AnimationTarget {
  player?: string;
  library?: string;
}

export type AnimationEditArgs = AnimationEdit & AnimationTarget;

export interface AnimationReadArgs extends AnimationTarget {
  /** Only this animation. */
  animation?: string;
}

export interface AnimationOptions extends OpenOptions {
  /** Apply the change (default: only plan it). */
  write?: boolean;
}

export interface AnimationKey {
  time: number;
  /** The value as Godot text; a method key reads `name(args)`. */
  value: string;
  /** Left out when it is 1. */
  transition?: number;
}

export interface AnimationTrack {
  index: number;
  type: string;
  path: string;
  interp?: string;
  update?: string;
  enabled?: false;
  /** Keys of value and method tracks; other track types only give `keyCount`. */
  keys: AnimationKey[];
  keyCount?: number;
}

export interface AnimationInfo {
  name: string;
  library?: string;
  /** The file that holds it, when that is not the file that was read. */
  file?: string;
  length: number;
  loopMode: LoopMode;
  step?: number;
  tracks: AnimationTrack[];
}

export interface AnimationReport {
  file: string;
  player?: string;
  /** The node track paths start from (the player's root_node), as a path in the scene. */
  rootNode?: string;
  animations: AnimationInfo[];
  warnings: string[];
}

export interface AnimationPlan extends TextEditPlan {
  animation: string;
}

interface Entry {
  name: string;
  key: string;
  value: string;
}

interface Located {
  doc: Doc;
  player?: SceneNode;
  playerBlock?: Block;
  /** The player's libraries, as written. */
  libraries: Entry[];
  librariesMultiline?: boolean;
  libraryName: string;
  /** The section that holds `_data`: a sub_resource of the scene or the [resource] of a library file. */
  libraryBlock?: Block;
  /** The library is another file. */
  libraryFile?: string;
  entries: Entry[];
  dataMultiline?: boolean;
  /** A standalone Animation .tres: its [resource] section. */
  single?: Block;
}

const subId = (raw: string): string | undefined => /^SubResource\(\s*"([^"]*)"\s*\)$/.exec(raw.trim())?.[1];
const extId = (raw: string): string | undefined => /^ExtResource\(\s*"([^"]*)"\s*\)$/.exec(raw.trim())?.[1];
const subBlock = (doc: Doc, id: string | undefined): Block | undefined => (id === undefined ? undefined : doc.blocks.find((b) => b.tag === "sub_resource" && b.attrs["id"] === id));
const extPath = (doc: Doc, id: string | undefined): string | undefined => doc.file.extResources.find((e) => e.id === id)?.path;

function entriesOf(doc: Doc, block: Block, key: string): { entries: Entry[]; multiline?: boolean } {
  const raw = rawProp(doc, block, key);
  if (raw === undefined) return { entries: [] };
  const list = dictEntries(raw);
  if (!list) throw fail(`${key} in ${doc.resPath} is not a dictionary`);
  return { entries: list.map((e) => ({ name: keyName(e.key), key: e.key, value: e.value })), multiline: raw.includes("\n") };
}

/** Godot 4.4 and later write one dictionary entry per line; a file that has a dictionary on one line is older. */
const modern = (doc: Doc): boolean => !doc.lines.some((l) => /^[\w/]+ = \{.+\}\s*$/.test(l));

function locate(path: string, target: AnimationTarget, options: OpenOptions): Located {
  const doc = openDoc(path, options, [".tscn", ".tres"], fail);
  if (doc.file.kind === "resource") {
    const resource = doc.blocks.find((b) => b.tag === "resource");
    if (doc.file.resourceType === "Animation") {
      if (!resource) throw fail(`${doc.resPath} has no [resource] section`);
      return { doc, libraries: [], libraryName: "", entries: [], single: resource };
    }
    if (doc.file.resourceType !== "AnimationLibrary") throw fail(`${doc.resPath} is a ${doc.file.resourceType ?? "resource"}, not an Animation or an AnimationLibrary`);
    if (!resource) throw fail(`${doc.resPath} has no [resource] section`);
    const data = entriesOf(doc, resource, "_data");
    return { doc, libraries: [], libraryName: "", libraryBlock: resource, entries: data.entries, ...(data.multiline === undefined ? {} : { dataMultiline: data.multiline }) };
  }
  const players = doc.file.nodes.filter((n) => n.type === "AnimationPlayer");
  let player: SceneNode | undefined;
  if (target.player === undefined || target.player.trim() === "") {
    if (players.length !== 1) throw fail(players.length ? `${doc.resPath} has ${players.length} AnimationPlayer nodes; name one: ${players.map((n) => n.path).join(", ")}` : `${doc.resPath} has no AnimationPlayer node; add one first (scene add ... AnimationPlayer)`);
    player = players[0];
  } else {
    const wanted = target.player.replace(/^\.\//, "") || ".";
    player = doc.file.nodes.find((n) => n.path === wanted);
    if (!player) {
      const near = closest(wanted, players.map((n) => n.path), 3);
      throw fail(`no node "${target.player}" in ${doc.resPath}${near.length ? `; did you mean ${near.join(", ")}?` : players.length ? `; AnimationPlayer nodes: ${players.map((n) => n.path).join(", ")}` : ""} (the root is ".")`);
    }
    if (player.type !== "AnimationPlayer") throw fail(`${player.path} is ${player.type ? `a ${player.type}` : "an instanced scene"}, not an AnimationPlayer${players.length ? `; AnimationPlayer nodes: ${players.map((n) => n.path).join(", ")}` : ""}`);
  }
  if (!player) throw fail(`${doc.resPath} has no AnimationPlayer node`);
  const playerBlock = blockAt(doc, player.line);
  const libs = entriesOf(doc, playerBlock, "libraries");
  const libraryName = target.library ?? (libs.entries.some((e) => e.name === "") || libs.entries.length !== 1 ? "" : (libs.entries[0]?.name ?? ""));
  const out: Located = { doc, player, playerBlock, libraries: libs.entries, libraryName, entries: [], ...(libs.multiline === undefined ? {} : { librariesMultiline: libs.multiline }) };
  const lib = libs.entries.find((e) => e.name === libraryName);
  if (!lib) {
    if (target.library !== undefined && libs.entries.length) throw fail(`${player.path} has no library "${libraryName}"; it has ${libs.entries.map((e) => `"${e.name}"`).join(", ")}`);
    return out;
  }
  const block = subBlock(doc, subId(lib.value));
  if (block) {
    const data = entriesOf(doc, block, "_data");
    return { ...out, libraryBlock: block, entries: data.entries, ...(data.multiline === undefined ? {} : { dataMultiline: data.multiline }) };
  }
  const file = extPath(doc, extId(lib.value));
  if (!file) throw fail(`the library "${libraryName}" of ${player.path} (${lib.value}) is not in ${doc.resPath}`);
  return { ...out, libraryFile: file };
}

const num = (value: Variant | undefined, fallback: number): number => (typeof value === "number" ? value : fallback);
const floats = (raw: string | undefined): number[] | undefined => {
  const m = /^Packed(?:Float32|Float64|Real)Array\(([^)]*)\)$/.exec((raw ?? "").trim());
  if (!m) return raw !== undefined && raw.trim().startsWith("[") ? arrayItems(raw)?.map(Number) : undefined;
  return (m[1] ?? "").trim() === "" ? [] : (m[1] ?? "").split(",").map((p) => Number(p.trim()));
};

interface Keys {
  entries: { key: string; value: string }[];
  times: number[];
  transitions: number[];
  values: string[];
  multiline: boolean;
}

/** The keys of a value or method track, with the text of each value as the file has it. */
function readKeys(doc: Doc, block: Block, index: number): Keys | undefined {
  const raw = rawProp(doc, block, `tracks/${index}/keys`);
  const entries = raw === undefined ? undefined : dictEntries(raw);
  if (!entries) return undefined;
  const get = (name: string) => entries.find((e) => keyName(e.key) === name)?.value;
  const times = floats(get("times"));
  const values = arrayItems(get("values") ?? "");
  if (!times || !values || times.length !== values.length || times.some((t) => !Number.isFinite(t))) return undefined;
  const transitions = floats(get("transitions")) ?? [];
  return { entries, times, transitions: times.map((_, i) => transitions[i] ?? 1), values, multiline: (raw ?? "").includes("\n") };
}

const methodText = (raw: string): string => {
  const entries = dictEntries(raw);
  const method = entries?.find((e) => keyName(e.key) === "method")?.value;
  if (!entries || method === undefined) return oneLine(raw);
  return `${keyName(method)}(${(arrayItems(entries.find((e) => keyName(e.key) === "args")?.value ?? "[]") ?? []).map(oneLine).join(", ")})`;
};

const trackCount = (block: Block): number => Object.keys(block.props).reduce((n, k) => Math.max(n, Number(/^tracks\/(\d+)\//.exec(k)?.[1] ?? -1) + 1), 0);

function describe(doc: Doc, block: Block, name: string): AnimationInfo {
  const props = block.props;
  const tracks: AnimationTrack[] = [];
  for (let i = 0; i < trackCount(block); i++) {
    const type = typeof props[`tracks/${i}/type`] === "string" ? (props[`tracks/${i}/type`] as string) : "?";
    const pathValue = props[`tracks/${i}/path`];
    const track: AnimationTrack = { index: i, type, path: isCall(pathValue, "NodePath") && typeof pathValue.args[0] === "string" ? pathValue.args[0] : "", keys: [] };
    const interp = props[`tracks/${i}/interp`];
    if (typeof interp === "number") track.interp = INTERPOLATIONS[interp] ?? String(interp);
    if (props[`tracks/${i}/enabled`] === false) track.enabled = false;
    const keys = type === "value" || type === "method" ? readKeys(doc, block, i) : undefined;
    if (keys) {
      const update = keys.entries.find((e) => keyName(e.key) === "update")?.value;
      if (type === "value" && update !== undefined) track.update = UPDATE_MODES[Number(update)] ?? update;
      track.keys = keys.times.map((time, k) => ({ time, value: type === "method" ? methodText(keys.values[k] ?? "") : oneLine(keys.values[k] ?? ""), ...(keys.transitions[k] === 1 ? {} : { transition: keys.transitions[k] ?? 1 }) }));
    } else {
      const raw = rawProp(doc, block, `tracks/${i}/keys`);
      const times = floats(dictEntries(raw ?? "")?.find((e) => keyName(e.key) === "times")?.value);
      if (times) track.keyCount = times.length;
    }
    tracks.push(track);
  }
  const step = props["step"];
  return { name, length: num(props["length"], 1), loopMode: LOOP_MODES[num(props["loop_mode"], 0)] ?? "none", ...(typeof step === "number" ? { step } : {}), tracks };
}

/** The scene path of the node that track paths start from: the player's root_node (default its parent). */
function rootOf(player: SceneNode): string[] | undefined {
  const value = player.props["root_node"];
  const rootNode = isCall(value, "NodePath") && typeof value.args[0] === "string" ? value.args[0] : "..";
  return walk(player.path === "." ? [] : player.path.split("/"), rootNode);
}

/** Follows a relative node path from a node; undefined when it leaves the scene. */
function walk(from: string[], path: string): string[] | undefined {
  const out = [...from];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return undefined;
      out.pop();
    } else out.push(part);
  }
  return out;
}

const standaloneName = (doc: Doc, block: Block): string => (typeof block.props["resource_name"] === "string" && block.props["resource_name"] ? block.props["resource_name"] : basename(doc.resPath).replace(/\.\w+$/, ""));

/** Reads the animations of another file of the project (a library or an animation .tres), without failing the read. */
function readOther(doc: Doc, file: string, library: string | undefined, name: string | undefined, warnings: string[]): AnimationInfo[] {
  if (!file.endsWith(".tres") || !existsSync(fromResPath(doc.root, file))) {
    warnings.push(`${file} could not be read`);
    return [];
  }
  try {
    const other = locate(file, {}, { project: doc.root });
    const list = other.single ? [describe(other.doc, other.single, name ?? standaloneName(other.doc, other.single))] : animationsOf(other, warnings);
    return list.map((a) => ({ ...a, ...(library === undefined ? {} : { library }), file: a.file ?? file }));
  } catch (error) {
    if (!(error instanceof TextEditError)) throw error;
    warnings.push(`${file}: ${error.message}`);
    return [];
  }
}

function animationsOf(at: Located, warnings: string[]): AnimationInfo[] {
  const { doc } = at;
  const out: AnimationInfo[] = [];
  for (const entry of at.entries) {
    const block = subBlock(doc, subId(entry.value));
    if (block) out.push(describe(doc, block, entry.name));
    else {
      const file = extPath(doc, extId(entry.value));
      if (file) out.push(...readOther(doc, file, undefined, entry.name, warnings));
      else warnings.push(`animation "${entry.name}" (${entry.value}) is not in ${doc.resPath}`);
    }
  }
  return out;
}

/**
 * Reads the animations of an AnimationPlayer in a .tscn (every library, or the one named), of an AnimationLibrary
 * .tres or of an Animation .tres: length, loop mode, and each track with its path, type and keys.
 */
export function readAnimations(path: string, args: AnimationReadArgs = {}, options: OpenOptions = {}): AnimationReport {
  const at = locate(path, args, options);
  const { doc } = at;
  const warnings = doc.warnings;
  let animations: AnimationInfo[] = [];
  if (at.single) animations = [describe(doc, at.single, standaloneName(doc, at.single))];
  else if (!at.player) animations = animationsOf(at, warnings);
  else {
    for (const lib of at.libraries) {
      if (args.library !== undefined && lib.name !== args.library) continue;
      const block = subBlock(doc, subId(lib.value));
      if (block) animations.push(...animationsOf({ ...at, entries: entriesOf(doc, block, "_data").entries }, warnings).map((a) => ({ ...a, library: lib.name })));
      else {
        const file = extPath(doc, extId(lib.value));
        if (file) animations.push(...readOther(doc, file, lib.name, undefined, warnings));
      }
    }
  }
  if (args.animation !== undefined) {
    const all = animations;
    animations = all.filter((a) => a.name === args.animation || `${a.library ?? ""}/${a.name}` === args.animation);
    if (!animations.length) {
      const near = closest(args.animation, all.map((a) => a.name), 3);
      throw fail(`no animation "${args.animation}" in ${doc.resPath}${near.length ? `; did you mean ${near.join(", ")}?` : all.length ? `; it has ${all.map((a) => a.name).join(", ")}` : "; it has no animations"}`);
    }
  }
  const root = at.player ? rootOf(at.player) : undefined;
  return { file: doc.resPath, ...(at.player ? { player: at.player.path } : {}), ...(root ? { rootNode: root.join("/") || "." } : {}), animations, warnings };
}

const MAX_KEYS = 12;
const short = (n: number): string => String(Number(n.toFixed(4)));

export function formatAnimationReport(report: AnimationReport): string {
  const n = report.animations.length;
  const out = [`animation ${report.file}${report.player ? ` ${report.player}${report.rootNode ? ` (paths from ${report.rootNode})` : ""}` : ""}: ${n} animation${n === 1 ? "" : "s"}`];
  for (const a of report.animations) {
    out.push(`${a.library ? `${a.library}/` : ""}${a.name}  length ${short(a.length)}  loop ${a.loopMode}${a.step === undefined ? "" : `  step ${short(a.step)}`}  ${a.tracks.length} track${a.tracks.length === 1 ? "" : "s"}${a.file ? `  (in ${a.file})` : ""}`);
    for (const t of a.tracks) {
      const keys = t.keys.slice(0, MAX_KEYS).map((k) => `${short(k.time)}: ${k.value}${k.transition === undefined ? "" : ` ~${short(k.transition)}`}`);
      const rest = t.keys.length > MAX_KEYS ? `  ... +${t.keys.length - MAX_KEYS} keys` : t.keyCount === undefined ? "" : `${t.keyCount} keys`;
      out.push(`  ${t.index} ${t.type} ${t.path}${t.interp && t.type === "value" ? ` ${t.interp}` : ""}${t.update ? ` ${t.update}` : ""}${t.enabled === false ? " (disabled)" : ""}  ${keys.join("  ")}${rest}`.trimEnd());
    }
  }
  for (const w of report.warnings) out.push(`warning: ${w}`);
  return `${out.join("\n")}\n`;
}

const float = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(Number(n.toFixed(6))));
const packed = (list: number[]): string => `PackedFloat32Array(${list.map((n) => String(Number(n.toFixed(6)))).join(", ")})`;
const slug = (text: string): string => text.replace(/\W+/g, "_").replace(/^_+|_+$/g, "") || "anim";

function enumIndex(value: string | number | undefined, names: readonly string[], what: string, fallback: number): number {
  if (value === undefined) return fallback;
  const at = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value) : names.indexOf(value.trim().toLowerCase());
  if (!Number.isInteger(at) || at < 0 || at >= names.length) throw fail(`${what} is one of ${names.join(", ")} (or 0 to ${names.length - 1}), not ${JSON.stringify(value)}`);
  return at;
}

const positive = (value: unknown, what: string, min = 0): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) throw fail(`${what} must be a number${min > 0 ? ` above 0` : ` of 0 or more`}, not ${JSON.stringify(value)}`);
  return value;
};

interface PathCheck {
  /** The property's type from the class reference, when the path names one plain property. */
  type?: string;
  enumValues: Record<string, number>;
  /** Why the path cannot work. */
  problem?: string;
  /** The class and script of the node, for a method track. */
  cls?: string;
  script?: ReturnType<typeof scriptInfo>;
  scriptPath?: string;
}

/** Checks a track path against the scene: the node from the player's root_node, then the property on its class. */
function checkPath(at: Located, type: "value" | "method", path: string, warnings: string[]): PathCheck {
  const { doc, player } = at;
  const out: PathCheck = { enumValues: {} };
  const colon = path.indexOf(":");
  const nodePart = colon < 0 ? path : path.slice(0, colon);
  const property = colon < 0 ? "" : path.slice(colon + 1);
  if (type === "value" && !property) return { ...out, problem: `a value track animates a property: give the path as Node:property (for example Sprite2D:position), not "${path}"` };
  if (type === "method" && property) return { ...out, problem: `a method track's path names only the node ("${nodePart}"); the method goes in each key` };
  if (!player) {
    warnings.push(`${doc.resPath} is not a scene, so the path ${path} is not checked`);
    return out;
  }
  const base = rootOf(player);
  if (!base) {
    warnings.push(`the root_node of ${player.path} is outside this scene, so the path ${path} is not checked`);
    return out;
  }
  let node: SceneNode | undefined;
  if (nodePart.startsWith("%")) {
    const [unique, ...rest] = nodePart.slice(1).split("/");
    const owner = doc.file.nodes.find((n) => n.uniqueName && n.name === unique);
    const full = owner ? walk(owner.path === "." ? [] : owner.path.split("/"), rest.join("/")) : undefined;
    node = full ? doc.file.nodes.find((n) => n.path === (full.join("/") || ".")) : undefined;
    if (!node) return { ...out, problem: `no node with the unique name %${unique} in ${doc.resPath}${rest.length ? ` that has ${rest.join("/")}` : ""}` };
  } else {
    const full = walk(base, nodePart);
    if (!full) {
      warnings.push(`${nodePart} is outside this scene, so the path is not checked`);
      return out;
    }
    const scenePath = full.join("/") || ".";
    node = doc.file.nodes.find((n) => n.path === scenePath);
    if (!node) {
      // Below an instanced scene: its nodes are in another file.
      const instance = doc.file.nodes.find((n) => n.instanceRef && scenePath.startsWith(`${n.path}/`));
      if (instance) {
        warnings.push(`${nodePart} is inside the instanced scene at ${instance.path}, so the path is not checked`);
        return out;
      }
      const relative = (n: SceneNode): string => {
        const parts = n.path === "." ? [] : n.path.split("/");
        let same = 0;
        while (same < base.length && same < parts.length && base[same] === parts[same]) same++;
        return [...new Array<string>(base.length - same).fill(".."), ...parts.slice(same)].join("/") || ".";
      };
      const near = nearest(nodePart, doc.file.nodes.map(relative), 3);
      const from = base.join("/") || ".";
      return { ...out, problem: `no node "${nodePart}" from ${from === "." ? "the scene root" : from} (where the paths of ${player.path} start)${near.length ? `; did you mean ${near.join(", ")}?` : ""}` };
    }
  }
  // The class of the node: its type, or the root type of the scene it instances.
  let cls = node.type;
  let scriptPath = extPath(doc, node.scriptRef);
  for (let file = extPath(doc, node.instanceRef), depth = 0; !cls && file && depth < 8 && existsSync(fromResPath(doc.root, file)); depth++) {
    const sub = parseResourceText(readFileSync(fromResPath(doc.root, file), "utf8"));
    const top = sub.nodes[0];
    cls = top?.type;
    scriptPath ??= sub.extResources.find((e) => e.id === top?.scriptRef)?.path;
    file = sub.extResources.find((e) => e.id === top?.instanceRef)?.path;
  }
  const source = scriptPath?.endsWith(".gd") && existsSync(fromResPath(doc.root, scriptPath)) ? readFileSync(fromResPath(doc.root, scriptPath), "utf8") : undefined;
  const script = source === undefined ? undefined : scriptInfo(source);
  if (cls) out.cls = cls;
  if (script) out.script = script;
  if (scriptPath) out.scriptPath = scriptPath;
  if (type === "method") return out;
  const first = property.split(":")[0] ?? "";
  if (first.includes("/")) return out;
  if (!cls) {
    warnings.push(`the class of ${node.path} is unknown, so the property ${first} is not checked`);
    return out;
  }
  const api = GodotApi.load();
  const member = api.member(cls, first).find((e) => e.kind === "property");
  if (member) {
    if (first !== property) return out;
    const item = member.item as { type: string; enum?: string };
    out.type = item.type;
    if (item.enum) {
      const [owner, enumName] = item.enum.includes(".") ? item.enum.split(".") : ["@GlobalScope", item.enum];
      for (const c of api.getClass(owner ?? "")?.constants ?? []) if (c.enum === enumName) out.enumValues[c.name] = Number(c.value);
    }
    return out;
  }
  if (script?.exports.has(first)) {
    const exported = script.exports.get(first);
    if (first === property && exported) out.type = exported;
    return out;
  }
  if (source !== undefined && new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*(?:static\\s+)?var\\s+${first.replace(/[^\w]/g, "")}\\b`, "m").test(source)) return out;
  // A script that extends another script may declare it there.
  if (scriptPath && (!script || (script.extends && !api.getClass(script.extends)) || !script.extends)) {
    warnings.push(`${node.path} (${cls}) has no property ${first} that could be found; its script ${scriptPath} may declare it in a base script`);
    return out;
  }
  const names = new Set([...api.ancestors(cls).flatMap((c) => (c.members ?? []).map((m) => m.name)), ...(script?.exports.keys() ?? [])]);
  const near = closest(first, [...names], 3);
  return { ...out, problem: `${node.path} (${cls}) has no property ${first}${near.length ? `; did you mean ${near.join(", ")}?` : ""}` };
}

/** One key value as Godot text, typed by the property where its type is known. */
function valueText(doc: Doc, label: string, value: unknown, check: PathCheck): string {
  const api = GodotApi.load();
  const isResource = check.type !== undefined && api.getClass(check.type) !== undefined && api.inheritsFrom(check.type, "Resource");
  const type = isResource || check.type === "Variant" ? undefined : check.type;
  const typed = (text: string): string => typedValue(label, text, type, fail, check.enumValues);
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw fail(`${label}: ${value} is not a usable number`);
    return type ? typed(String(value)) : String(value);
  }
  if (typeof value === "boolean") return type ? typed(String(value)) : String(value);
  if (typeof value === "string") {
    if (value.trim().startsWith("res://") && (isResource || check.type === undefined)) return `ExtResource("${extFor(doc, value.trim(), check.type)}")`;
    if (isResource && !/^(ExtResource|SubResource)\(|^null$/.test(value.trim())) throw fail(`${label} takes a ${check.type}: give a res:// file or null`);
    return typed(value);
  }
  if (Array.isArray(value)) return `[${value.map((v, i) => valueText(doc, `${label}[${i}]`, v, { enumValues: {} })).join(", ")}]`;
  throw fail(`${label}: give the value as a number, true or false, or Godot value text such as "Vector2(10, 20)"`);
}

const METHOD_NAME = /^[A-Za-z_]\w*$/;

/** One method key as Godot text, after a check that the node has the method. */
function methodKey(doc: Doc, label: string, key: KeyInput, check: PathCheck, multiline: boolean, warnings: string[]): string {
  const given = key.value !== null && typeof key.value === "object" && !Array.isArray(key.value) ? (key.value as { method?: unknown; args?: unknown }) : undefined;
  const method = key.method ?? given?.method;
  const args = key.args ?? given?.args ?? [];
  if (typeof method !== "string" || !METHOD_NAME.test(method)) throw fail(`${label}: a method key needs method (a method name) and may have args`);
  if (!Array.isArray(args)) throw fail(`${label}: args must be a list`);
  if (check.cls) {
    const api = GodotApi.load();
    if (!api.hasMethod(check.cls, method) && !check.script?.funcs.has(method)) {
      const names = [...api.ancestors(check.cls).flatMap((c) => (c.methods ?? []).map((m) => m.name)), ...(check.script?.funcs.keys() ?? [])];
      const near = closest(method, names, 3);
      const text = `the node (${check.cls}) has no method ${method}${near.length ? `; did you mean ${near.join(", ")}?` : ""}`;
      // A script that extends another script may have it there.
      if (check.scriptPath && (!check.script?.extends || !api.getClass(check.script.extends))) warnings.push(`${text}; its script may have it in a base script`);
      else throw fail(`${label}: ${text}`);
    }
  }
  return formatDict(
    [
      { key: '"args"', value: `[${args.map((a, i) => valueText(doc, `${label} argument ${i + 1}`, a, { enumValues: {} })).join(", ")}]` },
      { key: '"method"', value: `&${JSON.stringify(method)}` },
    ],
    multiline,
  );
}

const SAME_TIME = 0.00005;

function writeKeys(doc: Doc, block: Block, index: number, keys: Keys): void {
  const set = (name: string, value: string) => {
    const entry = keys.entries.find((e) => keyName(e.key) === name);
    if (entry) entry.value = value;
    else keys.entries.push({ key: JSON.stringify(name), value });
  };
  set("times", packed(keys.times));
  set("transitions", packed(keys.transitions));
  set("values", `[${keys.values.join(", ")}]`);
  setProp(doc, block, `tracks/${index}/keys`, formatDict(keys.entries, keys.multiline));
}

/** The animation's section, or a refusal that names the file it is in. */
function animationBlock(at: Located, name: string): Block {
  const { doc } = at;
  if (at.single) {
    const own = standaloneName(doc, at.single);
    if (name && name !== own) throw fail(`${doc.resPath} holds the animation "${own}", not "${name}"`);
    return at.single;
  }
  if (at.libraryFile) throw fail(`the library "${at.libraryName}" of ${at.player?.path} is the file ${at.libraryFile}; edit that file`);
  const wanted = name.startsWith(`${at.libraryName}/`) && at.libraryName ? name.slice(at.libraryName.length + 1) : name;
  const entry = at.entries.find((e) => e.name === wanted);
  if (!entry) {
    const near = closest(wanted, at.entries.map((e) => e.name), 3);
    throw fail(`no animation "${name}" in ${at.player ? `the library "${at.libraryName}" of ${at.player.path}` : doc.resPath}${near.length ? `; did you mean ${near.join(", ")}?` : at.entries.length ? `; it has ${at.entries.map((e) => e.name).join(", ")}` : "; it has none yet (use create)"}`);
  }
  const block = subBlock(doc, subId(entry.value));
  if (block) return block;
  const file = extPath(doc, extId(entry.value));
  throw fail(file ? `the animation "${name}" is the file ${file}; edit that file` : `the animation "${name}" (${entry.value}) is not in ${doc.resPath}`);
}

function trackIndex(block: Block, track: number | string, name: string): number {
  const count = trackCount(block);
  const paths = Array.from({ length: count }, (_, i) => {
    const v = block.props[`tracks/${i}/path`];
    return isCall(v, "NodePath") && typeof v.args[0] === "string" ? v.args[0] : "";
  });
  if (typeof track === "number" || /^\d+$/.test(track.trim())) {
    const index = Number(track);
    if (!Number.isInteger(index) || index < 0 || index >= count) throw fail(`${name} has no track ${track}${count ? `; its tracks are 0 to ${count - 1}` : "; it has no tracks"}`);
    return index;
  }
  const found = paths.flatMap((p, i) => (p === track ? [i] : []));
  if (found.length === 1) return found[0] ?? 0;
  if (found.length > 1) throw fail(`${name} has ${found.length} tracks for ${track} (${found.join(", ")}); give the track's number`);
  const near = closest(track, paths, 3);
  throw fail(`${name} has no track for ${track}${near.length ? `; did you mean ${near.join(", ")}?` : paths.length ? `; its tracks: ${paths.map((p, i) => `${i} ${p}`).join(", ")}` : "; it has no tracks"}`);
}

const ORDER = ["resource_name", "length", "loop_mode", "step"];
/** A new length, loop_mode or step goes where Godot writes it: after the ones before it, ahead of the tracks. */
const after = (key: string) => (k: string) => !ORDER.includes(k) || ORDER.indexOf(k) > ORDER.indexOf(key);

function animationLines(id: string, name: string, edit: { length?: number; loop_mode?: LoopMode | number; step?: number }): string[] {
  const out = [`[sub_resource type="Animation" id="${id}"]`, `resource_name = ${JSON.stringify(name)}`];
  const length = edit.length === undefined ? 1 : positive(edit.length, "length", Number.MIN_VALUE);
  if (length !== 1) out.push(`length = ${float(length)}`);
  const loop = enumIndex(edit.loop_mode, LOOP_MODES, "loop_mode", 0);
  if (loop !== 0) out.push(`loop_mode = ${loop}`);
  if (edit.step !== undefined) out.push(`step = ${float(positive(edit.step, "step", Number.MIN_VALUE))}`);
  return out;
}

const freshId = (doc: Doc, prefix: string, name: string): string => {
  const ids = new Set(doc.file.subResources.map((s) => s.id));
  let id = `${prefix}_${slug(name)}`;
  for (let n = 2; ids.has(id); n++) id = `${prefix}_${slug(name)}_${n}`;
  return id;
};

/**
 * Plans (and with `write`, applies) one change to an animation: create or remove one, add or remove a track, set or
 * remove a key, or set length, loop mode and step. Works on an AnimationPlayer in a .tscn (its library is made when
 * it has none), an AnimationLibrary .tres or an Animation .tres. Track paths are checked against the scene.
 */
export function editAnimation(path: string, args: AnimationEditArgs, options: AnimationOptions = {}): AnimationPlan {
  const at = locate(path, args, options);
  const { doc } = at;
  const warnings = doc.warnings;
  const isModern = modern(doc);
  const nameKey = (name: string, like: Entry[]): string => `${like.length ? (like.some((e) => e.key.startsWith("&")) ? "&" : "") : isModern ? "&" : ""}${JSON.stringify(name)}`;
  let summary = "";
  let animation = "";
  switch (args.op) {
    case "create": {
      const name = (args.name ?? "").trim();
      animation = name;
      if (!name || /[/:,[]/.test(name)) throw fail(`"${args.name}" is not a usable animation name (not empty, and no / : , or [)`);
      if (at.single) throw fail(`${doc.resPath} is one animation; create a new one in an AnimationPlayer's scene or an AnimationLibrary`);
      if (at.libraryFile) throw fail(`the library "${at.libraryName}" of ${at.player?.path} is the file ${at.libraryFile}; edit that file`);
      if (at.entries.some((e) => e.name === name)) throw fail(`${at.player ? `the library "${at.libraryName}" of ${at.player.path}` : doc.resPath} already has an animation "${name}"`);
      const id = freshId(doc, "Animation", name);
      const lines = animationLines(id, name, args);
      const entry = { key: nameKey(name, at.entries), value: `SubResource("${id}")` };
      const data = formatDict([...at.entries.map((e) => ({ key: e.key, value: e.value })), entry], at.dataMultiline ?? isModern);
      if (at.libraryBlock) {
        doc.splices.push({ start: at.libraryBlock.start, count: 0, added: [...lines, ""] });
        setProp(doc, at.libraryBlock, "_data", data);
      } else {
        if (!at.player || !at.playerBlock) throw fail(`internal: no AnimationPlayer`);
        const libraryId = freshId(doc, "AnimationLibrary", at.player.name);
        const firstNode = doc.blocks.find((b) => b.tag === "node");
        if (!firstNode) throw fail(`${doc.resPath} has no nodes`);
        doc.splices.push({ start: firstNode.start, count: 0, added: [...lines, "", `[sub_resource type="AnimationLibrary" id="${libraryId}"]`, ...`_data = ${data}`.split("\n"), ""] });
        const libraries = [...at.libraries.map((e) => ({ key: e.key, value: e.value })), { key: nameKey(at.libraryName, at.libraries), value: `SubResource("${libraryId}")` }];
        setProp(doc, at.playerBlock, "libraries", formatDict(libraries, at.librariesMultiline ?? isModern));
      }
      summary = `create animation ${name}${at.player ? ` on ${at.player.path}` : ""}${at.libraryBlock ? "" : " (with a new AnimationLibrary)"}`;
      break;
    }
    case "remove": {
      animation = args.animation;
      if (at.single) throw fail(`${doc.resPath} is one animation; delete the file to remove it`);
      if (at.libraryFile) throw fail(`the library "${at.libraryName}" of ${at.player?.path} is the file ${at.libraryFile}; edit that file`);
      const entry = at.entries.find((e) => e.name === args.animation);
      if (!entry || !at.libraryBlock) {
        const near = closest(args.animation ?? "", at.entries.map((e) => e.name), 3);
        throw fail(`no animation "${args.animation}" to remove${near.length ? `; did you mean ${near.join(", ")}?` : at.entries.length ? `; there are ${at.entries.map((e) => e.name).join(", ")}` : ""}`);
      }
      const rest = at.entries.filter((e) => e !== entry).map((e) => ({ key: e.key, value: e.value }));
      if (rest.length) setProp(doc, at.libraryBlock, "_data", formatDict(rest, at.dataMultiline ?? isModern));
      else removeProp(doc, at.libraryBlock, "_data");
      const id = subId(entry.value);
      const block = subBlock(doc, id);
      if (block && doc.file.refs.filter((r) => r.kind === "SubResource" && r.id === id).length === 1) {
        doc.splices.push({ start: block.start, count: block.end - block.start, added: [] });
        if (/\b(Ext|Sub)Resource\(/.test(doc.lines.slice(block.start + 1, block.end).join("\n"))) warnings.push(`resources only this animation used stay in the file; Godot drops them on its next save`);
      } else if (block) warnings.push(`${entry.value} is used elsewhere in the file, so the animation's section stays`);
      const autoplay = at.player?.props["autoplay"];
      if (typeof autoplay === "string" && (autoplay === args.animation || autoplay === `${at.libraryName}/${args.animation}`)) warnings.push(`${at.player?.path} still has autoplay = "${autoplay}"`);
      summary = `remove animation ${args.animation}${at.player ? ` from ${at.player.path}` : ""}`;
      break;
    }
    case "set": {
      const block = animationBlock(at, args.animation);
      animation = args.animation;
      if (args.length === undefined && args.loop_mode === undefined && args.step === undefined) throw fail(`set needs length, loop_mode or step`);
      const parts: string[] = [];
      if (args.length !== undefined) {
        const length = positive(args.length, "length", Number.MIN_VALUE);
        // 1 second is Godot's default, which it does not write.
        if (length === 1) removeProp(doc, block, "length");
        else setProp(doc, block, "length", float(length), after("length"));
        const last = Math.max(0, ...describe(doc, block, "").tracks.flatMap((t) => t.keys.map((k) => k.time)));
        if (last > length + SAME_TIME) warnings.push(`there are keys after ${short(length)}s (the last at ${short(last)}s); they will not play`);
        parts.push(`length ${short(length)}`);
      }
      if (args.loop_mode !== undefined) {
        const loop = enumIndex(args.loop_mode, LOOP_MODES, "loop_mode", 0);
        if (loop === 0) removeProp(doc, block, "loop_mode");
        else setProp(doc, block, "loop_mode", String(loop), after("loop_mode"));
        parts.push(`loop ${LOOP_MODES[loop]}`);
      }
      if (args.step !== undefined) {
        setProp(doc, block, "step", float(positive(args.step, "step", Number.MIN_VALUE)), after("step"));
        parts.push(`step ${short(args.step)}`);
      }
      summary = `set ${args.animation}: ${parts.join(", ")}`;
      break;
    }
    case "add_track": {
      const block = animationBlock(at, args.animation);
      animation = args.animation;
      const type = args.type ?? "value";
      if (type !== "value" && type !== "method") throw fail(`a track's type is value or method here, not "${String(type)}" (other track types are made in the Godot editor)`);
      const path = (args.path ?? "").trim();
      if (!path) throw fail(`add_track needs a path (for example Sprite2D:position)`);
      if (!Array.isArray(args.keys)) throw fail(`add_track needs keys: [{time, value}]`);
      const check = checkPath(at, type, path, warnings);
      if (check.problem) throw fail(check.problem);
      const index = trackCount(block);
      const keys = args.keys.map((k, i) => ({ ...k, time: positive(k?.time, `key ${i + 1}: time`) })).sort((a, b) => a.time - b.time);
      keys.forEach((k, i) => {
        if (i > 0 && Math.abs(k.time - (keys[i - 1]?.time ?? -1)) < SAME_TIME) throw fail(`two keys are at ${short(k.time)}s; a track has one key per time`);
      });
      const values = keys.map((k, i) => {
        const label = `key ${i + 1} (${short(k.time)}s)`;
        if (type === "method") return methodKey(doc, label, k, check, isModern, warnings);
        if (k.value === undefined) throw fail(`${label} needs a value`);
        return valueText(doc, label, k.value, check);
      });
      const entries = [
        { key: '"times"', value: packed(keys.map((k) => k.time)) },
        { key: '"transitions"', value: packed(keys.map((k) => (k.transition === undefined ? 1 : positive(k.transition, "transition")))) },
      ];
      if (type === "value") {
        // Values Godot cannot blend (true/false, text, resources) step from key to key.
        const stepped = values.length > 0 && values.every((v) => /^(true|false|null|&?"|ExtResource\(|SubResource\()/.test(v));
        entries.push({ key: '"update"', value: String(enumIndex(args.update, UPDATE_MODES, "update", stepped ? 1 : 0)) });
      } else if (args.update !== undefined) throw fail(`update is for value tracks`);
      entries.push({ key: '"values"', value: `[${values.join(", ")}]` });
      const lines = [
        `tracks/${index}/type = "${type}"`,
        `tracks/${index}/imported = false`,
        `tracks/${index}/enabled = true`,
        `tracks/${index}/path = NodePath(${JSON.stringify(path)})`,
        `tracks/${index}/interp = ${enumIndex(args.interp, INTERPOLATIONS, "interp", 1)}`,
        `tracks/${index}/loop_wrap = ${args.loop_wrap === false ? "false" : "true"}`,
        ...`tracks/${index}/keys = ${formatDict(entries, isModern)}`.split("\n"),
      ];
      doc.splices.push({ start: contentEnd(doc.lines, block), count: 0, added: lines });
      const length = num(block.props["length"], 1);
      const last = keys.at(-1)?.time ?? 0;
      if (last > length + SAME_TIME) warnings.push(`the last key is at ${short(last)}s, after the animation's length of ${short(length)}s; set the length to play it`);
      summary = `add ${type} track ${index} (${path}, ${keys.length} key${keys.length === 1 ? "" : "s"}) to ${args.animation}`;
      break;
    }
    case "set_key":
    case "remove_key": {
      const block = animationBlock(at, args.animation);
      animation = args.animation;
      const index = trackIndex(block, args.track, args.animation);
      const type = block.props[`tracks/${index}/type`];
      const pathValue = block.props[`tracks/${index}/path`];
      const path = isCall(pathValue, "NodePath") && typeof pathValue.args[0] === "string" ? pathValue.args[0] : "";
      if (type !== "value" && type !== "method") throw fail(`track ${index} of ${args.animation} is a ${String(type)} track; only keys of value and method tracks can be changed here`);
      const keys = readKeys(doc, block, index);
      if (!keys) throw fail(`the keys of track ${index} of ${args.animation} could not be read`);
      const time = positive(args.time, "time");
      const found = keys.times.findIndex((t) => Math.abs(t - time) < SAME_TIME);
      if (args.op === "remove_key") {
        if (found < 0) {
          const near = [...keys.times].sort((a, b) => Math.abs(a - time) - Math.abs(b - time))[0];
          throw fail(`track ${index} (${path}) of ${args.animation} has no key at ${short(time)}s${near === undefined ? "; it has no keys" : `; the nearest is at ${short(near)}s (keys: ${keys.times.slice(0, 12).map(short).join(", ")})`}`);
        }
        for (const list of [keys.times, keys.transitions, keys.values]) list.splice(found, 1);
        summary = `remove the key at ${short(time)}s from track ${index} (${path}) of ${args.animation}`;
      } else {
        // The track is there already: a path that does not resolve is a warning, not a refusal.
        const check = checkPath(at, type, path, warnings);
        if (check.problem) warnings.push(`${check.problem}, so the value is not checked`);
        const label = `key (${short(time)}s)`;
        let value: string;
        if (type === "method") value = methodKey(doc, label, args, check.problem ? { enumValues: {} } : check, keys.multiline, warnings);
        else if (args.value === undefined) throw fail(`set_key needs a value`);
        else value = valueText(doc, label, args.value, check.problem ? { enumValues: {} } : check);
        const transition = args.transition === undefined ? undefined : positive(args.transition, "transition");
        if (found >= 0) {
          keys.values[found] = value;
          if (transition !== undefined) keys.transitions[found] = transition;
        } else {
          const at2 = keys.times.findIndex((t) => t > time);
          const where = at2 < 0 ? keys.times.length : at2;
          keys.times.splice(where, 0, time);
          keys.transitions.splice(where, 0, transition ?? 1);
          keys.values.splice(where, 0, value);
        }
        const length = num(block.props["length"], 1);
        if (time > length + SAME_TIME) warnings.push(`${short(time)}s is after the animation's length of ${short(length)}s; set the length to play it`);
        summary = `${found >= 0 ? "change" : "add"} the key at ${short(time)}s on track ${index} (${path}) of ${args.animation}`;
      }
      writeKeys(doc, block, index, keys);
      break;
    }
    case "remove_track": {
      const block = animationBlock(at, args.animation);
      animation = args.animation;
      const index = trackIndex(block, args.track, args.animation);
      const pathValue = block.props[`tracks/${index}/path`];
      for (const [key, line] of Object.entries(block.propLines)) {
        const m = /^tracks\/(\d+)\/(.*)$/.exec(key);
        if (!m) continue;
        const n = Number(m[1]);
        if (n === index) {
          const span = propSpan(doc.lines, block, key);
          if (span) doc.splices.push({ ...span, added: [] });
        } else if (n > index) {
          // The tracks after it move up one number.
          doc.splices.push({ start: line - 1, count: 1, added: [(doc.lines[line - 1] ?? "").replace(`tracks/${n}/`, `tracks/${n - 1}/`)] });
        }
      }
      summary = `remove track ${index} (${isCall(pathValue, "NodePath") ? String(pathValue.args[0]) : "?"}) from ${args.animation}`;
      break;
    }
    default:
      throw fail(`op is one of create, add_track, set_key, remove_key, remove_track, remove, set`);
  }
  return { ...finishPlan(doc, summary, "animation edit", options.write), animation };
}

export function formatAnimationPlan(plan: AnimationPlan): string {
  return formatTextPlan("animation", plan);
}
