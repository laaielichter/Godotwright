import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkProject } from "../src/check/check.js";
import { checkerSource } from "../src/check/checker-script.js";
import { findGodot, GodotNotFoundError } from "../src/check/godot.js";
import { FIXTURES, runCli } from "./helpers.js";

/** Temp folders this file creates; removed once the tests are done. */
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for the Godot binary that replays canned output. */
function fakeGodot(behavior: { version?: string; checkLog?: string; finish?: boolean; runLog?: string }): string {
  const dir = tempDir("fake-godot-");
  const bin = join(dir, "godot");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const b = ${JSON.stringify(behavior)};
fs.appendFileSync(${JSON.stringify(join(dir, "calls.log"))}, JSON.stringify(args) + "\\n");
if (args.includes("--version")) { console.log(b.version ?? "4.7.2.stable.official.fake"); process.exit(0); }
if (args.includes("--import")) { console.log("Godot Engine v4.7.2.stable.official.fake - https://godotengine.org"); process.exit(0); }
const scriptAt = args.indexOf("--script");
if (scriptAt >= 0) {
  const root = args[args.indexOf("--path") + 1];
  const checker = path.join(root, args[scriptAt + 1].replace("res://", ""));
  if (!fs.existsSync(checker)) { console.error("ERROR: checker missing"); process.exit(1); }
  process.stderr.write(b.checkLog ?? "");
  if (b.finish !== false) process.stderr.write("\\nGODOTWRIGHT_DONE 3 1\\n");
  process.exit(0);
}
if (args.includes("--quit-after")) { process.stderr.write(b.runLog ?? ""); process.exit(0); }
process.exit(0);
`;
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

function copyFixture(name: string): string {
  const dir = tempDir(`godotwright-${name}-`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

describe("checkProject", () => {
  it("collects script errors, scan warnings and run errors", async () => {
    const root = copyFixture("broken");
    const godot = fakeGodot({
      checkLog: [
        "GODOTWRIGHT_BEGIN res://scripts/broken.gd",
        'SCRIPT ERROR: Parse Error: Identifier "undefined_name" not declared in the current scope.',
        "   at: GDScript::reload (res://scripts/broken.gd:5)",
        'ERROR: Failed to load script "res://scripts/broken.gd" with error "Parse error".',
        "   at: load (modules/gdscript/gdscript.cpp:2936)",
        "GODOTWRIGHT_END res://scripts/broken.gd",
        "WARNING: 4 ObjectDB instances were leaked at exit (run with `--verbose` for details).",
        "   at: cleanup (core/object/object.cpp:2600)",
        "ERROR: 2 resources still in use at exit (run with --verbose for details).",
        "   at: clear (core/io/resource.cpp:810)",
      ].join("\n"),
      runLog: [
        "SCRIPT ERROR: Out of bounds get index '3' (on base: 'Array[int]')",
        "   at: _ready (res://scripts/main.gd:7)",
        "ERROR: 38 resources still in use at exit (run with --verbose for details).",
        "   at: clear (core/io/resource.cpp:810)",
      ].join("\n"),
    });
    const result = await checkProject(root, { godot, runFrames: 10 });
    expect(result.godotVersion).toBe("4.7.2.stable.official.fake");
    expect([result.scripts, result.scenes]).toEqual([3, 1]);
    expect(result.diagnostics).toEqual([
      { severity: "warning", file: "res://main.tscn", line: 4, message: "missing Texture2D: res://missing.png", source: "scan" },
      {
        severity: "error",
        file: "res://scripts/broken.gd",
        line: 5,
        message: 'Parse Error: Identifier "undefined_name" not declared in the current scope.',
        source: "script",
      },
      {
        severity: "error",
        file: "res://scripts/main.gd",
        line: 7,
        message: "Out of bounds get index '3' (on base: 'Array[int]')",
        source: "script",
      },
      {
        severity: "warning",
        message: "at exit: 38 resources still in use at exit (run with --verbose for details).",
        source: "run",
      },
    ]);
    expect(result.errors).toBe(2);
    expect(result.steps.map((s) => s.name)).toEqual(["import", "check", "run"]);
    // The checker script is removed afterwards.
    expect(existsSync(join(root, ".godot", "godotwright"))).toBe(false);
  });

  it("warns about other Godot versions and a checker that does not finish", async () => {
    const root = copyFixture("demo");
    const godot = fakeGodot({ version: "4.6.1.stable.official.fake", finish: false, checkLog: "boom" });
    const result = await checkProject(root, { godot, import: false });
    expect(result.steps.map((s) => s.name)).toEqual(["check"]);
    expect(result.diagnostics.map((d) => `${d.severity}: ${d.message}`)).toEqual([
      "warning: Godot 4.6.1.stable.official.fake found; Godotwright targets Godot 4.7.x",
      "error: checker did not finish (exit code 0); last output: boom",
    ]);
  });
});

describe("findGodot", () => {
  it("prefers an explicit path, then $GODOT, then PATH", () => {
    const godot = fakeGodot({});
    expect(findGodot(godot, {})).toBe(godot);
    expect(findGodot(undefined, { GODOT: godot })).toBe(godot);
    expect(findGodot(undefined, { PATH: join(godot, "..") })).toBe(godot);
    expect(() => findGodot(undefined, { PATH: "" })).toThrow(GodotNotFoundError);
    expect(() => findGodot("/no/such/godot", {})).toThrow(/not found or not executable/);
  });

  /** Creates empty executables at the given paths under a fresh home folder. */
  function home(files: string[]): string {
    const root = tempDir("godot-home-");
    for (const file of files) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), "");
      chmodSync(join(root, file), 0o755);
    }
    return root;
  }

  it("finds the newest unzipped download on Windows, console build first", () => {
    const root = home([
      "Downloads/Godot_v4.6.1-stable_win64.exe",
      "Downloads/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64.exe",
      "Downloads/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64_console.exe",
      "Downloads/notes.txt",
    ]);
    expect(findGodot(undefined, { USERPROFILE: root }, "win32")).toBe(
      join(root, "Downloads", "Godot_v4.7.2-stable_win64.exe", "Godot_v4.7.2-stable_win64_console.exe"),
    );
  });

  it("finds Godot from Steam on Windows", () => {
    const root = home(["Steam/steamapps/common/Godot Engine/godot.windows.opt.tools.64.exe"]);
    expect(findGodot(undefined, { "ProgramFiles(x86)": root }, "win32")).toBe(
      join(root, "Steam", "steamapps", "common", "Godot Engine", "godot.windows.opt.tools.64.exe"),
    );
  });

  it("finds a download in the home folder on Linux", () => {
    const root = home(["Downloads/Godot_v4.7.2-stable_linux.x86_64"]);
    expect(findGodot(undefined, { HOME: root }, "linux")).toBe(join(root, "Downloads", "Godot_v4.7.2-stable_linux.x86_64"));
    expect(() => findGodot(undefined, { HOME: home(["Downloads/godot.txt"]) }, "linux")).toThrow(GodotNotFoundError);
  });
});

describe("godotwright check", () => {
  it("prints compiler-style lines and exits with 1 on errors", async () => {
    const root = copyFixture("broken");
    const godot = fakeGodot({
      checkLog: 'SCRIPT ERROR: Parse Error: Unexpected "Indent".\n   at: GDScript::reload (res://scripts/broken.gd:5)\n',
    });
    const previous = process.exitCode;
    const { output } = await runCli(["check", root, "--godot", godot]);
    expect(output).toContain('res://scripts/broken.gd:5: error: Parse Error: Unexpected "Indent".');
    expect(output).toContain("1 error, 1 warning (Godot 4.7.2.stable.official.fake, 3 scripts, 1 scenes)");
    expect(process.exitCode).toBe(1);
    process.exitCode = previous;
  });
});

describe("checkerSource", () => {
  it("writes exclude paths literally, even when they contain $ sequences", () => {
    const source = checkerSource({ instantiate: true, exclude: ["vendor/a$&b", "tools/$$"] });
    expect(source).toContain('const INSTANTIATE: bool = true\nconst EXCLUDE: Array[String] = ["res://vendor/a$&b", "res://tools/$$"]\n');
    expect(source.split("const MARKER").length).toBe(2);
  });
});
