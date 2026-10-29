import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";
import { formatDiagnostic } from "../../src/check/log.js";
import { editProjectSettings } from "../../src/settings/edit.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

const MAIN = `extends Node


func _ready() -> void:
	var want := {"fire": 4, "dash": 2}
	for action: String in want:
		if not InputMap.has_action(action):
			push_error("missing action %s" % action)
		elif InputMap.action_get_events(action).size() != want[action]:
			push_error("%s has %d events" % [action, InputMap.action_get_events(action).size()])
	var key := InputMap.action_get_events("fire")[0] as InputEventKey
	if key == null or key.physical_keycode != KEY_F or not key.ctrl_pressed:
		push_error("fire key is %s" % key)
	if Engine.max_fps != 30:
		push_error("max_fps is %d" % Engine.max_fps)
	if not has_node("/root/Music"):
		push_error("autoload Music is missing")
	print("SETTINGS_OK")
`;

describe.skipIf(!GODOT)("project settings written by Godotwright load in Godot", () => {
  it("reads the settings, input actions and autoloads back", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Settings"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
      ".gitignore": ".godot/\n",
      "main.gd": MAIN,
      "music.gd": "extends Node\n",
      "main.tscn": '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
    });
    const edit = (e: Parameters<typeof editProjectSettings>[1]) => editProjectSettings(root, e, { write: true });
    edit({ op: "set", key: "application/run/max_fps", value: "30" });
    edit({ op: "input_add", action: "fire", events: ["Key:Ctrl+F", "Mouse:Left", "JoyButton:A", "JoyAxis:trigger_right+"] });
    edit({ op: "input_add", action: "dash", events: ["Key:Shift"] });
    edit({ op: "input_add", action: "dash", events: ["JoyAxis:left_x-"] });
    edit({ op: "autoload_add", name: "Music", file: "res://music.gd" });

    const result = await checkProject(root, { godot: GODOT, keepLogs: true, runFrames: 5 });
    for (const d of result.diagnostics) console.log(`[${d.source}] ${formatDiagnostic(d)}`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.output ?? "").toContain("SETTINGS_OK");
  });
});
