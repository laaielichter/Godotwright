import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CommanderError, type Command } from "commander";
import { createProgram } from "../src/program.js";
import { VERSION } from "../src/version.js";
import { DEMO } from "./helpers.js";
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

describe("CLI options", () => {
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

  it("model contract writes model.contract.json, to -o or by default, and prints it with -o -", async () => {
    const dir = mkdtempSync(join(tmpdir(), "godotwright-contract-"));
    const file = join(dir, "model.contract.json");
    const archetype = await run(["model", "contract", "--archetype", "car", "-o", file]);
    expect(archetype.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).description).toContain("vehicle.wheeled.car");
    const fromModel = join(dir, "box.contract.json");
    expect((await run(["model", "contract", writeGlb({ meshes: [box()] }), "-o", fromModel])).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(fromModel, "utf8")).version).toBe(1);
    const printed = await run(["model", "contract", "--archetype", "car", "-o", "-"]);
    expect(JSON.parse(printed.output).description).toContain("vehicle.wheeled.car");
    const help = await run(["model", "contract", "--help"]);
    expect(help.output).toContain('default: "model.contract.json"');
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
