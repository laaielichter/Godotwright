import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JournalWriter } from "../journal/journal.js";
import { parseCondition, parseTimeline, playScene, type PlayReport } from "../play/play.js";
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
  /** Stop at the first frame this condition holds; the scenario fails when it never does. */
  until?: string;
  /** Signals to record ("Hero.landed"); a claim on one counts how often it fired up to that frame. */
  signals?: string[];
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
  /** Wall-clock seconds the run took. */
  seconds?: number;
  /** The frame the until condition first held. */
  stoppedAt?: number;
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
  const until = text("until");
  if (until) {
    try {
      parseCondition(until);
    } catch (error) {
      throw new ScenarioError(`"until": ${(error as Error).message}`);
    }
  }
  const signals = strings("signals");
  return {
    name: text("name") ?? fallbackName,
    ...(scene ? { scene } : {}),
    ...(input ? { input } : {}),
    watch: strings("watch"),
    ...(frames ? { frames: frames as number } : {}),
    ...(until ? { until } : {}),
    ...(signals.length ? { signals } : {}),
    expect,
  };
}

/** A scenario as the JSON file holds it: the inverse of parseScenario. */
export function scenarioJson(s: Scenario): Record<string, unknown> {
  return {
    name: s.name,
    ...(s.scene ? { scene: s.scene } : {}),
    ...(s.input ? { input: s.input } : {}),
    ...(s.watch.length ? { watch: s.watch } : {}),
    ...(s.frames ? { frames: s.frames } : {}),
    ...(s.until ? { until: s.until } : {}),
    ...(s.signals?.length ? { signals: s.signals } : {}),
    expect: s.expect.map((e) => e.text),
  };
}

/** Scenarios whose name is `name`, else those whose name contains it; all when no name is given. */
export function pickScenarios<T extends { scenario: Scenario }>(list: T[], name?: string): T[] {
  if (!name) return list;
  const exact = list.filter((s) => s.scenario.name === name);
  return exact.length ? exact : list.filter((s) => s.scenario.name.includes(name));
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
  const results = judgeClaims(scenario.expect, report, scenario.frames, scenario.signals);
  if (scenario.until && report.until?.frame === undefined)
    results.push({ expect: `until ${scenario.until}`, ok: false, message: `never held up to frame ${report.samples.at(-1)?.frame ?? Math.max((scenario.frames ?? 1) - 1, 0)}` });
  return results;
}

/** Claim watches that are values to sample: a recorded signal is counted, not sampled. */
export function sampledWatches(claims: Expectation[], signals: string[] = []): string[] {
  return claims.map((c) => c.watch).filter((w) => !signals.includes(w));
}

/**
 * Checks claims against a play run: each on its frame, or on the last frame that was sampled.
 * A claim on a recorded signal ("Hero.landed >= 1") compares how often it fired up to that frame.
 */
export function judgeClaims(claims: Expectation[], report: PlayReport, frames?: number, signals: string[] = []): ExpectationResult[] {
  const last = report.samples.at(-1)?.frame ?? frames ?? 0;
  return claims.map((e) => {
    const frame = e.frame ?? last;
    const sample = report.samples.find((s) => s.frame === frame);
    if (!sample) return { expect: e.text, ok: false, message: `frame ${frame} was not reached` };
    if (signals.includes(e.watch)) {
      const actual = String((report.signals ?? []).filter((s) => s.signal === e.watch && s.frame <= frame).length);
      const ok = compare(actual, e.op, e.value);
      return { expect: e.text, ok, actual, ...(ok ? {} : { message: `${e.watch} fired ${actual} times by frame ${frame}` }) };
    }
    const actual = sample.values[e.watch];
    if (actual === undefined) return { expect: e.text, ok: false, message: `${e.watch} was not sampled` };
    const ok = compare(actual, e.op, e.value);
    return { expect: e.text, ok, actual, ...(ok ? {} : { message: `${e.watch} was ${actual} at frame ${frame}` }) };
  });
}

/** Claim results as lines for a play report; empty when there were none. */
export function formatClaims(results: ExpectationResult[]): string {
  if (!results.length) return "";
  const failed = results.filter((r) => !r.ok).length;
  const lines = [failed ? `expect: ${failed} of ${results.length} FAILED` : `expect: all ${results.length} hold`];
  for (const r of results) lines.push(`  ${r.ok ? "ok" : "FAILED"}: ${r.expect}${r.ok ? (r.actual !== undefined ? ` (${r.actual})` : "") : ` (${r.message})`}`);
  return `${lines.join("\n")}\n`;
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
  const watch = [...new Set([...sampledWatches(scenario.expect, scenario.signals), ...scenario.watch])];
  const started = Date.now();
  const report = await (options.play ?? playScene)(root, {
    godot: options.godot,
    ...(scenario.scene ? { scene: scenario.scene } : {}),
    ...(scenario.input ? { input: scenario.input } : {}),
    watch,
    frames,
    every: 1,
    ...(scenario.until ? { until: scenario.until } : {}),
    ...(scenario.signals?.length ? { signals: scenario.signals } : {}),
    import: options.import,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const results = judge(scenario, report);
  const errors = report.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.file ?? ""}${d.line ? `:${d.line}` : ""} ${d.message}`.trim());
  return {
    name: scenario.name,
    file,
    ok: report.finished && !errors.length && results.every((r) => r.ok),
    results,
    errors,
    finished: report.finished,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    ...(report.until?.frame !== undefined ? { stoppedAt: report.until.frame } : {}),
  };
}

/** One scenario's result; `brief` puts a passing one on one line. */
export function formatScenario(r: ScenarioResult, options: { brief?: boolean } = {}): string {
  if (r.ok && options.brief) return `PASS  ${r.name}  (${r.results.length} claims)`;
  const out = [`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.file})${r.stoppedAt !== undefined ? `  stopped at frame ${r.stoppedAt} (until)` : ""}`];
  for (const x of r.results) out.push(`  ${x.ok ? "ok  " : "FAIL"} ${x.expect}${x.ok ? "" : `  -> ${x.message}`}`);
  if (!r.finished) out.push("  the run ended before the last frame");
  for (const e of r.errors) out.push(`  error: ${e}`);
  return out.join("\n");
}

/** Several results with a closing count line. */
export function formatScenarios(results: ScenarioResult[], options: { brief?: boolean } = {}): string {
  const failed = results.filter((r) => !r.ok).length;
  return `${[...results.map((r) => formatScenario(r, options)), `${results.length - failed} of ${results.length} scenarios passed`].join("\n")}\n`;
}

/** The scenarios of a project, a few lines each, for an agent to read. */
export function formatScenarioList(list: { file: string; scenario: Scenario }[]): string {
  if (!list.length) return `no scenarios in ${SCENARIO_DIR}\n`;
  const out: string[] = [];
  for (const { scenario: s } of list) {
    const parts = [s.scene ?? "main scene", s.frames ? `${s.frames} frames` : "", s.input ? `input "${s.input}"` : "", s.until ? `until "${s.until}"` : "", s.signals?.length ? `signals ${s.signals.join(", ")}` : ""];
    out.push(`${s.name}: ${parts.filter(Boolean).join("; ")}`);
    for (const e of s.expect) out.push(`  ${e.text}`);
  }
  return `${out.join("\n")}\n`;
}

/** The fields of a scenario file from the arguments of a play run (CLI `signal` or MCP `signals`). */
export function scenarioData(
  name: string,
  o: { scene?: string; input?: string; watch?: string[]; frames?: number; until?: string; signal?: string[]; signals?: string[]; expect?: string[] },
): Record<string, unknown> {
  const signals = o.signals ?? o.signal ?? [];
  return {
    name,
    ...(o.scene ? { scene: o.scene } : {}),
    ...(o.input ? { input: o.input } : {}),
    ...(o.watch?.length ? { watch: o.watch } : {}),
    ...(o.frames ? { frames: o.frames } : {}),
    ...(o.until ? { until: o.until } : {}),
    ...(signals.length ? { signals } : {}),
    expect: o.expect ?? [],
  };
}

export const SCENARIO_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export interface SaveResult {
  /** The run that proved it, or disproved it. */
  result: ScenarioResult;
  /** res:// path relative to the project, when it was written. */
  file?: string;
}

/**
 * Runs a scenario once and, when it passes, writes it to .godotwright/scenarios/<name>.json (through the journal,
 * so godot_undo can take it back). A file that is there already is only replaced with `overwrite`.
 */
export async function saveScenario(path: string, data: Record<string, unknown>, options: ScenarioRunOptions & { overwrite?: boolean } = {}): Promise<SaveResult> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const name = data["name"];
  if (typeof name !== "string" || !SCENARIO_NAME.test(name)) throw new ScenarioError("name must be 1 to 64 letters, digits, _ or -");
  const scenario = parseScenario(data, name);
  if (scenario.input) {
    try {
      parseTimeline(scenario.input);
    } catch (error) {
      throw new ScenarioError(`"input": ${(error as Error).message}`);
    }
  }
  const file = `${SCENARIO_DIR}/${name}.json`;
  const full = join(root, file);
  if (existsSync(full) && !options.overwrite) throw new ScenarioError(`${file} exists; pass overwrite to replace it`);
  // A name must pick one scenario, so another file may not use it in its "name" field.
  const other = loadScenarios(root).scenarios.find((s) => s.scenario.name === name && s.file !== file);
  if (other) throw new ScenarioError(`${other.file} is already called "${name}"; choose another name`);
  const result = await runScenario(root, file, scenario, options);
  if (!result.ok) return { result };
  const json = `${JSON.stringify(scenarioJson(scenario), null, 2)}\n`;
  // The loader must read back what was written.
  parseScenario(JSON.parse(json), name);
  const journal = new JournalWriter(root, "scenario save", name);
  journal.write(full, json);
  journal.commit();
  return { result, file };
}
