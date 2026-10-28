import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject, type CheckResult } from "../../src/check/check.js";
import { formatDiagnostic } from "../../src/check/log.js";
import { FIXTURES } from "../helpers.js";

/** These tests need a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `godotwright-it-${name}-`));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

function report(name: string, result: CheckResult): void {
  console.log(`=== ${name}: Godot ${result.godotVersion}, ${result.scripts} scripts, ${result.scenes} scenes`);
  for (const step of result.steps) console.log(`step ${step.name}: ${step.ms}ms exit=${step.exitCode}`);
  for (const d of result.diagnostics) console.log(`[${d.source}] ${formatDiagnostic(d)}`);
  for (const [step, log] of Object.entries(result.logs ?? {})) console.log(`--- raw ${step} ---\n${log}`);
}

describe.skipIf(!GODOT)("godotwright check with real Godot", () => {
  it("finds no errors in the demo project", { timeout: 300_000 }, async () => {
    const result = await checkProject(copyFixture("demo"), { godot: GODOT, runFrames: 60, keepLogs: true });
    report("demo", result);
    expect(result.godotVersion).toMatch(/^4\.7\./);
    expect(result.scripts).toBe(6);
    expect(result.scenes).toBe(4);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("reports the broken script with file and line", { timeout: 300_000 }, async () => {
    const result = await checkProject(copyFixture("broken"), { godot: GODOT, runFrames: 30, keepLogs: true });
    report("broken", result);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toContainEqual(
      expect.objectContaining({ file: "res://scripts/broken.gd", line: 5, message: expect.stringMatching(/undefined_name/) }),
    );
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/missing\.png/) }));
    expect(errors).toContainEqual(expect.objectContaining({ file: "res://scripts/main.gd", line: 7 }));
    expect(errors.some((d) => d.file === "res://scripts/ok.gd")).toBe(false);
  });
});
