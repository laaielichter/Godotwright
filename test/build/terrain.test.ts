import { describe, expect, it } from "vitest";
import { loadLibrary } from "../../src/archetype/library.js";
import { buildGlb } from "../../src/build/glb.js";
import { buildKind } from "../../src/build/generators/index.js";
import { lakeOf, noise2, terrainHeight, TERRAIN_PARAMS } from "../../src/build/generators/terrain.js";
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

describe("a lake in the terrain", () => {
  const water = (input: Record<string, unknown>) => buildKind("terrain", input).nodes[0]!.children!.find((c) => c.name === "Water");
  const lakeInput = { relief: "hills", resolution: "129", tileSize: 256, lakeRadius: 50, lakeDepth: 8, seed: 3 };

  it("is absent by default and present when a radius is given, as a flat water surface under the rim of the lake", () => {
    expect(water({})).toBeUndefined();
    const node = water(lakeInput)!;
    expect(node).toBeDefined();
    const ys = new Set(node.mesh!.prims.get("lake_water")!.positions.filter((_, i) => i % 3 === 1));
    expect(ys.size).toBe(1);
    const p = resolveParams(TERRAIN_PARAMS, lakeInput, "terrain");
    const lake = lakeOf(p)!;
    expect([...ys][0]).toBeCloseTo(lake.level, 9);
    // The water sits half a metre under the lowest point of the rim, so it never runs over.
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      expect(terrainHeight(p, lake.x + lake.radius * 1.05 * Math.cos(a), lake.z + lake.radius * 1.05 * Math.sin(a))).toBeGreaterThanOrEqual(lake.level - 1e-6);
    }
  });

  it("sits half a metre under the lowest point of the rim, found on a dense reference ring", () => {
    const cases = [
      { relief: "hills", lakeRadius: 300, seed: 1, tileSize: 256, resolution: "129" },
      { relief: "mountains", lakeRadius: 300, seed: 1, tileSize: 256, resolution: "129" },
      { relief: "hills", lakeRadius: 400, seed: 5, tileSize: 1024, resolution: "33", featureSize: 20, maxHeight: 300 },
    ];
    for (const input of cases) {
      const p = resolveParams(TERRAIN_PARAMS, input, "terrain");
      const ground = resolveParams(TERRAIN_PARAMS, { ...input, lakeRadius: 0 }, "terrain");
      const lake = lakeOf(p)!;
      let lowest = Infinity;
      for (let k = 0; k < 20000; k++) {
        const a = (k / 20000) * Math.PI * 2;
        lowest = Math.min(lowest, terrainHeight(ground, lake.x + lake.radius * Math.cos(a), lake.z + lake.radius * Math.sin(a)));
      }
      expect(lake.level, JSON.stringify(input)).toBeGreaterThan(lowest - 0.6);
      expect(lake.level, JSON.stringify(input)).toBeLessThan(lowest - 0.4);
    }
  });

  it("digs a basin: the ground at the centre is below the water, by about the depth", () => {
    const p = resolveParams(TERRAIN_PARAMS, lakeInput, "terrain");
    const lake = lakeOf(p)!;
    expect(terrainHeight(p, lake.x, lake.z)).toBeCloseTo(lake.level - 8, 6);
    expect(terrainHeight(p, lake.x + 25, lake.z)).toBeLessThan(lake.level);
  });

  it("is made of whole grid cells near the lake, and only there", () => {
    const g = grid(lakeInput);
    const prim = water(lakeInput)!.mesh!.prims.get("lake_water")!;
    for (let v = 0; v < prim.positions.length; v += 3) expect(Math.hypot(prim.positions[v]!, prim.positions[v + 2]!)).toBeLessThan(50 * 1.1 + 2 * (256 / 128) + 1);
    expect(prim.indices.length / 3).toBeGreaterThan(100);
    expect(g.n).toBe(129);
  });

  it("carries on across a tile border: a lake on the border shows in both tiles and the heights match", () => {
    const base = { ...lakeInput, lakeX: 128, lakeZ: 0 };
    const west = grid({ ...base, tileX: 0, tileZ: 0 });
    const east = grid({ ...base, tileX: 1, tileZ: 0 });
    const n = west.n;
    for (let k = 0; k < n; k++) expect(west.y[k * n + (n - 1)]).toBeCloseTo(east.y[k * n]!, 9);
    expect(water({ ...base, tileX: 0, tileZ: 0 })).toBeDefined();
    expect(water({ ...base, tileX: 1, tileZ: 0 })).toBeDefined();
    // Every border vertex that lies under water has water in both tiles at the same place.
    const level = lakeOf(resolveParams(TERRAIN_PARAMS, base, "terrain"))!.level;
    const wetBorder = (tile: Record<string, unknown>, x: number) => {
      const prim = water({ ...base, ...tile })!.mesh!.prims.get("lake_water")!;
      const zs = new Set<number>();
      for (let v = 0; v < prim.positions.length; v += 3) if (Math.abs(prim.positions[v]! - x) < 1e-6) zs.add(Math.round(prim.positions[v + 2]! * 1e6));
      return zs;
    };
    const a = wetBorder({ tileX: 0 }, 128), b = wetBorder({ tileX: 1 }, -128);
    // Low ground far from the lake is not lake, so look at the border near the lake only (z within 40 m of its centre).
    let wet = 0;
    for (let k = 0; k < n; k++) if (west.y[k * n + (n - 1)]! < level - 1e-6 && Math.abs(west.z[k * n + (n - 1)]!) <= 40) {
      wet++;
      const z = Math.round(west.z[k * n + (n - 1)]! * 1e6);
      expect(a.has(z), `west ${k}`).toBe(true);
      expect(b.has(z), `east ${k}`).toBe(true);
    }
    expect(wet).toBeGreaterThan(5);
  });

  it("stays clean as a model, at the smallest and the largest lake", () => {
    for (const input of [{ lakeRadius: 5, lakeDepth: 0.5 }, { lakeRadius: 2000, lakeDepth: 100, tileSize: 1024 }, { lakeRadius: 40, lakeX: 30, lakeZ: -40, relief: "mountains" }, { lakeRadius: 60, relief: "plains", resolution: "65" }]) {
      expect(problems("terrain", input), JSON.stringify(input)).toEqual([]);
    }
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
