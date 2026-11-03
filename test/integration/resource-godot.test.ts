import { readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGodot } from "../../src/check/godot.js";
import { undoJournal } from "../../src/journal/journal.js";
import { editResource, formatResourcePlan } from "../../src/resource/edit.js";
import { unmet } from "../../src/resource/import.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

/** A short 8-bit mono PCM WAV. */
function wav(): Buffer {
  const samples = Buffer.alloc(2000, 128);
  for (let i = 0; i < samples.length; i++) samples[i] = 128 + Math.round(60 * Math.sin(i / 4));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + samples.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(22050, 24);
  head.writeUInt32LE(22050, 28);
  head.writeUInt16LE(1, 32);
  head.writeUInt16LE(8, 34);
  head.write("data", 36);
  head.writeUInt32LE(samples.length, 40);
  return Buffer.concat([head, samples]);
}

const MAKE_GLB = `extends SceneTree
func _init() -> void:
	var root := Node3D.new()
	root.name = "R"
	var box := MeshInstance3D.new()
	box.name = "Box"
	var mesh := BoxMesh.new()
	mesh.resource_name = "body"
	var mat := StandardMaterial3D.new()
	mat.resource_name = "Paint"
	mesh.material = mat
	box.mesh = mesh
	root.add_child(box)
	box.owner = root
	var player := AnimationPlayer.new()
	player.name = "AP"
	root.add_child(player)
	player.owner = root
	var anim := Animation.new()
	anim.length = 1.0
	var t := anim.add_track(Animation.TYPE_POSITION_3D)
	anim.track_set_path(t, "Box")
	anim.position_track_insert_key(t, 0.0, Vector3.ZERO)
	anim.position_track_insert_key(t, 1.0, Vector3.UP)
	var lib := AnimationLibrary.new()
	lib.add_animation("bob", anim)
	player.add_animation_library("", lib)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	doc.append_from_scene(root, state)
	doc.write_to_filesystem(state, ProjectSettings.globalize_path("res://car.glb"))
	quit()
`;

const CHECK = `extends SceneTree
func _init() -> void:
	var scene: Node = (load("res://car.glb") as PackedScene).instantiate()
	var box := scene.find_child("Box", true, false) as MeshInstance3D
	var player := scene.find_child("AnimationPlayer", true, false) as AnimationPlayer
	if player == null:
		player = scene.find_child("AP", true, false) as AnimationPlayer
	var anim := player.get_animation("bob")
	print("RESULT loop=%d cast=%d shadow_mesh=%s paint=%s" % [anim.loop_mode, box.cast_shadow, box.mesh.shadow_mesh != null, box.mesh.surface_get_material(0).resource_path])
	var t := load("res://icon.svg") as Texture2D
	print("RESULT tex=%s" % t.get_class())
	var library := load("res://lib.glb")
	print("RESULT lib=%s" % library.get_class())
	var data := (load("res://snd.tres") as AudioStreamWAV).data
	print("RESULT data=%s" % [data])
	var theme := load("res://theme.tres") as Theme
	var box_style := theme.get_stylebox("panel", "Panel") as StyleBoxTexture
	print("RESULT theme=%s %s" % [box_style.texture.get_class(), (box_style.texture as GradientTexture2D).gradient.get_class()])
	scene.free()
	quit()
`;

describe.skipIf(!GODOT)("resource and import edits checked by Godot", () => {
  it("edits .import options, reimports, and Godot uses them; .tres edits load", { timeout: 600_000 }, async () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Res"\nconfig/features=PackedStringArray("4.7")\n',
      "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#478cbf"/><circle cx="32" cy="32" r="20" fill="#fff"/></svg>\n',
      "make_glb.gd": MAKE_GLB,
      "check.gd": CHECK,
      "snd.tres": '[gd_resource type="AudioStreamWAV" format=3 uid="uid://b7snd0000001"]\n\n[resource]\nmix_rate = 22050\n',
      "theme.tres": '[gd_resource type="Theme" format=3 uid="uid://c7theme000002"]\n\n[sub_resource type="StyleBoxTexture" id="StyleBoxTexture_a1"]\n\n[resource]\nPanel/styles/panel = SubResource("StyleBoxTexture_a1")\n',
    });
    writeFileSync(join(root, "beep.wav"), wav());
    const made = await runGodot(GODOT as string, ["--headless", "--path", root, "--script", "res://make_glb.gd"], { timeoutMs: 120_000 });
    expect(made.code).toBe(0);
    writeFileSync(join(root, "lib.glb"), readFileSync(join(root, "car.glb")));
    const first = await editResource(join(root, "car.glb"), [{ op: "reimport" }], { godot: GODOT });
    expect(first.reimport?.status).toMatch(/changed|same/);

    // Audio: loop by name; Godot keeps it and the output changes.
    const loop = await editResource(join(root, "beep.wav"), [{ op: "set", key: "edit/loop_mode", value: "Forward" }], { write: true, godot: GODOT });
    console.log(formatResourcePlan(loop));
    expect(loop.reimport?.status).toBe("changed");
    expect(readFileSync(join(root, "beep.wav.import"), "utf8")).toContain("edit/loop_mode=2");
    // Undo is not blocked by Godot's rewrite of the .import.
    expect(undoJournal(root).blocked).toBeUndefined();
    expect(readFileSync(join(root, "beep.wav.import"), "utf8")).toContain("edit/loop_mode=0");

    // A key the importer does not read is dropped by Godot, and that is detected.
    // The edit keeps the modification time Godot saw last, as an edit in the same second does on a fast machine (CI):
    // Godot compares it in whole seconds and would skip the reimport, unless the reimport marks the file changed.
    const wavImport = join(root, "beep.wav.import");
    await editResource(join(root, "beep.wav"), [{ op: "reimport" }], { godot: GODOT });
    const seen = statSync(wavImport);
    writeFileSync(wavImport, readFileSync(wavImport, "utf8").replace("edit/trim=false", "edit/trim=false\nedit/trimm=true"));
    utimesSync(wavImport, seen.atime, seen.mtime);
    await editResource(join(root, "beep.wav"), [{ op: "reimport" }], { godot: GODOT });
    expect(unmet(readFileSync(wavImport, "utf8"), [{ what: "param", key: "edit/trimm", value: "true" }])).toEqual(["edit/trimm=true (now gone)"]);

    // Texture: VRAM compression by name gives a VRAM-compressed output file.
    const tex = await editResource(join(root, "icon.svg"), [{ op: "set", key: "compress/mode", value: "VRAM Compressed" }, { op: "set", key: "mipmaps/generate", value: "true" }], { write: true, godot: GODOT });
    console.log(formatResourcePlan(tex));
    expect(tex.reimport?.status).toBe("changed");
    expect(readFileSync(join(root, "icon.svg.import"), "utf8")).toMatch(/\.(s3tc|etc2|astc)\.ctex/);

    // glTF: per-animation loop, per-mesh shadow mesh, per-node shadow casting, an external material.
    writeFileSync(join(root, "paint.tres"), '[gd_resource type="StandardMaterial3D" format=3]\n\n[resource]\nalbedo_color = Color(0, 0, 1, 1)\n');
    const get = formatResourcePlan(await editResource(join(root, "car.glb"), [{ op: "get", sub: "meshes/car_body" }]));
    expect(get).toContain("meshes in the asset: car_body");
    const glb = await editResource(
      join(root, "car.glb"),
      [
        { op: "set", sub: "animations/bob", key: "settings/loop_mode", value: "Ping-Pong" },
        { op: "set", sub: "meshes/car_body", key: "generate/shadow_meshes", value: "Disable" },
        { op: "set", sub: "nodes/PATH:Box", key: "mesh_instance/cast_shadow", value: "Off" },
        { op: "set", sub: "materials/Paint", key: "use_external/enabled", value: "true" },
        { op: "set", sub: "materials/Paint", key: "use_external/path", value: "res://paint.tres" },
      ],
      { write: true, godot: GODOT },
    );
    console.log(formatResourcePlan(glb));
    expect(glb.warnings.join("\n")).not.toMatch(/has no/);
    expect(glb.reimport?.status).toBe("changed");

    // glTF as an AnimationLibrary, uid kept.
    const uid = /uid="([^"]+)"/.exec(readFileSync(join(root, "lib.glb.import"), "utf8"))?.[1];
    const lib = await editResource(join(root, "lib.glb"), [{ op: "importer", as: "animation_library" }], { write: true, godot: GODOT });
    expect(lib.reimport?.status).toBe("changed");
    expect(readFileSync(join(root, "lib.glb.import"), "utf8")).toContain(`uid="${uid}"`);

    // .tres: bytes as a plain list; a texture chain added as sub_resources, ordered before use.
    await editResource(join(root, "snd.tres"), [{ op: "set", key: "data", value: "[0, 1, 2, 255]" }], { write: true });
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

    const run = await runGodot(GODOT as string, ["--headless", "--path", root, "--script", "res://check.gd"], { timeoutMs: 120_000 });
    const lines = run.stdout.split("\n").filter((l) => l.startsWith("RESULT"));
    console.log(lines.join("\n"), run.stderr.split("\n").filter((l) => l.includes("ERROR")).slice(0, 5).join("\n"));
    expect(lines).toEqual([
      "RESULT loop=2 cast=0 shadow_mesh=false paint=res://paint.tres",
      "RESULT tex=CompressedTexture2D",
      "RESULT lib=AnimationLibrary",
      "RESULT data=[0, 1, 2, 255]",
      "RESULT theme=GradientTexture2D Gradient",
    ]);
  });

  it("names meshes after a named glTF scene and keeps a plain single root in node paths", { timeout: 300_000 }, async () => {
    const tri = { accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36, uri: "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAA" }] };
    const gltf = (scene: string, mesh: string) => JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ name: scene, nodes: [0] }], nodes: [{ name: "Root", children: [1] }, { name: "Body", mesh: 0 }], meshes: [{ name: mesh, primitives: [{ attributes: { POSITION: 0 } }] }], ...tri });
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Names"\nconfig/features=PackedStringArray("4.7")\n',
      "named.gltf": gltf("Vehicle", "body"),
      "dotted.gltf": gltf("Scene", "my.body"),
      "check.gd": `extends SceneTree
func _init() -> void:
	for f in ["named", "dotted"]:
		var scene: Node = (load("res://%s.gltf" % f) as PackedScene).instantiate()
		var body := scene.get_node("Root/Body") as MeshInstance3D
		print("RESULT %s mesh=%s cast=%d shadow_mesh=%s" % [f, body.mesh.resource_name, body.cast_shadow, body.mesh.shadow_mesh != null])
		scene.free()
	quit()
`,
    });
    expect((await editResource(join(root, "named.gltf"), [{ op: "reimport" }], { godot: GODOT })).reimport?.status).toMatch(/changed|same/);
    for (const [f, mesh] of [["named", "Vehicle_body"], ["dotted", "dotted_my_body"]] as const) {
      const plan = await editResource(
        join(root, `${f}.gltf`),
        [
          { op: "set", sub: `meshes/${mesh}`, key: "generate/shadow_meshes", value: "Disable" },
          { op: "set", sub: "nodes/PATH:Root/Body", key: "mesh_instance/cast_shadow", value: "Off" },
        ],
        { write: true, godot: GODOT },
      );
      console.log(formatResourcePlan(plan));
      expect(plan.warnings.join("\n")).not.toMatch(/has no/);
      expect(plan.reimport?.status).toBe("changed");
    }
    const run = await runGodot(GODOT as string, ["--headless", "--path", root, "--script", "res://check.gd"], { timeoutMs: 120_000 });
    expect(run.stdout.split("\n").filter((l) => l.startsWith("RESULT"))).toEqual([
      "RESULT named mesh=Vehicle_body cast=0 shadow_mesh=false",
      "RESULT dotted mesh=dotted_my_body cast=0 shadow_mesh=false",
    ]);
  });
});
