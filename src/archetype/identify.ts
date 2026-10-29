import { ArchetypeLibrary, loadLibrary } from "./library.js";
import type { ResolvedArchetype } from "./types.js";
import { keepWord, rawWords, stem, tokens } from "./words.js";

export { stem, tokens } from "./words.js";

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
  /** Archetypes that name the text about equally well (the word, or words, mean more than one thing). */
  ambiguous: string[];
  notes: string[];
}

/** Words after which a name is a place, not the subject: "a house by the river" is about the house. */
const PLACE_WORDS = new Set(["by", "on", "near", "beside", "at", "in", "over", "under", "above", "below", "across", "along", "behind", "bij", "aan", "naast", "op", "langs", "nabij", "onder", "boven", "achter"]);
const ARTICLES = new Set(["a", "an", "the", "de", "het", "een", "my", "mijn", "his", "her", "its", "their", "our", "zijn", "haar"]);
/** What a named match loses when its word is a place and another named word in the text is not. */
const PLACE_PENALTY = 0.1;
/** Named matches of the same kind within this distance of the best are reported as ambiguous. */
const CLOSE = 0.03;
/** Head words that are not a thing on their own: "motorhome" is not a house, a "fueltank" is not a battle tank. */
const NOT_A_HEAD = new Set(["home", "tank"]);

const indexes = new WeakMap<ArchetypeLibrary, AliasEntry[]>();
const vocabularies = new WeakMap<ArchetypeLibrary, Set<string>>();

interface AliasEntry {
  id: string;
  alias: string;
  stems: string[];
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

function buildIndex(library: ArchetypeLibrary): AliasEntry[] {
  return library.archetypes.flatMap((a) => a.aliases.map((alias) => ({ id: a.id, alias, stems: tokens(alias).map(stem) }))).filter((e) => e.stems.length > 0);
}

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

/** True when the word at position k of the text is a place: it follows "by", "on", "next to" and the like. */
function placeBefore(words: string[], k: number): boolean {
  let j = k - 1;
  while (j >= 0 && ARTICLES.has(words[j] ?? "")) j--;
  if (j < 0) return false;
  if (words[j] === "to" && words[j - 1] === "next") return true;
  return PLACE_WORDS.has(words[j] ?? "");
}

/** Where the best named match for an archetype was found, and how strong it was before any boost. */
interface Hit {
  base: number;
  /** Position of the matched word in the text (the first word of a phrase). */
  pos: number;
  place: boolean;
  /** The alias is spelled exactly like the text, not only the same after plurals and accents. */
  spelled: boolean;
}

/**
 * Finds what a piece of text is about: an archetype from its name in English or Dutch, from a typo or a
 * Dutch compound ("vrachtauto"), or only from a description ("something with wheels and an engine").
 * Deterministic and offline.
 */
export function identify(text: string, library: ArchetypeLibrary = loadLibrary()): IdentifyResult {
  let index = indexes.get(library);
  if (!index) indexes.set(library, (index = buildIndex(library)));
  const words = rawWords(text);
  // The position in `words` of each word of the query, and the query as stems.
  const at = words.flatMap((w, i) => (keepWord(w) ? [i] : []));
  const q = at.map((i) => stem(words[i] ?? ""));
  const spelled = text.trim().toLowerCase().replace(/\s+/g, " ");
  const best = new Map<string, Match>();
  const hits = new Map<string, Hit>();
  const offer = (id: string, score: number, via: MatchKind, matched: string, pos: number, place: boolean, spelledOut = false): void => {
    const old = hits.get(id);
    if (old && !(score > old.base || (score === old.base && spelledOut && !old.spelled))) return;
    hits.set(id, { base: score, pos, place, spelled: spelledOut });
    best.set(id, { id, score: Math.round(score * 1000) / 1000, via, matched });
  };
  const key = (parts: string[]) => parts.join(" ");
  const supportOf = new Map<string, number>();

  if (q.length > 0) {
    for (const e of index) {
      if (key(e.stems) === key(q)) offer(e.id, 1, "exact", e.alias, 0, false, e.alias === spelled);
    }
    // Phrases inside the query, longest first, so "fighter jet" beats "jet".
    for (let len = Math.min(q.length, 4); len >= 1; len--) {
      for (let start = 0; start + len <= q.length; start++) {
        const part = key(q.slice(start, start + len));
        const pos = at[start] ?? 0;
        for (const e of index) {
          if (e.id !== "thing" && key(e.stems) === part) offer(e.id, 0.85 + 0.03 * len, "phrase", e.alias, pos, placeBefore(words, pos));
        }
      }
    }
    // Dutch and English compounds end in their head word: "vrachtauto" ends in "auto".
    for (let k = 0; k < q.length; k++) {
      const word = q[k] ?? "";
      if (word.length < 7) continue;
      for (const e of index) {
        const a = e.stems.length === 1 ? (e.stems[0] as string) : "";
        if (a.length >= 4 && e.id !== "thing" && !NOT_A_HEAD.has(a) && word !== a && word.endsWith(a) && word.length - a.length >= 3) offer(e.id, 0.6 + 0.005 * a.length, "suffix", e.alias, at[k] ?? 0, placeBefore(words, at[k] ?? 0));
      }
    }
    // Typing mistakes in a single word.
    const known = vocabulary(library);
    for (let k = 0; k < q.length; k++) {
      const word = q[k] ?? "";
      if (word.length < 5 || known.has(word)) continue;
      const limit = word.length >= 9 ? 2 : 1;
      for (const e of index) {
        const a = e.stems.length === 1 ? (e.stems[0] as string) : "";
        if (a.length < 5 || e.id === "thing") continue;
        const d = distance(word, a, limit);
        if (d > 0 && d <= limit) offer(e.id, 0.8 - 0.1 * d, "typo", e.alias, at[k] ?? 0, placeBefore(words, at[k] ?? 0));
      }
    }
    // Descriptions: words that suggest a family. Hints count once per stem, along the whole chain of ancestors.
    for (const a of library.archetypes) {
      if (a.id === "thing") continue;
      const own = new Set((a.hints ?? []).map(stem).filter((h) => q.includes(h)));
      const chain = new Set(library.resolve(a.id).chain.flatMap((id) => (library.get(id)?.hints ?? []).map(stem)).filter((h) => q.includes(h)));
      if (chain.size > 0) offer(a.id, Math.min(0.5, 0.05 + 0.1 * chain.size + 0.03 * own.size), "hint", [...chain].join(", "), 0, false);
    }
    // Words that describe the family make a named match more likely: "wheels and a motor" favours the motorcycle over the engine.
    // A word does not count for the archetype it names: "river" is no reason to pick the river.
    for (const m of best.values()) {
      if (m.via === "hint") continue;
      const chain = library.resolve(m.id).chain;
      const own = new Set(tokens(m.matched).map(stem));
      const support = chain.reduce((n, id) => n + (library.get(id)?.hints ?? []).filter((h) => q.includes(stem(h)) && !own.has(stem(h))).length, 0);
      supportOf.set(m.id, support);
      if (support > 0) m.score = Math.round((m.score + Math.min(0.05, 0.012 * support)) * 1000) / 1000;
    }
    // A place is not the subject, when the text names something else too: "a house by the river" is about the house.
    const named = [...best.values()].filter((m) => m.via !== "hint");
    if (named.some((m) => !hits.get(m.id)?.place)) {
      for (const m of named) if (hits.get(m.id)?.place) m.score = Math.round((m.score - PLACE_PENALTY) * 1000) / 1000;
    }
  }

  // Named matches: the best score first, then the exact spelling, then the one that comes first in the text.
  // Family guesses (hints): the broadest family first.
  const tie = (a: Match, b: Match): number => {
    if (a.via === "hint" || b.via === "hint") return a.via === b.via ? a.id.length - b.id.length : a.via === "hint" ? 1 : -1;
    const ha = hits.get(a.id);
    const hb = hits.get(b.id);
    return Number(hb?.spelled ?? false) - Number(ha?.spelled ?? false) || (ha?.pos ?? 0) - (hb?.pos ?? 0);
  };
  let matches = [...best.values()].sort((a, b) => b.score - a.score || tie(a, b) || a.id.localeCompare(b.id));
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

  // Named matches that are as specific as the best one and nearly as strong: the text does not settle what it means.
  const close = top && top.via !== "hint" && top.score >= 0.85 ? matches.filter((m) => m.via !== "hint" && hits.get(m.id)?.base === hits.get(top.id)?.base && m.score >= top.score - CLOSE) : [];
  const ambiguous = close.map((m) => m.id);
  if (ambiguous.length > 1) {
    const sameWord = new Set(close.map((m) => m.matched)).size === 1;
    const names = close.map((m) => library.get(m.id)?.name).join(" or ");
    notes.push(sameWord ? `The word means more than one thing: ${names}. Say which one you want.` : `The text names more than one thing: ${names}. Say which one you want.`);
    generic = false;
  }
  return { query: text, matches, best: library.resolve(chosen), generic, ambiguous: ambiguous.length > 1 ? ambiguous : [], notes };
}
