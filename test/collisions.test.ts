import { describe, expect, it } from "vitest";
import { collisionMap, detects, findPhysics, formatBetween, formatBits, formatCollisions, layersOf, valueOf } from "../src/collisions/collisions.js";
import { DEMO, makeProject, runCli } from "./helpers.js";

const PROJECT = 'config_version=5\n\n[layer_names]\n\n2d_physics/layer_1="world"\n2d_physics/layer_2="player"\n2d_physics/layer_3="enemies"\n';
const SHAPE = '[sub_resource type="CircleShape2D" id="c"]\nradius = 8.0\n\n';
const shape = (parent: string) => `[node name="Shape" type="CollisionShape2D" parent="${parent}"]\nshape = SubResource("c")\n\n`;

function game(extra: Record<string, string> = {}): string {
  return makeProject({
    "project.godot": PROJECT,
    "player.tscn": `[gd_scene load_steps=3 format=3]\n\n[ext_resource type="Script" path="res://player.gd" id="1"]\n\n${SHAPE}[node name="Player" type="CharacterBody2D"]\ncollision_layer = 2\nscript = ExtResource("1")\n\n${shape(".")}[node name="Hitbox" type="Area2D" parent="."]\ncollision_layer = 0\ncollision_mask = 3\n\n${shape("Hitbox")}[node name="Feet" type="RayCast2D" parent="."]\n`,
    "player.gd": "class_name Hero\nextends CharacterBody2D\n",
    "enemy.tscn": `[gd_scene load_steps=2 format=3]\n\n${SHAPE}[node name="Enemy" type="CharacterBody2D"]\ncollision_layer = 4\ncollision_mask = 3\n\n${shape(".")}`,
    "level.tscn": `[gd_scene load_steps=3 format=3]\n\n[ext_resource type="PackedScene" path="res://enemy.tscn" id="1"]\n\n${SHAPE}[node name="Level" type="Node2D"]\n\n[node name="Ground" type="StaticBody2D" parent="."]\n\n${shape("Ground")}[node name="Boss" parent="." instance=ExtResource("1")]\ncollision_mask = 1\n\n[node name="Grunt" parent="." instance=ExtResource("1")]\n`,
    ...extra,
  });
}

describe("layer numbers and bit values", () => {
  it("converts both ways", () => {
    expect(layersOf(5)).toEqual([1, 3]);
    expect(layersOf(0)).toEqual([]);
    expect(layersOf(2147483648)).toEqual([32]);
    expect(valueOf([1, 3])).toBe(5);
    expect(valueOf([32])).toBe(2147483648);
    expect(formatBits(undefined, 6, [3])).toBe("value 6 = layers 2, 3\nlayer 3 = value 4  (collision_layer = 4, or set_collision_layer_value(n, true) per layer)\n");
    expect(formatBits(collisionMap(game()), 5, undefined)).toContain("  2D: 1 world, 3 enemies = 5");
  });
});

describe("the physics layers of a project", () => {
  it("lists every body, area and ray with layers and masks, instances with changed layers resolved", () => {
    const r = collisionMap(game());
    expect(r.problems).toEqual([]);
    expect(r.nodes.map((n) => [n.scene, n.node, n.class, n.role, n.layer, n.mask])).toEqual([
      ["res://enemy.tscn", "Enemy", "CharacterBody2D", "body", 4, 3],
      ["res://level.tscn", "Ground", "StaticBody2D", "body", 1, 1],
      ["res://level.tscn", "Boss", "CharacterBody2D", "body", 4, 1],
      ["res://player.tscn", "Player", "CharacterBody2D", "body", 2, 1],
      ["res://player.tscn", "Hitbox", "Area2D", "area", 0, 3],
      ["res://player.tscn", "Feet", "RayCast2D", "ray", 0, 1],
    ]);
    expect(r.nodes.filter((n) => n.root).map((n) => n.node)).toEqual(["Enemy", "Player"]);
    expect(r.nodes.find((n) => n.node === "Boss")?.instanceOf).toBe("res://enemy.tscn");
    expect(r.nodes.find((n) => n.node === "Player")?.className).toBe("Hero");
    expect(r.layers).toEqual([
      { dim: "2D", layer: 1, name: "world", on: 1, scannedBy: 6 },
      { dim: "2D", layer: 2, name: "player", on: 1, scannedBy: 2 },
      { dim: "2D", layer: 3, name: "enemies", on: 2, scannedBy: 0 },
    ]);
    const text = formatCollisions(r);
    expect(text).toMatch(/^collisions: 6 physics nodes in 3 files, 0 problems\n2D layers \(number, name, bit value\):\n  1 world = 1  on it: 1  scanned by: 6\n/);
    expect(text).toContain("  res://player.tscn Hitbox (Area2D)  layer none = 0  mask 1 world, 2 player = 3");
    expect(text).toContain("  res://player.tscn Feet (RayCast2D)  layer -  mask 1 world = 1");
    expect(text).toContain("  res://level.tscn Boss (CharacterBody2D)  layer 3 enemies = 4  mask 1 world = 1  (instance of res://enemy.tscn)");
  });

  it("says who detects whom, why, and the mask that fixes it", () => {
    const r = collisionMap(game());
    const one = (name: string) => findPhysics(r, name)[0]!;
    expect(detects(one("Enemy"), one("Hero"), r.names)).toEqual({ yes: true, why: "yes: its mask scans layer 2 player, where the other one is" });
    // The classic: collision_mask = 3 meant as "layer 3".
    expect(detects(one("Hitbox"), one("enemy.tscn"), r.names).why).toBe(
      "no: its mask scans 1 world, 2 player = 3, the other one is on 3 enemies = 4; collision_mask = 3 is a bit value, not layer 3 (fix: collision_mask = 7 on it, which adds layer 3; in code set_collision_mask_value(3, true))",
    );
    expect(detects(one("Enemy"), one("Hitbox"), r.names).why).toMatch(/^never: a body does not detect an area/);
    expect(detects(one("Ground"), one("Feet"), r.names).why).toMatch(/^never: a RayCast2D has no layer/);
    expect(detects(one("Feet"), one("Ground"), r.names).yes).toBe(true);
    const answer = formatBetween(r, "Player", "res://enemy.tscn");
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain("  Player detects Enemy: no: its mask scans 1 world = 1, the other one is on 3 enemies = 4 (fix: collision_mask = 5 on it");
    expect(answer.text).toContain("  two bodies: they collide, but only Enemy reacts (a body is only stopped by what its own mask scans)");
    const unknown = formatBetween(r, "Player", "Dragon");
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toMatch(/^no physics node is called "Dragon".*\nPhysics nodes: Enemy, Ground, Boss, Player, Hitbox, Feet\n$/);
    expect(findPhysics(r, "Area2D").map((n) => n.node)).toEqual(["Hitbox"]);
  });

  it("reports what can never work", () => {
    const root = game({
      "broken.tscn":
        `[gd_scene load_steps=2 format=3]\n\n${SHAPE}[node name="Broken" type="Node2D"]\n\n` +
        `[node name="Pickup" type="Area2D" parent="."]\nmonitoring = false\n\n${shape("Pickup")}` +
        `[node name="Blind" type="Area2D" parent="."]\ncollision_mask = 0\n\n${shape("Blind")}` +
        `[node name="Ghost" type="RigidBody2D" parent="."]\ncollision_layer = 0\ncollision_mask = 0\n\n${shape("Ghost")}` +
        '[node name="NoShape" type="StaticBody2D" parent="."]\n\n' +
        '[node name="Empty" type="CharacterBody2D" parent="."]\n\n[node name="Shape" type="CollisionShape2D" parent="Empty"]\n\n' +
        `[node name="Scanner" type="Area2D" parent="."]\ncollision_mask = 16\n\n${shape("Scanner")}` +
        '[connection signal="body_entered" from="Pickup" to="." method="_on_pickup"]\n',
    });
    const r = collisionMap(root);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => [p.node, p.rule])).toEqual([
      ["Pickup", "monitoring-off"],
      ["Blind", "detects-nothing"],
      ["Ghost", "touches-nothing"],
      ["NoShape", "no-shape"],
      ["Empty/Shape", "empty-shape"],
      ["Scanner", "mask-empty-layer"],
    ]);
    expect(r.problems[0]!.message).toMatch(/monitoring is off, so body_entered never fires \(res:\/\/broken\.tscn:\d+ connects it\)/);
    expect(r.problems[5]!.message).toBe("its mask scans layer 5, but nothing in the project is on that layer");
    expect(formatCollisions(r)).toContain("  5 (no name) = 16  on it: 0  scanned by: 1  <- nothing is on it");
  });

  it("is quiet where the scene is not the whole story: shapes and layers made in code, inherited scenes", () => {
    const root = game({
      "spawner.tscn": '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://spawner.gd" id="1"]\n\n[node name="Spawner" type="Area2D"]\ncollision_mask = 64\nscript = ExtResource("1")\n',
      "spawner.gd": "extends Area2D\n\nfunc _ready() -> void:\n\tvar s := CollisionShape2D.new()\n\tadd_child(s)\n\tcollision_layer = 64\n",
      "fast_enemy.tscn": '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="PackedScene" path="res://enemy.tscn" id="1"]\n\n[node name="Fast" instance=ExtResource("1")]\ncollision_mask = 1\n',
    });
    const r = collisionMap(root);
    expect(r.problems).toEqual([]);
    expect(r.inCode).toEqual([{ file: "res://spawner.gd", line: 6, text: "collision_layer = 64" }]);
    expect(r.nodes.find((n) => n.node === "Fast")).toMatchObject({ class: "CharacterBody2D", layer: 4, mask: 1, instanceOf: "res://enemy.tscn" });
    expect(formatCollisions(r)).toContain("code changes layers or masks in 1 place, so the scenes are not the whole story there:\n  res://spawner.gd:6  collision_layer = 64");
  });

  it("reads 3D nodes and TileSet physics layers, and keeps the two worlds apart", () => {
    const root = makeProject({
      "project.godot": "config_version=5\n",
      "world.tscn":
        '[gd_scene load_steps=2 format=3]\n\n[sub_resource type="BoxShape3D" id="b"]\n\n[node name="World" type="Node3D"]\n\n[node name="Floor" type="StaticBody3D" parent="."]\ncollision_layer = 3\n\n[node name="S" type="CollisionShape3D" parent="Floor"]\nshape = SubResource("b")\n\n[node name="Arm" type="SpringArm3D" parent="."]\n\n[node name="Hud" type="Area2D" parent="."]\n\n[node name="P" type="CollisionPolygon2D" parent="Hud"]\n',
      "tiles.tres": '[gd_resource type="TileSet" format=3]\n\n[resource]\nphysics_layer_0/collision_layer = 8\nphysics_layer_0/collision_mask = 0\n',
    });
    const r = collisionMap(root);
    expect(r.nodes.map((n) => [n.node, n.dim, n.role, n.layer, n.mask])).toEqual([
      ["TileSet physics layer 0", "2D", "tiles", 8, 0],
      ["Floor", "3D", "body", 3, 1],
      ["Arm", "3D", "ray", 0, 1],
      ["Hud", "2D", "area", 1, 1],
    ]);
    expect(detects(r.nodes[3]!, r.nodes[1]!, r.names).why).toBe("never: Area2D lives in the 2D physics world and StaticBody3D in the 3D one");
    expect(formatCollisions(r)).toMatch(/3D layers \(number, name, bit value\):\n  1 \(no name\) = 1  on it: 1  scanned by: 2\n  2 \(no name\) = 2  on it: 1  scanned by: 0\n  name layer 1, 2 \(godot_project_edit, layer_names\/3d_physics\/layer_N\)/);
  });

  it("has nothing to say about a project without physics, and stays quiet on the demo project", () => {
    expect(formatCollisions(collisionMap(makeProject({ "project.godot": "config_version=5\n", "a.tscn": '[gd_scene format=3]\n\n[node name="A" type="Node"]\n' })))).toMatch(/^collisions: no physics nodes/);
    expect(collisionMap(DEMO).problems).toEqual([]);
  });

  it("runs from the CLI", async () => {
    const root = game();
    const all = await runCli(["collisions", root]);
    expect(all.exitCode).toBe(0);
    expect(all.output).toMatch(/^collisions: 6 physics nodes/);
    const pair = await runCli(["collisions", root, "--between", "Hitbox", "Enemy"]);
    expect(pair.exitCode).toBe(1);
    expect(pair.output).toContain("Hitbox detects Enemy: no:");
    expect((await runCli(["collisions", root, "--layers", "1", "3"])).output).toContain("layers 1, 3 = value 5");
  });
});
