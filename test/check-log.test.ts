import { describe, expect, it } from "vitest";
import { cleanup } from "../src/check/check.js";
import { formatDiagnostic, parseGodotLog } from "../src/check/log.js";

describe("parseGodotLog on real Godot 4.7.2 output", () => {
  const check = [
    "GODOTWRIGHT_BEGIN res://scripts/broken.gd",
    'SCRIPT ERROR: Parse Error: Identifier "undefined_name" not declared in the current scope.',
    "          at: GDScript::reload (res://scripts/broken.gd:5)",
    "          GDScript backtrace (most recent call first):",
    "              [0] _initialize (res://.godot/godotwright/check.gd:14)",
    'ERROR: Failed to load script "res://scripts/broken.gd" with error "Parse error".',
    "   at: load (modules/gdscript/gdscript_resource_format.cpp:46)",
    "   GDScript backtrace (most recent call first):",
    "       [0] _initialize (res://.godot/godotwright/check.gd:14)",
    "GODOTWRIGHT_END res://scripts/broken.gd",
    "GODOTWRIGHT_BEGIN res://main.tscn",
    "ERROR: Resource file not found: res://missing.png (expected type: Texture2D)",
    "   at: _load (core/io/resource_loader.cpp:325)",
    "   GDScript backtrace (most recent call first):",
    "       [0] _initialize (res://.godot/godotwright/check.gd:18)",
    "ERROR: res://main.tscn:10 - Parse Error: [ext_resource] referenced non-existent resource at: res://missing.png.",
    "   at: _printerr (scene/resources/resource_format_text.cpp:41)",
    "   GDScript backtrace (most recent call first):",
    "       [0] _initialize (res://.godot/godotwright/check.gd:18)",
    "GODOTWRIGHT_END res://main.tscn",
    "GODOTWRIGHT_DONE 3 1",
  ].join("\n");
  const importLog = [
    "ERROR: Failed loading resource: res://missing.png.",
    "   at: _load (core/io/resource_loader.cpp:317)",
    "ERROR: Plugin is not attached to debugger.",
    "   at: is_active (editor/debugger/editor_debugger_plugin.cpp:102)",
  ].join("\n");

  it("reports one diagnostic per root cause", () => {
    const all = cleanup([
      { severity: "warning", file: "res://main.tscn", line: 4, message: "missing Texture2D: res://missing.png", source: "scan" },
      ...parseGodotLog(importLog, "import"),
      ...parseGodotLog(check, "check"),
    ]);
    expect(all.map(formatDiagnostic)).toEqual([
      'res://scripts/broken.gd:5: error: Parse Error: Identifier "undefined_name" not declared in the current scope.',
      "res://main.tscn:10: error: Parse Error: [ext_resource] referenced non-existent resource at: res://missing.png.",
    ]);
  });
});

describe("cleanup of a broken scene", () => {
  it("reports a scene once when Godot also says it failed to load", () => {
    const log = [
      "GODOTWRIGHT_BEGIN res://main.tscn",
      "ERROR: res://main.tscn:10 - Parse Error: [ext_resource] referenced non-existent resource at: res://missing.png.",
      "   at: _printerr (scene/resources/resource_format_text.cpp:41)",
      "ERROR: Failed to load scene: res://main.tscn",
      "GODOTWRIGHT_END res://main.tscn",
    ].join("\n");
    expect(cleanup(parseGodotLog(log, "check")).map(formatDiagnostic)).toEqual([
      "res://main.tscn:10: error: Parse Error: [ext_resource] referenced non-existent resource at: res://missing.png.",
    ]);
  });
});

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
