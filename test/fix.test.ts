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

describe("godotwright fix: Godot 4.7 upgrade fixes", () => {
  it("copies a packed array, writes the copy and assigns it back", () => {
    const { root, read } = project(
      "extends Node\n\nvar pts: PackedInt32Array = [1, 2]:\n\tset(v):\n\t\tpts = v\n\n\nfunc f(line: Line2D) -> void:\n\tline.points[0] = Vector2(5, 5)\n\tpts[0] = 9\n",
    );
    const dry = fixProject(root);
    expect(dry.changes.map((c) => [c.rule, c.safety])).toEqual([["api/packed-element-write", "safe"]]);
    expect(dry.needsCheck).toBe(1);
    fixProject(root, { write: true, includeCheck: true });
    expect(read()).toContain("\tvar points_copy := line.points\n\tpoints_copy[0] = Vector2(5, 5)\n\tline.points = points_copy\n");
    expect(read()).toContain("\tvar pts_copy := pts\n\tpts_copy[0] = 9\n\tpts = pts_copy\n");
  });

  it("gives each copy in a function its own name, untyped after $", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "a.gd": 'extends Node2D\n\n\nfunc _ready() -> void:\n\tvar line: Line2D = $Line\n\tline.points[0] = Vector2(5, 5)\n\t$Line.points[1] = Vector2(6, 6)\n',
      "main.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://a.gd" id="1"]\n\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n\n[node name="Line" type="Line2D" parent="."]\n',
    });
    fixProject(root, { write: true });
    const fixed = readFileSync(join(root, "a.gd"), "utf8");
    expect(fixed).toContain("\tvar points_copy_6 := line.points\n");
    expect(fixed).toContain("\tvar points_copy_7 = $Line.points\n\tpoints_copy_7[1] = Vector2(6, 6)\n\t$Line.points = points_copy_7\n");
  });

  it("leaves a packed write alone when the statement goes on past the line", () => {
    const source = "extends Line2D\n\n\nfunc _ready() -> void:\n\tpoints[0] = Vector2(1,\n\t\t2)\n\tpoints[1] = \\\n\t\tVector2.ONE\n";
    const { root, read } = project(source);
    const result = fixProject(root, { write: true, includeCheck: true });
    expect(result.changes.filter((c) => c.rule === "api/packed-element-write")).toEqual([]);
    expect(read()).toBe(source);
  });

  it("replaces a bool image unit with the matching ImageUnit", () => {
    const { root, read } = project(
      'extends RichTextLabel\n\n\nfunc _ready() -> void:\n\tadd_image(null, 8, 8, Color.WHITE, INLINE_ALIGNMENT_CENTER, Rect2(), null, false, "", true, false)\n',
    );
    fixProject(root, { write: true });
    expect(read()).toContain('Rect2(), null, false, "", RichTextLabel.IMAGE_UNIT_PERCENT, RichTextLabel.IMAGE_UNIT_PIXEL)');
  });

  it("restores the old area_mask and skeleton defaults in a scene from 4.6", () => {
    const scene = [
      "[gd_scene format=3]",
      "",
      '[node name="Main" type="Node3D"]',
      "",
      '[node name="Water" type="Area3D" parent="."]',
      "audio_bus_override = true",
      "",
      '[node name="Splash" type="AudioStreamPlayer3D" parent="."]',
      "",
      '[node name="Skel" type="Skeleton3D" parent="."]',
      "",
      '[node name="Body" type="MeshInstance3D" parent="Skel"]',
      "",
    ].join("\n");
    const root = makeProject({ "project.godot": PROJECT.replace('"4.7"', '"4.5"'), "main.tscn": scene });
    const result = fixProject(root, { write: true });
    expect(result.changes.map((c) => c.rule)).toEqual(["api/upgrade-area-mask", "api/upgrade-mesh-skeleton"]);
    const fixed = readFileSync(join(root, "main.tscn"), "utf8");
    expect(fixed).toContain('[node name="Splash" type="AudioStreamPlayer3D" parent="."]\narea_mask = 1\n');
    expect(fixed).toContain('[node name="Body" type="MeshInstance3D" parent="Skel"]\nskeleton = NodePath("..")\n');
    expect(fixProject(root).changes).toEqual([]);
  });
});
