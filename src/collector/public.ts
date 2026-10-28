import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GodotApi } from "../api/api.js";
import { checkProject, type CheckOptions, type CheckResult } from "../check/check.js";
import { recordCheck, recordReview } from "../learn/learn.js";
import { buildReport, type ShareReport } from "../learn/share.js";
import { readLearning } from "../learn/store.js";
import { reviewProject } from "../review/review.js";
import { aggregate, type LearnedData } from "./collector.js";

export type CheckFn = (path: string, options: CheckOptions) => Promise<CheckResult>;

export interface PublicOptions extends CheckOptions {
  /** Replaces the real Godot check (tests). */
  check?: CheckFn;
  log?: (line: string) => void;
}

/**
 * Learns from public projects (the official demos, old and new): each project
 * is reviewed and checked with real Godot as if it were a separate install, and
 * the results are aggregated like shared reports. Costs nothing and holds
 * nothing personal, so no k-anonymity is needed.
 */
export async function learnFromProjects(dirs: string[], options: PublicOptions = {}): Promise<LearnedData> {
  const { check = checkProject, log = () => {}, ...checkOptions } = options;
  const api = GodotApi.load();
  const reports: ShareReport[] = [];
  const home = process.env["GODOTWRIGHT_HOME"];
  try {
    for (const dir of dirs) {
      if (!existsSync(join(dir, "project.godot"))) {
        log(`skip ${dir}: no project.godot`);
        continue;
      }
      // Each project learns in its own state dir, on a copy (Godot writes .godot/).
      const state = mkdtempSync(join(tmpdir(), "godotwright-learn-"));
      process.env["GODOTWRIGHT_HOME"] = state;
      const copy = mkdtempSync(join(tmpdir(), "godotwright-project-"));
      try {
        cpSync(dir, copy, { recursive: true });
        const review = reviewProject(copy);
        recordReview(review);
        const result = await check(copy, checkOptions);
        recordCheck(result, review);
        const data = readLearning();
        const errors = review.findings.filter((f) => f.severity === "error").length;
        log(`${dir}: ${errors} review errors, ${result.errors} Godot errors`);
        const built = buildReport(data, api, randomUUID());
        if (built) reports.push(built.report);
      } catch (error) {
        log(`skip ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        rmSync(copy, { recursive: true, force: true });
        rmSync(state, { recursive: true, force: true });
      }
    }
  } finally {
    if (home === undefined) delete process.env["GODOTWRIGHT_HOME"];
    else process.env["GODOTWRIGHT_HOME"] = home;
  }
  return aggregate(reports, 1);
}
