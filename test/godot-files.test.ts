import { describe, expect, it } from "vitest";
import { describeInputEvent, keyName, parseProjectSettings } from "../src/godot/project-settings.js";
import { parseResourceFile } from "../src/godot/resource-file.js";
import { parseResourceText } from "../src/godot/scene.js";

describe("parseResourceFile", () => {
  it("reads headers, comments, quoted keys and multi-line values", () => {
    const sections = parseResourceFile(
      [
        "; comment",
        "config_version=5",
        "",
        "[application]",
        "",
        'config/name="Game"',
        '"key with space"=1',
        "list=[",
        "1,",
        "2",
        "]",
        "after=true",
      ].join("\n"),
    );
    expect(sections.map((s) => s.tag)).toEqual(["", "application"]);
    expect(sections[0]!.props).toEqual({ config_version: 5 });
    expect(sections[1]!.props).toEqual({ "config/name": "Game", "key with space": 1, list: [1, 2], after: true });
    expect(sections[1]!.propLines["after"]).toBe(12);
  });
});

describe("parseProjectSettings", () => {
  it("reads autoloads, features and input", () => {
    const settings = parseProjectSettings(
      [
        "config_version=5",
        "[application]",
        'config/name="Game"',
        'run/main_scene="uid://abc"',
        'config/features=PackedStringArray("4.7", "Mobile")',
        "[autoload]",
        'Events="*res://events.gd"',
        'Helper="res://helper.tscn"',
        "[input]",
        'fire={"deadzone": 0.5, "events": [Object(InputEventKey,"keycode":4194309,"ctrl_pressed":true)]}',
        "[editor_plugins]",
        'enabled=PackedStringArray("res://addons/a/plugin.cfg")',
      ].join("\n"),
    );
    expect(settings.name).toBe("Game");
    expect(settings.mainScene).toBe("uid://abc");
    expect(settings.godotVersion).toBe("4.7");
    expect(settings.renderer).toBe("Mobile");
    expect(settings.autoloads).toEqual([
      { name: "Events", path: "res://events.gd", singleton: true },
      { name: "Helper", path: "res://helper.tscn", singleton: false },
    ]);
    expect(settings.inputActions).toEqual([{ name: "fire", deadzone: 0.5, events: ["Key:Ctrl+Enter"] }]);
    expect(settings.plugins).toEqual(["res://addons/a/plugin.cfg"]);
  });

  it("names keys and input events", () => {
    expect(keyName(65)).toBe("A");
    expect(keyName(32)).toBe("Space");
    expect(keyName((1 << 22) | 0x1c)).toBe("F1");
    expect(keyName((1 << 22) | 0x01)).toBe("Escape");
    expect(describeInputEvent("InputEventMouseButton", { button_index: 2 })).toBe("Mouse:Right");
    expect(describeInputEvent("InputEventJoypadMotion", { axis: 1, axis_value: -1 })).toBe("JoyAxis:1-");
  });
});

describe("parseResourceText", () => {
  it("reads a scene with nodes, instances and connections", () => {
    const scene = parseResourceText(
      [
        '[gd_scene load_steps=3 format=3 uid="uid://scene1"]',
        "",
        '[ext_resource type="Script" uid="uid://s1" path="res://a.gd" id="1_a"]',
        '[ext_resource type="PackedScene" path="res://b.tscn" id="2_b"]',
        "",
        '[sub_resource type="CircleShape2D" id="CircleShape2D_1"]',
        "radius = 4.0",
        "",
        '[node name="Root" type="Node2D"]',
        'script = ExtResource("1_a")',
        "",
        '[node name="Child" parent="." instance=ExtResource("2_b")]',
        "",
        '[node name="Deep" type="Label" parent="Child" groups=["ui"]]',
        "unique_name_in_owner = true",
        'text = "two',
        'lines"',
        "",
        '[connection signal="pressed" from="Child" to="." method="_on_pressed"]',
      ].join("\n"),
    );
    expect(scene.kind).toBe("scene");
    expect(scene.uid).toBe("uid://scene1");
    expect(scene.extResources.map((r) => [r.id, r.type, r.path, r.uid])).toEqual([
      ["1_a", "Script", "res://a.gd", "uid://s1"],
      ["2_b", "PackedScene", "res://b.tscn", undefined],
    ]);
    expect(scene.subResources).toEqual([
      { id: "CircleShape2D_1", type: "CircleShape2D", line: 6, props: { radius: 4 }, propLines: { radius: 7 } },
    ]);
    expect(scene.nodes.map((n) => [n.path, n.type, n.scriptRef, n.instanceRef, n.groups, n.uniqueName])).toEqual([
      [".", "Node2D", "1_a", undefined, [], false],
      ["Child", undefined, undefined, "2_b", [], false],
      ["Child/Deep", "Label", undefined, undefined, ["ui"], true],
    ]);
    expect(scene.nodes[2]!.props["text"]).toBe("two\nlines");
    expect(scene.connections).toEqual([
      { signal: "pressed", from: "Child", to: ".", method: "_on_pressed", line: 19 },
    ]);
  });

  it("reads a resource with a script", () => {
    const res = parseResourceText(
      [
        '[gd_resource type="Resource" script_class="Stats" format=3]',
        '[ext_resource type="Script" path="res://stats.gd" id="1"]',
        "[resource]",
        'script = ExtResource("1")',
      ].join("\n"),
    );
    expect(res.kind).toBe("resource");
    expect(res.resourceType).toBe("Resource");
    expect(res.scriptRef).toBe("1");
  });

  it("keeps integer sub_resource ids from legacy scenes", () => {
    const scene = parseResourceText(
      [
        "[gd_scene load_steps=2 format=2]",
        "",
        '[sub_resource type="GDScript" id=1]',
        'script/source = "extends Node"',
        "",
        '[node name="Root" type="Node"]',
        "script = SubResource( 1 )",
      ].join("\n"),
    );
    expect(scene.subResources.map((s) => [s.id, s.type])).toEqual([["1", "GDScript"]]);
    expect(scene.nodes[0]!.builtinScriptRef).toBe("1");
  });
});
