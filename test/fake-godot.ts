import { chmodSync, writeFileSync } from "node:fs";
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

/** Whether a process is still running. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
