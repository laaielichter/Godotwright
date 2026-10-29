import { describe, expect, it } from "vitest";
import { formatSignature, logicalLines, outlineScript, parseParams } from "../src/godot/gdscript.js";

const SOURCE = `@tool
@icon("res://icon.svg")
class_name Hero extends "res://base.gd"
## Docs.

signal hit
signal moved(from: Vector2, to: Vector2)

enum Mode { A, B = 4, C }
const MAX := 10
const NAME: String = "x # not a comment"
static var count: int = 0

@export var speed: float = 1.0
@export_range(0, 10)
var level = 1
@onready var label := $Label as Label
var hp: int = 3:
	set(value):
		hp = clampi(value, 0, 10)
	get:
		return hp
var data: Dictionary[String, int] = {
	"a": 1,
}

static func make() -> Hero:
	return null


func long_one(
	a: int,
	b := Vector2(0, 0),
	c = "s",
) -> void:
	var t := preload("res://thing.tscn")
	"""
	func not_a_function():
	"""
	load("data.json")


func inline(): pass


class Inner extends Node:
	signal inner_signal
	var x := 1

	func inner_func() -> int:
		return x


func after_inner() -> void:
	pass
`;

describe("logicalLines", () => {
  it("joins bracketed lines and strips comments", () => {
    const lines = logicalLines("var a = [1,\n  2] # c\nvar b = 'x#y'\n");
    expect(lines.map((l) => [l.text, l.line, l.endLine])).toEqual([
      ["var a = [1, 2]", 1, 2],
      ["var b = 'x#y'", 3, 3],
    ]);
    expect(lines[1]!.code).toBe("var b = '   '");
    expect(lines[1]!.code.length).toBe(lines[1]!.text.length);
  });
});

describe("parseParams", () => {
  it("reads types, inferred types and defaults", () => {
    expect(parseParams('a: int, b := 2, c = "x", d: Array[int] = [1, 2], e')).toEqual([
      { name: "a", type: "int", inferred: false, hasDefault: false },
      { name: "b", inferred: true, hasDefault: true, default: "2" },
      { name: "c", inferred: false, hasDefault: true, default: '"x"' },
      { name: "d", type: "Array[int]", inferred: false, hasDefault: true, default: "[1, 2]" },
      { name: "e", inferred: false, hasDefault: false },
    ]);
  });
});

describe("outlineScript", () => {
  const outline = outlineScript(SOURCE);

  it("reads the class header", () => {
    expect(outline.tool).toBe(true);
    expect(outline.icon).toBe("res://icon.svg");
    expect(outline.className).toBe("Hero");
    expect(outline.extends).toBe("res://base.gd");
  });

  it("reads signals, enums and constants", () => {
    expect(outline.signals.map((s) => [s.name, s.params.map((p) => p.type)])).toEqual([
      ["hit", []],
      ["moved", ["Vector2", "Vector2"]],
    ]);
    expect(outline.enums).toEqual([{ name: "Mode", values: ["A", "B", "C"], line: 9 }]);
    expect(outline.constants.map((c) => [c.name, c.type])).toEqual([
      ["MAX", undefined],
      ["NAME", "String"],
    ]);
  });

  it("reads variables with annotations", () => {
    expect(
      outline.variables.map((v) => [v.name, v.type, v.inferred, v.static, v.exportAnnotation, v.onready]),
    ).toEqual([
      ["count", "int", false, true, undefined, false],
      ["speed", "float", false, false, "@export", false],
      ["level", undefined, false, false, "@export_range(0, 10)", false],
      ["label", undefined, true, false, undefined, true],
      ["hp", "int", false, false, undefined, false],
      ["data", "Dictionary[String, int]", false, false, undefined, false],
    ]);
  });

  it("reads functions and skips bodies, strings and property blocks", () => {
    expect(outline.functions.map((f) => [formatSignature(f), f.line, f.endLine])).toEqual([
      ["static make() -> Hero", 27, 28],
      ['long_one(a: int, b := Vector2(0, 0), c = "s") -> void', 31, 40],
      ["inline()", 43, 43],
      ["after_inner() -> void", 54, 55],
    ]);
  });

  it("reads inner classes", () => {
    expect(outline.innerClasses).toHaveLength(1);
    const inner = outline.innerClasses[0]!;
    expect(inner.name).toBe("Inner");
    expect(inner.extends).toBe("Node");
    expect(inner.signals.map((s) => s.name)).toEqual(["inner_signal"]);
    expect(inner.variables.map((v) => v.name)).toEqual(["x"]);
    expect(inner.functions.map((f) => [f.name, f.line, f.endLine])).toEqual([["inner_func", 50, 51]]);
    expect([inner.line, inner.endLine]).toEqual([46, 51]);
  });

  it("finds preload and load paths", () => {
    expect(outline.preloads).toEqual([
      { path: "res://thing.tscn", kind: "preload", line: 36 },
      { path: "data.json", kind: "load", line: 40 },
    ]);
  });

  it("reads annotations that have a space before their argument list", () => {
    const spaced = outlineScript(
      [
        "@tool",
        '@icon ("res://x.svg")',
        "class_name Spaced",
        "",
        '@export_group ("Movement")',
        "@export var speed := 1.0",
        '@export_subgroup ("Tuning")',
        "@export_range (0, 10) var level := 1",
      ].join("\n"),
    );
    expect(spaced.tool).toBe(true);
    expect(spaced.icon).toBe("res://x.svg");
    expect(spaced.variables.map((v) => [v.name, v.exportAnnotation])).toEqual([
      ["speed", "@export"],
      ["level", "@export_range (0, 10)"],
    ]);
  });

  it("strips single quotes from extends and icon paths", () => {
    const quoted = outlineScript("@icon('res://x.svg')\nclass_name Q extends 'res://base.gd'\n");
    expect(quoted.icon).toBe("res://x.svg");
    expect(quoted.extends).toBe("res://base.gd");
    expect(outlineScript("extends 'res://base.gd'\n").extends).toBe("res://base.gd");
  });

  it("keeps inner classes that extend a quoted path with a dotted tail", () => {
    const script = outlineScript(
      [
        'class Foo extends "res://base.gd".Bar:',
        "\tvar x := 1",
        "\tfunc f() -> void:",
        "\t\tpass",
        "",
        "class Baz extends 'res://base.gd':",
        "\tvar y := 2",
      ].join("\n"),
    );
    expect(script.innerClasses.map((c) => [c.name, c.extends, c.variables.map((v) => v.name), c.functions.map((f) => f.name)])).toEqual([
      ["Foo", "res://base.gd.Bar", ["x"], ["f"]],
      ["Baz", "res://base.gd", ["y"], []],
    ]);
  });

  it("finds preload and load calls outside strings, with either quote style", () => {
    const script = outlineScript(
      [
        "var a := preload('res://a.tscn')",
        `var b := 'load("res://fake.tscn")'`,
        'var c := ResourceLoader.load("res://c.tres")',
        'var d := load("res://d.tres") + load("res://e" + name)',
        `var f := 'preload("res://g.tscn")'`,
      ].join("\n"),
    );
    expect(script.preloads).toEqual([
      { path: "res://a.tscn", kind: "preload", line: 1 },
      { path: "res://c.tres", kind: "load", line: 3 },
      { path: "res://d.tres", kind: "load", line: 4 },
    ]);
  });
});
