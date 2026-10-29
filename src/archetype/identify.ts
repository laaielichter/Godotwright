import { ArchetypeLibrary, loadLibrary } from "./library.js";
import type { ResolvedArchetype } from "./types.js";

export type MatchKind = "exact" | "phrase" | "suffix" | "typo" | "hint";

export interface Match {
  id: string;
  score: number;
  via: MatchKind;
  /** The alias or hint word that matched. */
  matched: string;
}

export interface IdentifyResult {
  query: string;
  /** Best first; one entry per archetype. */
  matches: Match[];
  /** The archetype to build from: the best match, a family guess, or the root. */
  best: ResolvedArchetype;
  /** True when nothing named the thing: the answer is a family or the general rules only. */
  generic: boolean;
  /** Archetypes that tie for the best score (the word means more than one thing). */
  ambiguous: string[];
  notes: string[];
}

const STOP = new Set([
  "a", "an", "the", "of", "with", "for", "and", "or", "to", "in", "on", "my", "me", "some", "something", "please", "make", "build", "create", "model", "3d", "want", "need", "like", "that", "is", "it", "i",
  "een", "de", "het", "voor", "met", "en", "of", "maak", "bouw", "mijn", "iets", "graag", "wil", "ik", "dat", "is", "van", "naar", "model",
]);

/** Lowercase words without accents or punctuation, minus filler words. */
export function tokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0 && !STOP.has(t) && !(t.length === 1 && t !== "x"));
}

/** A rough singular form for English and Dutch plurals, applied to both sides of a comparison. */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(ches|shes|xes|zes|ses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s")) return word.slice(0, -1);
  if (word.endsWith("en") && word.length > 4) return word.slice(0, -2);
  return word;
}

function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length] as number;
}

interface AliasEntry {
  id: string;
  alias: string;
  stems: string[];
}

function buildIndex(library: ArchetypeLibrary): AliasEntry[] {
  return library.archetypes.flatMap((a) => a.aliases.map((alias) => ({ id: a.id, alias, stems: tokens(alias).map(stem) }))).filter((e) => e.stems.length > 0);
}

const indexes = new WeakMap<ArchetypeLibrary, AliasEntry[]>();
const vocabularies = new WeakMap<ArchetypeLibrary, Set<string>>();

/** Every word the library knows, as stems: a word in here is not a typing mistake. */
function vocabulary(library: ArchetypeLibrary): Set<string> {
  let v = vocabularies.get(library);
  if (!v) {
    v = new Set();
    for (const a of library.archetypes) {
      for (const text of [...a.aliases, ...(a.hints ?? []), ...(a.parts ?? []).flatMap((p) => p.aliases ?? [])]) for (const t of tokens(text)) v.add(stem(t));
    }
    vocabularies.set(library, v);
  }
  return v;
}

/**
 * Finds what a piece of text is about: an archetype from its name in English or Dutch, from a typo or a
 * Dutch compound ("vrachtauto"), or only from a description ("something with wheels and an engine").
 * Deterministic and offline.
 */
export function identify(text: string, library: ArchetypeLibrary = loadLibrary()): IdentifyResult {
  let index = indexes.get(library);
  if (!index) indexes.set(library, (index = buildIndex(library)));
  const q = tokens(text).map(stem);
  const best = new Map<string, Match>();
  const offer = (id: string, score: number, via: MatchKind, matched: string): void => {
    const old = best.get(id);
    if (!old || score > old.score) best.set(id, { id, score: Math.round(score * 1000) / 1000, via, matched });
  };
  const key = (words: string[]) => words.join(" ");
  const supportOf = new Map<string, number>();

  if (q.length > 0) {
    for (const e of index) {
      if (key(e.stems) === key(q)) offer(e.id, 1, "exact", e.alias);
    }
    // Phrases inside the query, longest first, so "fighter jet" beats "jet".
    for (let len = Math.min(q.length, 4); len >= 1; len--) {
      for (let start = 0; start + len <= q.length; start++) {
        const part = key(q.slice(start, start + len));
        for (const e of index) {
          if (e.id !== "thing" && key(e.stems) === part) offer(e.id, 0.85 + 0.03 * len, "phrase", e.alias);
        }
      }
    }
    // Dutch and English compounds end in their head word: "vrachtauto" ends in "auto".
    for (const word of q) {
      if (word.length < 7) continue;
      for (const e of index) {
        const a = e.stems.length === 1 ? (e.stems[0] as string) : "";
        if (a.length >= 4 && e.id !== "thing" && word !== a && word.endsWith(a) && word.length - a.length >= 3) offer(e.id, 0.6 + 0.005 * a.length, "suffix", e.alias);
      }
    }
    // Typing mistakes in a single word.
    const known = vocabulary(library);
    for (const word of q) {
      if (word.length < 5 || known.has(word)) continue;
      const limit = word.length >= 9 ? 2 : 1;
      for (const e of index) {
        const a = e.stems.length === 1 ? (e.stems[0] as string) : "";
        if (a.length < 5 || e.id === "thing") continue;
        const d = distance(word, a, limit);
        if (d > 0 && d <= limit) offer(e.id, 0.8 - 0.1 * d, "typo", e.alias);
      }
    }
    // Descriptions: words that suggest a family. Hints count once per stem, along the whole chain of ancestors.
    for (const a of library.archetypes) {
      if (a.id === "thing") continue;
      const own = new Set((a.hints ?? []).map(stem).filter((h) => q.includes(h)));
      const chain = new Set(library.resolve(a.id).chain.flatMap((id) => (library.get(id)?.hints ?? []).map(stem)).filter((h) => q.includes(h)));
      if (chain.size > 0) offer(a.id, Math.min(0.5, 0.05 + 0.1 * chain.size + 0.03 * own.size), "hint", [...chain].join(", "));
    }
    // Words that describe the family make a named match more likely: "wheels and a motor" favours the motorcycle over the engine.
    for (const m of best.values()) {
      if (m.via === "hint") continue;
      const chain = library.resolve(m.id).chain;
      const support = chain.reduce((n, id) => n + (library.get(id)?.hints ?? []).filter((h) => q.includes(stem(h))).length, 0);
      supportOf.set(m.id, support);
      if (support > 0) m.score = Math.round((m.score + Math.min(0.05, 0.012 * support)) * 1000) / 1000;
    }
  }

  let matches = [...best.values()].sort((a, b) => b.score - a.score || (a.via === "hint" ? a.id.length - b.id.length : b.id.length - a.id.length) || a.id.localeCompare(b.id));
  // A long description whose only named word has nothing to do with the rest ("wheels and an engine") is about the family.
  const named = matches.find((m) => m.via !== "hint");
  const family = matches.find((m) => m.via === "hint");
  if (named && family && named.score < 1 && supportOf.get(named.id) === 0 && q.length >= 2 && family.score >= 0.25) {
    matches = [family, named, ...matches.filter((m) => m !== family && m !== named)];
  }
  const top = matches[0];
  const notes: string[] = [];
  let generic = !top || top.score < 0.55;
  let chosen = top && (top.score >= 0.4 || top.via === "hint") ? top.id : "thing";
  if (q.length === 0) notes.push("The text holds no words to go on.");
  if (top && top.via === "hint") notes.push(`Not named, but the words (${top.matched}) suggest ${library.get(top.id)?.name}.`);
  if (top && top.via === "suffix") notes.push(`Matched by the end of the word: "${top.matched}". Check that this is what you meant.`);
  if (top && top.via === "typo") notes.push(`Read as "${top.matched}" (a small typing mistake).`);
  if (generic) notes.push(top?.via === "hint" ? "No archetype names this exactly; the family below is a guess from the words. Describe the parts yourself with `model spec`." : "Nothing matches by name. Build from the general rules, and describe the parts yourself with `model spec`.");

  const ambiguous = top && top.score >= 0.85 ? matches.filter((m) => m.score === top.score && m.via !== "hint").map((m) => m.id) : [];
  if (ambiguous.length > 1) {
    notes.push(`The word means more than one thing: ${ambiguous.map((id) => library.get(id)?.name).join(" or ")}. Say which one you want.`);
    generic = false;
  }
  return { query: text, matches, best: library.resolve(chosen), generic, ambiguous: ambiguous.length > 1 ? ambiguous : [], notes };
}
