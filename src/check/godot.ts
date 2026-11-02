import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { basename, delimiter, join, resolve as resolvePath } from "node:path";
import { CancelledError, ProgressParser, currentRun, phaseOf, throttle } from "./progress.js";

export class GodotNotFoundError extends Error {
  constructor() {
    super(
      "Godot not found. Pass --godot <path>, set the GODOT environment variable, or put godot on your PATH " +
        "(also searched: the usual install folders, Steam, Downloads and Desktop).",
    );
    this.name = "GodotNotFoundError";
  }
}

const NAMES = ["godot", "godot4", "Godot", "godot4.7", "godot-4.7"];

// Official downloads are named like Godot_v4.7.2-stable_linux.x86_64 or Godot_v4.7.2-stable_win64_console.exe.
const OFFICIAL = /^Godot_v4\.(\d+)(?:\.(\d+))?-stable_(?:mono_)?(?:linux\.(?:x86_64|arm64)|win64(_console)?\.exe)$/;
// Steam ships the editor as e.g. godot.windows.opt.tools.64.exe.
const STEAM = /^godot\.(?:windows|linuxbsd|x11)\.[\w.]*64(\.console)?(?:\.exe)?$/i;

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The folders on PATH, in order. */
function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  return (env["PATH"] ?? env["Path"] ?? "").split(platform === "win32" ? ";" : delimiter).filter(Boolean);
}

/** The first executable with a bare command name (no folder part) on PATH, as the shell would find it. */
function onPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const exts = platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of pathDirs(env, platform)) {
    for (const ext of exts) {
      const path = join(dir, name + ext);
      if (isExecutable(path)) return path;
    }
  }
  return undefined;
}

/** Sort key for a Godot download: minor, patch, console build first. */
function rank(name: string): number[] | undefined {
  const official = OFFICIAL.exec(name);
  if (official) return [Number(official[1]), Number(official[2] ?? 0), official[3] ? 1 : 0];
  const steam = STEAM.exec(name);
  return steam ? [0, 0, steam[1] ? 1 : 0] : undefined;
}

function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** The Godot binary in a folder: a plain name, else the newest Godot 4 download, also inside Godot* subfolders. */
function godotIn(dir: string, platform: NodeJS.Platform, subfolders: boolean): string | undefined {
  const exts = platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const name of NAMES) {
    for (const ext of exts) {
      const path = join(dir, name + ext);
      if (isExecutable(path)) return path;
    }
  }
  let best: { path: string; key: number[] } | undefined;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!subfolders || !/^godot/i.test(entry.name)) continue;
        const inner = godotIn(path, platform, false);
        const key = inner ? rank(basename(inner)) : undefined;
        if (inner && key && (!best || newer(key, best.key))) best = { path: inner, key };
        continue;
      }
      const key = rank(entry.name);
      if (key && (!best || newer(key, best.key)) && isExecutable(path)) best = { path, key };
    }
  } catch {
    // Missing or unreadable folder.
  }
  return best?.path;
}

/** Folders people usually keep Godot in, per platform. */
function installDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const home = platform === "win32" ? (env["USERPROFILE"] ?? env["HOME"]) : env["HOME"];
  const inHome = (...parts: string[]) => (home ? [join(home, ...parts)] : []);
  if (platform === "win32") {
    const programs = [env["ProgramFiles"], env["ProgramFiles(x86)"]].filter((p): p is string => Boolean(p));
    return [
      ...programs.map((p) => join(p, "Godot")),
      ...programs.map((p) => join(p, "Steam", "steamapps", "common", "Godot Engine")),
      ...(env["LOCALAPPDATA"] ? [join(env["LOCALAPPDATA"], "Programs", "Godot")] : []),
      ...inHome("scoop", "apps", "godot", "current"),
      "C:\\Godot",
      ...inHome("Godot"),
      ...inHome("Downloads"),
      ...inHome("Desktop"),
      ...inHome("Documents"),
      ...(home ? [home] : []),
    ];
  }
  if (platform === "darwin") return [...inHome("Applications"), ...inHome("Downloads")];
  return [
    ...inHome(".local", "share", "Steam", "steamapps", "common", "Godot Engine"),
    ...inHome("Applications"),
    ...inHome("Godot"),
    ...inHome("Downloads"),
    ...inHome("Desktop"),
    "/opt/godot",
  ];
}

/** Finds the Godot binary: explicit path, then $GODOT / $GODOT_BIN, then PATH, then common install spots. Always absolute. */
export function findGodot(explicit?: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  for (const candidate of [explicit, env["GODOT"], env["GODOT_BIN"]]) {
    // A host that fills $GODOT from an empty setting may pass the unexpanded `${...}` placeholder: treat it as unset.
    if (candidate && !candidate.startsWith("${")) {
      // A bare name such as "godot" is looked up on PATH; a path is checked where it points.
      const bare = !/[\\/]/.test(candidate);
      const found = bare ? onPath(candidate, env, platform) : isExecutable(candidate) ? candidate : undefined;
      if (found) return resolvePath(found);
      throw new Error(`Godot binary not found or not executable: ${candidate}`);
    }
  }
  for (const dir of pathDirs(env, platform)) {
    const found = godotIn(dir, platform, false);
    if (found) return resolvePath(found);
  }
  if (platform === "darwin") {
    for (const app of ["/Applications", ...installDirs(env, platform)]) {
      const mac = join(app, "Godot.app", "Contents", "MacOS", "Godot");
      if (existsSync(mac)) return resolvePath(mac);
    }
  }
  for (const dir of installDirs(env, platform)) {
    const found = godotIn(dir, platform, true);
    if (found) return resolvePath(found);
  }
  throw new GodotNotFoundError();
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Stops the Godot process tree and rejects with CancelledError (default: the signal of the current run context). */
  signal?: AbortSignal;
  /** Called with every complete line Godot prints. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

/**
 * Stops a process and what it started. A detached child leads its own process group, so the whole group goes;
 * on Windows taskkill /T does the same. Otherwise only the child itself is killed.
 */
export function killTree(child: ChildProcess, group: boolean): void {
  const pid = child.pid;
  try {
    if (pid !== undefined && process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    }
    if (pid !== undefined && group) {
      process.kill(-pid, "SIGKILL");
      return;
    }
  } catch {
    // Already gone, or no group: fall back to the child alone.
  }
  child.kill("SIGKILL");
}

/** Godot process groups still running: stopped when this process exits, since they are not in our group. */
const groups = new Set<ChildProcess>();
let exitHook = false;
function trackGroup(child: ChildProcess): void {
  groups.add(child);
  if (exitHook) return;
  exitHook = true;
  process.once("exit", () => {
    for (const c of groups) killTree(c, true);
  });
}

/**
 * Runs Godot with the given arguments and collects its output. Inside a run context (see progress.ts) it reports
 * the phase and Godot's progress lines, and a cancelled context stops the process tree.
 */
export function runGodot(bin: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const context = currentRun();
  const signal = options.signal ?? context?.signal;
  const phase = phaseOf(args);
  const report = context?.onProgress ? throttle(context.onProgress) : undefined;
  const parser = report ? new ProgressParser(phase) : undefined;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    report?.(`${phase}: started`, true);
    // With a signal, Godot gets its own process group so a cancel stops what it started too. Without one (the CLI),
    // it stays in ours, so Ctrl+C in a terminal still reaches it.
    const group = signal !== undefined && process.platform !== "win32";
    const child = spawn(bin, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"], detached: group });
    if (group) trackGroup(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let exitCode: number | null | undefined;
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (done) return;
      cancelled = true;
      if (exitCode === undefined) killTree(child, group);
      else finish(exitCode);
    };
    // 'close' waits for every process that holds the pipes, and a process Godot started can keep them open.
    // So after a timeout, or once Godot has exited on its own, the run is taken as finished at 'exit'.
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      if (cancelled) reject(new CancelledError());
      else resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    };
    const lines = (stream: "stdout" | "stderr") => {
      let partial = "";
      return (chunk: string) => {
        if (!options.onLine && !parser) return;
        const parts = (partial + chunk).split(/\r?\n/);
        partial = parts.pop() ?? "";
        for (const line of parts) {
          options.onLine?.(line, stream);
          const message = parser?.line(line);
          if (message) report?.(message);
        }
      };
    };
    const outLines = lines("stdout");
    const errLines = lines("stderr");
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      outLines(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      errLines(chunk);
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        if (exitCode === undefined) {
          timedOut = true;
          killTree(child, group);
        } else {
          // Godot had already exited; only a process it started was still holding the output.
          finish(exitCode);
        }
      }, options.timeoutMs);
    }
    child.on("error", (error) => {
      if (done) return;
      done = true;
      groups.delete(child);
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("exit", (code) => {
      exitCode = code;
      groups.delete(child);
      if (timedOut || cancelled) finish(code);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Reads `godot --version`, e.g. "4.7.2.stable.official.abcdef". */
export async function godotVersion(bin: string): Promise<string> {
  const result = await runGodot(bin, ["--headless", "--version"], { timeoutMs: 30_000 });
  const line = result.stdout.trim().split(/\r?\n/).pop() ?? "";
  if (!/^\d+\.\d+/.test(line)) throw new Error(`Could not read the Godot version from ${bin}: ${line || result.stderr.trim()}`);
  return line;
}
