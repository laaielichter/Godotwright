import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXABLE_RULES, fixProject, formatFix } from "../src/fix/fix.js";
import { RULES } from "../src/review/rules.js";
import { makeProject, runCli } from "./helpers.js";

const PROJECT = '[application]\nconfig/name="Fix"\nconfig/features=PackedStringArray("4.7")\n';

function project(code: string) {
  const root = makeProject({ "project.godot": PROJECT, "a.gd": code });
  return { root, read: () => readFileSync(join(root, "a.gd"), "utf8") };
}

describe("godotwright fix", () => {
  it("only offers rules that exist", () => {
    for (const r of FIXABLE_RULES) expect(RULES[r], r).toBeDefined();
  });

  it("shows the changes first and writes nothing", () => {
    const code = "extends Node\n\n\nfunc f(x: Node) -> void:\n\tif x is Node3D and is_instance_valid(x):\n\t\tprint(x)\n";
    const { root, read } = project(code);
    const result = fixProject(root);
    expect(result.written).toBe(false);
    expect(result.changes.map((c) => [c.rule, c.safety, c.to.trim()])).toEqual([["api/freed-check-order", "safe", "if is_instance_valid(x) and x is Node3D:"]]);
    expect(read()).toBe(code);
    expect(formatFix(result)).toMatch(/dry run/);
  });

  it("writes safe fixes and reviews the files again", () => {
    const { root, read } = project(
      'extends Node\n\nsignal hit(amount: int)\n\n\nfunc a() -> void:\n\tpass\n\n\nfunc b() -> void:\n\tpass\n\n\nfunc f(x: Node, on: bool) -> void:\n\tif x is Node3D and is_instance_valid(x):\n\t\tprint(x.get_meta("k", null))\n\ta() if on else b()\n\temit_signal("hit", 3)\n\tprint("CafÃ©")\n\tvar w := weakref(x)\n\tprint(w)\n',
    );
    const result = fixProject(root, { write: true });
    expect(result.changes.map((c) => c.rule).sort()).toEqual([
      "api/freed-check-order",
      "api/get-meta-null-default",
      "api/infer-variant",
      "quality/mojibake",
      "quality/standalone-ternary",
      "quality/string-signal",
    ]);
    const fixed = read();
    expect(fixed).toContain("if is_instance_valid(x) and x is Node3D:");
    expect(fixed).toContain('print((x.get_meta("k") if x.has_meta("k") else null))');
    expect(fixed).toContain("\tif on:\n\t\ta()\n\telse:\n\t\tb()\n");
    expect(fixed).toContain("\thit.emit(3)\n");
    expect(fixed).toContain('print("Café")');
    expect(fixed).toContain("var w: WeakRef = weakref(x)");
    expect(result.remaining?.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("moves lines: a MultiMesh format before instance_count, Timer.start() after add_child()", () => {
    const { root, read } = project(
      "extends Node\n\n\nfunc _ready() -> void:\n\tvar mm := MultiMesh.new()\n\tmm.instance_count = 10\n\tmm.use_custom_data = true\n\tvar t := Timer.new()\n\tt.start(1.0)\n\tadd_child(t)\n\tprint(mm)\n",
    );
    fixProject(root, { write: true });
    expect(read()).toContain("\tmm.use_custom_data = true\n\tmm.instance_count = 10\n");
    expect(read()).toContain("\tadd_child(t)\n\tt.start(1.0)\n");
  });

  it("applies fixes that change more only when asked", () => {
    const code = "extends Node\n\n\nfunc build() -> int:\n\tawait get_tree().process_frame\n\treturn 1\n\n\nfunc g() -> void:\n\tvar n: int = build()\n\tprint(n)\n";
    const { root, read } = project(code);
    const dry = fixProject(root);
    expect(dry.changes).toEqual([]);
    expect(dry.needsCheck).toBe(1);
    const result = fixProject(root, { includeCheck: true, write: true });
    expect(result.changes[0]).toMatchObject({ rule: "api/coroutine-without-await", safety: "check" });
    expect(read()).toContain("var n: int = await build()");
  });

  it("leaves a line alone that does not look as expected, and says why", () => {
    const { root } = project("extends Node\n\n\nfunc f() -> void:\n\tprint(get_node(\"A\").get_meta(\"k\", null))\n");
    const result = fixProject(root, { write: true });
    expect(result.changes).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ rule: "api/get-meta-null-default" });
  });

  it("runs from the CLI, with --rule and --file filters", async () => {
    const { root } = project('extends Node\n\n\nfunc f(x: Node) -> void:\n\tif x is Node3D and is_instance_valid(x):\n\t\tprint("CafÃ©")\n');
    const only = await runCli(["fix", root, "--rule", "quality/mojibake", "--json"]);
    expect(JSON.parse(only.output).changes.map((c: { rule: string }) => c.rule)).toEqual(["quality/mojibake"]);
    const none = await runCli(["fix", root, "--file", "res://missing.gd"]);
    expect(none.output).toMatch(/Nothing to fix/);
  });
});
