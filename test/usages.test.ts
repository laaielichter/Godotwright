import { describe, expect, it } from "vitest";
import { findUsages, formatUsages } from "../src/usages/usages.js";
import { FIXTURES, makeProject, runCli } from "./helpers.js";

const PROJECT = [
  "config_version=5",
  "[application]",
  'config/name="U"',
  'run/main_scene="res://main.tscn"',
  "[autoload]",
  'Game="*res://game.gd"',
  "[input]",
  'jump={"deadzone": 0.5, "events": []}',
  "",
].join("\n");

const PLAYER = [
  "class_name Hero",
  "extends CharacterBody2D",
  "",
  "signal health_changed(value: int)",
  "",
  "var health := 3",
  "",
  "func take_damage(amount: int) -> void:",
  "\thealth -= amount  # take_damage in a comment does not count",
  "\thealth_changed.emit(health)",
  '\tprint("take_damage in a plain string does not count")',
  "",
  "func _physics_process(_delta: float) -> void:",
  '\tif Input.is_action_just_pressed("jump"):',
  "\t\ttake_damage(1)",
  '\tadd_to_group("heroes")',
  "\t$Sprite.visible = true",
  "",
].join("\n");

const GAME = ['extends Node', "", "func _ready() -> void:", '\tvar hero := preload("res://hero.tscn").instantiate() as Hero', '\thero.connect("health_changed", _on_health)', "", "func _on_health(_v: int) -> void:", "\tpass", ""].join("\n");

const HERO_SCENE = [
  '[gd_scene load_steps=2 format=3 uid="uid://hero123"]',
  "",
  '[ext_resource type="Script" path="res://hero.gd" id="1"]',
  "",
  '[node name="Hero" type="CharacterBody2D" groups=["heroes"]]',
  'script = ExtResource("1")',
  "",
  '[node name="Sprite" type="Sprite2D" parent="."]',
  "",
].join("\n");

const MAIN_SCENE = [
  "[gd_scene load_steps=3 format=3]",
  "",
  '[ext_resource type="PackedScene" uid="uid://hero123" path="res://hero.tscn" id="1"]',
  '[ext_resource type="Script" path="res://game.gd" id="2"]',
  "",
  '[node name="Main" type="Node"]',
  'script = ExtResource("2")',
  "",
  '[node name="Hero" parent="." instance=ExtResource("1")]',
  "",
  '[connection signal="health_changed" from="Hero" to="." method="_on_health"]',
  "",
].join("\n");

function project() {
  return makeProject({ "project.godot": PROJECT, "hero.gd": PLAYER, "game.gd": GAME, "hero.tscn": HERO_SCENE, "main.tscn": MAIN_SCENE });
}
const kinds = (root: string, name: string) => findUsages(root, name).usages.map((u) => `${u.file.replace("res://", "")}:${u.line} ${u.kind}`);

describe("find usages", () => {
  it("finds a function's definition and calls, but not comments or plain strings", () => {
    expect(kinds(project(), "take_damage")).toEqual(["hero.gd:8 definition", "hero.gd:15 reference"]);
  });

  it("finds a signal in code, as a string in connect(), and in a scene connection", () => {
    expect(kinds(project(), "health_changed")).toEqual(["hero.gd:4 definition", "game.gd:5 string", "hero.gd:10 reference", "main.tscn:11 signal connection"]);
  });

  it("finds a method that is only connected from a scene", () => {
    expect(kinds(project(), "_on_health")).toEqual(["game.gd:7 definition", "game.gd:5 reference", "main.tscn:11 method connection"]);
  });

  it("finds a class_name, autoload, input action, group and node", () => {
    expect(kinds(project(), "Hero")).toEqual(["hero.gd:1 definition", "game.gd:4 reference", "hero.tscn:5 scene node", "main.tscn:9 scene node"]);
    expect(kinds(project(), "Game")).toEqual(["project.godot:6 autoload"]);
    expect(kinds(project(), "jump")).toEqual(["project.godot:8 input action", "hero.gd:14 string"]);
    expect(kinds(project(), "heroes")).toEqual(["hero.gd:16 string", "hero.tscn:5 group"]);
    expect(kinds(project(), "Sprite")).toEqual(["hero.gd:17 node path", "hero.tscn:8 scene node"]);
  });

  it("finds every file that refers to a resource, by path or uid, and says whether it exists", () => {
    const root = project();
    const byPath = findUsages(root, "res://hero.tscn");
    expect(byPath.resource).toEqual({ path: "res://hero.tscn", exists: true });
    expect(byPath.usages.map((u) => `${u.file}:${u.line}`)).toEqual(["res://game.gd:4", "res://main.tscn:3"]);
    const byUid = findUsages(root, "uid://hero123");
    expect(byUid.resource?.path).toBe("res://hero.tscn");
    expect(byUid.usages.length).toBe(2);
    const main = findUsages(root, "res://main.tscn");
    expect(main.usages.map((u) => u.kind)).toEqual(["resource"]);
    const gone = findUsages(root, "res://gone.png");
    expect(gone.resource?.exists).toBe(false);
    expect(formatUsages(gone)).toContain("does NOT exist");
  });

  it("says when nothing is found or nothing defines the name", () => {
    const text = formatUsages(findUsages(project(), "nothing_here"));
    expect(text).toContain("No usages found");
    expect(formatUsages(findUsages(`${FIXTURES}/messy`, "_on_start_pressed"))).toContain("no definition found in the project");
  });

  it("runs from the CLI, as text and JSON", async () => {
    const root = project();
    const run = await runCli(["usages", "take_damage", root]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain('usages of "take_damage": 1 use in 1 file, defined in 1 place');
    const json = JSON.parse((await runCli(["usages", "jump", root, "--json"])).output) as { usages: unknown[]; files: number };
    expect(json.usages.length).toBe(2);
    expect(json.files).toBe(2);
    const missing = await runCli(["usages", "x", `${root}/no/such/dir`]);
    expect(missing.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
