import { readFileSync } from "node:fs";
import type { LearnedData } from "../collector/collector.js";

const DATA_URL = new URL("../../data/learned.json", import.meta.url);

export function emptyLearned(): LearnedData {
  return { version: 1, installs: 0, apiHints: {}, rules: {}, missedByReview: {} };
}

let cached: LearnedData | undefined;

/** What many installs learned, shipped in data/learned.json. Empty when missing or broken. */
export function bundledLearning(): LearnedData {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(DATA_URL, "utf8")) as LearnedData;
    cached = parsed.version === 1 ? { ...emptyLearned(), ...parsed } : emptyLearned();
  } catch {
    cached = emptyLearned();
  }
  return cached;
}
