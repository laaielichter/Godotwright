import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatImpact, impactOf } from "../src/impact/impact.js";
import { GitError } from "../src/project/git.js";
import { commitAll } from "./git-helpers.js";
import { makeProject, runCli } from "./helpers.js";

const scene = (name: string, ext: string[] = []) =>
  `[gd_scene load_steps=${ext.length + 1} format=3]\n\n${ext.map((p, i) => `[ext_resource type="${p.endsWith(".gd") ? "Script" : "PackedScene"}" path="${p}" id="${i + 1}"]\n`).join("")}\n[node name="${name}" type="Node"]\n`;

function game(): string {
  return makeProject({
    "project.godot": 'config_version=5\n\n[application]\nrun/main_scene="res://main.tscn"\n\n[autoload]\nGame="*res://game.gd"\n',
    "game.gd": 'extends Node\n\nconst SAVE := preload("res://save.gd")\n',
    "save.gd": "extends RefCounted\n",
    "main.tscn": scene("Main", ["res://level.tscn"]),
    "main.gd": "extends Node\n",
    "level.tscn": scene("Level", ["res://player/player.tscn", "res://level.gd"]),
    "level.gd": 'extends Node\n\nfunc spawn(kind: String) -> void:\n\tadd_child(load("res://enemies/" + kind + ".tscn").instantiate())\n',
    "player/player.tscn": scene("Player", ["res://player/player.gd"]),
    "player/player.gd": "extends Node\n\nvar gun := Gun.new()\n",
    "player/gun.gd": "class_name Gun\nextends RefCounted\n",
    "enemies/bat.tscn": scene("Bat", ["res://enemies/bat.gd"]),
    "enemies/bat.gd": "extends Node\n",
    "menu.tscn": scene("Menu"),
    "test/test_player.gd": 'extends GutTest\n\nconst P := preload("res://player/player.tscn")\n',
    ".godotwright/scenarios/walk.json": '{"scene":"res://level.tscn","expect":["Player.position.x >= 0"]}',
    ".godotwright/scenarios/menu.json": '{"scene":"res://menu.tscn","expect":["Menu.visible == true"]}',
  });
}

describe("what a change reaches", () => {
  it("walks back from a script to every scene that loads it, nearest first, with tests and scenarios", () => {
    const r = impactOf(game(), { files: ["res://player/gun.gd"] });
    expect(r.changed).toEqual([{ file: "res://player/gun.gd", users: ["res://player/player.gd"], scenes: 3 }]);
    expect(r.scenes).toEqual([
      { scene: "res://main.tscn", distance: 4, chain: ["res://main.tscn", "res://level.tscn", "res://player/player.tscn", "res://player/player.gd", "res://player/gun.gd"], main: true },
      { scene: "res://player/player.tscn", distance: 2, chain: ["res://player/player.tscn", "res://player/player.gd", "res://player/gun.gd"] },
      { scene: "res://level.tscn", distance: 3, chain: ["res://level.tscn", "res://player/player.tscn", "res://player/player.gd", "res://player/gun.gd"] },
    ]);
    expect(r.tests).toEqual(["res://test/test_player.gd"]);
    expect(r.scenarios).toEqual([{ name: "walk", scene: "res://level.tscn" }]);
    const text = formatImpact(r);
    expect(text).toMatch(/^impact of 1 changed file \(the files given\): 3 scenes, 1 test file, 1 saved scenario, 1 other file in between\n/);
    expect(text).toContain("  res://main.tscn (main scene)  <- res://level.tscn <- res://player/player.tscn <- res://player/player.gd <- ...");
    expect(text).toContain('1. godot_review files ["res://player/gun.gd"]: fix every error');
    expect(text).toContain("godot_scenario op run, name walk");
    expect(text).toContain("godot_test: 1 test file loads what changed");
  });

  it("marks a scene that only loads the file later, at run time", () => {
    const r = impactOf(game(), { files: ["enemies/bat.gd"] });
    expect(r.scenes.map((s) => [s.scene, s.later ?? false])).toEqual([
      ["res://main.tscn", true],
      ["res://enemies/bat.tscn", false],
      ["res://level.tscn", true],
    ]);
    expect(formatImpact(r)).toContain("scenes that can load it later, at run time (load(), a folder or a file name in code): res://main.tscn (main scene), res://level.tscn\n");
    expect(r.scenarios).toEqual([{ name: "walk", scene: "res://level.tscn" }]);
  });

  it("says when no test or scenario covers a change, and what to play", () => {
    const root = makeProject({ "project.godot": "config_version=5\n", "a.tscn": scene("A", ["res://a.gd"]), "a.gd": "extends Node\n" });
    const r = impactOf(root, { files: ["res://a.gd"] });
    expect(r.next).toEqual([
      'godot_review files ["res://a.gd"]: fix every error',
      "godot_check: Godot loads every script and scene",
      "godot_play scene res://a.tscn: see it run, with expect for what must hold",
      "no test or saved scenario covers this change: when godot_play proves it works, keep the run with godot_scenario op save",
    ]);
  });

  it("says when a change is global: an autoload, what an autoload loads, project.godot", () => {
    const root = game();
    expect(impactOf(root, { files: ["res://game.gd"] }).changed[0]!.global).toBe("it is the autoload Game: it runs in every scene");
    const save = impactOf(root, { files: ["res://save.gd"] });
    expect(save.changed[0]!.global).toBe("the autoload Game loads it (res://game.gd): it runs in every scene");
    expect(save.scenes).toEqual([]);
    // Every saved scenario counts for a global change.
    expect(save.scenarios.map((s) => s.name)).toEqual(["menu", "walk"]);
    expect(save.next).toContain("godot_check with run: true (a global change: load everything and run the main scene)");
    expect(formatImpact(save)).toContain("no scene loads what changed directly, but the change is global");
    expect(impactOf(root, { files: ["project.godot"] }).changed[0]!.global).toMatch(/^project\.godot: settings/);
  });

  it("takes the changed files from git: edits, new files and deleted files something still names", () => {
    const root = game();
    expect(() => impactOf(root)).toThrow(GitError);
    commitAll(root);
    expect(formatImpact(impactOf(root))).toBe("impact: nothing changed against git HEAD\n");
    writeFileSync(join(root, "menu.tscn"), scene("MainMenu"));
    writeFileSync(join(root, "extra.gd"), "extends Node\n");
    rmSync(join(root, "player/player.gd"));
    const r = impactOf(root);
    expect(r.source).toBe("git HEAD");
    expect(r.changed).toEqual([
      { file: "res://extra.gd", users: [], scenes: 0 },
      { file: "res://menu.tscn", users: [], scenes: 1 },
      { file: "res://player/player.gd", missing: true, users: ["res://player/player.tscn"], scenes: 3 },
    ]);
    const text = formatImpact(r);
    expect(text).toContain("  res://extra.gd  nothing loads it yet");
    expect(text).toContain("  res://player/player.gd (not in the project: deleted, or a wrong path)  used by res://player/player.tscn\n    ! it is gone, but 1 file still names it");
    expect(text).toContain("  res://menu.tscn (changed itself)");
    expect(text).toContain("godot_diff: read what changed by meaning");
    expect(r.scenarios.map((s) => s.name)).toEqual(["menu", "walk"]);
  });

  it("runs from the CLI", async () => {
    const run = await runCli(["impact", "--path", game(), "res://level.gd"]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toMatch(/^impact of 1 changed file \(the files given\): 2 scenes/);
  });
});
