import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RenameError, formatRename, renameInProject } from "../src/rename/rename.js";
import { reviewProject } from "../src/review/review.js";
import { findUsages } from "../src/usages/usages.js";
import { DEMO, makeProject, runCli } from "./helpers.js";

function demo(): string {
  const dir = mkdtempSync(join(tmpdir(), "godotwright-rename-"));
  cpSync(DEMO, dir, { recursive: true });
  return dir;
}
const errors = (root: string) => reviewProject(root).categories.reduce((n, c) => n + c.errors, 0);
const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");

describe("rename", () => {
  it("shows the plan without writing, then writes it, and the demo stays clean", () => {
    const root = demo();
    const dry = renameInProject(root, "take_damage", "apply_damage");
    expect(dry.written).toBe(false);
    expect(dry.edits.map((e) => `${e.file}:${e.line}`)).toEqual(["res://scripts/player.gd:43", "res://scripts/enemy.gd:18"]);
    expect(read(root, "scripts/player.gd")).toContain("func take_damage(");
    expect(formatRename(dry)).toContain("dry run");
    const wet = renameInProject(root, "take_damage", "apply_damage", { write: true });
    expect(wet.review).toEqual({ before: 0, after: 0 });
    expect(read(root, "scripts/player.gd")).toContain("func apply_damage(");
    expect(read(root, "scripts/enemy.gd")).toContain(".apply_damage(damage)");
    expect(findUsages(root, "take_damage").usages).toEqual([]);
  });

  it("renames a class and the node of the same name everywhere: scenes, connections and node paths", () => {
    const root = demo();
    const plan = renameInProject(root, "Player", "Hero", { write: true });
    expect(plan.skipped).toEqual([]);
    expect(read(root, "scripts/player.gd")).toMatch(/^class_name Hero/m);
    expect(read(root, "scenes/main.tscn")).toContain('[node name="Hero" parent="."');
    expect(read(root, "scenes/main.tscn")).toContain('from="Hero"');
    expect(read(root, "scripts/main.gd")).toContain("var player: Hero = $Hero");
    expect(errors(root)).toBe(0);
  });

  it("renames a signal in its definition, emits and scene connections", () => {
    const root = demo();
    renameInProject(root, "died", "fell", { write: true });
    expect(findUsages(root, "died").usages).toEqual([]);
    expect(read(root, "scenes/main.tscn")).toContain('signal="fell"');
    expect(errors(root)).toBe(0);
  });

  it("moves a file with its .uid and .import companions and points every reference at the new path", () => {
    const root = demo();
    const plan = renameInProject(root, "res://scenes/player.tscn", "res://scenes/actors/hero.tscn", { write: true });
    expect(plan.moves[0]).toEqual({ from: "res://scenes/player.tscn", to: "res://scenes/actors/hero.tscn" });
    expect(existsSync(join(root, "scenes/player.tscn"))).toBe(false);
    expect(existsSync(join(root, "scenes/actors/hero.tscn"))).toBe(true);
    expect(read(root, "scenes/main.tscn")).toContain('path="res://scenes/actors/hero.tscn"');
    expect(errors(root)).toBe(0);
    const icon = renameInProject(root, "res://icon.svg", "res://art/icon.svg", { write: true });
    expect(icon.moves.map((m) => m.to)).toEqual(["res://art/icon.svg", "res://art/icon.svg.import"]);
    expect(read(root, "art/icon.svg.import")).toContain("res://art/icon.svg");
    expect(read(root, "project.godot")).toContain('"res://art/icon.svg"');
  });

  it("renames an input action and a group in settings, code and scenes", () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="R"\n[input]\njump={"deadzone": 0.5, "events": []}\n',
      "a.gd": 'extends Node\n\nfunc _process(_d: float) -> void:\n\tif Input.is_action_pressed("jump"):\n\t\tadd_to_group("heroes")\n',
      "a.tscn": '[gd_scene format=3]\n\n[node name="A" type="Node" groups=["heroes", "other"]]\n',
    });
    renameInProject(root, "jump", "leap", { write: true });
    expect(read(root, "project.godot")).toContain("leap={");
    expect(read(root, "a.gd")).toContain('is_action_pressed("leap")');
    renameInProject(root, "heroes", "players", { write: true });
    expect(read(root, "a.tscn")).toContain('groups=["players", "other"]');
    expect(read(root, "a.gd")).toContain('add_to_group("players")');
  });

  it("refuses unsafe renames with a clear reason", () => {
    const root = demo();
    expect(() => renameInProject(root, "take_damage", "Player")).toThrow(/already defined/);
    expect(() => renameInProject(root, "nothing_here", "x")).toThrow(/not used anywhere/);
    expect(() => renameInProject(root, "take_damage", "bad name")).toThrow(RenameError);
    expect(() => renameInProject(root, "res://scenes/player.tscn", "hero")).toThrow(/res:\/\/ path/);
    expect(() => renameInProject(root, "res://nope.tscn", "res://x.tscn")).toThrow(/does not exist/);
    expect(() => renameInProject(root, "res://scenes/player.tscn", "res://scenes/main.tscn")).toThrow(/already exists/);
  });

  it("runs from the CLI with a dry run, --write and --json", async () => {
    const root = demo();
    const dry = await runCli(["rename", "take_damage", "apply_damage", root]);
    expect(dry.output).toContain("2 lines in 2 files (dry run");
    const json = JSON.parse((await runCli(["rename", "take_damage", "apply_damage", root, "--json"])).output) as { edits: unknown[] };
    expect(json.edits.length).toBe(2);
    const wet = await runCli(["rename", "take_damage", "apply_damage", root, "--write"]);
    expect(wet.output).toContain("review errors: 0 before, 0 after");
    const bad = await runCli(["rename", "take_damage", "x", root]);
    expect(bad.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
