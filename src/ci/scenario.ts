import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { playScene, type PlayReport } from "../play/play.js";
import { findProjectRoot } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { BaselineError, baselineFiles, baselineName, compareBaseline, formatBaseline, readBaselineMeta, type BaselineResult } from "../screenshot/baseline.js";

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
  /** Physics frames to run (default: the last frame an expectation or screenshot names, else 120). */
  frames?: number;
  expect: Expectation[];
  /** Pictures to take during the run and compare with their baselines: "hud @ 60", or an object with a tolerance. */
  screenshots: ScreenshotStep[];
  /** Window size for the screenshots (default: the first baseline's, else 640x360). */
  size?: { width: number; height: number };
}

export interface ScreenshotStep {
  /** Baseline name (.godotwright/baselines/<name>.png). */
  name: string;
  frame: number;
  tolerance?: number;
  maxChanged?: number;
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
  /** The screenshot steps, each compared with its baseline. */
  screenshots?: (BaselineResult & { frame: number })[];
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
  const screenshots = parseScreenshots(o.screenshots);
  if (!expect.length && !screenshots.length) throw new ScenarioError('a scenario needs at least one entry in "expect" or "screenshots"');
  let size: Scenario["size"];
  if (o.size !== undefined) {
    const m = typeof o.size === "string" ? /^(\d+)x(\d+)$/.exec(o.size) : null;
    if (!m) throw new ScenarioError('"size" must be WIDTHxHEIGHT, e.g. "640x360"');
    size = { width: Number(m[1]), height: Number(m[2]) };
  }
  const frames = o.frames;
  if (frames !== undefined && !(typeof frames === "number" && Number.isInteger(frames) && frames > 0)) throw new ScenarioError('"frames" must be a whole number above 0');
  const scene = text("scene");
  const input = text("input");
  return { name: text("name") ?? fallbackName, ...(scene ? { scene } : {}), ...(input ? { input } : {}), watch: strings("watch"), ...(frames ? { frames: frames as number } : {}), expect, screenshots, ...(size ? { size } : {}) };
}

/** "hud @ 60" or {"name": "hud", "frame": 60, "tolerance": 24, "maxChanged": 0.5}. */
function parseScreenshots(value: unknown): ScreenshotStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ScenarioError('"screenshots" must be a list');
  const steps = value.map((v): ScreenshotStep => {
    if (typeof v === "string") {
      const m = /^\s*(.+?)\s*@\s*(\d+)\s*$/.exec(v);
      if (!m) throw new ScenarioError(`cannot read the screenshot "${v}": write it as <name> @ <frame>, e.g. "hud @ 60"`);
      return { name: m[1]!, frame: Number(m[2]) };
    }
    if (typeof v !== "object" || v === null) throw new ScenarioError('a screenshot is "<name> @ <frame>" or an object with name and frame');
    const o = v as Record<string, unknown>;
    if (typeof o.name !== "string" || !(typeof o.frame === "number" && Number.isInteger(o.frame) && o.frame >= 0)) throw new ScenarioError("a screenshot object needs a name and a whole frame number");
    const num = (k: string, max: number): number | undefined => {
      const n = o[k];
      if (n === undefined) return undefined;
      if (typeof n !== "number" || n < 0 || n > max) throw new ScenarioError(`screenshot ${o.name}: "${k}" must be a number from 0 to ${max}`);
      return n;
    };
    const tolerance = num("tolerance", 255);
    const maxChanged = num("maxChanged", 100);
    return { name: o.name, frame: o.frame as number, ...(tolerance !== undefined ? { tolerance } : {}), ...(maxChanged !== undefined ? { maxChanged } : {}) };
  });
  const names = new Set<string>();
  for (const s of steps) {
    let safe: string;
    try {
      safe = baselineName(s.name);
    } catch (error) {
      throw new ScenarioError((error as Error).message);
    }
    if (names.has(safe)) throw new ScenarioError(`two screenshots are called ${s.name}`);
    names.add(safe);
  }
  return steps;
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
  return judgeClaims(scenario.expect, report, scenario.frames);
}

/** Checks claims against a play run: each on its frame, or on the last frame that was sampled. */
export function judgeClaims(claims: Expectation[], report: PlayReport, frames?: number): ExpectationResult[] {
  const last = report.samples.at(-1)?.frame ?? frames ?? 0;
  return claims.map((e) => {
    const frame = e.frame ?? last;
    const sample = report.samples.find((s) => s.frame === frame);
    if (!sample) return { expect: e.text, ok: false, message: `frame ${frame} was not reached` };
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
  /** Replace the screenshot baselines with this run's pictures. */
  update?: boolean;
  /** Make missing baselines (default true); CI passes false, so a missing one fails. */
  createMissing?: boolean;
  /** Replaces the real run, for tests. */
  play?: typeof playScene;
}

export async function runScenario(root: string, file: string, scenario: Scenario, options: ScenarioRunOptions = {}): Promise<ScenarioResult> {
  const frames = scenario.frames ?? Math.max(120, ...scenario.expect.map((e) => (e.frame ?? 0) + 1), ...scenario.screenshots.map((s) => s.frame + 1));
  const watch = [...new Set([...scenario.expect.map((e) => e.watch), ...scenario.watch])];
  const shots = scenario.screenshots.map((s) => ({ ...s, name: baselineName(s.name) }));
  const first = shots.map((s) => readBaselineMeta(root, s.name)).find((m) => m);
  const size = scenario.size ?? (first ? { width: first.width, height: first.height } : { width: 640, height: 360 });
  const captures = shots.filter((s) => s.frame < frames).map((s) => ({ frame: s.frame, out: baselineFiles(root, s.name).actual }));
  const report = await (options.play ?? playScene)(root, {
    godot: options.godot,
    ...(scenario.scene ? { scene: scenario.scene } : {}),
    ...(scenario.input ? { input: scenario.input } : {}),
    watch,
    frames,
    every: 1,
    import: options.import,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(captures.length ? { captures, size } : {}),
  });
  const results = judge(scenario, report);
  const errors = report.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.file ?? ""}${d.line ? `:${d.line}` : ""} ${d.message}`.trim());
  const screenshots = shots.map((s): BaselineResult & { frame: number } => {
    const files = baselineFiles(root, s.name);
    const taken = report.captures?.find((c) => c.frame === s.frame);
    const missing = (why: string): BaselineResult & { frame: number } => ({ name: s.name, frame: s.frame, status: "failed", ok: false, baseline: `.godotwright/baselines/${s.name}.png`, actual: "", notes: [why] });
    if (!taken) return missing(s.frame >= frames ? `frame ${s.frame} is after the last frame (${frames - 1})` : `no picture of frame ${s.frame}: the run ended before it`);
    try {
      const r = compareBaseline(root, s.name, taken.file, {
        ...(options.update ? { update: true } : {}),
        ...(options.createMissing === false ? { createMissing: false } : {}),
        ...(s.tolerance !== undefined ? { tolerance: s.tolerance } : {}),
        ...(s.maxChanged !== undefined ? { maxChanged: s.maxChanged } : {}),
        meta: {
          ...(report.scene ? { scene: report.scene } : {}),
          width: size.width,
          height: size.height,
          frames: s.frame,
          scenario: file,
          renderer: "gl_compatibility",
          ...(report.godot ? { godot: report.godot } : {}),
          ...(report.adapter ? { adapter: report.adapter } : {}),
        },
      });
      return { ...r, frame: s.frame };
    } catch (error) {
      if (!(error instanceof BaselineError)) throw error;
      return { ...missing(error.message), actual: files.actual };
    }
  });
  const behaviour = report.finished && !errors.length && results.every((r) => r.ok);
  return { name: scenario.name, file, ok: behaviour && screenshots.every((s) => s.ok), results, ...(screenshots.length ? { screenshots } : {}), errors, finished: report.finished };
}

/** True when the game did what the scenario expects, leaving its screenshots out (CI reports those as visual changes). */
export function behaviourOk(r: ScenarioResult): boolean {
  return r.finished && !r.errors.length && r.results.every((x) => x.ok);
}

export function formatScenario(r: ScenarioResult, options: { screenshots?: boolean; accept?: string } = {}): string {
  const visual = options.screenshots !== false;
  const ok = visual ? r.ok : behaviourOk(r);
  const out = [`${ok ? "PASS" : "FAIL"}  ${r.name}  (${r.file})`];
  for (const x of r.results) out.push(`  ${x.ok ? "ok  " : "FAIL"} ${x.expect}${x.ok ? "" : `  -> ${x.message}`}`);
  if (visual) for (const s of r.screenshots ?? []) out.push(...formatShot(s, options.accept));
  if (!r.finished) out.push("  the run ended before the last frame");
  for (const e of r.errors) out.push(`  error: ${e}`);
  return out.join("\n");
}

/** A screenshot step as scenario lines: "ok   screenshot hud @ 60 (same)", then the diff when it changed. */
export function formatShot(s: BaselineResult & { frame: number }, accept = "run again with --update"): string[] {
  const [head = "", ...rest] = formatBaseline(s, accept);
  const verdict = head.replace(/^baseline \S+: /, "");
  return [`  ${s.ok ? "ok  " : "FAIL"} screenshot ${s.name} @ ${s.frame} (${verdict})`, ...rest.map((l) => `  ${l}`)];
}
