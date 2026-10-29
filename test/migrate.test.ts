import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { formatMigration, migrateProject, migrateScript } from "../src/migrate/migrate.js";
import { reviewProject } from "../src/review/review.js";
import { FIXTURES, makeProject, runCli } from "./helpers.js";

const api = GodotApi.load();
const code = (s: string) => migrateScript(s, api).code;
const PROJECT = '[application]\nconfig/name="T"\nconfig/features=PackedStringArray("4.7")\n';

describe("migrate a script", () => {
  it("rewrites the messy fixture so the review finds no Godot 3 code except what needs a hand", () => {
    const source = readFileSync(`${FIXTURES}/messy/scripts/old_player.gd`, "utf8");
    const m = migrateScript(source, api);
    expect(m.code).toContain("extends CharacterBody2D");
    expect(m.code).toContain("@export var speed");
    expect(m.code).toContain("@onready var sprite = $Sprite");
    expect(m.code).not.toContain("$Sprite2D");
    expect(m.code).toContain("body_entered.connect(self._on_body_entered)");
    expect(m.code).toContain("await get_tree().create_timer(1.0).timeout");
    expect(m.code).toContain("deg_to_rad(90)");
    expect(m.code).toContain("Time.get_ticks_msec()");
    expect(m.code).toContain("change_scene_to_file(");
    expect(m.code).toContain("items.is_empty()");
    expect(m.changes.length).toBeGreaterThanOrEqual(9);
    expect(m.left.map((l) => l.message).join(" ")).toContain("move_and_slide() takes no arguments");
    const root = makeProject({ "project.godot": PROJECT, "old_player.gd": m.code });
    const godot3 = reviewProject(root).findings.filter((f) => f.rule === "api/godot3-syntax" || f.message.includes("Godot 3 name") || f.message.includes("In Godot 4 use"));
    expect(godot3).toEqual([]);
  });

  it("is idempotent: a migrated script needs no further change", () => {
    const source = readFileSync(`${FIXTURES}/messy/scripts/old_player.gd`, "utf8");
    const once = migrateScript(source, api);
    const twice = migrateScript(once.code, api);
    expect(twice.changes).toEqual([]);
    expect(twice.code).toBe(once.code);
  });

  it("leaves strings, comments and node paths alone", () => {
    const src = 'var s = "export var x; yield(a, b); KinematicBody2D"  # onready var deg2rad(1)\nvar n = $Sprite/KinematicBody2D\nvar u = %Sprite\n';
    const m = migrateScript(src, api);
    expect(m.code).toBe(src);
    expect(m.changes).toEqual([]);
  });

  it("converts export hints it understands and reports the ones it drops", () => {
    expect(code("export(int) var hp = 3")).toBe("@export var hp: int = 3");
    expect(code("export(int, 0, 10) var speed = 5")).toBe("@export_range(0, 10) var speed: int = 5");
    expect(code("export(String, FILE, \"*.png\") var icon")).toBe('@export_file("*.png") var icon: String');
    expect(code("export(String, MULTILINE) var text")).toBe("@export_multiline var text: String");
    expect(code("export(Array, PackedScene) var scenes")).toBe("@export var scenes: Array[PackedScene]");
    expect(code("export(PoolStringArray) var names")).toBe("@export var names: PackedStringArray");
    expect(code("export(int, \"A\", \"B\") var mode = 0")).toBe('@export_enum("A", "B") var mode: int = 0');
    expect(code("export(int, FLAGS, \"Fire\", \"Water\") var elements = 0")).toBe('@export_flags("Fire", "Water") var elements: int = 0');
    const m = migrateScript("export(Color, RGB) var tint", api);
    expect(m.code).toBe("@export var tint: Color");
    expect(m.left[0]?.message).toContain("export hint");
  });

  it("rewrites signals and callables with their arguments", () => {
    expect(code('timer.connect("timeout", self, "_on_timeout")')).toBe("timer.timeout.connect(self._on_timeout)");
    expect(code('connect("hit", self, "_on_hit", [1, "a"])')).toBe('hit.connect(self._on_hit.bind(1, "a"))');
    expect(code('$Button.connect("pressed", self, "_go", [], CONNECT_ONESHOT)')).toBe("$Button.pressed.connect(self._go, CONNECT_ONE_SHOT)");
    expect(code('if is_connected("done", self, "_x"):')).toBe("if done.is_connected(self._x):");
    expect(code('emit_signal("scored", points, who)')).toBe("scored.emit(points, who)");
    expect(code('var f = funcref(self, "run")')).toBe("var f = self.run");
    expect(code('yield(get_tree(), "idle_frame")')).toBe("await get_tree().process_frame");
    expect(code('yield($Anim, "animation_finished")')).toBe("await $Anim.animation_finished");
    expect(code('get_node("Area").connect("body_entered", self, "_on")')).toBe('get_node("Area").body_entered.connect(self._on)');
    const dynamic = migrateScript("connect(sig_name, self, method_name)", api);
    expect(dynamic.code).toBe("connect(sig_name, self, method_name)");
    expect(dynamic.left[0]?.message).toContain("dynamic");
  });

  it("renames only Godot 3 names that do not exist in Godot 4 or in the script", () => {
    expect(code("var r = rand_range(1, 2)\nvar s = stepify(x, 0.5)\nvar b = BUTTON_LEFT")).toBe("var r = randf_range(1, 2)\nvar s = snapped(x, 0.5)\nvar b = MOUSE_BUTTON_LEFT");
    // `empty` is this script's own function: it stays.
    expect(code("func empty():\n\tpass\n\nfunc go():\n\tif empty():\n\t\tpass")).toContain("if empty():");
    // Super calls and the tool annotation.
    expect(code("tool\nextends Node\nfunc _ready():\n\t._ready()")).toBe("@tool\nextends Node\nfunc _ready():\n\tsuper._ready()");
    // A Godot 4 node path or a user class named like a Godot 3 class stays.
    expect(code("class_name Spatial\nvar a = Spatial.new()")).toBe("class_name Spatial\nvar a = Spatial.new()");
  });

  it("lists what it cannot do by hand, once per line", () => {
    const m = migrateScript("var hp = 1 setget set_hp\nremote func ping():\n\tpass\nfunc f():\n\tmove_and_slide(v, Vector3.UP)\n\tyield()", api);
    const msgs = m.left.map((l) => `${l.line}:${l.message.split(":")[0]}`);
    expect(msgs).toEqual(["1:setget is gone in Godot 4", "2:network keywords are @rpc annotations in Godot 4", "5:move_and_slide() takes no arguments in Godot 4", "6:yield() with no arguments (a resumable function) has no direct Godot 4 form"]);
  });
});

describe("migrate a project", () => {
  it("reports without writing, then writes on request, and skips addons", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "player.gd": "export var a = 1\n",
      "clean.gd": "@export var a = 1\n",
      "addons/x/plugin.gd": "export var b = 2\n",
    });
    const dry = migrateProject(root);
    expect(dry.files.map((f) => f.file)).toEqual(["res://player.gd"]);
    expect(dry.changes).toBe(1);
    expect(dry.written).toBe(false);
    expect(readFileSync(`${root}/player.gd`, "utf8")).toBe("export var a = 1\n");
    const text = formatMigration(dry);
    expect(text).toContain("1 script with 1 change");
    expect(text).toContain("dry run");
    const wet = migrateProject(root, { write: true });
    expect(wet.files[0]?.written).toBe(true);
    expect(readFileSync(`${root}/player.gd`, "utf8")).toBe("@export var a = 1\n");
    expect(migrateProject(root).files).toEqual([]);
    expect(formatMigration(migrateProject(root))).toContain("Nothing to migrate");
    expect(migrateProject(root, { includeAddons: true }).files.map((f) => f.file)).toEqual(["res://addons/x/plugin.gd"]);
  });

  it("migrates one file and runs from the CLI with --json", async () => {
    const root = makeProject({ "project.godot": PROJECT, "a.gd": "onready var x = 1\n" });
    const one = migrateProject(`${root}/a.gd`);
    expect(one.files[0]?.changes[0]?.to).toBe("@onready var");
    const run = await runCli(["migrate", root]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("onready var  ->  @onready var");
    const json = JSON.parse((await runCli(["migrate", root, "--json"])).output) as { changes: number };
    expect(json.changes).toBe(1);
    const missing = await runCli(["migrate", `${root}/nope`]);
    expect(missing.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
