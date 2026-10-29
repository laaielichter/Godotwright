import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../project/files.js";
import { ProjectNotFoundError, scanProject } from "../scan/scan.js";
import { GODOT_TARGET } from "../version.js";
import { checkerSource } from "./checker-script.js";
import { findGodot, godotVersion, runGodot, type RunResult } from "./godot.js";
import { MARKER, parseGodotLog, type Diagnostic } from "./log.js";

export interface CheckOptions {
  /** Path to the Godot binary; found automatically when omitted. */
  godot?: string;
  /** Run `--import` first so class names and UIDs are known (default true). */
  import?: boolean;
  /** Instantiate every scene, not only load it (default true). */
  instantiate?: boolean;
  /** Also run the main scene for this many frames (default 0 = off). */
  runFrames?: number;
  /** Run this scene (a res:// path) instead of the main scene; implies 120 frames when runFrames is not set. */
  scene?: string;
  /** Directories to skip, e.g. ["addons"]. */
  exclude?: string[];
  /** Timeout per Godot run in milliseconds (default 10 minutes). */
  timeoutMs?: number;
  /** Keep the raw Godot output of each step in the result. */
  keepLogs?: boolean;
}

export interface CheckStep {
  name: string;
  ms: number;
  exitCode: number | null;
  timedOut: boolean;
}

export interface CheckResult {
  godot: string;
  godotVersion: string;
  scripts: number;
  scenes: number;
  diagnostics: Diagnostic[];
  steps: CheckStep[];
  errors: number;
  warnings: number;
  /** Raw output per step, when `keepLogs` is set. */
  logs?: Record<string, string>;
  /** What the game printed while it ran (print(), push_warning() and friends go to stdout), engine noise removed. */
  output?: string;
}

/** How much of a run's output is kept: the last lines, so a loop that prints every frame does not drown the rest. */
const OUTPUT_LINES = 200;
const OUTPUT_CHARS = 12_000;

/** The game's own prints from a run: engine banners and empty lines removed, the tail kept. */
export function runOutput(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l !== "" && !NOISE.some((re) => re.test(l)));
  const tail = lines.slice(-OUTPUT_LINES);
  const text = tail.join("\n");
  const cut = text.length > OUTPUT_CHARS ? text.slice(-OUTPUT_CHARS) : text;
  return (lines.length > tail.length ? `(first ${lines.length - tail.length} lines left out)\n` : "") + cut;
}

/** Engine messages that say nothing about the project. */
const NOISE = [
  /^Godot Engine v/,
  /^--- Debug adapter server started/,
  /^--- GDScript language server started/,
  /editor_layout\.cfg/,
  /^Detected \d+ monitors?/,
  /^Plugin is not attached to debugger\.?$/,
];

/** Leak reports Godot prints when it exits. */
const EXIT_LEAK =
  /(ObjectDB instances? (were|was) leaked at exit|resources? still in use at exit|RIDs? of type .* (were|was) leaked|Pages in use exist at exit)/;

const CHECKER_DIR = ".godot/godotwright";
const CHECKER_RES = `res://${CHECKER_DIR}/check.gd`;

export async function checkProject(path: string, options: CheckOptions = {}): Promise<CheckResult> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const bin = findGodot(options.godot);
  const version = await godotVersion(bin);
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const diagnostics: Diagnostic[] = [];
  const steps: CheckStep[] = [];
  const logs: Record<string, string> = {};

  if (!version.startsWith(`${GODOT_TARGET}.`)) {
    diagnostics.push({
      severity: "warning",
      message: `Godot ${version} found; Godotwright targets Godot ${GODOT_TARGET}.x`,
      source: "engine",
    });
  }

  for (const w of scanProject(root).warnings) {
    diagnostics.push({ severity: "warning", file: w.file, line: w.line, message: w.message, source: "scan" });
  }

  const run = async (name: string, args: string[]): Promise<RunResult> => {
    const result = await runGodot(bin, ["--headless", "--path", root, ...args], { cwd: root, timeoutMs });
    steps.push({ name, ms: result.ms, exitCode: result.code, timedOut: result.timedOut });
    if (options.keepLogs) logs[name] = `${result.stdout}\n--- stderr ---\n${result.stderr}`;
    if (result.timedOut) {
      diagnostics.push({ severity: "error", message: `${name} timed out after ${Math.round(timeoutMs / 1000)}s`, source: name });
    }
    return result;
  };

  if (options.import !== false) {
    const result = await run("import", ["--import"]);
    diagnostics.push(...parseGodotLog(result.stderr + "\n" + result.stdout, "import"));
  }

  const checkerDir = join(root, ...CHECKER_DIR.split("/"));
  mkdirSync(checkerDir, { recursive: true });
  writeFileSync(
    join(checkerDir, "check.gd"),
    checkerSource({ instantiate: options.instantiate !== false, exclude: options.exclude ?? [] }),
  );
  let scripts = 0;
  let scenes = 0;
  try {
    const result = await run("check", ["--script", CHECKER_RES]);
    const done = new RegExp(`${MARKER}_DONE (\\d+) (\\d+)`).exec(result.stderr);
    if (done) {
      scripts = Number(done[1]);
      scenes = Number(done[2]);
    } else if (!result.timedOut) {
      diagnostics.push({
        severity: "error",
        message: `checker did not finish (exit code ${result.code}); last output: ${tail(result.stderr)}`,
        source: "check",
      });
    }
    for (const d of parseGodotLog(result.stderr, "check")) {
      // The checker exits with resources still cached; those leaks are its own.
      if (d.file === CHECKER_RES || EXIT_LEAK.test(d.message)) continue;
      if (d.source === "check" && d.file) d.source = d.file.endsWith(".gd") ? "script" : "scene";
      diagnostics.push(d);
    }
  } finally {
    rmSync(checkerDir, { recursive: true, force: true });
  }

  const frames = options.runFrames ?? (options.scene ? 120 : 0);
  let output: string | undefined;
  if (frames > 0) {
    const scene = options.scene ? (options.scene.startsWith("res://") ? options.scene : `res://${options.scene.replace(/^\/+/, "")}`) : undefined;
    const result = await run("run", ["--quit-after", String(frames), ...(scene ? [scene] : [])]);
    output = runOutput(result.stdout);
    for (const d of parseGodotLog(result.stderr, "run")) {
      // Stopping after N frames can leave objects alive; report leaks, but not as errors.
      if (EXIT_LEAK.test(d.message)) {
        d.severity = "warning";
        d.message = `at exit: ${d.message}`;
      }
      diagnostics.push(d);
    }
  }

  const clean = cleanup(diagnostics);
  return {
    godot: bin,
    godotVersion: version,
    scripts,
    scenes,
    diagnostics: clean,
    steps,
    errors: clean.filter((d) => d.severity === "error").length,
    warnings: clean.filter((d) => d.severity === "warning").length,
    ...(options.keepLogs ? { logs } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400) || "(none)";
}

const MENTIONED_PATH = /res:\/\/[^\s'"()]+[^\s'"().,:;]/g;

/**
 * Drops noise and repeats, so each root cause is reported once:
 * - follow-up errors that only restate a script error,
 * - vaguer reports of a missing file that Godot also reported with a line.
 */
export function cleanup(diagnostics: Diagnostic[]): Diagnostic[] {
  const kept = diagnostics.filter((d) => !NOISE.some((re) => re.test(d.message)));
  const scriptErrors = new Set(kept.filter((d) => d.source === "script" && d.line).map((d) => d.file));
  const located = new Set<string>();
  for (const d of kept) {
    if (d.severity === "error" && d.line && d.source !== "scan") {
      for (const path of d.message.match(MENTIONED_PATH) ?? []) located.add(path);
    }
  }
  const seen = new Set<string>();
  return kept.filter((d) => {
    const restated = /^Failed to load script "(.+?)" with error/.exec(d.message);
    if (restated && scriptErrors.has(restated[1])) return false;
    const paths = d.message.match(MENTIONED_PATH) ?? [];
    const vague = d.source === "scan" || !d.line;
    if (vague && paths.length > 0 && paths.every((p) => located.has(p))) return false;
    const key = `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
