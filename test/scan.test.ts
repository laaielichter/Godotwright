import { symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reviewProject } from "../src/review/review.js";
import { formatProjectMap } from "../src/scan/format.js";
import { scanProject } from "../src/scan/scan.js";
import { DEMO, makeProject, runCli } from "./helpers.js";

/** Paths (substrings) that fail with EACCES. Tests run as root, which can read anything, so the fs calls are guarded. */
const denied = vi.hoisted(() => [] as string[]);

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const guard = <F extends (...args: never[]) => unknown>(fn: F): F =>
    ((...args: unknown[]) => {
      const name = String(args[0]);
      if (denied.some((path) => name.includes(path))) {
        throw Object.assign(new Error(`EACCES: permission denied, '${name}'`), { code: "EACCES" });
      }
      return (fn as unknown as (...rest: unknown[]) => unknown)(...args);
    }) as unknown as F;
  return { ...actual, readdirSync: guard(actual.readdirSync), readFileSync: guard(actual.readFileSync) };
});

describe("scanProject on the demo project", () => {
  const map = scanProject(DEMO);

  it("reads the project settings", () => {
    expect(map.project).toEqual({
      name: "Demo Game",
      description: "Small 2D test project for Godotwright.",
      mainScene: "res://scenes/main.tscn",
      icon: "res://icon.svg",
      godotVersion: "4.7",
      renderer: "Forward Plus",
      features: ["4.7", "Forward Plus"],
      configVersion: 5,
    });
    expect(map.autoloads).toEqual([{ name: "GameState", path: "res://autoload/game_state.gd", singleton: true }]);
    expect(map.inputActions.map((a) => [a.name, a.events])).toEqual([
      ["move_left", ["Key:A", "JoyAxis:0-"]],
      ["move_right", ["Key:D", "JoyAxis:0+"]],
      ["jump", ["Key:Space", "JoyButton:0"]],
      ["shoot", ["Mouse:Left"]],
    ]);
    expect(map.settings["display/window/size/viewport_width"]).toBe(1280);
    expect(map.settings["layer_names/2d_physics/layer_3"]).toBe("enemies");
  });

  it("maps every scene with its node tree", () => {
    expect(map.scenes.map((s) => [s.path, s.rootName, s.rootType, s.rootScript])).toEqual([
      ["res://scenes/enemy.tscn", "Enemy", "Area2D", "res://scripts/enemy.gd"],
      ["res://scenes/main.tscn", "Main", "Node2D", "res://scripts/main.gd"],
      ["res://scenes/player.tscn", "Player", "CharacterBody2D", "res://scripts/player.gd"],
      ["res://scenes/ui/hud.tscn", "HUD", "CanvasLayer", "res://scripts/ui/hud.gd"],
    ]);
    const main = map.scenes.find((s) => s.path === "res://scenes/main.tscn")!;
    expect(main.nodes.map((n) => [n.path, n.type, n.instance])).toEqual([
      [".", "Node2D", undefined],
      ["Player", "CharacterBody2D", "res://scenes/player.tscn"],
      ["HUD", "CanvasLayer", "res://scenes/ui/hud.tscn"],
      ["SpawnTimer", "Timer", undefined],
      ["Floor", "StaticBody2D", undefined],
      ["Floor/CollisionShape2D", "CollisionShape2D", undefined],
    ]);
    expect(main.connections.map((c) => `${c.from}.${c.signal}->${c.to}:${c.method}`)).toEqual([
      "Player.died->.:_on_player_died",
      "SpawnTimer.timeout->.:_on_spawn_timer_timeout",
    ]);
    expect(main.instances).toEqual(["res://scenes/player.tscn", "res://scenes/ui/hud.tscn"]);
    const hud = map.scenes.find((s) => s.path === "res://scenes/ui/hud.tscn")!;
    expect(hud.nodes.find((n) => n.name === "ScoreLabel")).toMatchObject({ path: "Margin/ScoreLabel", uniqueName: true });
    const player = map.scenes.find((s) => s.path === "res://scenes/player.tscn")!;
    expect(player.nodes[0]!.groups).toEqual(["player"]);
    expect(player.subResourceTypes).toEqual(["RectangleShape2D", "ShaderMaterial"]);
  });

  it("maps every script with signals, functions and exports", () => {
    expect(map.scripts.map((s) => [s.path, s.className, s.extends, s.usedBy])).toEqual([
      ["res://autoload/game_state.gd", undefined, "Node", []],
      ["res://scripts/enemy.gd", undefined, "Area2D", ["res://scenes/enemy.tscn"]],
      ["res://scripts/enemy_stats.gd", "EnemyStats", "Resource", []],
      ["res://scripts/main.gd", undefined, "Node2D", ["res://scenes/main.tscn"]],
      ["res://scripts/player.gd", "Player", "CharacterBody2D", ["res://scenes/player.tscn"]],
      ["res://scripts/ui/hud.gd", "HUD", "CanvasLayer", ["res://scenes/ui/hud.tscn"]],
    ]);
    const player = map.scripts.find((s) => s.className === "Player")!;
    expect(player.uid).toBe("uid://bplayer0scrpt");
    expect(player.signals.map((s) => s.signature)).toEqual(["died", "health_changed(new_health: int, max_health: int)"]);
    expect(player.functions.map((f) => f.signature)).toEqual([
      "_ready() -> void",
      "_physics_process(delta: float) -> void",
      "take_damage(amount: int, knockback: Vector2 = Vector2.ZERO) -> void",
    ]);
    expect(player.variables.filter((v) => v.export).map((v) => [v.name, v.export])).toEqual([
      ["max_health", "@export"],
      ["gravity_scale", "@export_range(0.0, 2.0, 0.1)"],
      ["flash_color", "@export"],
    ]);
    expect(player.enums).toEqual(["State"]);
    expect(player.constants).toEqual(["SPEED", "JUMP_VELOCITY"]);
  });

  it("maps resources, shaders and assets, and skips .gdignore folders", () => {
    expect(map.resources).toEqual([
      { path: "res://resources/goblin.tres", uid: "uid://bgoblin0stats", type: "Resource", script: "res://scripts/enemy_stats.gd" },
    ]);
    expect(map.shaders).toEqual([{ path: "res://shaders/flash.gdshader", shaderType: "canvas_item" }]);
    expect(map.assets).toEqual({ texture: 1 });
    expect(map.scripts.some((s) => s.path.startsWith("res://docs/"))).toBe(false);
  });

  it("finds no problems in a healthy project", () => {
    expect(map.warnings).toEqual([]);
  });
});

describe("scanProject warnings", () => {
  it("reports broken references with file and line", () => {
    const root = makeProject({
      "project.godot": '[application]\nrun/main_scene="res://missing.tscn"\n[autoload]\nBus="*res://bus.gd"\n',
      "main.tscn": [
        "[gd_scene format=3]",
        '[ext_resource type="Script" path="res://gone.gd" id="1"]',
        '[ext_resource type="Script" uid="uid://known" path="res://old_path.gd" id="2"]',
        '[node name="Main" type="Node"]',
        'script = ExtResource("2")',
      ].join("\n"),
      "moved.gd": "extends Node\nconst S = preload(\"res://nope.tscn\")\nconst T = preload(\"main.tscn\")\n",
      "moved.gd.uid": "uid://known\n",
      "broken.tres": '[gd_resource type="Resource" format=3]\n[resource]\nvalue = Vector2(1, \n',
    });
    const map = scanProject(root);
    expect(map.warnings).toEqual([
      { file: "res://broken.tres", line: 4, message: "could not parse file: unexpected 'end of file'" },
      { file: "res://main.tscn", line: 2, message: "missing Script: res://gone.gd" },
      { file: "res://moved.gd", line: 2, message: "preload() path not found: res://nope.tscn" },
      { file: "res://project.godot", line: 2, message: "main scene not found: res://missing.tscn" },
      { file: "res://project.godot", line: 4, message: "autoload Bus not found: res://bus.gd" },
    ]);
    // The uid wins over the stale path, like in Godot.
    expect(map.scenes[0]!.rootScript).toBe("res://moved.gd");
  });

  it("finds the project root from a path inside it", () => {
    expect(scanProject(`${DEMO}/scenes/ui`).project.name).toBe("Demo Game");
  });

  it("fails clearly outside a project", () => {
    expect(() => scanProject(makeProject({ "readme.txt": "" }))).toThrow(/No project.godot found/);
  });
});

describe("project files", () => {
  it("skips hidden folders, as Godot does", () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="T"\nrun/main_scene="res://main.tscn"\n',
      "main.tscn": '[gd_scene format=3]\n[node name="Main" type="Node"]\n',
      "main.gd": "extends Node\n",
      ".venv/lib/tool.gd": "extends Node\n",
      ".github/ci.gd": "extends Node\n",
      ".cache/texture.png": "",
    });
    const map = scanProject(root);
    expect(map.scripts.map((s) => s.path)).toEqual(["res://main.gd"]);
    expect(map.assets).toEqual({});
  });
});

describe("unreadable files and folders", () => {
  const PROJECT = '[application]\nconfig/name="T"\nrun/main_scene="res://main.tscn"\n';
  /** Runs `fn` with `paths` unreadable, then makes them readable again. */
  const withDenied = <T>(paths: string[], fn: () => T): T => {
    denied.push(...paths);
    try {
      return fn();
    } finally {
      denied.length = 0;
    }
  };

  it("skips a folder it cannot read, warns, and scans the rest", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.tscn": '[gd_scene format=3]\n[node name="Main" type="Node"]\n',
      "locked/secret.gd": "extends Node\n",
    });
    const map = withDenied([join(root, "locked")], () => scanProject(root));
    expect(map.scripts).toEqual([]);
    expect(map.scenes.map((s) => s.path)).toEqual(["res://main.tscn"]);
    expect(map.warnings).toEqual([{ file: "res://locked", message: "could not read folder (EACCES)" }]);
  });

  it("reports an unreadable script, scene or project.godot as a read error", () => {
    const root = makeProject({ "project.godot": PROJECT, "main.tscn": '[gd_scene format=3]\n[node name="Main" type="Node"]\n', "broken.gd": "extends Node\n" });
    const map = withDenied([join(root, "broken.gd")], () => scanProject(root));
    expect(map.warnings).toEqual([{ file: "res://broken.gd", message: "could not read file (EACCES)" }]);
    const own = withDenied([join(root, "project.godot")], () => scanProject(root));
    expect(own.warnings).toEqual([{ file: "res://project.godot", message: "could not read file (EACCES)" }]);
  });

  it("skips an unreadable shader with a warning instead of failing the scan", () => {
    const root = makeProject({ "project.godot": PROJECT, "main.tscn": '[gd_scene format=3]\n[node name="Main" type="Node"]\n', "flash.gdshader": "shader_type canvas_item;\n" });
    const map = withDenied([join(root, "flash.gdshader")], () => scanProject(root));
    expect(map.shaders).toEqual([]);
    expect(map.warnings).toEqual([{ file: "res://flash.gdshader", message: "could not read file (EACCES)" }]);
  });
});

describe("references that leave the project", () => {
  const PROJECT = '[application]\nconfig/name="T"\nrun/main_scene="res://main.tscn"\n';
  const sceneWith = (path: string) => `[gd_scene format=3]\n[ext_resource type="Script" path="${path}" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n`;

  it("does not look for files outside the project through ../", () => {
    const outside = makeProject({ "secret.gd": "extends Node\n" });
    const root = makeProject({ "project.godot": PROJECT, "main.tscn": sceneWith(`res://../${basename(outside)}/secret.gd`) });
    expect(scanProject(root).warnings).toEqual([{ file: "res://main.tscn", line: 2, message: `missing Script: res://../${basename(outside)}/secret.gd` }]);
  });

  it("does not look through a folder link out of the project, even in an ignored folder", () => {
    const outside = makeProject({ "secret.gd": "extends Node\n" });
    const root = makeProject({ "project.godot": PROJECT, "docs/.gdignore": "", "main.tscn": sceneWith("res://docs/out/secret.gd") });
    symlinkSync(outside, join(root, "docs", "out"), "dir");
    expect(scanProject(root).warnings.map((w) => w.message)).toEqual(["missing Script: res://docs/out/secret.gd"]);
  });

  it("still resolves a file in an ignored folder of the project", () => {
    const root = makeProject({ "project.godot": PROJECT, "docs/.gdignore": "", "docs/notes.gd": "extends Node\n", "main.tscn": sceneWith("res://docs/notes.gd") });
    expect(scanProject(root).warnings).toEqual([]);
  });
});

describe("C# scripts", () => {
  const game = makeProject({ "project.godot": '[application]\nconfig/name="Game"\n', "Util.cs": "public class Util {}\n" });
  const mod = makeProject({ "project.godot": '[application]\nconfig/name="Mod"\n', "Mine.cs": "public class Mine {}\n", "rescue.gd": "extends Node\n" });

  it("lists and counts only the project's own, flagging a base's", () => {
    const map = scanProject(mod, { base: [game] });
    expect(map.csharpScripts).toEqual([{ path: "res://Mine.cs" }, { path: "res://Util.cs", external: true }]);
    expect(formatProjectMap(map)).toMatch(/files: .*, 1 C# script\n/);
  });

  it("still lets GDScript use the base's C# classes", () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="Mod"\n',
      "rescue.gd": "extends Node\n\n\nfunc _ready() -> void:\n\tvar u: Util = null\n\tprint(u)\n",
    });
    const unknown = (base: string[]) => reviewProject(root, { base }).findings.filter((f) => f.rule === "api/unknown-type");
    expect(unknown([])).toHaveLength(1);
    expect(unknown([game])).toEqual([]);
  });
});

describe("project.godot warnings", () => {
  it("reports an unparseable project.godot once, not as a missing main scene", () => {
    const root = makeProject({ "project.godot": '[application]\nconfig/name="T\n' });
    expect(scanProject(root).warnings).toEqual([{ file: "res://project.godot", line: 3, message: "could not parse file: unterminated string" }]);
  });

  it("does not report a base project's broken main scene or autoload as its own", () => {
    const game = makeProject({ "project.godot": '[application]\nconfig/name="Game"\nrun/main_scene="res://gone.tscn"\n\n[autoload]\nWorld="*res://world.gd"\n' });
    const mod = makeProject({ "project.godot": '[application]\nconfig/name="Mod"\n', "mod.gd": "extends Node\n" });
    const map = scanProject(mod, { base: [game] });
    expect(map.warnings).toEqual([]);
    expect(map.project.mainScene).toBeUndefined();
  });

  it("still reports a broken main scene or autoload the project sets itself", () => {
    const game = makeProject({ "project.godot": '[application]\nconfig/name="Game"\nrun/main_scene="res://main.tscn"\n' });
    const mod = makeProject({
      "project.godot": '[application]\nconfig/name="Mod"\nrun/main_scene="res://gone.tscn"\n\n[autoload]\nBus="*res://bus.gd"\n',
    });
    expect(scanProject(mod, { base: [game] }).warnings).toEqual([
      { file: "res://project.godot", line: 3, message: "main scene not found: res://gone.tscn" },
      { file: "res://project.godot", line: 6, message: "autoload Bus not found: res://bus.gd" },
    ]);
  });
});

describe("godotwright scan", () => {
  it("prints a brief map", async () => {
    const { output, exitCode } = await runCli(["scan", DEMO]);
    expect(exitCode).toBe(0);
    expect(output).toContain("project: Demo Game (Godot 4.7, Forward Plus)");
    expect(output).toContain(
      "res://scripts/player.gd  class Player extends CharacterBody2D  signals: died, health_changed  funcs: _ready, _physics_process, take_damage",
    );
    expect(output).toContain("warnings (0):");
  });

  it("prints a full map with node trees and line numbers", async () => {
    const { output } = await runCli(["scan", DEMO, "--detail", "full"]);
    expect(output).toContain("      Player: CharacterBody2D [instance res://scenes/player.tscn]  :12");
    expect(output).toContain("    signal Player.died -> Main._on_player_died()  :27");
    expect(output).toContain("    func take_damage(amount: int, knockback: Vector2 = Vector2.ZERO) -> void  :43-52");
    expect(output).toContain("  jump: Key:Space, JoyButton:0");
  });

  it("prints JSON", async () => {
    const { output } = await runCli(["scan", DEMO, "--json"]);
    expect(JSON.parse(output).project.name).toBe("Demo Game");
  });
});
