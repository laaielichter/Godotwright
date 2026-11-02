import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";
import { fixProject } from "../../src/fix/fix.js";
import { reviewProject } from "../../src/review/review.js";
import { FIXTURES, makeProject, tempFolder } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

/** Loads main.tscn the way the editor does, saves it again and prints what survived. */
const RESAVE = `extends SceneTree


func _initialize() -> void:
	var scene: Node = (load("res://main.tscn") as PackedScene).instantiate(PackedScene.GEN_EDIT_STATE_MAIN)
	var packed := PackedScene.new()
	packed.pack(scene)
	ResourceSaver.save(packed, "res://resaved.tscn")
	scene.free()
	var again: Node = (load("res://resaved.tscn") as PackedScene).instantiate()
	print("KEPT inner=", (again.get_node("Inst/Inner") as Node2D).position, " x=", (again.get_node("Inst/Sub/X") as Node2D).position, " deep=", again.has_node("Inst/Inner/NewDeep"))
	for file: String in ["res://lost.gd", "res://bad.tres", "res://dup.tscn", "res://child.tscn", "res://g.tres"]:
		print("UID ", file, " ", ResourceUID.id_to_text(ResourceLoader.get_resource_uid(file)))
	again.free()
	quit(0)
`;

function godot(root: string, ...args: string[]): string {
  const r = spawnSync(GODOT!, ["--headless", "--path", root, ...args], { encoding: "utf8", timeout: 120_000 });
  return `${r.stdout}\n${r.stderr}`;
}

const uidWarnings = (log: string) => log.split("\n").filter((l) => /UID duplicate detected|invalid UID/.test(l));

function fixture(): string {
  const root = tempFolder("godotwright-integrity-");
  cpSync(join(FIXTURES, "uid-integrity"), root, { recursive: true });
  // broken.tscn does not load at all; it has its own test below.
  rmSync(join(root, "broken.tscn"));
  writeFileSync(join(root, "resave.gd"), RESAVE);
  return root;
}

describe.skipIf(!GODOT)("scene and resource integrity against Godot 4.7", () => {
  it("Godot warns about what the review finds, and drops edits inside locked instances", { timeout: 300_000 }, async () => {
    const root = fixture();
    const imported = godot(root, "--import");
    expect(uidWarnings(imported)).toEqual([
      expect.stringMatching(/UID duplicate detected between res:\/\/(dup|child)\.tscn and res:\/\/(child|dup)\.tscn/),
      expect.stringContaining("res://main.tscn:3 - ext_resource, invalid UID: uid://bstale0000001"),
      expect.stringContaining("res://main.tscn:7 - ext_resource, invalid UID: uid://blost0000001"),
    ]);
    // godot_check reports them with the rule that predicted them.
    const check = await checkProject(root, { godot: GODOT });
    const rules = new Set(check.diagnostics.map((d) => d.rule).filter(Boolean));
    expect([...rules].sort()).toEqual(["structure/duplicate-uid", "structure/unknown-uid"]);
    // An editor save drops the overrides and the node inside the instance that is not editable.
    expect(godot(root, "-s", "res://resave.gd")).toContain("KEPT inner=(0.0, 0.0) x=(0.0, 0.0) deep=false");
  });

  it("a repaired project imports and loads without a uid warning, and keeps its edits on an editor save", { timeout: 300_000 }, async () => {
    const root = fixture();
    const result = fixProject(root, { includeCheck: true, stampUids: true, write: true });
    expect(result.written).toBe(true);
    expect(reviewProject(root).findings.filter((f) => f.category === "structure" && f.severity !== "info" && f.file !== "res://resave.gd")).toEqual([]);
    const lost = readFileSync(join(root, "lost.gd.uid"), "utf8");
    const bad = /uid="([^"]+)"/.exec(readFileSync(join(root, "bad.tres"), "utf8"))![1];
    const dup = /uid="([^"]+)"/.exec(readFileSync(join(root, "dup.tscn"), "utf8"))![1];

    const imported = godot(root, "--import");
    expect(uidWarnings(imported)).toEqual([]);
    const check = await checkProject(root, { godot: GODOT });
    expect(uidWarnings(check.diagnostics.map((d) => d.message).join("\n"))).toEqual([]);
    expect(check.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const out = godot(root, "-s", "res://resave.gd");
    expect(out).toContain("KEPT inner=(5.0, 5.0) x=(7.0, 7.0) deep=true");
    // Godot registered the uids Godotwright wrote: the restored one, the new valid one, the copy's new one.
    expect(out).toContain(`UID res://lost.gd ${lost.trim()}`);
    expect(out).toContain(`UID res://bad.tres ${bad}`);
    expect(out).toContain(`UID res://dup.tscn ${dup}`);
    expect(out).toContain("UID res://child.tscn uid://bkq3oe5w8x1y2");
    // Godot kept the .uid file as written.
    expect(readFileSync(join(root, "lost.gd.uid"), "utf8")).toBe(lost);
    // Godot changed no scene or resource file that Godotwright wrote.
    expect(godot(root, "--import")).not.toMatch(/WARNING|ERROR/);
  });

  it("stamped uids are ones Godot reads, and a copied script's .uid gets a new one", { timeout: 300_000 }, () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Stamp"\nconfig/features=PackedStringArray("4.7")\n',
      "a.gd": "extends Node\n",
      "s.gdshader": "shader_type spatial;\n",
      "g.tres": '[gd_resource type="Gradient" format=3]\n\n[resource]\n',
      "m.tscn": '[gd_scene format=3]\n\n[node name="M" type="Node"]\n',
      "check.gd": 'extends SceneTree\n\n\nfunc _initialize() -> void:\n\tfor file: String in ["res://a.gd", "res://b.gd", "res://s.gdshader", "res://g.tres", "res://m.tscn"]:\n\t\tprint("UID ", file, " ", ResourceUID.id_to_text(ResourceLoader.get_resource_uid(file)))\n\tquit(0)\n',
    });
    fixProject(root, { stampUids: true, write: true });
    // Copy a script with its .uid file, as a file manager does.
    cpSync(join(root, "a.gd"), join(root, "b.gd"));
    cpSync(join(root, "a.gd.uid"), join(root, "b.gd.uid"));
    expect(uidWarnings(godot(root, "--import"))).toEqual([expect.stringContaining("UID duplicate detected")]);
    expect(fixProject(root, { write: true }).changes.map((c) => `${c.file} ${c.rule}`)).toEqual(["res://b.gd.uid structure/duplicate-uid"]);
    expect(uidWarnings(godot(root, "--import"))).toEqual([]);
    const out = godot(root, "-s", "res://check.gd");
    const read = (f: string) => readFileSync(join(root, f), "utf8");
    for (const [file, uid] of [
      ["a.gd", read("a.gd.uid").trim()],
      ["b.gd", read("b.gd.uid").trim()],
      ["s.gdshader", read("s.gdshader.uid").trim()],
      ["g.tres", /uid="([^"]+)"/.exec(read("g.tres"))![1]],
      ["m.tscn", /uid="([^"]+)"/.exec(read("m.tscn"))![1]],
    ]) {
      expect(uid).toMatch(/^uid:\/\/[a-y0-8]+$/);
      expect(out).toContain(`UID res://${file} ${uid}`);
    }
    expect(read("a.gd.uid")).not.toBe(read("b.gd.uid"));
  });

  it("a duplicated uid stays on the file Godot loads for it, so the main scene and uid references do not change", { timeout: 300_000 }, () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="D"\nconfig/features=PackedStringArray("4.7")\nrun/main_scene="uid://caaaaaaaaaa1"\n',
      "a.tscn": '[gd_scene format=3 uid="uid://caaaaaaaaaa1"]\n\n[node name="A" type="Node"]\n',
      "sub/b.tscn": '[gd_scene format=3 uid="uid://caaaaaaaaaa1"]\n\n[node name="B" type="Node"]\n',
      "s.gd": 'extends Node\nconst S = preload("uid://caaaaaaaaaa1")\n',
      "main.tscn":
        '[gd_scene format=3]\n\n[ext_resource type="PackedScene" uid="uid://caaaaaaaaaa1" path="res://sub/b.tscn" id="1"]\n[ext_resource type="PackedScene" uid="uid://caaaaaaaaaa1" path="res://sub/b.tscn" id="2"]\n\n[node name="Main" type="Node"]\n\n[node name="X" parent="." instance=ExtResource("1")]\n\n[node name="Y" parent="." instance=ExtResource("2")]\n',
      "q.gd": 'extends SceneTree\n\n\nfunc _initialize() -> void:\n\tprint("RES ", ResourceUID.get_id_path(ResourceUID.text_to_id("uid://caaaaaaaaaa1")))\n\tquit(0)\n',
    });
    // Before Godot has scanned the project, the references by uid alone leave the choice to a check.
    expect(fixProject(root).needsCheck).toBe(1);
    expect(uidWarnings(godot(root, "--import"))).toHaveLength(1);
    const before = /RES (\S+)/.exec(godot(root, "-s", "res://q.gd"))![1];
    // Godot's uid cache now says which file the uid loads: that file keeps it, as a safe fix.
    const result = fixProject(root, { write: true });
    expect(result.changes.every((c) => c.safety === "safe")).toBe(true);
    expect(result.changes.some((c) => before && c.file === before)).toBe(false);
    expect(uidWarnings(godot(root, "--import"))).toEqual([]);
    expect(/RES (\S+)/.exec(godot(root, "-s", "res://q.gd"))![1]).toBe(before);
  });

  it("edits inside an instance the instanced or inherited scene marks editable itself survive an editor save", { timeout: 300_000 }, () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="L"\nconfig/features=PackedStringArray("4.7")\n',
      "leaf.tscn": '[gd_scene format=3]\n\n[node name="Leaf" type="Node2D"]\n\n[node name="Sprite" type="Node2D" parent="."]\n',
      "mid.tscn": '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://leaf.tscn" id="1_l"]\n\n[node name="Mid" type="Node2D"]\n\n[node name="L" parent="." instance=ExtResource("1_l")]\n\n[node name="Sprite" parent="L"]\nposition = Vector2(1, 1)\n\n[editable path="L"]\n',
      "inh.tscn": '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://mid.tscn" id="1_m"]\n\n[node name="Mid" instance=ExtResource("1_m")]\n\n[node name="Sprite" parent="L"]\nposition = Vector2(9, 9)\n',
      "top.tscn": '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://mid.tscn" id="1_m"]\n\n[node name="Top" type="Node2D"]\n\n[node name="M" parent="." instance=ExtResource("1_m")]\n\n[node name="Sprite" parent="M/L"]\nposition = Vector2(3, 3)\n\n[editable path="M"]\n',
      "resave.gd": `extends SceneTree


func _initialize() -> void:
	for pair: Array in [["inh", "L/Sprite"], ["top", "M/L/Sprite"]]:
		var scene: Node = (load("res://%s.tscn" % pair[0]) as PackedScene).instantiate(PackedScene.GEN_EDIT_STATE_MAIN)
		var packed := PackedScene.new()
		packed.pack(scene)
		ResourceSaver.save(packed, "res://resaved_%s.tscn" % pair[0])
		scene.free()
		var again: Node = (load("res://resaved_%s.tscn" % pair[0]) as PackedScene).instantiate()
		print("KEPT ", pair[0], " ", (again.get_node(pair[1]) as Node2D).position)
		again.free()
	quit(0)
`,
    });
    expect(reviewProject(root).findings.filter((f) => f.rule === "structure/locked-instance-edit")).toEqual([]);
    godot(root, "--import");
    const out = godot(root, "-s", "res://resave.gd");
    expect(out).toContain("KEPT inh (9.0, 9.0)");
    expect(out).toContain("KEPT top (3.0, 3.0)");
  });

  it("files the review says do not load fail in Godot", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Broken"\nconfig/features=PackedStringArray("4.7")\n',
      ".gitignore": ".godot/\n",
      "s.gd": "extends Node\n",
      "broken.tscn": readFileSync(join(FIXTURES, "uid-integrity", "broken.tscn"), "utf8"),
      "missing_ext.tres": '[gd_resource type="GradientTexture1D" format=3]\n\n[resource]\ngradient = ExtResource("nope")\n',
      "late_sub.tscn": '[gd_scene format=3]\n\n[node name="Root" type="Node"]\n\n[sub_resource type="Gradient" id="g"]\n',
      "late_sub.tres": '[gd_resource type="GradientTexture1D" format=3]\n\n[resource]\nwidth = 8\n\n[sub_resource type="Gradient" id="g"]\n',
    });
    const review = reviewProject(root).findings.filter((f) => f.severity === "error");
    const flagged = [...new Set(review.filter((f) => /resource-id|section-order/.test(f.rule)).map((f) => f.file))].sort();
    expect(flagged).toEqual(["res://broken.tscn", "res://late_sub.tres", "res://late_sub.tscn", "res://missing_ext.tres"]);
    writeFileSync(
      join(root, "load.gd"),
      `extends SceneTree\n\n\nfunc _initialize() -> void:\n\tfor file: String in ${JSON.stringify(flagged)}:\n\t\tprint("LOADED ", file, " ", load(file) != null)\n\tquit(0)\n`,
    );
    godot(root, "--import");
    const out = godot(root, "-s", "res://load.gd");
    for (const file of flagged) expect(out).toContain(`LOADED ${file} false`);
    // godot_check sees the scenes fail too.
    const check = await checkProject(root, { godot: GODOT });
    const failed = new Set(check.diagnostics.filter((d) => d.severity === "error").map((d) => d.file));
    expect(failed.has("res://broken.tscn") && failed.has("res://late_sub.tscn")).toBe(true);
  });
});
