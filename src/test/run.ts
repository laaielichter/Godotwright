import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findGodot, runGodot } from "../check/godot.js";
import { parseGodotLog, type Diagnostic } from "../check/log.js";
import { runOutput } from "../check/check.js";
import { findProjectRoot } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";

export class TestRunError extends Error {}

export type Framework = "gut" | "gdunit";

export interface TestOptions {
  /** Path to the Godot binary; found automatically when omitted. */
  godot?: string;
  /** Which framework to run; found from res://addons when omitted. */
  framework?: Framework;
  /** Test folders or files (res://). Default: the framework's own config, else res://test and res://tests. */
  paths?: string[];
  /** Only tests whose name contains this text. */
  filter?: string;
  /** Timeout of the test run in milliseconds (default 10 minutes). */
  timeoutMs?: number;
  /** Run `--import` first so class names are known (default true). */
  import?: boolean;
}

export interface TestFailure {
  suite: string;
  test: string;
  /** res:// path of the test script, when known. */
  file?: string;
  line?: number;
  kind: "failure" | "error";
  message: string;
}

export interface TestReport {
  framework: Framework;
  tests: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  /** Seconds the tests took, as the framework reports it. */
  seconds: number;
  failures: TestFailure[];
  /** Script errors and engine errors printed while the tests ran. */
  diagnostics: Diagnostic[];
  exitCode: number | null;
  timedOut: boolean;
  /** The tail of what the run printed, when no report came out of it. */
  output?: string;
}

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1] ?? ""] = decode(m[2] ?? "");
  return out;
}

/** Where a failure points: GdUnit writes res://file.gd:12 in the message, GUT writes "at line 12" in the text. */
function locate(text: string, suiteFile?: string): { file?: string; line?: number } {
  const path = /(res:\/\/[^\s:"']+\.gd):(\d+)/.exec(text);
  if (path) return { file: path[1], line: Number(path[2]) };
  const line = /\bline (\d+)/i.exec(text);
  return { ...(suiteFile ? { file: suiteFile } : {}), ...(line ? { line: Number(line[1]) } : {}) };
}

/** Reads a JUnit XML report as GUT (-gjunit_xml_file) and GdUnit4 (results.xml) write it. */
export function parseJUnit(xml: string): Pick<TestReport, "tests" | "passed" | "failed" | "errors" | "skipped" | "seconds" | "failures"> {
  const failures: TestFailure[] = [];
  let tests = 0;
  let skipped = 0;
  let seconds = 0;
  let failedCases = 0;
  let errorCases = 0;
  for (const suite of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
    const sa = attrs(suite[1] ?? "");
    const suiteName = sa["name"] ?? "";
    // GUT names the suite by its path without res://, GdUnit gives the path as package.
    const suitePath = sa["package"]?.startsWith("res://") ? sa["package"] : /\.gd$/.test(suiteName) ? `res://${suiteName.replace(/^res:\/\//, "")}` : undefined;
    seconds += Number(sa["time"] ?? 0) || 0;
    for (const tc of (suite[2] ?? "").matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      tests++;
      const ca = attrs(tc[1] ?? "");
      const body = tc[2] ?? "";
      if (/<skipped\b/.test(body) || ca["status"] === "pending") {
        skipped++;
        continue;
      }
      const problem = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
      if (!problem) continue;
      const kind = problem[1] === "error" ? "error" : "failure";
      if (kind === "error") errorCases++;
      else failedCases++;
      const pa = attrs(problem[2] ?? "");
      const text = decode(problem[3] ?? "").trim();
      const where = locate(`${pa["message"] ?? ""}\n${text}`, suitePath);
      // GdUnit's message attribute is only "FAILED: path:line"; the text says what went wrong.
      const message = (text || pa["message"] || kind)
        .replace(/\s*at '[^']*' in res:\/\/\S+:\d+\s*$/, "")
        .replace(/\s*at line \d+\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
      failures.push({ suite: suiteName, test: ca["name"] ?? "", ...where, kind, message: message.length > 400 ? `${message.slice(0, 397)}...` : message });
    }
  }
  return { tests, passed: tests - skipped - failedCases - errorCases, failed: failedCases, errors: errorCases, skipped, seconds: Math.round(seconds * 1000) / 1000, failures };
}

const GDUNIT_REPORT = ".godot/godotwright/gdunit-report";

const installed = (root: string, framework: Framework): boolean =>
  existsSync(framework === "gut" ? join(root, "addons", "gut", "gut_cmdln.gd") : join(root, "addons", "gdUnit4", "bin", "GdUnitCmdTool.gd"));

/** The test framework in a project, from its addons folder (GUT first when both are there). */
export function detectFramework(root: string): Framework | undefined {
  return (["gut", "gdunit"] as const).find((f) => installed(root, f));
}

function newestFile(dir: string, name: string): string | undefined {
  let best: { path: string; time: number } | undefined;
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === name) {
        const time = statSync(full).mtimeMs;
        if (!best || time > best.time) best = { path: full, time };
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return best?.path;
}

/**
 * Runs a project's GUT or GdUnit4 tests headless and reads the JUnit report they write, so the result is the
 * failing tests with file:line and message, not pages of runner output.
 */
export async function runTests(path: string, options: TestOptions = {}): Promise<TestReport> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const framework = options.framework ?? detectFramework(root);
  if (!framework) throw new TestRunError("no test framework found: install GUT (res://addons/gut) or GdUnit4 (res://addons/gdUnit4), or pass --framework");
  if (!installed(root, framework))
    throw new TestRunError(`${framework === "gut" ? "GUT (res://addons/gut)" : "GdUnit4 (res://addons/gdUnit4)"} is not installed in this project`);
  const bin = findGodot(options.godot);
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const base = ["--headless", "--path", root];
  if (options.import !== false) await runGodot(bin, [...base, "--import"], { cwd: root, timeoutMs });

  const dirs = options.paths?.length ? options.paths : ["res://test", "res://tests"].filter((d) => existsSync(join(root, d.slice(6))));
  const out = mkdtempSync(join(tmpdir(), "godotwright-test-"));
  try {
    let args: string[];
    let reportFile: () => string | undefined;
    if (framework === "gut") {
      const xml = join(out, "junit.xml");
      const useConfig = !options.paths?.length && existsSync(join(root, ".gutconfig.json"));
      const files = (options.paths ?? []).filter((p) => p.endsWith(".gd"));
      const folders = useConfig ? [] : dirs.filter((p) => !p.endsWith(".gd"));
      if (!useConfig && !folders.length && !files.length) throw new TestRunError("no test folder: make res://test (or res://tests), add a .gutconfig.json, or pass --dir");
      args = [
        "-s",
        "res://addons/gut/gut_cmdln.gd",
        "-gexit",
        "-gdisable_colors",
        `-gjunit_xml_file=${xml}`,
        ...(folders.length ? [`-gdir=${folders.join(",")}`, "-ginclude_subdirs"] : []),
        ...(files.length ? [`-gtest=${files.join(",")}`] : []),
        ...(options.filter ? [`-gunit_test_name=${options.filter}`] : []),
      ];
      reportFile = () => (existsSync(xml) ? xml : undefined);
    } else {
      if (!dirs.length) throw new TestRunError("no test folder: make res://test (or res://tests) or pass --dir");
      if (options.filter) throw new TestRunError("--filter works with GUT only; for GdUnit4 pass the test file with --dir res://test/x_test.gd");
      // GdUnit4 puts a report folder given as an absolute path under the project; inside .godot/ it is out of the way.
      rmSync(join(root, GDUNIT_REPORT), { recursive: true, force: true });
      args = ["-s", "res://addons/gdUnit4/bin/GdUnitCmdTool.gd", "--ignoreHeadlessMode", ...dirs.flatMap((d) => ["-a", d]), "-rd", `res://${GDUNIT_REPORT}`, "-rc", "1"];
      reportFile = () => newestFile(join(root, GDUNIT_REPORT), "results.xml");
    }
    const result = await runGodot(bin, [...base, ...args], { cwd: root, timeoutMs });
    const diagnostics = parseGodotLog(`${result.stderr}\n${result.stdout}`, "test").filter((d) => d.severity === "error" && !/addons\/(gut|gdUnit4)\//.test(d.file ?? ""));
    const file = reportFile();
    const counts = file
      ? parseJUnit(readFileSync(file, "utf8"))
      : { tests: 0, passed: 0, failed: 0, errors: 0, skipped: 0, seconds: 0, failures: [] };
    return {
      framework,
      ...counts,
      diagnostics,
      exitCode: result.code,
      timedOut: result.timedOut,
      ...(file ? {} : { output: runOutput(`${result.stdout}\n${result.stderr}`) }),
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(join(root, GDUNIT_REPORT), { recursive: true, force: true });
  }
}

/** True when the run passed: a report, no failing tests, no errors. */
export const testsPassed = (r: TestReport): boolean => r.output === undefined && !r.timedOut && r.failed === 0 && r.errors === 0 && r.tests > 0;

/** One line of totals, then one line per failing test; passing tests are only counted. */
export function formatTests(r: TestReport): string {
  const name = r.framework === "gut" ? "GUT" : "GdUnit4";
  const out: string[] = [];
  if (r.output !== undefined) {
    out.push(`${name}: no test report came out of the run${r.timedOut ? " (timed out)" : ` (exit code ${r.exitCode})`}; last output:`, r.output);
  } else {
    out.push(
      `${name}: ${r.passed} passed, ${r.failed} failed${r.errors ? `, ${r.errors} errors` : ""}${r.skipped ? `, ${r.skipped} skipped` : ""} of ${r.tests} (${r.seconds}s)${r.tests === 0 ? ": no tests found" : ""}`,
    );
    for (const f of r.failures) out.push(`  ${f.file ?? f.suite}${f.line ? `:${f.line}` : ""}  ${f.test}  ${f.kind === "error" ? "ERROR " : ""}${f.message}`);
  }
  for (const d of r.diagnostics.slice(0, 20)) out.push(`  ${d.file ?? ""}${d.line ? `:${d.line}` : ""}  error: ${d.message}`);
  if (r.diagnostics.length > 20) out.push(`  +${r.diagnostics.length - 20} more errors`);
  return `${out.join("\n")}\n`;
}
