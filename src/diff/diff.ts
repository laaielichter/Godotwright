import { existsSync, readFileSync } from "node:fs";
import { formatParams, formatSignature, outlineScript, type FunctionInfo, type ScriptOutline, type VariableInfo } from "../godot/gdscript.js";
import { parseProjectSettings } from "../godot/project-settings.js";
import { parseResourceFile } from "../godot/resource-file.js";
import { parseResourceText, refId, type ResourceFile, type SceneNode } from "../godot/scene.js";
import { parseShader } from "../godot/shader.js";
import { formatVariant, isCall, isObject, type Variant } from "../godot/variant.js";
import { findProjectRoot, fromResPath, realResPath } from "../project/files.js";
import { changedFiles, fileAt, GitError, type GitChange } from "../project/git.js";
import { loadProject, ProjectNotFoundError, type LoadOptions, type ProjectData } from "../scan/scan.js";
import { findUsages } from "../usages/usages.js";

/**
 * A diff an agent can read. A text diff of a .tscn is mostly noise (resource ids renumbered, sections moved,
 * load_steps) around the one line that matters, and a text diff of a script does not say who still calls the
 * function that went away. This compares what the files mean: nodes by their path, properties with the resources
 * they point at resolved, connections, the functions, signals and variables other files can use, settings, input
 * actions and shader uniforms; and for everything that was removed, whether something in the project still uses it.
 * No Godot needed; the earlier version comes from git (or from a second file).
 */

export type DiffKind = "scene" | "resource" | "script" | "settings" | "shader" | "import" | "other";

export interface FileDiff {
  file: string;
  status: GitChange["status"];
  from?: string;
  kind: DiffKind;
  /** What changed, one fact per line: "+" added, "-" removed, "~" changed, ">" moved or renamed. */
  changes: string[];
  /** What the change breaks elsewhere in the project. */
  problems: string[];
  /** The text differs but nothing a game can notice does. */
  noise?: boolean;
}

export interface DiffReport {
  ok: boolean;
  project: string;
  /** Removed names and files that were not searched for remaining uses (a very large change). */
  unchecked?: string[];
  /** What the files are compared with: a commit, or a file. */
  base: string;
  /** The other side: "the files on disk", or a commit. */
  to: string;
  files: FileDiff[];
  problems: number;
}

export interface DiffOptions extends LoadOptions {
  /** The commit to compare with (default HEAD). */
  ref?: string;
  /** A second commit, to compare two commits instead of a commit with the files on disk. */
  to?: string;
  /** Only these files or folders (res:// paths). */
  files?: string[];
  /** Compare the one file in `files` with this file instead of with git. */
  against?: string;
}

const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const kindOf = (file: string): DiffKind =>
  /\.tscn$/i.test(file) ? "scene" : /\.tres$/i.test(file) ? "resource" : /\.gd$/i.test(file) ? "script" : /(^|\/)project\.godot$/.test(file) ? "settings" : /\.gdshader(inc)?$/i.test(file) ? "shader" : /\.import$/i.test(file) ? "import" : "other";

/** One version of a .tscn or .tres with what its resource ids mean. */
interface Side {
  res: ResourceFile;
  ext: Map<string, string>;
  sub: Map<string, { type: string; props: Record<string, Variant> }>;
}

function side(text: string, uids: ReadonlyMap<string, string>): Side {
  const res = parseResourceText(text);
  return {
    res,
    // A uid wins over the path: a file that moved is still the same file.
    ext: new Map(res.extResources.map((e) => [e.id, (e.uid && uids.get(e.uid)) ?? e.path ?? e.uid ?? `?${e.id}`])),
    sub: new Map(res.subResources.map((s) => [s.id, { type: s.type, props: s.props }])),
  };
}

/** A value as text that is the same for the same meaning: resource ids are replaced by what they point at. */
function canon(value: Variant, s: Side, depth = 0): string {
  if (value === null || typeof value !== "object") return formatVariant(value);
  if (Array.isArray(value)) return `[${value.map((v) => canon(v, s, depth)).join(",")}]`;
  if (isCall(value, "ExtResource")) return `Ext(${s.ext.get(String(value.args[0])) ?? "?"})`;
  if (isCall(value, "SubResource")) {
    const sub = s.sub.get(String(value.args[0]));
    if (!sub || depth > 12) return "Sub(?)";
    const props = Object.keys(sub.props).sort().map((k) => `${k}=${canon(sub.props[k]!, s, depth + 1)}`);
    return `Sub(${sub.type}{${props.join(";")}})`;
  }
  if (isObject(value)) return `Object(${value.class}{${Object.keys(value.props).sort().map((k) => `${k}=${canon(value.props[k]!, s, depth)}`).join(";")}})`;
  if (isCall(value)) return `${value.$type}(${value.args.map((v) => canon(v, s, depth)).join(",")})`;
  return `{${Object.keys(value).sort().map((k) => `${k}:${canon((value as Record<string, Variant>)[k]!, s, depth)}`).join(",")}}`;
}

/** A value as an agent reads it: paths instead of ids, a sub-resource by its class. */
function show(value: Variant, s: Side): string {
  const walk = (v: Variant): string => {
    if (v === null || typeof v !== "object") return formatVariant(v);
    if (Array.isArray(v)) return `[${v.map(walk).join(", ")}]`;
    if (isCall(v, "ExtResource")) return s.ext.get(String(v.args[0])) ?? "a missing resource";
    if (isCall(v, "SubResource")) return `<${s.sub.get(String(v.args[0]))?.type ?? "missing sub-resource"}>`;
    if (isObject(v)) return `Object(${v.class})`;
    if (isCall(v)) return `${v.$type}(${v.args.map(walk).join(", ")})`;
    return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${walk(x)}`).join(", ")}}`;
  };
  return clip(walk(value));
}

/** The property changes between two versions; a changed sub-resource of the same class is opened up ("shape.radius"). */
function propChanges(a: Record<string, Variant>, sa: Side, b: Record<string, Variant>, sb: Side, prefix = "", depth = 0): string[] {
  const out: string[] = [];
  const keys = [...Object.keys(b), ...Object.keys(a).filter((k) => !(k in b))];
  for (const key of keys) {
    const name = `${prefix}${key}`;
    const before = a[key];
    const after = b[key];
    if (before === undefined && after !== undefined) out.push(`+ ${name} = ${show(after, sb)}`);
    else if (after === undefined && before !== undefined) out.push(`- ${name} (was ${show(before, sa)})`);
    else if (before !== undefined && after !== undefined && canon(before, sa) !== canon(after, sb)) {
      const subA = isCall(before, "SubResource") ? sa.sub.get(String(before.args[0])) : undefined;
      const subB = isCall(after, "SubResource") ? sb.sub.get(String(after.args[0])) : undefined;
      if (subA && subB && subA.type === subB.type && depth < 4) out.push(...propChanges(subA.props, sa, subB.props, sb, `${name}.`, depth + 1));
      else out.push(`~ ${name}: ${show(before, sa)} -> ${show(after, sb)}`);
    }
  }
  return out;
}

const label = (n: SceneNode, s: Side) => `${n.path === "." ? n.name : n.path} (${n.type ?? (n.instanceRef ? `instance of ${s.ext.get(n.instanceRef) ?? "a missing scene"}` : "inherited")})`;
const parentOf = (path: string) => (path === "." ? undefined : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");

function nodeChanges(a: SceneNode, sa: Side, b: SceneNode, sb: Side): string[] {
  const out: string[] = [];
  if (a.type !== b.type) out.push(`~ type: ${a.type ?? "(inherited)"} -> ${b.type ?? "(inherited)"}`);
  const instA = a.instanceRef ? sa.ext.get(a.instanceRef) : undefined;
  const instB = b.instanceRef ? sb.ext.get(b.instanceRef) : undefined;
  if (instA !== instB) out.push(`~ instance: ${instA ?? "none"} -> ${instB ?? "none"}`);
  for (const g of b.groups) if (!a.groups.includes(g)) out.push(`+ group ${g}`);
  for (const g of a.groups) if (!b.groups.includes(g)) out.push(`- group ${g}`);
  out.push(...propChanges(a.props, sa, b.props, sb));
  return out;
}

/** What changed between two versions of a scene or resource file, by meaning. */
export function diffResourceText(before: string, after: string, uids: ReadonlyMap<string, string> = new Map()): { changes: string[]; noise: boolean } {
  const sa = side(before, uids);
  const sb = side(after, uids);
  const changes: string[] = [];
  if (sa.res.resourceType !== sb.res.resourceType) changes.push(`~ resource class: ${sa.res.resourceType ?? "?"} -> ${sb.res.resourceType ?? "?"}`);
  if (sa.res.uid && sb.res.uid && sa.res.uid !== sb.res.uid) changes.push(`~ uid: ${sa.res.uid} -> ${sb.res.uid} (files that name the old uid no longer find it)`);
  if (sa.res.resource || sb.res.resource) changes.push(...propChanges(sa.res.resource?.props ?? {}, sa, sb.res.resource?.props ?? {}, sb));

  const oldNodes = new Map(sa.res.nodes.map((n) => [n.path, n]));
  const newNodes = new Map(sb.res.nodes.map((n) => [n.path, n]));
  const rootA = oldNodes.get(".");
  const rootB = newNodes.get(".");
  if (rootA && rootB && rootA.name !== rootB.name) changes.push(`> root renamed: ${rootA.name} -> ${rootB.name}`);

  // Nodes that are gone from their path and nodes at a new path: the same node moved or renamed, when it matches.
  const removed = sa.res.nodes.filter((n) => !newNodes.has(n.path));
  const added = new Set(sb.res.nodes.filter((n) => !oldNodes.has(n.path)).map((n) => n.path));
  const moved = new Map<string, string>();
  const sameKind = (x: SceneNode, y: SceneNode) => x.type === y.type && (x.instanceRef ? sa.ext.get(x.instanceRef) : undefined) === (y.instanceRef ? sb.ext.get(y.instanceRef) : undefined);
  const propsKey = (n: SceneNode, s: Side) => Object.keys(n.props).sort().map((k) => `${k}=${canon(n.props[k]!, s)}`).join(";");
  for (const r of [...removed].sort((x, y) => x.path.split("/").length - y.path.split("/").length)) {
    if (moved.has(r.path)) continue;
    const tops = [...added].map((p) => newNodes.get(p)!).filter((n) => ![...moved.values()].includes(n.path));
    const target = tops.find((n) => n.name === r.name && sameKind(r, n)) ?? tops.find((n) => parentOf(n.path) === (moved.get(parentOf(r.path) ?? "") ?? parentOf(r.path)) && sameKind(r, n) && propsKey(r, sa) === propsKey(n, sb));
    if (!target) continue;
    moved.set(r.path, target.path);
    changes.push(target.name === r.name ? `> node ${r.name} moved: ${r.path} -> ${target.path}` : `> node renamed: ${r.path} -> ${target.path}`);
    for (const child of removed) {
      if (!child.path.startsWith(`${r.path}/`)) continue;
      const to = `${target.path}${child.path.slice(r.path.length)}`;
      if (added.has(to)) moved.set(child.path, to);
    }
  }
  for (const to of moved.values()) added.delete(to);

  for (const n of sb.res.nodes) {
    if (added.has(n.path)) {
      // The children of an added node come with it: one line for the subtree.
      if (added.has(parentOf(n.path) ?? "")) continue;
      const below = [...added].filter((p) => p.startsWith(`${n.path}/`)).length;
      changes.push(`+ node ${label(n, sb)}${below ? ` with ${below} node${below === 1 ? "" : "s"} below it` : ""}`);
      continue;
    }
    const old = oldNodes.get(n.path) ?? sa.res.nodes.find((o) => moved.get(o.path) === n.path);
    if (!old) continue;
    const list = nodeChanges(old, sa, n, sb);
    if (list.length === 1) changes.push(`~ node ${label(n, sb)}: ${list[0]!.replace(/^~ /, "")}`);
    else if (list.length) changes.push(`~ node ${label(n, sb)}`, ...list.map((l) => `    ${l}`));
  }
  const gone = removed.filter((n) => !moved.has(n.path));
  const goneSet = new Set(gone.map((n) => n.path));
  for (const n of gone) {
    if (goneSet.has(parentOf(n.path) ?? "")) continue;
    const below = gone.filter((o) => o.path.startsWith(`${n.path}/`)).length;
    changes.push(`- node ${label(n, sa)}${below ? ` with ${below} node${below === 1 ? "" : "s"} below it` : ""}`);
  }

  // The order of children is the draw order in 2D and the order of _ready.
  const kids = (s: Side, map: (p: string) => string, keep: (p: string) => boolean) => {
    const by = new Map<string, string[]>();
    for (const n of s.res.nodes) {
      const path = map(n.path);
      const parent = parentOf(path);
      if (parent === undefined || !keep(path)) continue;
      by.set(parent, [...(by.get(parent) ?? []), path.slice(path.lastIndexOf("/") + 1)]);
    }
    return by;
  };
  const kidsA = kids(sa, (p) => moved.get(p) ?? p, (p) => newNodes.has(p));
  const kidsB = kids(sb, (p) => p, (p) => !added.has(p));
  for (const [parent, order] of kidsB) {
    const was = (kidsA.get(parent) ?? []).filter((k) => order.includes(k));
    const now = order.filter((k) => was.includes(k));
    if (was.join("/") !== now.join("/")) changes.push(`~ children of ${parent} reordered: ${clip(was.join(", "), 50)} -> ${clip(now.join(", "), 50)}`);
  }

  const at = (p: string) => moved.get(p) ?? p;
  const node = (p: string) => (p === "." ? "(root)" : p);
  const conn = (c: ResourceFile["connections"][number], map: (p: string) => string) =>
    `${node(map(c.from))}.${c.signal} -> ${node(map(c.to))}.${c.method}()${c.binds ? ` +${c.binds} bound` : ""}${c.unbinds ? ` -${c.unbinds} unbound` : ""}`;
  const connA = new Set(sa.res.connections.map((c) => conn(c, at)));
  const connB = new Set(sb.res.connections.map((c) => conn(c, (p) => p)));
  for (const c of connB) if (!connA.has(c)) changes.push(`+ connection ${c}`);
  for (const c of connA) if (!connB.has(c)) changes.push(`- connection ${c}`);

  const editA = new Set(sa.res.editable.map((e) => at(e.path)));
  const editB = new Set(sb.res.editable.map((e) => e.path));
  for (const e of editB) if (!editA.has(e)) changes.push(`+ editable children of ${e}`);
  for (const e of editA) if (!editB.has(e)) changes.push(`- editable children of ${e}`);

  const loadsA = new Set(sa.ext.values());
  const loadsB = new Set(sb.ext.values());
  const newLoads = [...loadsB].filter((p) => !loadsA.has(p));
  const oldLoads = [...loadsA].filter((p) => !loadsB.has(p));
  if (newLoads.length) changes.push(`+ loads ${clip(newLoads.join(", "), 160)}`);
  if (oldLoads.length) changes.push(`- no longer loads ${clip(oldLoads.join(", "), 160)}`);
  return { changes, noise: changes.length === 0 && before !== after };
}

// ----- scripts -----

const exported = (v: VariableInfo) => (v.exportAnnotation ? `${v.exportAnnotation} ` : "");
const varText = (v: VariableInfo) => `${exported(v)}${v.static ? "static " : ""}var ${v.name}${v.type ? `: ${v.type}` : ""}`;
const fnText = (f: FunctionInfo) => formatSignature(f).replace(/^(static )?/, "$1func ");
/** How many arguments a call may pass: the least and the most. */
const arity = (f: FunctionInfo): [number, number] => [f.params.filter((p) => !p.hasDefault).length, f.params.length];

export interface ScriptDiff {
  changes: string[];
  removed: { kind: "func" | "signal" | "var" | "const" | "class_name" | "enum"; name: string; exported?: boolean }[];
  /** Functions that still exist but take a different number of arguments. */
  arity: { name: string; was: string; now: string }[];
}

/** What changed in what other files can use of a script: its class, functions, signals, variables, constants. */
export function diffScriptText(before: string, after: string): ScriptDiff {
  const a = outlineScript(before);
  const b = outlineScript(after);
  const out: ScriptDiff = { changes: [], removed: [], arity: [] };
  const push = (line: string) => out.changes.push(line);
  if (a.className !== b.className) {
    push(`~ class_name: ${a.className ?? "(none)"} -> ${b.className ?? "(none)"}`);
    if (a.className) out.removed.push({ kind: "class_name", name: a.className });
  }
  if (a.extends !== b.extends) push(`~ extends: ${a.extends ?? "(RefCounted)"} -> ${b.extends ?? "(RefCounted)"}`);
  if (a.tool !== b.tool) push(b.tool ? "+ @tool" : "- @tool");

  const byName = <T extends { name: string }>(list: T[]) => new Map(list.map((x) => [x.name, x]));
  const funcsA = byName(a.functions);
  const funcsB = byName(b.functions);
  // The code of a function without its comments and blank lines.
  const body = (o: ScriptOutline, f: FunctionInfo) => o.logicalLines.filter((l) => l.line > f.line && l.line <= f.endLine).map((l) => `${l.indent}:${l.text.trim()}`).join("\n");
  const bodies: string[] = [];
  for (const f of b.functions) {
    const old = funcsA.get(f.name);
    if (!old) push(`+ ${fnText(f)}`);
    else if (formatSignature(old) !== formatSignature(f)) {
      push(`~ ${fnText(f)}  (was ${f.name}(${formatParams(old.params)})${old.returnType ? ` -> ${old.returnType}` : ""})`);
      const [min, max] = arity(f);
      const [oldMin, oldMax] = arity(old);
      if (min > oldMin || max < oldMax) out.arity.push({ name: f.name, was: oldMin === oldMax ? String(oldMax) : `${oldMin} to ${oldMax}`, now: min === max ? String(max) : `${min} to ${max}` });
    } else if (body(a, old) !== body(b, f)) bodies.push(f.name);
  }
  for (const f of a.functions) {
    if (funcsB.has(f.name)) continue;
    push(`- ${fnText(f)}`);
    out.removed.push({ kind: "func", name: f.name });
  }
  const sigA = byName(a.signals);
  const sigB = byName(b.signals);
  const sig = (s: { name: string; params: FunctionInfo["params"] }) => `signal ${s.name}${s.params.length ? `(${formatParams(s.params)})` : ""}`;
  for (const s of b.signals) {
    const old = sigA.get(s.name);
    if (!old) push(`+ ${sig(s)}`);
    else if (sig(old) !== sig(s)) push(`~ ${sig(s)}  (was ${sig(old)})`);
  }
  for (const s of a.signals) {
    if (sigB.has(s.name)) continue;
    push(`- ${sig(s)}`);
    out.removed.push({ kind: "signal", name: s.name });
  }
  const varA = byName(a.variables);
  const varB = byName(b.variables);
  for (const v of b.variables) {
    const old = varA.get(v.name);
    if (!old) push(`+ ${varText(v)}`);
    else if (varText(old) !== varText(v)) {
      push(`~ ${varText(v)}  (was ${varText(old)})`);
      // A value saved for an export that is gone, or of another type, is dropped when the scene loads.
      if (old.exportAnnotation && (!v.exportAnnotation || (old.type && v.type && old.type !== v.type))) out.removed.push({ kind: "var", name: v.name, exported: true });
    }
  }
  for (const v of a.variables) {
    if (varB.has(v.name)) continue;
    push(`- ${varText(v)}`);
    out.removed.push({ kind: "var", name: v.name, ...(v.exportAnnotation ? { exported: true } : {}) });
  }
  const constA = byName(a.constants);
  const constB = byName(b.constants);
  for (const c of b.constants) if (!constA.has(c.name)) push(`+ const ${c.name}`);
  for (const c of a.constants) {
    if (constB.has(c.name)) continue;
    push(`- const ${c.name}`);
    out.removed.push({ kind: "const", name: c.name });
  }
  const enumsB = new Map(b.enums.filter((e) => e.name).map((e) => [e.name!, e]));
  for (const e of a.enums) {
    if (!e.name) continue;
    const now = enumsB.get(e.name);
    if (!now) {
      push(`- enum ${e.name}`);
      out.removed.push({ kind: "enum", name: e.name });
      continue;
    }
    const lost = e.values.filter((v) => !now.values.includes(v));
    const gained = now.values.filter((v) => !e.values.includes(v));
    if (lost.length || gained.length) push(`~ enum ${e.name}:${gained.length ? ` + ${gained.join(", ")}` : ""}${lost.length ? ` - ${lost.join(", ")}` : ""}`);
    else if (e.values.join(",") !== now.values.join(",")) push(`~ enum ${e.name}: values reordered (their numbers changed; saved values now mean something else)`);
  }
  for (const e of b.enums) if (e.name && !a.enums.some((o) => o.name === e.name)) push(`+ enum ${e.name}`);
  const innerA = new Set(a.innerClasses.map((c) => c.name));
  const innerB = new Set(b.innerClasses.map((c) => c.name));
  for (const c of innerB) if (!innerA.has(c)) push(`+ class ${c}`);
  for (const c of innerA) if (!innerB.has(c)) push(`- class ${c}`);
  if (bodies.length) push(`~ code changed in ${clip(bodies.join(", "), 160)}`);
  else if (out.changes.length === 0 && before !== after) {
    const code = (o: ScriptOutline) => o.logicalLines.map((l) => l.text.trim()).join("\n");
    if (code(a) !== code(b)) push("~ code changed outside functions");
  }
  return out;
}

// ----- what a change breaks -----

interface Context {
  root: string;
  data: ProjectData;
  options: LoadOptions;
  /** Searches of the whole project left for this diff: a huge change must not take minutes. */
  searches: { left: number; skipped: string[] };
}

/** Every use of a name or path in the project, or undefined when this diff has searched enough. */
function uses(ctx: Context, name: string): ReturnType<typeof findUsages>["usages"] | undefined {
  if (ctx.searches.left <= 0) {
    ctx.searches.skipped.push(name);
    return undefined;
  }
  ctx.searches.left--;
  return findUsages(ctx.root, name, ctx.options).usages;
}

const places = (list: string[], n = 4) => `${list.slice(0, n).join(", ")}${list.length > n ? ` (+${list.length - n} more)` : ""}`;

/** The script on a node of a scene, also when the node is an instance of a scene whose root carries it. */
function scriptOn(data: ProjectData, res: ResourceFile, node: SceneNode, depth = 0): string | undefined {
  const pathOf = (id: string | undefined) => {
    const ext = res.extResources.find((e) => e.id === id);
    return ext ? ((ext.uid && data.uids.get(ext.uid)) ?? ext.path) : undefined;
  };
  if (node.scriptRef) return pathOf(node.scriptRef);
  const scene = node.instanceRef ? pathOf(node.instanceRef) : undefined;
  const inner = scene ? data.resources.get(scene) : undefined;
  const root = inner?.nodes.find((n) => n.path === ".");
  return inner && root && depth < 8 ? scriptOn(data, inner, root, depth + 1) : undefined;
}

/** Uses of a name in code and strings, outside the line that defines it; engine callbacks are never called by name. */
function codeUses(ctx: Context, name: string, kinds = ["reference", "string"]): string[] {
  return (uses(ctx, name) ?? []).filter((u) => kinds.includes(u.kind)).map((u) => `${u.file}:${u.line}`);
}

function scriptProblems(ctx: Context, file: string, d: ScriptDiff): string[] {
  const out: string[] = [];
  const scenes = [...ctx.data.resources].filter(([f]) => !ctx.data.external.has(f));
  for (const r of d.removed) {
    if (r.kind === "func" || r.kind === "signal") {
      const wired: string[] = [];
      for (const [scene, res] of scenes) {
        for (const c of res.connections) {
          const end = r.kind === "func" ? c.to : c.from;
          if ((r.kind === "func" ? c.method : c.signal) !== r.name) continue;
          const node = res.nodes.find((n) => n.path === end);
          if (node && scriptOn(ctx.data, res, node) === file) wired.push(`${scene}:${c.line}`);
        }
      }
      if (wired.length) out.push(`${r.kind} ${r.name} is gone, but a scene connection still names it: ${places(wired)} (Godot reports an error when that scene loads)`);
    }
    if (r.kind === "var" && r.exported) {
      const set: string[] = [];
      for (const [scene, res] of scenes) {
        for (const n of res.nodes) if (r.name in n.props && scriptOn(ctx.data, res, n) === file) set.push(`${scene}:${n.line}`);
        const own = res.extResources.find((e) => e.id === res.scriptRef);
        if (res.resource && r.name in res.resource.props && own && ((own.uid && ctx.data.uids.get(own.uid)) ?? own.path) === file) set.push(`${scene}:${res.resource.propLines[r.name] ?? 1}`);
      }
      if (set.length) out.push(`@export ${r.name} is gone or changed type, but its value is still saved in ${places(set)} (Godot drops or converts that value without an error)`);
    }
    // Names that start with "_" are private or engine callbacks; what is wired in a scene is covered above.
    if (r.name.startsWith("_")) continue;
    const uses = codeUses(ctx, r.name);
    // The same name defined in another script makes a use by name uncertain.
    const elsewhere = [...ctx.data.scripts].some(([f, o]) => f !== file && [...o.functions, ...o.signals, ...o.variables, ...o.constants].some((m) => m.name === r.name));
    if (uses.length) out.push(`${r.kind} ${r.name} is gone, but the name is still used in ${places(uses)}${elsewhere ? " (another script defines the same name: check which one each use means)" : ""}`);
  }
  for (const f of d.arity) {
    if (f.name.startsWith("_")) continue;
    const uses = codeUses(ctx, f.name, ["reference"]);
    if (uses.length) out.push(`${f.name}() took ${f.was} argument${f.was === "1" ? "" : "s"} and now takes ${f.now}: check the calls in ${places(uses)}`);
  }
  return out;
}

function settingsDiff(before: string, after: string, ctx?: Context): { changes: string[]; problems: string[] } {
  const a = parseProjectSettings(before);
  const b = parseProjectSettings(after);
  const changes: string[] = [];
  const problems: string[] = [];
  const events = (s: typeof a, name: string) => s.inputActions.find((x) => x.name === name)?.events.join(", ") || "no events";
  const say = (key: string, value: Variant | undefined, s: typeof a) =>
    key.startsWith("input/") ? `input action ${key.slice(6)}: ${events(s, key.slice(6))}` : key.startsWith("autoload/") ? `autoload ${key.slice(9)} = ${typeof value === "string" ? value.replace(/^\*/, "") : ""}` : `${key} = ${clip(formatVariant(value ?? null))}`;
  for (const key of Object.keys(b.values)) {
    const now = b.values[key]!;
    const was = a.values[key];
    if (was === undefined) changes.push(`+ ${say(key, now, b)}`);
    else if (formatVariant(was) !== formatVariant(now)) {
      if (key.startsWith("input/")) changes.push(`~ input action ${key.slice(6)}: ${events(a, key.slice(6))} -> ${events(b, key.slice(6))}`);
      else changes.push(`~ ${key.startsWith("autoload/") ? `autoload ${key.slice(9)}` : key}: ${clip(formatVariant(was), 50)} -> ${clip(formatVariant(now), 50)}`);
    }
  }
  for (const key of Object.keys(a.values)) {
    if (key in b.values) continue;
    changes.push(`- ${say(key, a.values[key], a)}`);
    if (!ctx) continue;
    if (key.startsWith("input/")) {
      const uses = codeUses(ctx, key.slice(6), ["string"]);
      if (uses.length) problems.push(`input action ${key.slice(6)} is gone, but code still asks for it in ${places(uses)}`);
    } else if (key.startsWith("autoload/")) {
      const uses = codeUses(ctx, key.slice(9), ["reference"]);
      if (uses.length) problems.push(`autoload ${key.slice(9)} is gone, but code still uses it in ${places(uses)}`);
    }
  }
  return { changes, problems };
}

function shaderDiff(file: string, before: string, after: string, ctx?: Context): { changes: string[]; problems: string[] } {
  const a = parseShader(before);
  const b = parseShader(after);
  const changes: string[] = [];
  const problems: string[] = [];
  const typeA = /^\s*shader_type\s+(\w+)/m.exec(before)?.[1];
  const typeB = /^\s*shader_type\s+(\w+)/m.exec(after)?.[1];
  if (typeA !== typeB) changes.push(`~ shader_type: ${typeA ?? "?"} -> ${typeB ?? "?"}`);
  const was = new Map(a.uniforms.map((u) => [u.name, u]));
  const now = new Map(b.uniforms.map((u) => [u.name, u]));
  const gone: string[] = [];
  for (const u of b.uniforms) {
    const old = was.get(u.name);
    if (!old) changes.push(`+ uniform ${u.type} ${u.name}`);
    else if (old.type !== u.type) {
      changes.push(`~ uniform ${u.name}: ${old.type} -> ${u.type}`);
      gone.push(u.name);
    }
  }
  for (const u of a.uniforms) {
    if (now.has(u.name)) continue;
    changes.push(`- uniform ${u.type} ${u.name}`);
    gone.push(u.name);
  }
  const fnA = new Set(a.functions.map((f) => f.name));
  const fnB = new Set(b.functions.map((f) => f.name));
  for (const f of fnB) if (!fnA.has(f)) changes.push(`+ function ${f}`);
  for (const f of fnA) if (!fnB.has(f)) changes.push(`- function ${f}`);
  if (!changes.length && before !== after) changes.push("~ code changed (same uniforms and functions)");
  if (ctx) {
    for (const name of gone) {
      const set: string[] = [];
      for (const [scene, res] of ctx.data.resources) {
        if (ctx.data.external.has(scene)) continue;
        const shaderIs = (props: Record<string, Variant>) => {
          const ext = res.extResources.find((e) => e.id === refId(props["shader"]));
          return ext !== undefined && ((ext.uid && ctx.data.uids.get(ext.uid)) ?? ext.path) === file;
        };
        const key = `shader_parameter/${name}`;
        for (const sub of res.subResources) if (key in sub.props && shaderIs(sub.props)) set.push(`${scene}:${sub.propLines[key] ?? sub.line}`);
        if (res.resource && key in res.resource.props && shaderIs(res.resource.props)) set.push(`${scene}:${res.resource.propLines[key] ?? 1}`);
      }
      if (set.length) problems.push(`uniform ${name} is gone or changed type, but a material still sets it in ${places(set)} (the value is ignored without an error)`);
    }
  }
  return { changes, problems };
}

function importDiff(before: string, after: string): string[] {
  const params = (text: string) => {
    const out: Record<string, Variant> = {};
    for (const s of parseResourceFile(text)) if (s.tag === "params" || s.tag === "remap") for (const [k, v] of Object.entries(s.props)) if (k !== "path" && !k.startsWith("path.")) out[k] = v;
    return out;
  };
  const a = params(before);
  const b = params(after);
  const out: string[] = [];
  for (const k of Object.keys(b)) {
    if (!(k in a)) out.push(`+ ${k} = ${clip(formatVariant(b[k]!))}`);
    else if (formatVariant(a[k]!) !== formatVariant(b[k]!)) out.push(`~ ${k}: ${clip(formatVariant(a[k]!), 40)} -> ${clip(formatVariant(b[k]!), 40)}`);
  }
  for (const k of Object.keys(a)) if (!(k in b)) out.push(`- ${k}`);
  return out;
}

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** A line that says what a new file is. */
function describeNew(kind: DiffKind, text: string): string[] {
  try {
    if (kind === "scene") {
      const res = parseResourceText(text);
      const root = res.nodes.find((n) => n.path === ".");
      return [`+ new scene: root ${root?.name ?? "?"} (${root?.type ?? "instance"}), ${res.nodes.length} node${res.nodes.length === 1 ? "" : "s"}, ${res.connections.length} connection${res.connections.length === 1 ? "" : "s"}`];
    }
    if (kind === "resource") return [`+ new resource: ${parseResourceText(text).resourceType ?? "?"}`];
    if (kind === "script") {
      const o = outlineScript(text);
      return [`+ new script: ${o.className ? `class_name ${o.className}, ` : ""}extends ${o.extends ?? "RefCounted"}, ${o.functions.length} function${o.functions.length === 1 ? "" : "s"}${o.signals.length ? `, signals ${o.signals.map((s) => s.name).join(", ")}` : ""}`];
    }
    if (kind === "shader") return [`+ new shader: ${/^\s*shader_type\s+(\w+)/m.exec(text)?.[1] ?? "include"}, ${parseShader(text).uniforms.length} uniforms`];
  } catch {
    // A new file that cannot be parsed is still a new file.
  }
  return ["+ new file"];
}

/** Compares two versions of one file. `before` or `after` undefined means the file did not exist on that side. */
export function diffFile(change: GitChange, before: Buffer | undefined, after: Buffer | undefined, ctx?: Context): FileDiff {
  const kind = kindOf(change.file);
  const out: FileDiff = { file: change.file, status: change.status, ...(change.from ? { from: change.from } : {}), kind, changes: [], problems: [] };
  const textual = kind !== "other";
  if (after === undefined) {
    out.changes.push("- file deleted");
    if (ctx && !/\.(uid|import)$/i.test(change.file)) {
      const named = (uses(ctx, change.file) ?? []).map((u) => `${u.file}:${u.line}`);
      if (named.length) out.problems.push(`the file is gone, but it is still named in ${places(named)}`);
    }
    return out;
  }
  if (before === undefined) {
    out.changes.push(...(textual ? describeNew(kind, after.toString("utf8")) : [`+ new file (${size(after.length)})`]));
    return out;
  }
  if (change.from) out.changes.push(`> moved from ${change.from}`);
  if (before.equals(after)) return out;
  if (!textual) {
    out.changes.push(`~ contents changed (${size(before.length)} -> ${size(after.length)})`);
    return out;
  }
  const a = before.toString("utf8").replace(/\r\n/g, "\n");
  const b = after.toString("utf8").replace(/\r\n/g, "\n");
  try {
    if (kind === "scene" || kind === "resource") {
      const d = diffResourceText(a, b, ctx?.data.uids);
      out.changes.push(...d.changes);
      if (d.noise) out.noise = true;
    } else if (kind === "script") {
      const d = diffScriptText(a, b);
      out.changes.push(...d.changes);
      if (ctx) out.problems.push(...scriptProblems(ctx, change.file, d));
      if (!d.changes.length && a !== b) out.noise = true;
    } else if (kind === "settings") {
      const d = settingsDiff(a, b, ctx);
      out.changes.push(...d.changes);
      out.problems.push(...d.problems);
      if (!d.changes.length) out.noise = true;
    } else if (kind === "shader") {
      const d = shaderDiff(change.file, a, b, ctx);
      out.changes.push(...d.changes);
      out.problems.push(...d.problems);
    } else {
      out.changes.push(...importDiff(a, b));
      if (out.changes.length === (change.from ? 1 : 0)) out.noise = true;
    }
  } catch (error) {
    out.changes.push(`~ changed, but one version cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return out;
}

const toRes = (file: string) => (file.startsWith("res://") ? file : `res://${file.replace(/^(\.\/|\/)+/, "")}`);

/** The semantic diff of a project against a commit (default HEAD), or of one file against another file. */
export function diffProject(path: string, options: DiffOptions = {}): DiffReport {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const load: LoadOptions = { base: options.base, baseFiles: options.baseFiles };
  const ctx: Context = { root, data: loadProject(root, load), options: load, searches: { left: 40, skipped: [] } };
  const only = (options.files ?? []).map(toRes);

  if (options.against !== undefined) {
    if (only.length !== 1) throw new GitError("against compares one file with another: pass exactly one file");
    const read = (file: string) => {
      // Only files of the project are read.
      const real = realResPath(root, toRes(file));
      if (!real || !existsSync(fromResPath(root, real))) throw new GitError(`${toRes(file)} is not a file in the project`);
      return readFileSync(fromResPath(root, real));
    };
    // `against` is the earlier version; the problems are judged for the file itself.
    const d = diffFile({ file: only[0]!, status: "modified" }, read(options.against), read(only[0]!), ctx);
    return { ok: d.problems.length === 0, project: root, base: toRes(options.against), to: only[0]!, files: [d], problems: d.problems.length };
  }

  const ref = options.ref ?? "HEAD";
  const wanted = (file: string) => only.length === 0 || only.some((o) => file === o || file.startsWith(o.endsWith("/") ? o : `${o}/`));
  const files: FileDiff[] = [];
  for (const change of changedFiles(root, ref, options.to)) {
    if (!wanted(change.file) || /\.uid$/i.test(change.file)) continue;
    const before = change.status === "added" ? undefined : fileAt(root, ref, change.from ?? change.file);
    let after: Buffer | undefined;
    if (change.status !== "deleted") {
      if (options.to) after = fileAt(root, options.to, change.file);
      else {
        try {
          after = readFileSync(fromResPath(root, change.file));
        } catch {
          after = undefined;
        }
      }
    }
    if (before === undefined && after === undefined) continue;
    // What a change breaks is judged against the files on disk, so it is only known when they are one side.
    files.push(diffFile(change, before, after, options.to ? undefined : ctx));
  }
  const problems = files.reduce((n, f) => n + f.problems.length, 0);
  return { ok: problems === 0, project: root, base: ref, to: options.to ?? "the files on disk", files, problems, ...(ctx.searches.skipped.length ? { unchecked: ctx.searches.skipped } : {}) };
}

/** The diff as compact text: one block per file, problems marked "!", files with nothing to notice as one line. */
export function formatDiff(report: DiffReport, limit = 40): string {
  const out: string[] = [];
  const real = report.files.filter((f) => !f.noise && f.changes.length + f.problems.length > 0);
  const noise = report.files.filter((f) => f.noise);
  if (report.files.length === 0) return `diff: nothing changed against ${report.base}\n`;
  const count = (kind: DiffKind, word: string) => {
    const n = report.files.filter((f) => f.kind === kind).length;
    return n ? `${n} ${word}${n === 1 ? "" : "s"}` : "";
  };
  const kinds = [count("scene", "scene"), count("resource", "resource"), count("script", "script"), count("shader", "shader"), count("settings", "project file"), count("import", "import file"), count("other", "other file")].filter(Boolean);
  out.push(`diff: ${report.files.length} file${report.files.length === 1 ? "" : "s"} changed, ${report.to} against ${report.base} (${kinds.join(", ")})${report.problems ? `; ${report.problems} problem${report.problems === 1 ? "" : "s"}` : ""}`);
  // Files with problems first, then the rest in path order.
  for (const f of [...real].sort((a, b) => Number(b.problems.length > 0) - Number(a.problems.length > 0))) {
    out.push(f.file);
    for (const p of f.problems) out.push(`  ! ${p}`);
    for (const c of f.changes.slice(0, limit)) out.push(`  ${c}`);
    if (f.changes.length > limit) out.push(`  ... ${f.changes.length - limit} more changes (files: ["${f.file}"] with detail full shows them)`);
  }
  if (noise.length) out.push(`no change a game can notice (ids, order or formatting only): ${places(noise.map((f) => f.file), 8)}`);
  const quiet = report.files.filter((f) => !f.noise && f.changes.length + f.problems.length === 0);
  if (quiet.length) out.push(`unchanged contents: ${places(quiet.map((f) => f.file), 8)}`);
  if (report.unchecked?.length) out.push(`not searched for remaining uses (a very large change): ${places(report.unchecked, 6)}; check those with godot_usages, or run this on fewer files`);
  if (report.problems) out.push("Next: fix every line marked ! (godot_usages shows each place; godot_rename renames everywhere at once), then run this again.");
  else out.push("Next: check that every change above is one you meant; godot_impact says which scenes and tests these files reach.");
  return `${out.join("\n")}\n`;
}
