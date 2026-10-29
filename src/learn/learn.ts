import { createHash } from "node:crypto";
import type { GodotApi } from "../api/api.js";
import type { CheckResult } from "../check/check.js";
import type { LearnedData } from "../collector/collector.js";
import type { ReviewReport } from "../review/review.js";
import type { Finding } from "../review/rules.js";
import { learningAllowed, readLearning, ruleStats, updateLearning, type LearningData } from "./store.js";
import { messageTemplate } from "./template.js";

/**
 * Rules whose errors real Godot always reports when it loads a script, so a
 * Godot run can confirm or contradict them.
 */
export const GODOT_CHECKED_RULES = new Set([
  "api/godot3-syntax",
  "api/unknown-type",
  "api/unknown-function",
  "api/unknown-member",
  "api/wrong-arguments",
]);

/** After this many contradictions and no confirmation, a rule's errors become warnings here. */
export const DOWNGRADE_AFTER = 3;

/** The same over all installs (shipped data): contradicted this often, never confirmed. */
export const SHARED_DOWNGRADE_AFTER = 20;

const HINT_NOTE = / \(Godot did not confirm this rule in \d+ checks; treat it as a hint\.\)$/;

/** How long after a failed API lookup a successful one counts as its answer. */
const RESOLVE_WINDOW_MS = 120_000;

/** Stable id of a finding for "this one is wrong" feedback: rule, file and message, not the line. */
export function fingerprint(f: Pick<Finding, "rule" | "file" | "message">): string {
  return createHash("sha256").update(`${f.rule}\n${f.file}\n${f.message}`).digest("hex").slice(0, 24);
}

export interface Adjusted {
  findings: Finding[];
  /** Rules whose errors were downgraded to warnings because Godot kept contradicting them here. */
  downgraded: string[];
  /** Findings hidden because they were marked as wrong. */
  hidden: number;
}

/**
 * Applies what was learned to a list of findings. Pure: no I/O.
 * What this machine saw wins over the shipped data: one local confirmation keeps a rule an error.
 */
export function adjustFindings(findings: Finding[], data: LearningData, shared?: LearnedData): Adjusted {
  const downgraded = new Set<string>();
  let hidden = 0;
  const out: Finding[] = [];
  for (const f of findings) {
    if (data.dismissed[fingerprint(f)]) {
      hidden++;
      continue;
    }
    const contradicted = f.severity === "error" ? contradictions(f.rule, data, shared) : 0;
    if (contradicted) {
      downgraded.add(f.rule);
      out.push({ ...f, severity: "warning", message: `${f.message} (Godot did not confirm this rule in ${contradicted} checks; treat it as a hint.)` });
      continue;
    }
    out.push(f);
  }
  return { findings: out, downgraded: [...downgraded].sort(), hidden };
}

/** How often Godot contradicted a rule that it never confirmed, or 0 when the rule stays an error. */
function contradictions(rule: string, data: LearningData, shared?: LearnedData): number {
  const local = data.rules[rule];
  if (local?.confirmed) return 0;
  if (local && local.contradicted >= DOWNGRADE_AFTER) return local.contradicted;
  const all = shared?.rules[rule];
  if (all && all.confirmed === 0 && all.contradicted >= SHARED_DOWNGRADE_AFTER) return all.contradicted;
  return 0;
}

/** True for a file inside a folder whose name starts with a dot. */
function inDotFolder(file: string): boolean {
  return file
    .replace(/::.*$/, "")
    .replace(/^res:\/\//, "")
    .split("/")
    .slice(0, -1)
    .some((part) => part.startsWith("."));
}

/** Counts which rules fired in a review (once per rule per review). */
export function recordReview(report: Pick<ReviewReport, "findings">): void {
  updateIfAllowed((data) => {
    for (const rule of new Set(report.findings.map((f) => f.rule))) ruleStats(data, rule).reported++;
  });
}

/**
 * Compares a real Godot check with a review of the same project.
 * - A review error in a script Godot loaded cleanly: contradicted.
 * - A review error where Godot reported an error on the same line (±1): confirmed.
 * - A Godot script error in a script with no review error at all: missed by the review.
 * Godot stops at the first error in a script, so other review errors there are not judged.
 */
export function recordCheck(check: CheckResult, review: Pick<ReviewReport, "findings">): void {
  if (!check.steps.some((s) => s.name === "check" && s.exitCode !== null && !s.timedOut)) return;
  if (check.diagnostics.some((d) => d.source === "check" && /checker did not finish/.test(d.message))) return;
  // Godot loaded no script at all (e.g. it could not open the project): nothing to judge.
  if (check.scripts === 0) return;
  const godotErrors = check.diagnostics.filter((d) => d.severity === "error" && d.file?.endsWith(".gd"));
  const errorsByFile = new Map<string, number[]>();
  for (const d of godotErrors) errorsByFile.set(d.file!, [...(errorsByFile.get(d.file!) ?? []), d.line ?? 0]);
  // Godot's checker skips folders whose name starts with a dot: nothing there is judged.
  const judged = review.findings.filter((f) => !inDotFolder(f.file));
  const reviewed = judged.filter((f) => f.severity === "error" && GODOT_CHECKED_RULES.has(f.rule) && f.file.endsWith(".gd") && !f.file.includes("::"));

  updateIfAllowed((data) => {
    for (const f of reviewed) {
      const lines = errorsByFile.get(f.file);
      if (!lines) ruleStats(data, f.rule).contradicted++;
      else if (lines.some((l) => f.line !== undefined && Math.abs(l - f.line) <= 1)) ruleStats(data, f.rule).confirmed++;
    }
    const reviewedFiles = new Set(judged.filter((f) => f.severity === "error").map((f) => f.file));
    for (const d of godotErrors) {
      if (d.source !== "script" || reviewedFiles.has(d.file!)) continue;
      const key = messageTemplate(d.message);
      data.missedByReview[key] = (data.missedByReview[key] ?? 0) + 1;
    }
    for (const d of check.diagnostics) {
      if (d.file || d.source === "scan" || d.source === "engine") continue;
      const key = messageTemplate(d.message);
      data.unparsed[key] = (data.unparsed[key] ?? 0) + 1;
    }
  });
}

/** Remembers failed API lookups and what the next successful lookup was. */
export function recordApiLookup(query: string, found: boolean, now = Date.now()): void {
  const key = query.trim();
  if (!/^@?[A-Za-z_][\w.]{0,80}$/.test(key)) return;
  updateIfAllowed((data) => {
    if (!found) {
      const miss = (data.apiMisses[key] ??= { count: 0, resolved: {} });
      miss.count++;
      data.lastMiss = { query: key, at: now };
      return;
    }
    const last = data.lastMiss;
    if (last && last.query !== key && now - last.at <= RESOLVE_WINDOW_MS) {
      const miss = (data.apiMisses[last.query] ??= { count: 1, resolved: {} });
      miss.resolved[key] = (miss.resolved[key] ?? 0) + 1;
    }
    delete data.lastMiss;
  });
}

/** What a failed lookup most likely meant, from what this machine (and the bundled data) learned. */
export function learnedHints(query: string, api: GodotApi, data: LearningData, bundled: Record<string, Record<string, number>> = {}): string[] {
  const votes = new Map<string, number>();
  for (const [target, n] of Object.entries(data.apiMisses[query.trim()]?.resolved ?? {})) votes.set(target, (votes.get(target) ?? 0) + n);
  for (const [target, n] of Object.entries(bundled[query.trim()] ?? {})) votes.set(target, (votes.get(target) ?? 0) + n);
  return [...votes]
    .filter(([target]) => api.lookup(target).entries.length > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([target]) => target);
}

export type Verdict = "wrong" | "right";

/** Feedback on one finding, e.g. from an agent that verified it. */
export function recordFeedback(finding: Pick<Finding, "rule" | "file" | "message">, verdict: Verdict): void {
  // A downgraded finding carries a note; the fingerprint is of the original message.
  finding = { ...finding, message: finding.message.replace(HINT_NOTE, "") };
  updateIfAllowed((data) => {
    const stats = ruleStats(data, finding.rule);
    if (verdict === "wrong") {
      stats.dismissed++;
      data.dismissed[fingerprint(finding)] = Date.now();
    } else {
      // A verdict from a user or agent is not Godot's confirmation: it never unlocks a downgrade.
      stats.verified = (stats.verified ?? 0) + 1;
    }
  });
}

/** Parses a finding line as printed by `formatFinding` back into its parts. */
export function parseFindingLine(line: string): Pick<Finding, "rule" | "file" | "message" | "line"> | undefined {
  const m = /^(?<file>.+?)(?::(?<line>\d+))?: (?:error|warning|info) \[(?<rule>[\w/-]+)\] (?<message>.*)$/.exec(line.trim());
  if (!m?.groups) return undefined;
  return { file: m.groups["file"]!, line: m.groups["line"] ? Number(m.groups["line"]) : undefined, rule: m.groups["rule"]!, message: m.groups["message"]! };
}

/** Local learning data, or an empty set when learning is off. */
export function currentLearning(): LearningData | undefined {
  const data = readLearning();
  return learningAllowed(data) ? data : undefined;
}

function updateIfAllowed(change: (data: LearningData) => void): void {
  if (process.env["GODOTWRIGHT_LEARN"] === "0") return;
  updateLearning((data) => {
    if (data.enabled) change(data);
  });
}
