import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { playScene, type PlayReport } from "../play/play.js";
import { findProjectRoot } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";

export const SCENARIO_DIR = ".godotwright/scenarios";

export class ScenarioError extends Error {}

export type Op = "==" | "!=" | ">=" | "<=" | ">" | "<";

/** One claim about the running game: "Hero.position.x >= 100 @ 20" (the frame is optional, default the last one). */
export interface Expectation {
  watch: string;
  op: Op;
  value: string;
  frame?: number;
  text: string;
}

/** A scenario file: run a scene, play an input timeline into it, and check what the game did. */
export interface Scenario {
  /** Defaults to the file name. */
  name: string;
  /** res:// scene; default the main scene. */
  scene?: string;
  input?: string;
  /** Extra values to sample besides the ones the expectations name. */
  watch: string[];
  /** Physics frames to run (default: the last frame an expectation names, else 120). */
  frames?: number;
  expect: Expectation[];
}

export interface ExpectationResult {
  expect: string;
  ok: boolean;
  actual?: string;
  message?: string;
}

export interface ScenarioResult {
  name: string;
  file: string;
  ok: boolean;
  results: ExpectationResult[];
  /** Errors the game raised while it ran. */
  errors: string[];
  finished: boolean;
}

const EXPECT = /^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*(?:@\s*(\d+))?\s*$/;

/** "Hero.health == 2 @ 120" into its parts. The watch may hold spaces only inside parentheses, the value is a number or text. */
export function parseExpectation(text: string): Expectation {
  const m = EXPECT.exec(text);
  if (!m) throw new ScenarioError(`cannot read the expectation "${text}": write it as <Node.property> <==|!=|>=|<=|>|<> <value> [@ frame]`);
  const [, watch, op, value, frame] = m as unknown as [string, string, Op, string, string | undefined];
  return { watch, op, value: value.replace(/^"(.*)"$/, "$1"), ...(frame !== undefined ? { frame: Number(frame) } : {}), text: text.trim() };
}

/** Compares what the game reported with what the scenario expected: as numbers when both are numbers, else as text. */
export function compare(actual: string, op: Op, expected: string): boolean {
  const a = Number(actual);
  const b = Number(expected);
  if (actual.trim() !== "" && expected.trim() !== "" && Number.isFinite(a) && Number.isFinite(b)) {
    switch (op) {
      case "==": return Math.abs(a - b) < 1e-6;
      case "!=": return Math.abs(a - b) >= 1e-6;
      case ">=": return a >= b;
      case "<=": return a <= b;
      case ">": return a > b;
      case "<": return a < b;
    }
  }
  if (op === "==") return actual === expected;
  if (op === "!=") return actual !== expected;
  return false;
}

export function parseScenario(json: unknown, fallbackName: string): Scenario {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new ScenarioError("a scenario is a JSON object");
  const o = json as Record<string, unknown>;
  const strings = (key: string): string[] => {
    const v = o[key];
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ScenarioError(`"${key}" must be a list of strings`);
    return v as string[];
  };
  const text = (key: string): string | undefined => {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string") throw new ScenarioError(`"${key}" must be text`);
    return v;
  };
  const expect = strings("expect").map(parseExpectation);
  if (!expect.length) throw new ScenarioError('a scenario needs at least one entry in "expect"');
  const frames = o.frames;
  if (frames !== undefined && !(typeof frames === "number" && Number.isInteger(frames) && frames > 0)) throw new ScenarioError('"frames" must be a whole number above 0');
  const scene = text("scene");
  const input = text("input");
  return { name: text("name") ?? fallbackName, ...(scene ? { scene } : {}), ...(input ? { input } : {}), watch: strings("watch"), ...(frames ? { frames: frames as number } : {}), expect };
}

/** The scenario files of a project, sorted by name. */
export function loadScenarios(path: string): { root: string; scenarios: { file: string; scenario: Scenario }[] } {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const dir = join(root, SCENARIO_DIR);
  if (!existsSync(dir)) return { root, scenarios: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return {
    root,
    scenarios: files.map((f) => {
      try {
        return { file: `${SCENARIO_DIR}/${f}`, scenario: parseScenario(JSON.parse(readFileSync(join(dir, f), "utf8")), f.replace(/\.json$/, "")) };
      } catch (error) {
        throw new ScenarioError(`${SCENARIO_DIR}/${f}: ${error instanceof SyntaxError || error instanceof ScenarioError ? error.message : String(error)}`);
      }
    }),
  };
}

/** Checks a finished run against the scenario's expectations. */
export function judge(scenario: Scenario, report: PlayReport): ExpectationResult[] {
  const last = report.samples.at(-1)?.frame ?? scenario.frames ?? 0;
  return scenario.expect.map((e) => {
    const frame = e.frame ?? last;
    const sample = report.samples.find((s) => s.frame === frame);
    if (!sample) return { expect: e.text, ok: false, message: `frame ${frame} was not reached` };
    const actual = sample.values[e.watch];
    if (actual === undefined) return { expect: e.text, ok: false, message: `${e.watch} was not sampled` };
    const ok = compare(actual, e.op, e.value);
    return { expect: e.text, ok, actual, ...(ok ? {} : { message: `${e.watch} was ${actual} at frame ${frame}` }) };
  });
}

export interface ScenarioRunOptions {
  godot?: string;
  import?: boolean;
  timeoutMs?: number;
  /** Replaces the real run, for tests. */
  play?: typeof playScene;
}

export async function runScenario(root: string, file: string, scenario: Scenario, options: ScenarioRunOptions = {}): Promise<ScenarioResult> {
  const frames = scenario.frames ?? Math.max(120, ...scenario.expect.map((e) => (e.frame ?? 0) + 1));
  const watch = [...new Set([...scenario.expect.map((e) => e.watch), ...scenario.watch])];
  const report = await (options.play ?? playScene)(root, {
    godot: options.godot,
    ...(scenario.scene ? { scene: scenario.scene } : {}),
    ...(scenario.input ? { input: scenario.input } : {}),
    watch,
    frames,
    every: 1,
    import: options.import,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const results = judge(scenario, report);
  const errors = report.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.file ?? ""}${d.line ? `:${d.line}` : ""} ${d.message}`.trim());
  return { name: scenario.name, file, ok: report.finished && !errors.length && results.every((r) => r.ok), results, errors, finished: report.finished };
}

export function formatScenario(r: ScenarioResult): string {
  const out = [`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.file})`];
  for (const x of r.results) out.push(`  ${x.ok ? "ok  " : "FAIL"} ${x.expect}${x.ok ? "" : `  -> ${x.message}`}`);
  if (!r.finished) out.push("  the run ended before the last frame");
  for (const e of r.errors) out.push(`  error: ${e}`);
  return out.join("\n");
}
