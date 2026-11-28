import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempFolder } from "./helpers.js";

export interface FakeGodot {
  /** The executable. */
  bin: string;
  /** Folder with calls.log (one JSON argument list per run) and pids. */
  dir: string;
}

/**
 * A stand-in for Godot that prints what Godot prints in a check: import progress lines, the checker's markers
 * and a parse error in res://broken.gd. `hang` makes the checker step never finish and start a child that
 * outlives it (as OS.create_process does), so cancelling has to stop the whole process tree.
 */
export function fakeGodot(behavior: { hang?: boolean; files?: number; error?: boolean } = {}): FakeGodot {
  const dir = tempFolder("fake-godot-");
  const bin = join(dir, "godot");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const b = ${JSON.stringify(behavior)};
const dir = ${JSON.stringify(dir)};
fs.appendFileSync(path.join(dir, "calls.log"), JSON.stringify(args) + "\\n");
if (args.includes("--version")) { console.log("4.7.2.stable.official.fake"); process.exit(0); }
if (args.includes("--import")) {
  process.stdout.write("\\x1b[0m[  16% ] first_scan_filesystem | Loading global class names...\\x1b[0m\\n");
  process.stdout.write("\\x1b[0m[ DONE ] first_scan_filesystem\\x1b[0m\\n");
  process.exit(0);
}
const at = args.indexOf("--script");
if (at >= 0) {
  const n = b.files ?? 3;
  process.stderr.write("GODOTWRIGHT_TOTAL " + n + "\\n");
  if (b.hang) {
    const child = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    fs.writeFileSync(path.join(dir, "child.pid"), String(child.pid));
    fs.writeFileSync(path.join(dir, "godot.pid"), String(process.pid));
    process.stderr.write("GODOTWRIGHT_BEGIN res://a.gd\\n");
    setInterval(() => {}, 1000);
    return;
  }
  for (let i = 0; i < n; i++) {
    const file = i === 0 && b.error ? "res://broken.gd" : "res://f" + i + ".gd";
    process.stderr.write("GODOTWRIGHT_BEGIN " + file + "\\n");
    if (i === 0 && b.error) {
      process.stderr.write('SCRIPT ERROR: Parse Error: Identifier "nope" not declared in the current scope.\\n   at: GDScript::reload (res://broken.gd:4)\\n');
    }
    process.stderr.write("GODOTWRIGHT_END " + file + "\\n");
  }
  process.stderr.write("GODOTWRIGHT_DONE " + n + " 0 0\\n");
  process.exit(0);
}
process.exit(0);
`,
  );
  chmodSync(bin, 0o755);
  return { bin, dir };
}

/** An identity captured before cancellation; start time protects against Linux PID reuse. */
export interface FakeProcess {
  pid: number;
  startTime?: string;
}

function validPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) throw new Error(`invalid PID: ${pid}`);
}

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ESRCH";
}

function linuxStat(pid: number): { state: string; startTime: string } | undefined {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  // comm can contain spaces and parentheses. Fields after its final ')' start at state (field 3).
  const fields = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
  const state = fields[0];
  const startTime = fields[19]; // field 22
  if (!state || !/^[A-Za-z]$/.test(state) || !startTime || !/^\d+$/.test(startTime)) {
    throw new Error(`invalid /proc/${pid}/stat`);
  }
  return { state, startTime };
}

function exists(pid: number): boolean {
  validPid(pid);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error; // EPERM and other inspection failures do not prove exit.
  }
}

/** Whether the original process can still execute; zombies have already exited. */
export function alive(tracked: FakeProcess): boolean {
  if (!exists(tracked.pid)) return false;
  if (process.platform !== "linux") return true;
  if (tracked.startTime === undefined) throw new Error(`missing start time for PID ${tracked.pid}`);
  const stat = linuxStat(tracked.pid);
  // /proc may be unavailable even though signal zero succeeded. Only ESRCH proves absence in that case.
  if (!stat) return exists(tracked.pid);
  return stat.startTime === tracked.startTime && stat.state !== "Z";
}

export function trackProcess(pid: number): FakeProcess | undefined {
  if (!exists(pid)) return undefined;
  if (process.platform !== "linux") return { pid };
  const stat = linuxStat(pid);
  return stat && { pid, startTime: stat.startTime };
}

async function waitFor(check: () => boolean, ms: number, label: () => string): Promise<void> {
  const deadline = performance.now() + ms;
  for (;;) {
    if (performance.now() >= deadline) throw new Error(`timed out waiting for ${label()}`);
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - performance.now()))));
  }
}

/** Both PID files must contain complete, valid identities, and both processes must be alive before abort. */
export async function waitForFakeProcesses(fake: FakeGodot, processes: FakeProcess[]): Promise<void> {
  await waitFor(() => {
    for (const [index, name] of ["godot.pid", "child.pid"].entries()) {
      if (processes[index]) continue; // Retain each observed identity, including on a readiness failure.
      try {
        const text = readFileSync(join(fake.dir, name), "utf8");
        if (!/^[1-9]\d*$/.test(text)) continue;
        const pid = Number(text);
        if (pid === process.pid) throw new Error("fake Godot PID is the test runner");
        const observed = trackProcess(pid);
        if (observed) processes[index] = observed;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    const [godot, child] = processes;
    if (!godot || !child) return false;
    if (godot.pid === child.pid) throw new Error("fake Godot PIDs must differ");
    return alive(godot) && alive(child);
  }, 10_000, () => `both fake Godot PID files and live processes in ${fake.dir}`);
}

export async function waitForExit(processes: FakeProcess[], ms = 10_000): Promise<void> {
  await waitFor(() => processes.every((p) => !alive(p)), ms,
    () => `fake Godot processes to exit (still alive: ${processes.filter(alive).map((p) => p.pid).join(", ")})`);
}

/** Bound a phase as well as the surrounding Vitest test; clear the losing timer. */
export async function within<T>(promise: Promise<T>, label: string, ms = 10_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
