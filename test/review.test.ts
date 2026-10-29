import { describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { formatFinding, formatReview } from "../src/review/format.js";
import { reviewProject } from "../src/review/review.js";
import { FIXTURES, DEMO, makeProject, runCli } from "./helpers.js";

const PROJECT = '[application]\nconfig/name="T"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n';

function findings(files: Record<string, string>): string[] {
  const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", ...files });
  return reviewProject(root).findings.filter((f) => f.severity !== "info").map(formatFinding);
}

describe("review of the demo fixture", () => {
  it("scores a clean, typed project 100", () => {
    const report = reviewProject(DEMO);
    expect(report.findings).toEqual([]);
    expect(report.overall).toBe(100);
    expect(report.categories.map((c) => c.score)).toEqual([100, 100, 100, 100]);
    expect(report.typing.percent).toBe(100);
  });
});

describe("review of the messy fixture", () => {
  const report = reviewProject(`${FIXTURES}/messy`);
  const lines = report.findings.map(formatFinding);
  const has = (text: string) => expect(lines.some((l) => l.includes(text)), text).toBe(true);

  it("catches Godot 3 code", () => {
    has("old_player.gd:1: error [api/unknown-type] Cannot extend \"KinematicBody2D\"");
    has("In Godot 4 it is `CharacterBody2D`");
    has("old_player.gd:3: error [api/godot3-syntax]");
    has("old_player.gd:4: error [api/godot3-syntax]");
    has("old_player.gd:11: error [api/godot3-syntax] Godot 3 syntax: `yield()` is `await`");
    has("old_player.gd:17: error [api/wrong-arguments] move_and_slide() takes 0 arguments, but 2 are given.");
    has("old_player.gd:18: error [api/unknown-function] Function \"deg2rad()\"");
    has("In Godot 4 it is `deg_to_rad`");
    has("old_player.gd:19: error [api/unknown-member] Method \"get_ticks_msec()\" does not exist on OS in Godot 4.7. In Godot 4 use Time.get_ticks_msec().");
    has("old_player.gd:21: error [api/unknown-member] Method \"change_scene()\" does not exist on SceneTree");
    has("change_scene_to_file");
    has("old_player.gd:23: error [api/unknown-member] Method \"empty()\" does not exist on Array");
  });

  it("catches invented API in Godot 4 code", () => {
    has("enemy.gd:15: error [api/unknown-function] Function \"look_at_smooth()\"");
    has("Did you mean: look_at?");
    has("enemy.gd:16: warning [api/unsafe-member] Method \"set_glow()\" is not a member of Sprite2D");
    has("enemy.gd:17: error [api/unknown-member] Method \"normalize_it()\" does not exist on Vector2");
    has("enemy.gd:21: error [api/unknown-signal] Signal \"dead\"");
    has("enemy.gd:22: error [api/unknown-input-action] Input action \"fire\"");
  });

  it("catches per-frame performance problems", () => {
    has("enemy.gd:14: warning [performance/node-lookup-per-frame] 2 node lookups in _process()");
    has("enemy.gd:18: warning [performance/physics-in-process] move_and_slide()");
    has("enemy.gd:19: warning [performance/load-per-frame]");
    has("enemy.gd:20: info [performance/print-per-frame]");
  });

  it("catches broken scene structure", () => {
    has("Main.tscn:21: error [structure/bad-connection] Connection Button.pressed -> Main._on_start_pressed(): res://scripts/main.gd has no method \"_on_start_pressed\".");
    has("Main.tscn:22: error [structure/bad-connection] Connection Button.clicked: Button has no signal \"clicked\".");
    has("enemy.gd:10: warning [structure/missing-node] Node \"UI/HealthBar\" does not exist under node \"Enemy\"");
    has("old_player.gd:4: warning [structure/missing-node] Node \"Sprite\"");
    has("enemy.gd:23: warning [structure/unknown-group] Group \"players\"");
    has("enemy.gd:19: error [structure/broken-reference] load() path not found: res://icon.svg");
  });

  it("reports code quality", () => {
    has("enemy.gd:5: warning [quality/unused-signal] Signal \"never_emitted\"");
    has("enemy.gd:27: info [quality/naming] Function \"DoDamage\" should be snake_case.");
    has("main.gd:6: info [quality/todo] TODO: spawn more enemies");
    has("old_player.gd:6: info [quality/untyped] 6 of 6 declarations have no static type");
    expect(report.typing.percent).toBeLessThan(60);
  });

  it("scores it low, worst in api", () => {
    const [api, performance, quality, structure] = report.categories;
    expect(api!.score).toBe(0);
    expect(performance!.score).toBeLessThan(100);
    expect(quality!.score).toBeLessThan(100);
    expect(structure!.score).toBeLessThan(60);
    expect(report.overall).toBeLessThan(60);
  });

  it("formats brief and full reports", () => {
    const brief = formatReview(report);
    expect(brief).toContain("AAA review: Messy Project");
    expect(brief).toMatch(/api\s+0/);
    expect(brief).not.toContain("fix:");
    const full = formatReview(report, "full");
    expect(full).toContain("fix: Pass the arguments the Godot 4.7 signature expects");
  });
});

describe("review precision", () => {
  it("accepts valid Godot 4 idioms", () => {
    expect(
      findings({
        "main.tscn": [
          "[gd_scene format=3]",
          '[ext_resource type="Script" path="res://main.gd" id="1"]',
          '[sub_resource type="GDScript" id="GDScript_1"]',
          'script/source = "extends Node2D\\n\\nfunc add_item(item: Node) -> void:\\n\\tadd_child(item)\\n"',
          '[node name="Main" type="ColorRect"]',
          'script = ExtResource("1")',
          '[node name="Items" type="Node2D" parent="."]',
          'script = SubResource("GDScript_1")',
          '[node name="Label" type="Label" parent="."]',
          "unique_name_in_owner = true",
          '[node name="Button" type="Button" parent="."]',
          '[connection signal="pressed" from="Button" to="." method="_on_pressed"]',
          '[connection signal="resized" from="." to="." method="_on_pressed"]',
        ].join("\n"),
        "main.gd": [
          "extends Control",
          "",
          "enum Mode { A, B }",
          "",
          "var mode: Mode = Mode.A",
          "var process: ProcessMode = PROCESS_MODE_INHERIT",
          "var data := {\"hp\": 3}",
          "@onready var items: Node2D = $Items",
          "",
          "",
          "func _ready() -> void:",
          "\tself.color = Color.RED",
          "\tset_size(Vector2(10, 10))",
          "\tvar err: Error = OK",
          "\tvar t: Variant.Type = TYPE_INT",
          "\tprint(data.hp, err, t, get_size())",
          "\t%Label.text = \"hi\"",
          "\titems.add_item(Node.new())",
          "\tvar events := InputMap.action_get_events(\"ui_accept\")",
          "\tprint(events.size())",
          "\tvar node := get_node(\"Items\")",
          "\tif node.has_method(\"special\"):",
          "\t\tnode.special()",
          "\tvar parts: PackedStringArray = \"a,b\".split(\",\")",
          "\tprint(parts.size(), mode, process)",
          "",
          "",
          "func _on_pressed() -> void:",
          "\tpass",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("follows inherited scenes and built-in scripts", () => {
    expect(
      findings({
        "base.tscn": '[gd_scene format=3]\n[node name="Base" type="Node2D"]\n[node name="Panel" type="Panel" parent="."]\n[node name="Label" type="Label" parent="Panel"]\n',
        "main.tscn": [
          "[gd_scene format=3]",
          '[ext_resource type="PackedScene" path="res://base.tscn" id="1"]',
          '[ext_resource type="Script" path="res://main.gd" id="2"]',
          '[node name="Main" instance=ExtResource("1")]',
          'script = ExtResource("2")',
          '[node name="Panel" parent="." index="0"]',
          "modulate = Color(1, 0, 0, 1)",
        ].join("\n"),
        "main.gd": 'extends Node2D\n\n@onready var label: Label = $Panel/Label\n\n\nfunc _ready() -> void:\n\tlabel.text = "x"\n',
      }),
    ).toEqual([]);
  });
});

describe("godotwright review", () => {
  it("prints scores and exits 1 when there are errors", async () => {
    const ok = await runCli(["review", DEMO]);
    expect(ok.output).toContain("overall: 100/100");
    const previous = process.exitCode;
    const bad = await runCli(["review", `${FIXTURES}/messy`, "--json"]);
    expect(JSON.parse(bad.output).overall).toBeLessThan(60);
    expect(process.exitCode).toBe(1);
    process.exitCode = previous;
  });
});


describe("moved Godot 3 window properties", () => {
  const cases = [
    ["window_position", "position", "Vector2i(20, 30)"],
    ["min_window_size", "min_size", "Vector2i(320, 240)"],
    ["max_window_size", "max_size", "Vector2i(1280, 720)"],
    ["window_borderless", "borderless", "true"],
  ] as const;

  it.each(cases)("suggests the Window replacement for OS.%s reads and writes", (old, property, value) => {
    const lines = findings({
      "main.tscn": "[gd_scene load_steps=2 format=3]\n[ext_resource type=\"Script\" path=\"res://main.gd\" id=\"1\"]\n[node name=\"Main\" type=\"Node\"]\nscript = ExtResource(\"1\")\n",
      "main.gd": [
        "extends Node",
        "",
        "",
        "func _ready() -> void:",
        `\tprint(OS.${old})`,
        `\tOS.${old} = ${value}`,
      ].join("\n"),
    });
    const moved = lines.filter((line) => line.includes(`In Godot 4 use get_window().${property}.`));
    expect(moved).toHaveLength(2);
    expect(moved.every((line) => line.includes("error [api/unknown-member]"))).toBe(true);
  });

  it.each(cases)("checks OS.%s replacement against the bundled Godot 4.7 API", (_old, property) => {
    const api = GodotApi.load();
    expect(api.version).toMatch(/^4\.7/);
    expect(api.lookup(`Window.${property}`).entries).not.toHaveLength(0);
  });

  it("stays quiet on the supported Window properties", () => {
    expect(findings({
      "main.tscn": "[gd_scene load_steps=2 format=3]\n[ext_resource type=\"Script\" path=\"res://main.gd\" id=\"1\"]\n[node name=\"Main\" type=\"Node\"]\nscript = ExtResource(\"1\")\n",
      "main.gd": [
        "extends Node",
        "",
        "",
        "func _ready() -> void:",
        ...cases.flatMap(([_old, property, value]) => [
          `\tget_window().${property} = ${value}`,
          `\tprint(get_window().${property})`,
        ]),
      ].join("\n"),
    })).toEqual([]);
  });
});

describe("review robustness", () => {
  it("reports a self-referencing constant on its line instead of aborting the review", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.gd": "extends Node\n\nconst Foo: Foo = 1\nconst A: B = 1\nconst B: A = 2\n\nfunc _ready() -> void:\n\tprint(A, B, Foo)\n",
    });
    const report = reviewProject(root);
    const unknown = report.findings.filter((f) => f.rule === "api/unknown-type" && f.file === "res://main.gd");
    expect(unknown.map((f) => f.line)).toContain(3);
    expect(unknown.map(formatFinding)[0]).toContain('Type "Foo" does not exist');
  });

  describe("GDExtension node types in scene connections", () => {
    const scene = [
      '[gd_scene load_steps=2 format=3]',
      '[ext_resource type="Script" path="res://main.gd" id="1"]',
      '[node name="Main" type="Node2D"]',
      'script = ExtResource("1")',
      '[node name="Gizmo" type="MyGizmo" parent="."]',
      '[connection signal="tapped" from="Gizmo" to="." method="_on_gizmo_tapped"]',
      "",
    ].join("\n");
    const files = {
      "project.godot": PROJECT,
      "main.tscn": scene,
      "main.gd": "extends Node2D\n\nfunc _on_gizmo_tapped() -> void:\n\tpass\n",
    };

    it("does not report signals of a node type that a GDExtension library provides", () => {
      const root = makeProject({ ...files, "gizmo.gdextension": '[configuration]\nentry_symbol = "gizmo_init"\n' });
      expect(reviewProject(root).findings.filter((f) => f.rule === "structure/bad-connection")).toEqual([]);
    });

    it("still reports the same connection when no library could provide the type", () => {
      const root = makeProject(files);
      const bad = reviewProject(root).findings.filter((f) => f.rule === "structure/bad-connection").map(formatFinding);
      expect(bad).toEqual(['res://main.tscn:6: error [structure/bad-connection] Connection Gizmo.tapped: MyGizmo has no signal "tapped".']);
    });
  });

  it("does not flag a lazily cached load or lookup in a per-frame function", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.gd": [
        "extends Node",
        "",
        "var _tex: Texture2D",
        "var _sprite: Sprite2D",
        "",
        "",
        "func _process(_delta: float) -> void:",
        "\tif not _tex:",
        '\t\t_tex = load("res://icon.svg")',
        "\tif _sprite == null:",
        '\t\t_sprite = get_node("Sprite")',
        '\tvar other := get_node("Other")',
        "\tprint(other)",
        "",
      ].join("\n"),
    });
    const performance = reviewProject(root).findings.filter((f) => f.category === "performance").map(formatFinding);
    expect(performance).toEqual([
      "res://main.gd:12: warning [performance/node-lookup-per-frame] A node lookup in _process() runs every frame; store the node in an @onready var.",
      "res://main.gd:13: info [performance/print-per-frame] print() in _process() prints every frame and slows the game.",
    ]);
  });

  it("checks per-frame functions whose body is on the func line", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.gd": 'extends Node\n\nfunc _process(delta: float) -> void: print("tick")\n\n\nfunc _physics_process(delta: float) -> void: pass\n',
    });
    const performance = reviewProject(root).findings.filter((f) => f.category === "performance").map(formatFinding);
    expect(performance).toEqual([
      "res://main.gd:3: info [performance/print-per-frame] print() in _process() prints every frame and slows the game.",
      "res://main.gd:6: info [performance/empty-callback] _physics_process() is empty; Godot still calls it every frame.",
    ]);
  });

  it("does not report a group that add_to_group() names with a constant", () => {
    const count = ["func count() -> int:", '\treturn get_tree().get_nodes_in_group("players").size()', ""].join("\n");
    const named = makeProject({
      "project.godot": PROJECT,
      "main.gd": ["extends Node", "", 'const PLAYERS := "players"', "", "func _ready() -> void:", "\tadd_to_group(PLAYERS)", "", "", count].join("\n"),
    });
    const unassigned = makeProject({ "project.godot": PROJECT, "main.gd": ["extends Node", "", "", count].join("\n") });
    const groups = (root: string) => reviewProject(root).findings.filter((f) => f.rule === "structure/unknown-group").map(formatFinding);
    expect(groups(named)).toEqual([]);
    expect(groups(unassigned)).toEqual(['res://main.gd:5: warning [structure/unknown-group] Group "players" is never assigned to a node in a scene or with add_to_group().']);
  });

  it("does not give a value the type of a literal it only starts with", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.gd": [
        "extends Node",
        "",
        "func _ready() -> void:",
        '\tvar parts := "a,b".split(",")',
        "\tprint(parts.size())",
        '\tvar keys := {"a": 1}.keys()',
        "\tprint(keys.append(2))",
        '\tvar same := "a" == "b"',
        "\tprint(same)",
        '\tvar text := "abc"',
        "\tprint(text.nope_method())",
        "",
      ].join("\n"),
    });
    const api = reviewProject(root).findings.filter((f) => f.category === "api").map(formatFinding);
    expect(api).toEqual(['res://main.gd:11: error [api/unknown-member] Method "nope_method()" does not exist on String in Godot 4.7.']);
  });

  it("checks signals declared in inner classes for emission", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.gd": [
        "extends Node",
        "",
        "class Inner:",
        "\tsignal never_emitted",
        "\tsignal done",
        "",
        "\tfunc run() -> void:",
        "\t\tdone.emit()",
        "",
        "",
        "func _ready() -> void:",
        "\tpass",
        "",
      ].join("\n"),
    });
    const unused = reviewProject(root).findings.filter((f) => f.rule === "quality/unused-signal").map(formatFinding);
    expect(unused).toEqual(['res://main.gd:4: warning [quality/unused-signal] Signal "never_emitted" is declared but never emitted.']);
  });

  it("gives string-signal advice only where the suggested code compiles", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.gd": [
        "extends Node",
        "",
        "signal declared",
        "",
        "func _ready() -> void:",
        '\tcall_deferred(Callable(self, "_tick"))',
        '\temit_signal("ghost")',
        '\temit_signal("declared")',
        '\tdeclared.connect(Callable(self, "_tick"))',
        "",
        "",
        "func _tick() -> void:",
        "\tpass",
        "",
      ].join("\n"),
    });
    const advice = reviewProject(root).findings.filter((f) => f.rule === "quality/string-signal").map(formatFinding);
    expect(advice).toEqual([
      'res://main.gd:8: info [quality/string-signal] emit_signal("declared") can be declared.emit().',
      "res://main.gd:9: info [quality/string-signal] Connect with the signal object and a method reference: my_signal.connect(_on_event).",
    ]);
  });

  it("reports a file that does not parse with the syntax fix, not the missing-file one", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.tscn": '[gd_scene load_steps=2 format=3]\n[node name="Main" type="Node2D"\n',
    });
    const report = reviewProject(root);
    const parse = report.findings.filter((f) => f.rule === "structure/parse-error");
    expect(parse.map((f) => f.file)).toEqual(["res://main.tscn"]);
    expect(report.findings.some((f) => f.message.includes("could not parse file"))).toBe(true);
    expect(report.findings.filter((f) => f.rule === "structure/broken-reference").some((f) => f.file === "res://main.tscn")).toBe(false);
    expect(formatReview(report, "full")).toContain("fix: Fix the syntax error at the line shown");
  });

  it("does not count a property with only a setter as statically typed", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "speed.gd": "extends Node\n\nvar speed: set = _set_speed\nvar count := 0\n\n\nfunc _set_speed(value) -> void:\n\tspeed = value\n",
    });
    // Declarations: speed (untyped), count (inferred), value (untyped), the return type of _set_speed (typed).
    expect(reviewProject(root).typing).toEqual({ typed: 2, total: 4, percent: 50 });
  });

  it("does not call a script or group unused or unassigned when a scene does not parse", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      ".gitignore": ".godot/\n",
      "broken.tscn": '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://enemy.gd" id="1"]\n[node name="Root" type="Node2D" groups=["players"]]\nscript = ExtResource("1")\n[node name="Broken" type="Node2D" parent="."\n',
      "enemy.gd": "extends Node2D\n\nfunc _ready() -> void:\n\tpass\n",
      "main.gd": 'extends Node\n\nfunc _ready() -> void:\n\tget_tree().get_nodes_in_group("players")\n',
    });
    const structure = reviewProject(root).findings.filter((f) => f.category === "structure").map(formatFinding);
    expect(structure.filter((l) => l.includes("could not parse file"))).toHaveLength(1);
    expect(structure.some((l) => l.includes("enemy.gd") && l.includes("structure/unused-script"))).toBe(false);
    expect(structure.some((l) => l.includes("structure/unknown-group"))).toBe(false);
  });
});
