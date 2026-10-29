import { describe, expect, it } from "vitest";
import { buildGlb } from "../../src/build/glb.js";
import { computeTangents } from "../../src/build/glb.js";
import { MeshBuilder } from "../../src/build/mesh.js";
import { box, cylinder, ellipsoid, extrude, lathe, roof, triangulate } from "../../src/build/shapes.js";
import { inspectModel } from "../../src/model/inspect.js";
import { lintModelFile } from "../../src/model/lint.js";
import { loadGltf } from "../../src/model/gltf.js";
import { sha, single, volume, writeScene } from "./helpers.js";

const rules = (mesh: MeshBuilder) => lintModelFile(writeScene(single(mesh))).findings.filter((f) => f.severity !== "info").map((f) => f.rule);

describe("box", () => {
  it("is a closed solid with the right volume and outward faces", () => {
    const b = box([0, 0, 0], [2, 3, 4], "concrete");
    expect(b.triangles).toBe(12);
    expect(volume(b)).toBeCloseTo(24);
    expect(rules(b)).toEqual([]);
  });
});

describe("extrude", () => {
  const l: [number, number][] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 5], [0, 5]];
  it("makes a closed prism from a concave plan, whichever way the plan runs", () => {
    for (const plan of [l, [...l].reverse()]) {
      const b = extrude(plan, 0, 3, "plaster");
      expect(volume(b)).toBeCloseTo((4 * 2 + 2 * 3) * 3);
      expect(rules(b)).toEqual([]);
    }
  });

  it("triangulates a concave polygon to its exact area", () => {
    const area = triangulate(l).reduce((sum, [a, b, c]) => {
      const p = [l[a] as number[], l[b] as number[], l[c] as number[]];
      return sum + Math.abs(((p[1]![0]! - p[0]![0]!) * (p[2]![1]! - p[0]![1]!) - (p[2]![0]! - p[0]![0]!) * (p[1]![1]! - p[0]![1]!)) / 2);
    }, 0);
    expect(area).toBeCloseTo(14);
  });
});

describe("roof", () => {
  const base = { x0: -4, x1: 4, z0: -5, z1: 5, y: 3, rise: 2, material: "roof_tile" };
  it("makes a closed gable roof: base area times half the rise", () => {
    const b = roof({ ...base, kind: "gable" });
    expect(volume(b)).toBeCloseTo((8 * 10 * 2) / 2);
    expect(rules(b)).toEqual([]);
  });

  it("makes a closed hip roof, and a pyramid on a square plan", () => {
    const hip = roof({ ...base, kind: "hip" });
    expect(volume(hip)).toBeGreaterThan(0);
    expect(rules(hip)).toEqual([]);
    const pyramid = roof({ ...base, x0: -3, x1: 3, z0: -3, z1: 3, kind: "hip" });
    expect(volume(pyramid)).toBeCloseTo((6 * 6 * 2) / 3);
    expect(rules(pyramid)).toEqual([]);
  });

  it("puts the ridge along the longer side", () => {
    const wide = roof({ ...base, x0: -6, x1: 6, z0: -2, z1: 2, kind: "gable" });
    const info = inspectModel(writeScene(single(wide)));
    expect(info.bounds?.size).toEqual([12, 2, 4]);
    expect(volume(wide)).toBeCloseTo((12 * 4 * 2) / 2);
  });
});

describe("surfaces of revolution", () => {
  it("makes a closed cylinder with the volume of its polygon", () => {
    const n = 32;
    const b = cylinder(1.5, 0, 4, n, "metal");
    expect(volume(b)).toBeCloseTo(0.5 * n * 1.5 * 1.5 * Math.sin((2 * Math.PI) / n) * 4, 3);
    expect(rules(b)).toEqual([]);
    expect(volume(cylinder(1, 2, 3, 16, "metal"))).toBeCloseTo(0.5 * 16 * Math.sin((2 * Math.PI) / 16) * 3, 3);
  });

  it("faces outwards whichever way the profile runs", () => {
    const up = lathe([[0, 0], [1, 0.2], [1, 2], [0, 2.2]], 24, "metal");
    const down = lathe([[0, 2.2], [1, 2], [1, 0.2], [0, 0]], 24, "metal");
    expect(volume(up)).toBeGreaterThan(0);
    expect(volume(down)).toBeCloseTo(volume(up));
    expect(rules(down)).toEqual([]);
  });

  it("makes an ellipsoid with about the right volume", () => {
    const b = ellipsoid(2, 1, 3, 48, "paint");
    expect(volume(b) / ((4 / 3) * Math.PI * 2 * 1 * 3)).toBeGreaterThan(0.97);
    expect(volume(b) / ((4 / 3) * Math.PI * 2 * 1 * 3)).toBeLessThan(1.001);
    expect(rules(b)).toEqual([]);
  });
});

describe("mesh builder", () => {
  it("mirrors a mesh exactly and keeps it outward", () => {
    const half = box([0.5, 0, 0], [1.5, 1, 1], "paint");
    const both = half.withMirrorX();
    expect(both.triangles).toBe(24);
    expect(volume(both)).toBeCloseTo(2);
    const info = inspectModel(writeScene(single(both)));
    expect(info.bounds?.min[0]).toBeCloseTo(-1.5);
    expect(info.bounds?.max[0]).toBeCloseTo(1.5);
    expect(lintModelFile(writeScene(single(both))).findings.map((f) => f.rule)).not.toContain("model/asymmetry");
  });

  it("moves and turns a mesh, with its normals", () => {
    const b = box([0, 0, 0], [1, 1, 1], "paint").rotate("y", Math.PI / 2).translate(0, 5, 0);
    const info = inspectModel(writeScene(single(b)));
    expect(info.bounds?.min[1]).toBeCloseTo(5);
    expect(volume(b)).toBeCloseTo(1);
  });
});

describe("tangents", () => {
  it("are unit length, perpendicular to the normal, with handedness +-1", () => {
    const b = new MeshBuilder();
    b.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], "paint");
    const p = [...b.prims.values()][0]!;
    const t = computeTangents(p);
    for (let i = 0; i < 4; i++) {
      const tangent = [t[i * 4]!, t[i * 4 + 1]!, t[i * 4 + 2]!];
      const normal = [p.normals[i * 3]!, p.normals[i * 3 + 1]!, p.normals[i * 3 + 2]!];
      expect(Math.hypot(...tangent)).toBeCloseTo(1);
      expect(tangent[0]! * normal[0]! + tangent[1]! * normal[1]! + tangent[2]! * normal[2]!).toBeCloseTo(0);
      expect(Math.abs(t[i * 4 + 3]!)).toBe(1);
    }
  });
});

describe("glb writer", () => {
  it("gives the same bytes for the same scene, and reads back", () => {
    const scene = single(box([0, 0, 0], [1, 1, 1], "paint"), "Cube");
    expect(sha(buildGlb(scene))).toBe(sha(buildGlb(scene)));
    const path = writeScene(scene);
    const model = loadGltf(path);
    expect(model.json.asset?.generator).toBe("Godotwright");
    const prim = model.json.meshes?.[0]?.primitives[0];
    expect(Object.keys(prim?.attributes ?? {})).toEqual(["POSITION", "NORMAL", "TEXCOORD_0", "TANGENT"]);
    expect(inspectModel(path).nodes.map((n) => n.name)).toEqual(["Cube"]);
  });

  it("writes accessor bounds as the float32 values the buffer actually holds", () => {
    const glb = buildGlb(single(box([0.1, 0.2, 0.3], [0.7, 0.9, 1.1], "paint")));
    const jsonLength = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8")) as {
      accessors: { min: number[]; max: number[]; bufferView: number; count: number }[];
      bufferViews: { byteOffset: number }[];
      meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    };
    const position = json.accessors[json.meshes[0]!.primitives[0]!.attributes.POSITION]!;
    const start = 20 + jsonLength + 8 + json.bufferViews[position.bufferView]!.byteOffset;
    const stored = Array.from({ length: position.count }, (_, v) => [0, 1, 2].map((k) => glb.readFloatLE(start + (v * 3 + k) * 4)));
    expect(position.min).toEqual([0, 1, 2].map((k) => Math.min(...stored.map((p) => p[k]!))));
    expect(position.max).toEqual([0, 1, 2].map((k) => Math.max(...stored.map((p) => p[k]!))));
  });

  it("rejects an unknown material", () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], "no_such_material");
    expect(() => buildGlb(single(b))).toThrow(/unknown material/);
  });

  it("keeps empty nodes as plain transforms", () => {
    const glb = buildGlb({ nodes: [{ name: "Root", translation: [0, 1, 0], children: [{ name: "Child", mesh: box([0, 0, 0], [1, 1, 1], "paint") }] }] });
    const info = inspectModel(writeScene({ nodes: [{ name: "Root", translation: [0, 1, 0], children: [{ name: "Child", mesh: box([0, 0, 0], [1, 1, 1], "paint") }] }] }));
    expect(glb.length).toBeGreaterThan(0);
    expect(info.nodes.map((n) => n.path)).toEqual(["Root", "Root/Child"]);
    expect(info.bounds?.min[1]).toBeCloseTo(1);
  });
});
