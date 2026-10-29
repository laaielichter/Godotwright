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

/** The world-space box of every node with geometry, by its path in the file (such as "Church/Roof"). */
function nodeBoxes(kind: string, input: Record<string, unknown>): Map<string, { min: V3; max: V3 }> {
  const info = inspectModel(writeScene(buildKind(kind, input)));
  const out = new Map<string, { min: V3; max: V3 }>();
  for (const p of info.primitives) {
    const box = out.get(p.nodeName) ?? { min: [Infinity, Infinity, Infinity] as V3, max: [-Infinity, -Infinity, -Infinity] as V3 };
    for (let i = 0; i < p.vertices; i++) {
      const q = transformPoint(p.world, p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!);
      for (let a = 0; a < 3; a++) {
        box.min[a] = Math.min(box.min[a]!, q[a]!);
        box.max[a] = Math.max(box.max[a]!, q[a]!);
      }
    }
    out.set(p.nodeName, box);
  }
  return out;
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
      const boxes = nodeBoxes("church", { naveWidth });
      expect(boxes.get("Church/Roof")!.max[2], `naveWidth ${naveWidth}`).toBeCloseTo(boxes.get("Church/Belfry")!.min[2], 1);
    }
  });

  it("sailboat: the mast top is mastHeight above the waterline, and the sails stay under it", () => {
    const cases: Record<string, number>[] = [{}, { length: 4, mastHeight: 6 }, { length: 20, mastHeight: 6 }, { length: 20, mastHeight: 28 }];
    for (const input of cases) {
      const boxes = nodeBoxes("sailboat", input);
      const top = boxes.get("Sailboat/Mast")!.max[1];
      expect(top, JSON.stringify(input)).toBeCloseTo(input.mastHeight ?? 12, 2);
      for (const sail of ["Sailboat/Sail_Main/Cloth", "Sailboat/Sail_Jib/Cloth"]) {
        expect(boxes.get(sail)!.max[1], `${sail} ${JSON.stringify(input)}`).toBeLessThanOrEqual(top + 0.01);
      }
    }
  });

  it("ship: the mast stands on the bridge roof at every length", () => {
    for (const length of [60, 200, 400]) {
      const boxes = nodeBoxes("ship", { length });
      expect(boxes.get("Ship/Mast")!.min[1], `length ${length}`).toBeCloseTo(boxes.get("Ship/Bridge")!.max[1], 2);
    }
  });

  it("fence: a post stands at each end of the section", () => {
    for (const length of [1, 3, 5]) {
      const posts = [...nodeBoxes("fence", { length }).entries()].filter(([path]) => path.startsWith("Fence/Post_")).map(([, box]) => (box.min[2] + box.max[2]) / 2);
      expect(posts.length, `length ${length}`).toBe(2);
      const [start, end] = posts.sort((a, b) => a - b);
      expect(start).toBeCloseTo(-(length / 2 - 0.05), 3);
      expect(end).toBeCloseTo(length / 2 - 0.05, 3);
    }
  });

  it("table: the apron has a front rail and a back rail", () => {
    for (const length of [0.6, 1.4, 3]) {
      const boxes = nodeBoxes("table", { length });
      const centerZ = (path: string): number => {
        const b = boxes.get(path);
        expect(b, `${path} at length ${length}`).toBeDefined();
        return (b!.min[2] + b!.max[2]) / 2;
      };
      expect(centerZ("Table/Apron_B"), `length ${length}`).toBeCloseTo(-centerZ("Table/Apron_F"), 3);
    }
  });

  it("power pylon: the back of each square frame is braced too, not a copy of the front", () => {
    for (const height of [15, 30, 70]) {
      const boxes = nodeBoxes("power-pylon", { height });
      const z = (path: string): number => {
        const b = boxes.get(path);
        expect(b, path).toBeDefined();
        return (b!.min[2] + b!.max[2]) / 2;
      };
      for (let i = 1; i <= 6; i++) {
        expect(z(`Pylon/Brace_F${i}`), `height ${height}, frame ${i}`).toBeGreaterThan(0);
        expect(z(`Pylon/Brace_B${i}`), `height ${height}, frame ${i}`).toBeCloseTo(-z(`Pylon/Brace_F${i}`), 3);
      }
    }
  });

  it("light aircraft: the wing tips sit at the wingspan, tip to tip", () => {
    for (const wingSpan of [8, 11, 13]) {
      const info = inspectModel(writeScene(buildKind("light-aircraft", { wingSpan })));
      expect(info.bounds!.size[0], `wingSpan ${wingSpan}`).toBeCloseTo(wingSpan, 1);
    }
  });

  it("light aircraft: the tailplane has a half on each side, mirror images of each other", () => {
    const boxes = nodeBoxes("light-aircraft", {});
    const left = boxes.get("LightAircraft/Stabilizer")!;
    const right = boxes.get("LightAircraft/Stabilizer_R")!;
    expect(right, "no tailplane on the -x side").toBeDefined();
    expect(right.min[0]).toBeCloseTo(-left.max[0], 3);
    expect(right.max[0]).toBeCloseTo(-left.min[0], 3);
    expect(right.min[1]).toBeCloseTo(left.min[1], 3);
    expect(right.min[2]).toBeCloseTo(left.min[2], 3);
    expect(right.max[2]).toBeCloseTo(left.max[2], 3);
  });

  it("bridge: an abutment stands at each end of the deck", () => {
    for (const length of [10, 60, 300]) {
      const L2 = length / 2;
      const abutments = [...nodeBoxes("bridge", { length }).entries()].filter(([path]) => path.startsWith("Bridge/Abutment")).map(([, box]) => box);
      expect(abutments.length, `length ${length}`).toBe(2);
      expect(abutments.some((b) => Math.abs(b.min[2] + L2) < 0.01), `length ${length}: no abutment at -z`).toBe(true);
      expect(abutments.some((b) => Math.abs(b.max[2] - L2) < 0.01), `length ${length}: no abutment at +z`).toBe(true);
    }
  });
});
