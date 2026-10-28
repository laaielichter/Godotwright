import { describe, expect, it } from "vitest";
import { cleanup } from "../src/check/check.js";
import { formatDiagnostic, parseGodotLog } from "../src/check/log.js";

describe("parseGodotLog", () => {
  it("reads script parse errors with file and line", () => {
    const log = [
      "GODOTWRIGHT_BEGIN res://scripts/broken.gd",
      'SCRIPT ERROR: Parse Error: Identifier "undefined_name" not declared in the current scope.',
      "          at: GDScript::reload (res://scripts/broken.gd:5)",
      'ERROR: Failed to load script "res://scripts/broken.gd" with error "Parse error".',
      "   at: load (modules/gdscript/gdscript.cpp:2936)",
      "GODOTWRIGHT_END res://scripts/broken.gd",
    ].join("\n");
    const diags = parseGodotLog(log, "check");
    expect(diags).toEqual([
      {
        severity: "error",
        file: "res://scripts/broken.gd",
        line: 5,
        message: 'Parse Error: Identifier "undefined_name" not declared in the current scope.',
        source: "script",
      },
      {
        severity: "error",
        file: "res://scripts/broken.gd",
        message: 'Failed to load script "res://scripts/broken.gd" with error "Parse error".',
        source: "check",
      },
    ]);
    expect(cleanup(diags)).toHaveLength(1);
    expect(formatDiagnostic(diags[0]!)).toBe(
      'res://scripts/broken.gd:5: error: Parse Error: Identifier "undefined_name" not declared in the current scope.',
    );
  });

  it("reads resource errors with the location in the message", () => {
    const log = [
      "ERROR: res://main.tscn:4 - Parse Error: [ext_resource] referenced non-existent resource at: res://missing.png.",
      "   at: _parse_ext_resource (scene/resources/resource_format_text.cpp:163)",
      "WARNING: res://main.tscn:3 - ext_resource, invalid UID: uid://abc - using text path instead: res://missing.png",
    ].join("\n");
    expect(parseGodotLog(log, "check")).toEqual([
      {
        severity: "error",
        file: "res://main.tscn",
        line: 4,
        message: "Parse Error: [ext_resource] referenced non-existent resource at: res://missing.png.",
        source: "check",
      },
      {
        severity: "warning",
        file: "res://main.tscn",
        line: 3,
        message: "ext_resource, invalid UID: uid://abc - using text path instead: res://missing.png",
        source: "check",
      },
    ]);
  });

  it("uses the script backtrace for runtime errors", () => {
    const log = [
      "\u001b[1;31mSCRIPT ERROR:\u001b[0m Out of bounds get index '3' (on base: 'Array[int]')",
      "   at: _ready (res://scripts/main.gd:7)",
      "USER ERROR: something bad",
      "   at: push_error (core/variant/variant_utility.cpp:1111)",
      "   GDScript backtrace (most recent call first):",
      "       [0] fail (res://scripts/util.gd:12)",
      "       [1] _ready (res://scripts/main.gd:4)",
    ].join("\n");
    expect(parseGodotLog(log, "run").map(formatDiagnostic)).toEqual([
      "res://scripts/main.gd:7: error: Out of bounds get index '3' (on base: 'Array[int]')",
      "res://scripts/util.gd:12: error: something bad",
    ]);
  });

  it("attributes errors without a project path to the file being loaded", () => {
    const log = [
      "GODOTWRIGHT_BEGIN res://scenes/level.tscn",
      "ERROR: Cannot get class 'MissingNode'.",
      "   at: instantiate (core/object/class_db.cpp:100)",
      "GODOTWRIGHT_END res://scenes/level.tscn",
      "ERROR: Outside of any file.",
    ].join("\n");
    expect(parseGodotLog(log).map(formatDiagnostic)).toEqual([
      "res://scenes/level.tscn: error: Cannot get class 'MissingNode'.",
      "error: Outside of any file.",
    ]);
  });
});
