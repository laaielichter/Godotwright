import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Archetype, ArchetypePart, ResolvedArchetype } from "./types.js";

const DATA_DIR = fileURLToPath(new URL("../../data/archetypes/", import.meta.url));
const MOVES = ["spin", "hinge", "slide", "steer", "yaw", "pitch"];
const PIVOTS = ["center", "hub", "hinge", "base", "mount"];
const CONFIDENCE = ["A", "B", "C", "D", "X"];
const AXES = ["x", "y", "z"];
/** Aliases that two archetypes may share on purpose; identify then reports the ambiguity. */
export const SHARED_ALIASES = new Set(["windmolen", "bike", "motor", "turbine", "kist", "mast", "track", "tracks", "bank", "wall", "box"]);

export class ArchetypeError extends Error {}

/** Checks the library as a whole and returns every problem found (empty = fine). */
export function validateArchetypes(list: Archetype[]): string[] {
  const problems: string[] = [];
  const byId = new Map<string, Archetype>();
  for (const a of list) {
    if (byId.has(a.id)) problems.push(`${a.id}: id used twice`);
    byId.set(a.id, a);
  }
  const aliasOwner = new Map<string, string>();
  for (const a of list) {
    const at = (msg: string) => problems.push(`${a.id}: ${msg}`);
    if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(a.id)) at("id must be lowercase dotted words");
    if (!a.name || !a.description) at("needs a name and a description");
    if (!Array.isArray(a.aliases) || a.aliases.length === 0) at("needs at least one alias");
    if (a.extends !== undefined && !byId.has(a.extends)) at(`extends "${a.extends}", which does not exist`);
    if (a.extends === undefined && a.id !== "thing") at('only "thing" may have no parent');
    if (a.extends !== undefined && !a.id.startsWith(`${a.extends.split(".").slice(0, -1).join(".")}`) ) at(`should be named under its parent's family (parent ${a.extends})`);
    for (const alias of a.aliases ?? []) {
      if (alias !== alias.toLowerCase() || alias.trim() !== alias || alias === "") at(`alias "${alias}" must be lowercase and trimmed`);
      const owner = aliasOwner.get(alias);
      if (owner && owner !== a.id && !SHARED_ALIASES.has(alias)) at(`alias "${alias}" is also used by ${owner}`);
      aliasOwner.set(alias, a.id);
    }
    const names = new Set<string>();
    for (const p of a.parts ?? []) {
      const pt = (msg: string) => at(`part ${p.name}: ${msg}`);
      if (names.has(p.name)) pt("name used twice");
      names.add(p.name);
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(p.name)) pt("name must be PascalCase");
      if (typeof p.required !== "boolean") pt('needs "required"');
      if (Array.isArray(p.count) && !(p.count[0] <= p.count[1])) pt("count range must be [min, max]");
      for (const m of p.moves ?? []) {
        if (!MOVES.includes(m.kind) || !AXES.includes(m.axis)) pt(`bad move ${JSON.stringify(m)}`);
      }
      if (p.pivot && !PIVOTS.includes(p.pivot)) pt(`unknown pivot "${p.pivot}"`);
      if (p.moves?.length && !p.pivot) pt("a moving part needs a pivot rule");
    }
    const s = a.scale;
    if (s) {
      if (!s.source) at("scale needs a source");
      if (!CONFIDENCE.includes(s.confidence)) at("scale needs a confidence from A to X");
      for (const key of ["length", "width", "height"] as const) {
        const r = s[key];
        if (r && !(r[0] <= r[1] && r[0] >= 0)) at(`scale.${key} must be [min, max] with min <= max`);
      }
      if (!s.length && !s.width && !s.height) at("scale has no size");
    }
  }
  // Cycles: following extends must end at the root.
  for (const a of list) {
    const seen = new Set<string>();
    for (let cur: Archetype | undefined = a; cur; cur = cur.extends ? byId.get(cur.extends) : undefined) {
      if (seen.has(cur.id)) { problems.push(`${a.id}: extends forms a cycle`); break; }
      seen.add(cur.id);
    }
  }
  return problems;
}

export class ArchetypeLibrary {
  private readonly byId = new Map<string, Archetype>();

  constructor(readonly archetypes: Archetype[]) {
    for (const a of archetypes) this.byId.set(a.id, a);
  }

  get(id: string): Archetype | undefined {
    return this.byId.get(id);
  }

  children(id: string): Archetype[] {
    return this.archetypes.filter((a) => a.extends === id);
  }

  /** The archetype with its ancestors merged in: parts by name (the child wins), lists without duplicates. */
  resolve(id: string): ResolvedArchetype {
    const leaf = this.byId.get(id);
    if (!leaf) throw new ArchetypeError(`unknown archetype "${id}"`);
    const chain: Archetype[] = [];
    for (let cur: Archetype | undefined = leaf; cur; cur = cur.extends ? this.byId.get(cur.extends) : undefined) chain.unshift(cur);
    const parts = new Map<string, ArchetypePart>();
    const join = (pick: (a: Archetype) => string[] | undefined): string[] => [...new Set(chain.flatMap((a) => pick(a) ?? []))];
    for (const a of chain) for (const p of a.parts ?? []) parts.set(p.name, p);
    const variants = new Map<string, string[]>();
    for (const a of chain) for (const v of a.variants ?? []) variants.set(v.axis, v.options);
    const scale = [...chain].reverse().find((a) => a.scale)?.scale;
    return {
      id: leaf.id,
      name: leaf.name,
      description: leaf.description,
      aliases: leaf.aliases,
      ...(leaf.hints ? { hints: leaf.hints } : {}),
      ...(scale ? { scale } : {}),
      chain: chain.map((a) => a.id),
      parts: [...parts.values()],
      variants: [...variants].map(([axis, options]) => ({ axis, options })),
      conventions: join((a) => a.conventions),
      anticipate: join((a) => a.anticipate),
      pitfalls: join((a) => a.pitfalls),
    };
  }
}

let cached: ArchetypeLibrary | undefined;

/** Loads data/archetypes/*.json once. A broken data file fails loudly, with every problem listed. */
export function loadLibrary(dir: string = DATA_DIR): ArchetypeLibrary {
  if (dir === DATA_DIR && cached) return cached;
  const list: Archetype[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const parsed = JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as Archetype[];
    list.push(...parsed);
  }
  const problems = validateArchetypes(list);
  if (problems.length) throw new ArchetypeError(`the archetype library has ${problems.length} problems:\n${problems.join("\n")}`);
  const library = new ArchetypeLibrary(list);
  if (dir === DATA_DIR) cached = library;
  return library;
}
