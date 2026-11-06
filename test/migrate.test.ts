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
    expect(code("export(Color, RGB) var tint")).toBe("@export_color_no_alpha var tint: Color");
    expect(code("export(Color, RGBA) var tint")).toBe("@export var tint: Color");
    expect(code("export(int, LAYERS_2D_PHYSICS) var mask = 1")).toBe("@export_flags_2d_physics var mask: int = 1");
    expect(code("export(int, LAYERS_3D_NAVIGATION) var nav")).toBe("@export_flags_3d_navigation var nav: int");
    expect(code("export(float, EXP, 100, 1000, 20) var e")).toBe('@export_range(100, 1000, 20, "exp") var e: float');
    expect(code("export(float, EASE) var ease")).toBe("@export_exp_easing var ease: float");
    for (const hint of ["Color, RGB", "Color, RGBA", "int, LAYERS_2D_RENDER", "float, EXP, 1, 10", "float, EASE"]) {
      expect(migrateScript(`export(${hint}) var x`, api).left).toEqual([]);
    }
    const m = migrateScript("export(NodePath, HELLO) var target", api);
    expect(m.code).toBe("@export var target: NodePath");
    expect(m.left[0]?.message).toContain("export hint");
  });

  it("converts GLOBAL file and dir hints, String enums and one-number ranges", () => {
    expect(code('export(String, FILE, GLOBAL, "*.png") var p')).toBe('@export_global_file("*.png") var p: String');
    expect(code("export(String, FILE, GLOBAL) var p")).toBe("@export_global_file var p: String");
    expect(code("export(String, DIR, GLOBAL) var d")).toBe("@export_global_dir var d: String");
    expect(code('export(String, "Rebecca", "Mary", "Leah") var n')).toBe('@export_enum("Rebecca", "Mary", "Leah") var n: String');
    expect(code("export(int, 20) var i")).toBe("@export_range(0, 20) var i: int");
    expect(code("export(float, 1.5) var f")).toBe("@export_range(0, 1.5) var f: float");
    // The project-scoped and already-working forms stay as they are.
    expect(code('export(String, FILE, "*.png") var icon')).toBe('@export_file("*.png") var icon: String');
    expect(code("export(String, DIR) var d")).toBe("@export_dir var d: String");
    expect(code('export(int, "A", "B") var mode = 0')).toBe('@export_enum("A", "B") var mode: int = 0');
    expect(code("export(int, 0, 10) var speed = 5")).toBe("@export_range(0, 10) var speed: int = 5");
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

  it("rewrites to_json, parse_json, ColorN and polar2cartesian (#144)", () => {
    expect(code("var text = to_json(data)")).toBe('var text = JSON.stringify(data, "", false)');
    expect(code("var val = parse_json(text)")).toBe("var val = JSON.parse_string(text)");
    expect(code('var c1 = ColorN("red")')).toBe('var c1 = Color("red")');
    expect(code('var c2 = ColorN("red", 0.5)')).toBe('var c2 = Color("red", 0.5)');
    expect(code("var v = polar2cartesian(10, PI)")).toBe("var v = (Vector2.from_angle(PI) * 10)");

    // Look-alikes left alone:
    expect(code("var t = data.to_json()")).toBe("var t = data.to_json()");
    expect(code("func to_json():\n\treturn {}\nfunc go():\n\tvar x = to_json()")).toBe("func to_json():\n\treturn {}\nfunc go():\n\tvar x = to_json()");

    // cartesian2polar gets a TO DO:
    const polar = migrateScript("var p = cartesian2polar(1, 2)", api);
    expect(polar.code).toBe("var p = cartesian2polar(1, 2)");
    expect(polar.left[0]?.message).toContain("cartesian2polar(x, y) is gone in Godot 4");

    // Reviewing migrated code gives no api/unknown-function for rewritten functions
    const script = `extends Node\nfunc test():\n\tvar text = to_json({"a": 1})\n\tvar val = parse_json(text)\n\tvar c = ColorN("red", 0.5)\n\tvar v = polar2cartesian(10.0, 1.0)\n`;
    const migrated = migrateScript(script, api);
    const root = makeProject({ "project.godot": PROJECT, "test.gd": migrated.code });
    const findings = reviewProject(root).findings.filter((f) => f.rule === "api/unknown-function");
    expect(findings).toEqual([]);
  });

  it("rewrites JSON.print and JSON.parse(s).result (#161)", () => {
    expect(code("var text = JSON.print(data)")).toBe('var text = JSON.stringify(data, "", false)');
    expect(code('var text2 = JSON.print(data, "\\t")')).toBe('var text2 = JSON.stringify(data, "\\t", false)');
    expect(code('var text3 = JSON.print(data, "\\t", true)')).toBe('var text3 = JSON.stringify(data, "\\t", true)');
    expect(code("var text4 = JSON.print(data, indent, sort)")).toBe("var text4 = JSON.stringify(data, indent, sort)");

    expect(code("var value = JSON.parse(text).result")).toBe("var value = JSON.parse_string(text)");

    // Look-alikes left alone:
    expect(code('print("hello")')).toBe('print("hello")');
    expect(code('logger.print("hello")')).toBe('logger.print("hello")');

    // JSON.parse(x) without .result gets a TO DO:
    const parseOnly = migrateScript("var res = JSON.parse(text)", api);
    expect(parseOnly.code).toBe("var res = JSON.parse(text)");
    expect(parseOnly.left[0]?.message).toContain("JSON.parse() returns an Error in Godot 4");

    // Idempotent:
    const once = migrateScript('var s = JSON.print(d)\nvar v = JSON.parse(t).result', api);
    const twice = migrateScript(once.code, api);
    expect(twice.changes).toEqual([]);
    expect(twice.code).toBe(once.code);

    // Review hint for JSON.print:
    const unmigrated = makeProject({ "project.godot": PROJECT, "test.gd": "extends Node\nfunc f():\n\tJSON.print({})\n" });
    const review = reviewProject(unmigrated).findings.filter((f) => f.message.includes("JSON.stringify"));
    expect(review.length).toBeGreaterThanOrEqual(1);
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

  it("rewrites Godot 3 network keywords to @rpc annotations (#115)", () => {
    expect(code("remote func hit(damage):\n\tpass")).toBe('@rpc("any_peer") func hit(damage):\n\tpass');
    expect(code("remotesync func chat(text):\n\tpass")).toBe('@rpc("any_peer", "call_local") func chat(text):\n\tpass');
    expect(code("puppet func set_position(p):\n\tpass")).toBe("@rpc func set_position(p):\n\tpass");
    expect(code("puppetsync func update(val):\n\tpass")).toBe('@rpc("call_local") func update(val):\n\tpass');
    expect(code("sync func chime():\n\tpass")).toBe('@rpc("any_peer", "call_local") func chime():\n\tpass');
    expect(code("slave func dance():\n\tpass")).toBe("@rpc func dance():\n\tpass");

    const m = migrateScript("remote func hit():\n\tpass\npuppet func p():\n\tpass\nremotesync func c():\n\tpass\npuppetsync func u():\n\tpass", api);
    expect(m.left).toEqual([]);
  });

  it("moves members with their call arguments, and leaves property forms that need one", () => {
    // A call keeps its arguments inside the Godot 4 call.
    expect(code("var d = OS.get_datetime(true)")).toBe("var d = Time.get_datetime_dict_from_system(true)");
    expect(code("var s = OS.get_screen_size(1)")).toBe("var s = DisplayServer.screen_get_size(1)");
    // A property whose Godot 4 form is a method with a required parameter stays, and the window
    // TO DO fires instead of writing code that does not parse or calls the wrong thing.
    const fullscreen = migrateScript("OS.window_fullscreen = true", api);
    expect(fullscreen.code).toBe("OS.window_fullscreen = true");
    expect(fullscreen.left.map((l) => l.message).join(" ")).toContain("window_set_mode");
    const vsync = migrateScript("if OS.vsync_enabled:", api);
    expect(vsync.code).toBe("if OS.vsync_enabled:");
    expect(vsync.left.map((l) => l.message).join(" ")).toContain("window_set_vsync_mode");
    // Rewrites that already worked stay as they are.
    expect(code("var t = OS.get_ticks_msec()")).toBe("var t = Time.get_ticks_msec()");
    expect(code("if Engine.editor_hint:")).toBe("if Engine.is_editor_hint():");
    expect(code("OS.window_position = Vector2(10, 10)")).toBe("get_window().position = Vector2(10, 10)");
  });

  it("lists what it cannot do by hand, once per line", () => {
    const m = migrateScript("var hp = 1 setget\nmaster func ping():\n\tpass\nfunc f():\n\tmove_and_slide(v, Vector3.UP)\n\tyield()", api);
    const msgs = m.left.map((l) => `${l.line}:${l.message.split(":")[0]}`);
    expect(msgs).toEqual(["1:setget is gone in Godot 4", "2:master and mastersync ran on the master when called by others in Godot 3", "5:move_and_slide() takes no arguments in Godot 4", "6:yield() with no arguments (a resumable function) has no direct Godot 4 form"]);
  });
  it("rewrites simple setget declarations to Godot 4 property syntax", () => {
    expect(code("var hp = 10 setget set_hp, get_hp")).toBe("var hp = 10: set = set_hp, get = get_hp");
    expect(code("var hp = 10 setget set_hp")).toBe("var hp = 10: set = set_hp");
    expect(code("var hp = 10 setget , get_hp")).toBe("var hp = 10: get = get_hp");
    expect(code("var hp: int = 10 setget set_hp")).toBe("var hp: int = 10: set = set_hp");
    expect(code("var hp: int setget set_hp")).toBe("var hp: int: set = set_hp");
    expect(code("var hp setget set_hp, get_hp")).toBe("var hp: set = set_hp, get = get_hp");
    expect(code("var hp setget , get_hp")).toBe("var hp: get = get_hp");
    expect(code("var hp = 10 setget set_hp # keep")).toBe("var hp = 10: set = set_hp # keep");
    expect(code("@export var hp: int = 10 setget set_hp")).toBe("@export var hp: int = 10: set = set_hp");

    const m = migrateScript("var hp = 10 setget set_hp\nvar mp = 5 setget set_mp", api);
    expect(m.notes).toEqual(["setters in Godot 4 run on assignment inside the script (in Godot 3 they required self.)"]);

    const root = makeProject({ "project.godot": PROJECT, "prop.gd": "var hp = 10 setget set_hp\n" });
    const formatted = formatMigration(migrateProject(root));
    expect(formatted).toContain("note: setters in Godot 4 run on assignment inside the script");
  });

  it("leaves no TO DO when setter assigns its property directly (Godot 4 accesses the underlying member)", () => {
    const script = migrateScript("var hp = 10 setget set_hp\nfunc set_hp(val):\n\thp = val", api);
    expect(script.left).toEqual([]);
  });

  it("rewrites update() to queue_redraw() in scripts that extend a CanvasItem (#162)", () => {
    // Control, Node2D, Sprite (renamed to Sprite2D) are CanvasItem
    expect(code("extends Control\nfunc _on_val():\n\tupdate()")).toBe("extends Control\nfunc _on_val():\n\tqueue_redraw()");
    expect(code("extends Node2D\nfunc f():\n\tupdate()")).toBe("extends Node2D\nfunc f():\n\tqueue_redraw()");
    expect(code("extends Sprite\nfunc f():\n\tupdate()")).toBe("extends Sprite2D\nfunc f():\n\tqueue_redraw()");

    // Node, Node3D, Spatial (renamed to Node3D) are not CanvasItem
    expect(code("extends Node\nfunc f():\n\tupdate()")).toBe("extends Node\nfunc f():\n\tupdate()");
    expect(code("extends Node3D\nfunc f():\n\tupdate()")).toBe("extends Node3D\nfunc f():\n\tupdate()");
    expect(code("extends Spatial\nfunc f():\n\tupdate()")).toBe("extends Node3D\nfunc f():\n\tupdate()");

    // Own func update() or receiver calls are left alone
    expect(code("extends Control\nfunc update():\n\tpass\nfunc f():\n\tupdate()")).toBe("extends Control\nfunc update():\n\tpass\nfunc f():\n\tupdate()");
    expect(code("extends Control\nfunc f():\n\tother.update()")).toBe("extends Control\nfunc f():\n\tother.update()");

    // Path base gets a TO DO instead of rewrite
    const pathBase = migrateScript('extends "res://base.gd"\nfunc f():\n\tupdate()', api);
    expect(pathBase.code).toBe('extends "res://base.gd"\nfunc f():\n\tupdate()');
    expect(pathBase.left[0]?.message).toContain("update() is queue_redraw() in CanvasItem scripts");

    // Idempotent: migrating again makes no changes
    const migrated = migrateScript("extends Control\nfunc f():\n\tupdate()", api);
    const again = migrateScript(migrated.code, api);
    expect(again.code).toBe("extends Control\nfunc f():\n\tqueue_redraw()");
    expect(again.changes).toEqual([]);
    expect(again.left).toEqual([]);
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
