import { describe, expect, it } from "vitest";
import { loadLibrary } from "../src/archetype/library.js";
import { allKinds, buildKind } from "../src/build/generators/index.js";
import { buildSpec } from "../src/build/spec.js";
import { inspectModel } from "../src/model/inspect.js";
import { lintModelFile } from "../src/model/lint.js";
import { partBoxes, separateParts, viewModel } from "../src/model/view.js";
import { runCli } from "./helpers.js";
import { writeScene } from "./build/helpers.js";

const library = loadLibrary();
const box = (name: string, at: [number, number, number], size: [number, number, number], extra: object = {}) => ({ name, shape: "box", material: "wood", size, at, ...extra });
const model = (nodes: unknown[]) => writeScene(buildSpec({ version: 1, nodes: [{ name: "Thing", children: nodes }] }));

describe("model view", () => {
  const path = model([box("Base", [0, 0.5, 0], [4, 1, 2]), box("Tower", [0, 2, 0], [1, 2, 1])]);

  it("draws every view at one scale, said once", () => {
    const text = viewModel(inspectModel(writeScene(buildKind("dragon"))));
    expect(text.match(/Scale: 1 character = [\d.]+ m wide and [\d.]+ m tall, the same in every view\./g)).toHaveLength(1);
    expect(text).not.toMatch(/\(1 character = /);
  });

  it("draws three views with one letter per part, a ground line and a table of the parts", () => {
    const text = viewModel(inspectModel(path));
    for (const title of ["FRONT", "SIDE", "TOP"]) expect(text).toContain(title);
    expect(text).toMatch(/size 4\.00 x 3\.00 x 2\.00 m/);
    expect(text).toContain("A  Thing/Base  4.00 x 1.00 x 2.00");
    expect(text).toContain("B  Thing/Tower  1.00 x 2.00 x 1.00");
    const front = text.split("\n").slice(text.split("\n").findIndex((l) => l.startsWith("FRONT")) + 1);
    // The tower stands on the base: its letters are above the base's letters in the middle of the picture.
    const rows = front.slice(0, front.findIndex((l) => l === ""));
    expect(rows.some((r) => r.includes("B"))).toBe(true);
    expect(rows.at(-1)).toMatch(/^A+$/);
    expect(rows.findIndex((r) => r.includes("B"))).toBeLessThan(rows.findIndex((r) => r.includes("A")));
    expect(text).toContain("CONNECTED");
  });

  it("shows the front of the model at the right of the side view and at the bottom of the top view", () => {
    // A nose that sticks out along +z.
    const p = model([box("Body", [0, 0.5, -0.5], [1, 1, 2]), box("Nose", [0, 0.5, 1.25], [0.4, 0.4, 0.5])]);
    const text = viewModel(inspectModel(p), { width: 40 });
    const lines = text.split("\n");
    const side = lines.slice(lines.findIndex((l) => l.startsWith("SIDE")) + 1, lines.findIndex((l) => l.startsWith("TOP")) - 1).filter((l) => l.trim() !== "");
    expect(side.some((l) => /B+$/.test(l.replace(/[- ]+$/, "")))).toBe(true);
    const top = lines.slice(lines.findIndex((l) => l.startsWith("TOP")) + 1, lines.findIndex((l) => l.startsWith("PARTS")) - 1).filter((l) => l.trim() !== "");
    expect(top.at(-1)).toMatch(/B/);
  });

  it("can show one view, at a width of your choice, and survives a model without geometry", () => {
    const one = viewModel(inspectModel(path), { only: "side", width: 30 });
    expect(one).toContain("SIDE");
    expect(one).not.toContain("FRONT");
    expect(Math.max(...one.split("\n").filter((l) => /^[A-Z -]+$/.test(l)).map((l) => l.length))).toBeLessThanOrEqual(31);
  });

  it("runs from the CLI", async () => {
    const run = await runCli(["model", "view", path, "--only", "front"]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("FRONT");
    expect(run.output).not.toContain("SIDE");
    expect(run.output).toContain("PARTS");
  });
});

describe("parts that do not touch the rest", () => {
  it("finds a ladder that stands 0.5 m from the wall, on the ground, and a part that floats in the air", () => {
    const p = model([box("Wall", [0, 1, 0], [4, 2, 0.4]), box("Ladder", [0, 1, 0.7], [0.5, 2, 0.1]), box("Lamp", [3, 4, 0], [0.3, 0.3, 0.3])]);
    const info = inspectModel(p);
    const sep = separateParts(info);
    expect(sep.map((s) => s.nodes[0])).toEqual(expect.arrayContaining(["Thing/Ladder", "Thing/Lamp"]));
    const ladder = sep.find((s) => s.nodes[0] === "Thing/Ladder")!;
    expect(ladder.grounded).toBe(true);
    expect(ladder.gap).toBeCloseTo(0.45, 2);
    expect(sep.find((s) => s.nodes[0] === "Thing/Lamp")!.grounded).toBe(false);
    expect(viewModel(info)).toMatch(/Thing\/Lamp: [\d.]+ m from the rest \(floats in the air\)/);
  });

  it("is a lint finding: a warning in the air, an info on the ground, and nothing for a model that is joined up", () => {
    const p = model([box("Wall", [0, 1, 0], [4, 2, 0.4]), box("Ladder", [0, 1, 0.7], [0.5, 2, 0.1]), box("Lamp", [3, 4, 0], [0.3, 0.3, 0.3])]);
    const findings = lintModelFile(p).findings.filter((f) => f.rule === "model/floating-part");
    expect(findings.map((f) => f.severity).sort()).toEqual(["info", "warning"]);
    const joined = model([box("Wall", [0, 1, 0], [4, 2, 0.4]), box("Ladder", [0, 1, 0.3], [0.5, 2, 0.3])]);
    expect(lintModelFile(joined).findings.map((f) => f.rule)).not.toContain("model/floating-part");
  });

  it("leaves surfaces by nature alone (a sea floor under the water), and counts touching boxes as joined", () => {
    const sea = writeScene(buildKind("sea", {}));
    expect(lintModelFile(sea, { archetype: library.resolve("world.water.sea") }).findings.map((f) => f.rule)).not.toContain("model/floating-part");
    expect(separateParts(inspectModel(sea)).length).toBe(1);
    const touching = model([box("A", [0, 0.5, 0], [1, 1, 1]), box("B", [1, 0.5, 0], [1, 1, 1])]);
    expect(separateParts(inspectModel(touching))).toEqual([]);
    expect(partBoxes(inspectModel(touching)).map((b) => b.group)).toEqual(["Thing/A", "Thing/B"]);
  });

  it("finds nothing wrong in any ready-made kind, so the ready-made models are all in one piece", () => {
    for (const k of allKinds()) {
      const scene = buildKind(k.kind, {});
      const arch = scene.archetype ? library.resolve(scene.archetype) : undefined;
      const found = lintModelFile(writeScene(scene), arch ? { archetype: arch } : {}).findings.filter((f) => f.rule === "model/floating-part");
      expect(found.map((f) => f.message), k.kind).toEqual([]);
    }
  }, 120_000);
});
