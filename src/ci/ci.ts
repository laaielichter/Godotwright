import { checkProject, type CheckOptions, type CheckResult } from "../check/check.js";
import { kb } from "../export/contents.js";
import { runExport, type ExportRun } from "../export/run.js";
import { findProjectRoot } from "../project/files.js";
import { formatFinding } from "../review/format.js";
import { reviewProject, type ReviewReport } from "../review/review.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { DIFF_DIR, formatBaseline, loadBaselines, type BaselineResult } from "../screenshot/baseline.js";
import { ScreenshotError, takeScreenshot } from "../screenshot/screenshot.js";
import { detectFramework, runTests, testsPassed, type TestReport } from "../test/run.js";
import { behaviourOk, formatScenario, formatShot, loadScenarios, runScenario, type ScenarioResult } from "./scenario.js";

export type StepStatus = "pass" | "fail" | "skip";

export interface CiStep {
  name: "review" | "check" | "test" | "scenarios" | "export" | "visual";
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
  /** The full results behind the test and scenario steps (only with keepResults), e.g. for JUnit XML. */
  results?: { tests?: TestReport; scenarios?: ScenarioResult[] };
}

export interface CiOptions {
  godot?: string;
  /** Skip the steps that need Godot (check, test, scenarios, visual). */
  noGodot?: boolean;
  /** Also review scripts under res://addons/. */
  includeAddons?: boolean;
  /** Also export this preset as a pack, check what it holds and run it (the export step). */
  exportPreset?: string;
  /** Folder of the screenshot baselines (default .godotwright/baselines). */
  baselineDir?: string;
  /** Most lines of detail per step (default 10). */
  maxDetails?: number;
  /** Keep the full test and scenario results in the report (`results`), with the framework's JUnit XML. */
  keepResults?: boolean;
  /** The real steps, replaceable in tests. */
  deps?: Partial<CiDeps>;
}

export interface CiDeps {
  review: typeof reviewProject;
  check: (path: string, options: CheckOptions) => Promise<CheckResult>;
  test: typeof runTests;
  scenario: typeof runScenario;
  export: (path: string, options: Parameters<typeof runExport>[1]) => Promise<ExportRun>;
  screenshot: typeof takeScreenshot;
}

const REAL: CiDeps = { review: reviewProject, check: checkProject, test: runTests, scenario: runScenario, export: (path, options) => runExport(path, options), screenshot: takeScreenshot };

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

/** The scenarios judged on what the game did; their screenshots go to the visual step. */
function scenarioStep(results: ScenarioResult[], max: number): CiStep {
  const failed = results.filter((r) => !behaviourOk(r));
  return {
    name: "scenarios",
    status: failed.length ? "fail" : "pass",
    summary: `${results.length - failed.length} of ${results.length} scenarios passed`,
    details: clip(failed.flatMap((r) => formatScenario(r, { screenshots: false }).split("\n")), max * 2),
  };
}

/** One picture checked against its baseline: a screenshot baseline, or a screenshot step of a scenario. */
type Visual = { result?: BaselineResult; lines: string[] };

function visualStep(visuals: Visual[], max: number): CiStep {
  const failed = visuals.filter((v) => !v.result?.ok);
  const blank = visuals.filter((v) => v.result?.blank).length;
  const changed = visuals.filter((v) => v.result?.status === "changed");
  const lines = failed.flatMap((v) => v.lines);
  if (changed.length) lines.push(`diff pictures (changed pixels red) and new captures are in ${DIFF_DIR}/`);
  return {
    name: "visual",
    status: failed.length ? "fail" : "pass",
    summary: `${visuals.length - failed.length} of ${visuals.length} baselines unchanged${changed.length ? `, ${changed.length} changed` : ""}${blank ? `, ${blank} blank` : ""}`,
    details: clip(lines, max * 2),
  };
}

function exportStep(r: ExportRun, max: number): CiStep {
  const errors = r.diagnostics.filter((d) => d.severity === "error");
  const parts = [
    r.pack ? `${r.pack.files} files, ${kb(r.pack.bytes)}` : "no pack",
    r.contents?.needed ? `${r.contents.needed - r.contents.missing} of ${r.contents.needed} loaded files in it` : "",
    r.smoke ? `ran ${r.smoke.frames} frames: ${r.smoke.errors} errors` : "",
  ].filter(Boolean);
  return {
    name: "export",
    status: errors.length ? "fail" : "pass",
    summary: `pack of ${r.preset?.name ?? "?"}: ${parts.join(", ")}`,
    details: clip(errors.map((d) => `${d.file ?? ""}${d.line ? `:${d.line}` : ""} ${d.message}`.trim()), max),
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
  const kept: NonNullable<CiReport["results"]> = {};

  steps.push(reviewStep(deps.review(root, { includeAddons: options.includeAddons }), max));

  const skip = (name: CiStep["name"], why: string): CiStep => ({ name, status: "skip", summary: why, details: [] });
  if (options.noGodot) {
    for (const name of ["check", "test", "scenarios", "visual"] as const) steps.push(skip(name, "skipped (--no-godot-checks)"));
    if (options.exportPreset) steps.push(skip("export", "skipped (--no-godot-checks)"));
  } else {
    steps.push(checkStep(await deps.check(root, { godot: options.godot, includeAddons: options.includeAddons }), max));
    if (detectFramework(root)) {
      const tests = await deps.test(root, { godot: options.godot, import: false, ...(options.keepResults ? { keepXml: true } : {}) });
      kept.tests = tests;
      steps.push(testStep(tests, max));
    } else steps.push(skip("test", "no GUT or GdUnit4 in res://addons"));
    const { scenarios } = loadScenarios(root);
    const visuals: Visual[] = [];
    if (!scenarios.length) steps.push(skip("scenarios", "no files in .godotwright/scenarios"));
    else {
      const results: ScenarioResult[] = [];
      // A missing baseline fails in CI: a baseline made on the runner would be thrown away with it.
      for (const { file, scenario } of scenarios) results.push(await deps.scenario(root, file, scenario, { godot: options.godot, import: false, createMissing: false }));
      kept.scenarios = results;
      steps.push(scenarioStep(results, max));
      for (const r of results) for (const shot of r.screenshots ?? []) visuals.push({ result: shot, lines: [`${r.file}:`, ...formatShot(shot, "run `godotwright scenario --update`")] });
    }
    const dir = options.baselineDir;
    const dirFlag = dir ? ` --baseline-dir ${dir}` : "";
    for (const { name } of loadBaselines(root, dir).filter((b) => !b.meta.scenario)) {
      try {
        const report = await deps.screenshot(root, { godot: options.godot, baseline: name, createMissing: false, ...(dir ? { baselineDir: dir } : {}) });
        if (report.baseline) visuals.push({ result: report.baseline, lines: formatBaseline(report.baseline, `run \`godotwright screenshot --baseline ${name}${dirFlag} --update-baseline\``) });
      } catch (error) {
        if (!(error instanceof ScreenshotError)) throw error;
        visuals.push({ lines: [`baseline ${name}: NOT COMPARED: ${error.message}`] });
      }
    }
    steps.push(visuals.length ? visualStep(visuals, max) : skip("visual", `no baselines in ${dir ?? ".godotwright/baselines"}`));
    if (options.exportPreset) steps.push(exportStep(await deps.export(root, { preset: options.exportPreset, mode: "pack", import: false, ...(options.godot ? { godot: options.godot } : {}) }), max));
  }
  return { project: root, ok: steps.every((s) => s.status !== "fail"), steps, ...(options.keepResults ? { results: kept } : {}) };
}

const MARK: Record<StepStatus, string> = { pass: "✅", fail: "❌", skip: "➖" };

/** The receipt: a markdown table a pull request comment or a job summary can show as it is. */
export function formatCi(r: CiReport): string {
  const out = [`## Godotwright: ${r.ok ? "all checks passed" : "checks failed"}`, "", "| Step | Result |", "|---|---|"];
  for (const s of r.steps) out.push(`| ${s.name} | ${MARK[s.status]} ${s.summary} |`);
  for (const s of r.steps.filter((x) => x.details.length)) out.push("", `**${s.name}**`, "", "```", ...s.details, "```");
  return `${out.join("\n")}\n`;
}
