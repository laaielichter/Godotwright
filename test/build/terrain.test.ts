import { describe, expect, it } from "vitest";
import { loadLibrary } from "../../src/archetype/library.js";
import { buildGlb } from "../../src/build/glb.js";
import { buildKind } from "../../src/build/generators/index.js";
import { noise2, terrainHeight, TERRAIN_PARAMS } from "../../src/build/generators/terrain.js";
import { resolveParams } from "../../src/build/params.js";
import { lintModelFile } from "../../src/model/lint.js";
import { runCli } from "../helpers.js";
import { sha, writeScene } from "./helpers.js";

const library = loadLibrary();
const RELIEFS = ["plains", "hills", "mountains", "island"];

/** The vertices of the ground mesh of a terrain tile, as rows along x for each z. */
function grid(input: Record<string, unknown>): { n: number; x: number[]; y: number[]; z: number[] } {
  const scene = buildKind("terrain", input);
  const surface = scene.nodes[0]!.children!.find((c) => c.name === "Surface")!;
  const prim = surface.mesh!.prims.get("terrain_ground")!;
  const n = Math.round(Math.sqrt(prim.positions.length / 3));
  const pick = (k: number) => prim.positions.filter((_, i) => i % 3 === k);
  return { n, x: pick(0), y: pick(1), z: pick(2) };
}

const problems = (kind: string, input: Record<string, unknown> = {}): string[] => {
  const scene = buildKind(kind, input);
  const report = lintModelFile(writeScene(scene), { archetype: library.resolve(scene.archetype!) });
  return report.findings.filter((f) => f.severity !== "info").map((f) => `${f.rule} ${f.node ?? ""} ${f.message}`);
};

describe("the noise", () => {
  it("is deterministic, bounded and smooth", () => {
    expect(noise2(3.3, 7.7, 5)).toBe(noise2(3.3, 7.7, 5));
    expect(noise2(3.3, 7.7, 5)).not.toBe(noise2(3.3, 7.7, 6));
    let max = 0, jump = 0, last = noise2(0, 0, 1);
    for (let i = 1; i <= 2000; i++) {
      const v = noise2(i * 0.05, i * 0.031, 1);
      max = Math.max(max, Math.abs(v));
      jump = Math.max(jump, Math.abs(v - last));
      last = v;
    }
    expect(max).toBeLessThanOrEqual(1.2);
    expect(jump).toBeLessThan(0.25);
  });
});

describe("terrain", () => {
  it("builds a grid of resolution x resolution vertices with y up", () => {
    const g = grid({ resolution: "65", tileSize: 128 });
    expect(g.n).toBe(65);
    expect(g.x.length).toBe(65 * 65);
    expect(Math.min(...g.x)).toBeCloseTo(-64);
    expect(Math.max(...g.x)).toBeCloseTo(64);
    const scene = buildKind("terrain", { resolution: "33" });
    const prim = scene.nodes[0]!.children![0]!.mesh!.prims.get("terrain_ground")!;
    expect(prim.indices.length / 3).toBe(32 * 32 * 2);
    expect(prim.normals.filter((_, i) => i % 3 === 1).every((v) => v > 0)).toBe(true);
  });

  it("is deterministic, and a different seed gives a different landscape", () => {
    expect(sha(buildGlb(buildKind("terrain", { resolution: "33" })))).toBe(sha(buildGlb(buildKind("terrain", { resolution: "33" }))));
    expect(sha(buildGlb(buildKind("terrain", { resolution: "33", seed: 2 })))).not.toBe(sha(buildGlb(buildKind("terrain", { resolution: "33" }))));
  });

  for (const relief of RELIEFS) {
    it(`${relief}: neighbouring tiles share their border heights exactly, along x and along z`, () => {
      const base = { relief, resolution: "65", tileSize: 200, maxHeight: 120, seed: 9 };
      const centre = grid({ ...base, tileX: 0, tileZ: 0 });
      const east = grid({ ...base, tileX: 1, tileZ: 0 });
      const south = grid({ ...base, tileX: 0, tileZ: 1 });
      const n = centre.n;
      for (let k = 0; k < n; k++) {
        // The last column of a tile and the first column of its eastern neighbour: same z, same height.
        expect(centre.y[k * n + (n - 1)], `${relief} east ${k}`).toBeCloseTo(east.y[k * n]!, 9);
        expect(centre.z[k * n + (n - 1)]).toBeCloseTo(east.z[k * n]!, 9);
        // The last row and the first row of the neighbour along z.
        expect(centre.y[(n - 1) * n + k], `${relief} south ${k}`).toBeCloseTo(south.y[k]!, 9);
      }
    });

    it(`${relief}: stays clean at the smallest and the largest tile and resolution`, () => {
      for (const input of [{ tileSize: 64, resolution: "33", maxHeight: 5 }, { tileSize: 1024, resolution: "129", maxHeight: 1500, featureSize: 1000 }, { tileSize: 512, resolution: "257", featureSize: 20 }]) {
        expect(problems("terrain", { relief, ...input }), JSON.stringify({ relief, ...input })).toEqual([]);
      }
    });
  }

  it("heights follow the parameters: the base level, the height scale and the island's coast", () => {
    const p = resolveParams(TERRAIN_PARAMS, { relief: "hills", maxHeight: 40, baseLevel: 100 }, "terrain");
    for (let i = 0; i < 50; i++) expect(Math.abs(terrainHeight(p, i * 13.7, i * 7.1) - 100)).toBeLessThanOrEqual(40 * 0.5 + 1e-9);
    const island = grid({ relief: "island", resolution: "65", maxHeight: 60 });
    expect(Math.max(...island.y)).toBeGreaterThan(5);
    expect(Math.min(...island.y)).toBeLessThan(-5);
    // The land is in the middle and the sea floor at the corners of the tile.
    expect(island.y[Math.floor(island.y.length / 2)]!).toBeGreaterThan(0);
    expect(island.y[0]!).toBeLessThan(0);
  });

  it("rejects a resolution that is not a power of two plus one, and a tile outside the range", () => {
    expect(() => buildKind("terrain", { resolution: "100" })).toThrow(/resolution/);
    expect(() => buildKind("terrain", { tileSize: 5000 })).toThrow(/at most/);
  });

  it("is a sheet: the open border of the tile is fine, a hole in the middle is not", () => {
    const scene = buildKind("terrain", { resolution: "33" });
    const prim = scene.nodes[0]!.children![0]!.mesh!.prims.get("terrain_ground")!;
    prim.indices.splice(500 * 3, 6);
    const report = lintModelFile(writeScene(scene), { archetype: library.resolve("world.terrain") });
    expect(report.findings.map((f) => f.rule)).toContain("model/open-edges");
  });
});

describe("sea", () => {
  it("is a flat water plane at y = 0 with a floor below, both clean", () => {
    const scene = buildKind("sea", { size: 500, subdivisions: 16, depth: 30 });
    const [surface, floor] = scene.nodes[0]!.children!;
    expect(surface!.name).toBe("Surface");
    expect(floor!.name).toBe("Floor");
    const ys = surface!.mesh!.prims.get("sea_water")!.positions.filter((_, i) => i % 3 === 1);
    expect(new Set(ys)).toEqual(new Set([0]));
    expect(floor!.mesh!.prims.get("sea_floor")!.positions.filter((_, i) => i % 3 === 1).every((y) => y === -30)).toBe(true);
    expect(surface!.mesh!.triangles).toBe(16 * 16 * 2);
    for (const input of [{}, { size: 500, subdivisions: 4, depth: 5 }, { size: 20000, subdivisions: 256, depth: 200 }]) expect(problems("sea", input), JSON.stringify(input)).toEqual([]);
  });
});

describe("kinds and the CLI", () => {
  it("are listed with the archetype they are checked against", async () => {
    const run = await runCli(["model", "kinds"]);
    expect(run.output).toMatch(/terrain: A heightmap terrain tile/);
    expect(run.output).toMatch(/sea: A sea/);
    expect(library.get(buildKind("terrain", {}).archetype!)).toBeDefined();
    expect(library.get(buildKind("sea", {}).archetype!)).toBeDefined();
  });
});
