import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type {
  ApiClass,
  ApiData,
  ApiEntry,
  ApiMethod,
  ApiParam,
  EntryKind,
  EnumInfo,
} from "./types.js";

const DATA_URL = new URL("../../data/godot-api.json.gz", import.meta.url);

/** Scopes that hold global functions, constants, singletons and annotations. */
export const GLOBAL_SCOPES = ["@GlobalScope", "@GDScript"];

export interface Rename {
  kind: "class" | "function" | "property" | "signal" | "constant" | "type";
  from: string;
  to: string;
}

export interface LookupResult {
  query: string;
  entries: ApiEntry[];
  /** Set when the name is a Godot 3 name that was renamed in Godot 4. */
  renamed?: Rename;
  /** Close names when nothing matched. */
  suggestions: string[];
}

export interface SearchHit extends ApiEntry {
  score: number;
}

let cached: GodotApi | undefined;

export class GodotApi {
  readonly version: string;
  readonly classes: Map<string, ApiClass>;
  private readonly lower = new Map<string, string>();
  private index?: { entry: ApiEntry; name: string; full: string; keywords: string; text: string; editor: boolean }[];

  constructor(readonly data: ApiData) {
    this.version = data.godot;
    this.classes = new Map(data.classes.map((c) => [c.name, c]));
    for (const name of this.classes.keys()) this.lower.set(name.toLowerCase(), name);
  }

  /** Loads the bundled Godot 4.7 class reference (cached after the first call). */
  static load(): GodotApi {
    cached ??= new GodotApi(JSON.parse(gunzipSync(readFileSync(DATA_URL)).toString("utf8")) as ApiData);
    return cached;
  }

  getClass(name: string): ApiClass | undefined {
    return this.classes.get(name) ?? this.classes.get(this.lower.get(name.toLowerCase()) ?? "");
  }

  /** The class and its ancestors, nearest first. */
  ancestors(name: string): ApiClass[] {
    const out: ApiClass[] = [];
    let cls = this.getClass(name);
    while (cls && out.length < 64) {
      out.push(cls);
      cls = cls.inherits ? this.classes.get(cls.inherits) : undefined;
    }
    return out;
  }

  inheritsFrom(name: string, base: string): boolean {
    return this.ancestors(name).some((c) => c.name === base);
  }

  enums(cls: ApiClass): EnumInfo[] {
    const groups = new Map<string, EnumInfo>();
    for (const c of cls.constants ?? []) {
      if (!c.enum) continue;
      const info = groups.get(c.enum) ?? { name: c.enum, bitfield: c.bitfield === true, values: [] };
      info.values.push(c);
      groups.set(c.enum, info);
    }
    return [...groups.values()];
  }

  /** Members called `name` that are defined on the class itself (not inherited). */
  ownMembers(cls: ApiClass, name: string): ApiEntry[] {
    const out: ApiEntry[] = [];
    const add = (kind: EntryKind, item: ApiEntry["item"]) => out.push({ kind, owner: cls.name, name, item });
    for (const m of cls.methods ?? []) if (m.name === name) add("method", m);
    for (const m of cls.members ?? []) if (m.name === name) add("property", m);
    for (const s of cls.signals ?? []) if (s.name === name) add("signal", s);
    for (const c of cls.constants ?? []) if (c.name === name) add("constant", c);
    for (const e of this.enums(cls)) if (e.name === name) add("enum", e);
    for (const a of cls.annotations ?? []) if (a.name === name) add("annotation", a);
    for (const t of cls.themeItems ?? []) if (t.name === name) add("theme_item", t);
    return out;
  }

  /**
   * Finds a member on a class or its ancestors; the nearest definition wins.
   * Theme items only match when no method, property, signal or constant does,
   * because code cannot reach them as members (Button has both a `pressed`
   * signal and a `pressed` stylebox).
   */
  member(className: string, name: string): ApiEntry[] {
    const chain = this.ancestors(className);
    for (const cls of chain) {
      const found = this.ownMembers(cls, name).filter((e) => e.kind !== "theme_item");
      if (found.length) return found;
    }
    for (const cls of chain) {
      const found = this.ownMembers(cls, name);
      if (found.length) return found;
    }
    return [];
  }

  hasMethod(className: string, name: string): boolean {
    return this.ancestors(className).some((c) => c.methods?.some((m) => m.name === name));
  }

  /** A global function such as `lerp` or `preload`. */
  globalFunction(name: string): ApiMethod | undefined {
    for (const scope of GLOBAL_SCOPES) {
      const found = this.classes.get(scope)?.methods?.find((m) => m.name === name);
      if (found) return found;
    }
    return undefined;
  }

  /** True when @GlobalScope or @GDScript defines a member with exactly this name. */
  private globalNamed(name: string): boolean {
    return GLOBAL_SCOPES.some((scope) => {
      const scopeClass = this.classes.get(scope);
      return scopeClass !== undefined && this.ownMembers(scopeClass, name).length > 0;
    });
  }

  /** Every class that defines a method with this name. */
  classesWithMethod(name: string): string[] {
    return [...this.classes.values()].filter((c) => c.methods?.some((m) => m.name === name)).map((c) => c.name);
  }

  /** Looks up `Class`, `Class.member`, `Class.Enum.VALUE`, `@annotation` or a bare name. */
  lookup(rawQuery: string): LookupResult {
    const query = rawQuery.trim().replace(/\(\)$/, "");
    const result: LookupResult = { query, entries: [], suggestions: [] };
    const dot = query.indexOf(".");

    if (dot > 0) {
      const className = query.slice(0, dot);
      const memberName = query.slice(dot + 1);
      const cls = this.getClass(className);
      if (!cls) {
        result.renamed = this.renamedClass(className);
        result.suggestions = this.closeClassNames(className);
        return result;
      }
      // Property names may contain dots (EditorSettings); otherwise `Enum.VALUE`.
      result.entries = this.member(cls.name, memberName);
      const lastDot = memberName.lastIndexOf(".");
      let enumSuggestions: string[] | undefined;
      if (result.entries.length === 0 && lastDot > 0) {
        const valueName = memberName.slice(lastDot + 1);
        const enumEntry = this.member(cls.name, memberName.slice(0, lastDot)).find((e) => e.kind === "enum");
        if (enumEntry) {
          const values = (enumEntry.item as EnumInfo).values;
          const value = values.find((v) => v.name === valueName);
          if (value) result.entries = [{ kind: "constant", owner: enumEntry.owner, name: value.name, item: value }];
          // The enum exists but has no such value: its values are the names to suggest.
          else enumSuggestions = closest(valueName, values.map((v) => v.name));
        }
      }
      if (result.entries.length === 0) {
        result.renamed = this.renamedMember(memberName);
        result.suggestions = enumSuggestions ?? this.closeMemberNames(cls.name, memberName);
      }
      return result;
    }

    // A class matched only by case (range -> Range) must not hide a global of that name.
    const cls = this.classes.get(query) ?? (this.globalNamed(query) ? undefined : this.getClass(query));
    if (cls) {
      result.entries = [{ kind: "class", owner: cls.name, name: cls.name, item: cls }];
      return result;
    }

    if (query.startsWith("@")) {
      const annotation = this.classes.get("@GDScript")?.annotations?.find((a) => a.name === query);
      if (annotation) result.entries = [{ kind: "annotation", owner: "@GDScript", name: query, item: annotation }];
      else result.suggestions = closest(query, this.classes.get("@GDScript")?.annotations?.map((a) => a.name) ?? []);
      return result;
    }

    for (const scope of GLOBAL_SCOPES) {
      const scopeClass = this.classes.get(scope);
      if (scopeClass) result.entries.push(...this.ownMembers(scopeClass, query));
    }
    if (result.entries.length === 0) {
      for (const c of this.classes.values()) {
        if (GLOBAL_SCOPES.includes(c.name)) continue;
        result.entries.push(...this.ownMembers(c, query));
      }
    }
    if (result.entries.length === 0) {
      result.renamed = this.renamedClass(query) ?? this.renamedMember(query);
      result.suggestions = closest(query, [...this.classes.keys()]);
    }
    return result;
  }

  renamedClass(name: string): Rename | undefined {
    const r = this.data.renames;
    const fromClasses = ownRename(r.classes, name);
    const to = fromClasses ?? ownRename(r.builtinTypes, name);
    if (to && !this.classes.has(name)) return { kind: fromClasses ? "class" : "type", from: name, to };
    return undefined;
  }

  renamedMember(name: string): Rename | undefined {
    const r = this.data.renames;
    const table: [Rename["kind"], Record<string, string> | undefined][] = [
      ["function", r.functions],
      ["property", r.properties],
      ["signal", r.signals],
      ["constant", r.constants],
    ];
    for (const [kind, map] of table) {
      const to = ownRename(map, name);
      if (to) return { kind, from: name, to };
    }
    return undefined;
  }

  closeClassNames(name: string): string[] {
    return closest(name, [...this.classes.keys()]);
  }

  closeMemberNames(className: string, name: string): string[] {
    const names = new Set<string>();
    for (const cls of this.ancestors(className)) {
      for (const list of [cls.methods, cls.members, cls.signals, cls.constants]) {
        for (const item of list ?? []) names.add(item.name);
      }
    }
    return closest(name, [...names]);
  }

  /** Ranked search over names, keywords and descriptions. */
  search(text: string, limit = 10): SearchHit[] {
    const tokens = text.toLowerCase().split(/[\s._]+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const needle = text.toLowerCase().trim();
    const hits: SearchHit[] = [];
    for (const row of this.searchIndex()) {
      let score = 0;
      if (row.name === needle) score = 100;
      else if (row.name.startsWith(needle)) score = 60;
      else if (row.name.includes(needle)) score = 45;
      else if (tokens.length > 1 && row.name.includes(tokens.join("_"))) score = 50;
      else if (tokens.every((t) => row.full.includes(t))) score = 35;
      else if (tokens.every((t) => row.keywords.includes(t))) score = 30;
      else if (tokens.every((t) => row.text.includes(t))) score = 10;
      if (score === 0) continue;
      if (row.entry.kind === "class") score += 5;
      if (row.entry.owner.startsWith("@")) score += 2;
      if (row.editor) score -= 5;
      if ((row.entry.item as { deprecated?: string }).deprecated) score -= 20;
      hits.push({ ...row.entry, score });
    }
    return hits
      .sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.owner.localeCompare(b.owner))
      .slice(0, limit);
  }

  private searchIndex() {
    if (this.index) return this.index;
    const rows: NonNullable<GodotApi["index"]> = [];
    const firstSentence = (s?: string) => (s ?? "").split(/\n|(?<=\.)\s/)[0]!.toLowerCase();
    for (const cls of this.classes.values()) {
      const editor = cls.apiType === "editor" || cls.name.startsWith("Editor");
      rows.push({
        entry: { kind: "class", owner: cls.name, name: cls.name, item: cls },
        name: cls.name.toLowerCase(),
        full: cls.name.toLowerCase(),
        keywords: (cls.keywords ?? "").toLowerCase(),
        text: `${cls.brief ?? ""}`.toLowerCase(),
        editor,
      });
      const add = (kind: EntryKind, item: ApiEntry["item"] & { name: string; keywords?: string; description?: string }) =>
        rows.push({
          entry: { kind, owner: cls.name, name: item.name, item },
          name: item.name.toLowerCase(),
          full: `${cls.name}.${item.name}`.toLowerCase(),
          keywords: (item.keywords ?? "").toLowerCase(),
          text: firstSentence(item.description),
          editor,
        });
      for (const m of cls.methods ?? []) add("method", m);
      for (const m of cls.members ?? []) add("property", m);
      for (const s of cls.signals ?? []) add("signal", s);
      for (const a of cls.annotations ?? []) add("annotation", a);
      for (const c of cls.constants ?? []) add("constant", c);
      for (const e of this.enums(cls)) add("enum", e);
    }
    this.index = rows;
    return rows;
  }
}

/** A rename by its own key only: a plain lookup would also find `constructor` or `toString` on Object.prototype. */
function ownRename(table: Record<string, string> | undefined, name: string): string | undefined {
  return table && Object.hasOwn(table, name) ? table[name] : undefined;
}

/** Formats parameters GDScript-style: `point: Vector2, up: Vector3 = Vector3(0, 1, 0)`. */
export function formatApiParams(params: ApiParam[] = [], vararg = false): string {
  const parts = params.map((p) => `${p.name}: ${p.enum ?? p.type}${p.default !== undefined ? ` = ${p.default}` : ""}`);
  if (vararg) parts.push("...");
  return parts.join(", ");
}

export function formatMethodSignature(method: ApiMethod, owner?: string): string {
  const q = method.qualifiers?.split(" ") ?? [];
  const prefix = [q.includes("static") ? "static " : "", q.includes("virtual") ? "virtual " : ""].join("");
  const name = owner && !owner.startsWith("@") ? `${owner}.${method.name}` : method.name;
  const suffix = q.includes("const") ? " const" : "";
  return `${prefix}${name}(${formatApiParams(method.params, q.includes("vararg"))}) -> ${method.returnEnum ?? method.returns}${suffix}`;
}

/**
 * Up to five names closest to `name` by edit distance (case-insensitive).
 * A name that contains the query, or sits inside it, ranks first, but only for names of at least
 * three letters: `r` is inside `bright` and says nothing about it.
 */
export function closest(name: string, candidates: string[], max = 5): string[] {
  const target = name.toLowerCase();
  if (!target) return [];
  const limit = Math.max(2, Math.floor(target.length / 3));
  return candidates
    .map((c) => {
      const lower = c.toLowerCase();
      const related = lower.length >= 3 && (lower.includes(target) || target.includes(lower));
      return { c, d: related ? 1 : distance(target, lower, limit) };
    })
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || a.c.length - b.c.length || a.c.localeCompare(b.c))
    .slice(0, max)
    .map((x) => x.c);
}

/** Levenshtein distance, stopping early once it exceeds `limit`. */
export function distance(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

