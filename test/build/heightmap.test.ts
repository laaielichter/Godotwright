import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildKind } from "../../src/build/generators/index.js";
import { heightmapSceneText, heightmapShapeText, heightmapTransform } from "../../src/build/heightmap.js";
import { BuildError } from "../../src/build/params.js";
import { buildModel } from "../../src/build/run.js";
import { makeProject, runCli } from "../helpers.js";

const PROJECT = '[application]\nconfig/name="HM"\nconfig/features=PackedStringArray("4.7")\n';

/** The vertex heights of the terrain mesh, row by row (z), as the mesh lays them out. */
function meshHeights(input: Record<string, unknown>): { n: number; step: number; y: number[]; x: number[]; z: number[] } {
  const scene = buildKind("terrain", input);
  const prim = scene.nodes[0]!.children!.find((c) => c.name === "Surface")!.mesh!.prims.get("terrain_ground")!;
  const n = Math.round(Math.sqrt(prim.positions.length / 3));
  const pick = (k: number) => prim.positions.filter((_, i) => i % 3 === k);
  return { n, step: (pick(0)[1]! - pick(0)[0]!), y: pick(1), x: pick(0), z: pick(2) };
}

describe("heightmap of a terrain tile", () => {
  it("is the mesh's own grid: same points, same heights, centred like a HeightMapShape3D", () => {
    const input = { relief: "mountains", maxHeight: 200, resolution: "33", lakeRadius: 40, lakeX: 20, lakeZ: -30 };
    const map = buildKind("terrain", input).heightmap!;
    const mesh = meshHeights(input);
    expect(map.size).toBe(33);
    expect(map.step).toBeCloseTo(256 / 32, 9);
    expect(map.heights).toEqual(mesh.y);
    // Point (i, j) of the shape is at ((i - 16) * step, (j - 16) * step), where the mesh has its vertex j * n + i.
    expect(mesh.x[0]).toBeCloseTo(-16 * map.step, 9);
    expect(mesh.z[32 * 33 + 32]).toBeCloseTo(16 * map.step, 9);
  });

  it("writes a HeightMapShape3D with the heights divided by the step, and a scene scaled by the step", () => {
    const map = { size: 2, step: 4, heights: [0, 8, -2, 1.5] };
    const tres = heightmapShapeText(map);
    expect(tres).toBe('[gd_resource type="HeightMapShape3D" format=3]\n\n[resource]\nmap_width = 2\nmap_depth = 2\nmap_data = PackedFloat32Array(0, 2, -0.5, 0.375)\n');
    expect(heightmapTransform(4)).toBe("Transform3D(4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0)");
    const tscn = heightmapSceneText("res://tiles/0-0.glb", "res://tiles/0-0.heightmap.tres", 4);
    expect(tscn).toContain('[node name="Tile_0_0" type="Node3D"]');
    expect(tscn).toContain('[node name="Terrain" parent="." instance=ExtResource("1_mesh")]');
    expect(tscn).toContain('[node name="Shape" type="CollisionShape3D" parent="Ground"]\ntransform = Transform3D(4, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0)\nshape = ExtResource("2_shape")');
    expect(() => heightmapShapeText({ size: 3, step: 1, heights: [0] })).toThrow(/expected 9/);
  });
});

describe("model build --collision heightmap", () => {
  it("writes the shape and a ready scene with res:// paths inside a Godot project", () => {
    const root = makeProject({ "project.godot": PROJECT });
    mkdirSync(join(root, "world"));
    const outcome = buildModel({ kind: "terrain", params: { resolution: "33" }, out: join(root, "world", "t.glb"), collision: "heightmap" });
    expect(outcome.extra).toEqual([join(root, "world", "t.heightmap.tres"), join(root, "world", "t.tscn")]);
    const tscn = readFileSync(join(root, "world", "t.tscn"), "utf8");
    expect(tscn).toContain('path="res://world/t.glb"');
    expect(tscn).toContain('path="res://world/t.heightmap.tres"');
    expect(outcome.summary).toContain("33 x 33 points, 8 m apart");
    // The mesh itself gets no import hints: the heightmap is the collision.
    expect(outcome.report.overall).toBe(100);
  });

  it("keeps a scene someone changed, and says what to set", () => {
    const root = makeProject({ "project.godot": PROJECT });
    writeFileSync(join(root, "t.tscn"), "[gd_scene format=3]\n");
    const outcome = buildModel({ kind: "terrain", params: { resolution: "33" }, out: join(root, "t.glb"), collision: "heightmap" });
    expect(readFileSync(join(root, "t.tscn"), "utf8")).toBe("[gd_scene format=3]\n");
    expect(outcome.extra).toEqual([join(root, "t.heightmap.tres")]);
    expect(outcome.summary).toContain("exists and was kept");
    expect(outcome.summary).toContain("uniform scale of 8");
  });

  it("writes only the shape outside a Godot project", () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-hm-"));
    const outcome = buildModel({ kind: "terrain", params: { resolution: "33" }, out: join(dir, "t.glb"), collision: "heightmap" });
    expect(outcome.extra).toEqual([join(dir, "t.heightmap.tres")]);
    expect(outcome.summary).toContain("not inside a Godot project");
  });

  it("refuses for anything that is not a terrain tile", () => {
    const root = makeProject({ "project.godot": PROJECT });
    expect(() => buildModel({ kind: "house", out: join(root, "h.glb"), collision: "heightmap" })).toThrow(BuildError);
    expect(() => buildModel({ kind: "house", out: join(root, "h.glb"), collision: "heightmap" })).toThrow(/use trimesh/);
  });

  it("works from the CLI", async () => {
    const root = makeProject({ "project.godot": PROJECT });
    const run = await runCli(["model", "build", "terrain", "--set", "resolution=33", "--collision", "heightmap", "-o", join(root, "tile.glb")]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("ready to place");
  });
});
