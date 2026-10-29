import { describe, expect, it } from "vitest";
import { formatVariant, parseVariant } from "../src/godot/variant.js";

describe("parseVariant", () => {
  it("reads primitives", () => {
    expect(parseVariant("true")).toBe(true);
    expect(parseVariant("null")).toBe(null);
    expect(parseVariant("-12")).toBe(-12);
    expect(parseVariant("1.5e+3")).toBe(1500);
    expect(parseVariant("inf")).toBe(Number.POSITIVE_INFINITY);
    expect(parseVariant("-inf")).toBe(Number.NEGATIVE_INFINITY);
    expect(parseVariant("nan")).toBeNaN();
  });

  it("reads strings with escapes and real newlines", () => {
    expect(parseVariant('"a \\"b\\" \\\\ \\u00e9"')).toBe('a "b" \\ é');
    expect(parseVariant('"line 1\nline 2"')).toBe("line 1\nline 2");
    expect(parseVariant('&"name"')).toBe("name");
    expect(parseVariant('^"Path/To:prop"')).toEqual({ $type: "NodePath", args: ["Path/To:prop"] });
  });

  it("reads constructors, arrays and dictionaries", () => {
    expect(parseVariant("Vector2(1, -2.5)")).toEqual({ $type: "Vector2", args: [1, -2.5] });
    expect(parseVariant('ExtResource("1_abc")')).toEqual({ $type: "ExtResource", args: ["1_abc"] });
    expect(parseVariant("Callable()")).toEqual({ $type: "Callable", args: [] });
    expect(parseVariant('[1, "a", [true], ]')).toEqual([1, "a", [true]]);
    expect(parseVariant('{\n"a": 1,\n"b": Color(1, 1, 1, 1)\n}')).toEqual({
      a: 1,
      b: { $type: "Color", args: [1, 1, 1, 1] },
    });
  });

  it("unwraps typed arrays and dictionaries", () => {
    expect(parseVariant("Array[int]([1, 2])")).toEqual([1, 2]);
    expect(parseVariant('Array[ExtResource("2_x")]([ExtResource("3_y")])')).toEqual([
      { $type: "ExtResource", args: ["3_y"] },
    ]);
    expect(parseVariant('Dictionary[String, int]({"a": 1})')).toEqual({ a: 1 });
  });

  it("keeps every Dictionary key, including __proto__ and non-string keys", () => {
    const dict = parseVariant('{"__proto__": 5, 1: "int", "1": "str", Vector2(1, 2): "vec"}') as Record<string, unknown>;
    expect(Object.keys(dict).sort()).toEqual(["(1)", "(Vector2(1, 2))", "1", "__proto__"]);
    expect(Object.prototype.hasOwnProperty.call(dict, "__proto__")).toBe(true);
    expect(dict["__proto__"]).toBe(5);
    expect(dict["(1)"]).toBe("int");
    expect(dict["1"]).toBe("str");
  });

  it("reads inline objects", () => {
    expect(parseVariant('Object(InputEventKey,"keycode":65,"pressed":false,"script":null)')).toEqual({
      $type: "Object",
      class: "InputEventKey",
      props: { keycode: 65, pressed: false, script: null },
    });
  });

  it("reports the line of a syntax error", () => {
    expect(() => parseVariant("[\n1,\n2 3]")).toThrow(/line 3/);
  });

  it("formats values back to Godot text", () => {
    expect(formatVariant(parseVariant('[Vector2(1, 2), "a", {"k": null}]'))).toBe('[Vector2(1, 2), "a", {"k": null}]');
  });
});
