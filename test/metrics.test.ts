import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { metricsCommand } from "../src/commands/metrics.js";
import { complexityOfSource, complexityReport, formatComplexity, gradeOf } from "../src/metrics/complexity.js";
import { formatSignals, formatSignalsMermaid, signalFlow } from "../src/metrics/signals.js";
import { countLines, formatStats, projectStats } from "../src/metrics/stats.js";
import { reviewProject } from "../src/review/review.js";
import { makeProject } from "./helpers.js";

const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Metrics"\n\n[autoload]\n\nEvents="*res://events.gd"\n';

const LOGIC = `extends Node

func simple() -> int:
	return 1

func branchy(a: int, b: int) -> String:
	# if this and that or for while
	var text := "if elif and or while for"
	if a > 0 and b > 0:
		return "both"
	elif a > 0 or b > 0:
		return "one"
	for i in a:
		while b > i:
			b -= 1
	return text if a == b else "none"

func matcher(kind: int) -> int:
	match kind:
		1:
			return 10
		2, 3:
			return 20
		var other when other > 5 and other < 9:
			return 30
		_:
			return 0

func lambdas(items: Array) -> Array:
	var keep := func(x: int) -> bool:
		if x > 2:
			return true
		return false
	var out := items.filter(func(v):
		return v > 1 and v < 9
	)
	return out.map(func(v): return v * 2 if v else 0)

func paths(x: String) -> void:
	$if/for.hide()
	%while.hide()
	$"a and b".text = 'or "if" x' # and if or
	x.match("if")

func one_line(a): return 1 if a else 2

class Inner:
	func deep(n: int) -> int:
		if n > 0:
			if n > 1:
				if n > 2:
					return 3
		return 0
`;

/** A function with `n` ifs in a row: complexity n + 1. */
const ifs = (name: string, n: number): string => `func ${name}(v: int) -> int:\n${Array.from({ length: n }, (_, i) => `\tif v == ${i}:\n\t\treturn ${i}\n`).join("")}\treturn -1\n`;

describe("cyclomatic complexity", () => {
  it("grades like radon", () => {
    expect([1, 5, 6, 10, 11, 20, 21, 30, 31, 40, 41, 99].map(gradeOf).join("")).toBe("AABBCCDDEEFF");
  });

  it("counts branches by hand-checked numbers, not keywords in strings, comments or node paths", () => {
    const byName = Object.fromEntries(complexityOfSource(LOGIC).map((f) => [f.name, f]));
    expect(Object.fromEntries(Object.entries(byName).map(([name, f]) => [name, f.complexity]))).toEqual({
      simple: 1,
      // if, and, elif, or, for, while, ternary
      branchy: 8,
      // three arms (the lone _ is the default path) and the `and` of the guard
      matcher: 5,
      // the if in the first lambda, the `and` in the second, the ternary in the third
      lambdas: 4,
      paths: 1,
      one_line: 2,
      "Inner.deep": 4,
    });
    expect(byName["branchy"]).toMatchObject({ line: 6, endLine: 16, lines: 11, grade: "B", nesting: 2 });
    expect(byName["matcher"]).toMatchObject({ grade: "A", nesting: 1 });
    expect(byName["lambdas"]).toMatchObject({ nesting: 2 });
    expect(byName["Inner.deep"]).toMatchObject({ nesting: 3, lines: 6 });
    expect(byName["simple"]).toMatchObject({ nesting: 0, lines: 2 });
    // Worst first.
    expect(complexityOfSource(LOGIC).map((f) => f.name).slice(0, 2)).toEqual(["branchy", "matcher"]);
  });

  it("does not take a variable called match, or a nested match, for arms", () => {
    const [f] = complexityOfSource("func f(a, b):\n\tvar match = a\n\tmatch a:\n\t\t1:\n\t\t\tmatch b:\n\t\t\t\t\"x\", \"y\":\n\t\t\t\t\tpass\n\t\t\t\t_:\n\t\t\t\t\tpass\n\t\t{\"k\": 1}:\n\t\t\tpass\n\treturn match\n");
    // arms: 1, the "x", "y" arm, the dictionary arm
    expect(f).toMatchObject({ complexity: 4, nesting: 2 });
  });

  it("reports per file worst first, the project average and the functions above the threshold", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "events.gd": "extends Node\n",
      "logic.gd": LOGIC,
      "big.gd": `extends Node\n\n${ifs("huge", 11)}\n${ifs("small", 1)}`,
      "addons/x/plugin.gd": ifs("ignored", 50),
    });
    const r = complexityReport(root);
    expect(r.files.map((f) => [f.file, f.max, f.functions.map((fn) => fn.name)])).toEqual([
      ["res://big.gd", 12, ["huge", "small"]],
      ["res://logic.gd", 8, ["branchy", "matcher", "Inner.deep", "lambdas", "one_line", "paths", "simple"]],
    ]);
    expect(r.functions).toBe(9);
    // (12 + 2) + (1 + 8 + 5 + 4 + 1 + 2 + 4) = 39 over 9 functions
    expect(r.average).toBe(4.33);
    expect(r.grade).toBe("A");
    expect(r.grades).toEqual({ A: 7, B: 1, C: 1, D: 0, E: 0, F: 0 });
    expect(r.above.map((f) => [f.file, f.name, f.complexity, f.grade])).toEqual([["res://big.gd", "huge", 12, "C"]]);
    expect(complexityReport(root, { threshold: 4 }).above.map((f) => f.name)).toEqual(["huge", "branchy", "matcher"]);
    expect(complexityReport(root, { includeAddons: true }).above[0]).toMatchObject({ name: "ignored", complexity: 51, grade: "F" });

    const text = formatComplexity(r);
    expect(text).toMatch(/^complexity: 9 functions in 2 scripts, average 4\.33 \(A\), 1 above 10; grades: A 7, B 1, C 1\n/);
    expect(text).toContain("  res://big.gd  C 12  huge()  line 3, 24 lines, nesting 1");
    expect(text).toContain("  res://logic.gd  max 8 (B), average 3.57, 7 functions");
    expect(formatComplexity(r, 1)).toContain("  ... 1 more script");
    expect(formatComplexity(complexityReport(makeProject({ "project.godot": PROJECT, "events.gd": "extends Node\n" })))).toBe("complexity: no GDScript functions in the project\n");
  });
});

const PLAYER = `class_name Player
extends CharacterBody2D

signal died
signal hurt(amount: int)
signal ghost

var health := 3

func _physics_process(_delta: float) -> void:
	if health <= 0:
		died.emit()
	emit_signal("hurt", 3)
	Events.score_changed.emit(1)
	Events.shouted.emit("hi")

func _ready() -> void:
	hurt.connect(_on_hurt)
	Events.score_changed.connect(_missing_handler)
	$Timer.timeout.connect(func(): print("tick"))
	var text := "ghost.emit() died.connect(nothing)"
	# ghost.emit()

func _on_hurt(_amount: int) -> void:
	pass
`;

const MAIN = `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://player.gd" id="1"]
[ext_resource type="Script" path="res://hud.gd" id="2"]

[node name="Main" type="Node2D"]

[node name="Player" type="CharacterBody2D" parent="."]
script = ExtResource("1")

[node name="Timer" type="Timer" parent="Player"]

[node name="Hud" type="Control" parent="."]
script = ExtResource("2")

[node name="Button" type="Button" parent="Hud"]

[connection signal="died" from="Player" to="Hud" method="_on_player_died"]
[connection signal="pressed" from="Hud/Button" to="Hud" method="_on_pressed_typo"]
[connection signal="timeout" from="Player/Timer" to="Player" method="queue_free"]
`;

function signalGame(): string {
  return makeProject({
    "project.godot": PROJECT,
    "events.gd": "extends Node\n\nsignal score_changed(points: int)\nsignal unused_thing\nsignal shouted(text: String)\n",
    "player.gd": PLAYER,
    "hud.gd": "extends Control\n\nfunc _on_player_died() -> void:\n\tawait Events.score_changed\n",
    "main.tscn": MAIN,
  });
}

describe("signal flow", () => {
  it("lists every signal with who emits it and who connects to it", () => {
    const r = signalFlow(signalGame());
    const flow = (name: string, owner?: string) => r.signals.find((s) => s.name === name && (owner === undefined || s.owner === owner))!;
    expect(r.signals.map((s) => `${s.kind} ${s.owner} ${s.name}`)).toEqual([
      "script res://events.gd score_changed",
      "script res://events.gd unused_thing",
      "script res://events.gd shouted",
      "script res://player.gd died",
      "script res://player.gd hurt",
      "script res://player.gd ghost",
      "builtin BaseButton pressed",
      "builtin Timer timeout",
    ]);
    expect(flow("hurt")).toEqual({
      name: "hurt",
      kind: "script",
      owner: "res://player.gd",
      params: ["amount: int"],
      file: "res://player.gd",
      line: 5,
      emits: [{ file: "res://player.gd", line: 13 }],
      connections: [{ file: "res://player.gd", line: 18, via: "code", method: "_on_hurt", targetScript: "res://player.gd" }],
    });
    expect(flow("died").emits).toEqual([{ file: "res://player.gd", line: 12 }]);
    expect(flow("died").connections).toEqual([{ file: "res://main.tscn", line: 18, via: "scene", from: "Player", to: "Hud", method: "_on_player_died", targetScript: "res://hud.gd" }]);
    expect(flow("score_changed").emits).toEqual([{ file: "res://player.gd", line: 14 }]);
    expect(flow("score_changed").connections).toEqual([
      { file: "res://hud.gd", line: 4, via: "await", from: "Events" },
      { file: "res://player.gd", line: 19, via: "code", from: "Events", method: "_missing_handler", targetScript: "res://player.gd", missing: true },
    ]);
    // A built-in signal: a native method as the target is fine, a lambda is a receiver too.
    expect(flow("timeout", "Timer").connections).toEqual([
      { file: "res://main.tscn", line: 20, via: "scene", from: "Player/Timer", to: "Player", method: "queue_free", targetScript: "res://player.gd" },
      { file: "res://player.gd", line: 20, via: "code", from: "$Timer", method: "(lambda)" },
    ]);
    expect(flow("pressed").params).toEqual([]);
  });

  it("finds the three kinds of bugs", () => {
    const r = signalFlow(signalGame());
    expect(r.ok).toBe(false);
    // Text in a string or a comment is not an emit.
    expect(r.neverEmitted).toEqual([
      { signal: "unused_thing", file: "res://events.gd", line: 4 },
      { signal: "ghost", file: "res://player.gd", line: 6 },
    ]);
    expect(r.neverConnected).toEqual([{ signal: "shouted", file: "res://events.gd", line: 5 }]);
    expect(r.missingMethods).toEqual([
      { file: "res://main.tscn", line: 19, signal: "pressed", method: "_on_pressed_typo", target: "res://hud.gd", via: "scene" },
      { file: "res://player.gd", line: 19, signal: "score_changed", method: "_missing_handler", target: "res://player.gd", via: "code" },
    ]);
    const text = formatSignals(r);
    expect(text).toMatch(/^signals: 6 declared, 2 built-in in use, 4 emits, 7 connections; 2 never emitted, 1 never connected, 2 missing methods\n/);
    expect(text).toContain("  res://main.tscn:19  pressed -> res://hud.gd._on_pressed_typo()");
    expect(text).toContain("declared but never emitted:\n  res://events.gd:4  unused_thing\n  res://player.gd:6  ghost\n");
    expect(text).toContain("emitted but nobody listens (no connection, no await):\n  res://events.gd:5  shouted\n");
    expect(text).toContain("  hurt(amount: int)  res://player.gd:5\n    emit res://player.gd:13\n    -> res://player.gd._on_hurt()  [code res://player.gd:18]\n");
    expect(formatSignals(r, 1)).toContain("  ... 7 more signals");
  });

  it("stays quiet where it cannot know: string connects, callables in variables, inherited and native methods", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "events.gd": "extends Node\n\nsignal ping\n",
      "base.gd": "class_name Base\nextends Node\n\nsignal ready_to_go\n\nfunc _on_ping() -> void:\n\tpass\n",
      "child.gd": [
        "extends Base",
        "",
        "func _ready() -> void:",
        "\tEvents.connect(\"ping\", _on_ping)",
        "\tEvents.ping.connect(Callable(self, \"_on_ping\").bind(1))",
        "\tready_to_go.connect(queue_free)",
        "\tvar handler := func(): pass",
        "\tready_to_go.connect(handler)",
        "\tEvents.ping.emit()",
        "\tready_to_go.emit()",
        "",
        "func listen(callback: Callable) -> void:",
        "\tEvents.ping.connect(callback)",
        "\tEvents.ping.connect(Callable(self, \"nope\"))",
        "",
      ].join("\n"),
    });
    const r = signalFlow(root);
    expect(r.neverEmitted).toEqual([]);
    expect(r.neverConnected).toEqual([]);
    expect(r.missingMethods).toEqual([{ file: "res://child.gd", line: 14, signal: "ping", method: "nope", target: "res://child.gd", via: "code" }]);
    expect(r.signals.find((s) => s.name === "ready_to_go")).toMatchObject({ owner: "res://base.gd", emits: [{ file: "res://child.gd", line: 10 }] });
    expect(r.signals.find((s) => s.name === "ping")!.connections.map((c) => c.method)).toEqual(["_on_ping", "_on_ping", "callback", "nope"]);
    expect(signalFlow(makeProject({ "project.godot": PROJECT, "events.gd": "extends Node\n" }))).toMatchObject({ ok: true, signals: [] });
  });

  it("draws the flow as a mermaid chart", () => {
    const text = formatSignalsMermaid(signalFlow(signalGame()));
    expect(text.startsWith("flowchart LR\n")).toBe(true);
    // emitter --> signal --> receiver; one node per file, a dashed arrow to a method that does not exist
    expect(text).toContain('  s0(["score_changed"])\n  n1["player.gd"]\n  n1 --> s0\n  n2["await in hud.gd"]\n  s0 --> n2\n  n3["player.gd._missing_handler()"]\n  s0 -.-> n3\n');
    expect(text).toContain('  n6["main.tscn:Player"]\n  n6 --> s5\n  n7["hud.gd._on_player_died()"]\n  s5 --> n7\n');
    expect(text).toContain('["main.tscn:Hud/Button"]');
    expect(text).toContain('["player.gd (lambda)"]');
    // Signals without an emitter or a receiver are left out.
    expect(text).not.toContain("ghost");
    expect(text).not.toContain("unused_thing");
    const one = formatSignalsMermaid(signalFlow(signalGame()), 1);
    expect(one).toContain("  %% 5 more signals not shown\n");
    expect(one).not.toContain("died");
  });
});

describe("project statistics", () => {
  it("counts lines of GDScript by kind", () => {
    expect(countLines("")).toEqual({ total: 0, code: 0, comment: 0, blank: 0 });
    expect(countLines("extends Node\n\n# a comment\nvar a = 1 # trailing\n\t\n")).toEqual({ total: 5, code: 2, comment: 1, blank: 1 + 1 });
    // Lines inside a multi-line string are code, also the empty one and the one that starts with #.
    expect(countLines('var s = """\n# not a comment\n\nend"""\nvar t = "#"')).toEqual({ total: 5, code: 5, comment: 0, blank: 0 });
  });

  it("counts files, lines, typing and how heavy each scene is", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "events.gd": "extends Node\n\nsignal ping\n",
      "player.gd": PLAYER,
      "hud.gd": "extends Control\n\n# Called by the scene.\nfunc _on_player_died():\n\tvar count = 1\n\tprint(count)\n",
      "main.tscn": MAIN,
      "level.tscn": '[gd_scene load_steps=3 format=3]\n\n[ext_resource type="PackedScene" path="res://main.tscn" id="1"]\n\n[sub_resource type="CircleShape2D" id="c"]\nradius = 8.0\n\n[sub_resource type="RectangleShape2D" id="r"]\n\n[node name="Level" type="Node2D"]\n\n[node name="A" parent="." instance=ExtResource("1")]\n\n[node name="B" parent="." instance=ExtResource("1")]\n\n[node name="Deep" type="Node2D" parent="."]\n\n[node name="Deeper" type="Node2D" parent="Deep"]\n\n[node name="Deepest" type="Node2D" parent="Deep/Deeper"]\n',
      "theme.tres": '[gd_resource type="Theme" format=3]\n\n[resource]\n',
      "water.gdshader": "shader_type canvas_item;\n",
      "icon.png": "x",
      "art/tile.png": "x",
      "music.ogg": "x",
      "addons/x/plugin.gd": "extends Node\nfunc a():\n\tpass\n",
    });
    const r = projectStats(root);
    // The add-on is not counted.
    expect(r.counts).toEqual({ scripts: 3, scenes: 2, resources: 1, shaders: 1, csharpScripts: 0, autoloads: 1, assets: { audio: 1, texture: 2 }, functions: 4, signals: 4, nodes: 11 });
    expect(r.lines).toEqual({ total: 34, code: 25, comment: 2, blank: 7 });
    // Untyped: the return type of _on_player_died() and `var count = 1` in hud.gd. The same count as the review.
    expect(r.typing).toEqual({ typed: 7, total: 9, percent: 78 });
    expect(r.typing).toEqual(reviewProject(root).typing);
    expect(r.scripts).toEqual([
      { file: "res://player.gd", total: 25, code: 19, comment: 1, blank: 5, functions: 3 },
      { file: "res://hud.gd", total: 6, code: 4, comment: 1, blank: 1, functions: 1 },
      { file: "res://events.gd", total: 3, code: 2, comment: 0, blank: 1, functions: 0 },
    ]);
    // level.tscn instances main.tscn (5 nodes) twice: 4 nodes of its own and 10 from the instances.
    expect(r.scenes).toEqual([
      { file: "res://level.tscn", nodes: 6, totalNodes: 14, depth: 4, scripts: 0, instances: 2, subResources: 2, connections: 0 },
      { file: "res://main.tscn", nodes: 5, totalNodes: 5, depth: 3, scripts: 2, instances: 0, subResources: 0, connections: 3 },
    ]);
    expect(projectStats(root, { includeAddons: true }).counts).toMatchObject({ scripts: 4, functions: 5 });
    expect(formatStats(r)).toBe(
      [
        "stats of Metrics: 3 scripts, 2 scenes, 1 resource, 1 shader, 1 autoload",
        "assets: audio 1, texture 2",
        "GDScript: 34 lines (code 25, comment 2, blank 7), 4 functions, 4 signals",
        "typed: 78% (7 of 9 declarations)",
        "biggest scripts (code lines, all lines, functions):",
        "  res://player.gd  19 code, 25 lines, 3 functions",
        "  res://hud.gd  4 code, 6 lines, 1 function",
        "  res://events.gd  2 code, 3 lines, 0 functions",
        "heaviest scenes (11 nodes in all; total = with instanced scenes counted in):",
        "  res://level.tscn  6 nodes (total 14), depth 4, 0 scripts, 2 instances, 2 sub_resources, 0 connections",
        "  res://main.tscn  5 nodes (total 5), depth 3, 2 scripts, 0 instances, 0 sub_resources, 3 connections",
        "",
      ].join("\n"),
    );
    expect(formatStats(r, 1)).toContain("  res://player.gd  19 code, 25 lines, 3 functions\n  ... 2 more\n");
  });
});

/** Runs `godotwright metrics ...` on its own: the command is not part of the program yet. */
async function metrics(args: string[]): Promise<{ output: string; exitCode: number }> {
  let output = "";
  const program = new Command().exitOverride().configureOutput({ writeOut: (t) => (output += t), writeErr: (t) => (output += t) }).addCommand(metricsCommand());
  process.exitCode = undefined;
  await program.parseAsync(["metrics", ...args], { from: "user" });
  const exitCode = process.exitCode === undefined ? 0 : Number(process.exitCode);
  process.exitCode = undefined;
  return { output, exitCode };
}

describe("godotwright metrics", () => {
  it("has the three subcommands with --path, --json, --limit, --threshold and --mermaid", async () => {
    const root = signalGame();
    const complexity = await metrics(["complexity", "--path", root, "--threshold", "1", "--limit", "1"]);
    expect(complexity.output).toMatch(/^complexity: 4 functions in 2 scripts, average 1\.25 \(A\), 1 above 1; /);
    expect(complexity.exitCode).toBe(0);
    expect(JSON.parse((await metrics(["complexity", root, "--json"])).output)).toMatchObject({ threshold: 10, functions: 4, above: [] });

    const signals = await metrics(["signals", "--path", root]);
    expect(signals.output).toMatch(/^signals: 6 declared, /);
    // A connection to a method that does not exist fails the command.
    expect(signals.exitCode).toBe(1);
    expect((await metrics(["signals", "--path", root, "--mermaid"])).output).toMatch(/^flowchart LR\n/);
    expect(JSON.parse((await metrics(["signals", "--path", root, "--json"])).output).neverConnected).toEqual([{ signal: "shouted", file: "res://events.gd", line: 5 }]);

    const stats = await metrics(["stats", "--path", root]);
    expect(stats.output).toMatch(/^stats of Metrics: 3 scripts, 1 scene, /);
    expect(stats.exitCode).toBe(0);
    expect(JSON.parse((await metrics(["stats", "--path", root, "--json"])).output).counts.nodes).toBe(5);
  });
});
