import { describe, expect, it } from "vitest";
import { join } from "node:path";
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

/** Findings of one rule, formatted, for a throwaway project. */
function ruleLines(files: Record<string, string>, rule: string): string[] {
  return reviewProject(makeProject(files)).findings.filter((f) => f.rule === rule).map(formatFinding);
}

describe("rules that had no test", () => {
  it("performance/empty-callback: a per-frame function with only pass", () => {
    expect(ruleLines({ "project.godot": PROJECT, "main.gd": "extends Node\n\nfunc _process(_delta: float) -> void:\n\tpass\n" }, "performance/empty-callback")).toEqual([
      "res://main.gd:3: info [performance/empty-callback] _process() is empty; Godot still calls it every frame.",
    ]);
  });

  it("performance/instantiate-per-frame: a scene instantiated every frame", () => {
    const script = "extends Node\n\nvar _scene: PackedScene\n\n\nfunc _process(_delta: float) -> void:\n\t_scene.instantiate()\n";
    expect(ruleLines({ "project.godot": PROJECT, "main.gd": script }, "performance/instantiate-per-frame")).toEqual([
      "res://main.gd:7: info [performance/instantiate-per-frame] instantiate() in _process() can run every frame; spawn on events or use a pool.",
    ]);
  });

  it("performance/huge-scene: more than 1500 nodes in one scene", () => {
    const scene = ['[gd_scene format=3]', '[node name="Root" type="Node"]'];
    for (let i = 0; i < 1500; i++) scene.push(`[node name="N${i}" type="Node" parent="."]`);
    expect(ruleLines({ "project.godot": PROJECT, "main.tscn": scene.join("\n") + "\n" }, "performance/huge-scene")).toEqual([
      "res://main.tscn: info [performance/huge-scene] 1501 nodes in one scene.",
    ]);
  });

  it("performance/many-shadow-lights: a seventh light that casts shadows", () => {
    const scene = ['[gd_scene format=3]', '[node name="Root" type="Node3D"]'];
    for (let i = 1; i <= 7; i++) scene.push(`[node name="Light${i}" type="OmniLight3D" parent="."]`, "shadow_enabled = true");
    const seventh = scene.findIndex((line) => line.includes('name="Light7"')) + 1;
    expect(ruleLines({ "project.godot": PROJECT, "main.tscn": scene.join("\n") + "\n" }, "performance/many-shadow-lights")).toEqual([
      `res://main.tscn:${seventh}: warning [performance/many-shadow-lights] 7 lights cast shadows in this scene; each one costs a shadow pass.`,
    ]);
  });

  it("quality/deep-nesting: a statement seven levels deep", () => {
    const script = [
      "extends Node",
      "",
      "func f(x: int) -> void:",
      "\tif x > 0:",
      "\t\tif x > 1:",
      "\t\t\tif x > 2:",
      "\t\t\t\tif x > 3:",
      "\t\t\t\t\tif x > 4:",
      "\t\t\t\t\t\tif x > 5:",
      "\t\t\t\t\t\t\tpass",
      "",
    ].join("\n");
    expect(ruleLines({ "project.godot": PROJECT, "main.gd": script }, "quality/deep-nesting")).toEqual([
      "res://main.gd:10: info [quality/deep-nesting] f() nests 7 levels deep.",
    ]);
  });

  it("quality/fragile-path: a node path that climbs two levels", () => {
    const script = 'extends Node\n\nfunc _ready() -> void:\n\tvar player := get_node("../../Player")\n\tprint(player)\n';
    expect(ruleLines({ "project.godot": PROJECT, "main.gd": script }, "quality/fragile-path")).toEqual([
      'res://main.gd:4: info [quality/fragile-path] Node path "../../Player" climbs 2 levels up the tree.',
    ]);
  });

  it("quality/long-file: a script of more than 600 lines", () => {
    const source = ["extends Node", ...Array.from({ length: 600 }, (_, i) => `# line ${i}`), ""].join("\n");
    expect(ruleLines({ "project.godot": PROJECT, "main.gd": source }, "quality/long-file")).toEqual([
      `res://main.gd: info [quality/long-file] ${source.split("\n").length} lines; consider splitting this script.`,
    ]);
  });

  it("quality/long-function: a function with 61 statements", () => {
    const script = ["extends Node", "", "func build() -> void:", ...Array.from({ length: 61 }, (_, i) => `\tprint(${i})`), ""].join("\n");
    expect(ruleLines({ "project.godot": PROJECT, "main.gd": script }, "quality/long-function")).toEqual([
      "res://main.gd:3: info [quality/long-function] build() has 61 statements; aim for under 60.",
    ]);
  });

  it("structure/deep-tree: a node 13 levels below the root", () => {
    const scene = ['[gd_scene format=3]', '[node name="Root" type="Node"]'];
    let parent = ".";
    for (let i = 1; i <= 13; i++) {
      const name = `N${i}`;
      scene.push(`[node name="${name}" type="Node" parent="${parent}"]`);
      parent = parent === "." ? name : `${parent}/${name}`;
    }
    expect(ruleLines({ "project.godot": PROJECT, "main.tscn": scene.join("\n") + "\n" }, "structure/deep-tree")).toEqual([
      "res://main.tscn: info [structure/deep-tree] Node tree is 13 levels deep.",
    ]);
  });

  it("structure/engine-version: a project last saved with Godot 4.6", () => {
    expect(ruleLines({ "project.godot": PROJECT.replace('"4.7"', '"4.6"') }, "structure/engine-version")).toEqual([
      "res://project.godot: info [structure/engine-version] The project was last saved with Godot 4.6; Godotwright targets 4.7. Upgrade findings cover 4.6 to 4.7; once the project is saved in 4.7, review with from 4.6 to keep them.",
    ]);
  });

  it("structure/many-autoloads: eleven autoloads", () => {
    const autoloads = Array.from({ length: 11 }, (_, i) => `Auto${i}="*res://auto${i}.gd"`);
    const files: Record<string, string> = { "project.godot": `${PROJECT}\n[autoload]\n\n${autoloads.join("\n")}\n` };
    for (let i = 0; i < 11; i++) files[`auto${i}.gd`] = "extends Node\n";
    expect(ruleLines(files, "structure/many-autoloads")).toEqual(["res://project.godot: info [structure/many-autoloads] 11 autoloads."]);
  });

  it("structure/no-gitignore: a project without a .gitignore for .godot/", () => {
    expect(ruleLines({ "project.godot": PROJECT }, "structure/no-gitignore")).toEqual([
      "res://.gitignore: info [structure/no-gitignore] No .gitignore here or above ignores .godot/.",
    ]);
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

  it("does not take a longer file name that ends the same way as a use of a script", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "scripts/enemy.gd": "extends Node\n\nfunc _ready() -> void:\n\tpass\n",
      "scripts/old_enemy.gd": "extends Node\n\nfunc _ready() -> void:\n\tpass\n",
      "main.gd": 'extends Node\n\nconst OLD = preload("res://scripts/old_enemy.gd")\n\nfunc _ready() -> void:\n\tpass\n',
    });
    const unused = reviewProject(root).findings.filter((f) => f.rule === "structure/unused-script").map((f) => f.file);
    expect(unused).toEqual(["res://main.gd", "res://scripts/enemy.gd"]);
  });

  it("reports TODO markers in comments only, not inside string literals", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.gd": [
        "extends Node",
        "",
        'var label := "# TODO: not a comment"',
        'var doc := """',
        "# TODO: inside a triple-quoted string",
        '"""',
        "",
        "",
        "func _ready() -> void:",
        "\t# TODO: real comment",
        "\tprint(label, doc, '#FIXME: single-quoted string')",
        "",
      ].join("\n"),
    });
    const todo = reviewProject(root).findings.filter((f) => f.rule === "quality/todo").map(formatFinding);
    expect(todo).toEqual(["res://main.gd:10: info [quality/todo] TODO: real comment"]);
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

describe("fixes from watching small models work", () => {
  it("does not call unit test scripts unused: the test runner loads them", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "test/test_hero.gd": "extends GutTest\n\nfunc test_a() -> void:\n\tpass\n",
      "tests/unit/player_test.gd": "extends GdUnitTestSuite\n\nfunc test_b() -> void:\n\tpass\n",
      "test/helpers/test_tools.gd": 'extends "res://addons/gut/test.gd"\n',
      "scripts/spare.gd": "extends Node\n",
    });
    const unused = reviewProject(root).findings.filter((f) => f.rule === "structure/unused-script").map((f) => f.file);
    expect(unused).toEqual(["res://scripts/spare.gd"]);
  });

  it("counts only the project's own scenes, like the scripts", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node"]\n',
      "addons/tool/panel.tscn": '[gd_scene format=3]\n\n[node name="Panel" type="Control"]\n',
    });
    expect(reviewProject(root).scenes).toBe(1);
    expect(reviewProject(root, { includeAddons: true }).scenes).toBe(2);
  });

  it("shows only the findings of the files you name, with the project's scores", async () => {
    const root = makeProject({
      "project.godot": PROJECT,
      ".gitignore": ".godot/\n",
      "a.gd": "extends Node\n\nfunc f() -> void:\n\tvar x = Vector2.ZERO.lenght()\n",
      "b.gd": "extends Node\n\nfunc g() -> void:\n\tvar y = Vector2.ZERO.lenght()\n",
    });
    const one = await runCli(["review", `${root}/a.gd`]);
    expect(one.output).toContain("findings shown only for: res://a.gd (scores are for the whole project)");
    expect(one.output).toContain("res://a.gd:4");
    expect(one.output).not.toContain("res://b.gd:4");
    const both = await runCli(["review", `${root}/a.gd`, `${root}/b.gd`]);
    expect(both.output).toContain("res://b.gd:4");
    process.exitCode = undefined;
  });
});

describe("quality/time-scale-not-restored", () => {
  const scene = '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n';
  const run = (body: string) =>
    findings({ "main.tscn": scene, "main.gd": `extends Node\n\n\n${body}` }).filter((f) => f.includes("time-scale"));

  it("warns when slow motion is started and never undone", () => {
    expect(run("func hit() -> void:\n\tEngine.time_scale = 0.3\n")).toEqual([
      "res://main.gd:5: warning [quality/time-scale-not-restored] Engine.time_scale is changed here but never set back to 1.0 in this script, so the whole game stays slow (or fast); restore it when the effect ends and in _exit_tree().",
    ]);
    expect(run("func hit() -> void:\n\tEngine.time_scale *= 0.5\n")).toHaveLength(1);
  });

  it("is quiet when the script sets it back, only reads it, or mentions it in a comment or string", () => {
    expect(run("func hit() -> void:\n\tEngine.time_scale = 0.3\n\n\nfunc _exit_tree() -> void:\n\tEngine.time_scale = 1.0\n")).toEqual([]);
    expect(run("func hit() -> void:\n\tEngine.time_scale = 0.3\n\tawait get_tree().create_timer(0.2, true, false, true).timeout\n\tEngine.time_scale = 1\n")).toEqual([]);
    expect(run("func step(delta: float) -> float:\n\treturn delta / Engine.time_scale if Engine.time_scale > 0.001 else delta\n")).toEqual([]);
    expect(run('func hit() -> void:\n\t# Engine.time_scale = 0.3\n\tprint("Engine.time_scale = 0.3")\n')).toEqual([]);
    expect(run("func paused() -> bool:\n\treturn Engine.time_scale == 0.0\n")).toEqual([]);
  });
});

describe("quality/json-parse-unchecked", () => {
  const scene = '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n';
  const run = (body: string) =>
    findings({ "main.tscn": scene, "main.gd": `extends Node\n\n\n${body}` }).filter((f) => f.includes("json-parse"));

  it("warns when the parsed result is used without a check", () => {
    expect(run('func load_it(text: String) -> int:\n\tvar data = JSON.parse_string(text)\n\treturn data.get("n", 0)\n')).toEqual([
      'res://main.gd:5: warning [quality/json-parse-unchecked] "data" comes from JSON.parse_string() and is used on line 6 without a check; it is null when the text is not valid JSON, so check it with `is Dictionary` (or `is Array`) first.',
    ]);
    expect(run('func load_it(text: String) -> int:\n\treturn JSON.parse_string(text)["n"]\n')).toHaveLength(1);
    expect(run('func load_it(text: String) -> int:\n\treturn JSON.parse_string(text.strip_edges()).get("n", 0)\n')).toHaveLength(1);
    expect(run("func load_it(text: String) -> int:\n\tvar data: int = JSON.parse_string(text)\n\treturn data\n")[0]).toContain("null cannot be stored in a int");
    // A typed Array or Dictionary is api/parse-into-typed's finding, so this rule stays quiet there: one report per line.
    const typed = findings({ "main.tscn": scene, "main.gd": "extends Node\n\n\nfunc load_it(text: String) -> int:\n\tvar data: Dictionary = JSON.parse_string(text)\n\treturn data.size()\n" });
    expect(typed.filter((f) => f.includes("json-parse") || f.includes("parse-into-typed"))).toEqual([expect.stringContaining("[api/parse-into-typed]")]);
    expect(run("func load_it(text: String) -> int:\n\tvar rows := 0\n\tvar list = JSON.parse_string(text)\n\tfor r in list:\n\t\trows += 1\n\treturn rows\n")).toHaveLength(1);
  });

  it("is quiet when the result is checked, untouched, reassigned or only in a string", () => {
    expect(run('func load_it(text: String) -> int:\n\tvar data = JSON.parse_string(text)\n\tif not data is Dictionary:\n\t\treturn 0\n\treturn data.get("n", 0)\n')).toEqual([]);
    expect(run('func load_it(text: String) -> int:\n\tvar data: Variant = JSON.parse_string(text)\n\tif data == null:\n\t\treturn 0\n\treturn data.get("n", 0)\n')).toEqual([]);
    expect(run("func load_it(text: String) -> Variant:\n\tvar data = JSON.parse_string(text)\n\treturn data\n")).toEqual([]);
    expect(run("func load_it(text: String) -> int:\n\tvar data = JSON.parse_string(text)\n\tif data is Array:\n\t\treturn data.size()\n\treturn 0\n")).toEqual([]);
    expect(run("func load_it(text: String) -> int:\n\tvar data = JSON.parse_string(text)\n\tdata = {}\n\treturn data.size()\n")).toEqual([]);
    expect(run('func describe() -> String:\n\treturn "JSON.parse_string(text).get(1)"\n')).toEqual([]);
    expect(run("func load_it(text: String) -> int:\n\tvar json := JSON.new()\n\tif json.parse(text) != OK:\n\t\treturn 0\n\treturn json.data.size()\n")).toEqual([]);
  });
});

describe("api/physics-change-in-callback and api/bind-swaps-arguments", () => {
  const coin = '[gd_scene format=3]\n\n[sub_resource type="CircleShape2D" id="1"]\n\n[node name="Coin" type="Area2D"]\n\n[node name="Shape" type="CollisionShape2D" parent="."]\nshape = SubResource("1")\n';
  const label = '[gd_scene format=3]\n\n[node name="Label" type="Label"]\n';
  const main = '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Area2D"]\nscript = ExtResource("1")\n';
  const run = (body: string) =>
    findings({ "main.tscn": main, "coin.tscn": coin, "label.tscn": label, "main.gd": `extends Area2D\n\nconst COIN: PackedScene = preload("res://coin.tscn")\nconst LABEL: PackedScene = preload("res://label.tscn")\n\n\nfunc _ready() -> void:\n\tbody_entered.connect(_drop)\n\n\n${body}` }).filter(
      (f) => f.includes("physics-change") || f.includes("bind-swaps"),
    );

  it("warns when a handler adds a physics object or changes monitoring or disabled directly", () => {
    expect(run("func _drop(_body: Node2D) -> void:\n\tvar coin: Node2D = COIN.instantiate()\n\tget_parent().add_child(coin)\n")).toEqual([
      "res://main.gd:13: warning [api/physics-change-in-callback] _drop() runs while Godot reports overlaps, and adding a physics object then fails (\"Can't change this state while flushing queries\"). Use add_child.call_deferred(...).",
    ]);
    expect(run("func _drop(_body: Node2D) -> void:\n\tadd_child(Area2D.new())\n")).toHaveLength(1);
    expect(run("func _drop(_body: Node2D) -> void:\n\tmonitoring = false\n")[0]).toContain('set_deferred("monitoring", ...)');
    expect(run("func _drop(_body: Node2D) -> void:\n\t$Shape.disabled = true\n")).toHaveLength(1);
    expect(run("func _on_hitbox_area_entered(_area: Area2D) -> void:\n\tadd_child(COIN.instantiate())\n")).toHaveLength(1);
  });

  it("is quiet for deferred calls, nodes without physics, comparisons and other functions", () => {
    expect(run("func _drop(_body: Node2D) -> void:\n\tget_parent().add_child.call_deferred(COIN.instantiate())\n\tset_deferred(\"monitoring\", false)\n")).toEqual([]);
    expect(run("func _drop(_body: Node2D) -> void:\n\tadd_child(LABEL.instantiate())\n\tadd_child(Node2D.new())\n")).toEqual([]);
    expect(run("func _drop(_body: Node2D) -> void:\n\tif monitoring == false:\n\t\treturn\n")).toEqual([]);
    expect(run("func _drop(_body: Node2D) -> void:\n\tpass\n\n\nfunc spawn() -> void:\n\tadd_child(COIN.instantiate())\n\tmonitoring = false\n")).toEqual([]);
  });

  it("flags bind() of a name-first setter in tween_method, and not other tweens", () => {
    const flagged = run('func _drop(_body: Node2D) -> void:\n\tpass\n\n\nfunc flash(m: ShaderMaterial) -> void:\n\tcreate_tween().tween_method(m.set_shader_parameter.bind("amount"), 1.0, 0.0, 0.2)\n');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain('error [api/bind-swaps-arguments]');
    expect(flagged[0]).toContain('"shader_parameter/amount"');
    expect(run('func _drop(_body: Node2D) -> void:\n\tpass\n\n\nfunc flash(m: ShaderMaterial) -> void:\n\tcreate_tween().tween_property(m, "shader_parameter/amount", 0.0, 0.2)\n\tcreate_tween().tween_method(_set_amount.bind(m), 1.0, 0.0, 0.2)\n\n\nfunc _set_amount(v: float, m: ShaderMaterial) -> void:\n\tm.set_shader_parameter("amount", v)\n')).toEqual([]);
  });
});

describe("members older Godot 4 releases had", () => {
  const scene = '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n';
  const all = (body: string) => {
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": scene, "main.gd": `extends Node2D\n\n\n${body}` });
    return reviewProject(root).findings.filter((f) => f.rule === "api/unsafe-member").map(formatFinding);
  };

  it("says when Godot removed a member, and calls an old name that still works an info, not a warning", () => {
    const found = all("func setup(follow: PathFollow2D, agent: NavigationAgent2D) -> void:\n\tfollow.lookahead = 4.0\n\tagent.time_horizon = 2.0\n");
    expect(found[0]).toContain('warning [api/unsafe-member] "lookahead" is not a member of PathFollow2D');
    expect(found[0]).toContain("It was removed after Godot 4.0.");
    expect(found[1]).toContain('info [api/unsafe-member] "time_horizon" on NavigationAgent2D is an old name: Godot 4.0 documented it, and Godot 4.7 still accepts it only so old projects load.');
    expect(found[1]).toContain("time_horizon_agents");
  });

  it("adds nothing to a plain typo", () => {
    const found = all("func setup(follow: PathFollow2D) -> void:\n\tfollow.progres = 4.0\n");
    expect(found[0]).not.toContain("removed after");
    expect(found[0]).not.toContain("old name");
  });
});

describe("api/open-compressed-gzip and quality/visibility-margin-hysteresis", () => {
  const scene = '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node3D"]\nscript = ExtResource("1")\n';
  const run = (body: string, key: string) =>
    findings({ "main.tscn": scene, "main.gd": `extends Node3D\n\n\n${body}` }).filter((f) => f.includes(key));

  it("flags a plain .gz file read with open_compressed()", () => {
    expect(run('func load_h() -> void:\n\tvar f := FileAccess.open_compressed("res://data/h.bin.gz", FileAccess.READ, FileAccess.COMPRESSION_GZIP)\n\tprint(f)\n', "open-compressed")).toEqual([
      "res://main.gd:5: error [api/open-compressed-gzip] open_compressed() only reads files Godot wrote with open_compressed(); a plain .gz file opens as null. Use FileAccess.get_file_as_bytes(path).decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP).",
    ]);
    expect(run('const ROOT := "res://d/"\n\n\nfunc load_h() -> void:\n\tvar f := FileAccess.open_compressed(ROOT + "h.bin.gz", FileAccess.READ)\n\tprint(f)\n', "open-compressed")).toHaveLength(1);
  });

  it("is quiet for Godot's own compressed files, for writing, and for get_file_as_bytes", () => {
    expect(run('func save() -> void:\n\tvar f := FileAccess.open_compressed("user://save.dat", FileAccess.READ, FileAccess.COMPRESSION_ZSTD)\n\tprint(f)\n', "open-compressed")).toEqual([]);
    expect(run('func save() -> void:\n\tvar f := FileAccess.open_compressed("user://save.gz", FileAccess.WRITE, FileAccess.COMPRESSION_GZIP)\n\tprint(f)\n', "open-compressed")).toEqual([]);
    expect(run('func load_h() -> PackedByteArray:\n\treturn FileAccess.get_file_as_bytes("res://h.bin.gz").decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP)\n', "open-compressed")).toEqual([]);
    expect(run('func f() -> void:\n\t# FileAccess.open_compressed("res://h.gz", FileAccess.READ)\n\tprint("open_compressed(\\"x.gz\\")")\n', "open-compressed")).toEqual([]);
  });

  it("flags LOD margins without a fade mode", () => {
    expect(run("func lod(mi: MeshInstance3D) -> void:\n\tmi.visibility_range_end = 700.0\n\tmi.visibility_range_end_margin = 30.0\n", "visibility-margin")).toEqual([
      "res://main.gd:6: warning [quality/visibility-margin-hysteresis] Without visibility_range_fade_mode the margin is hysteresis: a level only switches once the camera is past the threshold by the margin, so at a LOD boundary both levels can stay hidden. Set a fade mode, or use margin 0.",
    ]);
  });

  it("is quiet with a fade mode or a zero margin", () => {
    expect(run("func lod(mi: MeshInstance3D) -> void:\n\tmi.visibility_range_end_margin = 30.0\n\tmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF\n", "visibility-margin")).toEqual([]);
    expect(run("func lod(mi: MeshInstance3D) -> void:\n\tmi.visibility_range_end = 700.0\n\tmi.visibility_range_end_margin = 0.0\n", "visibility-margin")).toEqual([]);
  });
});

describe("runtime pitfalls from real projects", () => {
  const run = (code: string, rule: string) => {
    const root = makeProject({ "project.godot": PROJECT, "a.gd": code });
    return reviewProject(root).findings.filter((f) => f.rule === rule && f.file === "res://a.gd").map((f) => f.line);
  };

  it("api/coroutine-without-await: a coroutine's result used without await", () => {
    const code =
      "extends Node\n\n\nfunc build() -> int:\n\tawait get_tree().process_frame\n\treturn 1\n\n\nfunc a() -> void:\n\tvar n: int = build()\n\tprint(n)\n\n\nfunc b() -> void:\n\tbuild()\n\tvar m: int = await build()\n\tif m > 0: build()\n\tget_tree().process_frame.connect(func() -> void: print(m); build())\n\tprint(m)\n";
    expect(run(code, "api/coroutine-without-await")).toEqual([10]);
    // An await inside a lambda does not make the function around it a coroutine.
    expect(run("extends Node\n\n\nfunc f() -> int:\n\tvar cb := func() -> void:\n\t\tawait get_tree().process_frame\n\tcb.call()\n\treturn 1\n\n\nfunc g() -> void:\n\tprint(f())\n", "api/coroutine-without-await")).toEqual([]);
  });

  it("api/timer-start-outside-tree: start() before add_child()", () => {
    expect(run("extends Node\n\n\nfunc _ready() -> void:\n\tvar t := Timer.new()\n\tt.start(1.0)\n\tadd_child(t)\n", "api/timer-start-outside-tree")).toEqual([6]);
    expect(run("extends Node\n\n\nfunc _ready() -> void:\n\tvar t := Timer.new()\n\tadd_child(t)\n\tt.start(1.0)\n", "api/timer-start-outside-tree")).toEqual([]);
  });

  it("api/multimesh-format-after-count: format set after instance_count", () => {
    const bad = "extends Node\n\n\nfunc _ready() -> void:\n\tvar mm := MultiMesh.new()\n\tmm.instance_count = 100\n\tmm.use_custom_data = true\n";
    expect(run(bad, "api/multimesh-format-after-count")).toEqual([7]);
    expect(run(bad.replace("mm.instance_count = 100\n\tmm.use_custom_data = true", "mm.use_custom_data = true\n\tmm.instance_count = 100"), "api/multimesh-format-after-count")).toEqual([]);
    expect(run(bad.replace("= 100", "= 0"), "api/multimesh-format-after-count")).toEqual([]);
  });

  it("api/viewport-world-borrowed: world_3d copied from another viewport", () => {
    expect(run("extends SubViewport\n\n@export var target: Node3D\n\n\nfunc _ready() -> void:\n\tworld_3d = target.get_viewport().world_3d\n", "api/viewport-world-borrowed")).toEqual([7]);
    expect(run("extends SubViewport\n\n@export var target: Node3D\n\n\nfunc _ready() -> void:\n\tworld_3d = target.get_viewport().find_world_3d()\n", "api/viewport-world-borrowed")).toEqual([]);
    // Every viewport has a World2D of its own: sharing it is the split-screen idiom.
    expect(run("extends Node\n\n\nfunc _ready() -> void:\n\tvar a := SubViewport.new()\n\tvar b := SubViewport.new()\n\tb.world_2d = a.world_2d\n", "api/viewport-world-borrowed")).toEqual([]);
  });

  it("api/debug-only-monitor: orphan nodes read without a debug check", () => {
    const code = "extends Node\n\n\nfunc report() -> void:\n\tprint(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))\n";
    expect(run(code, "api/debug-only-monitor")).toEqual([5]);
    expect(run(code.replace("\tprint(", "\tif OS.is_debug_build(): print("), "api/debug-only-monitor")).toEqual([]);
    expect(run(code.replace("OBJECT_ORPHAN_NODE_COUNT", "TIME_FPS"), "api/debug-only-monitor")).toEqual([]);
  });

  it("quality/time-modulo-window: a time modulo as a periodic trigger", () => {
    const code = "extends Node\n\nvar t: float = 0.0\n\n\nfunc _process(delta: float) -> void:\n\tt += delta\n\tif int(t * 2.0) % 10 == 0:\n\t\tprint(t)\n\tif Engine.get_process_frames() % 10 == 0:\n\t\tprint(t)\n";
    expect(run(code, "quality/time-modulo-window")).toEqual([8]);
  });

  it("quality/standalone-ternary: a ternary used as a statement", () => {
    const code = "extends Node\n\n\nfunc a() -> void:\n\tpass\n\n\nfunc b() -> void:\n\tpass\n\n\nfunc c(x: bool) -> void:\n\ta() if x else b()\n\tvar y: int = 1 if x else 2\n\tprint(y if x else 0)\n";
    expect(run(code, "quality/standalone-ternary")).toEqual([13]);
    expect(run("extends Node\n\nvar n: int = 0\n\n\nfunc c(x: bool) -> void:\n\tn += 1 if x else 0\n", "quality/standalone-ternary")).toEqual([]);
  });

  it("quality/find-children-unowned: find_children() in a script that adds nodes", () => {
    const code = 'extends Node\n\n\nfunc _ready() -> void:\n\tadd_child(Node3D.new())\n\tprint(find_children("*", "Node3D"))\n';
    expect(run(code, "quality/find-children-unowned")).toEqual([6]);
    expect(run(code.replace('"Node3D")', '"Camera3D")'), "quality/find-children-unowned")).toEqual([]);
    expect(run(code.replace('"Node3D")', '"Node3D", true, false)'), "quality/find-children-unowned")).toEqual([]);
    expect(run('extends Node\n\n\nfunc _ready() -> void:\n\tprint(find_children("*"))\n', "quality/find-children-unowned")).toEqual([]);
  });

  it("quality/worker-task-not-waited: a task nobody waits for", () => {
    const code = "extends Node\n\n\nfunc _ready() -> void:\n\tWorkerThreadPool.add_task(func() -> void: pass)\n";
    expect(run(code, "quality/worker-task-not-waited")).toEqual([5]);
    expect(run(code.replace("\tWorkerThreadPool.add_task(func() -> void: pass)", "\tvar id := WorkerThreadPool.add_task(func() -> void: pass)\n\tWorkerThreadPool.wait_for_task_completion(id)"), "quality/worker-task-not-waited")).toEqual([]);
  });

  it("performance/subviewport-always: UPDATE_ALWAYS that is never switched off", () => {
    const code = "extends SubViewport\n\n\nfunc _ready() -> void:\n\trender_target_update_mode = SubViewport.UPDATE_ALWAYS\n";
    expect(run(code, "performance/subviewport-always")).toEqual([5]);
    expect(run(`${code}\n\nfunc hide_screen() -> void:\n\trender_target_update_mode = SubViewport.UPDATE_DISABLED\n`, "performance/subviewport-always")).toEqual([]);
    // A capture tool renders on purpose.
    expect(run("extends SceneTree\n\n\nfunc _initialize() -> void:\n\tvar v := SubViewport.new()\n\tv.render_target_update_mode = SubViewport.UPDATE_ALWAYS\n\troot.add_child(v)\n", "performance/subviewport-always")).toEqual([]);
  });
});

describe("coroutines in lambdas over several lines", () => {
  it("leave a coroutine call alone that may be a statement of the lambda", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "a.gd": 'extends SceneTree\n\n\nfunc finish() -> void:\n\tawait process_frame\n\tquit()\n\n\nfunc _initialize() -> void:\n\tcreate_timer(5.0).timeout.connect(func() -> void:\n\t\tprint("late")\n\t\tfinish()\n\t)\n',
    });
    expect(reviewProject(root).findings.filter((f) => f.rule === "api/coroutine-without-await")).toEqual([]);
  });
});

describe("runtime pitfalls stay quiet on idioms from a real project", () => {
  const run = (code: string, rule: string) => {
    const root = makeProject({ "project.godot": PROJECT, "a.gd": code });
    return reviewProject(root).findings.filter((f) => f.rule === rule && f.file === "res://a.gd").map((f) => f.line);
  };

  it("a match branch that returns a ternary is not a lone ternary, but one that only calls is", () => {
    const code = 'extends Node\n\n\nfunc a() -> void:\n\tpass\n\n\nfunc b() -> void:\n\tpass\n\n\nfunc value(key: String, on: bool) -> float:\n\tmatch key:\n\t\t"rpm": return 100.0 if on else 0.0\n\t\t"draw": a() if on else b()\n\treturn 0.0\n';
    expect(run(code, "quality/standalone-ternary")).toEqual([15]);
  });

  it("a blink value is not a periodic trigger", () => {
    const code = "extends Node\n\nvar t: float = 0.0\n\n\nfunc _process(delta: float) -> void:\n\tt += delta\n\tvar flash := int(t * 6.0) % 2 == 0\n\tif int(t * 6.0) % 2 == 0:\n\t\tprint(flash)\n";
    expect(run(code, "quality/time-modulo-window")).toEqual([]);
  });

  it("a MultiMesh made anew in each pass of a loop starts at instance_count 0", () => {
    const code = "extends Node\n\n\nfunc build() -> void:\n\tfor k in 3:\n\t\tvar mm := MultiMesh.new()\n\t\tmm.transform_format = MultiMesh.TRANSFORM_3D\n\t\tmm.use_colors = true\n\t\tmm.instance_count = 10\n";
    expect(run(code, "api/multimesh-format-after-count")).toEqual([]);
  });
});

describe("a focused review", () => {
  it("gives exactly the findings of the full review for the focused files", () => {
    const full = reviewProject(join(FIXTURES, "messy"));
    const files = [...new Set(full.findings.map((f) => f.file.replace(/::.*$/, "")))];
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const part = reviewProject(join(FIXTURES, "messy"), { focus: [file] });
      const key = (f: { rule: string; file: string; line?: number; message: string }) => `${f.rule}|${f.file}|${f.line}|${f.message}`;
      expect(part.findings.map(key).sort()).toEqual(full.findings.filter((f) => f.file.replace(/::.*$/, "") === file).map(key).sort());
    }
  });
});

describe("signal connections saved in scenes", () => {
  it("structure/connection-arguments: a method that cannot take what the signal passes", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "main.tscn":
        '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n\n[node name="Timer" type="Timer" parent="."]\n\n[node name="Button" type="Button" parent="."]\n\n[connection signal="timeout" from="Timer" to="." method="_on_timeout"]\n[connection signal="toggled" from="Button" to="." method="_on_toggled" binds=[7]]\n[connection signal="pressed" from="Button" to="." method="_on_pressed" flags=16]\n[connection signal="toggled" from="Button" to="." method="_on_any" unbinds=1]\n',
      "main.gd":
        "extends Node\n\n\nfunc _on_timeout(which: int) -> void:\n\tprint(which)\n\n\nfunc _on_toggled(on: bool, extra: int) -> void:\n\tprint(on, extra)\n\n\nfunc _on_pressed(source: Node) -> void:\n\tprint(source)\n\n\nfunc _on_any() -> void:\n\tpass\n",
    });
    const found = reviewProject(root).findings.filter((f) => f.rule === "structure/connection-arguments");
    expect(found.map((f) => f.line)).toEqual([12]);
    expect(found[0]!.message).toContain('"Method expected 1 argument(s), but called with 0"');
  });
});

describe("scene and resource integrity", () => {
  const report = reviewProject(`${FIXTURES}/uid-integrity`);
  const lines = report.findings.map(formatFinding);
  const rule = (id: string) => lines.filter((l) => l.includes(`[${id}]`));

  it("structure/duplicate-uid: a copied scene keeps the uid of its original", () => {
    expect(rule("structure/duplicate-uid")).toEqual([
      expect.stringMatching(/^res:\/\/child\.tscn:1: error .* uid:\/\/bkq3oe5w8x1y2 \(header\) is also the uid of res:\/\/dup\.tscn/),
      expect.stringMatching(/^res:\/\/dup\.tscn:1: error .* is also the uid of res:\/\/child\.tscn/),
    ]);
  });

  it("structure/invalid-uid, unknown-uid and uid-path-mismatch", () => {
    expect(rule("structure/invalid-uid")).toEqual([expect.stringMatching(/^res:\/\/bad\.tres:1: warning .*"uid:\/\/Not-A-Uid" \(header\) is not a uid Godot can read/)]);
    expect(rule("structure/unknown-uid")).toEqual([
      expect.stringMatching(/^res:\/\/main\.tscn:3: warning .*no file has uid:\/\/bstale0000001, so Godot warns on every load/),
      expect.stringMatching(/^res:\/\/main\.tscn:7: warning .*uid:\/\/blost0000001/),
    ]);
    expect(rule("structure/uid-path-mismatch")).toEqual([
      expect.stringMatching(/^res:\/\/main\.tscn:4: error .*uid:\/\/d1fq0i6v1abqx is the uid of res:\/\/leaf\.tscn, but the path says res:\/\/other\.tscn\. Godot loads res:\/\/leaf\.tscn/),
    ]);
  });

  it("resource ids: missing, used before defined, duplicated, out of order, unused", () => {
    expect(rule("structure/missing-resource-id")).toEqual([
      expect.stringMatching(/^res:\/\/broken\.tscn:6: error .*SubResource\("b"\) is used before its \[sub_resource\] on line 8/),
      expect.stringMatching(/^res:\/\/broken\.tscn:17: error .*ExtResource\("9_missing"\) has no \[ext_resource\]/),
    ]);
    expect(rule("structure/duplicate-resource-id")).toEqual([expect.stringMatching(/^res:\/\/broken\.tscn:12: error .*sub_resource id "g" is already used on line 10/)]);
    expect(rule("structure/section-order")).toEqual([expect.stringMatching(/^res:\/\/broken\.tscn:20: error .*\[ext_resource\] comes after/)]);
    expect(rule("structure/unused-resource")).toEqual([
      expect.stringMatching(/^res:\/\/broken\.tscn:20: info .*ext_resource "2_late"/),
      expect.stringMatching(/^res:\/\/main\.tscn:8: info .*ext_resource "6_unused"/),
    ]);
  });

  it("structure/locked-instance-edit: once per instance, nested instances too; [editable] makes it quiet", () => {
    expect(rule("structure/locked-instance-edit")).toEqual([
      'res://main.tscn:16: warning [structure/locked-instance-edit] 3 edits inside the instanced scene at "Inst", which has no [editable path="Inst"]: Godot applies them when loading, but drops them on the next save from the editor.',
      'res://main.tscn:19: warning [structure/locked-instance-edit] 1 edit inside the instanced scene at "Inst/Sub", which has no [editable path="Inst/Sub"]: Godot applies it when loading, but drops it on the next save from the editor.',
    ]);
    expect(lines.some((l) => l.startsWith("res://second.tscn"))).toBe(false);
  });

  const quiet = (files: Record<string, string>) =>
    reviewProject(makeProject({ "project.godot": PROJECT, ...files })).findings.filter((f) => /uid|resource-id|section-order|unused-resource|locked-instance/.test(f.rule)).map(formatFinding);
  const child = '[gd_scene format=3 uid="uid://bchild1"]\n\n[node name="Child" type="Node2D"]\n\n[node name="Inner" type="Node2D" parent="."]\n';

  it("stays quiet on what Godot handles", () => {
    expect(
      quiet({
        "child.tscn": child,
        "a.gd": "extends Node\n",
        // New nodes under an instance, nodes below them, overrides of the instance node itself and of an inherited scene.
        "main.tscn":
          '[gd_scene format=3]\n\n[ext_resource type="PackedScene" uid="uid://bchild1" path="res://child.tscn" id="1_c"]\n[ext_resource type="Script" path="res://a.gd" id="2_a"]\n\n[sub_resource type="GDScript" id="s"]\nscript/source = "extends Node\\nvar x = ExtResource(\\"nope\\")\\n"\n\n[node name="Main" type="Node2D"]\nmetadata/list = Array[ExtResource("2_a")]([])\n\n[node name="Inst" parent="." instance=ExtResource("1_c")]\nposition = Vector2(1, 1)\n\n[node name="New" type="Node2D" parent="Inst"]\n\n[node name="Deeper" type="Node2D" parent="Inst/New"]\n\n[connection signal="visibility_changed" from="Inst" to="." method="queue_free"]\n',
        "inherited.tscn": '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://child.tscn" id="1_c"]\n\n[node name="Child" instance=ExtResource("1_c")]\n\n[node name="Inner" parent="."]\nposition = Vector2(2, 2)\n',
      }),
    ).toEqual([]);
  });

  // Godot 4.7.2 keeps these after an editor save: the instanced scene marks its own instance editable.
  const editableInside = {
    "leaf.tscn": '[gd_scene format=3]\n\n[node name="Leaf" type="Node2D"]\n\n[node name="Sprite" type="Node2D" parent="."]\n',
    "mid.tscn": '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://leaf.tscn" id="1_l"]\n\n[node name="Mid" type="Node2D"]\n\n[node name="L" parent="." instance=ExtResource("1_l")]\n\n[node name="Sprite" parent="L"]\nposition = Vector2(1, 1)\n\n[editable path="L"]\n',
    "inh.tscn": '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://mid.tscn" id="1_m"]\n\n[node name="Mid" instance=ExtResource("1_m")]\n\n[node name="Sprite" parent="L"]\nposition = Vector2(9, 9)\n',
    "top.tscn": '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://mid.tscn" id="1_m"]\n\n[node name="Top" type="Node2D"]\n\n[node name="M" parent="." instance=ExtResource("1_m")]\n\n[node name="Sprite" parent="M/L"]\nposition = Vector2(3, 3)\n\n[editable path="M"]\n',
  };

  it("structure/locked-instance-edit: counts the [editable] entries of the instanced or inherited scene itself", () => {
    expect(quiet(editableInside)).toEqual([]);
    // Without mid.tscn's own [editable], its edit and both others are inside a locked instance again.
    const locked = quiet({ ...editableInside, "mid.tscn": editableInside["mid.tscn"].replace('\n[editable path="L"]\n', "") });
    expect(locked.filter((l) => l.includes("locked-instance")).map((l) => l.replace(/ warning .* at "/, ' at "').replace(/",.*$/, ""))).toEqual(['res://inh.tscn:7: at "L', 'res://mid.tscn:9: at "L', 'res://top.tscn:9: at "M/L']);
  });

  it("ignores a .uid file left behind by a moved script (Godot 4.7.2 does too)", () => {
    expect(quiet({ "new.gd": "extends Node\n", "new.gd.uid": "uid://cwx83o7xktq7h\n", "old.gd.uid": "uid://cwx83o7xktq7h\n" })).toEqual([]);
  });

  it("checks against the base project, but not a base's own problems or files only a .pck has", () => {
    const base = makeProject({ "project.godot": PROJECT, "child.tscn": child, "dup_in_base.tscn": child });
    const root = makeProject({
      "project.godot": PROJECT,
      "godotwright.json": JSON.stringify({ base: [base], baseFiles: ["pck.txt"] }),
      "pck.txt": "res://shipped.tscn\n",
      "copy.tscn": child,
      "main.tscn": '[gd_scene format=3]\n\n[ext_resource type="PackedScene" uid="uid://bshipped1" path="res://shipped.tscn" id="1_s"]\n\n[node name="Main" type="Node2D"]\n\n[node name="S" parent="." instance=ExtResource("1_s")]\n',
    });
    const found = reviewProject(root).findings.filter((f) => f.rule.includes("uid")).map(formatFinding);
    expect(found).toEqual([expect.stringMatching(/^res:\/\/copy\.tscn:1: error \[structure\/duplicate-uid\] .*res:\/\/child\.tscn \(base\), res:\/\/dup_in_base\.tscn \(base\)/)]);
  });
});
