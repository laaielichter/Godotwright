import { describe, expect, it } from "vitest";
import { formatFinding } from "../src/review/format.js";
import { reviewProject } from "../src/review/review.js";
import { makeProject } from "./helpers.js";

const PROJECT = '[application]\nconfig/name="T"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n';
const SCENE = '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n';

/** Formatted findings above info for a throwaway project whose main.gd is `gd`. */
function findings(gd: string, files: Record<string, string> = {}): string[] {
  const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": SCENE, "main.gd": gd, ...files });
  return reviewProject(root).findings.filter((f) => f.severity !== "info").map(formatFinding);
}

describe("unique-name nodes after keywords", () => {
  const PLAYER_SCENE = `${SCENE}[node name="Player" type="Node" parent="."]\nunique_name_in_owner = true\n`;
  const script = [
    "extends Node",
    "",
    "var state := 0",
    "",
    "func _ready() -> void:",
    "\tawait %Player.ready",
    "\tvar s := 1 if state else %Player.get_index()",
    "\tmatch %Player.name:",
    "\t\t_:",
    "\t\t\tpass",
    "\tvar n := 10 % 3",
    "\tprint(n, state % 2, s)",
  ].join("\n");

  it("reads %Name after await, else and match as a unique-name node, and keeps % as modulo", () => {
    expect(findings(script, { "main.tscn": PLAYER_SCENE })).toEqual([]);
  });

  it("checks %Name after await, else and match against the scene", () => {
    expect(findings(script).filter((l) => l.includes("[structure/"))).toEqual([
      "res://main.gd:6: warning [structure/missing-node] %Player is not a unique-name node in res://main.tscn.",
      "res://main.gd:7: warning [structure/missing-node] %Player is not a unique-name node in res://main.tscn.",
      "res://main.gd:8: warning [structure/missing-node] %Player is not a unique-name node in res://main.tscn.",
    ]);
  });
});

describe("Godot 3 syntax", () => {
  it("ignores Godot 3 words inside string literals", () => {
    expect(
      findings(
        [
          "extends Node",
          "",
          "func _ready() -> void:",
          '\tprint("setget is gone, yield( and funcref( and .instance() are Godot 3")',
          '\tpush_warning("export var, onready var and tool are Godot 3 too")',
          "\tprint('connect(\"hit\", self, \"_on_hit\")')",
        ].join("\n"),
      ).filter((l) => l.includes("[api/godot3-syntax]")),
    ).toEqual([]);
  });

  it("does not flag a project's own instance() method as Godot 3 syntax", () => {
    expect(
      findings(
        [
          "extends Node",
          "",
          "var _pool: Node",
          "",
          "func instance() -> Node:",
          "\treturn _pool",
          "",
          "func _ready() -> void:",
          "\tprint(self.instance())",
        ].join("\n"),
      ).filter((l) => l.includes("[api/godot3-syntax]")),
    ).toEqual([]);
  });

  it("still reports PackedScene.instance() when the project has no instance() method", () => {
    expect(
      findings(
        [
          "extends Node",
          "",
          "func _ready() -> void:",
          '\tadd_child(preload("res://player.tscn").instance())',
        ].join("\n"),
        { "player.tscn": '[gd_scene format=3]\n[node name="Player" type="Node"]\n' },
      ).filter((l) => l.includes("[api/godot3-syntax]")),
    ).toEqual([
      "res://main.gd:4: error [api/godot3-syntax] Godot 3 syntax: `PackedScene.instance()` is `instantiate()` in Godot 4.",
    ]);
  });

  it("still reports Godot 3 syntax in code", () => {
    expect(
      findings(
        [
          "extends Node",
          "",
          "var hp = 3 setget set_hp",
          "",
          "func _ready() -> void:",
          "\tyield(get_tree(), \"idle_frame\")",
        ].join("\n"),
      ).filter((l) => l.includes("[api/godot3-syntax]")),
    ).toEqual([
      "res://main.gd:3: error [api/godot3-syntax] Godot 3 syntax: `setget` is gone in Godot 4; use `var x: T: set = _set_x, get = _get_x` or set()/get blocks.",
      "res://main.gd:6: error [api/godot3-syntax] Godot 3 syntax: `yield()` is `await` in Godot 4, e.g. `await get_tree().create_timer(1.0).timeout`.",
    ]);
  });
});

describe("signals added at runtime", () => {
  const RUNTIME_SIGNAL = [
    "extends Node",
    "",
    "func _ready() -> void:",
    '\tadd_user_signal("hit", [{"name": "amount", "type": TYPE_INT}])',
    '\tconnect("hit", _on_hit)',
    "\tself.hit.connect(_on_hit)",
    '\temit_signal("hit", 3)',
    "",
    "func _on_hit(amount: int) -> void:",
    "\tprint(amount)",
  ].join("\n");

  it("accepts signals created with add_user_signal() in connect, emit and member access", () => {
    expect(findings(RUNTIME_SIGNAL).filter((l) => l.includes("[api/"))).toEqual([]);
  });

  it("accepts a signal that a base script adds with add_user_signal()", () => {
    expect(
      findings(
        ['extends "res://base.gd"', "", "func _ready() -> void:", '\tconnect("died", _on_died)', "", "func _on_died() -> void:", "\tpass"].join("\n"),
        { "base.gd": 'extends Node\n\nfunc _init() -> void:\n\tadd_user_signal("died")\n' },
      ).filter((l) => l.includes("[api/")),
    ).toEqual([]);
  });

  it("still reports a signal that no script adds or declares", () => {
    const lines = findings(`${RUNTIME_SIGNAL}\n\nfunc _later() -> void:\n\temit_signal("missing")\n`);
    expect(lines.filter((l) => l.includes("[api/"))).toEqual([
      'res://main.gd:13: error [api/unknown-signal] Signal "missing" is not declared on this class or its parents.',
    ]);
  });
});

describe("Variant enums", () => {
  it("reads Variant.Type and Variant.Operator members without calling Variant unknown", () => {
    expect(
      findings(
        [
          "extends Node",
          "",
          "func _ready() -> void:",
          "\tvar t := Variant.Type.TYPE_INT",
          "\tvar op: Variant.Operator = Variant.Operator.OP_ADD",
          "\tprint(t, op, Variant.Operator.OP_MULTIPLY)",
        ].join("\n"),
      ).filter((l) => l.includes("[api/")),
    ).toEqual([]);
  });

  it("still reports a misspelled class in front of an enum", () => {
    const lines = findings("extends Node\n\nfunc _ready() -> void:\n\tprint(Varient.Type.TYPE_INT)\n");
    expect(lines.filter((l) => l.includes("[api/"))).toHaveLength(1);
    expect(lines[0]).toContain('"Varient" is not a class, singleton, autoload or variable in Godot 4.7');
  });
});

describe("moved Godot 3 time functions", () => {
  it("suggests a millisecond timestamp for OS.get_system_time_msecs()", () => {
    expect(findings("extends Node\n\nfunc _ready() -> void:\n\tvar ms := OS.get_system_time_msecs()\n\tprint(ms)\n")).toEqual([
      'res://main.gd:4: error [api/unknown-member] Method "get_system_time_msecs()" does not exist on OS in Godot 4.7. In Godot 4 use int(Time.get_unix_time_from_system() * 1000).',
    ]);
  });
});

describe("argument counts", () => {
  const twoParams = "extends Node\n\nfunc f(a, b) -> int:\n\treturn 0\n\n";

  it("counts the arguments of a call that has a prototype name as an argument", () => {
    // `constructor` is an Object.prototype name; it must not open a bracket that hides the second call's commas.
    const lines = findings(`${twoParams}func _ready() -> void:\n\tvar v := f(constructor, 2) + f(1, 2)\n\tprint(v)\n`);
    expect(lines.filter((l) => l.includes("[api/"))).toEqual([]);
  });

  it("still counts a wrong argument list next to a prototype name", () => {
    const lines = findings(`${twoParams}func _ready() -> void:\n\tvar v := f(constructor, 2, 3) + f(1, 2)\n\tprint(v)\n`);
    expect(lines.filter((l) => l.includes("[api/wrong-arguments]"))).toEqual([
      "res://main.gd:7: error [api/wrong-arguments] f() takes 2 arguments, but 3 are given.",
    ]);
  });
});

describe("type tests that can never be true", () => {
  // Every case below was checked against Godot 4.7.2: the reported ones stop with a parse error, the others load.
  const fn = (params: string, body: string) => findings(`extends Node\n\n\nfunc f(${params}) -> void:\n\t${body}\n`).filter((f) => f.includes("impossible-type-test"));

  it("reports is/as between classes where neither inherits from the other", () => {
    expect(fn("visual: VisualInstance3D", "print(visual is Camera3D)")).toEqual([
      'res://main.gd:5: error [api/impossible-type-test] "visual" has type VisualInstance3D, so "visual is Camera3D" can never be true (neither class inherits from the other). Godot stops with a parse error.',
    ]);
    expect(fn("a: Area2D", "print(a as CharacterBody2D)")[0]).toContain('Invalid cast: "a" has type Area2D, which can never be converted to CharacterBody2D');
    expect(fn("r: Resource", "print(r is Node)")).toHaveLength(1);
    expect(fn("n: Node", "print(n as Resource)")).toHaveLength(1);
  });

  it("reports a class against a built-in type, and is between two different built-in types", () => {
    expect(fn("i: int", "print(i is Node)")).toHaveLength(1);
    expect(fn("i: int", "print(i as Node)")).toHaveLength(1);
    expect(fn("x: float", "print(x is int)")).toHaveLength(1);
    expect(fn("s: String", "print(s is StringName)")).toHaveLength(1);
  });

  it("stays quiet where Godot accepts the test", () => {
    for (const [params, body] of [
      ["n: Node", "print(n is Node2D)"],
      ["n: Node2D", "print(n is Node)"],
      ["v: Variant", "print(v is Camera3D)"],
      ["o: Object", "print(o is Node)"],
      ["r: RefCounted", "print(r is Resource)"],
      ["t: Texture2D", "print(t is ImageTexture)"],
      ["a: Array[int]", "print(a is Array)"],
      ["x: float", "print(x as int)"],
      ["s: String", "print(s as StringName)"],
      ["v: Vector2", "print(v as Vector2i)"],
      ["n: Node", "print(not n is Node2D)"],
    ]) {
      expect(fn(params!, body!), `${params}: ${body}`).toEqual([]);
    }
  });

  it("leaves script classes alone: a node can carry a script that extends one of its base classes", () => {
    const files = { "enemy.gd": "class_name Enemy\nextends Node2D\n" };
    const out = findings("extends Node\n\n\nfunc f(b: CharacterBody2D) -> void:\n\tprint(b is Enemy)\n", files).filter((f) => f.includes("impossible"));
    expect(out).toEqual([]);
  });
});
