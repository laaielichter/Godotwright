import { describe, expect, it } from "vitest";
import { buildSpec } from "../../src/build/spec.js";
import { inspectModel } from "../../src/model/inspect.js";
import { lintModelFile } from "../../src/model/lint.js";
import { volume, writeScene } from "./helpers.js";

const rock = (extra: object) => buildSpec({ version: 1, nodes: [{ name: "Rock", shape: "ellipsoid", material: "stone", radii: [1.2, 0.7, 0.9], segments: 28, ...extra }] });

describe("fractured ellipsoids (cuts)", () => {
  it("stay closed, face outwards and have no slivers, for many seeds, lumps and cut counts", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const cuts of [1, 4, 9, 16]) {
        for (const lumps of [0, 0.25, 0.5]) {
          const scene = rock({ seed, cuts, lumps });
          const report = lintModelFile(writeScene(scene));
          const bad = report.findings.filter((f) => ["model/flipped-faces", "model/open-edges", "model/degenerate-triangles", "model/non-manifold"].includes(f.rule));
          expect(bad, `seed ${seed}, cuts ${cuts}, lumps ${lumps}`).toEqual([]);
          expect(volume(scene.nodes[0]!.mesh!), `seed ${seed}, cuts ${cuts}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("removes material with every cut, and keeps the same stone for the same seed", () => {
    const whole = volume(rock({ seed: 3 }).nodes[0]!.mesh!);
    const cut = volume(rock({ seed: 3, cuts: 8 }).nodes[0]!.mesh!);
    expect(cut).toBeLessThan(whole * 0.97);
    expect(cut).toBeGreaterThan(whole * 0.5);
    expect(rock({ seed: 3, cuts: 8 })).toEqual(rock({ seed: 3, cuts: 8 }));
    expect(rock({ seed: 4, cuts: 8 })).not.toEqual(rock({ seed: 3, cuts: 8 }));
  });

  it("makes flat faces: many triangles of a cut stone share exactly the same normal", () => {
    const info = inspectModel(writeScene(rock({ seed: 5, cuts: 6, lumps: 0.3 })));
    expect(info.triangles).toBeGreaterThan(500);
    const prim = rock({ seed: 5, cuts: 6, lumps: 0.3 }).nodes[0]!.mesh!.prims.values().next().value!;
    const keys = new Map<string, number>();
    for (let v = 0; v < prim.normals.length; v += 3) {
      const k = prim.normals.slice(v, v + 3).map((x) => x.toFixed(3)).join(",");
      keys.set(k, (keys.get(k) ?? 0) + 1);
    }
    // A fracture is one plane: dozens of its vertices carry its normal.
    expect(Math.max(...keys.values())).toBeGreaterThan(30);
  });

  it("refuses a cut count out of range", () => {
    expect(() => rock({ cuts: 25 })).toThrow(/cuts: must be a whole number from 0 to 24/);
  });
});
