import { parseResourceFile, type Section } from "../godot/resource-file.js";
import { formatVariant, type Variant } from "../godot/variant.js";

/**
 * A three-way merge of .tscn, .tres and project.godot by meaning. Git merges these files line by line, and two
 * people (or two agents in two worktrees) who each add a node to the same scene get a conflict, or worse, a clean
 * merge of a file Godot cannot load: both sides gave their new resource the id "3", `load_steps` no longer adds up,
 * a node sits under a parent the other side removed. This merges what the files mean: sections by what they are
 * (a node by its path, an ext_resource by its uid or path, a connection by signal, source, target and method),
 * properties one by one, and resource ids brought into one numbering first. What both sides changed in a different
 * way is a conflict with all three values; everything else merges. No Godot needed.
 */

export type MergeKind = "scene" | "resource" | "settings";

export interface MergeConflict {
  /** The section, as a person names it: `node Player/Sprite`, `sub_resource RectangleShape2D_ab1`, `[physics]`. */
  where: string;
  /** The property, or what happened to the whole section. */
  what: string;
  base?: string;
  ours?: string;
  theirs?: string;
  /** What the merged text holds for it. */
  taken: "ours" | "theirs";
}

export interface MergeResult {
  text: string;
  kind: MergeKind;
  conflicts: MergeConflict[];
  /** What came in from the other side, one fact per line ("+" added, "-" removed, "~" changed). */
  applied: string[];
  /** What the merge did to keep the file loadable (an id renumbered, a resource kept because it is still used). */
  repaired: string[];
  /** One side had not changed: its text is the other side's, byte for byte. */
  trivial?: "ours" | "theirs" | "same";
}

export interface MergeOptions {
  /** Which side a conflict takes (default ours). The conflict is reported either way. */
  prefer?: "ours" | "theirs";
}

interface Raw {
  tag: string;
  attrs: Record<string, Variant>;
  header: string;
  /** Property name -> its lines as written (`key = value`, a value can run over lines). */
  props: Map<string, string>;
  key: string;
}

interface Doc {
  preamble: string;
  sections: Raw[];
}

const GROUPS = ["gd_scene", "gd_resource", "ext_resource", "sub_resource", "resource", "node", "connection", "editable"];
const TIGHT = new Set(["ext_resource", "connection", "editable"]);

const str = (v: Variant | undefined): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

function keyOf(tag: string, attrs: Record<string, Variant>, seen: Map<string, number>): string {
  let key: string;
  if (tag === "ext_resource" || tag === "sub_resource") key = `${tag} ${str(attrs["id"]) ?? "?"}`;
  else if (tag === "node") {
    const parent = str(attrs["parent"]);
    const name = str(attrs["name"]) ?? "?";
    key = `node ${parent === undefined ? "." : parent === "." ? name : `${parent}/${name}`}`;
  } else if (tag === "connection") key = `connection ${str(attrs["signal"])} ${str(attrs["from"])} -> ${str(attrs["to"])}.${str(attrs["method"])}`;
  else if (tag === "editable") key = `editable ${str(attrs["path"])}`;
  else key = tag === "" ? "(top)" : `[${tag}]`;
  // Two sections with the same identity (a file that is already broken) stay apart.
  const n = (seen.get(key) ?? 0) + 1;
  seen.set(key, n);
  return n === 1 ? key : `${key} #${n}`;
}

const trimEnd = (lines: string[]): string[] => {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === "") end--;
  return lines.slice(0, end);
};

/** Splits a file into its sections with the text of every header and property as written. */
function split(text: string): Doc {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = clean.split("\n");
  const sections: Section[] = parseResourceFile(clean);
  const seen = new Map<string, number>();
  const out: Raw[] = [];
  const firstLine = (s: Section) => (s.line > 0 ? s.line : Math.min(...Object.values(s.propLines)));
  const start = sections.length ? firstLine(sections[0]!) : lines.length + 1;
  sections.forEach((s, i) => {
    const end = i + 1 < sections.length ? firstLine(sections[i + 1]!) - 1 : lines.length;
    const propStarts = Object.entries(s.propLines).sort((a, b) => a[1] - b[1]);
    const headerEnd = propStarts.length ? propStarts[0]![1] - 1 : end;
    const header = s.line > 0 ? trimEnd(lines.slice(s.line - 1, headerEnd)).join("\n") : "";
    const props = new Map<string, string>();
    propStarts.forEach(([name, line], n) => {
      const stop = n + 1 < propStarts.length ? propStarts[n + 1]![1] - 1 : end;
      props.set(name, trimEnd(lines.slice(line - 1, stop)).join("\n"));
    });
    out.push({ tag: s.tag, attrs: s.attrs, header, props, key: keyOf(s.tag, s.attrs, seen) });
  });
  return { preamble: trimEnd(lines.slice(0, start - 1)).join("\n"), sections: out };
}

// ---------------------------------------------------------------- resource ids

const REF = /\b(Ext|Sub)Resource\(\s*("?)([^")\s]+)\2\s*\)/g;
const ID_HEADER = /^(\[(ext|sub)_resource\b[^\n]*?\bid=)("?)([^"\s\]]+)\3/gm;

/** Renames resource ids in a whole file: the `id=` of the sections and every reference to them. */
function renumber(text: string, ext: ReadonlyMap<string, string>, sub: ReadonlyMap<string, string>): string {
  if (ext.size === 0 && sub.size === 0) return text;
  return text
    .replace(ID_HEADER, (all, head: string, kind: string, quote: string, id: string) => {
      const to = (kind === "ext" ? ext : sub).get(id);
      return to === undefined ? all : `${head}${quote}${to}${quote}`;
    })
    .replace(REF, (all, kind: string, quote: string, id: string) => {
      const to = (kind === "Ext" ? ext : sub).get(id);
      return to === undefined ? all : `${kind}Resource(${quote}${to}${quote})`;
    });
}

interface ExtInfo {
  id: string;
  uid?: string;
  path?: string;
}

const exts = (text: string): ExtInfo[] =>
  parseResourceFile(text)
    .filter((s) => s.tag === "ext_resource")
    .map((s) => {
      const uid = str(s.attrs["uid"]);
      const path = str(s.attrs["path"]);
      return { id: str(s.attrs["id"]) ?? "?", ...(uid ? { uid } : {}), ...(path ? { path } : {}) };
    });

const sameExt = (a: ExtInfo, b: ExtInfo) => (a.uid !== undefined && a.uid === b.uid) || (a.path !== undefined && a.path === b.path);

function freshId(wanted: string, used: Set<string>): string {
  if (!used.has(wanted)) return wanted;
  if (/^\d+$/.test(wanted)) {
    let n = Math.max(0, ...[...used].filter((u) => /^\d+$/.test(u)).map(Number)) + 1;
    while (used.has(String(n))) n++;
    return String(n);
  }
  for (let n = 2; ; n++) if (!used.has(`${wanted}_${n}`)) return `${wanted}_${n}`;
}

/**
 * Brings the three files into one numbering: an ext_resource is the same thing when its uid or its path is, whatever
 * id each side gave it; ours keeps its ids, and a new resource of theirs whose id ours already uses gets a free one.
 */
function alignIds(base: string, ours: string, theirs: string, repaired: string[]): [string, string, string] {
  const o = exts(ours);
  const used = new Set(o.map((e) => e.id));
  const mapFor = (list: ExtInfo[], claim: boolean): Map<string, string> => {
    const map = new Map<string, string>();
    for (const e of list) {
      const match = o.find((x) => sameExt(x, e));
      if (match) {
        if (match.id !== e.id) map.set(e.id, match.id);
        continue;
      }
      if (!claim) continue;
      const id = freshId(e.id, used);
      used.add(id);
      if (id !== e.id) {
        map.set(e.id, id);
        repaired.push(`ext_resource ${e.path ?? e.uid ?? e.id}: id "${e.id}" was taken on our side, theirs is now "${id}"`);
      }
    }
    return map;
  };
  const theirMap = mapFor(exts(theirs), true);
  // A resource only the base has (both sides dropped it, or one did) follows theirs when theirs still has it.
  const t = exts(theirs);
  const baseMap = new Map<string, string>();
  for (const e of exts(base)) {
    const inOurs = o.find((x) => sameExt(x, e));
    const inTheirs = t.find((x) => sameExt(x, e));
    const to = inOurs?.id ?? (inTheirs ? (theirMap.get(inTheirs.id) ?? inTheirs.id) : undefined);
    if (to !== undefined) {
      if (to !== e.id) baseMap.set(e.id, to);
    } else if (used.has(e.id)) {
      // Gone on both sides, and its id means something else now: keep it apart so it cannot be mistaken for that.
      const id = freshId(`${e.id}_base`, used);
      used.add(id);
      baseMap.set(e.id, id);
    }
  }
  const none = new Map<string, string>();
  let b = renumber(base, baseMap, none);
  let th = renumber(theirs, theirMap, none);

  // Sub-resources keep their ids; two new ones with the same id and other contents are two things.
  const subs = (text: string) => new Map(split(text).sections.filter((s) => s.tag === "sub_resource").map((s) => [str(s.attrs["id"]) ?? "?", [s.header, ...s.props.values()].join("\n")]));
  const bs = subs(b), os = subs(ours), ts = subs(th);
  const usedSubs = new Set([...bs.keys(), ...os.keys(), ...ts.keys()]);
  const subMap = new Map<string, string>();
  for (const [id, body] of ts) {
    if (bs.has(id) || !os.has(id) || os.get(id) === body) continue;
    const to = freshId(id, usedSubs);
    usedSubs.add(to);
    subMap.set(id, to);
    repaired.push(`sub_resource "${id}" was added on both sides with different contents, theirs is now "${to}"`);
  }
  th = renumber(th, none, subMap);
  b = b.replace(/\r\n/g, "\n");
  return [b, ours, th];
}

// ---------------------------------------------------------------- the merge

const valueOf = (raw: string | undefined): string | undefined => (raw === undefined ? undefined : raw.replace(/^[^=\n]*=\s*/, ""));
const clip = (s: string | undefined, n = 80): string | undefined => (s === undefined ? undefined : s.length > n ? `${s.slice(0, n - 3).replace(/\s+/g, " ")}...` : s.replace(/\s+/g, " "));

function three<T>(base: T | undefined, ours: T | undefined, theirs: T | undefined): { take: "ours" | "theirs"; conflict: boolean } {
  if (ours === theirs) return { take: "ours", conflict: false };
  if (theirs === base) return { take: "ours", conflict: false };
  if (ours === base) return { take: "theirs", conflict: false };
  return { take: "ours", conflict: true };
}

function headerOf(tag: string, attrs: Record<string, Variant>): string {
  return `[${[tag, ...Object.entries(attrs).map(([k, v]) => `${k}=${formatVariant(v)}`)].join(" ")}]`;
}

function mergeSection(base: Raw | undefined, ours: Raw, theirs: Raw, prefer: "ours" | "theirs", out: MergeResult): Raw {
  const where = ours.key;
  const merged: Raw = { tag: ours.tag, attrs: ours.attrs, header: ours.header, props: new Map(), key: ours.key };

  // The header: whole when one side left it alone, else attribute by attribute.
  const h = three(base?.header, ours.header, theirs.header);
  if (!h.conflict) {
    if (h.take === "theirs") {
      merged.header = theirs.header;
      merged.attrs = theirs.attrs;
      out.applied.push(`~ ${where}: header ${clip(theirs.header, 100)}`);
    }
  } else {
    const attrs: Record<string, Variant> = {};
    const names = [...new Set([...Object.keys(ours.attrs), ...Object.keys(theirs.attrs)])];
    for (const name of names) {
      const fmt = (r: Raw | undefined) => (r && name in r.attrs ? formatVariant(r.attrs[name]!) : undefined);
      const [b, o, t] = [fmt(base), fmt(ours), fmt(theirs)];
      const r = three(b, o, t);
      let take = r.take;
      if (r.conflict) {
        take = prefer;
        out.conflicts.push({ where, what: `${name} (in the header)`, ...(b !== undefined ? { base: b } : {}), ...(o !== undefined ? { ours: o } : {}), ...(t !== undefined ? { theirs: t } : {}), taken: take });
      } else if (take === "theirs") out.applied.push(`~ ${where}: ${name}=${clip(t) ?? "(removed)"}`);
      const from = take === "ours" ? ours : theirs;
      if (name in from.attrs) attrs[name] = from.attrs[name]!;
    }
    merged.attrs = attrs;
    merged.header = headerOf(ours.tag, attrs);
  }

  // Properties, in our order, then the ones only theirs has.
  const names = [...ours.props.keys(), ...[...theirs.props.keys()].filter((k) => !ours.props.has(k)), ...(base ? [...base.props.keys()].filter((k) => !ours.props.has(k) && !theirs.props.has(k)) : [])];
  for (const name of names) {
    const [b, o, t] = [base?.props.get(name), ours.props.get(name), theirs.props.get(name)];
    const r = three(b, o, t);
    let take = r.take;
    if (r.conflict) {
      take = prefer;
      const [bv, ov, tv] = [clip(valueOf(b), 200), clip(valueOf(o), 200), clip(valueOf(t), 200)];
      out.conflicts.push({ where, what: name, ...(bv !== undefined ? { base: bv } : {}), ...(ov !== undefined ? { ours: ov } : {}), ...(tv !== undefined ? { theirs: tv } : {}), taken: take });
    } else if (take === "theirs") out.applied.push(t === undefined ? `- ${where}: ${name}` : `${o === undefined ? "+" : "~"} ${where}: ${clip(t)}`);
    const raw = take === "ours" ? o : t;
    if (raw !== undefined) merged.props.set(name, raw);
  }
  return merged;
}

/** A section as a person names it: an ext_resource by its file, not by its id. */
const label = (s: Raw): string => (s.tag === "ext_resource" ? `ext_resource ${str(s.attrs["path"]) ?? str(s.attrs["uid"]) ?? str(s.attrs["id"])}` : s.key);

const bodyOf = (s: Raw) => [s.header, ...s.props.values()].join("\n");

const parentKey = (s: Raw): string | undefined => {
  const parent = str(s.attrs["parent"]);
  if (s.tag !== "node" || parent === undefined) return undefined;
  if (parent === ".") return "node .";
  return `node ${parent}`;
};

/** Our order, with what only theirs has placed after the section it follows there. */
function mergeOrder(ours: Raw[], theirs: Raw[], kept: Map<string, Raw>): Raw[] {
  const order = ours.filter((s) => kept.has(s.key)).map((s) => s.key);
  const placed = new Set(order);
  theirs.forEach((s, i) => {
    if (!kept.has(s.key) || placed.has(s.key)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) at = order.indexOf(theirs[j]!.key);
    // After the anchor and after what was already placed behind it from theirs, so their own order holds.
    let insert = at + 1;
    if (at < 0) insert = s.tag === "node" || TIGHT.has(s.tag) ? order.length : 0;
    else if (s.tag === "node") {
      // Stay depth-first, as Godot writes it: pass the nodes that sit deeper under an earlier sibling.
      const above = new Set<string>(["node ."]);
      const parent = parentKey(s);
      if (parent && parent !== "node .") {
        const parts = parent.slice("node ".length).split("/");
        parts.forEach((_, n) => above.add(`node ${parts.slice(0, n + 1).join("/")}`));
      }
      while (insert < order.length) {
        const next = kept.get(order[insert]!)!;
        const nextParent = parentKey(next);
        if (next.tag !== "node" || nextParent === undefined || above.has(nextParent)) break;
        insert++;
      }
    }
    order.splice(insert, 0, s.key);
    placed.add(s.key);
  });
  return order.map((k) => kept.get(k)!);
}

function mergeGroup(tagOrNull: string | null, base: Raw[], ours: Raw[], theirs: Raw[], prefer: "ours" | "theirs", out: MergeResult): Raw[] {
  const pick = (list: Raw[]) => (tagOrNull === null ? list : list.filter((s) => s.tag === tagOrNull));
  const [b, o, t] = [pick(base), pick(ours), pick(theirs)];
  const bm = new Map(b.map((s) => [s.key, s]));
  const om = new Map(o.map((s) => [s.key, s]));
  const tm = new Map(t.map((s) => [s.key, s]));
  const kept = new Map<string, Raw>();
  for (const key of new Set([...om.keys(), ...tm.keys()])) {
    const [bs, os, ts] = [bm.get(key), om.get(key), tm.get(key)];
    if (os && ts) kept.set(key, mergeSection(bs, os, ts, prefer, out));
    else if (os) {
      if (!bs) kept.set(key, os); // ours added it
      else if (bodyOf(bs) === bodyOf(os)) out.applied.push(`- ${label(os)}`); // theirs removed it, ours left it alone
      else {
        out.conflicts.push({ where: key, what: "removed on their side, changed on ours", taken: prefer });
        if (prefer === "ours") kept.set(key, os);
      }
    } else if (ts) {
      if (!bs) {
        kept.set(key, ts);
        out.applied.push(`+ ${label(ts)}`);
      } else if (bodyOf(bs) !== bodyOf(ts)) {
        out.conflicts.push({ where: key, what: "removed on our side, changed on theirs", taken: prefer });
        if (prefer === "theirs") kept.set(key, ts);
      }
    }
  }
  return mergeOrder(o, t, kept);
}

/** After the merge: nothing may point at a resource or a parent that the merge dropped. */
function repair(sections: Raw[], sides: Raw[][], out: MergeResult): Raw[] {
  const find = (key: string) => {
    for (const side of sides) {
      const hit = side.find((s) => s.key === key);
      if (hit) return hit;
    }
    return undefined;
  };
  for (let round = 0; round < 8; round++) {
    const have = new Set(sections.map((s) => s.key));
    const missing = new Map<string, string>();
    for (const s of sections) {
      for (const m of bodyOf(s).matchAll(REF)) {
        const key = `${m[1] === "Ext" ? "ext_resource" : "sub_resource"} ${m[3]}`;
        if (!have.has(key)) missing.set(key, s.key);
      }
      const parent = parentKey(s);
      if (parent && !have.has(parent) && find(parent)) missing.set(parent, s.key);
    }
    if (missing.size === 0) break;
    let added = false;
    for (const [key, user] of missing) {
      const section = find(key);
      if (!section) continue;
      added = true;
      const group = GROUPS.indexOf(section.tag);
      if (section.tag === "node") {
        // A parent comes before its children.
        sections.splice(sections.findIndex((s) => s.key === user), 0, section);
        out.conflicts.push({ where: key, what: `removed on one side, but the other side added or kept ${user} under it; the node is kept`, taken: "ours" });
      } else {
        let at = sections.findIndex((s) => GROUPS.indexOf(s.tag) > group);
        if (section.tag === "sub_resource") {
          const before = sections.findIndex((s) => s.key === user && s.tag === "sub_resource");
          if (before >= 0) at = before;
        }
        sections.splice(at < 0 ? sections.length : at, 0, section);
        out.repaired.push(`${key} was removed on one side but ${user} still uses it: kept`);
      }
    }
    if (!added) break;
  }
  return sections;
}

function write(kind: MergeKind, preamble: string, sections: Raw[]): string {
  const blocks: string[] = [];
  if (preamble) blocks.push(preamble, "");
  sections.forEach((s, i) => {
    // project.godot has an empty line under each section name; scenes and resources do not.
    const lines = [...(s.header ? (kind === "settings" && s.props.size ? [s.header, ""] : [s.header]) : []), ...s.props.values()];
    blocks.push(lines.join("\n"));
    const next = sections[i + 1];
    if (next && !(TIGHT.has(s.tag) && next.tag === s.tag && kind !== "settings")) blocks.push("");
  });
  return `${blocks.join("\n")}\n`;
}

export function mergeKindOf(file: string): MergeKind | undefined {
  if (/\.tscn$/i.test(file)) return "scene";
  if (/\.tres$/i.test(file)) return "resource";
  if (/(^|[\\/])project\.godot$/.test(file)) return "settings";
  return undefined;
}

/**
 * Merges `theirs` into `ours`, with `base` as the version both came from. An empty base means both sides made the
 * file. Throws a VariantParseError when one of the three is not a file Godot's text format can hold.
 */
export function mergeText(base: string, ours: string, theirs: string, kind: MergeKind, options: MergeOptions = {}): MergeResult {
  const prefer = options.prefer ?? "ours";
  const out: MergeResult = { text: ours, kind, conflicts: [], applied: [], repaired: [] };
  const norm = (s: string) => s.replace(/\r\n/g, "\n");
  if (norm(ours) === norm(theirs)) return { ...out, trivial: "same" };
  if (norm(base) === norm(theirs)) return { ...out, trivial: "ours" };
  if (norm(base) === norm(ours)) return { ...out, text: theirs, trivial: "theirs", applied: ["~ only their side changed this file: taken whole"] };

  const [b, o, t] = kind === "settings" ? [base, ours, theirs] : alignIds(base, ours, theirs, out.repaired);
  const [bd, od, td] = [split(b), split(o), split(t)];
  let sections: Raw[];
  if (kind === "settings") sections = mergeGroup(null, bd.sections, od.sections, td.sections, prefer, out);
  else {
    sections = [];
    const known = new Set(GROUPS);
    for (const tag of GROUPS) sections.push(...mergeGroup(tag, bd.sections, od.sections, td.sections, prefer, out));
    // A section of a kind this merge does not know stays as ours has it.
    sections.push(...od.sections.filter((s) => !known.has(s.tag)));
    sections = repair(sections, [od.sections, td.sections, bd.sections], out);
    const head = sections.find((s) => s.tag === "gd_scene" || s.tag === "gd_resource");
    if (head && "load_steps" in head.attrs) {
      // Godot's own count: every ext_resource and sub_resource, plus one.
      const steps = sections.filter((s) => s.tag === "ext_resource" || s.tag === "sub_resource").length + 1;
      if (head.attrs["load_steps"] !== steps) {
        head.attrs = { ...head.attrs, load_steps: steps };
        head.header = head.header.replace(/\bload_steps=\d+/, `load_steps=${steps}`);
      }
    }
  }
  out.text = write(kind, od.preamble, sections);
  return out;
}

export function formatMerge(file: string, result: MergeResult, limit = 40): string {
  const lines: string[] = [];
  const n = result.conflicts.length;
  if (result.trivial === "same") return `${file}: both sides are the same, nothing to merge\n`;
  if (result.trivial === "ours") return `${file}: only our side changed it, kept as it is\n`;
  lines.push(`${file}: ${n === 0 ? "merged cleanly" : `merged with ${n} conflict${n === 1 ? "" : "s"}`} (${result.applied.length} change${result.applied.length === 1 ? "" : "s"} from their side)`);
  for (const c of result.conflicts.slice(0, limit)) {
    lines.push(`  CONFLICT ${c.where}: ${c.what} (${c.taken} kept)`);
    if (c.base !== undefined || c.ours !== undefined || c.theirs !== undefined) {
      lines.push(`    base:   ${c.base ?? "(not set)"}`, `    ours:   ${c.ours ?? "(not set)"}`, `    theirs: ${c.theirs ?? "(not set)"}`);
    }
  }
  if (n > limit) lines.push(`  ... ${n - limit} more conflicts`);
  for (const r of result.repaired.slice(0, limit)) lines.push(`  kept loadable: ${r}`);
  for (const a of result.applied.slice(0, limit)) lines.push(`  ${a}`);
  if (result.applied.length > limit) lines.push(`  ... ${result.applied.length - limit} more changes from their side`);
  return `${lines.join("\n")}\n`;
}
