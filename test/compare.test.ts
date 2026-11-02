import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareBinary, compareGodot, diagnosticKey, formatCompare, shortVersion } from "../src/check/compare.js";
import { makeProject, runCli, tempFolder } from "./helpers.js";

/**
 * A stand-in Godot that prints `checkLog` while it loads the project, and records where it ran and whether the
 * project had a .godot/ folder then.
 */
function fakeGodot(name: string, version: string, checkLog: string): { bin: string; calls: string } {
  const dir = tempFolder(`fake-${name}-`);
  const bin = join(dir, "godot");
  const calls = join(dir, "calls.log");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log(${JSON.stringify(version)}); process.exit(0); }
const root = args[args.indexOf("--path") + 1];
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ root, args, git: fs.existsSync(path.join(root, ".git")) }) + "\\n");
if (args.includes("--import")) { fs.mkdirSync(path.join(root, ".godot"), { recursive: true }); fs.writeFileSync(path.join(root, ".godot", "imported-by"), ${JSON.stringify(version)}); process.exit(0); }
const at = args.indexOf("--script");
if (at >= 0) { process.stderr.write(${JSON.stringify(checkLog)}); process.stderr.write("\\nGODOTWRIGHT_DONE 2 1\\n"); process.exit(0); }
process.exit(0);
`,
  );
  chmodSync(bin, 0o755);
  return { bin, calls };
}

const PROJECT = '[application]\nconfig/name="T"\nconfig/features=PackedStringArray("4.7")\nrun/main_scene="res://main.tscn"\n';
const files = {
  "project.godot": PROJECT,
  "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node"]\n',
  "a.gd": "extends Node\n",
  "b.gd": "extends Node\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  ".godot/imported-by": "mine\n",
};

const both = 'SCRIPT ERROR: Parse Error: Identifier "x" not declared in the current scope.\n   at: GDScript::reload (res://a.gd:3)\n';
const gone = 'SCRIPT WARNING: The local variable "y" is declared but never used.\n   at: GDScript::reload (res://a.gd:7)\n';
const fresh = 'SCRIPT ERROR: Parse Error: Not all code paths return a value.\n   at: GDScript::reload (res://b.gd:4)\n';

describe("compareGodot", () => {
  it("reports only what the second binary adds or no longer reports, and never touches the project with it", async () => {
    const root = makeProject(files);
    const base = fakeGodot("base", "4.7.2.stable.official.abcdef123", both + gone);
    const next = fakeGodot("next", "4.8.beta2.official.0123456789", both + fresh);
    const result = await compareGodot(root, { godot: base.bin, compareGodot: next.bin });

    expect(result.onlyOther.map((d) => `${d.severity} ${d.file}:${d.line} ${d.message}`)).toEqual([
      "error res://b.gd:4 Parse Error: Not all code paths return a value.",
    ]);
    expect(result.onlyBase.map((d) => `${d.severity} ${d.file}:${d.line}`)).toEqual(["warning res://a.gd:7"]);
    expect(result.same).toBe(1);
    // The version note ("Godot 4.8 found; Godotwright targets 4.7") is not a difference.
    expect(result.other.diagnostics.some((d) => /Godotwright targets/.test(d.message))).toBe(true);
    expect(result.onlyOther.some((d) => /Godotwright targets/.test(d.message))).toBe(false);

    // The second binary ran on a copy without .godot/ and .git/; the project's import cache is untouched.
    const runs = readFileSync(next.calls, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { root: string; git: boolean });
    expect(runs.every((r) => r.root !== root && !r.git)).toBe(true);
    expect(readFileSync(join(root, ".godot", "imported-by"), "utf8")).toBe("4.7.2.stable.official.abcdef123");
    expect(existsSync(runs[0]!.root)).toBe(false);
    expect(readdirSync(tmpdir()).some((d) => d.startsWith("godotwright-compare-") && existsSync(join(tmpdir(), d, root.split(/[\\/]/).pop()!)))).toBe(false);

    const text = formatCompare(result);
    expect(text).toContain("Godot 4.7.2.stable vs 4.8.beta2: 1 new in 4.8.beta2 (1 errors), 1 gone, 1 in both (2 scripts, 1 scenes)");
    expect(text).toContain("new in 4.8.beta2:\nres://b.gd:4: error: Parse Error: Not all code paths return a value.");
    expect(text).toContain("gone in 4.8.beta2:\nres://a.gd:7: warning:");
  });

  it("says nothing is new when both binaries agree", async () => {
    const root = makeProject(files);
    const a = fakeGodot("a", "4.7.2.stable.official.abcdef123", both);
    const result = await compareGodot(root, { godot: a.bin, compareGodot: a.bin });
    expect(result.onlyOther).toEqual([]);
    expect(result.onlyBase).toEqual([]);
    expect(formatCompare(result)).toContain("Nothing new in 4.7.2.stable.");
  });

  it("takes $GODOT_NEXT when no binary is given, and says how to give one", () => {
    expect(compareBinary(undefined, { GODOT_NEXT: "/opt/godot-4.8" })).toBe("/opt/godot-4.8");
    expect(compareBinary("/x/godot", { GODOT_NEXT: "/opt/godot-4.8" })).toBe("/x/godot");
    expect(() => compareBinary(undefined, {})).toThrow(/GODOT_NEXT/);
    expect(() => compareBinary(undefined, { GODOT_NEXT: "${GODOT_NEXT}" })).toThrow(/GODOT_NEXT/);
  });

  it("matches messages whose numbers differ between releases", () => {
    const d = (message: string) => diagnosticKey({ severity: "error", file: "res://a.gd", line: 3, message, source: "script" });
    expect(d("3 RIDs of type CanvasItem were leaked")).toBe(d("4 RIDs of type CanvasItem were leaked"));
    expect(d("a")).not.toBe(d("b"));
    expect(shortVersion("4.8.beta2.official.0123456789")).toBe("4.8.beta2");
    expect(shortVersion("4.7.2.stable.official.abcdef123")).toBe("4.7.2.stable");
  });

  it("CLI: --compare-godot prints the difference and exits 1 on new errors", async () => {
    const root = makeProject(files);
    const base = fakeGodot("cli-base", "4.7.2.stable.official.abcdef123", both);
    const next = fakeGodot("cli-next", "4.8.beta2.official.0123456789", both + fresh);
    const { output, exitCode } = await runCli(["check", root, "--godot", base.bin, "--compare-godot", next.bin]);
    expect(output).toContain("1 new in 4.8.beta2 (1 errors)");
    expect(exitCode).toBe(1);
    const same = await runCli(["check", root, "--godot", base.bin, "--compare-godot", base.bin, "--json"]);
    expect(same.exitCode).toBe(0);
    expect(JSON.parse(same.output)).toMatchObject({ onlyOther: [], onlyBase: [], same: 1 });
  });
});
