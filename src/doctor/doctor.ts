import { checkProject, type CheckResult } from "../check/check.js";
import { GodotNotFoundError } from "../check/godot.js";
import type { Diagnostic } from "../check/log.js";
import { fixProject } from "../fix/fix.js";
import { bundledLearning } from "../learn/bundled.js";
import { currentLearning } from "../learn/learn.js";
import { emptyLearning } from "../learn/store.js";
import { lessonsForError, lessonsForRule, searchLessons, type LessonHit } from "../lessons/search.js";
import { findProjectRoot, toResPath } from "../project/files.js";
import { reviewProject, type ReviewReport } from "../review/review.js";
import { RULES, type Finding } from "../review/rules.js";
import { ProjectNotFoundError } from "../scan/scan.js";

/**
 * One call that answers "what is wrong here, and in which order do I fix it": the review, Godot itself when it is
 * installed, the lessons that explain what was found, the fixes that can be applied mechanically, and a plan.
 * Problems are grouped by cause, so twenty findings from one missing file are one problem.
 */

export interface DoctorOptions {
  /** Only these res:// files (findings elsewhere are left out). */
  files?: string[];
  /** What the user sees going wrong, in their words: lessons for it are added. */
  symptom?: string;
  /** Run Godot headless too (default: when it is installed). */
  godot?: boolean;
  godotPath?: string;
  timeoutMs?: number;
  /** At most this many problems in full (default 12). */
  limit?: number;
}

export interface Problem {
  severity: "error" | "warning";
  /** Where it was found: Godot, the review, or both. */
  source: "godot" | "review" | "both";
  rule?: string;
  title: string;
  places: string[];
  fix?: string;
  lesson?: { id: string; title: string; fix: string };
  /** A godot_fix can apply it. */
  mechanical?: boolean;
}

export interface DoctorReport {
  project: string;
  godot: "ran" | "not installed" | "skipped" | "failed";
  godotVersion?: string;
  scripts: number;
  scenes: number;
  overall: number;
  problems: Problem[];
  /** Problems beyond the limit, by severity. */
  more: { errors: number; warnings: number };
  fixable: number;
  symptomLessons: { id: string; title: string; fix: string }[];
  next: string[];
}

const lessonOf = (hit: LessonHit | undefined) => (hit ? { id: hit.lesson.id, title: hit.lesson.title, fix: hit.lesson.fix } : undefined);

/** A finding's message with the varying parts (names, numbers, paths) taken out, for grouping. */
function shape(f: Finding): string {
  if (f.rule === "structure/broken-reference") return `${f.rule}|${/res:\/\/\S+|uid:\/\/\S+/.exec(f.message)?.[0] ?? f.message}`;
  return `${f.rule}|${f.message.replace(/"[^"]*"|`[^`]*`|\d+(\.\d+)?/g, "*")}`;
}

function place(file: string, line?: number): string {
  return line ? `${file}:${line}` : file;
}

export async function doctorProject(path: string, options: DoctorOptions = {}): Promise<DoctorReport> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const learning = currentLearning();
  const shared = bundledLearning();
  const focus = options.files?.map((f) => (f.startsWith("res://") ? f : toResPath(root, f)));
  const report: ReviewReport = reviewProject(root, { learning: learning ?? emptyLearning(), shared, ...(focus ? { focus } : {}) });
  const findings = report.findings.filter((f) => f.severity !== "info");

  let check: CheckResult | undefined;
  let godot: DoctorReport["godot"] = options.godot === false ? "skipped" : "ran";
  if (options.godot !== false) {
    try {
      check = await checkProject(root, { godot: options.godotPath, timeoutMs: options.timeoutMs ?? 300_000 });
    } catch (error) {
      godot = error instanceof GodotNotFoundError ? "not installed" : "failed";
    }
  }
  const diagnostics: Diagnostic[] = (check?.diagnostics ?? []).filter((d) => !focus || (d.file && focus.includes(d.file)));

  // Godot's own errors first: they are certain. A review finding on the same line is the same problem.
  const problems: Problem[] = [];
  const reviewed = new Set(findings.map((f) => place(f.file, f.line)));
  const godotPlaces = new Set<string>();
  const byMessage = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const key = `${d.severity}|${d.message.replace(/"[^"]*"|\d+/g, "*")}`;
    byMessage.set(key, [...(byMessage.get(key) ?? []), d]);
  }
  for (const list of byMessage.values()) {
    const d = list[0]!;
    const places = list.map((x) => (x.file ? place(x.file, x.line) : "(engine)"));
    places.forEach((p) => godotPlaces.add(p));
    const lesson = lessonOf(lessonsForError(d.message, { learning, shared, limit: 1 })[0]);
    problems.push({
      severity: d.severity,
      source: places.some((p) => reviewed.has(p)) ? "both" : "godot",
      title: d.message,
      places,
      ...(lesson ? { lesson } : {}),
    });
  }

  // Review findings grouped by cause.
  const fix = fixProject(root, { report, ...(focus ? { files: focus } : {}), includeCheck: true });
  const fixableAt = new Set(fix.changes.map((c) => `${c.rule}|${place(c.file, c.line)}`));
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    if (godotPlaces.has(place(f.file, f.line)) && f.severity === "error") continue;
    const key = shape(f);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  for (const list of groups.values()) {
    const f = list[0]!;
    const rule = RULES[f.rule];
    // A rule's own lesson; for the broad API rules a lesson only when it matches the message itself.
    const lesson = lessonOf(lessonsForRule(f.rule, { learning, shared, limit: 1 })[0] ?? (f.severity === "error" ? lessonsForError(f.message, { learning, shared, limit: 1 })[0] : undefined));
    problems.push({
      severity: f.severity === "error" ? "error" : "warning",
      source: "review",
      rule: f.rule,
      title: list.length > 1 ? `${f.message} (${list.length} places)` : f.message,
      places: list.map((x) => place(x.file, x.line)),
      ...(rule ? { fix: rule.fix } : {}),
      ...(lesson ? { lesson } : {}),
      ...(list.some((x) => fixableAt.has(`${x.rule}|${place(x.file, x.line)}`)) ? { mechanical: true } : {}),
    });
  }

  // Most urgent first: errors, Godot's before the review's, then the biggest groups, then the API before the rest.
  const category = (p: Problem) => ["api", "structure", "performance", "quality"].indexOf(p.rule?.split("/")[0] ?? "api");
  problems.sort(
    (a, b) =>
      (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1) ||
      (a.source === "review" ? 1 : 0) - (b.source === "review" ? 1 : 0) ||
      category(a) - category(b) ||
      b.places.length - a.places.length,
  );
  const limit = options.limit ?? 12;
  const shown = problems.slice(0, limit);
  const rest = problems.slice(limit);

  const symptomLessons = options.symptom ? searchLessons(options.symptom, { learning, shared, limit: 3 }).map((h) => lessonOf(h)!) : [];
  const errors = problems.filter((p) => p.severity === "error").length;
  const next: string[] = [];
  if (problems.some((p) => p.rule === "api/godot3-syntax" || p.rule === "api/shader-renamed" || p.rule === "api/shader-removed-builtin")) next.push("run godot_migrate (report, then write: true): it rewrites the Godot 3 code mechanically");
  if (problems.some((p) => p.rule?.includes("/shader-"))) next.push("after a shader change, run godot_shader: it compiles every shader with Godot headless");
  if (fix.changes.length) next.push(`apply the ${fix.changes.length} mechanical fix${fix.changes.length === 1 ? "" : "es"} with godot_fix (write: true; include_check: true for the ones marked check)`);
  if (errors) next.push(`fix the ${errors} error${errors === 1 ? "" : "s"} in the order shown (godot_review lists those not shown); look up every engine name you change with godot_api`);
  if (problems.some((p) => p.severity === "warning")) next.push("then the warnings that touch what you are building; a lesson says why each matters");
  if (godot === "not installed") next.push("install Godot 4.7 (or set GODOT) so godot_check can confirm the result; until then the review is the only check");
  next.push(problems.length ? "run godot_doctor again to see what is left" : "nothing to fix: build on, and run godot_doctor after the next change");

  return {
    project: report.project,
    godot,
    ...(check ? { godotVersion: check.godotVersion } : {}),
    scripts: report.scripts,
    scenes: report.scenes,
    overall: report.overall,
    problems: shown,
    more: { errors: rest.filter((p) => p.severity === "error").length, warnings: rest.filter((p) => p.severity === "warning").length },
    fixable: fix.changes.length,
    symptomLessons,
    next,
  };
}

export function formatDoctor(d: DoctorReport, detail: "brief" | "full" = "brief"): string {
  const out: string[] = [];
  const errors = d.problems.filter((p) => p.severity === "error").length + d.more.errors;
  const warnings = d.problems.filter((p) => p.severity === "warning").length + d.more.warnings;
  out.push(
    `doctor: ${d.project}: ${errors} problem${errors === 1 ? "" : "s"} to fix, ${warnings} to look at (review ${d.overall}/100, ${d.scripts} scripts, ${d.scenes} scenes; ` +
      (d.godot === "ran" ? `Godot ${d.godotVersion ?? ""} loaded everything` : d.godot === "not installed" ? "Godot not installed: review only" : d.godot === "skipped" ? "Godot skipped" : "Godot could not run") +
      ")",
  );
  d.problems.forEach((p, i) => {
    const where = p.places.slice(0, detail === "full" ? undefined : 4).join(", ") + (p.places.length > 4 && detail !== "full" ? `, +${p.places.length - 4} more` : "");
    out.push(`${i + 1}. ${p.severity}${p.rule ? ` [${p.rule}]` : ""}${p.source === "godot" ? " (Godot)" : p.source === "both" ? " (Godot and review)" : ""}: ${p.title}`);
    out.push(`   at ${where}`);
    if (p.lesson) out.push(`   why: ${p.lesson.title} (lesson ${p.lesson.id})`);
    const fix = p.lesson?.fix ?? p.fix;
    if (fix) out.push(`   fix: ${fix}${p.mechanical ? " (godot_fix can do this)" : ""}`);
    else if (p.mechanical) out.push("   fix: godot_fix can do this");
    if (p.rule === "api/godot3-syntax" || p.rule === "api/shader-renamed" || p.rule === "api/shader-removed-builtin" || /\(Godot 3 name\)|In Godot 4 /.test(p.title)) out.push("   godot_migrate rewrites Godot 3 code like this for the whole project");
  });
  if (d.more.errors || d.more.warnings) out.push(`+${d.more.errors} more errors and ${d.more.warnings} more warnings (godot_review lists them all)`);
  if (!d.problems.length) out.push("No errors or warnings: the review and Godot agree the project is clean.");
  if (d.symptomLessons.length) {
    out.push("For what you described, real projects learned:");
    for (const l of d.symptomLessons) out.push(`  ${l.id}: ${l.title} Fix: ${l.fix}`);
  }
  out.push("Next:");
  d.next.forEach((n, i) => out.push(`  ${i + 1}) ${n}`));
  return `${out.join("\n")}\n`;
}
