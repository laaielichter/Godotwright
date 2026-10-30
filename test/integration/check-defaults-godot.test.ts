import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

describe.skipIf(!GODOT)("check defaults found by watching small models work", () => {
  it("skips res://addons/ unless asked, and runs frames as game time so a timer fires", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Defaults"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
      ".gitignore": ".godot/\n",
      "main.gd": 'extends Node\n\n\nfunc _on_timer_timeout() -> void:\n\tprint("tick")\n',
      "main.tscn":
        '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n\n[node name="Timer" type="Timer" parent="."]\nautostart = true\n\n[connection signal="timeout" from="Timer" to="." method="_on_timer_timeout"]\n',
      // A third-party scene with a broken script reference, like the GUT addon's own scene in a project.
      "addons/thing/broken.tscn": '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://addons/thing/missing.gd" id="1"]\n\n[node name="Broken" type="Node"]\nscript = ExtResource("1")\n',
    });
    const quiet = await checkProject(root, { godot: GODOT, runFrames: 90 });
    expect(quiet.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // The 1 s timer fires within 90 frames because they are 1.5 s of game time.
    expect(quiet.output).toContain("tick");
    expect(quiet.ran).toEqual({ frames: 90, fps: 60, seconds: 1.5 });
    const all = await checkProject(root, { godot: GODOT, includeAddons: true, import: false });
    expect(all.diagnostics.some((d) => d.severity === "error" && (d.file ?? "").startsWith("res://addons/thing/"))).toBe(true);
  });
});
