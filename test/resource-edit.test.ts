import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { typedValue } from "../src/godot/typed-value.js";
import { undoJournal } from "../src/journal/journal.js";
import { lineDiff } from "../src/resource/diff.js";
import { ResourceEditError, editResource, formatResourcePlan, markChanged } from "../src/resource/edit.js";
import { toOps } from "../src/resource/types.js";
import { makeProject, runCli } from "./helpers.js";

const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Res"\nconfig/features=PackedStringArray("4.7")\n';
const MAT = `[gd_resource type="StandardMaterial3D" format=3 uid="uid://b1mat0000001"]

[ext_resource type="Texture2D" uid="uid://c2icon000002" path="res://icon.svg" id="1_icon"]

[resource]
albedo_texture = ExtResource("1_icon")
roughness = 0.5
`;
const THEME = `[gd_resource type="Theme" format=3 uid="uid://d3theme00003"]

[sub_resource type="StyleBoxTexture" id="StyleBoxTexture_a1"]
content_margin_left = 2.0

[resource]
default_font_size = 20
Panel/styles/panel = SubResource("StyleBoxTexture_a1")
`;
const WAV_IMPORT = `[remap]

importer="wav"
type="AudioStreamWAV"
uid="uid://e4beep000004"
path="res://.godot/imported/beep.wav-bc4655fdf7ad7a97d3e9727a4f4dc437.sample"

[deps]

source_file="res://beep.wav"
dest_files=["res://.godot/imported/beep.wav-bc4655fdf7ad7a97d3e9727a4f4dc437.sample"]

[params]

force/8_bit=false
force/mono=false
force/max_rate=false
force/max_rate_hz=44100
edit/trim=false
edit/normalize=false
edit/loop_mode=0
edit/loop_begin=0
edit/loop_end=-1
compress/mode=2
`;
const GLTF = JSON.stringify({
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "Root", children: [1] }, { name: "Car", children: [2] }, { name: "Wheel", mesh: 0 }],
  meshes: [{ name: "wheel_mesh", primitives: [] }],
  materials: [{ name: "Paint" }],
  animations: [{ name: "drive", channels: [] }],
});
const GLB_IMPORT = `[remap]

importer="scene"
importer_version=1
type="PackedScene"
uid="uid://f5car0000005"
path="res://.godot/imported/car.gltf-0123456789abcdef0123456789abcdef.scn"

[deps]

source_file="res://car.gltf"
dest_files=["res://.godot/imported/car.gltf-0123456789abcdef0123456789abcdef.scn"]

[params]

nodes/root_type=""
meshes/create_shadow_meshes=true
meshes/lightmap_texel_size=0.2
materials/extract=0
_subresources={
"meshes": {
"car_wheel_mesh": {
"lods/normal_merge_angle": 20.0
}
}
}
gltf/naming_version=2
`;

function project(): string {
  return makeProject({
    "project.godot": PROJECT,
    "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>\n',
    "icon.svg.import": '[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\nuid="uid://c2icon000002"\n',
    "grad.tres": '[gd_resource type="Gradient" format=3 uid="uid://g6grad000006"]\n\n[resource]\n',
    "mat.tres": MAT,
    "theme.tres": THEME,
    "beep.wav": "RIFF",
    "beep.wav.import": WAV_IMPORT,
    "car.gltf": GLTF,
    "car.gltf.import": GLB_IMPORT,
    "main.tscn": '[gd_scene format=3]\n\n[sub_resource type="BoxMesh" id="BoxMesh_1"]\n\n[node name="Main" type="MeshInstance3D"]\nmesh = SubResource("BoxMesh_1")\n',
  });
}
const read = (root: string, f: string) => readFileSync(join(root, f), "utf8");
const NO_GODOT = { godot: "/nonexistent/godot" };

describe("resource edits (.tres)", () => {
  it("sets a property on one line and keeps every uid byte for byte", async () => {
    const root = project();
    const dry = await editResource(join(root, "mat.tres"), [{ op: "set", key: "roughness", value: "0.8" }]);
    expect(read(root, "mat.tres")).toBe(MAT);
    expect(formatResourcePlan(dry)).toContain("+ roughness = 0.8");
    const plan = await editResource(join(root, "mat.tres"), [{ op: "set", key: "roughness", value: "0.8" }, { op: "set", key: "transparency", value: "ALPHA" }], { write: true });
    expect(plan.written).toBe(true);
    expect(read(root, "mat.tres")).toBe(MAT.replace("roughness = 0.5", "roughness = 0.8\ntransparency = 1"));
    expect(plan.review?.after).toBe(plan.review?.before);
  });

  it("checks names and types against Godot 4.7", async () => {
    const root = project();
    const file = join(root, "mat.tres");
    await expect(editResource(file, [{ op: "set", key: "roughnes", value: "1" }])).rejects.toThrow(/has no property roughnes; did you mean roughness/);
    await expect(editResource(file, [{ op: "set", key: "roughness", value: "rough" }])).rejects.toThrow(/is a float/);
    await expect(editResource(file, [{ op: "set", key: "albedo_texture", value: "res://grad.tres" }])).rejects.toThrow(/takes a Texture2D; res:\/\/grad.tres is a Gradient/);
    await expect(editResource(file, [{ op: "set", key: "roughness", value: "0.5" }])).rejects.toThrow(/nothing to change/);
  });

  it("checks a raw ExtResource id and its type", async () => {
    const root = project();
    const file = join(root, "mat.tres");
    await expect(editResource(file, [{ op: "set", key: "normal_texture", value: 'ExtResource("9_nope")' }])).rejects.toThrow(/has no ext_resource "9_nope"; it has 1_icon/);
    await expect(editResource(file, [{ op: "set", key: "next_pass", value: 'ExtResource("1_icon")' }])).rejects.toThrow(/next_pass takes a Material; ext_resource 1_icon is a Texture2D/);
    const ok = await editResource(file, [{ op: "set", key: "normal_texture", value: 'ExtResource("1_icon")' }]);
    expect(ok.summary).toEqual(['set normal_texture = ExtResource("1_icon")']);
  });

  it("checks a sub_resource against its own script's exports", async () => {
    const root = project();
    writeFileSync(join(root, "item.gd"), "extends Resource\n\n@export var power: int = 0\n");
    writeFileSync(join(root, "inv.tres"), '[gd_resource type="Resource" format=3]\n\n[ext_resource type="Script" path="res://item.gd" id="1_item"]\n\n[sub_resource type="Resource" id="Resource_a"]\nscript = ExtResource("1_item")\n\n[resource]\nmetadata/item = SubResource("Resource_a")\n');
    const plan = await editResource(join(root, "inv.tres"), [{ op: "set", sub: "Resource_a", key: "power", value: "5" }], { write: true });
    expect(plan.summary).toEqual(["set Resource_a.power = 5"]);
    expect(read(root, "inv.tres")).toContain('script = ExtResource("1_item")\npower = 5\n');
    await expect(editResource(join(root, "inv.tres"), [{ op: "set", sub: "Resource_a", key: "power", value: "lots" }])).rejects.toThrow(/is an int/);
  });

  it("refuses files and res:// paths outside the project", async () => {
    const root = project();
    const outside = join(root, "..", `outside-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "x.tres"), '[gd_resource type="StyleBoxFlat" format=3]\n\n[resource]\n');
    await expect(editResource(join(outside, "x.tres"), [{ op: "set", key: "border_width_left", value: "3" }], { project: root, write: true })).rejects.toThrow(/outside the project/);
    const rel = `res://../${outside.split(/[\\/]/).pop()}/x.tres`;
    await expect(editResource(rel, [{ op: "set", key: "border_width_left", value: "3" }], { project: root, write: true })).rejects.toThrow(/outside the project/);
    await expect(editResource(join(root, "mat.tres"), [{ op: "set", key: "normal_texture", value: rel }])).rejects.toThrow(/outside the project/);
    expect(read(outside, "x.tres")).not.toContain("border_width_left");
  });

  it("drops an ext_resource the edit left unused, and adds one with its uid", async () => {
    const root = project();
    await editResource(join(root, "mat.tres"), [{ op: "set", key: "albedo_texture", value: "null" }], { write: true });
    expect(read(root, "mat.tres")).toBe('[gd_resource type="StandardMaterial3D" format=3 uid="uid://b1mat0000001"]\n\n[resource]\nalbedo_texture = null\nroughness = 0.5\n');
    await editResource(join(root, "mat.tres"), [{ op: "set", key: "albedo_texture", value: "res://icon.svg" }], { write: true });
    expect(read(root, "mat.tres")).toContain('[ext_resource type="Texture2D" uid="uid://c2icon000002" path="res://icon.svg" id="1_icon"]');
    expect(read(root, "mat.tres")).toContain('albedo_texture = ExtResource("1_icon")');
  });

  it("adds sub_resources and keeps them before their first use", async () => {
    const root = project();
    await editResource(
      join(root, "theme.tres"),
      [
        { op: "add_sub", type: "Gradient", id: "g" },
        { op: "add_sub", type: "GradientTexture2D", id: "gt" },
        { op: "set", sub: "gt", key: "gradient", value: 'SubResource("g")' },
        { op: "set", sub: "StyleBoxTexture_a1", key: "texture", value: 'SubResource("gt")' },
      ],
      { write: true },
    );
    const text = read(root, "theme.tres");
    expect(text.startsWith('[gd_resource type="Theme" format=3 uid="uid://d3theme00003"]\n')).toBe(true);
    const at = (s: string) => text.indexOf(s);
    expect(at('id="g"]')).toBeLessThan(at('id="gt"]'));
    expect(at('id="gt"]')).toBeLessThan(at('id="StyleBoxTexture_a1"]'));
    expect(text).toContain('[sub_resource type="StyleBoxTexture" id="StyleBoxTexture_a1"]\ncontent_margin_left = 2.0\ntexture = SubResource("gt")\n');
    await expect(editResource(join(root, "theme.tres"), [{ op: "set", sub: "gt", key: "gradient", value: 'SubResource("StyleBoxTexture_a1")' }])).rejects.toThrow(/takes a Gradient/);
    await expect(editResource(join(root, "theme.tres"), [{ op: "remove_sub", sub: "gt" }])).rejects.toThrow(/still used 1 time/);
    await expect(editResource(join(root, "theme.tres"), [{ op: "add_sub", type: "Node" }])).rejects.toThrow(/not a Resource/);
    const gone = await editResource(join(root, "theme.tres"), [{ op: "unset", sub: "StyleBoxTexture_a1", key: "texture" }, { op: "remove_sub", sub: "gt" }, { op: "remove_sub", sub: "g" }], { write: true });
    expect(gone.summary).toHaveLength(3);
    expect(read(root, "theme.tres")).toBe(THEME);
  });

  it("generates an editor-style id and edits only sub_resources in a .tscn", async () => {
    const root = project();
    const plan = await editResource(join(root, "main.tscn"), [{ op: "set", sub: "BoxMesh_1", key: "size", value: "Vector3(2, 2, 2)" }], { write: true });
    expect(read(root, "main.tscn")).toContain('[sub_resource type="BoxMesh" id="BoxMesh_1"]\nsize = Vector3(2, 2, 2)\n');
    expect(plan.written).toBe(true);
    await expect(editResource(join(root, "main.tscn"), [{ op: "set", key: "size", value: "1" }])).rejects.toThrow(/only sub_resources/);
    const added = await editResource(join(root, "theme.tres"), [{ op: "add_sub", type: "StyleBoxFlat" }]);
    expect(added.summary[0]).toMatch(/^add sub_resource StyleBoxFlat_[a-z]{5} \(StyleBoxFlat\)$/);
  });

  it("lists properties with get", async () => {
    const root = project();
    const text = formatResourcePlan(await editResource(join(root, "theme.tres"), [{ op: "get" }]));
    expect(text).toContain("res://theme.tres: Theme uid://d3theme00003, 0 ext_resources, 1 sub_resources");
    expect(text).toContain('  Panel/styles/panel = SubResource("StyleBoxTexture_a1")');
  });
});

describe("packed arrays", () => {
  const err = (m: string) => new Error(m);
  it("takes a plain list or base64 for bytes", () => {
    expect(typedValue("d", "[0, 1, 255]", "PackedByteArray", err)).toBe("PackedByteArray(0, 1, 255)");
    expect(typedValue("d", "base64:AAECA/8=", "PackedByteArray", err)).toBe('PackedByteArray("AAECA/8=")');
    expect(typedValue("d", 'PackedByteArray("AAEC")', "PackedByteArray", err)).toBe('PackedByteArray("AAEC")');
    expect(typedValue("d", "[1.5, 2]", "PackedFloat32Array", err)).toBe("PackedFloat32Array(1.5, 2)");
    expect(typedValue("d", '["a", "b"]', "PackedStringArray", err)).toBe('PackedStringArray("a", "b")');
    expect(() => typedValue("d", "[1, 256]", "PackedByteArray", err)).toThrow(/bytes \(0 to 255\); 256/);
    expect(() => typedValue("d", "base64:%%", "PackedByteArray", err)).toThrow(/valid base64/);
    expect(() => typedValue("d", "[1.5]", "PackedInt32Array", err)).toThrow(/whole numbers/);
  });
});

describe("import settings (.import)", () => {
  it("sets an option by enum name on one line, from the asset path", async () => {
    const root = project();
    const plan = await editResource(join(root, "beep.wav"), [{ op: "set", key: "edit/loop_mode", value: "Forward" }]);
    expect(plan.file).toBe("res://beep.wav.import");
    expect(plan.hunks).toEqual([{ line: 21, removed: ["edit/loop_mode=0"], added: ["edit/loop_mode=2"] }]);
    expect(formatResourcePlan(plan)).toMatch(/^import set edit\/loop_mode=2 \(Forward\) \(dry run/);
    await expect(editResource(join(root, "beep.wav"), [{ op: "set", key: "edit/looop", value: "1" }])).rejects.toThrow(/no option edit\/looop; it has edit\/trim, edit\/normalize, edit\/loop_mode/);
    await expect(editResource(join(root, "beep.wav"), [{ op: "set", key: "edit/loop_mode", value: "Sideways" }])).rejects.toThrow(/one of 0 Detect From WAV, 1 Disabled, 2 Forward/);
    await expect(editResource(join(root, "beep.wav"), [{ op: "set", key: "edit/trim", value: "yes" }])).rejects.toThrow(/is a bool/);
    await expect(editResource(join(root, "beep.wav"), [{ op: "add_sub", type: "Gradient" }])).rejects.toThrow(/works on .tres files/);
  });

  it("shows options, defaults and choices with get and diff", async () => {
    const root = project();
    await editResource(join(root, "beep.wav"), [{ op: "set", key: "edit/loop_mode", value: "ping-pong" }, { op: "set", key: "force/mono", value: "true" }], { write: true, reimport: false });
    const diff = formatResourcePlan(await editResource(join(root, "beep.wav"), [{ op: "diff" }]));
    expect(diff).toContain("res://beep.wav: importer wav, type AudioStreamWAV, uid://e4beep000004, not imported yet");
    expect(diff).toContain("* edit/loop_mode=3 (Ping-Pong)  (default 0 (Detect From WAV))");
    expect(diff).toContain("* force/mono=true  (default false)");
    expect(diff).toContain("8 options at the default");
    const one = formatResourcePlan(await editResource(join(root, "beep.wav"), [{ op: "get", key: "edit/loop_mode" }]));
    expect(one).toContain("choices: 0 Detect From WAV, 1 Disabled, 2 Forward, 3 Ping-Pong, 4 Backward");
    const back = await editResource(join(root, "beep.wav"), [{ op: "unset", key: "edit/loop_mode" }]);
    expect(back.hunks[0]?.added).toEqual(["edit/loop_mode=0"]);
  });

  it("edits per-animation, per-mesh and per-node options, checked against the asset", async () => {
    const root = project();
    const plan = await editResource(
      join(root, "car.gltf"),
      [
        { op: "set", sub: "animations/drive", key: "settings/loop_mode", value: "linear" },
        { op: "set", sub: "meshes/car_wheel_mesh", key: "generate/shadow_meshes", value: "Disable" },
        { op: "set", sub: "nodes/PATH:Root/Car/Wheel", key: "mesh_instance/cast_shadow", value: "off" },
        { op: "set", sub: "materials/Paint", key: "use_external/enabled", value: "true" },
      ],
      { write: true, reimport: false },
    );
    const text = read(root, "car.gltf.import");
    expect(text).toContain('"car_wheel_mesh": {\n"lods/normal_merge_angle": 20.0,\n"generate/shadow_meshes": 2\n}');
    expect(text).toContain('"animations": {\n"drive": {\n"settings/loop_mode": 1\n}\n}');
    expect(text).toContain('"PATH:Root/Car/Wheel": {\n"mesh_instance/cast_shadow": 0\n}');
    expect(text).toContain("gltf/naming_version=2\n");
    expect(plan.summary).toContain("set meshes/car_wheel_mesh generate/shadow_meshes=2 (Disable)");
    await expect(editResource(join(root, "car.gltf"), [{ op: "set", sub: "animations/drvie", key: "settings/loop_mode", value: "1" }])).rejects.toThrow(/has no animation "drvie"; it has drive/);
    const wrongMesh = await editResource(join(root, "car.gltf"), [{ op: "set", sub: "meshes/wheel_mesh", key: "generate/lods", value: "1" }]);
    expect(wrongMesh.warnings.join("\n")).toMatch(/has no mesh "wheel_mesh"; it has car_wheel_mesh/);
    const wrongNode = await editResource(join(root, "car.gltf"), [{ op: "set", sub: "nodes/PATH:Car/Wheel", key: "mesh_instance/cast_shadow", value: "off" }]);
    expect(wrongNode.warnings.join("\n")).toMatch(/has no node "PATH:Car\/Wheel"; it has .*PATH:Root\/Car\/Wheel/);
    await expect(editResource(join(root, "car.gltf"), [{ op: "set", sub: "meshes/car_wheel_mesh", key: "generate/shadowmeshes", value: "1" }])).rejects.toThrow(/did you mean generate\/shadow_meshes/);
    await expect(editResource(join(root, "car.gltf"), [{ op: "set", sub: "wheel_mesh", key: "generate/lods", value: "1" }])).rejects.toThrow(/sub is kind\/name/);
    await expect(editResource(join(root, "beep.wav"), [{ op: "set", sub: "meshes/x", key: "generate/lods", value: "1" }])).rejects.toThrow(/only scene imports/);
    await expect(editResource(join(root, "car.gltf"), [{ op: "set", key: "_subresources", value: "{}" }])).rejects.toThrow(/edited per sub-resource/);
    const sub = formatResourcePlan(await editResource(join(root, "car.gltf"), [{ op: "get", sub: "animations/drive" }]));
    expect(sub).toContain("  settings/loop_mode=1 (Linear)");
    const undo = await editResource(join(root, "car.gltf"), [{ op: "unset", sub: "animations/drive", key: "settings/loop_mode" }], { write: true, reimport: false });
    expect(undo.written).toBe(true);
    expect(read(root, "car.gltf.import")).not.toContain('"animations"');
  });

  it("names glTF meshes and nodes the way Godot 4.7.2 imports them", async () => {
    const root = project();
    const mesh = (name: string) => ({ name, primitives: [] });
    writeFileSync(join(root, "named.gltf"), JSON.stringify({ asset: { version: "2.0" }, scenes: [{ name: "Vehicle", nodes: [0] }], nodes: [{ name: "Root", children: [1] }, { name: "Body", mesh: 0 }], meshes: [mesh("body")] }));
    writeFileSync(join(root, "dotted.gltf"), JSON.stringify({ asset: { version: "2.0" }, scenes: [{ name: "Scene", nodes: [0] }], nodes: [{ name: "Root", children: [1] }, { name: "Bo.dy", mesh: 0 }], meshes: [mesh("my.body")] }));
    writeFileSync(join(root, "single.gltf"), JSON.stringify({ asset: { version: "2.0" }, extensionsUsed: ["GODOT_single_root"], scenes: [{ nodes: [0] }], nodes: [{ name: "R", children: [1] }, { name: "Box", mesh: 0 }], meshes: [mesh("")] }));
    const importOf = (f: string) => GLB_IMPORT.replaceAll("car.gltf", f).replace(/"car_wheel_mesh": \{\n"lods\/normal_merge_angle": 20.0\n\}/, "");
    for (const f of ["named.gltf", "dotted.gltf", "single.gltf"]) writeFileSync(join(root, `${f}.import`), importOf(f));
    const listed = async (f: string, kind: string) => formatResourcePlan(await editResource(join(root, f), [{ op: "get", sub: `${kind}/x` }]));
    expect(await listed("named.gltf", "meshes")).toContain("meshes in the asset: Vehicle_body");
    expect(await listed("dotted.gltf", "meshes")).toContain("meshes in the asset: dotted_my_body");
    expect(await listed("single.gltf", "meshes")).toContain("meshes in the asset: single_mesh");
    expect(await listed("named.gltf", "nodes")).toContain("nodes in the asset: PATH:Root, PATH:Root/Body");
    expect(await listed("dotted.gltf", "nodes")).toContain("PATH:Root/Bo_dy");
    expect(await listed("single.gltf", "nodes")).toContain("nodes in the asset: PATH:Box");
    const right = await editResource(join(root, "named.gltf"), [{ op: "set", sub: "meshes/Vehicle_body", key: "generate/shadow_meshes", value: "Disable" }]);
    expect(right.warnings.join("\n")).not.toMatch(/has no mesh/);
  });

  it("switches the importer and keeps the uid", async () => {
    const root = project();
    const plan = await editResource(join(root, "car.gltf"), [{ op: "importer", as: "animation_library" }]);
    expect(plan.hunks.flatMap((h) => h.added)).toEqual(['importer="animation_library"', 'type="AnimationLibrary"']);
    await expect(editResource(join(root, "car.gltf"), [{ op: "importer", as: "texture" }])).rejects.toThrow(/can switch the scene importer to animation_library or keep, not to texture/);
  });

  it("writes and journals without Godot, and says it did not reimport", async () => {
    const root = project();
    const plan = await editResource(join(root, "beep.wav.import"), [{ op: "set", key: "edit/loop_mode", value: "2" }], { write: true, ...NO_GODOT });
    expect(plan.reimport?.status).toBe("skipped");
    expect(formatResourcePlan(plan)).toMatch(/reimport skipped: not reimported: Godot binary not found/);
    expect(plan.journal).toBe(1);
    const undone = undoJournal(root);
    expect(undone.blocked).toBeUndefined();
    expect(read(root, "beep.wav.import")).toBe(WAV_IMPORT);
  });

  it("refuses files it cannot edit", async () => {
    const root = project();
    await expect(editResource(join(root, "nothing.png"), [{ op: "get" }])).rejects.toThrow(/does not exist \(or has no .import file/);
    await expect(editResource(join(root, "project.godot"), [{ op: "get" }])).rejects.toThrow(/not a .tres, .tscn or imported asset/);
    expect(() => toOps([{ op: "set", key: "a" }])).toThrow(ResourceEditError);
    expect(() => toOps([{ op: "set", key: "a" }])).toThrow(/op 1 \(set\) needs value/);
    expect(toOps([{ op: "set", key: "data", value: [1, 2] }])).toEqual([{ op: "set", key: "data", value: "[1,2]" }]);
  });
});

describe("line diff", () => {
  it("gives compact hunks", () => {
    expect(lineDiff(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"])).toEqual([
      { line: 2, removed: ["b"], added: ["x"] },
      { line: 5, removed: [], added: ["e"] },
    ]);
    expect(lineDiff(["a"], ["a"])).toEqual([]);
  });
});

describe("resource CLI", () => {
  it("prints a dry run and applies a JSON list", async () => {
    const root = project();
    const dry = await runCli(["resource", "set", join(root, "beep.wav"), "edit/loop_mode", "Forward"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain("+ edit/loop_mode=2");
    const bad = await runCli(["resource", "set", join(root, "beep.wav"), "edit/looop", "1"]);
    expect(bad.exitCode).toBe(1);
    const many = await runCli(["resource", "apply", join(root, "theme.tres"), '[{"op":"set","key":"default_font_size","value":24}]', "--write"]);
    expect(many.output).toMatch(/resource set default_font_size = 24 \(written, journal #1/);
  });
});

describe("markChanged", () => {
  it("moves a .import to a later whole second, since Godot compares the time in seconds", async () => {
    const root = makeProject({ "beep.wav.import": "[remap]\n" });
    const file = join(root, "beep.wav.import");
    // Written in the same second Godot last saw it.
    const seen = new Date(Math.floor(Date.now() / 1000) * 1000 + 300);
    utimesSync(file, seen, seen);
    await markChanged(file);
    expect(Math.floor(statSync(file).mtimeMs / 1000)).toBeGreaterThan(Math.floor(seen.getTime() / 1000));
    expect(readFileSync(file, "utf8")).toBe("[remap]\n");
    await expect(markChanged(join(root, "missing.import"))).resolves.toBeUndefined();
  });
});
