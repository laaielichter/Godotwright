import { checkProject, type CheckOptions, type CheckResult } from "../check/check.js";
import { findProjectRoot } from "../project/files.js";
import { formatFinding } from "../review/format.js";
import { reviewProject, type ReviewReport } from "../review/review.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { detectFramework, runTests, testsPassed, type TestReport } from "../test/run.js";
import { formatScenario, loadScenarios, runScenario, type ScenarioResult } from "./scenario.js";

export type StepStatus = "pass" | "fail" | "skip";

export interface CiStep {
  name: "review" | "check" | "test" | "scenarios";
  status: StepStatus;
  /** One line: what ran and what came out. */
  summary: string;
  /** The lines that explain a failure, each with file:line where there is one. */
  details: string[];
}

export interface CiReport {
  project: string;
  ok: boolean;
  steps: CiStep[];
}

export interface CiOptions {
  godot?: string;
  /** Skip the steps that need Godot (check, test, scenarios). */
  noGodot?: boolean;
  /** Also review scripts under res://addons/. */
  includeAddons?: boolean;
  /** Most lines of detail per step (default 10). */
  maxDetails?: number;
  /** The real steps, replaceable in tests. */
  deps?: Partial<CiDeps>;
}

export interface CiDeps {
  review: typeof reviewProject;
  check: (path: string, options: CheckOptions) => Promise<CheckResult>;
  test: typeof runTests;
  scenario: typeof runScenario;
}

const REAL: CiDeps = { review: reviewProject, check: checkProject, test: runTests, scenario: runScenario };

function clip(lines: string[], max: number): string[] {
  return lines.length > max ? [...lines.slice(0, max), `+${lines.length - max} more`] : lines;
}

function reviewStep(report: ReviewReport, max: number): CiStep {
  const errors = report.findings.filter((f) => f.severity === "error");
  return {
    name: "review",
    status: errors.length ? "fail" : "pass",
    summary: `score ${report.overall}/100, ${errors.length} errors, ${report.findings.filter((f) => f.severity === "warning").length} warnings`,
    details: clip(errors.map(formatFinding), max),
  };
}

function checkStep(result: CheckResult, max: number): CiStep {
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  return {
    name: "check",
    status: errors.length ? "fail" : "pass",
    summary: `Godot ${result.godotVersion}: ${result.scripts} scripts and ${result.scenes} scenes loaded, ${result.errors} errors, ${result.warnings} warnings`,
    details: clip(errors.map((d) => `${d.file ?? ""}${d.line ? `:${d.line}` : ""} ${d.message}`.trim()), max),
  };
}

function testStep(report: TestReport, max: number): CiStep {
  const ok = testsPassed(report);
  const lines = report.failures.map((f) => `${f.file ?? f.suite}${f.line ? `:${f.line}` : ""}  ${f.test}  ${f.message}`);
  if (report.output) lines.push(`no test report came out of the run; last output: ${report.output.split("\n").slice(-3).join(" | ")}`);
  return {
    name: "test",
    status: ok ? "pass" : "fail",
    summary: `${report.framework}: ${report.passed} passed, ${report.failed} failed, ${report.errors} errors of ${report.tests}`,
    details: clip(lines, max),
  };
}

function scenarioStep(results: ScenarioResult[], max: number): CiStep {
  const failed = results.filter((r) => !r.ok);
  return {
    name: "scenarios",
    status: failed.length ? "fail" : "pass",
    summary: `${results.length - failed.length} of ${results.length} scenarios passed`,
    details: clip(failed.flatMap((r) => formatScenario(r).split("\n")), max * 2),
  };
}

/**
 * The checks a pull request needs, in one run: review, check, tests and scenarios.
 * A step that has nothing to run (no test framework, no scenario files) is skipped and says why.
 */
export async function runCi(path: string, options: CiOptions = {}): Promise<CiReport> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const deps = { ...REAL, ...options.deps };
  const max = options.maxDetails ?? 10;
  const steps: CiStep[] = [];

  steps.push(reviewStep(deps.review(root, { includeAddons: options.includeAddons }), max));

  const skip = (name: CiStep["name"], why: string): CiStep => ({ name, status: "skip", summary: why, details: [] });
  if (options.noGodot) {
    for (const name of ["check", "test", "scenarios"] as const) steps.push(skip(name, "skipped (--no-godot-checks)"));
  } else {
    steps.push(checkStep(await deps.check(root, { godot: options.godot, includeAddons: options.includeAddons }), max));
    steps.push(detectFramework(root) ? testStep(await deps.test(root, { godot: options.godot, import: false }), max) : skip("test", "no GUT or GdUnit4 in res://addons"));
    const { scenarios } = loadScenarios(root);
    if (!scenarios.length) steps.push(skip("scenarios", "no files in .godotwright/scenarios"));
    else {
      const results: ScenarioResult[] = [];
      for (const { file, scenario } of scenarios) results.push(await deps.scenario(root, file, scenario, { godot: options.godot, import: false }));
      steps.push(scenarioStep(results, max));
    }
  }
  return { project: root, ok: steps.every((s) => s.status !== "fail"), steps };
}

const MARK: Record<StepStatus, string> = { pass: "✅", fail: "❌", skip: "➖" };

/** The receipt: a markdown table a pull request comment or a job summary can show as it is. */
export function formatCi(r: CiReport): string {
  const out = [`## Godotwright: ${r.ok ? "all checks passed" : "checks failed"}`, "", "| Step | Result |", "|---|---|"];
  for (const s of r.steps) out.push(`| ${s.name} | ${MARK[s.status]} ${s.summary} |`);
  for (const s of r.steps.filter((x) => x.details.length)) out.push("", `**${s.name}**`, "", "```", ...s.details, "```");
  return `${out.join("\n")}\n`;
}
