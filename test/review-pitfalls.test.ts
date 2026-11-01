import { describe, expect, it } from "vitest";
import { lintModelFile } from "../src/model/lint.js";
import { formatFinding } from "../src/review/format.js";
import { reviewProject } from "../src/review/review.js";
import { makeProject } from "./helpers.js";
import { box, writeGlb } from "./model-helpers.js";

/**
 * Rules that came from lessons of a real project (data/lessons.json). Each one has a case that fires and the
 * look-alike cases that must stay quiet.
 */

const PROJECT = '[application]\nconfig/name="T"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n';
const SCENE = '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node3D"]\nscript = ExtResource("1")\n';

function lines(body: string, rule: string, extra: Record<string, string> = {}): string[] {
  const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": SCENE, "main.gd": `extends Node3D\n\n\n${body}`, ...extra });
  return reviewProject(root).findings.filter((f) => f.rule === rule).map(formatFinding);
}

describe("api/infer-variant on Variant values (loop variables, untyped parameters, untyped collections)", () => {
  const rule = "api/infer-variant";

  it("reports := from a loop variable over a literal or untyped array, as Godot does", () => {
    const loop = "func spawn() -> void:\n\tvar sites := [Vector3(1, 0, 2), Vector3(3, 0, 4)]\n\tfor site in sites:\n\t\tvar ox := site.x + randf_range(-25.0, 25.0)\n\t\tprint(ox)\n";
    expect(lines(loop, rule)).toEqual([
      'res://main.gd:7: error [api/infer-variant] Cannot infer the type of "ox": "site" has no static type (it is a Variant), so "site.x" has no type. Give "ox" a type (var ox: float = ...) or type the collection (Array[Vector3], for p: Vector3 in ...).',
    ]);
    expect(lines("func spawn() -> void:\n\tfor p in [Vector2(1, 2)]:\n\t\tvar y := 2.0 * p.y\n\t\tprint(y)\n", rule)).toHaveLength(1);
  });

  it("reports := from an untyped parameter and from an untyped Dictionary or Array element", () => {
    expect(lines("func f(data) -> void:\n\tvar speed := data.speed\n\tprint(speed)\n", rule)).toHaveLength(1);
    expect(lines("func f(cfg: Dictionary) -> void:\n\tvar speed := cfg[\"speed\"]\n\tprint(speed)\n", rule)).toHaveLength(1);
    expect(lines("var table: Array = []\n\n\nfunc f() -> void:\n\tvar first := table[0]\n\tprint(first)\n", rule)).toHaveLength(1);
  });

  it("stays quiet when the type is known", () => {
    for (const body of [
      "func f() -> void:\n\tfor site: Vector3 in [Vector3.ZERO]:\n\t\tvar ox := site.x\n\t\tprint(ox)\n",
      "func f(points: Array[Vector3]) -> void:\n\tfor p in points:\n\t\tvar ox := p.x\n\t\tprint(ox)\n",
      "func f() -> void:\n\tfor i in range(4):\n\t\tvar twice := i * 2\n\t\tprint(twice)\n",
      "func f(data) -> void:\n\tvar speed: float = data.speed\n\tprint(speed)\n",
      "func f(data) -> void:\n\tvar label := \"speed_%d\" % data\n\tprint(label)\n",
      "func f(data) -> void:\n\tvar speed := data.speed as float\n\tprint(speed)\n",
      "func f(data) -> void:\n\tvar speed := absf(data.speed)\n\tprint(speed)\n",
      "func f(cfg: Dictionary[String, float]) -> void:\n\tvar speed := cfg[\"speed\"]\n\tprint(speed)\n",
    ])
      expect(lines(body, rule), body).toEqual([]);
  });
});

describe("api/freed-check-order", () => {
  it("reports a type test before the validity check of the same value", () => {
    expect(lines("func f(holder: Variant) -> void:\n\tif holder is Node and is_instance_valid(holder):\n\t\tprint(holder)\n", "api/freed-check-order")).toHaveLength(1);
  });

  it("stays quiet in the right order, or for different values", () => {
    expect(lines("func f(holder: Variant) -> void:\n\tif is_instance_valid(holder) and holder is Node:\n\t\tprint(holder)\n", "api/freed-check-order")).toEqual([]);
    expect(lines("func f(a: Variant, b: Variant) -> void:\n\tif a is Node and is_instance_valid(b):\n\t\tprint(a)\n", "api/freed-check-order")).toEqual([]);
  });
});

describe("api/get-meta-null-default", () => {
  it("reports get_meta() with null as the default", () => {
    expect(lines('func f() -> void:\n\tvar lz: Variant = get_meta("landing_zone", null)\n\tprint(lz)\n', "api/get-meta-null-default")).toHaveLength(1);
  });

  it("stays quiet with another default or none", () => {
    expect(lines('func f() -> void:\n\tvar n: int = get_meta("count", 0)\n\tprint(n)\n', "api/get-meta-null-default")).toEqual([]);
    expect(lines('func f() -> void:\n\tif has_meta("lz"):\n\t\tprint(get_meta("lz"))\n', "api/get-meta-null-default")).toEqual([]);
  });
});

describe("api/parse-into-typed", () => {
  it("reports parsed data assigned straight to a typed Array or Dictionary", () => {
    expect(lines('func f(text: String) -> void:\n\tvar rows: Array = JSON.parse_string(text)\n\tprint(rows)\n', "api/parse-into-typed")).toHaveLength(1);
    expect(lines('func f(text: String) -> void:\n\tvar cfg: Dictionary = str_to_var(text)\n\tprint(cfg)\n', "api/parse-into-typed")).toHaveLength(1);
  });

  it("stays quiet when parsed into a Variant first", () => {
    expect(lines('func f(text: String) -> void:\n\tvar parsed: Variant = JSON.parse_string(text)\n\tif parsed is Array:\n\t\tprint(parsed)\n', "api/parse-into-typed")).toEqual([]);
  });
});

describe("api/duplicate-declaration", () => {
  it("reports the same function twice, as a merge leaves it", () => {
    expect(lines("func start_rig() -> void:\n\tpass\n\n\nfunc start_rig() -> void:\n\tpass\n", "api/duplicate-declaration")).toEqual([
      'res://main.gd:8: error [api/duplicate-declaration] "start_rig" is declared twice in this class: as a function on line 4 and as a function here. Godot stops with a parse error; remove one (a merge or a patch often adds the same code twice).',
    ]);
    expect(lines("var speed: float = 1.0\nconst SPEED := 2.0\nvar speed: float = 3.0\n", "api/duplicate-declaration")).toHaveLength(1);
  });

  it("stays quiet for the same name in an inner class", () => {
    expect(lines("func run() -> void:\n\tpass\n\n\nclass Helper:\n\tfunc run() -> void:\n\t\tpass\n", "api/duplicate-declaration")).toEqual([]);
  });
});

describe("api/image-load-res", () => {
  it("reports an image read from its source file in the project", () => {
    expect(lines('func f() -> void:\n\tvar img := Image.load_from_file("res://textures/decal.png")\n\tprint(img)\n', "api/image-load-res")).toHaveLength(1);
    expect(lines('func f() -> void:\n\tvar img := Image.new()\n\timg.load("res://textures/decal.png")\n', "api/image-load-res")).toHaveLength(1);
  });

  it("stays quiet for user:// files, resources and other files", () => {
    expect(lines('func f() -> void:\n\tvar img := Image.load_from_file("user://shot.png")\n\tprint(img)\n', "api/image-load-res")).toEqual([]);
    expect(lines('func f() -> void:\n\tvar tex := ResourceLoader.load("res://textures/decal.png")\n\tprint(tex)\n', "api/image-load-res")).toEqual([]);
    expect(lines('func f() -> void:\n\tvar cfg := ConfigFile.new()\n\tcfg.load("res://settings.cfg")\n', "api/image-load-res")).toEqual([]);
  });
});

describe("performance/runtime-gltf-mipmaps", () => {
  const load = 'func f(bytes: PackedByteArray) -> Node:\n\tvar doc := GLTFDocument.new()\n\tvar state := GLTFState.new()\n\tdoc.append_from_buffer(bytes, "", state)\n\treturn doc.generate_scene(state)\n';

  it("reports a glTF turned into a scene at runtime without mipmaps", () => {
    expect(lines(load, "performance/runtime-gltf-mipmaps")).toHaveLength(1);
  });

  it("stays quiet when the script makes mipmaps, or is an editor tool", () => {
    expect(lines(`${load}\n\nfunc mips(img: Image) -> void:\n\timg.generate_mipmaps()\n`, "performance/runtime-gltf-mipmaps")).toEqual([]);
    expect(lines("", "performance/runtime-gltf-mipmaps", { "tool.gd": `@tool\nextends EditorScenePostImport\n\n\n${load}` })).toEqual([]);
  });
});

describe("quality/mojibake", () => {
  it("reports text encoded twice", () => {
    expect(lines('func f() -> void:\n\tprint("CafÃ© open")\n', "quality/mojibake")).toHaveLength(1);
  });

  it("stays quiet for real accents", () => {
    expect(lines('func f() -> void:\n\tprint("Café, Ærø, São Paulo")\n', "quality/mojibake")).toEqual([]);
  });
});

describe("quality/interpolation-reset-every-tick", () => {
  it("reports a reset that runs on every tick", () => {
    expect(lines("func _physics_process(_delta: float) -> void:\n\tglobal_position += Vector3.UP\n\treset_physics_interpolation()\n", "quality/interpolation-reset-every-tick")).toHaveLength(1);
  });

  it("stays quiet for a reset after a teleport only", () => {
    expect(lines("var teleported: bool = false\n\n\nfunc _physics_process(_delta: float) -> void:\n\tif teleported:\n\t\treset_physics_interpolation()\n\t\tteleported = false\n", "quality/interpolation-reset-every-tick")).toEqual([]);
    expect(lines("var jumped: bool = false\n\n\nfunc _physics_process(_delta: float) -> void:\n\tif not jumped:\n\t\treturn\n\treset_physics_interpolation()\n", "quality/interpolation-reset-every-tick")).toEqual([]);
    expect(lines("func teleport(to: Vector3) -> void:\n\tglobal_position = to\n\treset_physics_interpolation()\n", "quality/interpolation-reset-every-tick")).toEqual([]);
  });
});

describe("quality/platform-layers-not-restored", () => {
  const scene = '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="CharacterBody3D"]\nscript = ExtResource("1")\n';

  it("reports moving platforms switched off for good", () => {
    expect(lines("func carry(rider: CharacterBody3D) -> void:\n\trider.platform_floor_layers = 0\n", "quality/platform-layers-not-restored", { "main.tscn": scene })).toHaveLength(1);
  });

  it("stays quiet when the old value comes back", () => {
    const body = "var saved: int = -1\n\n\nfunc carry(rider: CharacterBody3D) -> void:\n\tsaved = rider.platform_floor_layers\n\trider.platform_floor_layers = 0\n\n\nfunc stop(rider: CharacterBody3D) -> void:\n\trider.platform_floor_layers = saved\n";
    expect(lines(body, "quality/platform-layers-not-restored", { "main.tscn": scene })).toEqual([]);
  });
});

describe("performance/small-light-cube-shadow", () => {
  const light = (props: string) => `[gd_scene format=3]\n\n[node name="Cockpit" type="Node3D"]\n\n[node name="Fill" type="OmniLight3D" parent="."]\n${props}\n`;
  const run = (props: string) => {
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": light(props) });
    return reviewProject(root).findings.filter((f) => f.rule === "performance/small-light-cube-shadow");
  };

  it("reports a small omni light with a cube shadow", () => {
    expect(run("shadow_enabled = true\nomni_range = 1.5")).toHaveLength(1);
  });

  it("stays quiet without shadows, with dual paraboloid, or for a large light", () => {
    expect(run("omni_range = 1.5")).toEqual([]);
    expect(run("shadow_enabled = true\nomni_range = 1.5\nomni_shadow_mode = 0")).toEqual([]);
    expect(run("shadow_enabled = true")).toEqual([]);
  });
});

describe("api/override-signature", () => {
  const base = "class_name Weapon\nextends Node3D\n\n\nfunc apply_hit(at: Vector3, damage: float, surface: String = \"\") -> void:\n\tprint(at, damage, surface)\n";
  const run = (body: string) => lines(body, "api/override-signature", { "weapon.gd": base });

  it("reports an override with fewer parameters, or extra ones without a default", () => {
    expect(run("func apply_hit(at: Vector3, damage: float) -> void:\n\tprint(at, damage)\n").length).toBe(0);
    const child = (fn: string) =>
      lines("", "api/override-signature", { "weapon.gd": base, "gun.gd": `extends Weapon\n\n\n${fn}` });
    expect(child("func apply_hit(at: Vector3) -> void:\n\tprint(at)\n")).toEqual([
      'res://gun.gd:4: error [api/override-signature] apply_hit() takes 1 parameter here, but the version in Weapon takes 3. Godot stops with "The function signature doesn\'t match the parent". Keep the parent\'s parameters; extra ones need a default value.',
    ]);
    expect(child("func apply_hit(at: Vector3, damage: float, surface: String, crit: bool) -> void:\n\tprint(at, damage, surface, crit)\n")).toHaveLength(1);
    expect(lines("func _process() -> void:\n\tpass\n", "api/override-signature")).toHaveLength(1);
    expect(lines("func _ready(extra: int) -> void:\n\tprint(extra)\n", "api/override-signature")).toHaveLength(1);
  });

  it("stays quiet for matching overrides, extra parameters with defaults, constructors and static functions", () => {
    const child = (fn: string) =>
      lines("", "api/override-signature", { "weapon.gd": base, "gun.gd": `extends Weapon\n\n\n${fn}` });
    expect(child("func apply_hit(at: Vector3, damage: float, surface: String = \"\", crit := false) -> void:\n\tprint(at, damage, surface, crit)\n")).toEqual([]);
    expect(child("func apply_hit(a: Vector3, b: float, c: String = \"x\") -> void:\n\tprint(a, b, c)\n")).toEqual([]);
    expect(child("func _init(power: int) -> void:\n\tprint(power)\n")).toEqual([]);
    expect(lines("func _process(delta: float) -> void:\n\tprint(delta)\n\n\nfunc _input(_event: InputEvent) -> void:\n\tpass\n", "api/override-signature")).toEqual([]);
    expect(lines("func set_speed(v: float) -> void:\n\tprint(v)\n", "api/override-signature")).toEqual([]);
  });
});

describe("performance/get-image-in-loop", () => {
  it("reports a texture read back inside a loop", () => {
    expect(lines("func f(textures: Array[Texture2D]) -> void:\n\tfor t in textures:\n\t\tvar img := t.get_image()\n\t\tprint(img)\n", "performance/get-image-in-loop")).toHaveLength(1);
  });

  it("stays quiet for one read outside a loop, for screenshots, and in test runners", () => {
    expect(lines("func f(t: Texture2D) -> void:\n\tvar img := t.get_image()\n\tfor i in 3:\n\t\tprint(img, i)\n", "performance/get-image-in-loop")).toEqual([]);
    expect(lines("func f() -> void:\n\tfor i in 3:\n\t\tawait RenderingServer.frame_post_draw\n\t\tget_viewport().get_texture().get_image().save_png(\"user://shot.png\")\n", "performance/get-image-in-loop")).toEqual([]);
    const runner = "extends SceneTree\n\n\nfunc check(textures: Array[Texture2D]) -> void:\n\tfor t in textures:\n\t\tprint(t.get_image().has_mipmaps())\n";
    expect(lines("", "performance/get-image-in-loop", { "tests/check.gd": runner })).toEqual([]);
  });
});

describe("quality/tree-test-reads-too-early", () => {
  const test = (body: string) => lines("", "quality/tree-test-reads-too-early", { "tests/check.gd": `extends SceneTree\n\n\n${body}` });

  it("reports global positions read before the scene is inside the tree", () => {
    expect(test("func _initialize() -> void:\n\tvar world := Node3D.new()\n\troot.add_child(world)\n\tprint(world.global_position)\n\tquit()\n")).toHaveLength(1);
  });

  it("stays quiet after an await, and in scripts that are not SceneTree tests", () => {
    expect(test("func _initialize() -> void:\n\tvar world := Node3D.new()\n\troot.add_child(world)\n\tawait process_frame\n\tprint(world.global_position)\n\tquit()\n")).toEqual([]);
    expect(lines("func _ready() -> void:\n\tget_tree().root.add_child(Node3D.new())\n\tprint(global_position)\n", "quality/tree-test-reads-too-early")).toEqual([]);
  });
});

describe("quality/shader-reads-own-depth", () => {
  const shader = (mode: string) =>
    `shader_type spatial;\nrender_mode ${mode};\n\nuniform sampler2D depth_tex : hint_depth_texture;\n\nvoid fragment() {\n\tALBEDO = vec3(texture(depth_tex, SCREEN_UV).r);\n}\n`;
  const run = (source: string) => {
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "water.gdshader": source });
    return reviewProject(root).findings.filter((f) => f.rule === "quality/shader-reads-own-depth").map(formatFinding);
  };

  it("reports a shader that reads the depth texture and writes depth in the alpha prepass", () => {
    expect(run(shader("blend_mix, depth_prepass_alpha"))).toEqual([
      "res://water.gdshader:2: warning [quality/shader-reads-own-depth] This shader writes its own depth in the alpha prepass and also reads the depth texture, so it reads its own surface: depth-based foam or fog shows everywhere. Use depth_draw_always instead of depth_prepass_alpha.",
    ]);
  });

  it("stays quiet with another depth mode, or in a comment", () => {
    expect(run(shader("blend_mix, depth_draw_always"))).toEqual([]);
    expect(run(shader("blend_mix // , depth_prepass_alpha"))).toEqual([]);
  });
});

describe("model rules from lessons", () => {
  const rules = (path: string) => lintModelFile(path).findings.map((f) => f.rule);

  it("model/opaque-glass: glass that light cannot pass", () => {
    const glass = (material: object) => writeGlb({ meshes: [{ ...box(), material: 0 }], materials: [material], nodes: [{ name: "Canopy", mesh: 0 }] });
    expect(rules(glass({ name: "Glass" }))).toContain("model/opaque-glass");
    expect(rules(glass({ name: "cockpit_windscreen", alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }))).toContain("model/opaque-glass");
    expect(rules(glass({ name: "Glass", alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [0.6, 0.7, 0.8, 0.25] } }))).not.toContain("model/opaque-glass");
    expect(rules(glass({ name: "Glass", extensions: { KHR_materials_transmission: { transmissionFactor: 1 } } }))).not.toContain("model/opaque-glass");
    expect(rules(glass({ name: "Fiberglass hull" }))).not.toContain("model/opaque-glass");
    expect(rules(glass({ name: "Paint" }))).not.toContain("model/opaque-glass");
    // Dark, solid glass on a model with nothing behind it (a house without rooms) is a choice, not a mistake.
    expect(rules(glass({ name: "window_glass", pbrMetallicRoughness: { baseColorFactor: [0.03, 0.045, 0.06, 1] } }))).not.toContain("model/opaque-glass");
  });

  it("model/renamed-on-import: names Godot changes", () => {
    const named = (name: string) => writeGlb({ meshes: [box()], nodes: [{ name, mesh: 0 }] });
    const found = lintModelFile(named("Wheel.001")).findings.find((f) => f.rule === "model/renamed-on-import");
    expect(found?.message).toContain('"Wheel.001" becomes "Wheel_001" in Godot');
    expect(rules(named("Door:Left"))).toContain("model/renamed-on-import");
    expect(rules(named("Wheel_FL"))).not.toContain("model/renamed-on-import");
  });
});
