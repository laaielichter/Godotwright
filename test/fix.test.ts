import { cpSync, existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXABLE_RULES, fixProject, formatFix } from "../src/fix/fix.js";
import { RULES } from "../src/review/rules.js";
import { undoJournal } from "../src/journal/journal.js";
import { reviewProject } from "../src/review/review.js";
import { isUidText } from "../src/scene/uid.js";
import { FIXTURES, makeProject, runCli, tempFolder } from "./helpers.js";

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

describe("godotwright fix: uids and resource sections", () => {
  const copy = () => {
    const root = tempFolder("godotwright-uid-");
    cpSync(join(FIXTURES, "uid-integrity"), root, { recursive: true });
    return { root, read: (f: string) => readFileSync(join(root, f), "utf8") };
  };
  const integrity = (root: string) => reviewProject(root).findings.filter((f) => /uid|unused-resource|locked-instance/.test(f.rule));

  it("repairs uids across files, journaled, and says what it changed", () => {
    const { root, read } = copy();
    const dry = fixProject(root);
    expect(dry.needsCheck).toBe(3);
    expect(dry.changes.map((c) => `${c.file}:${c.line} ${c.rule}`)).toEqual([
      "res://bad.tres:1 structure/invalid-uid",
      "res://broken.tscn:20 structure/unused-resource",
      "res://dup.tscn:1 structure/duplicate-uid",
      "res://lost.gd.uid:1 structure/unknown-uid",
      "res://main.tscn:3 structure/unknown-uid",
      "res://main.tscn:6 structure/duplicate-uid",
      "res://main.tscn:8 structure/unused-resource",
    ]);
    const result = fixProject(root, { includeCheck: true, write: true });
    expect(result.written).toBe(true);
    // child.tscn is named by two references with its uid, so it keeps it; the copy gets a new one and main.tscn follows.
    const dupUid = /uid="([^"]+)"/.exec(read("dup.tscn"))![1]!;
    expect(isUidText(dupUid) && dupUid !== "uid://bkq3oe5w8x1y2").toBe(true);
    expect(read("child.tscn")).toContain('uid="uid://bkq3oe5w8x1y2"');
    expect(read("main.tscn")).toContain(`[ext_resource type="PackedScene" uid="${dupUid}" path="res://dup.tscn" id="4_dup"]`);
    // The lost .uid file comes back with the uid the scene uses; stale and mismatched uids follow their path.
    expect(read("lost.gd.uid")).toBe("uid://blost0000001\n");
    expect(read("main.tscn")).toContain('uid="uid://cn4bl1ld7y0ek" path="res://s.gd"');
    expect(read("main.tscn")).toContain('uid="uid://c5t7wm2ds0yb4" path="res://other.tscn"');
    expect(read("main.tscn")).not.toContain("6_unused");
    expect(read("main.tscn")).toMatch(/\n\[editable path="Inst"\]\n\n\[editable path="Inst\/Sub"\]\n$/);
    expect(isUidText(/uid="([^"]+)"/.exec(read("bad.tres"))![1]!)).toBe(true);
    expect(integrity(root).map((f) => f.rule)).toEqual([]);
    // Run again: nothing left, and it says so.
    const again = fixProject(root, { includeCheck: true });
    expect(again.changes).toEqual([]);
    expect(formatFix(again)).toMatch(/^fix: 0 fixes in 0 files\n/);
    // godot_undo puts every file back and removes the .uid file it made.
    undoJournal(root);
    expect(existsSync(join(root, "lost.gd.uid"))).toBe(false);
    expect(read("dup.tscn")).toBe(read("child.tscn"));
    expect(integrity(root).length).toBeGreaterThan(5);
  });

  it("keeps a duplicated uid on the file Godot resolves it to, and asks for a check when only uid references could tell", () => {
    const files = {
      "project.godot": PROJECT + 'run/main_scene="uid://caaaaaaaaaa1"\n',
      "a.tscn": '[gd_scene format=3 uid="uid://caaaaaaaaaa1"]\n\n[node name="A" type="Node"]\n',
      "sub/b.tscn": '[gd_scene format=3 uid="uid://caaaaaaaaaa1"]\n\n[node name="B" type="Node"]\n',
      "s.gd": 'extends Node\nconst S = preload("uid://caaaaaaaaaa1")\n',
      "main.tscn":
        '[gd_scene format=3]\n\n[ext_resource type="PackedScene" uid="uid://caaaaaaaaaa1" path="res://sub/b.tscn" id="1"]\n[ext_resource type="PackedScene" uid="uid://caaaaaaaaaa1" path="res://sub/b.tscn" id="2"]\n\n[node name="Main" type="Node"]\n\n[node name="X" parent="." instance=ExtResource("1")]\n\n[node name="Y" parent="." instance=ExtResource("2")]\n',
    };
    // No uid cache: the main scene and the preload name the uid alone, so which file keeps it needs a check.
    const root = makeProject(files);
    const dry = fixProject(root);
    expect(dry.changes).toEqual([]);
    expect(dry.needsCheck).toBe(1);
    const checked = fixProject(root, { includeCheck: true });
    expect(checked.changes.map((c) => `${c.file} ${c.safety}`)).toEqual(["res://a.tscn check"]);
    expect(checked.changes[0]!.note).toContain("2 references by uid alone (res://project.godot:4, res://s.gd:2) will load res://sub/b.tscn");
    // Godot's uid cache says the uid loads a.tscn now: a.tscn keeps it, safely, and the references to b.tscn follow b.
    const cached = makeProject(files);
    const name = Buffer.from("res://a.tscn");
    const entry = Buffer.alloc(12);
    entry.writeBigInt64LE(140377687276064794n, 0); // uid://caaaaaaaaaa1, as Godot 4.7.2 stores it
    entry.writeUInt32LE(name.length, 8);
    const count = Buffer.alloc(4);
    count.writeUInt32LE(1);
    mkdirSync(join(cached, ".godot"), { recursive: true });
    writeFileSync(join(cached, ".godot", "uid_cache.bin"), Buffer.concat([count, entry, name]));
    const result = fixProject(cached, { write: true });
    expect(result.changes.map((c) => `${c.file}:${c.line} ${c.safety}`)).toEqual(["res://main.tscn:3 safe", "res://main.tscn:4 safe", "res://sub/b.tscn:1 safe"]);
    expect(readFileSync(join(cached, "a.tscn"), "utf8")).toContain('uid="uid://caaaaaaaaaa1"');
    const fresh = /uid="([^"]+)"/.exec(readFileSync(join(cached, "sub/b.tscn"), "utf8"))![1]!;
    expect(fresh).not.toBe("uid://caaaaaaaaaa1");
    expect(readFileSync(join(cached, "main.tscn"), "utf8")).toContain(`uid="${fresh}" path="res://sub/b.tscn" id="1"`);
  });

  it("gives a copied script or asset a new uid in its .uid or .import file, and keeps the original's", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "a.gd": "extends Node\n",
      "a.gd.uid": "uid://cn4bl1ld7y0ek\n",
      "b.gd": "extends Node\n",
      "b.gd.uid": "uid://cn4bl1ld7y0ek\n",
      "i.svg": "<svg/>",
      "i.svg.import": '[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\nuid="uid://be8plvbljqn73"\n',
      "j.svg": "<svg/>",
      "j.svg.import": '[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\nuid="uid://be8plvbljqn73"\n',
      "main.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" uid="uid://cn4bl1ld7y0ek" path="res://b.gd" id="1_b"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1_b")\n',
    });
    // Same number of references: the older file keeps the uid.
    utimesSync(join(root, "i.svg"), new Date(2020, 1, 1), new Date(2020, 1, 1));
    utimesSync(join(root, "a.gd"), new Date(2020, 1, 1), new Date(2020, 1, 1));
    const result = fixProject(root, { write: true });
    // Godot rereads a .uid file only when its script changed, so the script is touched.
    expect(statSync(join(root, "a.gd")).mtimeMs).toBeGreaterThan(new Date(2021, 1, 1).getTime());
    const read = (f: string) => readFileSync(join(root, f), "utf8");
    expect(result.changes.map((c) => `${c.file} ${c.rule}`)).toEqual(["res://a.gd.uid structure/duplicate-uid", "res://j.svg.import structure/duplicate-uid"]);
    expect(read("b.gd.uid")).toBe("uid://cn4bl1ld7y0ek\n");
    expect(read("a.gd.uid")).toMatch(/^uid:\/\/[a-y0-8]+\n$/);
    expect(read("i.svg.import")).toContain('uid="uid://be8plvbljqn73"');
    expect(read("j.svg.import")).toMatch(/\nuid="uid:\/\/[a-y0-8]+"\n/);
    expect(read("j.svg.import")).not.toContain("be8plvbljqn73");
  });

  it("stamps uids on files without one when asked, not in addons", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "a.gd": "extends Node\n",
      "s.gdshader": "shader_type spatial;\n",
      "addons/x/p.gd": "extends Node\n",
      "g.tres": '[gd_resource type="Gradient" format=3]\n\n[resource]\n',
      "main.tscn": '[gd_scene load_steps=2 format=3]\n\n[node name="Main" type="Node"]\n',
    });
    expect(fixProject(root, { write: true }).changes).toEqual([]);
    const result = fixProject(root, { write: true, stampUids: true });
    const read = (f: string) => readFileSync(join(root, f), "utf8");
    expect(result.changes.map((c) => c.file)).toEqual(["res://a.gd.uid", "res://g.tres", "res://main.tscn", "res://s.gdshader.uid"]);
    expect(read("a.gd.uid")).toMatch(/^uid:\/\/[a-y0-8]+\n$/);
    expect(read("main.tscn")).toMatch(/^\[gd_scene load_steps=2 format=3 uid="uid:\/\/[a-y0-8]+"\]\n/);
    expect(existsSync(join(root, "addons/x/p.gd.uid"))).toBe(false);
    expect(fixProject(root, { stampUids: true }).changes).toEqual([]);
  });

  it("removes an unused sub_resource block and keeps the blank lines tidy", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.tscn": '[gd_scene format=3]\n\n[sub_resource type="Gradient" id="used"]\n\n[sub_resource type="Gradient" id="unused"]\noffsets = PackedFloat32Array(0, 1)\n\n[node name="Main" type="Node"]\nmetadata/g = SubResource("used")\n',
    });
    fixProject(root, { write: true });
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toBe('[gd_scene format=3]\n\n[sub_resource type="Gradient" id="used"]\n\n[node name="Main" type="Node"]\nmetadata/g = SubResource("used")\n');
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
