/**
 * Structured results (MCP `structuredContent`) for the tools that report findings: one compact item shape for the
 * review, Godot's diagnostics, the doctor's problems and failing tests, capped like the text next to it. The text
 * stays the same, for clients that only read text.
 */
import { z } from "zod";
import type { Diagnostic } from "../check/log.js";
import type { CheckResult } from "../check/check.js";
import type { CompareResult } from "../check/compare.js";
import type { DoctorReport } from "../doctor/doctor.js";
import type { Finding } from "../review/rules.js";
import type { ReviewReport } from "../review/review.js";
import type { TestReport } from "../test/run.js";

// Plain numbers: z.number().int() adds safe-integer bounds to every count in the listed JSON schema.
const item = z.object({
  file: z.string().optional(),
  line: z.number().optional(),
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string().optional(),
  message: z.string(),
  source: z.string().optional(),
  count: z.number().optional(),
});
export type Item = z.infer<typeof item>;

const common = {
  ok: z.boolean(),
  errors: z.number(),
  warnings: z.number(),
  findings: z.array(item),
  /** Findings left out by the cap. */
  truncated: z.number(),
};

export const ReviewOutput = {
  ...common,
  project: z.string(),
  overall: z.number(),
  categories: z.record(z.string(), z.number()),
};
export const CheckOutput = {
  ...common,
  godotVersion: z.string().optional(),
  scripts: z.number().optional(),
  scenes: z.number().optional(),
  shaderFiles: z.number().optional(),
  /** With `shaders: true`: the shaders drawn on the Compatibility renderer. */
  shaders: z.object({ compiled: z.number(), parsed: z.number(), notReached: z.number(), errors: z.number(), renderer: z.string() }).optional(),
  frames: z.number().optional(),
};
export const DoctorOutput = {
  ...common,
  godot: z.enum(["ran", "not installed", "skipped", "failed"]),
  overall: z.number(),
  next: z.array(z.string()),
};
export const TestOutput = {
  ...common,
  framework: z.enum(["gut", "gdunit"]),
  tests: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
};

export const schemas = {
  review: z.object(ReviewOutput),
  check: z.object(CheckOutput),
  doctor: z.object(DoctorOutput),
  test: z.object(TestOutput),
};

const strip = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function fromFinding(f: Finding): Item {
  return strip({ file: f.file, line: f.line, severity: f.severity, rule: f.rule, message: f.message });
}

function fromDiagnostic(d: Diagnostic): Item {
  return strip({ file: d.file, line: d.line, severity: d.severity, rule: d.rule, message: d.message, source: d.source, count: d.count });
}

function capped(items: Item[], cap: number) {
  const errors = items.filter((i) => i.severity === "error").length;
  const warnings = items.filter((i) => i.severity === "warning").length;
  return { errors, warnings, findings: items.slice(0, cap), truncated: Math.max(0, items.length - cap) };
}

/** The review: scores and the findings the text lists (same focus and info filter), capped. */
export function reviewData(report: ReviewReport, list: Finding[], cap: number): z.infer<typeof schemas.review> {
  const counts = capped(list.map(fromFinding), cap);
  return {
    ok: counts.errors === 0,
    ...counts,
    project: report.project,
    overall: report.overall,
    categories: Object.fromEntries(report.categories.map((c) => [c.category, c.score])),
  };
}

export function checkData(result: CheckResult, cap: number): z.infer<typeof schemas.check> {
  const counts = capped(result.diagnostics.map(fromDiagnostic), cap);
  return strip({
    ok: result.errors === 0,
    ...counts,
    errors: result.errors,
    warnings: result.warnings,
    godotVersion: result.godotVersion,
    scripts: result.scripts,
    scenes: result.scenes,
    shaderFiles: result.shaderFiles,
    shaders: result.shaders,
    frames: result.ran?.frames,
  });
}

/** compare_godot: only what the second binary reports and the first does not. */
export function compareData(compared: CompareResult, cap: number): z.infer<typeof schemas.check> {
  const counts = capped(compared.onlyOther.map(fromDiagnostic), cap);
  return { ok: counts.errors === 0, ...counts, godotVersion: compared.other.godotVersion };
}

/** Each problem as one item at its first place; `count` is how many places share the cause. */
export function doctorData(report: DoctorReport, cap: number): z.infer<typeof schemas.doctor> {
  const items = report.problems.map((p): Item => {
    const where = /^(.*?)(?::(\d+))?$/.exec(p.places[0] ?? "");
    return strip({
      file: where?.[1] || undefined,
      line: where?.[2] ? Number(where[2]) : undefined,
      severity: p.severity,
      rule: p.rule,
      message: p.title,
      source: p.source,
      count: p.places.length > 1 ? p.places.length : undefined,
    });
  });
  const counts = capped(items, cap);
  const errors = counts.errors + report.more.errors;
  return {
    ok: errors === 0,
    ...counts,
    errors,
    warnings: counts.warnings + report.more.warnings,
    truncated: counts.truncated + report.more.errors + report.more.warnings,
    godot: report.godot,
    overall: report.overall,
    next: report.next,
  };
}

/** Failing tests first (rule "test/failure" or "test/error"), then what the engine printed during the run. */
export function testData(report: TestReport, passed: boolean, cap: number): z.infer<typeof schemas.test> {
  const items: Item[] = [
    ...report.failures.map((f) =>
      strip({ file: f.file, line: f.line, severity: "error" as const, rule: `test/${f.kind}`, message: `${f.suite}.${f.test}: ${f.message}`, source: "test" }),
    ),
    ...report.diagnostics.map(fromDiagnostic),
  ];
  return {
    ok: passed,
    ...capped(items, cap),
    framework: report.framework,
    tests: report.tests,
    passed: report.passed,
    failed: report.failed + report.errors,
    skipped: report.skipped,
  };
}
