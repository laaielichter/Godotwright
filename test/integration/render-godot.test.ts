import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT and xvfb-run (a virtual screen). CI provides both. */
const GODOT = process.env["GODOT"];
const XVFB = spawnSync("which", ["xvfb-run"]).status === 0;

// Draws a red square in 2D and a lit blue box in 3D, then reads pixels back from the rendered frame.
const SHOT = `extends SceneTree

var _frames := 0
var _cam: Camera3D


func _initialize() -> void:
	var rect := ColorRect.new()
	rect.color = Color.RED
	rect.position = Vector2(20, 20)
	rect.size = Vector2(40, 40)
	root.add_child(rect)
	var world := Node3D.new()
	var box := MeshInstance3D.new()
	box.mesh = BoxMesh.new()
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.2, 0.5, 1.0)
	box.material_override = material
	world.add_child(box)
	_cam = Camera3D.new()
	_cam.look_at_from_position(Vector3(0, 0, 3), Vector3.ZERO)
	world.add_child(_cam)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-30, 20, 0)
	world.add_child(light)
	root.add_child(world)
	process_frame.connect(_tick)


func _tick() -> void:
	_frames += 1
	if _frames < 5:
		return
	var image := root.get_texture().get_image()
	var size := image.get_size()
	print("RENDER size ", size.x, " ", size.y)
	print("RENDER square ", image.get_pixel(40, 40).to_html(false))
	print("RENDER box ", image.get_pixel(size.x / 2, size.y / 2).to_html(false))
	print("RENDER corner ", image.get_pixel(size.x - 2, size.y - 2).to_html(false))
	image.save_png("user://render-proof.png")
	quit()
`;

describe.skipIf(!GODOT || !XVFB)("Godot renders frames on a virtual screen", () => {
  it("draws 2D and 3D with the Compatibility renderer and the pixels can be read back", { timeout: 120_000 }, () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Render"\nconfig/features=PackedStringArray("4.7")\n',
      "shot.gd": SHOT,
    });
    const out = execFileSync(
      "xvfb-run",
      ["-a", "-s", "-screen 0 1280x720x24", GODOT ?? "", "--path", root, "--rendering-driver", "opengl3", "--rendering-method", "gl_compatibility", "--resolution", "320x240", "-s", "res://shot.gd"],
      { encoding: "utf8", timeout: 100_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(out.split("\n").filter((l) => l.startsWith("RENDER") || l.startsWith("OpenGL")).join("\n"));
    const value = (name: string) => new RegExp(`^RENDER ${name} (.+)$`, "m").exec(out)?.[1];
    expect(value("size")).toBe("320 240");
    expect(value("square")).toBe("ff0000");
    // The lit box is blue, brighter or darker with the light, but blue.
    const [r, g, b] = (value("box") ?? "000000").match(/../g)!.map((h) => parseInt(h, 16));
    expect(b).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(r! + 40);
    expect(b).toBeGreaterThan(g!);
    // The corner is Godot's default clear colour (grey).
    expect(value("corner")).toBe("4d4d4d");
  });
});
