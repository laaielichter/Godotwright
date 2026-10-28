import { describe, expect, it } from "vitest";
import { createProgram } from "../src/program.js";
import { VERSION } from "../src/version.js";

function run(args: string[]): { output: string; exitCode: number } {
  let output = "";
  const program = createProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => (output += text),
      writeErr: (text) => (output += text),
    });
  try {
    program.parse(args, { from: "user" });
  } catch (error) {
    return { output, exitCode: (error as { exitCode: number }).exitCode };
  }
  return { output, exitCode: 0 };
}

describe("godotwright CLI", () => {
  it("shows help", () => {
    const { output, exitCode } = run(["--help"]);
    expect(exitCode).toBe(0);
    expect(output).toContain("Usage: godotwright");
    expect(output).toContain("Godot 4.7");
  });

  it("prints the package version", () => {
    const { output, exitCode } = run(["--version"]);
    expect(exitCode).toBe(0);
    expect(output.trim()).toBe(VERSION);
  });

  it("fails on an unknown option", () => {
    const { exitCode } = run(["--nope"]);
    expect(exitCode).not.toBe(0);
  });
});
