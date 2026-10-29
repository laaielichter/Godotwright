import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseResourceText } from "../src/godot/scene.js";
import { SceneError, editScene, formatScenePlan } from "../src/scene/edit.js";
import { DEMO, makeProject, runCli } from "./helpers.js";

function demo(): string {
  const dir = mkdtempSync(join(tmpdir(), "godotwright-scene-"));
  cpSync(DEMO, dir, { recursive: true });
  return dir;
}
const MAIN = "scenes/main.tscn";
const read = (root: string, file = MAIN) => readFileSync(join(root, file), "utf8");
const parsed = (root: string, file = MAIN) => parseResourceText(read(root, file));
const edit = (root: string, e: Parameters<typeof editScene>[1], file = MAIN) => editScene(join(root, file), e, { write: true });

/** Lines of `after` that are not in `before`, and the other way round. */
function changed(before: string, after: string): { gone: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  return { gone: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
}

describe("scene edits", () => {
  it("adds a node after its parent's subtree, without touching other lines", () => {
    const root = demo();
    const before = read(root);
    const dry = editScene(join(root, MAIN), { op: "add_node", parent: "Floor", name: "Sprite", type: "Sprite2D" });
    expect(read(root)).toBe(before);
    expect(formatScenePlan(dry)).toContain('+ [node name="Sprite" type="Sprite2D" parent="Floor"]');
    const plan = edit(root, { op: "add_node", parent: "Floor", name: "Sprite", type: "Sprite2D" });
    expect(plan.review).toEqual({ before: 0, after: 0 });
    expect(changed(before, read(root))).toEqual({ gone: [], added: ['[node name="Sprite" type="Sprite2D" parent="Floor"]'] });
    const paths = parsed(root).nodes.map((n) => n.path);
    expect(paths.indexOf("Floor/Sprite")).toBe(paths.indexOf("Floor/CollisionShape2D") + 1);
  });

  it("instances a scene with a new ext_resource, its uid and the right load_steps", () => {
    const root = demo();
    edit(root, { op: "add_node", parent: ".", name: "Enemy", instance: "res://scenes/enemy.tscn" });
    const text = read(root);
    expect(text).toContain('[gd_scene load_steps=6 format=3 uid="uid://c8main0scene"]');
    expect(text).toContain('[ext_resource type="PackedScene" uid="uid://benemy0scene" path="res://scenes/enemy.tscn" id="4_enemy"]');
    expect(parsed(root).nodes.find((n) => n.name === "Enemy")?.instanceRef).toBe("4_enemy");
    // The same scene again reuses the ext_resource.
    edit(root, { op: "add_node", parent: ".", name: "Enemy2", instance: "res://scenes/enemy.tscn" });
    expect(parsed(root).extResources.length).toBe(4);
  });

  it("refuses unknown classes, non-nodes, taken names and missing parents", () => {
    const root = demo();
    const file = join(root, MAIN);
    expect(() => editScene(file, { op: "add_node", parent: ".", name: "X", type: "Sprit2D" })).toThrow(/did you mean Sprite2D/);
    expect(() => editScene(file, { op: "add_node", parent: ".", name: "X", type: "Texture2D" })).toThrow(/not a Node/);
    expect(() => editScene(file, { op: "add_node", parent: ".", name: "Floor", type: "Node2D" })).toThrow(/already has a child called Floor/);
    expect(() => editScene(file, { op: "add_node", parent: "Flor", name: "X", type: "Node2D" })).toThrow(/did you mean Floor/);
    expect(() => editScene(file, { op: "add_node", parent: ".", name: "a/b", type: "Node2D" })).toThrow(/not a usable node name/);
    expect(() => editScene(file, { op: "add_node", parent: ".", name: "Me", instance: "res://scenes/main.tscn" })).toThrow(/cannot contain itself/);
  });

  it("sets properties with their Godot type, enum names and resources from files", () => {
    const root = demo();
    const before = read(root);
    edit(root, { op: "set", node: "SpawnTimer", property: "wait_time", value: "3" });
    edit(root, { op: "set", node: "SpawnTimer", property: "process_mode", value: "ALWAYS" });
    expect(changed(before, read(root))).toEqual({ gone: ["wait_time = 2.0"], added: ["wait_time = 3.0", "process_mode = 3"] });
    // An exported variable of the instanced scene's script.
    edit(root, { op: "set", node: "Player", property: "max_health", value: "5" });
    expect(parsed(root).nodes.find((n) => n.name === "Player")?.props["max_health"]).toBe(5);
    edit(root, { op: "set", node: "Floor/CollisionShape2D", property: "debug_color", value: "Color(1, 0, 0, 1)" });
    const timer = parsed(root).nodes.find((n) => n.name === "SpawnTimer");
    expect(timer?.props).toMatchObject({ wait_time: 3, process_mode: 3, autostart: true });
    const player = "scenes/player.tscn";
    edit(root, { op: "set", node: ".", property: "motion_mode", value: "floating" }, player);
    expect(parsed(root, player).nodes[0]?.props["motion_mode"]).toBe(1);
  });

  it("refuses unknown properties, wrong types, wrong resources and no-ops", () => {
    const root = demo();
    const file = join(root, MAIN);
    expect(() => editScene(file, { op: "set", node: "SpawnTimer", property: "wait_tme", value: "3" })).toThrow(/did you mean wait_time/);
    expect(() => editScene(file, { op: "set", node: "Player", property: "position", value: "1,2" })).toThrow(/is a Vector2/);
    expect(() => editScene(file, { op: "set", node: "SpawnTimer", property: "autostart", value: "yes" })).toThrow(/true or false/);
    expect(() => editScene(file, { op: "set", node: "SpawnTimer", property: "process_mode", value: "SOMETIMES" })).toThrow(/PROCESS_MODE_ALWAYS/);
    expect(() => editScene(file, { op: "set", node: "SpawnTimer", property: "autostart", value: "true" })).toThrow(/nothing to change/);
    expect(() => editScene(join(root, "scenes/player.tscn"), { op: "set", node: "Sprite2D", property: "texture", value: "res://scenes/main.tscn" })).toThrow(/takes a Texture2D/);
    expect(() => editScene(file, { op: "set", node: "SpawnTimer", property: "script", value: "res://x.gd" })).toThrow(/attach_script/);
  });

  it("connects a signal and warns when the method is missing or takes other arguments", () => {
    const root = demo();
    const plan = edit(root, { op: "connect", from: "SpawnTimer", signal: "timeout", to: ".", method: "_on_tick" });
    expect(plan.warnings[0]).toContain("Add: func _on_tick() -> void:");
    expect(parsed(root).connections.at(-1)).toMatchObject({ signal: "timeout", from: "SpawnTimer", to: ".", method: "_on_tick" });
    const wrong = editScene(join(root, MAIN), { op: "connect", from: "Player", signal: "health_changed", to: ".", method: "_on_player_died" });
    expect(wrong.warnings[0]).toMatch(/passes 2 arguments .* takes 0/);
    const ok = editScene(join(root, MAIN), { op: "connect", from: "Player", signal: "died", to: ".", method: "_on_spawn_timer_timeout" });
    expect(ok.warnings).toEqual([]);
    expect(() => editScene(join(root, MAIN), { op: "connect", from: "SpawnTimer", signal: "timout", to: ".", method: "x" })).toThrow(/did you mean timeout/);
    expect(() => editScene(join(root, MAIN), { op: "connect", from: "SpawnTimer", signal: "timeout", to: ".", method: "_on_tick" })).toThrow(/already connected/);
  });

  it("disconnects, and a scene without connections gets its first one at the end", () => {
    const root = demo();
    edit(root, { op: "disconnect", from: "SpawnTimer", signal: "timeout", to: ".", method: "_on_spawn_timer_timeout" });
    edit(root, { op: "disconnect", from: "Player", signal: "died", to: ".", method: "_on_player_died" });
    expect(parsed(root).connections).toEqual([]);
    expect(read(root).endsWith('shape = SubResource("WorldBoundaryShape2D_floor")\n')).toBe(true);
    edit(root, { op: "connect", from: "SpawnTimer", signal: "timeout", to: ".", method: "_on_spawn_timer_timeout" });
    expect(read(root).endsWith('shape = SubResource("WorldBoundaryShape2D_floor")\n\n[connection signal="timeout" from="SpawnTimer" to="." method="_on_spawn_timer_timeout"]\n')).toBe(true);
    expect(() => editScene(join(root, MAIN), { op: "disconnect", from: "Player", signal: "died", to: ".", method: "_on_player_died" })).toThrow(SceneError);
  });

  it("removes a node with its children, connections and the resources only it used", () => {
    const root = demo();
    const plan = edit(root, { op: "remove_node", node: "Floor" });
    expect(plan.summary).toBe("remove Floor and 1 child node");
    const scene = parsed(root);
    expect(scene.nodes.map((n) => n.path)).toEqual([".", "Player", "HUD", "SpawnTimer"]);
    expect(scene.subResources).toEqual([]);
    expect(read(root)).toContain("load_steps=4");
    edit(root, { op: "remove_node", node: "Player" });
    expect(parsed(root).connections.map((c) => c.signal)).toEqual(["timeout"]);
    expect(parsed(root).extResources.map((e) => e.id)).toEqual(["1_main", "3_hud"]);
    expect(() => editScene(join(root, MAIN), { op: "remove_node", node: "." })).toThrow(/root node/);
  });

  it("warns when scripts still name a removed node", () => {
    const root = makeProject({
      "project.godot": "[application]\n",
      "a.gd": "extends Node\n\nfunc _ready() -> void:\n\t$Box.queue_free()\n",
      "a.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://a.gd" id="1"]\n\n[node name="A" type="Node"]\nscript = ExtResource("1")\n\n[node name="Box" type="Node" parent="."]\n',
    });
    const plan = editScene(join(root, "a.tscn"), { op: "remove_node", node: "Box" });
    expect(plan.warnings[0]).toMatch(/scripts still name "Box" in 1 place \(res:\/\/a.gd:4\)/);
  });

  it("attaches a script, and refuses one for another node type", () => {
    const root = makeProject({
      "project.godot": "[application]\n",
      "timer.gd": "extends Timer\n",
      "body.gd": "extends CharacterBody2D\n",
      "a.tscn": '[gd_scene format=3]\n\n[node name="A" type="Node"]\n\n[node name="T" type="Timer" parent="."]\n',
    });
    edit(root, { op: "attach_script", node: "T", script: "res://timer.gd" }, "a.tscn");
    const scene = parsed(root, "a.tscn");
    expect(scene.extResources).toMatchObject([{ type: "Script", path: "res://timer.gd" }]);
    expect(scene.nodes[1]?.scriptRef).toBe(scene.extResources[0]?.id);
    expect(() => editScene(join(root, "a.tscn"), { op: "attach_script", node: ".", script: "res://body.gd" })).toThrow(/is a Node, but res:\/\/body.gd extends CharacterBody2D/);
    expect(() => editScene(join(root, "a.tscn"), { op: "attach_script", node: ".", script: "res://nope.gd" })).toThrow(/does not exist/);
  });

  it("keeps Windows line ends", () => {
    const root = makeProject({ "project.godot": "[application]\n", "a.tscn": '[gd_scene format=3]\r\n\r\n[node name="A" type="Node2D"]\r\n' });
    edit(root, { op: "set", node: ".", property: "position", value: "Vector2(1, 2)" }, "a.tscn");
    expect(read(root, "a.tscn")).toBe('[gd_scene format=3]\r\n\r\n[node name="A" type="Node2D"]\r\nposition = Vector2(1, 2)\r\n');
  });

  it("runs from the CLI with a res:// path, a dry run, --write and --json", async () => {
    const root = demo();
    const dry = await runCli(["scene", "add", "res://scenes/main.tscn", ".", "Music", "AudioStreamPlayer", "--project", root]);
    expect(dry.output).toContain("(dry run: add --write to apply)");
    const wet = await runCli(["scene", "set", join(root, MAIN), "SpawnTimer", "wait_time", "1.5", "--write"]);
    expect(wet.output).toContain("review errors: 0 before, 0 after");
    expect(read(root)).toContain("wait_time = 1.5");
    const json = JSON.parse((await runCli(["scene", "connect", join(root, MAIN), "SpawnTimer", "timeout", ".", "_on_tick", "--json"])).output) as { warnings: string[] };
    expect(json.warnings.length).toBe(1);
    const bad = await runCli(["scene", "add", join(root, MAIN), ".", "X", "Nope2D"]);
    expect(bad.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
