import { cpSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatTests, runTests } from "../../src/test/run.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT, and the test frameworks' addon folders in $GUT_ADDON and $GDUNIT_ADDON. CI provides them. */
const GODOT = process.env["GODOT"];
const GUT = process.env["GUT_ADDON"];
const GDUNIT = process.env["GDUNIT_ADDON"];

const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Tests"\nconfig/features=PackedStringArray("4.7")\n';
const CALC = "class_name Calc\nextends RefCounted\n\n\nstatic func add(a: int, b: int) -> int:\n\treturn a + b\n";

function project(addon: string, folder: string, files: Record<string, string>): string {
  const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "calc.gd": CALC, ...files });
  cpSync(addon, join(root, "addons", folder), { recursive: true });
  return root;
}

describe.skipIf(!GODOT || !GUT)("godotwright test with GUT in Godot", () => {
  it("runs the tests and reports the failing one with its line", { timeout: 300_000 }, async () => {
    const root = project(GUT ?? "", "gut", {
      "test/test_calc.gd": 'extends GutTest\n\n\nfunc test_adds() -> void:\n\tassert_eq(Calc.add(1, 2), 3)\n\n\nfunc test_fails_on_purpose() -> void:\n\tassert_eq(Calc.add(2, 2), 5, "two and two")\n',
    });
    const report = await runTests(root, { godot: GODOT });
    console.log(formatTests(report));
    expect(report).toMatchObject({ framework: "gut", tests: 2, passed: 1, failed: 1 });
    expect(report.failures[0]).toMatchObject({ test: "test_fails_on_purpose", file: "res://test/test_calc.gd", line: 9 });
    const only = await runTests(root, { godot: GODOT, filter: "adds", import: false });
    expect(only).toMatchObject({ tests: 1, passed: 1, failed: 0 });
  });
});

describe.skipIf(!GODOT || !GDUNIT)("godotwright test with GdUnit4 in Godot", () => {
  it("runs the tests and reports the failing one with its line", { timeout: 300_000 }, async () => {
    const root = project(GDUNIT ?? "", "gdUnit4", {
      "test/calc_test.gd": "extends GdUnitTestSuite\n\n\nfunc test_adds() -> void:\n\tassert_int(Calc.add(1, 2)).is_equal(3)\n\n\nfunc test_fails_on_purpose() -> void:\n\tassert_int(Calc.add(2, 2)).is_equal(5)\n",
    });
    const report = await runTests(root, { godot: GODOT });
    console.log(formatTests(report));
    expect(report).toMatchObject({ framework: "gdunit", tests: 2, passed: 1, failed: 1 });
    expect(report.failures[0]).toMatchObject({ test: "test_fails_on_purpose", file: "res://test/calc_test.gd", line: 9 });
  });
});
