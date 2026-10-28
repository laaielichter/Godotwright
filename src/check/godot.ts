import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export class GodotNotFoundError extends Error {
  constructor() {
    super(
      "Godot not found. Pass --godot <path>, set the GODOT environment variable, or put godot on your PATH.",
    );
    this.name = "GodotNotFoundError";
  }
}

const NAMES = ["godot", "godot4", "Godot", "godot4.7", "godot-4.7"];

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds the Godot binary: explicit path, then $GODOT / $GODOT_BIN, then PATH, then common install spots. */
export function findGodot(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of [explicit, env["GODOT"], env["GODOT_BIN"]]) {
    if (candidate) {
      if (isExecutable(candidate)) return candidate;
      throw new Error(`Godot binary not found or not executable: ${candidate}`);
    }
  }
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (env["PATH"] ?? "").split(delimiter).filter(Boolean)) {
    for (const name of NAMES) {
      for (const ext of exts) {
        const path = join(dir, name + ext);
        if (isExecutable(path)) return path;
      }
    }
    // Official downloads are named like Godot_v4.7.2-stable_linux.x86_64.
    try {
      const match = readdirSync(dir)
        .filter((f) => /^Godot_v4\.\d+(\.\d+)?-stable_(linux\.x86_64|linux\.arm64|win64\.exe)$/.test(f))
        .sort()
        .pop();
      if (match && isExecutable(join(dir, match))) return join(dir, match);
    } catch {
      // Unreadable PATH entry.
    }
  }
  const mac = "/Applications/Godot.app/Contents/MacOS/Godot";
  if (process.platform === "darwin" && existsSync(mac)) return mac;
  throw new GodotNotFoundError();
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

/** Runs Godot with the given arguments and collects its output. */
export function runGodot(bin: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : undefined;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    });
  });
}

/** Reads `godot --version`, e.g. "4.7.2.stable.official.abcdef". */
export async function godotVersion(bin: string): Promise<string> {
  const result = await runGodot(bin, ["--headless", "--version"], { timeoutMs: 30_000 });
  const line = result.stdout.trim().split(/\r?\n/).pop() ?? "";
  if (!/^\d+\.\d+/.test(line)) throw new Error(`Could not read the Godot version from ${bin}: ${line || result.stderr.trim()}`);
  return line;
}
