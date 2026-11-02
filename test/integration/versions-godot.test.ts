import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";
import { compareGodot } from "../../src/check/compare.js";
import { godotVersion } from "../../src/check/godot.js";
import { reviewProject } from "../../src/review/review.js";
import { makeProject } from "../helpers.js";

/**
 * The Godot 4.7 behaviour the version rules describe, checked in a real Godot 4.7 ($GODOT), and the two-binary check
 * with a second Godot in $GODOT_NEXT (for example 4.6.2 or a 4.8 beta). CI provides $GODOT.
 */
const GODOT = process.env["GODOT"];
const NEXT = process.env["GODOT_NEXT"];

const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Versions"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n';
const SCENE = '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n';

/** Runs, prints what 4.7 does, and only uses code that loads in 4.6 and 4.7. */
const PROBE = [
  "extends Node2D",
  "",
  "var calls: int = 0",
  "var path_points: PackedInt32Array = PackedInt32Array([1, 2]):",
  "\tset(value):",
  "\t\tcalls += 1",
  "\t\tpath_points = value",
  "",
  "",
  "func _ready() -> void:",
  "\tvar line := Line2D.new()",
  "\tline.points = PackedVector2Array([Vector2.ZERO, Vector2.ZERO])",
  "\tline.points[0] = Vector2(5, 5)",
  '\tprint("LINE ", line.points[0])',
  "\tpath_points[0] = 9",
  '\tprint("SETTER ", calls, " ", path_points[0])',
  "\tvar key := InputEventKey.new()",
  "\tvar mouse := InputEventMouseButton.new()",
  "\tif key.device == 0:",
  '\t\tprint("KEY DEVICE ZERO")',
  '\tprint("DEVICES ", key.device, " ", mouse.device)',
  "\tline.free()",
  "",
].join("\n");

/** Loads in 4.6, but not in 4.7: an untyped override that returns nothing, and a bool image unit. */
const BREAKS = [
  "extends Node",
  "",
  "",
  "func _get(_property):",
  "\tpass",
  "",
  "",
  "func show_icon(label: RichTextLabel, icon: Texture2D) -> void:",
  '\tlabel.add_image(icon, 8, 8, Color.WHITE, INLINE_ALIGNMENT_CENTER, Rect2(), null, false, "", true, false)',
  "",
].join("\n");

describe.skipIf(!GODOT)("version rules against a real Godot 4.7", () => {
  it("the packed-array and device rules describe what Godot 4.7 does", { timeout: 300_000 }, async () => {
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": SCENE, "main.gd": PROBE });
    const rules = reviewProject(root).findings.map((f) => `${f.line} ${f.rule}`);
    expect(rules).toEqual(expect.arrayContaining(["13 api/packed-element-write", "15 quality/packed-setter-skipped", "19 api/input-device-zero"]));
    const result = await checkProject(root, { godot: GODOT, runFrames: 5 });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // The element write is lost, the setter does not run (the array still changes), and keyboard/mouse are not device 0.
    expect(result.output).toContain("LINE (0.0, 0.0)");
    expect(result.output).toContain("SETTER 0 9");
    expect(result.output).not.toContain("KEY DEVICE ZERO");
    expect(result.output).toContain("DEVICES 16 32");
  });

  it("the override and image-unit rules point at the lines Godot 4.7 refuses", { timeout: 300_000 }, async () => {
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": SCENE.replace("Node2D", "Node"), "main.gd": BREAKS });
    const review = reviewProject(root).findings.filter((f) => f.severity === "error").map((f) => `${f.line} ${f.rule}`);
    expect(review).toEqual(["4 api/override-missing-return", "9 api/image-unit-bool", "9 api/image-unit-bool"]);
    const result = await checkProject(root, { godot: GODOT });
    const godot = result.diagnostics.filter((d) => d.severity === "error" && d.file === "res://main.gd").map((d) => `${d.line} ${d.message}`);
    expect(godot).toEqual(expect.arrayContaining(["4 Parse Error: Not all code paths return a value."]));
    expect(godot.some((l) => l.startsWith("9 ") && /RichTextLabel\.ImageUnit/.test(l))).toBe(true);
  });
});

describe.skipIf(!GODOT || !NEXT)("check with a second Godot ($GODOT_NEXT)", () => {
  it("reports only what differs, from a copy of the project", { timeout: 600_000 }, async () => {
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": SCENE.replace("Node2D", "Node"), "main.gd": BREAKS });
    const result = await compareGodot(root, { godot: GODOT, compareGodot: NEXT });
    const [a, b] = [await godotVersion(GODOT!), await godotVersion(NEXT!)];
    const minor = (v: string) => v.split(".").slice(0, 2).join(".");
    const lines = (list: typeof result.onlyOther) => list.map((d) => `${d.line} ${d.message}`);
    if (minor(a) === minor(b)) {
      expect(result.onlyOther).toEqual([]);
      expect(result.onlyBase).toEqual([]);
    } else if (minor(a) === "4.7" && minor(b) === "4.6") {
      // 4.6 loads the script: the 4.7 errors are gone there.
      expect(lines(result.onlyBase)).toEqual(expect.arrayContaining(["4 Parse Error: Not all code paths return a value."]));
      expect(result.onlyOther.filter((d) => d.severity === "error")).toEqual([]);
    } else {
      // A newer release: whatever it adds is reported, and the errors 4.7 already reports are not repeated as new.
      expect(lines(result.onlyOther)).not.toContain("4 Parse Error: Not all code paths return a value.");
    }
  });
});
