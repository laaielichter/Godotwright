import { describe, expect, it } from "vitest";
import { compareVersions } from "../src/api/removed.js";
import { crosses, minorVersion, versionRange } from "../src/review/checks/version.js";
import { formatFinding } from "../src/review/format.js";
import { reviewProject, type ReviewOptions } from "../src/review/review.js";
import { makeProject } from "./helpers.js";

/** Version rules (src/review/checks/version.ts and the 4.7 checks in api.ts). Each case was run in Godot 4.6.2 and 4.7.2. */

const project = (version: string, extra = "") =>
  `[application]\nconfig/name="T"\nconfig/features=PackedStringArray("${version}")\n${extra}`;
const JOLT = '\n[physics]\n\n3d/physics_engine="Jolt Physics"\n';

const ruleOnly = (l: string) => l.replace(/\] .*/, "]");

function lines(files: Record<string, string>, rules: RegExp, options: ReviewOptions = {}): string[] {
  const root = makeProject({ ".gitignore": ".godot/\n", "project.godot": project("4.7"), ...files });
  return reviewProject(root, options).findings.filter((f) => rules.test(f.rule)).map(formatFinding);
}

describe("version ranges", () => {
  it("reads 4.x versions and compares them", () => {
    expect(minorVersion("4.5.1")).toBe("4.5");
    expect(minorVersion("v4.6")).toBe("4.6");
    expect(minorVersion("3.6")).toBeUndefined();
    expect(compareVersions("4.10", "4.9")).toBeGreaterThan(0);
    expect(compareVersions("4.6", "4.6")).toBe(0);
  });

  it("takes the project's version unless from is given, and defaults the target to 4.7", () => {
    expect(versionRange("4.5")).toEqual({ from: "4.5", target: "4.7" });
    expect(versionRange("4.7")).toEqual({ target: "4.7" });
    expect(versionRange(undefined)).toEqual({ target: "4.7" });
    expect(versionRange("4.7", { from: "4.6" })).toEqual({ from: "4.6", target: "4.7" });
    expect(versionRange("4.5", { target: "4.6" })).toEqual({ from: "4.5", target: "4.6" });
    expect(versionRange("4.6", { target: "4.6" })).toEqual({ target: "4.6" });
  });

  it("refuses targets it has no verified rules for, and points to the two-binary check", () => {
    expect(() => versionRange("4.7", { target: "4.8" })).toThrow(/compare_godot/);
    expect(() => versionRange("4.7", { target: "3.5" })).toThrow(/4.1 to 4.7/);
  });

  it("crosses a release only when it lies after from and up to the target", () => {
    expect(crosses({ from: "4.5", target: "4.7" }, "4.6")).toBe(true);
    expect(crosses({ from: "4.6", target: "4.7" }, "4.6")).toBe(false);
    expect(crosses({ from: "4.5", target: "4.6" }, "4.7")).toBe(false);
    expect(crosses({ target: "4.7" }, "4.7")).toBe(false);
  });
});

describe("Godot 4.7 rules (always on)", () => {
  it("api/packed-element-write: an element write through an engine property", () => {
    const script = [
      "extends Node2D",
      "",
      "",
      "func _ready() -> void:",
      "\tvar line := Line2D.new()",
      "\tline.points[0] = Vector2.ONE",
      "\tline.points[1].x += 2.0",
      "\tvar poly := Polygon2D.new()",
      "\tpoly.polygon[0] = Vector2.ZERO",
      "\tvar copy := line.points",
      "\tcopy[0] = Vector2.ZERO",
      "\tline.points = copy",
      "\tprint(line.points[0] == Vector2.ZERO)",
      "\tline.free()",
      "\tpoly.free()",
      "",
    ].join("\n");
    expect(lines({ "main.gd": script }, /packed/)).toEqual([
      "res://main.gd:6: error [api/packed-element-write] In Godot 4.7 writing one element of Line2D.points changes a copy: the Line2D keeps the old array and nothing warns. Copy it, change the copy, assign it back: var p := line.points; p[...] = ...; line.points = p.",
      "res://main.gd:7: error [api/packed-element-write] In Godot 4.7 writing one element of Line2D.points changes a copy: the Line2D keeps the old array and nothing warns. Copy it, change the copy, assign it back: var p := line.points; p[...] = ...; line.points = p.",
      "res://main.gd:9: error [api/packed-element-write] In Godot 4.7 writing one element of Polygon2D.polygon changes a copy: the Polygon2D keeps the old array and nothing warns. Copy it, change the copy, assign it back: var p := poly.polygon; p[...] = ...; poly.polygon = p.",
    ]);
  });

  it("api/packed-element-write: an inherited property written by its bare name", () => {
    const script = "extends Line2D\n\n\nfunc _ready() -> void:\n\tpoints[0] = Vector2.ONE\n\tself.points[1] = Vector2.ONE\n";
    expect(lines({ "main.gd": script }, /packed/).map(ruleOnly)).toEqual([
      "res://main.gd:5: error [api/packed-element-write]",
      "res://main.gd:6: error [api/packed-element-write]",
    ]);
  });

  it("quality/packed-setter-skipped: only for script variables with a setter", () => {
    const script = [
      "extends Node",
      "",
      "var path: PackedVector3Array = PackedVector3Array([Vector3.ZERO]):",
      "\tset(value):",
      "\t\tpath = value",
      "\t\tupdate_gizmos()",
      "var ids: PackedInt32Array = PackedInt32Array([1]): set = _set_ids",
      "var plain: PackedInt32Array = PackedInt32Array([1])",
      "var list: Array = [1]:",
      "\tset(value):",
      "\t\tlist = value",
      "",
      "",
      "func _ready() -> void:",
      "\tpath[0] = Vector3.UP",
      "\tids[0] += 1",
      "\tplain[0] = 2",
      "\tlist[0] = 2",
      "",
      "",
      "func _set_ids(value: PackedInt32Array) -> void:",
      "\tids = value",
      "",
      "",
      "func update_gizmos() -> void:",
      "\tpass",
      "",
    ].join("\n");
    expect(lines({ "main.gd": script }, /packed/).map(ruleOnly)).toEqual([
      'res://main.gd:15: warning [quality/packed-setter-skipped]',
      'res://main.gd:16: warning [quality/packed-setter-skipped]',
    ]);
  });

  it("api/input-device-zero: keyboard and mouse events are never device 0", () => {
    const script = [
      "extends Node",
      "",
      "",
      "func _input(event: InputEvent) -> void:",
      "\tif event is InputEventKey and event.device == 0:",
      "\t\tprint(1)",
      "\tif event is InputEventJoypadButton and event.device == 0:",
      "\t\tprint(2)",
      "\tif event.device == 0:",
      "\t\tprint(3)",
      "",
      "",
      "func _unhandled_input(event: InputEvent) -> void:",
      "\tvar mouse: InputEventMouseButton = event as InputEventMouseButton",
      "\tif mouse != null and 0 != mouse.device:",
      "\t\tprint(4)",
      "",
    ].join("\n");
    expect(lines({ "main.gd": script }, /device/)).toEqual([
      "res://main.gd:5: warning [api/input-device-zero] In Godot 4.7 an InputEventKey has device InputEvent.DEVICE_ID_KEYBOARD (16), not 0, so this comparison with 0 never matches a real keyboard event. Compare with InputEvent.DEVICE_ID_KEYBOARD or test the event type.",
      "res://main.gd:15: warning [api/input-device-zero] In Godot 4.7 an InputEventMouseButton has device InputEvent.DEVICE_ID_MOUSE (32), not 0, so this comparison with 0 never matches a real mouse event. Compare with InputEvent.DEVICE_ID_MOUSE or test the event type.",
    ]);
    // A project that comes from 4.6 also hears about the plain InputEvent test, as a note.
    const root = makeProject({ "project.godot": project("4.6"), "main.gd": script });
    const notes = reviewProject(root).findings.filter((f) => f.rule === "api/input-device-zero" && f.severity === "info");
    expect(notes.map((f) => f.line)).toEqual([9]);
  });

  it("api/override-missing-return: an untyped override of a method that returns a value", () => {
    const base = "class_name BaseThing\nextends Node\n\n\nfunc value() -> int:\n\treturn 1\n\n\nfunc done() -> void:\n\tpass\n";
    const child = [
      "extends BaseThing",
      "",
      "",
      "func value():",
      "\tprint(1)",
      "",
      "",
      "func done():",
      "\tpass",
      "",
      "",
      "func _get(_property):",
      "\tpass",
      "",
      "",
      "func _get_configuration_warnings():",
      "\treturn []",
      "",
      "",
      "func _ready():",
      "\tpass",
      "",
    ].join("\n");
    expect(lines({ "base.gd": base, "child.gd": child }, /override-missing-return/)).toEqual([
      'res://child.gd:4: error [api/override-missing-return] value() has no return type, so Godot 4.7 gives it the one of BaseThing.value() (int); it never returns a value, so the script does not load ("Not all code paths return a value"). Return a int on every path.',
      'res://child.gd:12: error [api/override-missing-return] _get() has no return type, so Godot 4.7 gives it the one of Object._get() (Variant); it never returns a value, so the script does not load ("Not all code paths return a value"). Return a Variant on every path.',
    ]);
  });

  it("api/image-unit-bool: a bool where RichTextLabel now takes an ImageUnit", () => {
    const script = [
      "extends RichTextLabel",
      "",
      "",
      "func _ready() -> void:",
      '\tadd_image(null, 8, 8, Color.WHITE, INLINE_ALIGNMENT_CENTER, Rect2(), null, false, "", true, false)',
      '\tvar other := RichTextLabel.new()',
      '\tother.update_image("k", 0, null, 8, 8, Color.WHITE, INLINE_ALIGNMENT_CENTER, Rect2(), false, "", RichTextLabel.IMAGE_UNIT_PERCENT, true)',
      "\tother.free()",
      "",
    ].join("\n");
    expect(lines({ "main.gd": script }, /image-unit/).map(ruleOnly)).toEqual([
      "res://main.gd:5: error [api/image-unit-bool]",
      "res://main.gd:5: error [api/image-unit-bool]",
      "res://main.gd:7: error [api/image-unit-bool]",
    ]);
  });

  it("api/image-unit-bool: also on the typed receiver", () => {
    const script = 'extends Node\n\n\nfunc _ready() -> void:\n\tvar rtl := RichTextLabel.new()\n\trtl.add_image(null, 8, 8, Color.WHITE, INLINE_ALIGNMENT_CENTER, Rect2(), null, false, "", true, false)\n\trtl.free()\n';
    expect(lines({ "main.gd": script }, /image-unit/).map(ruleOnly)).toEqual([
      "res://main.gd:6: error [api/image-unit-bool]",
      "res://main.gd:6: error [api/image-unit-bool]",
    ]);
  });

  it("names the new name of a renamed constant", () => {
    const script = "extends Node\n\n\nfunc _ready() -> void:\n\tprint(RichTextLabel.UPDATE_WIDTH_IN_PERCENT)\n";
    expect(lines({ "main.gd": script }, /unknown-member/)).toEqual([
      'res://main.gd:5: error [api/unknown-member] "UPDATE_WIDTH_IN_PERCENT" does not exist on RichTextLabel in Godot 4.7. It was removed after Godot 4.6. Godot 4.7 renamed it to UPDATE_WIDTH_UNIT.',
    ]);
  });

  it("leaves the 4.7 rules out for an older target", () => {
    const script = "extends Line2D\n\n\nfunc _ready() -> void:\n\tpoints[0] = Vector2.ONE\n";
    const root = makeProject({ "project.godot": project("4.5"), "main.gd": script });
    expect(reviewProject(root, { target: "4.6" }).findings.filter((f) => f.rule === "api/packed-element-write")).toEqual([]);
    expect(reviewProject(root).findings.filter((f) => f.rule === "api/packed-element-write")).toHaveLength(1);
  });
});

describe("upgrade notes (only while the project moves from an older release)", () => {
  const scene = [
    "[gd_scene format=3]",
    "",
    '[sub_resource type="WorldBoundaryShape3D" id="wb"]',
    "plane = Plane(0, 1, 0, -2)",
    "",
    '[sub_resource type="WorldBoundaryShape3D" id="flat"]',
    "",
    '[sub_resource type="Environment" id="env"]',
    "glow_enabled = true",
    "volumetric_fog_enabled = true",
    "",
    '[node name="Main" type="Node3D"]',
    "",
    '[node name="Skel" type="Skeleton3D" parent="."]',
    "",
    '[node name="Body" type="MeshInstance3D" parent="Skel"]',
    "",
    '[node name="Bound" type="MeshInstance3D" parent="Skel"]',
    'skeleton = NodePath("..")',
    "",
    '[node name="Water" type="Area3D" parent="."]',
    "audio_bus_override = true",
    "",
    '[node name="Splash" type="AudioStreamPlayer3D" parent="."]',
    "",
    '[node name="Set" type="AudioStreamPlayer3D" parent="."]',
    "area_mask = 1",
    "",
    '[node name="Beep" type="AudioStreamPlayer2D" parent="."]',
    "",
    '[node name="Cloth" type="SoftBody3D" parent="."]',
    "",
    '[node name="Floor" type="CollisionShape3D" parent="."]',
    'shape = SubResource("wb")',
    "",
    '[node name="Env" type="WorldEnvironment" parent="."]',
    'environment = SubResource("env")',
    "",
  ].join("\n");
  const rules = /upgrade/;

  it("reports nothing for a project that is already on 4.7", () => {
    expect(lines({ "project.godot": project("4.7", JOLT), "main.tscn": scene }, rules)).toEqual([]);
  });

  it("reports the 4.6 and 4.7 changes for a project from 4.5", () => {
    expect(lines({ "project.godot": project("4.5", JOLT), "main.tscn": scene }, rules).map(ruleOnly)).toEqual([
      "res://main.tscn:3: warning [api/upgrade-world-boundary-jolt]",
      'res://main.tscn:16: warning [api/upgrade-mesh-skeleton]',
      'res://main.tscn:24: warning [api/upgrade-area-mask]',
      "res://main.tscn:9: info [quality/upgrade-note]",
      "res://main.tscn:10: info [quality/upgrade-note]",
      'res://main.tscn:31: info [quality/upgrade-note]',
    ]);
  });

  it("reports only the 4.7 changes for a project from 4.6, and the from option overrides the saved version", () => {
    const want = [
      "res://main.tscn:3: warning [api/upgrade-world-boundary-jolt]",
      "res://main.tscn:24: warning [api/upgrade-area-mask]",
      "res://main.tscn:31: info [quality/upgrade-note]",
    ];
    expect(lines({ "project.godot": project("4.6", JOLT), "main.tscn": scene }, rules).map((l) => l.replace(/\] .*/, "]"))).toEqual(want);
    expect(lines({ "project.godot": project("4.7", JOLT), "main.tscn": scene }, rules, { from: "4.6" }).map((l) => l.replace(/\] .*/, "]"))).toEqual(want);
  });

  it("stops at the target", () => {
    expect(lines({ "project.godot": project("4.5", JOLT), "main.tscn": scene }, rules, { target: "4.6" }).map((l) => l.replace(/\] .*/, "]"))).toEqual([
      "res://main.tscn:16: warning [api/upgrade-mesh-skeleton]",
      "res://main.tscn:9: info [quality/upgrade-note]",
      "res://main.tscn:10: info [quality/upgrade-note]",
    ]);
  });

  it("needs Jolt for the plane and soft body notes, and respects the skeleton compatibility setting", () => {
    const compat = "\n[animation]\n\ncompatibility/default_parent_skeleton_in_mesh_instance_3d=true\n";
    const found = lines({ "project.godot": project("4.5", compat), "main.tscn": scene }, rules).map((l) => l.replace(/\] .*/, "]"));
    expect(found).toEqual(["res://main.tscn:24: warning [api/upgrade-area-mask]", "res://main.tscn:9: info [quality/upgrade-note]", "res://main.tscn:10: info [quality/upgrade-note]"]);
  });

  it("puts the upgrade in the report", () => {
    const root = makeProject({ "project.godot": project("4.5"), "main.tscn": scene });
    expect(reviewProject(root).upgrade).toEqual({ from: "4.5", target: "4.7" });
    expect(reviewProject(makeProject({ "project.godot": project("4.7") })).upgrade).toBeUndefined();
  });
});
