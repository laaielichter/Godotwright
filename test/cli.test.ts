import { describe, expect, it } from "vitest";
import { CommanderError, type Command } from "commander";
import { createProgram } from "../src/program.js";
import { VERSION } from "../src/version.js";
import { DEMO } from "./helpers.js";

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
});
