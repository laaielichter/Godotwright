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
        rule: "structure/unknown-uid",
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
      "res://scripts/util.gd:12: error: something bad\n    called from res://scripts/main.gd:4 _ready()",
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

describe("runtime errors with their call chain (Godot 4.7.2 output)", () => {
  const out = [
    "SCRIPT ERROR: Invalid access to property or key 'basis' on a base object of type 'Nil'.",
    "          at: _downwash (res://main.gd:16)",
    "          GDScript backtrace (most recent call first):",
    "              [0] _downwash (res://main.gd:16)",
    "              [1] _apply (res://main.gd:12)",
    "              [2] _process (res://main.gd:7)",
  ].join("\n");

  it("keep the frames and count the repeats of one error", () => {
    const diags = parseGodotLog(`${out}\n${out}\n${out}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ file: "res://main.gd", line: 16, count: 3 });
    expect(diags[0]!.stack?.map((f) => `${f.function}@${f.line}`)).toEqual(["_downwash@16", "_apply@12", "_process@7"]);
    expect(formatDiagnostic(diags[0]!)).toBe(
      "res://main.gd:16: error: Invalid access to property or key 'basis' on a base object of type 'Nil'. (x3)\n    called from res://main.gd:12 _apply()\n    called from res://main.gd:7 _process()",
    );
  });

  it("keep the same error reached from two places apart", () => {
    const other = out.replace("[1] _apply (res://main.gd:12)", "[1] _land (res://main.gd:30)");
    expect(parseGodotLog(`${out}\n${other}\n`)).toHaveLength(2);
  });
});

describe("parseGodotLog: uid warnings carry the rule that predicts them", () => {
  // Printed by Godot 4.7.2 on --import and on load (test/fixtures/uid-integrity).
  const log = [
    "WARNING: UID duplicate detected between res://dup.tscn and res://child.tscn.",
    "WARNING: res://main.tscn:3 - ext_resource, invalid UID: uid://bstale0000001 - using text path instead: res://s.gd",
    "     at: load (scene/resources/resource_format_text.cpp:501)",
  ].join("\n");

  it("maps them to structure/duplicate-uid and structure/unknown-uid", () => {
    const diags = parseGodotLog(log, "import");
    expect(diags.map((d) => [d.file, d.line, d.rule])).toEqual([
      ["res://dup.tscn", undefined, "structure/duplicate-uid"],
      ["res://main.tscn", 3, "structure/unknown-uid"],
    ]);
    expect(formatDiagnostic(diags[1]!)).toBe("res://main.tscn:3: warning: ext_resource, invalid UID: uid://bstale0000001 - using text path instead: res://s.gd [structure/unknown-uid]");
  });
});
