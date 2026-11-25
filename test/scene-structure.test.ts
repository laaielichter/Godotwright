import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseResourceText } from "../src/godot/scene.js";
import { SceneError, editScene, formatScenePlan, type NewNode, type SceneEdit } from "../src/scene/edit.js";
import { createServer } from "../src/mcp/server.js";
import { readOnlyRefusal } from "../src/mcp/toolsets.js";
import { lineHunks } from "../src/scene/structure.js";
import { isUidText } from "../src/scene/uid.js";
import { makeProject, runCli } from "./helpers.js";

const MAIN = `[gd_scene load_steps=3 format=3 uid="uid://cstruct0scene"]

[ext_resource type="PackedScene" path="res://child.tscn" id="1_c"]

[sub_resource type="CircleShape2D" id="CircleShape2D_a"]

[node name="Main" type="Node2D"]

[node name="Player" type="CharacterBody2D" parent="." groups=["actors"]]
position = Vector2(1, 2)

[node name="Shape" type="CollisionShape2D" parent="Player"]
shape = SubResource("CircleShape2D_a")

[node name="Gun" type="Node2D" parent="Player"]

[node name="Muzzle" type="Marker2D" parent="Player/Gun"]
unique_name_in_owner = true

[node name="Cam" type="RemoteTransform2D" parent="."]
remote_path = NodePath("../Player/Gun")

[node name="Timer" type="Timer" parent="."]

[node name="Inst" parent="." instance=ExtResource("1_c")]

[node name="Inner" parent="Inst"]
position = Vector2(3, 3)

[node name="HUD" type="CanvasLayer" parent="."]

[connection signal="timeout" from="Timer" to="Player/Gun" method="fire"]
[connection signal="timeout" from="Timer" to="." method="tick"]

[editable path="Inst"]
`;

const FILES = {
  "project.godot": 'config_version=5\n\n[application]\nconfig/name="S"\nconfig/features=PackedStringArray("4.7")\n',
  "child.tscn": '[gd_scene format=3 uid="uid://cchild0scene"]\n\n[node name="Child" type="Node2D"]\n\n[node name="Inner" type="Node2D" parent="."]\n',
  "main.tscn": MAIN,
  "hero.gd": 'extends Node2D\n\nfunc _ready() -> void:\n\tvar gun := $Player/Gun\n\tprint(gun, get_node("Timer"))\n',
  "body.gd": "extends CharacterBody2D\n",
};

const project = (extra: Record<string, string> = {}) => makeProject({ ...FILES, ...extra });
const read = (root: string, file = "main.tscn") => readFileSync(join(root, file), "utf8");
const dry = (root: string, e: SceneEdit, file = "main.tscn") => editScene(join(root, file), e);
/** Writes the change and returns the scene parsed back, checked for sections Godot would not read and for order. */
function apply(root: string, e: SceneEdit, file = "main.tscn") {
  const plan = editScene(join(root, file), e, { write: true });
  expect(plan.written).toBe(true);
  const text = read(root, file);
  const parsed = parseResourceText(text);
  expect(parsed.misplaced).toEqual([]);
  const paths = parsed.nodes.map((n) => n.path);
  expect(new Set(paths).size).toBe(paths.length);
  // A parent written in this file comes before its children.
  for (const [i, path] of paths.entries()) {
    const parent = path === "." ? undefined : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    if (parent !== undefined && paths.includes(parent)) expect(paths.indexOf(parent)).toBeLessThan(i);
  }
  expect(text.endsWith("\n")).toBe(true);
  expect(text).not.toMatch(/\n\n\n/);
  return { plan, text, parsed, paths };
}
/** Lines of `after` that are not in `before`, and the other way round. */
function changed(before: string, after: string): { gone: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  return { gone: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
}

describe("create_scene", () => {
  it("makes a scene with a root, a fresh uid and a script, and a dry run writes nothing", () => {
    const root = project();
    const file = join(root, "levels/cave_level.tscn");
    const plan = editScene(file, { op: "create_scene", type: "CharacterBody2D", script: "res://body.gd" });
    expect(plan.written).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(plan.file).toBe("res://levels/cave_level.tscn");
    expect(formatScenePlan(plan)).toContain('+ [node name="CaveLevel" type="CharacterBody2D"]');
    const done = editScene(file, { op: "create_scene", type: "CharacterBody2D", script: "res://body.gd" }, { write: true });
    expect(done.review?.after).toBe(done.review?.before);
    expect(done.journal).toBeGreaterThan(0);
    const parsed = parseResourceText(readFileSync(file, "utf8"));
    expect(parsed.misplaced).toEqual([]);
    expect(isUidText(parsed.uid ?? "")).toBe(true);
    expect(parsed.uid).not.toBe("uid://cstruct0scene");
    expect(parsed.format).toBe(3);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]).toMatchObject({ name: "CaveLevel", path: ".", type: "CharacterBody2D", scriptRef: parsed.extResources[0]?.id });
    expect(parsed.extResources[0]).toMatchObject({ type: "Script", path: "res://body.gd" });
    // The new scene can be changed right away.
    editScene(file, { op: "add_node", parent: ".", name: "Shape", type: "CollisionShape2D" }, { write: true });
    expect(parseResourceText(readFileSync(file, "utf8")).nodes.map((n) => n.path)).toEqual([".", "Shape"]);
  });

  it("makes an inherited scene, and two new scenes get different uids", () => {
    const root = project();
    editScene("res://a.tscn", { op: "create_scene", instance: "res://child.tscn", name: "Kid" }, { write: true, project: root });
    editScene("res://b.tscn", { op: "create_scene", type: "Node" }, { write: true, project: root });
    const a = parseResourceText(read(root, "a.tscn"));
    expect(read(root, "a.tscn")).toContain('[ext_resource type="PackedScene" uid="uid://cchild0scene" path="res://child.tscn" id="1_base"]');
    expect(a.nodes[0]).toMatchObject({ name: "Kid", instanceRef: "1_base" });
    expect(a.nodes[0]?.type).toBeUndefined();
    const b = parseResourceText(read(root, "b.tscn"));
    expect(b.nodes[0]).toMatchObject({ name: "B", type: "Node" });
    expect(b.uid).not.toBe(a.uid);
  });

  it("refuses to overwrite, a wrong path, an unknown class and a script for another type", () => {
    const root = project();
    const before = read(root);
    expect(() => editScene(join(root, "main.tscn"), { op: "create_scene", type: "Node2D" }, { write: true })).toThrow(/already exists and create_scene never overwrites/);
    expect(read(root)).toBe(before);
    expect(() => editScene(join(root, "x.tres"), { op: "create_scene", type: "Node2D" })).toThrow(/ends in \.tscn/);
    expect(() => editScene(join(root, "x.tscn"), { op: "create_scene", type: "Nod2D" })).toThrow(/did you mean Node2D/);
    expect(() => editScene(join(root, "x.tscn"), { op: "create_scene", type: "Texture2D" })).toThrow(/not a Node/);
    expect(() => editScene(join(root, "x.tscn"), { op: "create_scene" })).toThrow(/needs the root's type/);
    expect(() => editScene(join(root, "x.tscn"), { op: "create_scene", type: "Node2D", name: "a/b" })).toThrow(/not a usable node name/);
    expect(() => editScene(join(root, "x.tscn"), { op: "create_scene", type: "Timer", script: "res://body.gd" })).toThrow(/extends CharacterBody2D/);
    expect(() => editScene(join(root, "x.tscn"), { op: "create_scene", type: "Node2D", script: "res://no.gd" })).toThrow(/does not exist/);
    expect(existsSync(join(root, "x.tscn"))).toBe(false);
  });
});

describe("rename_node", () => {
  it("renames a node with the paths of its children, connections and NodePaths, and nothing else", () => {
    const root = project();
    const before = read(root);
    const plan = dry(root, { op: "rename_node", node: "Player", name: "Hero" });
    expect(read(root)).toBe(before);
    expect(plan.written).toBe(false);
    const { text, paths, parsed } = apply(root, { op: "rename_node", node: "Player", name: "Hero" });
    expect(paths).toEqual([".", "Hero", "Hero/Shape", "Hero/Gun", "Hero/Gun/Muzzle", "Cam", "Timer", "Inst", "Inst/Inner", "HUD"]);
    expect(changed(before, text)).toEqual({
      gone: [
        '[node name="Player" type="CharacterBody2D" parent="." groups=["actors"]]',
        '[node name="Shape" type="CollisionShape2D" parent="Player"]',
        '[node name="Gun" type="Node2D" parent="Player"]',
        '[node name="Muzzle" type="Marker2D" parent="Player/Gun"]',
        'remote_path = NodePath("../Player/Gun")',
        '[connection signal="timeout" from="Timer" to="Player/Gun" method="fire"]',
      ],
      added: [
        '[node name="Hero" type="CharacterBody2D" parent="." groups=["actors"]]',
        '[node name="Shape" type="CollisionShape2D" parent="Hero"]',
        '[node name="Gun" type="Node2D" parent="Hero"]',
        '[node name="Muzzle" type="Marker2D" parent="Hero/Gun"]',
        'remote_path = NodePath("../Hero/Gun")',
        '[connection signal="timeout" from="Timer" to="Hero/Gun" method="fire"]',
      ],
    });
    expect(parsed.connections.map((c) => c.to)).toEqual(["Hero/Gun", "."]);
    expect(text.split("\n")).toHaveLength(before.split("\n").length);
    expect(text).toContain("load_steps=3");
  });

  it("reports scripts that name the node, and does not change them", () => {
    const root = project();
    const script = read(root, "hero.gd");
    const plan = dry(root, { op: "rename_node", node: "Player/Gun", name: "Cannon" });
    expect(plan.warnings.join("\n")).toMatch(/"Gun" is named in 1 place outside this scene \(res:\/\/hero\.gd:4\).*godot_usages Gun/);
    editScene(join(root, "main.tscn"), { op: "rename_node", node: "Player/Gun", name: "Cannon" }, { write: true });
    expect(read(root, "hero.gd")).toBe(script);
    expect(read(root)).toContain('remote_path = NodePath("../Player/Cannon")');
    const none = dry(root, { op: "rename_node", node: "HUD", name: "Hud" });
    expect(none.warnings.join("\n")).toContain("godot_usages HUD");
  });

  it("renames an instance with its [editable] entry and overrides, a unique name in NodePaths, and the root", () => {
    const root = project({ "main.tscn": MAIN.replace('remote_path = NodePath("../Player/Gun")', 'remote_path = NodePath("%Muzzle")') });
    const a = apply(root, { op: "rename_node", node: "Inst", name: "Crate" });
    expect(a.text).toContain('[node name="Inner" parent="Crate"]');
    expect(a.text).toContain('[editable path="Crate"]');
    expect(a.parsed.editable.map((e) => e.path)).toEqual(["Crate"]);
    const b = apply(root, { op: "rename_node", node: "Player/Gun/Muzzle", name: "Tip" });
    expect(b.text).toContain('remote_path = NodePath("%Tip")');
    const before = read(root);
    const c = apply(root, { op: "rename_node", node: ".", name: "World" });
    expect(changed(before, c.text)).toEqual({ gone: ['[node name="Main" type="Node2D"]'], added: ['[node name="World" type="Node2D"]'] });
  });

  it("refuses a taken name, a bad name, the same name, an unknown node and an inherited node", () => {
    const root = project();
    const before = read(root);
    expect(() => dry(root, { op: "rename_node", node: "Player", name: "Timer" })).toThrow(/already has a child called Timer/);
    expect(() => dry(root, { op: "rename_node", node: "Player", name: "A/B" })).toThrow(/not a usable node name/);
    expect(() => dry(root, { op: "rename_node", node: "Player", name: "Player" })).toThrow(/nothing to change/);
    expect(() => dry(root, { op: "rename_node", node: "Playr", name: "X" })).toThrow(/did you mean Player/);
    expect(() => dry(root, { op: "rename_node", node: "Inst/Inner", name: "X" })).toThrow(/comes from an instanced scene.*rename it in the scene it is made in/);
    expect(() => dry(root, { op: "rename_node", node: "Inst", name: "X" })).not.toThrow();
    expect(() => dry(root, { op: "rename_node", node: "Player", name: "X" })).not.toThrow(SceneError);
    expect(read(root)).toBe(before);
  });

  it("warns about animation tracks, which are relative to the AnimationPlayer's root", () => {
    const root = project({
      "anim.tscn":
        '[gd_scene load_steps=2 format=3]\n\n[sub_resource type="Animation" id="Animation_a"]\ntracks/0/type = "value"\ntracks/0/path = NodePath("Sprite:position")\n\n[node name="A" type="Node2D"]\n\n[node name="Sprite" type="Sprite2D" parent="."]\n',
    });
    const plan = dry(root, { op: "rename_node", node: "Sprite", name: "Body" }, "anim.tscn");
    expect(plan.warnings.join("\n")).toMatch(/animation tracks in this scene name "Sprite" \(from line 3\)/);
  });
});

describe("move_node", () => {
  it("reparents a subtree after the new parent's last child, and updates connections and NodePaths", () => {
    const root = project();
    const before = read(root);
    const plan = dry(root, { op: "move_node", node: "Player/Gun", parent: "HUD" });
    expect(read(root)).toBe(before);
    expect(plan.summary).toBe("move Player/Gun under HUD (with 1 child node)");
    expect(plan.warnings.join("\n")).toMatch(/\$Player\/Gun or get_node\("Player\/Gun"\) must become HUD\/Gun/);
    const { text, paths, parsed } = apply(root, { op: "move_node", node: "Player/Gun", parent: "HUD" });
    expect(paths).toEqual([".", "Player", "Player/Shape", "Cam", "Timer", "Inst", "Inst/Inner", "HUD", "HUD/Gun", "HUD/Gun/Muzzle"]);
    expect(changed(before, text)).toEqual({
      gone: ['[node name="Gun" type="Node2D" parent="Player"]', '[node name="Muzzle" type="Marker2D" parent="Player/Gun"]', 'remote_path = NodePath("../Player/Gun")', '[connection signal="timeout" from="Timer" to="Player/Gun" method="fire"]'],
      added: ['remote_path = NodePath("../HUD/Gun")', '[node name="Gun" type="Node2D" parent="HUD"]', '[node name="Muzzle" type="Marker2D" parent="HUD/Gun"]', '[connection signal="timeout" from="Timer" to="HUD/Gun" method="fire"]'],
    });
    expect(parsed.connections[0]).toMatchObject({ from: "Timer", to: "HUD/Gun" });
    expect(text).toContain('[node name="Muzzle" type="Marker2D" parent="HUD/Gun"]\nunique_name_in_owner = true\n\n[connection');
    expect(text.split("\n")).toHaveLength(before.split("\n").length);
  });

  it("moves to the root and back, with the NodePaths the moved node holds", () => {
    const root = project();
    const a = apply(root, { op: "move_node", node: "Cam", parent: "Player/Gun" });
    expect(a.paths).toEqual([".", "Player", "Player/Shape", "Player/Gun", "Player/Gun/Muzzle", "Player/Gun/Cam", "Timer", "Inst", "Inst/Inner", "HUD"]);
    expect(a.text).toContain('[node name="Cam" type="RemoteTransform2D" parent="Player/Gun"]\nremote_path = NodePath("..")');
    const b = apply(root, { op: "move_node", node: "Player/Gun/Cam", parent: ".", index: 0 });
    expect(b.paths.slice(0, 3)).toEqual([".", "Cam", "Player"]);
    expect(b.text).toContain('[node name="Cam" type="RemoteTransform2D" parent="."]\nremote_path = NodePath("../Player/Gun")');
  });

  it("changes the place among siblings with index, before and after, keeping every line", () => {
    const root = project();
    const before = read(root);
    const first = apply(root, { op: "move_node", node: "HUD", index: 0 });
    expect(first.plan.summary).toBe("move HUD as child 0");
    expect(first.paths).toEqual([".", "HUD", "Player", "Player/Shape", "Player/Gun", "Player/Gun/Muzzle", "Cam", "Timer", "Inst", "Inst/Inner"]);
    expect([...first.text.split("\n")].sort()).toEqual([...before.split("\n")].sort());
    expect(first.text).toContain('[node name="Inner" parent="Inst"]\nposition = Vector2(3, 3)\n\n[connection');
    const after = apply(root, { op: "move_node", node: "Player", after: "Timer" });
    expect(after.paths).toEqual([".", "HUD", "Cam", "Timer", "Player", "Player/Shape", "Player/Gun", "Player/Gun/Muzzle", "Inst", "Inst/Inner"]);
    const beforeSibling = apply(root, { op: "move_node", node: "Player/Gun", before: "Player/Shape" });
    expect(beforeSibling.paths.slice(4, 8)).toEqual(["Player", "Player/Gun", "Player/Gun/Muzzle", "Player/Shape"]);
    // after a sibling with children: behind its whole subtree.
    const last = apply(root, { op: "move_node", node: "Cam", after: "Player" });
    expect(last.paths).toEqual([".", "HUD", "Timer", "Player", "Player/Gun", "Player/Gun/Muzzle", "Player/Shape", "Cam", "Inst", "Inst/Inner"]);
    const end = apply(root, { op: "move_node", node: "HUD", index: 4 });
    expect(end.paths.at(-1)).toBe("HUD");
    expect([...end.text.split("\n")].sort()).toEqual([...before.split("\n")].sort());
    // Reparent and place in one call.
    const both = apply(root, { op: "move_node", node: "HUD", parent: "Player", before: "Player/Gun" });
    expect(both.paths.slice(2, 5)).toEqual(["Player", "Player/HUD", "Player/Gun"]);
  });

  it("moves an instance with its overrides and [editable] entry", () => {
    const root = project();
    const { text, paths, parsed } = apply(root, { op: "move_node", node: "Inst", parent: "Player" });
    expect(paths).toEqual([".", "Player", "Player/Shape", "Player/Gun", "Player/Gun/Muzzle", "Player/Inst", "Player/Inst/Inner", "Cam", "Timer", "HUD"]);
    expect(text).toContain('[node name="Inst" parent="Player" instance=ExtResource("1_c")]');
    expect(parsed.editable.map((e) => e.path)).toEqual(["Player/Inst"]);
  });

  it("refuses the root, a move under itself, a taken name, a no-op and an inherited node", () => {
    const root = project({ "main.tscn": MAIN.replace('[node name="HUD" type="CanvasLayer" parent="."]', '[node name="HUD" type="CanvasLayer" parent="."]\n\n[node name="Gun" type="Node2D" parent="HUD"]') });
    const before = read(root);
    expect(() => dry(root, { op: "move_node", node: ".", parent: "HUD" })).toThrow(/root node cannot be moved/);
    expect(() => dry(root, { op: "move_node", node: "Player", parent: "Player" })).toThrow(/cannot be moved under itself/);
    expect(() => dry(root, { op: "move_node", node: "Player", parent: "Player/Gun" })).toThrow(/under its own descendant Player\/Gun/);
    expect(() => dry(root, { op: "move_node", node: "Player/Gun", parent: "HUD" })).toThrow(/HUD already has a child called Gun/);
    expect(() => dry(root, { op: "move_node", node: "Player" })).toThrow(/needs a parent .* or index, before or after/);
    expect(() => dry(root, { op: "move_node", node: "Player", index: 0 })).toThrow(/nothing to change/);
    expect(() => dry(root, { op: "move_node", node: "Player", index: 0, before: "Cam" })).toThrow(/one of index, before and after/);
    expect(() => dry(root, { op: "move_node", node: "Player", index: 9 })).toThrow(/index goes from 0 to 4/);
    expect(() => dry(root, { op: "move_node", node: "Player", index: 1.5 })).toThrow(/whole number/);
    expect(() => dry(root, { op: "move_node", node: "Player", before: "Player" })).toThrow(/before or after itself/);
    expect(() => dry(root, { op: "move_node", node: "Player", parent: "HUD", before: "Cam" })).toThrow(/Cam is not a child of HUD/);
    expect(() => dry(root, { op: "move_node", node: "Inst/Inner", parent: "." })).toThrow(/comes from an instanced scene.*move it in the scene it is made in/);
    expect(() => dry(root, { op: "move_node", node: "Timer", parent: "Inst", index: 0 })).toThrow(/gets children from the scene it instances/);
    expect(() => dry(root, { op: "move_node", node: "Timer", parent: "Nope" })).toThrow(/no node "Nope"/);
    expect(read(root)).toBe(before);
  });

  it("refuses a name an instanced parent already has, and a move into an instance that is not editable", () => {
    const root = project({ "main.tscn": MAIN.replace('\n[editable path="Inst"]\n', "").replace('[node name="HUD" type="CanvasLayer" parent="."]', '[node name="Inner" type="Node2D" parent="."]') });
    expect(() => dry(root, { op: "move_node", node: "Inner", parent: "Inst" })).toThrow(/already has a child called Inner/);
    // Directly under the instance Godot keeps it; below one of its nodes only when the instance is editable.
    expect(() => dry(root, { op: "move_node", node: "Timer", parent: "Inst" })).not.toThrow();
    expect(() => dry(root, { op: "move_node", node: "Timer", parent: "Inst/Inner" })).toThrow(/instanced scene at "Inst", which is not editable/);
    const { text, plan } = apply(root, { op: "move_node", node: "Timer", parent: "Inst/Inner", makeEditable: true });
    expect(plan.summary).toContain("(and make Inst editable)");
    expect(text).toMatch(/\n\n\[editable path="Inst"\]\n$/);
    expect(text).toContain('[node name="Timer" type="Timer" parent="Inst/Inner"]');
  });

  it("keeps Windows line ends and a file without a last newline", () => {
    const root = project({ "crlf.tscn": MAIN.replace(/\n/g, "\r\n"), "bare.tscn": '[gd_scene format=3]\n\n[node name="R" type="Node"]\n\n[node name="A" type="Node" parent="."]\n\n[node name="B" type="Node" parent="."]' });
    editScene(join(root, "crlf.tscn"), { op: "move_node", node: "HUD", index: 0 }, { write: true });
    const text = read(root, "crlf.tscn");
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(parseResourceText(text).nodes[1]?.name).toBe("HUD");
    editScene(join(root, "bare.tscn"), { op: "move_node", node: "B", before: "A" }, { write: true });
    expect(read(root, "bare.tscn")).toBe('[gd_scene format=3]\n\n[node name="R" type="Node"]\n\n[node name="B" type="Node" parent="."]\n\n[node name="A" type="Node" parent="."]');
  });
});

describe("duplicate_node", () => {
  it("copies a subtree right after the original, sharing sub-resources and leaving connections", () => {
    const root = project();
    const before = read(root);
    const plan = dry(root, { op: "duplicate_node", node: "Player", name: "Player2" });
    expect(read(root)).toBe(before);
    expect(plan.summary).toBe("duplicate Player as Player2 (with 3 child nodes)");
    expect(plan.warnings.join("\n")).toMatch(/%Muzzle stays the unique name of the original/);
    const { text, paths, parsed } = apply(root, { op: "duplicate_node", node: "Player", name: "Player2" });
    expect(paths).toEqual([".", "Player", "Player/Shape", "Player/Gun", "Player/Gun/Muzzle", "Player2", "Player2/Shape", "Player2/Gun", "Player2/Gun/Muzzle", "Cam", "Timer", "Inst", "Inst/Inner", "HUD"]);
    expect(changed(before, text)).toEqual({
      gone: [],
      added: [
        '[node name="Player2" type="CharacterBody2D" parent="." groups=["actors"]]',
        '[node name="Shape" type="CollisionShape2D" parent="Player2"]',
        '[node name="Gun" type="Node2D" parent="Player2"]',
        '[node name="Muzzle" type="Marker2D" parent="Player2/Gun"]',
      ],
    });
    expect(text.match(/shape = SubResource\("CircleShape2D_a"\)/g)).toHaveLength(2);
    expect(parsed.subResources).toHaveLength(1);
    expect(text).toContain("load_steps=3");
    expect(parsed.connections).toHaveLength(2);
    expect(parsed.nodes.filter((n) => n.uniqueName).map((n) => n.path)).toEqual(["Player/Gun/Muzzle"]);
    expect(parsed.nodes.find((n) => n.path === "Player2")).toMatchObject({ groups: ["actors"], type: "CharacterBody2D" });
    expect(parsed.nodes.find((n) => n.path === "Player2")?.props["position"]).toBeDefined();
  });

  it("copies connections when asked, under another parent, with NodePaths inside the copy", () => {
    const root = project({ "main.tscn": MAIN.replace('[node name="Muzzle" type="Marker2D" parent="Player/Gun"]\nunique_name_in_owner = true', '[node name="Muzzle" type="RemoteTransform2D" parent="Player/Gun"]\nremote_path = NodePath("../../Shape")') });
    const quiet = dry(root, { op: "duplicate_node", node: "Player/Gun", name: "Gun", parent: "HUD" });
    expect(quiet.warnings.join("\n")).toMatch(/1 connection of Player\/Gun is not copied .* pass connections to copy it/);
    const { text, paths, parsed, plan } = apply(root, { op: "duplicate_node", node: "Player/Gun", name: "Gun", parent: "HUD", connections: true });
    expect(plan.summary).toBe("duplicate Player/Gun as HUD/Gun (with 1 child node), and 1 connection");
    expect(paths.slice(-3)).toEqual(["HUD", "HUD/Gun", "HUD/Gun/Muzzle"]);
    expect(parsed.connections.map((c) => `${c.from}>${c.to}.${c.method}`)).toEqual(["Timer>Player/Gun.fire", "Timer>..tick", "Timer>HUD/Gun.fire"]);
    expect(text).toContain('method="tick"]\n[connection signal="timeout" from="Timer" to="HUD/Gun" method="fire"]\n\n[editable path="Inst"]\n');
    // The copy's path to a node outside the copied subtree still points at that same node.
    expect(text).toContain('[node name="Muzzle" type="RemoteTransform2D" parent="HUD/Gun"]\nremote_path = NodePath("../../../Player/Shape")');
    // A path inside the copied subtree stays inside the copy.
    const again = apply(root, { op: "duplicate_node", node: "Player", name: "P2", parent: "HUD" });
    expect(again.text).toContain('[node name="Muzzle" type="RemoteTransform2D" parent="HUD/P2/Gun"]\nremote_path = NodePath("../../Shape")');
  });

  it("copies an instance with its overrides and [editable] entry, and gives a copy its own unique_id", () => {
    const root = project({ "ids.tscn": '[gd_scene format=3]\n\n[node name="R" type="Node" unique_id=11]\n\n[node name="A" type="Node" parent="." unique_id=12]\n' });
    const { text, paths, parsed } = apply(root, { op: "duplicate_node", node: "Inst", name: "Inst2" });
    expect(paths.slice(7, 11)).toEqual(["Inst", "Inst/Inner", "Inst2", "Inst2/Inner"]);
    expect(text).toContain('[node name="Inst2" parent="." instance=ExtResource("1_c")]');
    expect(text).toContain('[node name="Inner" parent="Inst2"]\nposition = Vector2(3, 3)');
    expect(parsed.editable.map((e) => e.path)).toEqual(["Inst", "Inst2"]);
    expect(parsed.extResources).toHaveLength(1);
    const ids = apply(root, { op: "duplicate_node", node: "A", name: "B" }, "ids.tscn");
    const found = [...ids.text.matchAll(/unique_id=(\d+)/g)].map((m) => Number(m[1]));
    expect(found).toHaveLength(3);
    expect(new Set(found).size).toBe(3);
  });

  it("refuses the root, a taken name, a bad name and an inherited node", () => {
    const root = project();
    const before = read(root);
    expect(() => dry(root, { op: "duplicate_node", node: ".", name: "X" })).toThrow(/root node cannot be copied.*instance the scene/);
    expect(() => dry(root, { op: "duplicate_node", node: "Player", name: "Player" })).toThrow(/already has a child called Player/);
    expect(() => dry(root, { op: "duplicate_node", node: "Player", name: "Inner", parent: "Inst" })).toThrow(/Inst already has a child called Inner/);
    expect(() => dry(root, { op: "duplicate_node", node: "Player", name: "%x" })).toThrow(/not a usable node name/);
    expect(() => dry(root, { op: "duplicate_node", node: "Inst/Inner", name: "X" })).toThrow(/comes from an instanced scene.*copy it in the scene it is made in/);
    expect(() => dry(root, { op: "duplicate_node", node: "Player", name: "X", parent: "Nope" })).toThrow(/no node "Nope"/);
    expect(read(root)).toBe(before);
  });
});

describe("set_groups", () => {
  it("sets, adds and removes groups in the header, and only there", () => {
    const root = project();
    const before = read(root);
    expect(dry(root, { op: "set_groups", node: "Player", add: ["targets"] }).written).toBe(false);
    expect(read(root)).toBe(before);
    const added = apply(root, { op: "set_groups", node: "Player", add: ["targets", "actors"] });
    expect(changed(before, added.text)).toEqual({
      gone: ['[node name="Player" type="CharacterBody2D" parent="." groups=["actors"]]'],
      added: ['[node name="Player" type="CharacterBody2D" parent="." groups=["actors", "targets"]]'],
    });
    expect(added.parsed.nodes[1]?.groups).toEqual(["actors", "targets"]);
    const removed = apply(root, { op: "set_groups", node: "Player", remove: ["actors"], add: ["a b"] });
    expect(removed.parsed.nodes[1]?.groups).toEqual(["targets", "a b"]);
    const none = apply(root, { op: "set_groups", node: "Player", groups: [] });
    expect(none.text).toContain('[node name="Player" type="CharacterBody2D" parent="."]\n');
    expect(none.parsed.nodes[1]?.groups).toEqual([]);
    const fresh = apply(root, { op: "set_groups", node: "Timer", groups: ["clocks", "clocks", " ticks "] });
    expect(fresh.text).toContain('[node name="Timer" type="Timer" parent="." groups=["clocks", "ticks"]]');
    // Godot writes groups before instance=.
    const inst = apply(root, { op: "set_groups", node: "Inst", groups: ["crates"] });
    expect(inst.text).toContain('[node name="Inst" parent="." groups=["crates"] instance=ExtResource("1_c")]');
    expect(inst.parsed.nodes.find((n) => n.name === "Inst")).toMatchObject({ groups: ["crates"], instanceRef: "1_c" });
    const top = apply(root, { op: "set_groups", node: ".", groups: ["world"] });
    expect(top.text).toContain('[node name="Main" type="Node2D" groups=["world"]]');
    expect(top.text.split("\n")).toHaveLength(before.split("\n").length);
  });

  it("refuses a group that is not there, mixed arguments, a no-op and a change inside a locked instance", () => {
    const root = project({ "locked.tscn": MAIN.replace('\n[editable path="Inst"]\n', "") });
    expect(() => dry(root, { op: "set_groups", node: "Player", remove: ["nope"] })).toThrow(/Player is not in "nope" in res:\/\/main\.tscn \(its groups here: actors\)/);
    expect(() => dry(root, { op: "set_groups", node: "Inst", remove: ["x"] })).toThrow(/groups from the instanced scene are changed in that scene/);
    expect(() => dry(root, { op: "set_groups", node: "Player", groups: ["a"], add: ["b"] })).toThrow(/not both/);
    expect(() => dry(root, { op: "set_groups", node: "Player" })).toThrow(/needs groups/);
    expect(() => dry(root, { op: "set_groups", node: "Player", groups: ["actors"] })).toThrow(/nothing to change/);
    expect(() => dry(root, { op: "set_groups", node: "Player", add: ["actors"] })).toThrow(/nothing to change/);
    expect(() => dry(root, { op: "set_groups", node: "Player", add: [" "] })).toThrow(/not a usable group name/);
    expect(() => dry(root, { op: "set_groups", node: "Inst/Inner", add: ["g"] }, "locked.tscn")).toThrow(/which is not editable/);
    expect(() => dry(root, { op: "set_groups", node: "Inst/Inner", add: ["g"] })).not.toThrow();
  });
});

describe("add_nodes", () => {
  const nodes: NewNode[] = [
    { parent: ".", name: "Enemy", type: "CharacterBody2D", props: { position: "Vector2(10, 20)" }, script: "res://body.gd" },
    { parent: "Enemy", name: "Sprite", type: "Sprite2D", props: { scale: "Vector2(2, 2)", visible: "false" } },
    { parent: "Enemy/Sprite", name: "Crate", instance: "res://child.tscn" },
    { parent: "Player", name: "Label", type: "Label", props: { text: "hi" } },
  ];

  it("adds nodes in order, later ones under earlier ones, with props, a script and load_steps", () => {
    const root = project();
    const before = read(root);
    const plan = dry(root, { op: "add_nodes", nodes });
    expect(read(root)).toBe(before);
    expect(plan.summary).toBe("add 4 nodes: Enemy, Enemy/Sprite, Enemy/Sprite/Crate, Player/Label");
    expect(formatScenePlan(plan)).toContain('+ [node name="Sprite" type="Sprite2D" parent="Enemy"]');
    const { text, paths, parsed, plan: done } = apply(root, { op: "add_nodes", nodes });
    expect(done.review?.after).toBe(done.review?.before);
    expect(paths).toEqual([".", "Player", "Player/Shape", "Player/Gun", "Player/Gun/Muzzle", "Player/Label", "Cam", "Timer", "Inst", "Inst/Inner", "HUD", "Enemy", "Enemy/Sprite", "Enemy/Sprite/Crate"]);
    expect(changed(before, text).gone).toEqual(['[gd_scene load_steps=3 format=3 uid="uid://cstruct0scene"]']);
    expect(text).toContain('[gd_scene load_steps=4 format=3 uid="uid://cstruct0scene"]');
    expect(text).toContain('[node name="Enemy" type="CharacterBody2D" parent="."]\nposition = Vector2(10, 20)\nscript = ExtResource("2_body")\n');
    expect(text).toContain('[node name="Sprite" type="Sprite2D" parent="Enemy"]\nscale = Vector2(2, 2)\nvisible = false\n');
    expect(text).toContain('[node name="Label" type="Label" parent="Player"]\ntext = "hi"\n');
    expect(parsed.nodes.find((n) => n.path === "Enemy/Sprite/Crate")?.instanceRef).toBe("1_c");
    expect(parsed.extResources).toHaveLength(2);
  });

  it("is all or nothing: one bad node names its place and nothing is written", () => {
    const root = project();
    const before = read(root);
    const bad = (extra: object) => () => editScene(join(root, "main.tscn"), { op: "add_nodes", nodes: [nodes[0]!, { parent: "Enemy", name: "X", type: "Node2D", ...extra }] }, { write: true });
    expect(bad({ type: "Sprit2D" })).toThrow(/nodes\[1\] \(X\): Sprit2D is not a Godot .* did you mean Sprite2D.*Nothing is changed/);
    expect(bad({ props: { nope: "1" } })).toThrow(/nodes\[1\] \(X\): Enemy\/X \(Node2D\) has no property nope/);
    expect(bad({ parent: "Enemi" })).toThrow(/nodes\[1\] \(X\): no node "Enemi".*did you mean Enemy/);
    expect(bad({ name: "Enemy", parent: "." })).toThrow(/already has a child called Enemy/);
    expect(bad({ script: "res://body.gd" })).toThrow(/extends CharacterBody2D/);
    expect(() => dry(root, { op: "add_nodes", nodes: [] })).toThrow(/needs nodes/);
    expect(read(root)).toBe(before);
  });

  it("refuses nodes inside an instance that is not editable, and makes it editable when asked", () => {
    const root = project({ "main.tscn": MAIN.replace('\n[editable path="Inst"]\n', "") });
    const list = [{ parent: "Inst/Inner", name: "Deep", type: "Node2D", props: { position: "Vector2(1, 1)" } }];
    expect(() => dry(root, { op: "add_nodes", nodes: list })).toThrow(/nodes\[0\] \(Deep\): .*which is not editable/);
    const { text } = apply(root, { op: "add_nodes", nodes: list, makeEditable: true });
    expect(text).toMatch(/\[node name="Deep" type="Node2D" parent="Inst\/Inner"\]\nposition = Vector2\(1, 1\)\n/);
    expect(text.match(/\[editable path="Inst"\]/g)).toHaveLength(1);
  });
});

describe("scene structure from the CLI and the journal", () => {
  it("runs every new op from the CLI: a dry run, --write and refusals", async () => {
    const root = project();
    const main = join(root, "main.tscn");
    const before = read(root);
    const dryRun = await runCli(["scene", "rename", "res://main.tscn", "Player", "Hero", "--project", root]);
    expect(dryRun.output).toContain("scene rename Player to Hero (dry run: add --write to apply)");
    expect(read(root)).toBe(before);
    const renamed = await runCli(["scene", "rename", main, "Player", "Hero", "--write"]);
    expect(renamed.output).toMatch(/\(written, journal #\d+: godot_undo reverts it\)/);
    expect(read(root)).toContain('[node name="Gun" type="Node2D" parent="Hero"]');
    await runCli(["scene", "move", main, "Hero/Gun", "HUD", "--write"]);
    await runCli(["scene", "move", main, "HUD", "--before", "Hero", "--write"]);
    await runCli(["scene", "move", main, "Timer", "--index", "0", "--write"]);
    await runCli(["scene", "duplicate", main, "HUD/Gun", "Gun2", "--connections", "--write"]);
    await runCli(["scene", "duplicate", main, "Cam", "Cam2", "--parent", "HUD", "--write"]);
    await runCli(["scene", "groups", main, "Hero", "--add", "targets,heroes", "--remove", "actors", "--write"]);
    await runCli(["scene", "groups", main, "Timer", "clocks", "--write"]);
    await runCli(["scene", "groups", main, "Timer", "--none", "--write"]);
    const many = await runCli(["scene", "add-many", main, '[{"parent": ".", "name": "Box", "type": "Node2D", "props": {"position": "Vector2(4, 4)"}}, {"parent": "Box", "name": "Lid", "type": "Node2D"}]', "--write", "--json"]);
    expect((JSON.parse(many.output) as { written: boolean; summary: string }).summary).toBe("add 2 nodes: Box, Box/Lid");
    writeFileSync(join(root, "nodes.json"), '[{"parent": "Box/Lid", "name": "Knob", "type": "Node2D"}]');
    await runCli(["scene", "add-many", main, join(root, "nodes.json"), "--write"]);
    const parsed = parseResourceText(read(root));
    expect(parsed.misplaced).toEqual([]);
    expect(parsed.nodes.map((n) => n.path)).toEqual([".", "Timer", "HUD", "HUD/Gun", "HUD/Gun/Muzzle", "HUD/Gun2", "HUD/Gun2/Muzzle", "HUD/Cam2", "Hero", "Hero/Shape", "Cam", "Inst", "Inst/Inner", "Box", "Box/Lid", "Box/Lid/Knob"]);
    expect(parsed.nodes.find((n) => n.path === "Hero")?.groups).toEqual(["targets", "heroes"]);
    expect(parsed.nodes.find((n) => n.path === "Timer")?.groups).toEqual([]);
    expect(parsed.connections.map((c) => c.to)).toEqual(["HUD/Gun", ".", "HUD/Gun2"]);
    expect(read(root)).toContain('[node name="Cam2" type="RemoteTransform2D" parent="HUD"]\nremote_path = NodePath("../Gun")');

    const created = await runCli(["scene", "create", "res://ui/menu.tscn", "Control", "Menu", "--project", root, "--write"]);
    expect(created.output).toContain("scene create res://ui/menu.tscn with root Menu (Control) (written");
    expect(parseResourceText(read(root, "ui/menu.tscn")).nodes[0]).toMatchObject({ name: "Menu", type: "Control" });
    const again = await runCli(["scene", "create", join(root, "ui/menu.tscn"), "Control"]);
    // The refusal goes to stderr, and the exit code is 1.
    expect(again.output).toBe("");
    expect(process.exitCode).toBe(1);
    const inherited = await runCli(["scene", "create", join(root, "kid.tscn"), "res://child.tscn"]);
    expect(inherited.output).toContain("inherits res://child.tscn");
    expect(existsSync(join(root, "kid.tscn"))).toBe(false);

    const state = read(root);
    for (const args of [
      ["scene", "move", main, ".", "HUD"],
      ["scene", "move", main, "HUD", "HUD/Gun"],
      ["scene", "move", main, "HUD", "--index", "x"],
      ["scene", "rename", main, "Hero", "Cam"],
      ["scene", "duplicate", main, "Cam", "Hero"],
      ["scene", "groups", main, "Hero", "--remove", "nope"],
      ["scene", "add-many", main, "[{"],
      ["scene", "add-many", main, '{"parent": "."}'],
    ]) {
      const result = await runCli([...args, "--write"]);
      expect(process.exitCode, args.join(" ")).toBe(1);
      expect(result.output, args.join(" ")).toBe("");
    }
    expect(read(root)).toBe(state);
    process.exitCode = undefined;
  });

  it("undoes a written change and a created scene through the journal", async () => {
    const root = project();
    const before = read(root);
    const plan = editScene(join(root, "main.tscn"), { op: "move_node", node: "Player/Gun", parent: "HUD" }, { write: true });
    expect(plan.journal).toBeGreaterThan(0);
    editScene(join(root, "new.tscn"), { op: "create_scene", type: "Node" }, { write: true });
    expect(existsSync(join(root, "new.tscn"))).toBe(true);
    await runCli(["undo", root]);
    expect(existsSync(join(root, "new.tscn"))).toBe(false);
    await runCli(["undo", root]);
    expect(read(root)).toBe(before);
  });
});

describe("files the editor did not write", () => {
  // Found on a corpus of real scenes: sections without blank lines between them, and one stray \r\n in a Unix file.
  const tight = '[gd_scene format=3]\n\n[node name="R" type="Node3D"]\n\n[node name="A" type="Node3D" parent="."]\nvisible = false\n[node name="B" type="Node3D" parent="."]\n[node name="C" type="Node3D" parent="B"]\n\r\n';

  it("keeps the file's own spacing, so a change and its opposite give the same bytes", () => {
    const root = project({ "tight.tscn": tight });
    const file = join(root, "tight.tscn");
    const run = (e: SceneEdit) => editScene(file, e, { write: true });
    run({ op: "rename_node", node: "B", name: "B2" });
    expect(read(root, "tight.tscn")).toContain('[node name="C" type="Node3D" parent="B2"]\n\r\n');
    run({ op: "rename_node", node: "B2", name: "B" });
    expect(read(root, "tight.tscn")).toBe(tight);
    run({ op: "move_node", node: "B/C", parent: "A" });
    expect(parseResourceText(read(root, "tight.tscn")).nodes.map((n) => n.path)).toEqual([".", "A", "A/C", "B"]);
    expect(read(root, "tight.tscn")).toContain('visible = false\n[node name="C" type="Node3D" parent="A"]\n[node name="B" type="Node3D" parent="."]\n\r\n');
    run({ op: "move_node", node: "A/C", parent: "B" });
    expect(read(root, "tight.tscn")).toBe(tight);
    run({ op: "duplicate_node", node: "A", name: "A2" });
    expect(read(root, "tight.tscn")).toBe(tight.replace('[node name="B"', '[node name="A2" type="Node3D" parent="."]\nvisible = false\n[node name="B"'));
    run({ op: "remove_node", node: "A2" });
    expect(read(root, "tight.tscn")).toBe(tight);
    run({ op: "set_groups", node: "B/C", add: ["g"] });
    run({ op: "set_groups", node: "B/C", remove: ["g"] });
    expect(read(root, "tight.tscn")).toBe(tight);
  });
});

describe("godot_scene_edit over MCP", () => {
  type Result = { content: { type: string; text: string }[]; isError?: boolean };
  const textOf = (r: unknown) => (r as Result).content.map((c) => c.text).join("\n");

  it("runs the new ops: a dry run by default, write: true writes, a refusal is an error", async () => {
    const root = project();
    const server = createServer({ root, godot: "/no/such/godot" });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (args: Record<string, unknown>) => (await client.callTool({ name: "godot_scene_edit", arguments: { scene: "res://main.tscn", ...args } })) as Result;
    const before = read(root);
    const dryRun = await call({ op: "move_node", node: "Player/Gun", parent: "HUD", index: 0 });
    expect(dryRun.isError).toBeFalsy();
    expect(textOf(dryRun)).toContain("scene move Player/Gun under HUD as child 0 (with 1 child node) (dry run");
    expect(read(root)).toBe(before);
    expect(textOf(await call({ op: "move_node", node: "Player/Gun", parent: "HUD", write: true }))).toContain("(written, journal #");
    expect(textOf(await call({ op: "rename_node", node: "HUD/Gun", name: "Cannon", write: true }))).toContain("rename HUD/Gun to Cannon");
    expect(textOf(await call({ op: "duplicate_node", node: "HUD/Cannon", name: "Cannon2", connections: true, write: true }))).toContain("and 1 connection");
    expect(textOf(await call({ op: "set_groups", node: "Timer", add_groups: ["clocks"], write: true }))).toContain("set the groups of Timer to clocks");
    expect(textOf(await call({ op: "set_groups", node: "Timer", groups: [], write: true }))).toContain("remove Timer from all groups");
    expect(textOf(await call({ op: "add_nodes", nodes: [{ parent: ".", name: "Box", type: "Node2D", props: { position: "Vector2(1, 1)" } }, { parent: "Box", name: "Lid", type: "Node2D" }], write: true }))).toContain("add 2 nodes: Box, Box/Lid");
    expect(textOf(await call({ scene: "res://made/new.tscn", op: "create_scene", type: "Node3D", name: "World", write: true }))).toContain("create res://made/new.tscn with root World (Node3D)");
    const parsed = parseResourceText(read(root));
    expect(parsed.misplaced).toEqual([]);
    expect(parsed.nodes.map((n) => n.path)).toEqual([".", "Player", "Player/Shape", "Cam", "Timer", "Inst", "Inst/Inner", "HUD", "HUD/Cannon", "HUD/Cannon/Muzzle", "HUD/Cannon2", "HUD/Cannon2/Muzzle", "Box", "Box/Lid"]);
    expect(parseResourceText(read(root, "made/new.tscn")).nodes[0]).toMatchObject({ name: "World", type: "Node3D" });
    for (const args of [{ op: "rename_node", node: "Player" }, { op: "move_node", node: ".", parent: "HUD" }, { op: "duplicate_node", node: "Cam" }, { op: "set_groups", node: "Cam" }, { op: "add_nodes" }, { scene: "res://made/new.tscn", op: "create_scene", type: "Node" }]) {
      const refused = await call({ ...args, write: true });
      expect(refused.isError, JSON.stringify(args)).toBe(true);
    }
    await Promise.all([client.close(), server.close()]);
  });
});

describe("read-only sessions", () => {
  it("refuse every new op with write: true, and show the dry run", () => {
    for (const op of ["create_scene", "add_nodes", "rename_node", "move_node", "duplicate_node", "set_groups"]) {
      expect(readOnlyRefusal("godot_scene_edit", { op, write: true })).toContain("read-only session: godot_scene_edit with write: true is refused");
      expect(readOnlyRefusal("godot_scene_edit", { op })).toBeUndefined();
    }
  });
});

describe("lineHunks", () => {
  it("gives the changed runs with their line in the old text", () => {
    expect(lineHunks(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
    expect(lineHunks(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"])).toEqual([
      { line: 2, removed: ["b"], added: ["x"] },
      { line: 5, removed: [], added: ["e"] },
    ]);
    expect(lineHunks(["a", "b", "c", "d"], ["a", "c", "b", "d"])).toHaveLength(2);
  });
});
