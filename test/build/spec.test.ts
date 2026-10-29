import { describe, expect, it } from "vitest";
import { buildGlb } from "../../src/build/glb.js";
import { evaluate } from "../../src/build/expr.js";
import { LIMITS, buildSpec, mirrorNode } from "../../src/build/spec.js";
import { EXAMPLE_SPEC } from "../../src/build/spec-help.js";
import { inspectModel } from "../../src/model/inspect.js";
import { lintModelFile } from "../../src/model/lint.js";
import { runCli } from "../helpers.js";
import { sha, volume, writeScene } from "./helpers.js";

const spec = (nodes: unknown[], extra: object = {}) => ({ version: 1, nodes, ...extra });
const solid = (extra: object = {}) => ({ name: "A", shape: "box", size: [1, 1, 1], material: "paint", ...extra });
const names = (raw: unknown, overrides = {}) => inspectModel(writeScene(buildSpec(raw, overrides))).nodes.map((n) => n.path);

describe("expressions", () => {
  it("does arithmetic with the usual precedence", () => {
    expect(evaluate("1 + 2 * 3", {})).toBe(7);
    expect(evaluate("(1 + 2) * 3", {})).toBe(9);
    expect(evaluate("-2 ^ 2", {})).toBe(-4);
    expect(evaluate("2 ^ 3 ^ 2", {})).toBe(512);
    expect(evaluate("10 / 4 - 1", {})).toBe(1.5);
    expect(evaluate("7 % 4", {})).toBe(3);
    expect(evaluate("1.5e1 + .5", {})).toBe(15.5);
  });

  it("uses variables, constants and functions", () => {
    expect(evaluate("$width / 2 - 0.1", { width: 4 })).toBeCloseTo(1.9);
    expect(evaluate("max($a, 1) * min(2, 3)", { a: 5 })).toBe(10);
    expect(evaluate("sin(rad(90)) + cos(0) + pi", {})).toBeCloseTo(2 + Math.PI);
    expect(evaluate("clamp(5, 0, 3) + lerp(0, 10, 0.5) + abs(-1) + sqrt(16)", {})).toBe(3 + 5 + 1 + 4);
    expect(evaluate("deg(atan2(1, 1))", {})).toBeCloseTo(45);
    expect(evaluate("hypot(3, 4) + deg(asin(1)) + deg(acos(1)) + deg(atan(1))", {})).toBeCloseTo(5 + 90 + 0 + 45);
  });

  it("explains mistakes, and never runs code", () => {
    expect(() => evaluate("$nope", { a: 1 })).toThrow(/unknown variable \$nope \(known: \$a\)/);
    expect(() => evaluate("foo(1)", {})).toThrow(/unknown function foo\(\)/);
    expect(() => evaluate("width", {})).toThrow(/variables start with \$/);
    expect(() => evaluate("1 / 0", {})).toThrow(/division by zero/);
    expect(() => evaluate("1 +", {})).toThrow(/ends too early/);
    expect(() => evaluate("(1", {})).toThrow(/expected "\)"/);
    expect(() => evaluate("1 2", {})).toThrow(/extra input/);
    expect(() => evaluate("process.exit()", {})).toThrow();
    expect(() => evaluate("require('fs')", {})).toThrow(/unexpected/);
    expect(() => evaluate("(".repeat(100) + "1" + ")".repeat(100), {})).toThrow(/too deeply nested/);
    expect(() => evaluate("1".repeat(600), {})).toThrow(/too long/);
    expect(() => evaluate("pow(10, 999)", {})).toThrow(/not a finite number/);
  });
});

describe("the example car", () => {
  const path = writeScene(buildSpec(EXAMPLE_SPEC));
  it("builds a clean model with the shape a car has", () => {
    const report = lintModelFile(path);
    expect(report.findings.filter((f) => f.severity !== "info")).toEqual([]);
    expect(report.overall).toBeGreaterThanOrEqual(95);
    const info = inspectModel(path);
    expect(info.nodes.map((n) => n.path)).toEqual(["Car", "Car/Body", "Car/Cabin", "Car/Wheels", "Car/Wheels/Wheel_FL", "Car/Wheels/Wheel_FR", "Car/Wheels/Wheel_RL", "Car/Wheels/Wheel_RR"]);
    expect(info.bounds?.size[0]).toBeCloseTo(1.8);
    expect(info.bounds?.size[2]).toBeCloseTo(4.4);
    expect(info.bounds?.min[1]).toBeCloseTo(0);
  });

  it("puts each wheel's pivot at its hub, left and right mirrored", () => {
    const info = inspectModel(path);
    const wheel = (n: string) => info.nodes.find((x) => x.name === n)!;
    expect(wheel("Wheel_FL").mirrored).toBe(false);
    const scene = buildSpec(EXAMPLE_SPEC);
    const wheels = scene.nodes[0]!.children!.find((c) => c.name === "Wheels")!.children!;
    expect(wheels.map((w) => w.name)).toEqual(["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]);
    // The front faces +z, so the car's left side is +x.
    expect(wheels[0]!.translation).toEqual([0.78, 0.33, 1.3]);
    expect(wheels[1]!.translation).toEqual([-0.78, 0.33, 1.3]);
  });

  it("has outward faces on every shell, and the parameters change the size", () => {
    const scene = buildSpec(EXAMPLE_SPEC);
    const body = scene.nodes[0]!.children!.find((c) => c.name === "Body")!;
    expect(volume(body.mesh!)).toBeGreaterThan(1);
    expect(inspectModel(writeScene(buildSpec(EXAMPLE_SPEC, { width: "2.2" }))).bounds?.size[0]).toBeCloseTo(2.2);
  });

  it("is deterministic", () => {
    expect(sha(buildGlb(buildSpec(EXAMPLE_SPEC)))).toBe(sha(buildGlb(buildSpec(EXAMPLE_SPEC))));
  });
});

describe("nodes", () => {
  it("builds every shape into a clean closed solid", () => {
    const shapes = [
      { shape: "box", size: [1, 2, 3], anchor: "bottom" },
      { shape: "cylinder", radius: 0.5, height: 2, axis: "z" },
      { shape: "cylinder", radius: 0.5, height: 2, anchor: "base" },
      { shape: "ellipsoid", radii: [1, 2, 1] },
      { shape: "lathe", profile: [[0, 0], [1, 0.2], [1, 2], [0, 2.4]], segments: 16 },
      { shape: "loft", sections: [{ z: 0, points: [[-1, 0], [1, 0], [1, 1], [-1, 1]] }, { z: 3, points: [[-0.5, 0], [0.5, 0], [0.5, 0.5], [-0.5, 0.5]] }] },
      { shape: "extrude", plan: [[0, 0], [4, 0], [4, 2], [0, 2]], y1: 3 },
      { shape: "roof", x0: -3, x1: 3, z0: -4, z1: 4, y: 3, rise: 1.5, kind: "hip" },
    ];
    for (const s of shapes) {
      const report = lintModelFile(writeScene(buildSpec(spec([{ ...s, name: "S", material: "concrete" }]))));
      expect(report.findings.filter((f) => f.severity !== "info"), JSON.stringify(s)).toEqual([]);
    }
  });

  it("places, rotates and anchors", () => {
    const info = inspectModel(writeScene(buildSpec(spec([solid({ size: [2, 1, 1], anchor: "bottom", at: [0, 3, 0], rotate: [0, 90, 0] })]))));
    expect(info.bounds?.min[1]).toBeCloseTo(3);
    expect(info.bounds?.size[0]).toBeCloseTo(1);
    expect(info.bounds?.size[2]).toBeCloseTo(2);
  });

  it("repeats with a step and names the copies", () => {
    expect(names(spec([solid({ repeat: { count: 3, step: [2, 0, 0] } })]))).toEqual(["A_1", "A_2", "A_3"]);
    expect(names(spec([solid({ name: "Window{i}", repeat: { count: 2, step: [0, 1, 0] } })]))).toEqual(["Window1", "Window2"]);
    const size = inspectModel(writeScene(buildSpec(spec([solid({ repeat: { count: 3, step: [2, 0, 0] } })])))).bounds?.size[0];
    expect(size).toBeCloseTo(5);
    expect(inspectModel(writeScene(buildSpec(spec([solid({ at: ["$i", 0, 0], repeat: { count: 2, step: [0, 0, 0] } })])))).bounds?.size[0]).toBeCloseTo(2);
  });

  it("mirrors a node and its children with the mirrored pivot", () => {
    const raw = spec([{ name: "Arm_L", at: [2, 1, 0], rotate: [0, 30, 10], mirror: "Arm_R", children: [solid({ name: "Hand", at: [0, 0, 1] })] }]);
    const scene = buildSpec(raw);
    const [left, right] = scene.nodes;
    expect(right!.name).toBe("Arm_R");
    expect(right!.translation).toEqual([-2, 1, 0]);
    expect(right!.rotation![1]).toBeCloseTo(-left!.rotation![1]);
    expect(right!.rotation![2]).toBeCloseTo(-left!.rotation![2]);
    expect(right!.rotation![0]).toBeCloseTo(left!.rotation![0]);
    expect(right!.children![0]!.name).toBe("Hand");
    expect(mirrorNode(left!, "X").children![0]!.mesh!.triangles).toBe(12);
    expect(lintModelFile(writeScene(scene)).findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("inherits materials, and scopes variables to the node and its children", () => {
    const raw = spec([{ name: "G", material: "brick", vars: { half: 2 }, children: [{ name: "B", shape: "box", size: ["$half", 1, 1] }] }, { name: "H", shape: "box", size: ["$half", 1, 1], material: "paint" }]);
    expect(() => buildSpec(raw)).toThrow(/nodes\[1\].size\[0\]: unknown variable \$half/);
    const ok = buildSpec(spec([{ name: "G", material: "brick", vars: { half: 2 }, children: [{ name: "B", shape: "box", size: ["$half", 1, 1] }] }]));
    expect([...ok.nodes[0]!.children![0]!.mesh!.prims.keys()]).toEqual(["brick"]);
  });

  it("uses spec parameters and custom materials", () => {
    const raw = spec([{ name: "A", shape: "box", size: ["$w", 1, 1], material: "mine" }], {
      params: [{ name: "w", type: "number", default: 2, min: 1, max: 5 }, { name: "tall", type: "boolean", default: true }],
      materials: { mine: { color: [0.1, 0.2, 0.3], metallic: 1, roughness: 0.1 } },
    });
    expect(inspectModel(writeScene(buildSpec(raw))).bounds?.size[0]).toBeCloseTo(2);
    expect(inspectModel(writeScene(buildSpec(raw, { w: "4" }))).bounds?.size[0]).toBeCloseTo(4);
    expect(() => buildSpec(raw, { w: 9 })).toThrow(/at most 5/);
    expect(() => buildSpec(raw, { q: 1 })).toThrow(/unknown parameter "q"/);
  });
});

describe("mistakes get a path and a reason", () => {
  const fail = (raw: unknown, pattern: RegExp) => expect(() => buildSpec(raw)).toThrow(pattern);
  it("covers the common ones", () => {
    fail(null, /must be a JSON object/);
    fail({ nodes: [] }, /"version": 1/);
    fail({ version: 1 }, /nodes: expected a list/);
    fail({ version: 1, nodes: [], extra: 1 }, /unknown key "extra"/);
    fail(spec([{ shape: "box" }]), /nodes\[0\]: every node needs a "name"/);
    fail(spec([solid({ shape: "cube" })]), /unknown shape "cube"/);
    fail(spec([solid({ radius: 1 })]), /nodes\[0\]: unknown key "radius"/);
    fail(spec([solid({ material: "gold" })]), /unknown material "gold"/);
    fail(spec([{ name: "A", shape: "box", size: [1, 1, 1] }]), /needs a "material"/);
    fail(spec([solid({ size: [1, 1] })]), /size: expected a list of 3 numbers/);
    fail(spec([solid({ size: [1, -1, 1] })]), /all sizes must be positive/);
    fail(spec([solid({ size: ["$x", 1, 1] })]), /nodes\[0\]\.size\[0\]: unknown variable \$x/);
    fail(spec([solid(), solid()]), /two nodes are called "A"/);
    fail(spec([solid({ repeat: { count: 0, step: [1, 0, 0] } })]), /whole number from 1 to 500/);
    fail(spec([solid({ mirror: "" })]), /give the name of the mirrored node/);
    fail(spec([{ name: "A", bogus: 1 }]), /nodes\[0\]: unknown key "bogus"/);
    fail(spec([{ name: "L", shape: "loft", material: "paint", sections: [{ z: 0, points: [[0, 0], [1, 0], [1, 1]] }, { z: 1, points: [[0, 0], [1, 0], [1, 1], [0, 1]] }] }]), /every section needs the same number/);
    fail(spec([{ name: "L", shape: "loft", material: "paint", sections: [{ z: 0, superellipse: { width: 1, height: 1, count: 9 } }, { z: 1, superellipse: { width: 1, height: 1 } }] }]), /must be even/);
    fail(spec([{ name: "R", shape: "roof", material: "paint", x0: 0, x1: 1, z0: 0, z1: 1, y: 0, rise: 1, kind: "dome" }]), /use "gable" or "hip"/);
    fail(spec([solid({ at: [1, 2] })]), /expected a list of 3 numbers/);
  });

  it("stops specs that grow without bound", () => {
    const grid = { name: "Row{i}", repeat: { count: 400, step: [1, 0, 0] }, children: [{ name: "Cell{i}", repeat: { count: 400, step: [0, 1, 0] }, children: [solid({ name: "B" })] }] };
    expect(() => buildSpec(spec([grid]))).toThrow(new RegExp(`too many nodes \\(max ${LIMITS.nodes}\\)`));
    expect(() => buildSpec(spec([{ name: "E", shape: "ellipsoid", material: "paint", radii: [1, 1, 1], segments: 128, repeat: { count: 500, step: [1, 0, 0] } }]))).toThrow(/triangles/);
  });
});

describe("model build --spec and model spec", () => {
  it("prints the format and an example that builds", async () => {
    const run = await runCli(["model", "spec"]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("A model spec is JSON");
    expect(run.output).toContain('"name": "Wheel_FL"');
  });

  it("builds a spec file with --set, writes a contract and lints clean", async () => {
    const dir = writeScene(buildSpec(EXAMPLE_SPEC)).replace("model.glb", "");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${dir}car.json`, JSON.stringify(EXAMPLE_SPEC));
    const run = await runCli(["model", "build", "--spec", `${dir}car.json`, "--set", "width=2", "-o", `${dir}car.glb`, "--contract-out", `${dir}car.contract.json`]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toMatch(/built .*car\.glb: .* 8 nodes, 2\.00 x /);
    const lint = await runCli(["model", "lint", `${dir}car.glb`, "--contract", `${dir}car.contract.json`, "--min-score", "95"]);
    expect(lint.exitCode).toBe(0);
  });

  it("needs a kind or a spec, and reports a bad spec", async () => {
    expect((await runCli(["model", "build"])).exitCode).toBe(1);
    const dir = writeScene(buildSpec(EXAMPLE_SPEC)).replace("model.glb", "");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${dir}bad.json`, JSON.stringify({ version: 1, nodes: [{ name: "A", shape: "cube" }] }));
    expect((await runCli(["model", "build", "--spec", `${dir}bad.json`, "-o", `${dir}x.glb`])).exitCode).toBe(1);
  });
});
