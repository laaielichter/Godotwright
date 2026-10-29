import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectSettings } from "../src/godot/project-settings.js";
import { SettingsError, editProjectSettings, eventLabel, formatSettingsPlan, inputEventText } from "../src/settings/edit.js";
import { DEMO, makeProject, runCli } from "./helpers.js";

function demo(): string {
  const dir = mkdtempSync(join(tmpdir(), "godotwright-settings-"));
  cpSync(DEMO, dir, { recursive: true });
  return dir;
}
const read = (root: string) => readFileSync(join(root, "project.godot"), "utf8");
const settings = (root: string) => parseProjectSettings(read(root));

/** Lines of `after` that are not in `before`, and the other way round: what changed, and nothing else. */
function changed(before: string, after: string): { gone: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  return { gone: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
}

describe("project settings edits", () => {
  it("sets a setting with the type Godot gives it, and leaves every other line as it was", () => {
    const root = demo();
    const before = read(root);
    const dry = editProjectSettings(root, { op: "set", key: "application/run/max_fps", value: "60" });
    expect(dry.written).toBe(false);
    expect(read(root)).toBe(before);
    expect(formatSettingsPlan(dry)).toContain("+ run/max_fps=60");
    const plan = editProjectSettings(root, { op: "set", key: "application/run/max_fps", value: "60" }, { write: true });
    expect(plan.review).toEqual({ before: 0, after: 0 });
    expect(changed(before, read(root))).toEqual({ gone: [], added: ["run/max_fps=60"] });
    expect(settings(root).values["application/run/max_fps"]).toBe(60);
    // Changing it again replaces the line in place.
    editProjectSettings(root, { op: "set", key: "application/run/max_fps", value: "144" }, { write: true });
    expect(changed(before, read(root)).added).toEqual(["run/max_fps=144"]);
    editProjectSettings(root, { op: "unset", key: "application/run/max_fps" }, { write: true });
    expect(read(root)).toBe(before);
  });

  it("writes floats, bools, strings and Godot values the way the editor does", () => {
    const root = demo();
    editProjectSettings(root, { op: "set", key: "rendering/scaling_3d/scale", value: "1" }, { write: true });
    editProjectSettings(root, { op: "set", key: "display/window/size/resizable", value: "False" }, { write: true });
    editProjectSettings(root, { op: "set", key: "application/config/description", value: 'A "quoted" game' }, { write: true });
    editProjectSettings(root, { op: "set", key: "application/run/main_scene", value: "res://scenes/player.tscn" }, { write: true });
    const text = read(root);
    expect(text).toContain("\nscaling_3d/scale=1.0\n");
    expect(text).toContain("\nwindow/size/resizable=false\n");
    expect(text).toContain('config/description="A \\"quoted\\" game"');
    const s = settings(root);
    expect(s.values["rendering/scaling_3d/scale"]).toBe(1);
    expect(s.description).toBe('A "quoted" game');
    expect(s.mainScene).toBe("res://scenes/player.tscn");
  });

  it("makes a missing section in name order", () => {
    const root = makeProject({ "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="S"\n\n[rendering]\n\nx=1\n' });
    editProjectSettings(root, { op: "set", key: "physics/common/physics_ticks_per_second", value: "120" }, { write: true });
    expect(read(root)).toBe('config_version=5\n\n[application]\n\nconfig/name="S"\n\n[physics]\n\ncommon/physics_ticks_per_second=120\n\n[rendering]\n\nx=1\n');
    editProjectSettings(root, { op: "set", key: "xr/openxr/enabled", value: "true" }, { write: true });
    expect(read(root).endsWith("x=1\n\n[xr]\n\nopenxr/enabled=true\n")).toBe(true);
  });

  it("refuses values of the wrong type, missing files and the wrong op; warns about unknown settings", () => {
    const root = demo();
    expect(() => editProjectSettings(root, { op: "set", key: "display/window/size/viewport_width", value: "19x" })).toThrow(/is an int/);
    expect(() => editProjectSettings(root, { op: "set", key: "display/window/size/resizable", value: "yes" })).toThrow(/true or false/);
    expect(() => editProjectSettings(root, { op: "set", key: "application/run/main_scene", value: "res://nope.tscn" })).toThrow(/does not exist/);
    expect(() => editProjectSettings(root, { op: "set", key: "input/jump", value: "{}" })).toThrow(/input_add/);
    expect(() => editProjectSettings(root, { op: "unset", key: "application/run/max_fps" })).toThrow(/not set/);
    const typo = editProjectSettings(root, { op: "set", key: "display/window/size/viewport_widht", value: "1920" });
    expect(typo.warnings[0]).toMatch(/did you mean display\/window\/size\/viewport_width/);
  });

  it("adds an input action in the Godot 4 format and reads it back", () => {
    const root = demo();
    const before = read(root);
    const plan = editProjectSettings(root, { op: "input_add", action: "fire", events: ["Key:Ctrl+F", "Mouse:Left", "JoyButton:A", "JoyAxis:trigger_right+"] }, { write: true });
    expect(formatSettingsPlan(plan)).toContain("<Mouse:Left>");
    expect(changed(before, read(root)).gone).toEqual([]);
    const fire = settings(root).inputActions.find((a) => a.name === "fire");
    expect(fire).toEqual({ name: "fire", deadzone: 0.2, events: ["Key:Ctrl+F", "Mouse:Left", "JoyButton:0", "JoyAxis:5+"] });
  });

  it("adds events to an existing action, skips ones it has, and shows only the new line", () => {
    const root = demo();
    const plan = editProjectSettings(root, { op: "input_add", action: "jump", events: ["Key:W", "Key:Space"] }, { write: true });
    expect(plan.warnings).toEqual(["jump already has Key:Space"]);
    expect(plan.hunks.map((h) => [h.removed.length, h.added.length])).toEqual([[0, 1]]);
    expect(settings(root).inputActions.find((a) => a.name === "jump")?.events).toEqual(["Key:Space", "JoyButton:0", "Key:W"]);
    expect(() => editProjectSettings(root, { op: "input_add", action: "jump", events: ["Key:W"] })).toThrow(/already has Key:W/);
    // An action written on one line, with no events yet.
    const one = makeProject({ "project.godot": '[input]\nshoot={"deadzone": 0.5, "events": []}\n' });
    editProjectSettings(one, { op: "input_add", action: "shoot", events: ["Key:X"] }, { write: true });
    expect(settings(one).inputActions[0]?.events).toEqual(["Key:X"]);
  });

  it("removes an input action and warns when code still uses it", () => {
    const root = demo();
    const plan = editProjectSettings(root, { op: "input_remove", action: "jump" }, { write: true });
    expect(plan.warnings[0]).toMatch(/"jump" is still used in/);
    expect(settings(root).inputActions.some((a) => a.name === "jump")).toBe(false);
    expect(() => editProjectSettings(root, { op: "input_remove", action: "jump" })).toThrow(SettingsError);
  });

  it("knows keys, buttons and axes by name and refuses unknown ones", () => {
    expect(eventLabel(inputEventText("Key:space"))).toBe("Key:Space");
    expect(eventLabel(inputEventText("key:esc"))).toBe("Key:Escape");
    expect(eventLabel(inputEventText("Key:F5"))).toBe("Key:F5");
    expect(eventLabel(inputEventText("Key:Shift+PageUp"))).toBe("Key:Shift+PageUp");
    expect(eventLabel(inputEventText("Mouse:WheelDown"))).toBe("Mouse:WheelDown");
    expect(eventLabel(inputEventText("JoyAxis:left_y-"))).toBe("JoyAxis:1-");
    expect(() => inputEventText("Key:Spcae")).toThrow(/did you mean SPACE/);
    expect(() => inputEventText("Key:Hyper+A")).toThrow(/not a modifier/);
    expect(() => inputEventText("JoyAxis:0")).toThrow(/direction/);
    expect(() => inputEventText("Space")).toThrow(/not an input event/);
    expect(() => inputEventText("Pad:1")).toThrow(/not an input event kind/);
  });

  it("warns that a ui_ action replaces Godot's defaults", () => {
    const plan = editProjectSettings(demo(), { op: "input_add", action: "ui_accept", events: ["Key:Enter"] });
    expect(plan.warnings[0]).toMatch(/replaces its default events/);
  });

  it("adds and removes autoloads with checks on the name and the file", () => {
    const root = demo();
    const plan = editProjectSettings(root, { op: "autoload_add", name: "Music", file: "res://autoload/game_state.gd" }, { write: true });
    expect(plan.review).toEqual({ before: 0, after: 0 });
    expect(settings(root).autoloads.map((a) => a.name)).toEqual(["GameState", "Music"]);
    editProjectSettings(root, { op: "autoload_add", name: "Quiet", file: "res://autoload/game_state.gd", global: false }, { write: true });
    expect(settings(root).autoloads.find((a) => a.name === "Quiet")?.singleton).toBe(false);
    expect(() => editProjectSettings(root, { op: "autoload_add", name: "Music", file: "res://autoload/game_state.gd" })).toThrow(/already exists/);
    expect(() => editProjectSettings(root, { op: "autoload_add", name: "Input", file: "res://autoload/game_state.gd" })).toThrow(/Godot class/);
    expect(() => editProjectSettings(root, { op: "autoload_add", name: "Player", file: "res://autoload/game_state.gd" })).toThrow(/class_name/);
    expect(() => editProjectSettings(root, { op: "autoload_add", name: "X", file: "res://nope.gd" })).toThrow(/does not exist/);
    expect(() => editProjectSettings(root, { op: "autoload_add", name: "X", file: "res://icon.svg" })).toThrow(/script/);
    const removed = editProjectSettings(root, { op: "autoload_remove", name: "GameState" });
    expect(removed.warnings[0]).toMatch(/"GameState" is still used in 3 places/);
  });

  it("refuses an autoload script that is not a Node", () => {
    const root = makeProject({ "project.godot": "[application]\n", "data.gd": "extends Resource\n", "bare.gd": "func f() -> void:\n\tpass\n" });
    expect(() => editProjectSettings(root, { op: "autoload_add", name: "Data", file: "res://data.gd" })).toThrow(/not a Node/);
    expect(() => editProjectSettings(root, { op: "autoload_add", name: "Bare", file: "res://bare.gd" })).toThrow(/RefCounted/);
  });

  it("keeps Windows line ends and a BOM", () => {
    const root = makeProject({ "project.godot": '﻿[application]\r\n\r\nconfig/name="W"\r\n' });
    editProjectSettings(root, { op: "set", key: "application/run/max_fps", value: "30" }, { write: true });
    expect(read(root)).toBe('﻿[application]\r\n\r\nconfig/name="W"\r\nrun/max_fps=30\r\n');
  });

  it("runs from the CLI: set, input add, autoload add, with a dry run, --write and --json", async () => {
    const root = demo();
    const dry = await runCli(["project", "set", "application/run/max_fps", "60", root]);
    expect(dry.output).toContain("(dry run: add --write to apply)");
    const input = await runCli(["project", "input", "add", "dash", root, "--key", "Shift", "--joy-button", "B", "--write"]);
    expect(input.output).toContain("review errors: 0 before, 0 after");
    expect(settings(root).inputActions.find((a) => a.name === "dash")?.events).toEqual(["Key:Shift", "JoyButton:1"]);
    const json = JSON.parse((await runCli(["project", "autoload", "add", "Sfx", "res://autoload/game_state.gd", root, "--json"])).output) as { hunks: unknown[] };
    expect(json.hunks.length).toBe(1);
    const bad = await runCli(["project", "set", "display/window/size/viewport_width", "wide", root]);
    expect(bad.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
