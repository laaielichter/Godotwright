import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffProject, diffResourceText, diffScriptText, formatDiff } from "../src/diff/diff.js";
import { GitError } from "../src/project/git.js";
import { commitAll } from "./git-helpers.js";
import { makeProject, runCli } from "./helpers.js";

const PLAYER_SCENE = `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://player.gd" id="1_s"]

[sub_resource type="CircleShape2D" id="CircleShape2D_1"]
radius = 12.0

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1_s")
speed = 200.0

[node name="Shape" type="CollisionShape2D" parent="."]
shape = SubResource("CircleShape2D_1")

[node name="Sprite" type="Sprite2D" parent="."]

[node name="Hitbox" type="Area2D" parent="."]
collision_mask = 3

[connection signal="body_entered" from="Hitbox" to="." method="_on_hit"]
`;

const PLAYER_SCRIPT = `class_name Player
extends CharacterBody2D

signal died

@export var speed: float = 200.0

func _physics_process(delta: float) -> void:
	if Input.is_action_just_pressed("jump"):
		velocity.y = -300.0

func take_damage(amount: int) -> void:
	Game.score -= amount

func heal(amount: int) -> void:
	pass

func _on_hit(body: Node2D) -> void:
	take_damage(1)
`;

function game(): string {
  const root = makeProject({
    "project.godot": 'config_version=5\n\n[application]\nrun/main_scene="res://main.tscn"\n\n[autoload]\nGame="*res://game.gd"\n\n[input]\njump={\n"deadzone": 0.5,\n"events": []\n}\n',
    "game.gd": "extends Node\nvar score: int = 0\n",
    "main.tscn": '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="PackedScene" path="res://player.tscn" id="1_a"]\n\n[node name="Main" type="Node2D"]\n\n[node name="Player" parent="." instance=ExtResource("1_a")]\nspeed = 250.0\n',
    "player.tscn": PLAYER_SCENE,
    "player.gd": PLAYER_SCRIPT,
    "enemy.gd": "extends Node\n\nfunc attack(p: Player) -> void:\n\tp.take_damage(2)\n\tp.heal(1)\n",
    "glow.gdshader": "shader_type canvas_item;\nuniform float strength = 1.0;\nuniform vec4 tint : source_color;\nvoid fragment() {\n\tCOLOR *= tint * strength;\n}\n",
    "glow.tres": '[gd_resource type="ShaderMaterial" load_steps=2 format=3]\n\n[ext_resource type="Shader" path="res://glow.gdshader" id="1_g"]\n\n[resource]\nshader = ExtResource("1_g")\nshader_parameter/strength = 2.0\n',
    "icon.png": "png",
  });
  commitAll(root);
  return root;
}

describe("scene diff by meaning", () => {
  it("reports nodes, properties inside sub-resources, connections and loads, not ids", () => {
    const after = PLAYER_SCENE.replaceAll("CircleShape2D_1", "CircleShape2D_zz9")
      .replace("radius = 12.0", "radius = 16.0")
      .replace("collision_mask = 3", "collision_mask = 4\nmonitoring = false")
      .replace('[connection signal="body_entered" from="Hitbox" to="." method="_on_hit"]', '[connection signal="area_entered" from="Hitbox" to="." method="_on_area"]');
    const d = diffResourceText(PLAYER_SCENE, after);
    expect(d.noise).toBe(false);
    expect(d.changes).toEqual([
      "~ node Shape (CollisionShape2D): shape.radius: 12 -> 16",
      "~ node Hitbox (Area2D)",
      "    ~ collision_mask: 3 -> 4",
      "    + monitoring = false",
      "+ connection Hitbox.area_entered -> (root)._on_area()",
      "- connection Hitbox.body_entered -> (root)._on_hit()",
    ]);
  });

  it("calls renumbered ids, another load_steps and a moved file with the same uid noise", () => {
    const a = '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Texture2D" uid="uid://tex1" path="res://a.png" id="1_s"]\n\n[node name="A" type="Sprite2D"]\ntexture = ExtResource("1_s")\n';
    const b = '[gd_scene load_steps=9 format=3]\n\n[ext_resource type="Texture2D" uid="uid://tex1" path="res://art/a.png" id="7_q"]\n\n[node name="A" type="Sprite2D"]\ntexture = ExtResource("7_q")\n';
    expect(diffResourceText(a, b, new Map([["uid://tex1", "res://art/a.png"]]))).toEqual({ changes: [], noise: true });
    // Without the uid it is another file.
    expect(diffResourceText(a, b).changes).toContain("~ node A (Sprite2D): texture: res://a.png -> res://art/a.png");
  });

  it("follows a node that moved or was renamed, with its children, and reports a new order of children", () => {
    const head = '[gd_scene format=3]\n\n[node name="Root" type="Node2D"]\n\n';
    const a = `${head}[node name="Gun" type="Node2D" parent="."]\n\n[node name="Muzzle" type="Marker2D" parent="Gun"]\n\n[node name="Back" type="Sprite2D" parent="."]\n\n[node name="Front" type="Sprite2D" parent="."]\nz_index = 1\n\n[node name="Old" type="Timer" parent="."]\nwait_time = 2.0\n`;
    const b = `${head}[node name="Front" type="Sprite2D" parent="."]\nz_index = 1\n\n[node name="Back" type="Sprite2D" parent="."]\n\n[node name="Hand" type="Node2D" parent="."]\n\n[node name="Gun" type="Node2D" parent="Hand"]\n\n[node name="Muzzle" type="Marker2D" parent="Hand/Gun"]\nposition = Vector2(4, 0)\n\n[node name="Cooldown" type="Timer" parent="."]\nwait_time = 2.0\n`;
    const d = diffResourceText(a, b).changes;
    expect(d).toContain("> node Gun moved: Gun -> Hand/Gun");
    expect(d).toContain("> node renamed: Old -> Cooldown");
    expect(d).toContain("+ node Hand (Node2D)");
    expect(d).toContain("~ node Hand/Gun/Muzzle (Marker2D): + position = Vector2(4, 0)");
    expect(d.find((l) => l.startsWith("~ children of . reordered"))).toMatch(/Back, Front.* -> Front, Back/);
    expect(d.some((l) => l.startsWith("- node"))).toBe(false);
  });

  it("reports a removed subtree as one line", () => {
    const a = '[gd_scene format=3]\n\n[node name="R" type="Node"]\n\n[node name="UI" type="Control" parent="."]\n\n[node name="A" type="Label" parent="UI"]\n\n[node name="B" type="Label" parent="UI"]\n';
    const b = '[gd_scene format=3]\n\n[node name="R2" type="Node"]\n';
    expect(diffResourceText(a, b).changes).toEqual(["> root renamed: R -> R2", "- node UI (Control) with 2 nodes below it"]);
  });
});

describe("script diff by meaning", () => {
  it("lists what other files can use: functions, signals, variables, enums, and whose code changed", () => {
    const after = PLAYER_SCRIPT.replace("func take_damage(amount: int) -> void:", "func hurt(amount: int) -> void:")
      .replace("func heal(amount: int) -> void:", "static func heal(amount: int, loud: bool) -> void:")
      .replace("signal died", "signal died(by: Node)\nsignal hit")
      .replace("@export var speed: float", "var speed: int")
      .replace("velocity.y = -300.0", "velocity.y = -350.0");
    const d = diffScriptText(PLAYER_SCRIPT, after);
    expect(d.changes).toEqual([
      "+ func hurt(amount: int) -> void",
      "~ static func heal(amount: int, loud: bool) -> void  (was heal(amount: int) -> void)",
      "- func take_damage(amount: int) -> void",
      "~ signal died(by: Node)  (was signal died)",
      "+ signal hit",
      "~ var speed: int  (was @export var speed: float)",
      "~ code changed in _physics_process",
    ]);
    expect(d.removed).toEqual([
      { kind: "func", name: "take_damage" },
      { kind: "var", name: "speed", exported: true },
    ]);
    expect(d.arity).toEqual([{ name: "heal", was: "1", now: "2" }]);
  });

  it("is quiet about comments and blank lines, and notices reordered enum values", () => {
    expect(diffScriptText("extends Node\n\nfunc a() -> void:\n\tpass\n", "extends Node\n# note\n\n\nfunc a() -> void:\n\tpass  # same\n").changes).toEqual([]);
    expect(diffScriptText("enum State { IDLE, RUN }\n", "enum State { RUN, IDLE }\n").changes[0]).toMatch(/enum State: values reordered/);
  });
});

describe("godotwright diff against git", () => {
  it("says nothing changed on a clean tree, and needs git", () => {
    const root = game();
    expect(formatDiff(diffProject(root))).toBe("diff: nothing changed against HEAD\n");
    expect(() => diffProject(makeProject({ "project.godot": "config_version=5\n" }))).toThrow(GitError);
    expect(() => diffProject(root, { ref: "--output=/tmp/x" })).toThrow(/not a commit name/);
    expect(() => diffProject(root, { ref: "nope" })).toThrow(/does not know the commit "nope"/);
  });

  it("reports what a change breaks elsewhere: connections, saved exports, callers, input actions, uniforms, deleted files", () => {
    const root = game();
    const write = (file: string, text: string) => writeFileSync(join(root, file), text);
    write(
      "player.gd",
      PLAYER_SCRIPT.replace("func take_damage(amount: int) -> void:", "func hurt(amount: int) -> void:")
        .replace("func heal(amount: int) -> void:", "func heal(amount: int, loud: bool) -> void:")
        .replace("@export var speed: float", "@export var move_speed: float")
        .replace("func _on_hit(body: Node2D) -> void:\n\ttake_damage(1)\n", ""),
    );
    write("project.godot", 'config_version=5\n\n[application]\nrun/main_scene="res://main.tscn"\n\n[autoload]\nGame="*res://game.gd"\n\n[physics]\ncommon/physics_ticks_per_second=120\n');
    write("glow.gdshader", "shader_type canvas_item;\nuniform vec4 tint : source_color;\nvoid fragment() {\n\tCOLOR *= tint;\n}\n");
    write("new_thing.gd", "class_name NewThing\nextends Node\n\nfunc go() -> void:\n\tpass\n");
    const report = diffProject(root);
    expect(report.ok).toBe(false);
    const of = (file: string) => report.files.find((f) => f.file === file)!;
    expect(of("res://player.gd").problems).toEqual([
      "func take_damage is gone, but the name is still used in res://enemy.gd:4",
      "func _on_hit is gone, but a scene connection still names it: res://player.tscn:20 (Godot reports an error when that scene loads)",
      "@export speed is gone or changed type, but its value is still saved in res://main.tscn:7, res://player.tscn:8 (Godot drops or converts that value without an error)",
      "heal() took 1 argument and now takes 2: check the calls in res://enemy.gd:5",
    ]);
    expect(of("res://project.godot").changes).toEqual(["+ physics/common/physics_ticks_per_second = 120", "- input action jump: no events"]);
    expect(of("res://project.godot").problems).toEqual(["input action jump is gone, but code still asks for it in res://player.gd:9"]);
    expect(of("res://glow.gdshader").changes).toEqual(["- uniform float strength"]);
    expect(of("res://glow.gdshader").problems[0]).toMatch(/uniform strength is gone.*res:\/\/glow\.tres:7/);
    expect(of("res://new_thing.gd")).toMatchObject({ status: "added", changes: ["+ new script: class_name NewThing, extends Node, 1 function"] });
    const text = formatDiff(report);
    expect(text).toMatch(/^diff: 4 files changed, the files on disk against HEAD \(2 scripts, 1 shader, 1 project file\); 6 problems\n/);
    expect(text).toContain("  ! func take_damage is gone");
    expect(text).toMatch(/Next: fix every line marked !/);
    // Files with problems come before files without.
    expect(text.indexOf("res://new_thing.gd")).toBeGreaterThan(text.indexOf("res://glow.gdshader\n"));
  });

  it("names a deleted file that is still used, limits to the files asked for, and compares two commits", () => {
    const root = game();
    writeFileSync(join(root, "icon.png"), "png2!");
    writeFileSync(join(root, "game.gd"), "extends Node\nvar score: int = 0\nvar lives: int = 3\n");
    const all = diffProject(root);
    expect(all.files.map((f) => f.file)).toEqual(["res://game.gd", "res://icon.png"]);
    expect(all.files[1]!.changes).toEqual(["~ contents changed (3 B -> 5 B)"]);
    expect(diffProject(root, { files: ["game.gd"] }).files.map((f) => f.changes)).toEqual([["+ var lives: int"]]);
    commitAll(root, "second");
    expect(diffProject(root).files).toEqual([]);
    expect(diffProject(root, { ref: "HEAD~1", to: "HEAD" }).files.map((f) => f.file)).toEqual(["res://game.gd", "res://icon.png"]);
  });

  it("stops searching for remaining uses in a very large change, and says which names it left", () => {
    const fns = Array.from({ length: 45 }, (_, i) => `func gone_${i}() -> void:\n\tpass\n`).join("\n");
    const root = makeProject({ "project.godot": "config_version=5\n", "big.gd": `extends Node\n\n${fns}`, "user.gd": "extends Node\n\nfunc go(b: Node) -> void:\n\tb.gone_0()\n\tb.gone_44()\n" });
    commitAll(root);
    writeFileSync(join(root, "big.gd"), "extends Node\n");
    const report = diffProject(root);
    expect(report.files[0]!.problems).toEqual(["func gone_0 is gone, but the name is still used in res://user.gd:4"]);
    expect(report.unchecked).toEqual(["gone_40", "gone_41", "gone_42", "gone_43", "gone_44"]);
    expect(formatDiff(report)).toContain("not searched for remaining uses (a very large change): gone_40, gone_41, gone_42, gone_43, gone_44; check those with godot_usages");
  });

  it("compares one file with another without git", () => {
    const root = makeProject({
      "project.godot": "config_version=5\n",
      "a.tscn": '[gd_scene format=3]\n\n[node name="A" type="Node2D"]\n',
      "b.tscn": '[gd_scene format=3]\n\n[node name="A" type="Node2D"]\nposition = Vector2(3, 4)\n',
    });
    const report = diffProject(root, { files: ["res://b.tscn"], against: "res://a.tscn" });
    expect(report.files[0]!.changes).toEqual(["~ node A (Node2D): + position = Vector2(3, 4)"]);
    expect(() => diffProject(root, { against: "res://a.tscn" })).toThrow(/exactly one file/);
    expect(() => diffProject(root, { files: ["res://b.tscn"], against: "res://../../etc/hosts" })).toThrow(/is not a file in the project/);
  });

  it("runs from the CLI and exits 1 when something is broken", async () => {
    const root = game();
    expect(await runCli(["diff", "--path", root])).toEqual({ output: "diff: nothing changed against HEAD\n", exitCode: 0 });
    writeFileSync(join(root, "player.gd"), PLAYER_SCRIPT.replace("func _on_hit(body: Node2D) -> void:\n\ttake_damage(1)\n", ""));
    const run = await runCli(["diff", "--path", root]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("! func _on_hit is gone, but a scene connection still names it");
  });
});
