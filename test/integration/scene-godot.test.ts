import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";
import { formatDiagnostic } from "../../src/check/log.js";
import { editScene } from "../../src/scene/edit.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

const MAIN = `extends Node2D

var ticks := 0


func _ready() -> void:
	var timer := $Timer as Timer
	if timer == null or not is_equal_approx(timer.wait_time, 0.25) or timer.process_mode != PROCESS_MODE_ALWAYS:
		push_error("Timer was not set up: %s" % timer)
	if not ($Box/Sprite as Sprite2D).texture:
		push_error("Sprite has no texture")
	if ($Enemy as Area2D) == null or ($Enemy as Area2D).get_script() == null:
		push_error("Enemy instance is missing its script")
	if not timer.timeout.is_connected(_on_timer_timeout):
		push_error("timeout is not connected")
	if has_node("Old"):
		push_error("Old was not removed")
	print("SCENE_OK")


func _on_timer_timeout() -> void:
	ticks += 1
`;

describe.skipIf(!GODOT)("scenes edited by Godotwright load in Godot", () => {
  it("adds, sets, connects, instances, attaches and removes, and Godot reads the result", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Scenes"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
      ".gitignore": ".godot/\n",
      "main.gd": MAIN,
      "enemy.gd": "extends Area2D\n",
      "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#478cbf"/></svg>\n',
      "enemy.tscn": '[gd_scene format=3]\n\n[node name="Enemy" type="Area2D"]\n',
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n\n[node name="Old" type="Node" parent="."]\n',
    });
    const scene = join(root, "main.tscn");
    const edit = (e: Parameters<typeof editScene>[1], file = scene) => editScene(file, e, { write: true });
    edit({ op: "attach_script", node: ".", script: "res://main.gd" });
    edit({ op: "add_node", parent: ".", name: "Timer", type: "Timer" });
    edit({ op: "set", node: "Timer", property: "wait_time", value: "0.25" });
    edit({ op: "set", node: "Timer", property: "process_mode", value: "ALWAYS" });
    edit({ op: "add_node", parent: ".", name: "Box", type: "Node2D" });
    edit({ op: "add_node", parent: "Box", name: "Sprite", type: "Sprite2D" });
    edit({ op: "set", node: "Box/Sprite", property: "position", value: "Vector2(8, 8)" });
    edit({ op: "attach_script", node: ".", script: "res://enemy.gd" }, join(root, "enemy.tscn"));
    edit({ op: "add_node", parent: ".", name: "Enemy", instance: "res://enemy.tscn" });
    edit({ op: "connect", from: "Timer", signal: "timeout", to: ".", method: "_on_timer_timeout" });
    edit({ op: "remove_node", node: "Old" });

    // The texture needs the import step to have run, so it goes in after a first check.
    const first = await checkProject(root, { godot: GODOT });
    expect(first.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    edit({ op: "set", node: "Box/Sprite", property: "texture", value: "res://icon.svg" });

    const result = await checkProject(root, { godot: GODOT, keepLogs: true, runFrames: 5 });
    for (const d of result.diagnostics) console.log(`[${d.source}] ${formatDiagnostic(d)}`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.output ?? "").toContain("SCENE_OK");
  });
});
