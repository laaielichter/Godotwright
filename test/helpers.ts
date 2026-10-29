import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProgram } from "../src/program.js";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const DEMO = join(FIXTURES, "demo");

/** Writes a throwaway project from a map of relative path to file content. */
export function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "godotwright-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

/** Runs the CLI in-process and captures its output. */
export async function runCli(args: string[]): Promise<{ output: string; exitCode: number }> {
  let output = "";
  const program = createProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => (output += text),
      writeErr: (text) => (output += text),
    });
  // Commands report failure by setting process.exitCode. Clear it first so a value left by an
  // earlier call in the same test file cannot leak into this result. This call's code stays in
  // process.exitCode afterwards, where callers can read it.
  process.exitCode = undefined;
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode;
    if (exitCode === undefined) throw error;
    return { output, exitCode };
  }
  return { output, exitCode: process.exitCode === undefined ? 0 : Number(process.exitCode) };
}
