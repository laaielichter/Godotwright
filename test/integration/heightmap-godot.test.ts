import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildModel } from "../../src/build/run.js";
import { runGodot } from "../../src/check/godot.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

const project = (engine: string): string => `config_version=5

[application]

config/name="Heightmap"
config/features=PackedStringArray("4.7")

[physics]

3d/physics_engine="${engine}"
`;

/**
 * Casts rays straight down onto the tile scene `model build --collision heightmap` writes, and prints where they hit.
 * Runs as a SceneTree script, after the physics server has seen the body.
 */
const PROBE = `extends SceneTree

var points: Array = []

func _initialize() -> void:
	points = JSON.parse_string(FileAccess.get_file_as_string("res://points.json"))
	var tile: Node3D = load("res://tiles/tile.tscn").instantiate()
	tile.position = Vector3(1000, 0, -500)
	root.add_child(tile)

func _physics_process(_delta: float) -> bool:
	if Engine.get_physics_frames() < 3:
		return false
	var space := root.get_world_3d().direct_space_state
	var hits: Array = []
	for p in points:
		var from := Vector3(p[0] + 1000, 2000, p[1] - 500)
		var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 4000))
		hits.append(hit.position.y if hit else null)
	print("HITS ", JSON.stringify(hits))
	return true
`;

/** The ground height at (x, z) on the tile, with each cell split from (i + 1, j) to (i, j + 1) as in the mesh. */
function groundAt(heights: number[], n: number, step: number, x: number, z: number): number {
  const gx = x / step + (n - 1) / 2, gz = z / step + (n - 1) / 2;
  const i = Math.min(n - 2, Math.floor(gx)), j = Math.min(n - 2, Math.floor(gz));
  const u = gx - i, v = gz - j;
  const h = (a: number, b: number): number => heights[b * n + a]!;
  return u + v <= 1
    ? h(i, j) + u * (h(i + 1, j) - h(i, j)) + v * (h(i, j + 1) - h(i, j))
    : h(i + 1, j + 1) + (1 - u) * (h(i, j + 1) - h(i + 1, j + 1)) + (1 - v) * (h(i + 1, j) - h(i + 1, j + 1));
}

describe.skipIf(!GODOT)("heightmap collision in Godot", () => {
  for (const engine of ["GodotPhysics3D", "Jolt Physics"]) {
    it(`puts the ground where the terrain is, on grid points and inside cells (${engine})`, { timeout: 240_000 }, async () => {
      const root = makeProject({ "project.godot": project(engine), ".gitignore": ".godot/\n", "probe.gd": PROBE });
      const outcome = buildModel({
        kind: "terrain",
        params: { relief: "mountains", maxHeight: 300, resolution: "65", seed: 7 },
        out: join(root, "tiles", "tile.glb"),
        collision: "heightmap",
      });
      expect(outcome.extra.map((f) => f.slice(root.length))).toEqual(["/tiles/tile.heightmap.tres", "/tiles/tile.tscn"]);

      // The heights back from the resource, times the scale, are the terrain's own grid.
      const tres = readFileSync(join(root, "tiles", "tile.heightmap.tres"), "utf8");
      const step = 256 / 64;
      const heights = /map_data = PackedFloat32Array\(([^)]*)\)/.exec(tres)![1]!.split(", ").map((v) => Number(v) * step);
      expect(heights).toHaveLength(65 * 65);

      // Grid points, cell centres and points near both sides of a cell's diagonal, all over the tile.
      const points: [number, number][] = [];
      for (let k = 0; k < 400; k++) {
        const a = ((k * 7919) % 997) / 997, b = ((k * 104729) % 991) / 991;
        points.push([(a - 0.5) * 250, (b - 0.5) * 250]);
      }
      for (const [i, j] of [[10, 10], [32, 32], [50, 12]] as const) {
        const x = (i - 32) * step, z = (j - 32) * step;
        points.push([x, z], [x + 0.5 * step, z + 0.5 * step], [x + 0.6 * step, z + 0.2 * step], [x + 0.2 * step, z + 0.6 * step]);
      }
      writeFileSync(join(root, "points.json"), JSON.stringify(points));

      await runGodot(GODOT!, ["--headless", "--path", root, "--import"], { timeoutMs: 120_000 });
      const run = await runGodot(GODOT!, ["--headless", "--path", root, "--script", "res://probe.gd"], { timeoutMs: 120_000 });
      const line = run.stdout.split("\n").find((l) => l.startsWith("HITS "));
      expect(line, `${run.stdout}\n${run.stderr}`).toBeDefined();
      const hits = JSON.parse(line!.slice(5)) as (number | null)[];
      let worst = 0;
      points.forEach(([x, z], k) => {
        const hit = hits[k];
        expect(hit, `no hit at ${x}, ${z}`).not.toBeNull();
        worst = Math.max(worst, Math.abs(hit! - groundAt(heights, 65, step, x, z)));
      });
      // Heights up to 300 m: a hit within 2 cm of the mesh everywhere.
      expect(worst).toBeLessThan(0.02);
    });
  }
});
