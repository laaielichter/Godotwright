import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CommanderError, type Command } from "commander";
import { createProgram } from "../src/program.js";
import { VERSION } from "../src/version.js";
import { DEMO, makeProject } from "./helpers.js";
import { box, writeGlb } from "./model-helpers.js";

/**
 * Runs the CLI in-process and captures its output. Every command gets exitOverride, not just the root,
 * so a usage error in a subcommand comes back as an exit code instead of ending the test process.
 */
async function run(args: string[]): Promise<{ output: string; exitCode: number }> {
  let output = "";
  const program = createProgram();
  const capture = (command: Command): void => {
    command.exitOverride().configureOutput({
      writeOut: (text) => (output += text),
      writeErr: (text) => (output += text),
    });
    command.commands.forEach(capture);
  };
  capture(program);
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(args, { from: "user" });
    return { output, exitCode: Number(process.exitCode ?? 0) };
  } catch (error) {
    if (error instanceof CommanderError) return { output, exitCode: error.exitCode };
    throw error;
  } finally {
    process.exitCode = previous;
  }
}

describe("deps JSON output", () => {
  const config = '[application]\nconfig/name="Deps"\nrun/main_scene="res://main.tscn"\n';
  const scene = (...paths: string[]) => [
    `[gd_scene load_steps=${paths.length + 1} format=3]`, "",
    ...paths.map((p, i) => `[ext_resource type="Resource" path="res://${p}" id="${i + 1}"]`),
    "", '[node name="Main" type="Node"]', "",
  ].join("\n");

  it("explains used and unused files without changing text output", async () => {
    const root = makeProject({
      "project.godot": config, "main.tscn": scene("used.tres"),
      "used.tres": "", "unused.tres": "",
    });
    const args = ["deps", "--path", root, "why", "used.tres"];
    const used = await run([...args, "--json"]);
    expect(used.exitCode).toBe(0);
    expect(JSON.parse(used.output)).toEqual({
      file: "res://used.tres", used: true, chain: [
        { file: "res://used.tres", by: "res://main.tscn", kind: "ext_resource", line: 3 },
        { file: "res://main.tscn", kind: "root", reason: "project.godot: application/run/main_scene" },
      ],
    });
    expect(used.output).toBe(`${JSON.stringify(JSON.parse(used.output), null, 2)}\n`);
    expect(await run(args)).toEqual({ exitCode: 0, output:
      "res://used.tres is used:\n  res://used.tres  <- ext_resource in res://main.tscn:3\n  res://main.tscn  <- project.godot: application/run/main_scene\n",
    });
    const unused = await run(["deps", "--path", root, "why", "unused.tres", "--json"]);
    expect(unused.exitCode).toBe(0);
    expect(JSON.parse(unused.output)).toEqual({ file: "res://unused.tres", used: false, chain: [] });
    expect(await run(["deps", "--path", root, "why", "unused.tres"])).toEqual({ exitCode: 0, output:
      "res://unused.tres looks unused:\n  nothing the game starts with reaches res://unused.tres: no scene, resource, script, setting, export filter or file list names it, also not by folder or file name\n",
    });
  });

  it("returns every loaded dependency in JSON, even when text is capped at 40", async () => {
    const paths = Array.from({ length: 41 }, (_, i) => `asset-${i}.tres`);
    const root = makeProject({
      ...Object.fromEntries(paths.map((p) => [p, "x"])),
      "project.godot": config, "main.tscn": scene(...paths, "missing.tres"),
    });
    const args = ["deps", "--path", root, "of", "main.tscn"];
    const result = await run([...args, "--json"]);
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.output) as { files: { file: string; bytes: number; depth: number }[] };
    expect([...data.files].sort((a, b) => a.file.localeCompare(b.file))).toEqual(
      paths.map((p) => ({ file: `res://${p}`, bytes: 1, depth: 1 })).sort((a, b) => a.file.localeCompare(b.file)),
    );
    expect(data).toMatchObject({
      file: "res://main.tscn",
      bytes: 41, byType: [{ ext: "tres", files: 41, bytes: 41 }],
      missing: [{ from: "res://main.tscn", to: "res://missing.tres", line: 44 }],
      later: { files: 0, bytes: 0 },
    });
    expect((await run(args)).output).toContain("\n  +1 more\n");
  });

  it("prints cycles to stdout even when setting a failing exit code", async () => {
    const clean = makeProject({ "project.godot": config, "main.tscn": scene() });
    const cyclic = makeProject({
      "project.godot": config, "main.tscn": scene("loop.tscn"), "loop.tscn": scene("main.tscn"),
    });
    const query = (root: string) => run(["deps", "--path", root, "cycles", "--json"]);
    const none = await query(clean);
    expect(none.exitCode).toBe(0);
    expect(JSON.parse(none.output)).toEqual({ cycles: [] });
    const result = await query(cyclic);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.output)).toEqual({ cycles: [["res://loop.tscn", "res://main.tscn"]] });
    expect(await run(["deps", "--path", clean, "cycles"])).toEqual({
      output: "cycles: no scene or resource loads itself through ext_resource\n", exitCode: 0,
    });
    const text = await run(["deps", "--path", cyclic, "cycles"]);
    expect(text.exitCode).toBe(1);
    expect(text.output).toContain("  res://loop.tscn -> res://main.tscn -> res://loop.tscn\n");
  });

  it("leaves errors on stderr as plain text, with no stdout", async () => {
    const root = makeProject({ "project.godot": config, "main.tscn": scene() });
    const empty = makeProject({});
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const cases: [string, ...string[]][] = [[root, "why", "absent.gd"], [root, "of", "absent.gd"], [empty, "cycles"]];
      for (const flags of [[], ["--json"]]) {
        for (const [dir, ...command] of cases) {
          stderr.mockClear();
          expect(await run(["deps", "--path", dir, ...command, ...flags])).toEqual({ exitCode: 1, output: "" });
          expect(stderr).toHaveBeenCalledTimes(1);
          expect(stderr.mock.calls[0]?.[0]).toMatch(command[0] === "cycles"
            ? (flags.length ? /^No project\.godot found / : /^error: No project\.godot found /)
            : /^res:\/\/absent\.gd does not exist in the project/);
        }
      }
    } finally {
      stderr.mockRestore();
    }
  });
});

/**
 * A stand-in for the Godot binary. It logs each call (not --version), copies the checker script it
 * is given next to the log, and either finishes at once or hangs, to test the timeout.
 */
function fakeGodot(hang = false): { bin: string; dir: string; calls: () => string[][] } {
  const dir = mkdtempSync(join(tmpdir(), "fake-godot-cli-"));
  const bin = join(dir, "godot");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("4.7.2.stable.official.fake"); process.exit(0); }
fs.appendFileSync(path.join(${JSON.stringify(dir)}, "calls.log"), JSON.stringify(args) + "\\n");
if (${hang}) {
  setInterval(() => {}, 1000);
} else {
  const script = args.indexOf("--script");
  if (script >= 0) {
    const root = args[args.indexOf("--path") + 1];
    fs.copyFileSync(path.join(root, args[script + 1].replace("res://", "")), path.join(${JSON.stringify(dir)}, "check.gd"));
    process.stderr.write("GODOTWRIGHT_DONE 2 1\\n");
  }
  process.exit(0);
}
`,
  );
  chmodSync(bin, 0o755);
  const log = join(dir, "calls.log");
  return { bin, dir, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]) : []) };
}

/** A throwaway copy of the demo project, so the checker does not write into the fixture. */
function copyDemo(): string {
  const dir = mkdtempSync(join(tmpdir(), "godotwright-cli-demo-"));
  cpSync(DEMO, dir, { recursive: true });
  return dir;
}

describe("godotwright CLI", () => {
  it("shows help", async () => {
    const { output, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(output).toContain("Usage: godotwright");
    expect(output).toContain("Godot 4.7");
  });

  it("prints the package version", async () => {
    const { output, exitCode } = await run(["--version"]);
    expect(exitCode).toBe(0);
    expect(output.trim()).toBe(VERSION);
  });

  it("fails on an unknown option", async () => {
    const { exitCode } = await run(["--nope"]);
    expect(exitCode).not.toBe(0);
  });
});

describe("a path that does not exist (#197)", () => {
  it("is an error for scan, review, fix, doctor, shader and deps, never the project around it", async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-missing-path-"));
    writeFileSync(join(root, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="T"\n');
    const code = "extends Node\n\nfunc _ready() -> void:\n\tvar x := abs(-1)\n\tprint(x)\n";
    writeFileSync(join(root, "a.gd"), code);
    const folder = join(root, "scripts");
    const file = join(root, "nosuch.gd");
    const printed: string[] = [];
    const write = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => (printed.push(String(chunk)), true)) as typeof process.stderr.write;
    try {
      // scan and review leave the error to the entry point, which prints it and exits with code 1.
      await expect(run(["scan", folder])).rejects.toThrow(`${folder}: no such file or directory`);
      await expect(run(["review", folder])).rejects.toThrow(`${folder}: no such file or directory`);
      await expect(run(["review", root, file])).rejects.toThrow(`${file}: no such file or directory`);
      for (const args of [["fix", folder, "--write"], ["doctor", folder, "--no-godot"], ["shader", folder, "--no-compile"], ["deps", "--path", folder, "unused"], ["migrate", file], ["usages", "x", folder]]) {
        printed.length = 0;
        expect((await run(args)).exitCode, args.join(" ")).toBe(1);
        expect(printed.join(""), args.join(" ")).toBe(`${args.includes(file) ? file : folder}: no such file or directory\n`);
      }
    } finally {
      process.stderr.write = write;
    }
    expect(readFileSync(join(root, "a.gd"), "utf8")).toBe(code);
    expect(existsSync(join(root, ".godot"))).toBe(false);
    // Paths that exist work as before: the project, and a file in it that narrows the findings.
    expect((await run(["scan", root])).output).toContain("project: T");
    expect((await run(["review", root, join(root, "a.gd")])).output).toContain("findings shown only for: res://a.gd");
  });
});

describe("godotwright doctor", () => {
  it("uses singular script and scene counts in the text summary", async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-doctor-counts-"));
    writeFileSync(join(root, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="Doctor counts"\nrun/main_scene="res://Main.tscn"\n');
    writeFileSync(join(root, "Main.gd"), "extends Node\n");
    writeFileSync(join(root, "Main.tscn"), '[gd_scene format=3]\n\n[node name="Main" type="Node"]\n');

    const { output } = await run(["doctor", root, "--no-godot"]);
    expect(output).toContain("1 script, 1 scene; Godot skipped");

    const { output: json } = await run(["doctor", root, "--no-godot", "--json"]);
    expect(JSON.parse(json)).toMatchObject({ scripts: 1, scenes: 1 });
  });
});

describe("number options", () => {
  it("review --min-score fails the gate only below the score", async () => {
    expect((await run(["review", DEMO, "--min-score", "0"])).exitCode).toBe(0);
    expect((await run(["review", DEMO, "--min-score", "101"])).exitCode).toBe(1);
  });

  it("review --min-score refuses a value that is not a number, instead of skipping the gate", async () => {
    const { output, exitCode } = await run(["review", DEMO, "--min-score", "8O"]);
    expect(exitCode).toBe(1);
    expect(output).toContain("expected a number");
  });

  it("model lint --max-triangles flags a model over the budget", async () => {
    const glb = writeGlb({ meshes: [box()] });
    const { output } = await run(["model", "lint", glb, "--max-triangles", "4", "--json"]);
    expect(JSON.parse(output).findings.map((f: { rule: string }) => f.rule)).toContain("model/triangle-budget");
  });

  it("model lint refuses a budget or score that is not a number, instead of dropping the check", async () => {
    const glb = writeGlb({ meshes: [box()] });
    const budget = await run(["model", "lint", glb, "--max-triangles", "2O000"]);
    expect(budget.exitCode).toBe(1);
    expect(budget.output).toContain("expected a number");
    const score = await run(["model", "lint", glb, "--min-score", "8O"]);
    expect(score.exitCode).toBe(1);
    expect(score.output).toContain("expected a number");
  });

  it("collector aggregate refuses a --min-installs that is not a number, instead of keeping nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "godotwright-reports-"));
    const { output, exitCode } = await run(["collector", "aggregate", dir, "--min-installs", "2O"]);
    expect(exitCode).toBe(1);
    expect(output).toContain("expected a number");
  });

  it("collector serve refuses a --port that is not a number", async () => {
    const { output, exitCode } = await run(["collector", "serve", "--port", "2O"]);
    expect(exitCode).toBe(1);
    expect(output).toContain("expected a number");
  });

  it("api -n limits search results, and refuses a limit that is not a number", async () => {
    const hits = JSON.parse((await run(["api", "--search", "is", "on", "floor", "-n", "3", "--json"])).output);
    expect(hits).toHaveLength(3);
    const bad = await run(["api", "--search", "is", "on", "floor", "-n", "3O"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.output).toContain("expected a number");
  });
});

describe("godotwright check options", () => {
  it("runs the main scene for the frames given to --run, and keeps the project path", async () => {
    const root = copyDemo();
    const godot = fakeGodot();
    const { exitCode } = await run(["check", root, "--godot", godot.bin, "--no-import", "--run", "300"]);
    expect(exitCode).toBe(0);
    expect(godot.calls().at(-1)?.slice(-2)).toEqual(["--quit-after", "300"]);
  });

  it("refuses --run with a project path after it, instead of checking the current folder", async () => {
    const root = copyDemo();
    const godot = fakeGodot();
    const { output, exitCode } = await run(["check", "--run", root, "--godot", godot.bin]);
    expect(exitCode).toBe(1);
    expect(output).toContain("whole number of frames");
    expect(godot.calls()).toEqual([]);
  });

  it("takes --exclude repeatable, so a project path after it is still the project", async () => {
    const root = copyDemo();
    const godot = fakeGodot();
    const { exitCode } = await run(["check", "--exclude", "addons", "--exclude", "tools", root, "--godot", godot.bin, "--no-import"]);
    expect(exitCode).toBe(0);
    expect(readFileSync(join(godot.dir, "check.gd"), "utf8")).toContain('const EXCLUDE: Array[String] = ["res://addons", "res://tools"]');
  });

  it("refuses a --timeout that is not a positive number, instead of waiting without a limit", async () => {
    const root = copyDemo();
    const godot = fakeGodot();
    for (const value of ["6O", "0", "-5"]) {
      const { output, exitCode } = await run(["check", root, "--godot", godot.bin, "--timeout", value]);
      expect(exitCode, value).toBe(1);
      expect(output, value).toContain("expected a number");
    }
    expect(godot.calls()).toEqual([]);
  });

  it("stops a Godot run that hangs at --timeout and reports it", async () => {
    const root = copyDemo();
    const godot = fakeGodot(true);
    const { output, exitCode } = await run(["check", root, "--godot", godot.bin, "--no-import", "--timeout", "0.5"]);
    expect(exitCode).toBe(1);
    expect(output).toContain("check timed out");
  }, 20_000);
});

describe("--path on every command with a [path] argument", () => {
  it("means the same as the argument, and refuses two different paths", async () => {
    const byArg = await run(["scan", DEMO, "--json"]);
    const byOption = await run(["scan", "--path", DEMO, "--json"]);
    expect(byOption.exitCode).toBe(0);
    expect(byOption.output).toBe(byArg.output);
    const both = await run(["scan", DEMO, "--path", "/elsewhere"]);
    expect(both.exitCode).not.toBe(0);
    expect(both.output).toMatch(/give the path once/);
  });

  it("is on check and scan, and not added twice where a command has --path already", () => {
    const find = (names: string[]) => names.reduce<Command | undefined>((c, n) => c?.commands.find((x) => x.name() === n), createProgram());
    for (const name of [["check"], ["scan"], ["perf"], ["metrics", "complexity"]]) expect(find(name)?.options.filter((o) => o.long === "--path"), name.join(" ")).toHaveLength(1);
    expect(find(["format"])?.options.filter((o) => o.long === "--path")).toHaveLength(1);
  });
});
