import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { newCommand, presetCommand, translationsCommand } from "../src/commands/scaffold.js";
import { parsePresets } from "../src/export/export.js";
import { parseProjectSettings } from "../src/godot/project-settings.js";
import { parseShader } from "../src/godot/shader.js";
import { undoJournal } from "../src/journal/journal.js";
import { reviewProject } from "../src/review/review.js";
import { ScaffoldError } from "../src/scaffold/error.js";
import { exportPreset, formatExportPreset, valueText } from "../src/scaffold/presets.js";
import { ICON_SVG, formatNewProject, newProject } from "../src/scaffold/project.js";
import { SCRIPT_TEMPLATES, SHADER_KINDS, formatNewScript, formatNewShader, newScript, newShader, scriptTemplateText, type ScriptTemplate } from "../src/scaffold/script.js";
import { formatTranslations, parseCsv, readTranslationCsv, scriptStrings, translations, type TranslationCheck, type TranslationEdit, type TranslationList } from "../src/scaffold/translations.js";
import { makeProject, tempFolder } from "./helpers.js";

const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");
/** Review findings that count: errors and warnings. */
const problems = (root: string) => reviewProject(root).findings.filter((f) => f.severity !== "info").map((f) => `${f.severity} ${f.rule} ${f.file}:${f.line ?? 0} ${f.message}`);

const KEY = (code: number) =>
  `Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":${code},"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)`;
const ACTIONS = ["move_left", "move_right", "move_forward", "move_back", "jump"].map((a, i) => `${a}={\n"deadzone": 0.2,\n"events": [${KEY(65 + i)}\n]\n}`).join("\n");
const PROJECT = `config_version=5\n\n[application]\n\nconfig/name="S"\nconfig/features=PackedStringArray("4.7", "Forward Plus")\n\n[input]\n\n${ACTIONS}\n`;
/** Just enough of GUT and GdUnit4 for the test templates to resolve: the files the frameworks are found by, and the base classes. */
const FRAMEWORKS = {
  "addons/gut/gut_cmdln.gd": "extends SceneTree\n",
  "addons/gut/test.gd": "class_name GutTest\nextends Node\n\n\nfunc assert_eq(_got: Variant, _expected: Variant, _text: String = \"\") -> void:\n\tpass\n",
  "addons/gdUnit4/bin/GdUnitCmdTool.gd": "extends SceneTree\n",
  "addons/gdUnit4/src/GdUnitIntAssert.gd": "class_name GdUnitIntAssert\nextends RefCounted\n\n\nfunc is_equal(_expected: int) -> GdUnitIntAssert:\n\treturn self\n",
  "addons/gdUnit4/src/GdUnitTestSuite.gd": "class_name GdUnitTestSuite\nextends Node\n\n\nfunc assert_int(_current: int) -> GdUnitIntAssert:\n\treturn GdUnitIntAssert.new()\n",
};

describe("new project", () => {
  it("writes a project Godot 4.7 reads, in the project manager's shape, and the review finds nothing", () => {
    const dir = join(tempFolder("gw-new-"), "my-game");
    const r = newProject(dir, { name: 'My "Game"' });
    expect(r.created).toEqual(["project.godot", "main.tscn", "main.gd", "main.gd.uid", "icon.svg", ".gitignore", ".gitattributes"]);
    expect(r.skipped).toEqual([]);
    const text = read(dir, "project.godot");
    const s = parseProjectSettings(text);
    expect(s.configVersion).toBe(5);
    expect(s.name).toBe('My "Game"');
    expect(s.features).toEqual(["4.7", "Forward Plus"]);
    expect(s.icon).toBe("res://icon.svg");
    // Forward+ is the default: no [rendering] section, as the project manager writes it.
    expect(text).not.toContain("[rendering]");
    expect(text).toMatch(/^; Engine configuration file\.\n/);
    expect(text).toContain('\nconfig_version=5\n\n[application]\n\nconfig/name="My \\"Game\\""\nrun/main_scene="uid://');
    const scene = read(dir, "main.tscn");
    expect(s.mainScene).toBe(/^\[gd_scene load_steps=2 format=3 uid="(uid:\/\/[a-y0-8]+)"\]/.exec(scene)?.[1]);
    expect(scene).toContain(`[ext_resource type="Script" uid="${read(dir, "main.gd.uid").trim()}" path="res://main.gd" id="1_main"]`);
    expect(scene).toContain('[node name="Main" type="Node2D"]\nscript = ExtResource("1_main")\n');
    expect(read(dir, "main.gd")).toBe("extends Node2D\n\n\nfunc _ready() -> void:\n\tpass\n");
    expect(read(dir, ".gitignore")).toMatch(/^\.godot\/$/m);
    expect(read(dir, ".gitignore")).toMatch(/^\*\.translation$/m);
    expect(read(dir, ".gitignore")).toMatch(/^\*\.pck$/m);
    expect(read(dir, ".gitattributes")).toContain("* text=auto eol=lf");
    expect(read(dir, ".gitattributes")).not.toContain("merge=godotwright");
    expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
    expect(read(dir, "icon.svg")).toBe(ICON_SVG);
    expect(ICON_SVG).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(problems(dir)).toEqual([]);
    expect(formatNewProject(r)).toContain("created 7: project.godot");
  });

  it("writes the renderer settings, the root type, the merge lines and .mcp.json when asked", () => {
    const base = tempFolder("gw-new-");
    newProject(join(base, "m"), { renderer: "mobile", kind: "3d" });
    expect(read(join(base, "m"), "project.godot")).toContain('config/features=PackedStringArray("4.7", "Mobile")\nconfig/icon="res://icon.svg"\n\n[rendering]\n\nrenderer/rendering_method="mobile"\n');
    expect(read(join(base, "m"), "main.tscn")).toContain('type="Node3D"');
    expect(parseProjectSettings(read(join(base, "m"), "project.godot")).name).toBe("m");

    const c = newProject(join(base, "c"), { renderer: "gl_compatibility", kind: "ui", mergeDriver: true, mcp: true });
    const text = read(c.project, "project.godot");
    expect(text).toContain('PackedStringArray("4.7", "GL Compatibility")');
    expect(text).toMatch(/\[rendering\]\n\nrenderer\/rendering_method="gl_compatibility"\nrenderer\/rendering_method\.mobile="gl_compatibility"\n$/);
    expect(read(c.project, "main.tscn")).toContain('[node name="Main" type="Control"]\nlayout_mode = 3\nanchors_preset = 15\n');
    expect(read(c.project, "main.gd")).toMatch(/^extends Control\n/);
    for (const line of ["*.tscn merge=godotwright", "*.tres merge=godotwright", "project.godot merge=godotwright"]) expect(read(c.project, ".gitattributes")).toContain(`\n${line}\n`);
    expect(JSON.parse(read(c.project, ".mcp.json"))).toEqual({ mcpServers: { godotwright: { command: "npx", args: ["-y", "godotwright", "mcp", "--tier", "premium"] } } });
    expect(problems(c.project)).toEqual([]);
    expect(problems(join(base, "m"))).toEqual([]);
    expect(() => newProject(join(base, "x"), { renderer: "vulkan" as never })).toThrow(/forward_plus, mobile or gl_compatibility/);
    expect(() => newProject(join(base, "x"), { kind: "4d" as never })).toThrow(ScaffoldError);
    expect(existsSync(join(base, "x"))).toBe(false);
  });

  it("refuses a folder with a project or with files, and with force never overwrites a file", () => {
    const has = makeProject({ "project.godot": "config_version=5\n" });
    expect(() => newProject(has)).toThrow(/already has a project\.godot/);
    expect(() => newProject(has, { force: true })).toThrow(/already has a project\.godot/);
    expect(read(has, "project.godot")).toBe("config_version=5\n");

    const full = makeProject({ "README.md": "mine\n", ".gitignore": "node_modules/\n", "main.gd": "extends Node\n" });
    expect(() => newProject(full)).toThrow(/is not empty/);
    expect(existsSync(join(full, "project.godot"))).toBe(false);
    const r = newProject(full, { force: true });
    expect(r.skipped).toEqual(["main.gd", ".gitignore"]);
    expect(r.created).toEqual(["project.godot", "main.tscn", "main.gd.uid", "icon.svg", ".gitattributes"]);
    expect(read(full, ".gitignore")).toBe("node_modules/\n");
    expect(read(full, "main.gd")).toBe("extends Node\n");
    expect(read(full, "README.md")).toBe("mine\n");
    expect(formatNewProject(r)).toContain("skipped 2 (already there, not overwritten): main.gd, .gitignore");

    const file = join(tempFolder("gw-new-"), "f");
    writeFileSync(file, "x");
    expect(() => newProject(file)).toThrow(/is a file/);
    // An empty folder that exists is fine.
    const empty = tempFolder("gw-new-");
    expect(newProject(empty).created).toHaveLength(7);
  });
});

describe("new script", () => {
  it("every template is typed and passes the review with no errors or warnings", () => {
    const root = makeProject({ "project.godot": PROJECT, ...FRAMEWORKS });
    for (const template of SCRIPT_TEMPLATES) {
      const file = template.startsWith("test_") ? `res://test/test_${template}.gd` : `res://scripts/${template}.gd`;
      const r = newScript(root, file, { template });
      expect(r.written, template).toBe(true);
      expect(r.review, template).toEqual({ errors: 0, warnings: 0 });
      expect(r.notes.join("\n"), template).not.toMatch(/not installed/);
      expect(read(root, file.slice(6)), template).toBe(r.text);
      expect(read(root, `${file.slice(6)}.uid`).trim(), template).toBe(r.uid);
      // No untyped declarations: every var and every function says its type.
      for (const line of r.text.split("\n")) {
        if (/^\s*(@\w+(\(.*\))?\s+)?var /.test(line)) expect(line, `${template}: ${line}`).toMatch(/var \w+: /);
        if (/^\s*func /.test(line)) expect(line, `${template}: ${line}`).toMatch(/\) -> \w+:$/);
      }
      expect(r.text.endsWith("\n") && !r.text.endsWith("\n\n"), template).toBe(true);
      expect(r.text, template).not.toMatch(/ {2,}\S|[ \t]\n/);
    }
    // With class names, and the 3D trigger, too.
    newScript(root, "res://scripts/item.gd", { template: "resource", className: "ItemData" });
    newScript(root, "res://scripts/machine2.gd", { template: "state_machine", className: "StateMachine" });
    newScript(root, "res://scripts/trigger3d.gd", { template: "area_trigger", dimension: "3d" });
    newScript(root, "res://scripts/sprite.gd", { base: "Sprite2D", className: "Blinker" });
    expect(read(root, "scripts/item.gd")).toMatch(/^class_name ItemData\nextends Resource\n\n@export var display_name: String = ""\n/);
    expect(read(root, "scripts/trigger3d.gd")).toContain("extends Area3D\n## Emits");
    expect(read(root, "scripts/trigger3d.gd")).toContain("func _on_body_entered(body: Node3D) -> void:");
    expect(read(root, "scripts/sprite.gd")).toBe("class_name Blinker\nextends Sprite2D\n\n\nfunc _ready() -> void:\n\tpass\n");
    // The throwaway project has no main scene; everything else is clean.
    expect(problems(root).filter((p) => !p.includes("res://project.godot"))).toEqual([]);
    // Not even an info, apart from "nothing uses this script yet", which is true of any new script.
    expect(reviewProject(root).findings.filter((f) => /^res:\/\/(scripts|test)\//.test(f.file) && f.rule !== "structure/unused-script")).toEqual([]);
  });

  it("names the input actions a character reads, and which are missing", () => {
    const root = makeProject({ "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="S"\n\n[input]\n\njump={\n"deadzone": 0.2,\n"events": []\n}\n' });
    const r = newScript(root, "player.gd", { template: "character_2d", write: false });
    expect(r.file).toBe("res://player.gd");
    expect(r.written).toBe(false);
    expect(existsSync(join(root, "player.gd"))).toBe(false);
    expect(r.extends).toBe("CharacterBody2D");
    expect(r.inputActions).toEqual([
      { name: "move_left", event: "Key:A", defined: false },
      { name: "move_right", event: "Key:D", defined: false },
      { name: "jump", event: "Key:Space", defined: true },
    ]);
    expect(r.text).toContain('var _gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")');
    expect(r.text).toContain("\tmove_and_slide()\n");
    for (const a of r.inputActions) expect(r.text).toContain(`&"${a.name}"`);
    const out = formatNewScript(r);
    expect(out).toContain("input actions it reads: move_left (missing), move_right (missing), jump");
    expect(out).toContain("add: godot_project_edit input_add move_left Key:A");
    expect(out).toContain("(dry run: nothing written)");
    const three = newScript(root, "p3.gd", { template: "character_3d", write: false });
    expect(three.inputActions.map((a) => a.name)).toEqual(["move_left", "move_right", "move_forward", "move_back", "jump"]);
    expect(three.text).toContain('ProjectSettings.get_setting("physics/3d/default_gravity")');
    expect(scriptTemplateText("state_machine")).toContain("class State extends RefCounted:");
  });

  it("refuses to overwrite, bad names and bad paths, and undo removes what it wrote", () => {
    const root = makeProject({ "project.godot": PROJECT, "a.gd": "extends Node\n", "hero.gd": "class_name Hero\nextends Node\n" });
    expect(() => newScript(root, "res://a.gd")).toThrow(/already exists/);
    expect(read(root, "a.gd")).toBe("extends Node\n");
    expect(() => newScript(root, "res://../out.gd")).toThrow(/not a path inside the project/);
    expect(() => newScript(root, "/etc/x.gd")).toThrow(ScaffoldError);
    expect(() => newScript(root, "res://x.txt")).toThrow(/ends in \.gd/);
    expect(() => newScript(root, "res://x.gd", { template: "nope" as ScriptTemplate })).toThrow(/not a script template/);
    expect(() => newScript(root, "res://x.gd", { className: "Node2D" })).toThrow(/is a Godot class/);
    expect(() => newScript(root, "res://x.gd", { className: "Hero" })).toThrow(/already used by res:\/\/hero\.gd/);
    expect(() => newScript(root, "res://x.gd", { className: "2bad" })).toThrow(/not a usable class_name/);
    expect(() => newScript(root, "res://x.gd", { base: "Nope" })).toThrow(/not a Godot/);
    expect(existsSync(join(root, "x.gd"))).toBe(false);
    // The test templates say when the framework is not there.
    expect(newScript(root, "res://test/test_a.gd", { template: "test_gut", write: false }).notes.join("\n")).toMatch(/GUT \(res:\/\/addons\/gut\) is not installed/);
    expect(newScript(root, "res://test/a.gd", { template: "test_gut", write: false }).notes.join("\n")).toMatch(/only collects files that start with test_/);

    const r = newScript(root, "res://deep/dir/b.gd", { template: "autoload" });
    expect(r.journal).toBeGreaterThan(0);
    expect(existsSync(join(root, "deep/dir/b.gd.uid"))).toBe(true);
    const undone = undoJournal(root);
    expect(undone.undone[0]?.removed.sort()).toEqual(["res://deep/dir/b.gd", "res://deep/dir/b.gd.uid"]);
    expect(existsSync(join(root, "deep/dir/b.gd"))).toBe(false);
  });
});

describe("new shader", () => {
  it("every kind parses, has its entry function, and passes the static shader review", () => {
    const root = makeProject({ "project.godot": PROJECT });
    const entry: Record<string, string[]> = { canvas_item: ["fragment"], spatial: ["fragment"], particles: ["start", "process"], sky: ["sky"], fog: ["fog"] };
    for (const kind of SHADER_KINDS) {
      const r = newShader(root, `res://shaders/${kind}.gdshader`, kind);
      expect(r.review, kind).toEqual({ errors: 0, warnings: 0 });
      const parsed = parseShader(r.text);
      expect(parsed.type, kind).toBe(kind);
      expect(parsed.functions.map((f) => f.name), kind).toEqual(entry[kind]);
      expect(r.text.startsWith(`shader_type ${kind};\n\n`), kind).toBe(true);
      expect(read(root, `shaders/${kind}.gdshader.uid`).trim()).toBe(r.uid);
      expect(formatNewShader(r)).toContain(`new shader res://shaders/${kind}.gdshader (${kind}) written`);
    }
    // The whole project, shaders included: no finding of any severity in a shader.
    expect(reviewProject(root).findings.filter((f) => f.file.endsWith(".gdshader"))).toEqual([]);
    expect(() => newShader(root, "res://shaders/sky.gdshader", "sky")).toThrow(/already exists/);
    expect(() => newShader(root, "res://s.gdshader", "compute" as never)).toThrow(/not a shader kind/);
    expect(() => newShader(root, "res://s.gd", "sky")).toThrow(/\.gdshader/);
    expect(newShader(root, "res://dry.gdshader", "fog", { write: false }).written).toBe(false);
    expect(existsSync(join(root, "dry.gdshader"))).toBe(false);
  });
});

const LINUX = '[preset.0]\n\nname="Linux"\nplatform="Linux"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path="build/game.x86_64"\n\n[preset.0.options]\n\nbinary_format/embed_pck=false\n';

describe("export presets", () => {
  it("adds the first preset in Godot's shape, dry run first", () => {
    const root = makeProject({ "project.godot": PROJECT });
    expect(exportPreset(root, "list").presets).toEqual([]);
    const args = { platform: "windows", export_path: "build/game.exe", include_filter: "*.json", options: { "binary_format/embed_pck": true, "application/product_name": "My Game", "application/file_version": '"1.0"', "texture_format/s3tc_bptc": "true" } };
    const dry = exportPreset(root, "add", args);
    expect(dry.written).toBe(false);
    expect(existsSync(join(root, "export_presets.cfg"))).toBe(false);
    expect(formatExportPreset(dry)).toContain('+ name="Windows Desktop"');
    expect(dry.notes.join("\n")).toMatch(/Godot fills in the platform's other options with their defaults/);
    const r = exportPreset(root, "add", args, { write: true });
    expect(r.written).toBe(true);
    expect(read(root, "export_presets.cfg")).toBe(
      '[preset.0]\n\nname="Windows Desktop"\nplatform="Windows Desktop"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter="*.json"\nexclude_filter=""\nexport_path="build/game.exe"\n\n[preset.0.options]\n\nbinary_format/embed_pck=true\napplication/product_name="My Game"\napplication/file_version="1.0"\ntexture_format/s3tc_bptc=true\n',
    );
    expect(r.presets[0]).toMatchObject({ index: 0, name: "Windows Desktop", platform: "Windows Desktop", runnable: true, include: ["*.json"], exportPath: "build/game.exe" });
    expect(r.presets[0]?.options["application/product_name"]).toBe('"My Game"');
    // Undo takes the new file away again.
    undoJournal(root);
    expect(existsSync(join(root, "export_presets.cfg"))).toBe(false);
  });

  it("adds with the next free number, a unique name, and one runnable preset per platform", () => {
    const root = makeProject({ "project.godot": PROJECT, "export_presets.cfg": LINUX });
    const r = exportPreset(root, "add", { platform: "Linux" }, { write: true });
    expect(r.presets.map((p) => `${p.index} ${p.name} ${p.runnable}`)).toEqual(["0 Linux true", "1 Linux 2 false"]);
    const text = read(root, "export_presets.cfg");
    expect(text.startsWith(LINUX)).toBe(true);
    expect(text.slice(LINUX.length)).toBe('\n[preset.1]\n\nname="Linux 2"\nplatform="Linux"\nrunnable=false\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path=""\n\n[preset.1.options]\n\n');
    for (const platform of ["macOS", "Web", "Android", "iOS"]) exportPreset(root, "add", { platform }, { write: true });
    expect(parsePresets(read(root, "export_presets.cfg")).map((p) => `${p.index} ${p.platform}`)).toEqual(["0 Linux", "1 Linux", "2 macOS", "3 Web", "4 Android", "5 iOS"]);
    expect(() => exportPreset(root, "add", { platform: "Web", name: "Linux" })).toThrow(/already exists/);
    expect(() => exportPreset(root, "add", { platform: "Switch" })).toThrow(/not an export platform/);
    expect(() => exportPreset(root, "add", { platform: "Web", export_filter: "everything" })).toThrow(/export_filter is one of/);
    expect(exportPreset(root, "add", { platform: "Linux", runnable: true }).warnings.join("\n")).toMatch(/already has a runnable preset/);
    expect(formatExportPreset(exportPreset(root, "list"))).toContain('  0 "Linux" Linux runnable filter=all_resources path=build/game.x86_64 options=1\n      binary_format/embed_pck=false');
  });

  it("sets keys and options of one preset and leaves every other line as it was", () => {
    const two = `${LINUX}\n[preset.1]\n\nname="Web"\nplatform="Web"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path=""\n\n[preset.1.options]\n\n`;
    const root = makeProject({ "project.godot": PROJECT, "export_presets.cfg": two });
    const dry = exportPreset(root, "set", { preset: "Web", set: { export_path: "build/web/index.html", runnable: false }, options: { "variant/thread_support": true } });
    expect(read(root, "export_presets.cfg")).toBe(two);
    expect(dry.summary).toBe('set preset.1 "Web": export_path, runnable, options/variant/thread_support');
    exportPreset(root, "set", { preset: "Web", set: { export_path: "build/web/index.html", runnable: false }, options: { "variant/thread_support": true } }, { write: true });
    const text = read(root, "export_presets.cfg");
    expect(text.startsWith(LINUX)).toBe(true);
    expect(text.slice(LINUX.length)).toBe('\n[preset.1]\n\nname="Web"\nplatform="Web"\nrunnable=false\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path="build/web/index.html"\n\n[preset.1.options]\n\nvariant/thread_support=true\n');
    // By number, an existing option replaced in place, a key added at the end of the section, an option removed.
    exportPreset(root, "set", { preset: 0, options: { "binary_format/embed_pck": "true" }, set: { script_export_mode: 2, name: "Linux x86" } }, { write: true });
    expect(read(root, "export_presets.cfg")).toContain('name="Linux x86"\nplatform="Linux"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path="build/game.x86_64"\nscript_export_mode=2\n\n[preset.0.options]\n\nbinary_format/embed_pck=true\n\n[preset.1]');
    exportPreset(root, "set", { preset: "Linux x86", unset: ["options/binary_format/embed_pck", "script_export_mode"] }, { write: true });
    expect(read(root, "export_presets.cfg")).toContain('export_path="build/game.x86_64"\n\n[preset.0.options]\n\n\n[preset.1]');
    expect(() => exportPreset(root, "set", { preset: "Linux x86", set: { name: "Web" } })).toThrow(/already named/);
    expect(() => exportPreset(root, "set", { preset: "Web", set: { platform: "Linux" } })).toThrow(/platform of a preset cannot be changed/);
    expect(() => exportPreset(root, "set", { preset: "Web", set: { runnable: false } })).toThrow(/nothing to change/);
    expect(() => exportPreset(root, "set", { preset: "Nope", set: { runnable: false } })).toThrow(/no export preset "Nope"; the presets are 0 "Linux x86", 1 "Web"/);
    expect(() => exportPreset(root, "set", { preset: "Web" })).toThrow(/nothing to change/);
    expect(() => exportPreset(root, "set", { preset: "Web", unset: ["nope"] })).toThrow(/nope is not set/);
  });

  it("removes a preset and renumbers the ones after it; undo puts it back", () => {
    const root = makeProject({ "project.godot": PROJECT, "export_presets.cfg": LINUX });
    exportPreset(root, "add", { platform: "Web", options: { "variant/thread_support": false } }, { write: true });
    exportPreset(root, "add", { platform: "macOS", export_path: "build/game.zip" }, { write: true });
    const before = read(root, "export_presets.cfg");
    const dry = exportPreset(root, "remove", { preset: "Linux" });
    expect(read(root, "export_presets.cfg")).toBe(before);
    expect(dry.presets.map((p) => `${p.index} ${p.name}`)).toEqual(["0 Web", "1 macOS"]);
    expect(dry.notes.join("\n")).toMatch(/2 later presets moved down one number/);
    exportPreset(root, "remove", { preset: "Linux" }, { write: true });
    expect(read(root, "export_presets.cfg")).toBe(
      '[preset.0]\n\nname="Web"\nplatform="Web"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path=""\n\n[preset.0.options]\n\nvariant/thread_support=false\n\n[preset.1]\n\nname="macOS"\nplatform="macOS"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path="build/game.zip"\n\n[preset.1.options]\n\n',
    );
    undoJournal(root);
    expect(read(root, "export_presets.cfg")).toBe(before);
    // The last and the middle one.
    exportPreset(root, "remove", { preset: 1 }, { write: true });
    expect(parsePresets(read(root, "export_presets.cfg")).map((p) => `${p.index} ${p.name}`)).toEqual(["0 Linux", "1 macOS"]);
    exportPreset(root, "remove", { preset: "macOS" }, { write: true });
    expect(read(root, "export_presets.cfg")).toBe(LINUX);
    exportPreset(root, "remove", { preset: "0" }, { write: true });
    expect(exportPreset(root, "list").presets).toEqual([]);
    expect(() => exportPreset(root, "remove", { preset: "Linux" })).toThrow(/no export preset/);
  });

  it("keeps CRLF files CRLF, warns about a gap in the numbers, and writes values as Godot text", () => {
    const root = makeProject({ "project.godot": PROJECT, "export_presets.cfg": LINUX.replace(/\n/g, "\r\n") });
    exportPreset(root, "set", { preset: 0, set: { exclude_filter: "tests/*" } }, { write: true });
    expect(read(root, "export_presets.cfg")).toBe(LINUX.replace('exclude_filter=""', 'exclude_filter="tests/*"').replace(/\n/g, "\r\n"));
    const gap = makeProject({ "project.godot": PROJECT, "export_presets.cfg": LINUX.replace(/preset\.0/g, "preset.1") });
    expect(exportPreset(gap, "list").warnings.join("\n")).toMatch(/preset\.0 is missing/);
    expect(() => exportPreset(gap, "add", { platform: "Web" })).toThrow(/not numbered without gaps/);
    expect(valueText(true)).toBe("true");
    expect(valueText(3)).toBe("3");
    expect(valueText("false")).toBe("false");
    expect(valueText("1.5")).toBe("1.5");
    expect(valueText('"1.5"')).toBe('"1.5"');
    expect(valueText("My Game")).toBe('"My Game"');
    expect(valueText('say "hi"')).toBe('"say \\"hi\\""');
    expect(valueText('PackedStringArray("res://a.tscn")')).toBe('PackedStringArray("res://a.tscn")');
    expect(valueText("com.example.game")).toBe('"com.example.game"');
    expect(valueText("")).toBe('""');
  });
});

const CSV = 'keys,en,nl,_notes\nMENU_START,Start,Starten,main menu\nMENU_QUIT,Quit,,\nMENU_OLD,Old,Oud,\nHUD_SCORE,"Score: %d, ""best""",Score: %d,\nDYN_A,A,A,\n';
const TR_PROJECT = {
  "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="T"\n\n[internationalization]\n\nlocale/translations=PackedStringArray("res://i18n/text.en.translation", "res://gone.po")\n',
  "i18n/text.csv": CSV,
  "i18n/text.csv.import": '[remap]\n\nimporter="csv_translation"\ntype="Translation"\n',
  "i18n/extra.po": 'msgid ""\nmsgstr ""\n\nmsgid "PO_KEY"\nmsgstr "Po"\n',
  "data/table.csv": "id,hp\n1,5\n",
  "data/table.csv.import": '[remap]\n\nimporter="keep"\n',
  "main.gd":
    'extends Node\n\n\nfunc _ready() -> void:\n\t# tr("IN_COMMENT")\n\tprint(tr("MENU_START"), tr(&"MENU_MISSING"), tr("PO_KEY"), "not tr(\\"IN_STRING\\")")\n\tprint(TranslationServer.translate(\n\t\t"SERVER_MISSING"))\n\tvar key: String = "DYN_" + "A"\n\tprint(tr(key), str("NOT_TR"))\n\tvar table: Array[String] = ["HUD_SCORE"]\n\tprint(table)\n',
  "menu.tscn": '[gd_scene format=3]\n\n[node name="Menu" type="Control"]\n\n[node name="Quit" type="Button" parent="."]\ntext = "MENU_QUIT"\n\n[node name="New" type="Button" parent="."]\ntext = "MENU_NEW_GAME"\ntooltip_text = "Plain words"\n\n[node name="Icon" type="Node" parent="."]\nmetadata/id = "NOT_A_TEXT_PROP"\n',
};

describe("translations", () => {
  it("lists registered files and the CSV and PO files that are not registered", () => {
    const root = makeProject(TR_PROJECT);
    const r = translations(root, "list") as TranslationList;
    expect(r.registered).toEqual([
      { file: "res://i18n/text.en.translation", exists: false, source: "res://i18n/text.csv" },
      { file: "res://gone.po", exists: false },
    ]);
    // The data CSV (importer keep) is not a translation.
    expect(r.unregistered).toEqual([
      { file: "res://i18n/extra.po", kind: "po", adds: ["res://i18n/extra.po"] },
      { file: "res://i18n/text.csv", kind: "csv", locales: ["en", "nl"], adds: ["res://i18n/text.nl.translation"] },
    ]);
    const out = formatTranslations(r);
    expect(out).toContain("translations: 2 registered, 2 files not registered");
    expect(out).toContain("res://gone.po (missing)");
    expect(out).toContain("res://i18n/text.en.translation (made from res://i18n/text.csv on import)");
  });

  it("adds and removes files in the setting through the project.godot writer, dry run first", () => {
    const root = makeProject(TR_PROJECT);
    const before = read(root, "project.godot");
    const dry = translations(root, "add", { file: "res://i18n/text.csv" }) as TranslationEdit;
    expect(dry.entries).toEqual(["res://i18n/text.nl.translation"]);
    expect(dry.plan.written).toBe(false);
    expect(read(root, "project.godot")).toBe(before);
    const done = translations(root, "add", { file: "res://i18n/text.csv" }, { write: true }) as TranslationEdit;
    expect(done.plan.written).toBe(true);
    expect(read(root, "project.godot")).toContain('locale/translations=PackedStringArray("res://i18n/text.en.translation", "res://gone.po", "res://i18n/text.nl.translation")\n');
    expect(formatTranslations(done)).toContain("translations add res://i18n/text.csv: res://i18n/text.nl.translation");
    expect(() => translations(root, "add", { file: "res://i18n/text.csv" })).toThrow(/already registered/);
    translations(root, "add", { file: "i18n/extra.po" }, { write: true });
    expect((translations(root, "list") as TranslationList).unregistered).toEqual([]);
    expect(() => translations(root, "add", { file: "res://nope.po" })).toThrow(/does not exist/);
    expect(() => translations(root, "add", { file: "res://main.gd" })).toThrow(/\.csv or \.po or \.translation/);
    expect(() => translations(root, "add", {})).toThrow(/needs a file/);

    // Removing the CSV takes out every .translation made from it; undo brings the setting back.
    const removed = translations(root, "remove", { file: "res://i18n/text.csv" }, { write: true }) as TranslationEdit;
    expect(removed.entries).toEqual(["res://i18n/text.en.translation", "res://i18n/text.nl.translation"]);
    expect(removed.registered).toEqual(["res://gone.po", "res://i18n/extra.po"]);
    undoJournal(root);
    expect(read(root, "project.godot")).toContain("text.nl.translation");
    translations(root, "remove", { file: "res://i18n/text.csv" }, { write: true });
    translations(root, "remove", { file: "res://gone.po" }, { write: true });
    translations(root, "remove", { file: "res://i18n/extra.po" }, { write: true });
    // The last one out removes the setting itself.
    expect(read(root, "project.godot")).not.toContain("locale/translations");
    expect(() => translations(root, "remove", { file: "res://gone.po" })).toThrow(/is not registered/);

    // A project without the setting gets the section.
    const fresh = makeProject({ ...TR_PROJECT, "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="T"\n' });
    translations(fresh, "add", { file: "res://i18n/text.csv" }, { write: true });
    expect(read(fresh, "project.godot")).toContain('[internationalization]\n\nlocale/translations=PackedStringArray("res://i18n/text.en.translation", "res://i18n/text.nl.translation")');
  });

  it("checks a CSV: keys the code and scenes use that it lacks, unused keys, empty cells", () => {
    const root = makeProject(TR_PROJECT);
    const r = translations(root, "check", { file: "res://i18n/text.csv" }) as TranslationCheck;
    expect(r.locales).toEqual(["en", "nl"]);
    expect(r.keys).toBe(5);
    expect(r.missing).toEqual([
      { key: "MENU_MISSING", file: "res://main.gd", line: 6, kind: "script" },
      { key: "SERVER_MISSING", file: "res://main.gd", line: 8, kind: "script" },
      { key: "MENU_NEW_GAME", file: "res://menu.tscn", line: 9, kind: "scene" },
    ]);
    // MENU_QUIT is used by the scene, HUD_SCORE sits in a list; DYN_A is only built at run time, and the note says so.
    expect(r.unused).toEqual(["MENU_OLD", "DYN_A"]);
    expect(r.empty).toEqual({ nl: ["MENU_QUIT"] });
    expect(r.dynamic).toBe(1);
    expect(r.notes.join("\n")).toMatch(/1 tr\(\) call takes a key that is not a plain string/);
    expect(r.notes.join("\n")).toMatch(/1 key used in the project is not in this file but in another translation file/);
    expect(r.notes.join("\n")).toMatch(/not registered in internationalization\/locale\/translations: nl/);
    const out = formatTranslations(r);
    expect(out).toContain("translations check res://i18n/text.csv: 5 keys, locales en, nl: 3 missing, 2 unused, 1 empty cell");
    expect(out).toContain("  missing MENU_MISSING  res://main.gd:6 (script)");
    expect(out).toContain("  empty in nl: MENU_QUIT");
    expect(() => translations(root, "check", { file: "res://data/table.csv" })).not.toThrow();
    expect(() => translations(root, "check", { file: "res://nope.csv" })).toThrow(/does not exist/);
    expect(() => translations(root, "check", { file: "res://i18n/extra.po" })).toThrow(/\.csv/);
  });

  it("reads CSV fields and GDScript strings the careful way", () => {
    expect(parseCsv('a,"b,""c""",d\r\n"multi\nline",x\n\nlast').map((r) => r.fields)).toEqual([["a", 'b,"c"', "d"], ["multi\nline", "x"], ["last"]]);
    expect(parseCsv("a;b\n", ";")[0]?.fields).toEqual(["a", "b"]);
    const table = readTranslationCsv('keys,en,?context,_c,fr\nA,a,ctx,note,\n,skipped,,,\nA,again,,,x\n');
    expect(table.locales).toEqual(["en", "fr"]);
    expect(table.rows.map((r) => r.key)).toEqual(["A", "A"]);
    expect(table.duplicates).toEqual(["A"]);
    const s = scriptStrings('var a := "x # not a comment" # "comment"\nvar b := \'q"\' + """tri\n"ple""" + &"name" + r"raw\\n"\nprint(tr(\n\t"K"))\n');
    expect(s.strings.map((x) => x.value)).toEqual(["x # not a comment", 'q"', 'tri\n"ple', "name", "raw\\n", "K"]);
    expect(s.strings.at(-1)?.line).toBe(5);
    expect(s.strings.at(-1)?.before.trimEnd().endsWith("print(tr(")).toBe(true);
    expect(s.code).not.toContain("comment");
  });
});

describe("scaffold commands", () => {
  /** Runs one of the commands in-process, the way program.ts will once it adds them. */
  async function cli(args: string[]): Promise<{ output: string; exitCode: number }> {
    let output = "";
    const program = new Command("godotwright").exitOverride().configureOutput({ writeOut: (t) => (output += t), writeErr: (t) => (output += t) });
    for (const c of [newCommand(), presetCommand(), translationsCommand()]) program.addCommand(c);
    const stderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    process.exitCode = undefined;
    try {
      await program.parseAsync(args, { from: "user" });
    } finally {
      process.stderr.write = stderr;
    }
    const exitCode = process.exitCode === undefined ? 0 : Number(process.exitCode);
    process.exitCode = undefined;
    return { output, exitCode };
  }

  it("godotwright new project | script | shader", async () => {
    const dir = join(tempFolder("gw-cli-"), "game");
    const made = await cli(["new", "project", dir, "--name", "Cli Game", "--kind", "3d", "--renderer", "mobile", "--mcp"]);
    expect(made.exitCode).toBe(0);
    expect(made.output).toContain('new project "Cli Game"');
    expect(read(dir, "main.tscn")).toContain('type="Node3D"');
    expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
    const again = await cli(["new", "project", dir]);
    expect(again.exitCode).toBe(1);
    expect(again.output).toContain("already has a project.godot");

    const script = await cli(["new", "script", "res://player.gd", dir, "--template", "character_3d", "--class-name", "Player", "--json"]);
    expect(script.exitCode).toBe(0);
    expect(JSON.parse(script.output)).toMatchObject({ file: "res://player.gd", className: "Player", written: true, extends: "CharacterBody3D" });
    expect(read(dir, "player.gd")).toMatch(/^class_name Player\nextends CharacterBody3D\n/);
    expect((await cli(["new", "script", "res://player.gd", dir])).exitCode).toBe(1);
    const dry = await cli(["new", "script", "res://ui.gd", dir, "--template", "ui_control", "--dry-run"]);
    expect(dry.output).toContain("extends Control");
    expect(existsSync(join(dir, "ui.gd"))).toBe(false);
    const shader = await cli(["new", "shader", "res://fx/sky.gdshader", dir, "--kind", "sky"]);
    expect(shader.exitCode).toBe(0);
    expect(read(dir, "fx/sky.gdshader")).toMatch(/^shader_type sky;/);
  });

  it("godotwright preset and translations", async () => {
    const root = makeProject(TR_PROJECT);
    const dry = await cli(["preset", "add", "Windows Desktop", root, "--export-path", "build/game.exe", "--option", "binary_format/embed_pck=true", "--no-runnable"]);
    expect(dry.output).toContain("(dry run: add write to apply)");
    expect(existsSync(join(root, "export_presets.cfg"))).toBe(false);
    await cli(["preset", "add", "Windows Desktop", root, "--export-path", "build/game.exe", "--option", "binary_format/embed_pck=true", "--no-runnable", "--write"]);
    expect(read(root, "export_presets.cfg")).toContain('runnable=false\n');
    expect(read(root, "export_presets.cfg")).toContain("[preset.0.options]\n\nbinary_format/embed_pck=true\n");
    await cli(["preset", "set", "0", root, "--set", "name=Win", "--set", "runnable=true", "--write"]);
    expect((await cli(["preset", "list", root])).output).toContain('0 "Win" Windows Desktop runnable');
    expect((await cli(["preset", "set", "0", root, "--set", "broken"])).exitCode).toBe(1);
    const removed = await cli(["preset", "remove", "Win", root, "--write", "--json"]);
    expect(JSON.parse(removed.output).presets).toEqual([]);

    expect((await cli(["translations", "list", root])).output).toContain("not registered: res://i18n/text.csv [en, nl]");
    const add = await cli(["translations", "add", "res://i18n/text.csv", root, "--write"]);
    expect(add.exitCode).toBe(0);
    expect(read(root, "project.godot")).toContain("text.nl.translation");
    const check = await cli(["translations", "check", "res://i18n/text.csv", root, "--json"]);
    expect(JSON.parse(check.output).missing).toHaveLength(3);
    expect((await cli(["translations", "remove", "res://nope.po", root])).exitCode).toBe(1);
  });
});
