/** Filler words that never name a thing. */
const STOP = new Set([
  "a", "an", "the", "of", "with", "for", "and", "or", "to", "in", "on", "my", "me", "some", "something", "please", "make", "build", "create", "model", "3d", "want", "need", "like", "that", "is", "it", "i",
  "een", "de", "het", "voor", "met", "en", "of", "maak", "bouw", "mijn", "iets", "graag", "wil", "ik", "dat", "is", "van", "naar", "model",
]);

/**
 * Lowercase words without accents or punctuation, in order, filler words included. A hyphen between letters and a
 * number is dropped, so a code such as "F-16" stays one word: "f16".
 */
export function rawWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b([a-z]+)-(?=\d)/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

/** True for a word that takes part in a match: not filler, and not a single letter (except x). */
export function keepWord(word: string): boolean {
  return !STOP.has(word) && !(word.length === 1 && word !== "x");
}

/** Lowercase words without accents or punctuation, minus filler words. */
export function tokens(text: string): string[] {
  return rawWords(text).filter(keepWord);
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
