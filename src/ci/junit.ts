import { parseJUnit, type TestReport } from "../test/run.js";
import type { CiStep } from "./ci.js";
import type { ScenarioResult } from "./scenario.js";

/**
 * JUnit XML, the test report format GitLab, Jenkins, Azure DevOps and the GitHub test-report actions read.
 * Scenarios become one suite each with a test case per claim; GUT and GdUnit4 suites are kept as the framework
 * wrote them; review and check become test cases of the suite "godotwright".
 */

interface Case {
  classname: string;
  name: string;
  file?: string;
  time?: number;
  failure?: { message: string; text?: string };
  error?: { message: string; text?: string };
  skipped?: string;
}

interface Suite {
  name: string;
  file?: string;
  time?: number;
  cases: Case[];
}

/** Text safe in an XML attribute or element: the five entities escaped, characters XML 1.0 forbids dropped. */
export function escapeXml(s: string): string {
  return s
    // Control characters other than tab and newlines, and the two non-characters, are not allowed in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const attr = (name: string, value: string | number | undefined): string => (value === undefined ? "" : ` ${name}="${escapeXml(String(value))}"`);
const line = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, 500);

function caseXml(c: Case): string {
  const open = `    <testcase${attr("classname", c.classname)}${attr("name", c.name)}${attr("file", c.file)}${attr("time", c.time)}`;
  const body = c.failure
    ? `<failure${attr("message", line(c.failure.message))}${c.failure.text ? `>${escapeXml(c.failure.text)}</failure>` : "/>"}`
    : c.error
      ? `<error${attr("message", line(c.error.message))}${c.error.text ? `>${escapeXml(c.error.text)}</error>` : "/>"}`
      : c.skipped !== undefined
        ? `<skipped${attr("message", line(c.skipped))}/>`
        : "";
  return body ? `${open}>\n      ${body}\n    </testcase>` : `${open}/>`;
}

interface Counts {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
}

function count(cases: Case[]): Counts {
  return {
    tests: cases.length,
    failures: cases.filter((c) => c.failure).length,
    errors: cases.filter((c) => c.error).length,
    skipped: cases.filter((c) => c.skipped !== undefined).length,
  };
}

function suiteXml(s: Suite): string {
  const n = count(s.cases);
  return [
    `  <testsuite${attr("name", s.name)}${attr("tests", n.tests)}${attr("failures", n.failures)}${attr("errors", n.errors)}${attr("skipped", n.skipped)}${attr("time", s.time ?? 0)}${attr("file", s.file)}>`,
    ...s.cases.map(caseXml),
    "  </testsuite>",
  ].join("\n");
}

/** One suite per scenario: a test case per claim, and a case "run" with an error when the game failed or stopped early. */
export function scenarioSuites(results: ScenarioResult[]): Suite[] {
  return results.map((r) => {
    const cases: Case[] = r.results.map((x) => ({
      classname: `scenario.${r.name}`,
      name: x.expect,
      file: r.file,
      ...(x.ok ? {} : { failure: { message: x.message ?? "failed", text: `${x.expect}\n${x.message ?? ""}${x.actual !== undefined ? `\nactual: ${x.actual}` : ""}` } }),
    }));
    const problems = [...r.errors, ...(r.finished ? [] : ["the run ended before the last frame"])];
    if (problems.length) cases.push({ classname: `scenario.${r.name}`, name: "run", file: r.file, error: { message: problems[0]!, text: problems.join("\n") } });
    return { name: `scenario.${r.name}`, file: r.file, ...(r.seconds !== undefined ? { time: r.seconds } : {}), cases };
  });
}

/** The <testsuite> elements of a GUT or GdUnit4 report, as the framework wrote them. */
export function frameworkSuites(xml: string): string[] {
  return [...xml.matchAll(/<testsuite\b[^>]*?(?:\/>|>[\s\S]*?<\/testsuite>)/g)].map((m) => `  ${m[0].trim()}`);
}

/** A test run that left no report (crash, timeout): one case with an error, so the CI test tab shows it. */
function brokenTestSuite(r: TestReport): Suite {
  const why = r.timedOut ? "the test run timed out" : `no test report came out of the run (exit code ${r.exitCode})`;
  return { name: r.framework, cases: [{ classname: r.framework, name: "run", error: { message: why, text: r.output ?? "" } }] };
}

/** Review and check (and a skipped step) as test cases of the suite "godotwright". */
function stepSuite(steps: CiStep[]): Suite | undefined {
  const cases: Case[] = steps
    .filter((s) => s.name === "review" || s.name === "check")
    .map((s) => ({
      classname: "godotwright",
      name: s.name,
      ...(s.status === "fail" ? { failure: { message: s.summary, text: s.details.join("\n") } } : s.status === "skip" ? { skipped: s.summary } : {}),
    }));
  return cases.length ? { name: "godotwright", cases } : undefined;
}

export interface JUnitInput {
  /** ci steps: review and check become test cases. */
  steps?: CiStep[];
  /** A GUT or GdUnit4 run kept with keepXml. */
  tests?: TestReport;
  scenarios?: ScenarioResult[];
}

/** Everything in one <testsuites> document. */
export function toJUnit(input: JUnitInput): string {
  const ours: Suite[] = [];
  const step = input.steps ? stepSuite(input.steps) : undefined;
  if (step) ours.push(step);
  const framework = input.tests?.xml ? frameworkSuites(input.tests.xml) : [];
  if (input.tests && !input.tests.xml) ours.push(brokenTestSuite(input.tests));
  if (input.scenarios) ours.push(...scenarioSuites(input.scenarios));

  const total = ours.reduce<Counts & { time: number }>(
    (t, s) => {
      const n = count(s.cases);
      return { tests: t.tests + n.tests, failures: t.failures + n.failures, errors: t.errors + n.errors, skipped: t.skipped + n.skipped, time: t.time + (s.time ?? 0) };
    },
    { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 },
  );
  if (framework.length) {
    const f = parseJUnit(framework.join("\n"));
    total.tests += f.tests;
    total.failures += f.failed;
    total.errors += f.errors;
    total.skipped += f.skipped;
    total.time += f.seconds;
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="godotwright"${attr("tests", total.tests)}${attr("failures", total.failures)}${attr("errors", total.errors)}${attr("skipped", total.skipped)}${attr("time", Math.round(total.time * 1000) / 1000)}>`,
    ...ours.map(suiteXml),
    ...framework,
    "</testsuites>",
    "",
  ].join("\n");
}
