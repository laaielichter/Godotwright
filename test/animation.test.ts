import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { AnimationError, editAnimation, formatAnimationPlan, formatAnimationReport, readAnimations, type AnimationEditArgs } from "../src/animation/animation.js";
import { arrayItems, dictEntries, formatDict, keyName, splitTop } from "../src/animation/raw.js";
import { animationCommand } from "../src/commands/animation.js";
import { parseResourceText } from "../src/godot/scene.js";
import { readJournal, undoJournal } from "../src/journal/journal.js";
import { makeProject } from "./helpers.js";

const PROJECT = `config_version=5

[application]

config/name="Anim"
config/features=PackedStringArray("4.7")
`;

const HERO_GD = `extends CharacterBody2D

@export var speed: float = 200.0
var combo := 0

func land(strength: float) -> void:
	pass
`;

// The style Godot 4.4 and later writes: one dictionary entry per line, &"name" keys.
const HERO = `[gd_scene load_steps=6 format=3 uid="uid://bhero000001"]

[ext_resource type="Script" path="res://hero.gd" id="1_hero"]
[ext_resource type="Texture2D" path="res://icon.svg" id="2_icon"]

[sub_resource type="Animation" id="Animation_idle"]
resource_name = "idle"
length = 0.5
loop_mode = 1
tracks/0/type = "value"
tracks/0/imported = false
tracks/0/enabled = true
tracks/0/path = NodePath("Sprite:position")
tracks/0/interp = 1
tracks/0/loop_wrap = true
tracks/0/keys = {
"times": PackedFloat32Array(0, 0.5),
"transitions": PackedFloat32Array(1, 2),
"update": 0,
"values": [Vector2(0, 0), Vector2(0, -4)]
}
tracks/1/type = "method"
tracks/1/imported = false
tracks/1/enabled = true
tracks/1/path = NodePath(".")
tracks/1/interp = 1
tracks/1/loop_wrap = true
tracks/1/keys = {
"times": PackedFloat32Array(0.25),
"transitions": PackedFloat32Array(1),
"values": [{
"args": [1.5],
"method": &"land"
}]
}

[sub_resource type="Animation" id="Animation_run"]
resource_name = "run"
length = 0.5
loop_mode = 1

[sub_resource type="AnimationLibrary" id="AnimationLibrary_hero"]
_data = {
&"idle": SubResource("Animation_idle"),
&"run": SubResource("Animation_run")
}

[node name="Hero" type="CharacterBody2D"]
script = ExtResource("1_hero")

[node name="Sprite" type="Sprite2D" parent="."]
texture = ExtResource("2_icon")

[node name="Arm" type="Node2D" parent="Sprite"]

[node name="Label" type="Label" parent="."]
unique_name_in_owner = true

[node name="AnimationPlayer" type="AnimationPlayer" parent="."]
libraries = {
&"": SubResource("AnimationLibrary_hero")
}
autoplay = "idle"
`;

// A scene with a player that has no library yet, in the older one-line style.
const BARE = `[gd_scene format=3 uid="uid://bbare000001"]

[node name="Door" type="Node2D"]
metadata/tags = {"a": 1}

[node name="Panel" type="Sprite2D" parent="."]

[node name="Anim" type="AnimationPlayer" parent="Panel"]
`;

const LIBRARY = `[gd_resource type="AnimationLibrary" load_steps=2 format=3 uid="uid://blib0000001"]

[sub_resource type="Animation" id="Animation_spin"]
resource_name = "spin"
length = 2.0

[resource]
_data = {
&"spin": SubResource("Animation_spin")
}
`;

const SINGLE = `[gd_resource type="Animation" format=3 uid="uid://bone0000001"]

[resource]
resource_name = "blink"
length = 0.4
`;

function project(files: Record<string, string> = {}): { root: string; file: string; read: (name?: string) => string } {
  const root = makeProject({ "project.godot": PROJECT, "icon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", "hero.gd": HERO_GD, "hero.tscn": HERO, "bare.tscn": BARE, "library.tres": LIBRARY, "blink.tres": SINGLE, ...files });
  return { root, file: join(root, "hero.tscn"), read: (name = "hero.tscn") => readFileSync(join(root, name), "utf8") };
}

/** The lines that differ between two texts. */
function changed(before: string, after: string): { gone: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  return { gone: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
}

const clean = (text: string) => expect(parseResourceText(text).misplaced).toEqual([]);

describe("raw value text", () => {
  it("splits dictionaries and arrays without touching strings and nested values", () => {
    expect(splitTop('a, "b, c", [d, e], f(g, h)', ",").map((p) => p.trim())).toEqual(["a", '"b, c"', "[d, e]", "f(g, h)"]);
    const raw = '{\n"times": PackedFloat32Array(0, 1),\n"values": [{\n"args": ["a:b, c"],\n"method": &"go"\n}, Vector2(1, 2)]\n}';
    const entries = dictEntries(raw) ?? [];
    expect(entries.map((e) => keyName(e.key))).toEqual(["times", "values"]);
    expect(arrayItems(entries[1]?.value ?? "")).toEqual(['{\n"args": ["a:b, c"],\n"method": &"go"\n}', "Vector2(1, 2)"]);
    // Taking a dictionary apart and writing it again gives the same text.
    expect(formatDict(entries, true)).toBe(raw);
    expect(formatDict(dictEntries('{"a": 1, &"b": [2, 3]}') ?? [], false)).toBe('{"a": 1, &"b": [2, 3]}');
    expect(formatDict([], true)).toBe("{}");
    expect(keyName('&"idle"')).toBe("idle");
    expect(dictEntries("[1]")).toBeUndefined();
  });
});

describe("animation read", () => {
  it("lists a player's animations with tracks and keys", () => {
    const { file } = project();
    const report = readAnimations(file);
    expect(report).toMatchObject({ file: "res://hero.tscn", player: "AnimationPlayer", rootNode: "." });
    expect(report.animations.map((a) => [a.name, a.library, a.length, a.loopMode, a.tracks.length])).toEqual([["idle", "", 0.5, "linear", 2], ["run", "", 0.5, "linear", 0]]);
    expect(report.animations[0]?.tracks).toEqual([
      { index: 0, type: "value", path: "Sprite:position", interp: "linear", update: "continuous", keys: [{ time: 0, value: "Vector2(0, 0)" }, { time: 0.5, value: "Vector2(0, -4)", transition: 2 }] },
      { index: 1, type: "method", path: ".", interp: "linear", keys: [{ time: 0.25, value: "land(1.5)" }] },
    ]);
    const text = formatAnimationReport(report);
    expect(text).toContain("animation res://hero.tscn AnimationPlayer (paths from .): 2 animations");
    expect(text).toContain("idle  length 0.5  loop linear  2 tracks");
    expect(text).toContain("  0 value Sprite:position linear continuous  0: Vector2(0, 0)  0.5: Vector2(0, -4) ~2");
    expect(text).toContain("  1 method .  0.25: land(1.5)");
    expect(readAnimations(file, { animation: "run" }).animations.map((a) => a.name)).toEqual(["run"]);
    expect(() => readAnimations(file, { animation: "rnu" })).toThrow(/no animation "rnu".*did you mean run/);
  });

  it("reads a library file, a single animation file, and a player whose library is a file", () => {
    const scene = `[gd_scene load_steps=2 format=3]

[ext_resource type="AnimationLibrary" path="res://library.tres" id="1_lib"]

[node name="Root" type="Node2D"]

[node name="AnimationPlayer" type="AnimationPlayer" parent="."]
libraries = {
&"fx": ExtResource("1_lib")
}
`;
    const { root } = project({ "uses.tscn": scene });
    expect(readAnimations(join(root, "library.tres")).animations).toEqual([{ name: "spin", length: 2, loopMode: "none", tracks: [] }]);
    expect(readAnimations(join(root, "blink.tres")).animations).toEqual([{ name: "blink", length: 0.4, loopMode: "none", tracks: [] }]);
    const report = readAnimations("res://uses.tscn", {}, { project: root });
    expect(report.animations).toEqual([{ name: "spin", library: "fx", file: "res://library.tres", length: 2, loopMode: "none", tracks: [] }]);
    expect(formatAnimationReport(report)).toContain("fx/spin  length 2  loop none  0 tracks  (in res://library.tres)");
    // An edit there names the file to change.
    expect(() => editAnimation(join(root, "uses.tscn"), { op: "set", animation: "spin", length: 3 })).toThrow(/is the file res:\/\/library.tres; edit that file/);
    expect(() => editAnimation(join(root, "uses.tscn"), { op: "create", name: "x" })).toThrow(/edit that file/);
  });

  it("refuses files and nodes that hold no animations", () => {
    const { root, file } = project({ "stats.tres": '[gd_resource type="Resource" format=3]\n\n[resource]\n', "none.tscn": '[gd_scene format=3]\n\n[node name="A" type="Node2D"]\n' });
    expect(() => readAnimations(join(root, "stats.tres"))).toThrow(/is a Resource, not an Animation or an AnimationLibrary/);
    expect(() => readAnimations(join(root, "none.tscn"))).toThrow(/has no AnimationPlayer node/);
    expect(() => readAnimations(file, { player: "Sprite" })).toThrow(/Sprite is a Sprite2D, not an AnimationPlayer; AnimationPlayer nodes: AnimationPlayer/);
    expect(() => readAnimations(file, { player: "AnimPlayer" })).toThrow(AnimationError);
    expect(() => readAnimations(file, { library: "fx" })).toThrow(/has no library "fx"; it has ""/);
  });
});

describe("animation edits", () => {
  it("creates an animation in the player's library: dry run first, then written, and undone", () => {
    const { file, read, root } = project();
    const before = read();
    const edit: AnimationEditArgs = { op: "create", name: "jump", length: 0.8, loop_mode: "pingpong", step: 0.1 };
    const dry = editAnimation(file, edit);
    expect(read()).toBe(before);
    expect(dry).toMatchObject({ written: false, animation: "jump", summary: "create animation jump on AnimationPlayer" });
    expect(formatAnimationPlan(dry)).toContain('+ [sub_resource type="Animation" id="Animation_jump"]');
    expect(formatAnimationPlan(dry)).toContain("dry run: add --write to apply");

    const plan = editAnimation(file, edit, { write: true });
    const after = read();
    expect(changed(before, after)).toEqual({
      gone: ['[gd_scene load_steps=6 format=3 uid="uid://bhero000001"]', '&"run": SubResource("Animation_run")'],
      added: ['[gd_scene load_steps=7 format=3 uid="uid://bhero000001"]', '[sub_resource type="Animation" id="Animation_jump"]', 'resource_name = "jump"', "length = 0.8", "loop_mode = 2", "step = 0.1", '&"run": SubResource("Animation_run"),', '&"jump": SubResource("Animation_jump")'],
    });
    // The animation comes before the library that uses it.
    expect(after.indexOf('id="Animation_jump"')).toBeLessThan(after.indexOf('id="AnimationLibrary_hero"'));
    clean(after);
    expect(readAnimations(file, { animation: "jump" }).animations[0]).toEqual({ name: "jump", library: "", length: 0.8, loopMode: "pingpong", step: 0.1, tracks: [] });
    expect(plan.review?.after).toBe(plan.review?.before);
    expect(readJournal(root).entries.at(-1)?.tool).toBe("animation edit");
    undoJournal(root);
    expect(read()).toBe(before);

    expect(() => editAnimation(file, { op: "create", name: "idle" })).toThrow(/already has an animation "idle"/);
    expect(() => editAnimation(file, { op: "create", name: "a/b" })).toThrow(/not a usable animation name/);
    expect(() => editAnimation(file, { op: "create", name: "x", loop_mode: "bounce" as never })).toThrow(/loop_mode is one of none, linear, pingpong/);
    expect(() => editAnimation(file, { op: "create", name: "x", length: 0 })).toThrow(/length must be a number above 0/);
  });

  it("makes the AnimationLibrary and the libraries property when the player has none", () => {
    const { root, read } = project();
    const file = join(root, "bare.tscn");
    const plan = editAnimation(file, { op: "create", name: "open" }, { write: true });
    expect(plan.summary).toBe("create animation open on Panel/Anim (with a new AnimationLibrary)");
    // This file writes dictionaries on one line, so the new ones do too.
    expect(read("bare.tscn")).toBe(`[gd_scene format=3 uid="uid://bbare000001"]

[sub_resource type="Animation" id="Animation_open"]
resource_name = "open"

[sub_resource type="AnimationLibrary" id="AnimationLibrary_Anim"]
_data = {"open": SubResource("Animation_open")}

[node name="Door" type="Node2D"]
metadata/tags = {"a": 1}

[node name="Panel" type="Sprite2D" parent="."]

[node name="Anim" type="AnimationPlayer" parent="Panel"]
libraries = {"": SubResource("AnimationLibrary_Anim")}
`);
    clean(read("bare.tscn"));
    // Paths start at the player's parent: Panel.
    expect(readAnimations(file).rootNode).toBe("Panel");
    editAnimation(file, { op: "add_track", animation: "open", path: ".:rotation", keys: [{ time: 0, value: 0 }, { time: 1, value: 1.5 }] }, { write: true });
    expect(read("bare.tscn")).toContain('tracks/0/keys = {"times": PackedFloat32Array(0, 1), "transitions": PackedFloat32Array(1, 1), "update": 0, "values": [0.0, 1.5]}');
    expect(() => editAnimation(file, { op: "add_track", animation: "open", path: "Panel:rotation", keys: [] })).toThrow(/no node "Panel" from Panel/);
    editAnimation(file, { op: "add_track", animation: "open", path: "..:position", keys: [] }, { write: true });
    editAnimation(file, { op: "create", name: "close" }, { write: true });
    expect(read("bare.tscn")).toContain('_data = {"open": SubResource("Animation_open"), "close": SubResource("Animation_close")}');
    clean(read("bare.tscn"));
  });

  it("writes the modern style into a scene without dictionaries", () => {
    const { root, read } = project({ "new.tscn": '[gd_scene load_steps=1 format=3]\n\n[node name="A" type="Node2D"]\n\n[node name="P" type="AnimationPlayer" parent="."]\n' });
    editAnimation(join(root, "new.tscn"), { op: "create", name: "go", loop_mode: 1 }, { write: true });
    expect(read("new.tscn")).toBe(`[gd_scene load_steps=3 format=3]

[sub_resource type="Animation" id="Animation_go"]
resource_name = "go"
loop_mode = 1

[sub_resource type="AnimationLibrary" id="AnimationLibrary_P"]
_data = {
&"go": SubResource("Animation_go")
}

[node name="A" type="Node2D"]

[node name="P" type="AnimationPlayer" parent="."]
libraries = {
&"": SubResource("AnimationLibrary_P")
}
`);
    clean(read("new.tscn"));
  });

  it("adds a value track, typed by the property, and a method track", () => {
    const { file, read } = project();
    const before = read();
    const plan = editAnimation(file, { op: "add_track", animation: "run", path: "Sprite:position", keys: [{ time: 0.5, value: "Vector2(40, 0)", transition: 0.5 }, { time: 0, value: "Vector2(0, 0)" }] }, { write: true });
    expect(plan.summary).toBe("add value track 0 (Sprite:position, 2 keys) to run");
    expect(read()).toContain(
      [
        '[sub_resource type="Animation" id="Animation_run"]',
        'resource_name = "run"',
        "length = 0.5",
        "loop_mode = 1",
        'tracks/0/type = "value"',
        "tracks/0/imported = false",
        "tracks/0/enabled = true",
        'tracks/0/path = NodePath("Sprite:position")',
        "tracks/0/interp = 1",
        "tracks/0/loop_wrap = true",
        "tracks/0/keys = {",
        '"times": PackedFloat32Array(0, 0.5),',
        '"transitions": PackedFloat32Array(1, 0.5),',
        '"update": 0,',
        '"values": [Vector2(0, 0), Vector2(40, 0)]',
        "}",
        "",
        '[sub_resource type="AnimationLibrary" id="AnimationLibrary_hero"]',
      ].join("\n"),
    );
    expect(read().split("\n").length).toBe(before.split("\n").length + 12);
    expect(changed(before, read()).gone).toEqual([]);
    clean(read());

    // true/false steps (discrete); an enum takes its name; a texture a res:// file the scene already has.
    editAnimation(file, { op: "add_track", animation: "run", path: "Sprite:visible", keys: [{ time: 0, value: true }, { time: 0.25, value: false }] }, { write: true });
    expect(read()).toContain('"update": 1,\n"values": [true, false]');
    editAnimation(file, { op: "add_track", animation: "run", path: "Sprite:texture", keys: [{ time: 0, value: "res://icon.svg" }], interp: "nearest", update: "discrete" }, { write: true });
    expect(read()).toContain('tracks/2/interp = 0');
    expect(read()).toContain('"values": [ExtResource("2_icon")]');
    editAnimation(file, { op: "add_track", animation: "run", path: ".:speed", keys: [{ time: 0, value: 300 }] }, { write: true });
    expect(read()).toContain('"values": [300.0]');
    editAnimation(file, { op: "add_track", animation: "run", path: "Sprite:position:x", keys: [{ time: 0, value: 3 }] }, { write: true });
    editAnimation(file, { op: "add_track", animation: "run", path: "%Label:text", keys: [{ time: 0, value: "hi there" }] }, { write: true });
    expect(read()).toContain('"values": ["hi there"]');
    editAnimation(file, { op: "add_track", animation: "run", path: ".:combo", keys: [{ time: 0, value: 2 }] }, { write: true });

    const method = editAnimation(file, { op: "add_track", animation: "run", type: "method", path: ".", keys: [{ time: 0.1, method: "land", args: [2.5] }, { time: 0.4, value: { method: "queue_free" } }] }, { write: true });
    expect(method.summary).toBe("add method track 7 (., 2 keys) to run");
    expect(read()).toContain('tracks/7/keys = {\n"times": PackedFloat32Array(0.1, 0.4),\n"transitions": PackedFloat32Array(1, 1),\n"values": [{\n"args": [2.5],\n"method": &"land"\n}, {\n"args": [],\n"method": &"queue_free"\n}]\n}');
    clean(read());
    const run = readAnimations(file, { animation: "run" }).animations[0];
    expect(run?.tracks.map((t) => `${t.type} ${t.path}`)).toEqual(["value Sprite:position", "value Sprite:visible", "value Sprite:texture", "value .:speed", "value Sprite:position:x", "value %Label:text", "value .:combo", "method ."]);
    expect(run?.tracks[7]?.keys).toEqual([{ time: 0.1, value: "land(2.5)" }, { time: 0.4, value: "queue_free()" }]);
  });

  it("adds an ext_resource for a file a key names, and keeps load_steps right", () => {
    const { file, read } = project({ "other.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>" });
    editAnimation(file, { op: "add_track", animation: "run", path: "Sprite:texture", keys: [{ time: 0, value: "res://other.svg" }] }, { write: true });
    expect(read()).toContain('[gd_scene load_steps=7 format=3 uid="uid://bhero000001"]');
    expect(read()).toContain('path="res://other.svg" id="3_other"]');
    expect(read()).toContain('"values": [ExtResource("3_other")]');
    clean(read());
    expect(() => editAnimation(file, { op: "add_track", animation: "run", path: "Sprite:texture", keys: [{ time: 0, value: "res://missing.png" }] })).toThrow(/res:\/\/missing.png does not exist/);
  });

  it("refuses tracks whose node, property, method or values cannot work", () => {
    const { file, read } = project();
    const before = read();
    const add = (path: string, keys: object[] = [{ time: 0, value: 1 }], extra: object = {}) => editAnimation(file, { op: "add_track", animation: "run", path, keys: keys as never, ...extra }, { write: true });
    expect(() => add("Sprit:position")).toThrow(/no node "Sprit" from the scene root.*did you mean Sprite/);
    expect(() => add("Sprite/Arn:position")).toThrow(/did you mean Sprite\/Arm/);
    expect(() => add("Sprite:positon")).toThrow(/Sprite \(Sprite2D\) has no property positon; did you mean position/);
    expect(() => add(".:spede")).toThrow(/\. \(CharacterBody2D\) has no property spede; did you mean speed/);
    expect(() => add("Sprite")).toThrow(/give the path as Node:property/);
    expect(() => add("%Nope:text")).toThrow(/no node with the unique name %Nope/);
    expect(() => add("Sprite:position", [{ time: 0, value: 5 }])).toThrow(/is a Vector2; "5" is not a Vector2\(\.\.\.\) value/);
    expect(() => add("Sprite:visible", [{ time: 0, value: "yes" }])).toThrow(/is a bool/);
    expect(() => add("Sprite:position", [{ time: 0, value: "Vector2(1, 1)" }, { time: 0, value: "Vector2(2, 2)" }])).toThrow(/two keys are at 0s/);
    expect(() => add("Sprite:position", [{ time: -1, value: "Vector2(1, 1)" }])).toThrow(/time must be a number of 0 or more/);
    expect(() => add("Sprite:position", [{ time: 0 }])).toThrow(/needs a value/);
    expect(() => add("Sprite:position", [{ time: 0, value: { x: 1 } }])).toThrow(/Godot value text/);
    expect(() => add("Sprite:rotation", undefined, { interp: "smooth" })).toThrow(/interp is one of nearest, linear, cubic/);
    expect(() => add("Sprite:rotation", undefined, { type: "bezier" })).toThrow(/value or method here/);
    expect(() => add(".", [{ time: 0, method: "lnad" }], { type: "method" })).toThrow(/has no method lnad; did you mean land/);
    expect(() => add("Sprite", [{ time: 0, method: "no_such" }], { type: "method" })).toThrow(/Sprite2D\) has no method no_such/);
    expect(() => add(".:speed", [{ time: 0, method: "land" }], { type: "method" })).toThrow(/names only the node/);
    expect(() => add(".", [{ time: 0 }], { type: "method" })).toThrow(/a method key needs method/);
    expect(() => editAnimation(file, { op: "add_track", animation: "rnu", path: "Sprite:position", keys: [] })).toThrow(/no animation "rnu".*did you mean run/);
    expect(read()).toBe(before);
    // A key after the end is a warning.
    expect(editAnimation(file, { op: "add_track", animation: "run", path: "Sprite:rotation", keys: [{ time: 2, value: 1 }] }).warnings.join(" ")).toContain("after the animation's length of 0.5s");
  });

  it("sets, adds and removes keys, leaving the other values as they were written", () => {
    const { file, read } = project();
    const before = read();
    const set = editAnimation(file, { op: "set_key", animation: "idle", track: 0, time: 0.5, value: "Vector2(0, -8)" }, { write: true });
    expect(set.summary).toBe("change the key at 0.5s on track 0 (Sprite:position) of idle");
    expect(changed(before, read())).toEqual({ gone: ['"values": [Vector2(0, 0), Vector2(0, -4)]'], added: ['"values": [Vector2(0, 0), Vector2(0, -8)]'] });

    const added = editAnimation(file, { op: "set_key", animation: "idle", track: "Sprite:position", time: 0.25, value: "Vector2(2, -2)", transition: 0.5 }, { write: true });
    expect(added.summary).toBe("add the key at 0.25s on track 0 (Sprite:position) of idle");
    expect(read()).toContain('tracks/0/keys = {\n"times": PackedFloat32Array(0, 0.25, 0.5),\n"transitions": PackedFloat32Array(1, 0.5, 2),\n"update": 0,\n"values": [Vector2(0, 0), Vector2(2, -2), Vector2(0, -8)]\n}');

    // A method key: the key that was there keeps its text.
    editAnimation(file, { op: "set_key", animation: "idle", track: 1, time: 0.4, method: "land", args: [3] }, { write: true });
    expect(read()).toContain('"values": [{\n"args": [1.5],\n"method": &"land"\n}, {\n"args": [3],\n"method": &"land"\n}]');
    clean(read());

    const removed = editAnimation(file, { op: "remove_key", animation: "idle", track: 0, time: 0.25 }, { write: true });
    expect(removed.summary).toBe("remove the key at 0.25s from track 0 (Sprite:position) of idle");
    expect(read()).toContain('"times": PackedFloat32Array(0, 0.5),\n"transitions": PackedFloat32Array(1, 2),\n"update": 0,\n"values": [Vector2(0, 0), Vector2(0, -8)]');
    clean(read());

    expect(() => editAnimation(file, { op: "remove_key", animation: "idle", track: 0, time: 0.3 })).toThrow(/has no key at 0.3s; the nearest is at 0.5s \(keys: 0, 0.5\)/);
    expect(() => editAnimation(file, { op: "set_key", animation: "idle", track: 0, time: 0, value: "Vector2(0, 0)" })).toThrow(/nothing to change/);
    expect(() => editAnimation(file, { op: "set_key", animation: "idle", track: 0, time: 0, value: 4 })).toThrow(/is a Vector2/);
    expect(() => editAnimation(file, { op: "set_key", animation: "idle", track: 5, time: 0, value: 4 })).toThrow(/idle has no track 5; its tracks are 0 to 1/);
    expect(() => editAnimation(file, { op: "set_key", animation: "idle", track: "Sprite:positon", time: 0, value: 4 })).toThrow(/no track for Sprite:positon; did you mean Sprite:position/);
    expect(() => editAnimation(file, { op: "set_key", animation: "idle", track: 1, time: 0, method: "lnad" })).toThrow(/did you mean land/);
    expect(editAnimation(file, { op: "set_key", animation: "idle", track: 0, time: 3, value: "Vector2(1, 1)" }).warnings.join(" ")).toContain("after the animation's length");
  });

  it("removes a track and renumbers the ones after it", () => {
    const { file, read } = project();
    const plan = editAnimation(file, { op: "remove_track", animation: "idle", track: "Sprite:position" }, { write: true });
    expect(plan.summary).toBe("remove track 0 (Sprite:position) from idle");
    const text = read();
    expect(text).not.toContain("tracks/1/");
    expect(text).not.toContain("Sprite:position");
    expect(text).toContain('loop_mode = 1\ntracks/0/type = "method"\ntracks/0/imported = false\ntracks/0/enabled = true\ntracks/0/path = NodePath(".")');
    expect(text).toContain('tracks/0/keys = {\n"times": PackedFloat32Array(0.25),');
    clean(text);
    expect(readAnimations(file, { animation: "idle" }).animations[0]?.tracks).toEqual([{ index: 0, type: "method", path: ".", interp: "linear", keys: [{ time: 0.25, value: "land(1.5)" }] }]);
    editAnimation(file, { op: "remove_track", animation: "idle", track: 0 }, { write: true });
    expect(read()).toContain('[sub_resource type="Animation" id="Animation_idle"]\nresource_name = "idle"\nlength = 0.5\nloop_mode = 1\n\n[sub_resource type="Animation" id="Animation_run"]');
    expect(() => editAnimation(file, { op: "remove_track", animation: "idle", track: 0 })).toThrow(/idle has no track 0; it has no tracks/);
  });

  it("sets length, loop mode and step where Godot writes them", () => {
    const { file, read } = project();
    const before = read();
    const plan = editAnimation(file, { op: "set", animation: "idle", length: 0.2, loop_mode: "none", step: 0.05 }, { write: true });
    expect(plan.summary).toBe("set idle: length 0.2, loop none, step 0.05");
    expect(plan.warnings.join(" ")).toContain("there are keys after 0.2s (the last at 0.5s)");
    // Loop mode none is the default, which Godot does not write; step goes ahead of the tracks.
    expect(read()).toContain('resource_name = "idle"\nlength = 0.2\nstep = 0.05\ntracks/0/type = "value"');
    clean(read());
    editAnimation(file, { op: "set", animation: "idle", length: 1, loop_mode: 2 }, { write: true });
    expect(read()).toContain('resource_name = "idle"\nloop_mode = 2\nstep = 0.05\ntracks/0/type = "value"');
    expect(readAnimations(file, { animation: "idle" }).animations[0]).toMatchObject({ length: 1, loopMode: "pingpong", step: 0.05 });
    editAnimation(file, { op: "set", animation: "idle", length: 3 }, { write: true });
    expect(read()).toContain('resource_name = "idle"\nlength = 3.0\nloop_mode = 2\nstep = 0.05');
    expect(() => editAnimation(file, { op: "set", animation: "idle", length: 3 })).toThrow(/nothing to change/);
    expect(() => editAnimation(file, { op: "set", animation: "idle" })).toThrow(/set needs length, loop_mode or step/);
    expect(() => editAnimation(file, { op: "set", animation: "idle", length: -1 })).toThrow(/length must be a number above 0/);
    expect(() => editAnimation(file, { op: "nope" } as never)).toThrow(/op is one of create/);
    expect(before).not.toBe(read());
  });

  it("removes an animation with its section, and warns about autoplay", () => {
    const { file, read } = project();
    const plan = editAnimation(file, { op: "remove", animation: "idle" }, { write: true });
    expect(plan.warnings.join(" ")).toContain('AnimationPlayer still has autoplay = "idle"');
    const text = read();
    expect(text).toContain('[gd_scene load_steps=5 format=3 uid="uid://bhero000001"]');
    expect(text).not.toContain("Animation_idle");
    expect(text).toContain('_data = {\n&"run": SubResource("Animation_run")\n}');
    clean(text);
    editAnimation(file, { op: "remove", animation: "run" }, { write: true });
    // An empty library stores no _data.
    expect(read()).toContain('[sub_resource type="AnimationLibrary" id="AnimationLibrary_hero"]\n\n[node name="Hero"');
    expect(read()).toContain("load_steps=4");
    expect(readAnimations(file).animations).toEqual([]);
    expect(() => editAnimation(file, { op: "remove", animation: "run" })).toThrow(/no animation "run" to remove/);
    // And a new one goes into the library that is there.
    editAnimation(file, { op: "create", name: "fall" }, { write: true });
    expect(read()).toContain('_data = {\n&"fall": SubResource("Animation_fall")\n}');
    clean(read());
  });

  it("edits a library file and a single animation file", () => {
    const { root, read } = project();
    const lib = join(root, "library.tres");
    editAnimation(lib, { op: "create", name: "wobble", length: 0.3 }, { write: true });
    expect(read("library.tres")).toBe(`[gd_resource type="AnimationLibrary" load_steps=3 format=3 uid="uid://blib0000001"]

[sub_resource type="Animation" id="Animation_spin"]
resource_name = "spin"
length = 2.0

[sub_resource type="Animation" id="Animation_wobble"]
resource_name = "wobble"
length = 0.3

[resource]
_data = {
&"spin": SubResource("Animation_spin"),
&"wobble": SubResource("Animation_wobble")
}
`);
    clean(read("library.tres"));
    // Outside a scene the path cannot be checked: a warning, not a refusal.
    const plan = editAnimation(lib, { op: "add_track", animation: "wobble", path: "Body:rotation", keys: [{ time: 0, value: 0 }, { time: 0.3, value: 0.2 }] }, { write: true });
    expect(plan.warnings.join(" ")).toContain("is not a scene, so the path Body:rotation is not checked");
    expect(readAnimations(lib, { animation: "wobble" }).animations[0]?.tracks[0]?.keys).toEqual([{ time: 0, value: "0" }, { time: 0.3, value: "0.2" }]);
    editAnimation(lib, { op: "remove", animation: "spin" }, { write: true });
    expect(read("library.tres")).toContain("load_steps=2");
    expect(read("library.tres")).not.toContain("spin");

    const one = join(root, "blink.tres");
    editAnimation(one, { op: "set", animation: "blink", loop_mode: "linear" }, { write: true });
    editAnimation(one, { op: "add_track", animation: "blink", path: "Eye:visible", keys: [{ time: 0, value: true }, { time: 0.2, value: false }] }, { write: true });
    expect(read("blink.tres")).toBe(`[gd_resource type="Animation" format=3 uid="uid://bone0000001"]

[resource]
resource_name = "blink"
length = 0.4
loop_mode = 1
tracks/0/type = "value"
tracks/0/imported = false
tracks/0/enabled = true
tracks/0/path = NodePath("Eye:visible")
tracks/0/interp = 1
tracks/0/loop_wrap = true
tracks/0/keys = {
"times": PackedFloat32Array(0, 0.2),
"transitions": PackedFloat32Array(1, 1),
"update": 1,
"values": [true, false]
}
`);
    clean(read("blink.tres"));
    expect(() => editAnimation(one, { op: "create", name: "x" })).toThrow(/is one animation/);
    expect(() => editAnimation(one, { op: "remove", animation: "blink" })).toThrow(/delete the file/);
    expect(() => editAnimation(one, { op: "set", animation: "wink", length: 2 })).toThrow(/holds the animation "blink", not "wink"/);
  });

  it("works from the command line", async () => {
    const { file, read } = project();
    let output = "";
    const run = async (...args: string[]) => {
      output = "";
      process.exitCode = undefined;
      const program = new Command().exitOverride().configureOutput({ writeOut: (t) => (output += t), writeErr: (t) => (output += t) });
      program.addCommand(animationCommand());
      await program.parseAsync(["animation", ...args], { from: "user" });
      const code = process.exitCode ?? 0;
      process.exitCode = undefined;
      return code;
    };
    expect(await run("read", file, "--animation", "idle")).toBe(0);
    expect(output).toContain("idle  length 0.5  loop linear  2 tracks");
    expect(await run("create", file, "jump", "--length", "0.6", "--loop", "linear", "--write")).toBe(0);
    expect(await run("add-track", file, "jump", "Sprite:position", "--keys", '[{"time":0,"value":"Vector2(0, 0)"},{"time":0.6,"value":"Vector2(0, -30)"}]', "--write")).toBe(0);
    expect(await run("set-key", file, "jump", "0", "0.3", "Vector2(0, -40)", "--write")).toBe(0);
    expect(await run("add-track", file, "jump", "Sprite:modulate:a", "--keys", '[{"time":0,"value":1}]', "--write")).toBe(0);
    expect(await run("set-key", file, "jump", "1", "0.5", "0.5", "--write")).toBe(0);
    expect(await run("remove-key", file, "jump", "0", "0.6", "--write")).toBe(0);
    expect(await run("set", file, "jump", "--step", "0.1", "--json")).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ written: false, animation: "jump" });
    expect(await run("read", file, "--animation", "jump", "--json")).toBe(0);
    expect(JSON.parse(output).animations[0].tracks.map((t: { keys: unknown[] }) => t.keys)).toEqual([[{ time: 0, value: "Vector2(0, 0)" }, { time: 0.3, value: "Vector2(0, -40)" }], [{ time: 0, value: "1" }, { time: 0.5, value: "0.5" }]]);
    expect(await run("remove-track", file, "jump", "1", "--write")).toBe(0);
    expect(await run("remove", file, "jump", "--write")).toBe(0);
    expect(read()).not.toContain("jump");
    expect(await run("remove", file, "jump")).toBe(1);
    expect(parseResourceText(read()).misplaced).toEqual([]);
  });
});
