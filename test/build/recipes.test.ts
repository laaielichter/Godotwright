import { describe, expect, it } from "vitest";
import { checkArchetype } from "../../src/archetype/check.js";
import { loadLibrary } from "../../src/archetype/library.js";
import { buildGlb } from "../../src/build/glb.js";
import { allKinds, buildKind } from "../../src/build/generators/index.js";
import { loadRecipes } from "../../src/build/recipes.js";
import { buildSpec } from "../../src/build/spec.js";
import { inspectModel, transformPoint } from "../../src/model/inspect.js";
import { lintModelFile } from "../../src/model/lint.js";
import type { V3 } from "../../src/build/mesh.js";
import { runCli } from "../helpers.js";
import { sha, writeScene } from "./helpers.js";

const library = loadLibrary();
const recipes = [...loadRecipes().values()];

/** What a recipe may not have: any finding above info, from the lint or from its archetype. */
function problems(kind: string, input: Record<string, unknown> = {}): string[] {
  const scene = buildKind(kind, input);
  const path = writeScene(scene);
  const arch = scene.archetype ? library.resolve(scene.archetype) : undefined;
  const report = lintModelFile(path, arch ? { archetype: arch } : {});
  return report.findings.filter((f) => f.severity !== "info").map((f) => `${f.rule} ${f.node ?? ""} ${f.message}`);
}

/** The world-space box of one node's geometry, by its path in the file (such as "Church/Roof"). */
function partBox(kind: string, input: Record<string, unknown>, nodePath: string): { min: V3; max: V3 } {
  const info = inspectModel(writeScene(buildKind(kind, input)));
  const prims = info.primitives.filter((p) => p.nodeName === nodePath);
  expect(prims.length, nodePath).toBeGreaterThan(0);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    for (let i = 0; i < p.vertices; i++) {
      const q = transformPoint(p.world, p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!);
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, q[a]!);
        max[a] = Math.max(max[a]!, q[a]!);
      }
    }
  }
  return { min, max };
}

describe("ring and offset in the spec language", () => {
  const node = (extra: object) => ({ version: 1, nodes: [{ name: "Hub", children: [{ name: "Blade", shape: "box", material: "metal", size: [2, 0.1, 0.3], ...extra }] }] });

  it("turns copies about the parent's origin, with their direction", () => {
    const scene = buildSpec(node({ at: [2, 0, 0], repeat: { count: 4, around: "y" } }));
    const blades = scene.nodes[0]!.children!;
    expect(blades.map((b) => b.name)).toEqual(["Blade_1", "Blade_2", "Blade_3", "Blade_4"]);
    const t = (i: number) => blades[i]!.translation!.map((v) => Math.round(v * 1000) / 1000 + 0);
    expect(t(0)).toEqual([2, 0, 0]);
    expect(t(1)).toEqual([0, 0, -2]);
    expect(t(2)).toEqual([-2, 0, 0]);
    expect(t(3)).toEqual([0, 0, 2]);
    const bounds = inspectModel(writeScene(scene)).bounds!;
    expect(bounds.size[0]).toBeCloseTo(6);
    expect(bounds.size[2]).toBeCloseTo(6);
    expect(bounds.min[0]).toBeCloseTo(-3);
  });

  it("uses a phase, any axis, and refuses a row and a ring together", () => {
    const phased = buildSpec(node({ at: [2, 0, 0], repeat: { count: 2, around: "y", phase: 90 } }));
    expect(phased.nodes[0]!.children![0]!.translation!.map((v) => Math.round(v))).toEqual([0, 0, -2]);
    expect(() => buildSpec(node({ repeat: { count: 2, around: "w" } }))).toThrow(/use "x", "y" or "z"/);
    expect(() => buildSpec(node({ repeat: { count: 2, around: "y", step: [1, 0, 0] } }))).toThrow(/either "step" \(a row\) or "around"/);
    expect(() => buildSpec(node({ repeat: { count: 2, step: [1, 0, 0], phase: 5 } }))).toThrow(/only a ring/);
  });

  it("keeps the pivot where it is when a shape has an offset", () => {
    const scene = buildSpec(node({ offset: [1, 0, 0] }));
    const blade = scene.nodes[0]!.children![0]!;
    expect(blade.translation).toBeUndefined();
    const info = inspectModel(writeScene(scene));
    expect(info.bounds!.min[0]).toBeCloseTo(0);
    expect(info.bounds!.max[0]).toBeCloseTo(2);
    expect(info.nodes.find((n) => n.name === "Blade")!.origin).toEqual([0, 0, 0]);
  });
});

describe("the recipes", () => {
  it("are listed with the built-in kinds, with parameters and an archetype", () => {
    const kinds = allKinds();
    expect(kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(["house", "car", "tractor", "helicopter", "airliner", "ship", "tree", "conifer", "wind-turbine", "shipping-container", "truck", "bus", "motorcycle", "bicycle", "train", "tank", "light-aircraft", "fighter", "drone", "boat", "sailboat", "piston-engine", "jet-engine", "barn", "tower", "church", "windmill", "apartment", "bridge", "road", "railway-track", "street-lamp", "fence", "power-pylon", "palm", "bush", "grass", "flower", "crate", "barrel", "chair", "table"]));
    for (const r of recipes) {
      expect(r.archetype, r.kind).toBeDefined();
      expect(library.get(r.archetype!), r.kind).toBeDefined();
      expect(r.params.length, r.kind).toBeGreaterThan(0);
      expect(r.description.length, r.kind).toBeGreaterThan(20);
    }
  });

  describe.each(recipes.map((r) => [r.kind, r] as const))("%s", (kind, recipe) => {
    it("builds clean, and passes the check against its own archetype", () => {
      expect(problems(kind)).toEqual([]);
    });

    it("is deterministic", () => {
      expect(sha(buildGlb(buildKind(kind)))).toBe(sha(buildGlb(buildKind(kind))));
    });

    it("has a size the archetype finds plausible, standing on y = 0", () => {
      const info = inspectModel(writeScene(buildKind(kind)));
      const s = library.resolve(recipe.archetype!).scale!;
      const largest = Math.max(...info.bounds!.size);
      expect(largest).toBeLessThan(3 * Math.max(...[s.length, s.width, s.height].flatMap((r) => (r ? [r[1]] : []))));
      // A vessel sits on its waterline: y = 0 is the water and the hull goes below it.
      if (recipe.archetype!.startsWith("vessel")) expect(info.bounds!.min[1]).toBeLessThan(-0.5);
      else {
        expect(info.bounds!.min[1]).toBeGreaterThan(-0.01);
        expect(info.bounds!.min[1]).toBeLessThan(0.05);
      }
      expect(info.bounds!.size[0]).toBeGreaterThan(0);
    });

    it("stays clean at the lowest and highest value of every parameter, and with all of them at once", () => {
      const numeric = recipe.params.filter((p) => p.type === "number" || p.type === "integer");
      const cases: Record<string, unknown>[] = [];
      for (const p of numeric) cases.push({ [p.name]: p.min }, { [p.name]: p.max });
      cases.push(Object.fromEntries(numeric.map((p) => [p.name, p.min])), Object.fromEntries(numeric.map((p) => [p.name, p.max])));
      for (const input of cases) expect(problems(kind, input), JSON.stringify(input)).toEqual([]);
    });

    it("rejects a value outside the range of a parameter", () => {
      const p = recipe.params.find((x) => x.max !== undefined)!;
      expect(() => buildKind(kind, { [p.name]: p.max! + 1 })).toThrow(/at most/);
    });
  });

  it("has the parts the archetype demands, found by name", () => {
    for (const r of recipes) {
      const info = inspectModel(writeScene(buildKind(r.kind)));
      const found = checkArchetype(info, library.resolve(r.archetype!));
      expect(found.filter((f) => f.rule === "archetype/missing-part"), r.kind).toEqual([]);
    }
  });

  it("builds through the CLI like any kind", async () => {
    const dir = writeScene(buildKind("car")).replace("model.glb", "");
    const run = await runCli(["model", "build", "car", "--set", "length=5", "--set", "width=1.9", "-o", `${dir}c.glb`]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("(checked as vehicle.wheeled.car)");
    expect(run.output).toMatch(/ 2\.\d\d x /);
    expect(run.output).toMatch(/4\.9\d m|5\.0\d m|\d x 5\.\d\d m/);
    const kinds = await runCli(["model", "kinds"]);
    expect(kinds.output).toContain("tractor:");
    expect(kinds.output).toContain("rearWheelRadius = 0.85");
    expect((await runCli(["model", "build", "spaceship"])).exitCode).toBe(1);
  });
});

describe("recipe geometry", () => {
  it("church: the roof reaches the belfry's back face at every nave width", () => {
    for (const naveWidth of [8, 10, 25]) {
      const roof = partBox("church", { naveWidth }, "Church/Roof");
      const belfry = partBox("church", { naveWidth }, "Church/Belfry");
      expect(roof.max[2], `naveWidth ${naveWidth}`).toBeCloseTo(belfry.min[2], 1);
    }
  });
});
