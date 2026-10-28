import type { GodotApi, LookupResult } from "../api/api.js";
import { checkProject, type CheckOptions, type CheckResult } from "../check/check.js";
import { reviewProject, type ReviewOptions, type ReviewReport } from "../review/review.js";
import { bundledLearning } from "./bundled.js";
import { emptyLearning } from "./store.js";
import { currentLearning, learnedHints, recordApiLookup, recordCheck, recordReview } from "./learn.js";

/**
 * The learning-aware entry points the CLI and the MCP server use.
 * The plain functions (reviewProject, checkProject, api.lookup) stay pure.
 */

export function reviewLearning(path: string, options: ReviewOptions = {}): ReviewReport {
  const learning = currentLearning();
  // Shared knowledge applies even with local learning off; it holds nothing personal.
  const report = reviewProject(path, { ...options, learning: learning ?? emptyLearning(), shared: bundledLearning() });
  if (learning) recordReview(report);
  return report;
}

export async function checkLearning(path: string, options: CheckOptions = {}): Promise<CheckResult> {
  const result = await checkProject(path, options);
  if (currentLearning()) {
    try {
      // Godot did not load scripts in skipped folders, so it cannot judge them.
      const skipped = (options.exclude ?? []).map((dir) => `res://${dir.replace(/^res:\/\/|\/+$/g, "")}/`);
      const review = reviewProject(path);
      recordCheck(result, { findings: review.findings.filter((f) => !skipped.some((s) => f.file.startsWith(s))) });
    } catch {
      // Learning must never break a check.
    }
  }
  return result;
}

export function lookupLearning(api: GodotApi, query: string): { result: LookupResult; hints: string[] } {
  const result = api.lookup(query);
  // A Godot 3 name already gets its Godot 4 name from the bundled renames.
  if (result.renamed) return { result, hints: [] };
  const learning = currentLearning();
  const found = result.entries.length > 0;
  const hints = found ? [] : learnedHints(query, api, learning ?? emptyLearning(), bundledLearning().apiHints);
  if (learning) recordApiLookup(query, found);
  return { result, hints };
}
