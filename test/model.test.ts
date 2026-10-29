import { describe, expect, it } from "vitest";
import { formatModelReport } from "../src/model/format.js";
import { inspectModel } from "../src/model/inspect.js";
import { ModelError, loadGltf } from "../src/model/gltf.js";
import { lintModelFile } from "../src/model/lint.js";
import { box, writeGlb, type TestMesh } from "./model-helpers.js";
import { makeProject, runCli } from "./helpers.js";

const ids = (path: string, options = {}) => lintModelFile(path, options).findings.map((f) => f.rule);

describe("model inspect", () => {
  it("counts triangles, nodes and size", () => {
    const info = inspectModel(writeGlb({ meshes: [box(2, 1, 4)] }));
    expect(info.triangles).toBe(12);
    expect(info.nodes.map((n) => n.name)).toEqual(["Mesh0"]);
    expect(info.bounds?.size).toEqual([2, 1, 4]);
    expect(info.bounds?.min[1]).toBe(0);
  });

  it("applies node transforms to the bounds", () => {
    const info = inspectModel(writeGlb({ meshes: [box()], nodes: [{ name: "Big", mesh: 0, scale: [3, 3, 3], translation: [0, 2, 0] }] }));
    expect(info.bounds?.size).toEqual([3, 3, 3]);
    expect(info.bounds?.min[1]).toBeCloseTo(2);
  });

  it("reads texture sizes from the image header", () => {
    const info = inspectModel(writeGlb({ meshes: [box()], images: [{ width: 2048, height: 1024 }] }));
    expect(info.textures[0]).toMatchObject({ width: 2048, height: 1024, format: "png" });
    expect(info.textures[0]?.megabytes).toBeCloseTo((2048 * 1024 * 4 * (4 / 3)) / 1048576);
  });

  it("gives clear errors for bad files", () => {
    expect(() => loadGltf("/nonexistent/model.glb")).toThrow(ModelError);
    const root = makeProject({ "bad.glb": "this is not a glb file at all", "empty.txt": "x" });
    expect(() => loadGltf(`${root}/bad.glb`)).toThrow(/bad magic|invalid|not a/);
    expect(() => loadGltf(`${root}/empty.txt`)).toThrow(/not a .glb or .gltf/);
    expect(() => loadGltf(`${root}/x.glb`)).toThrow(/not found/);
  });
});

describe("model lint", () => {
  const shaded = { name: "paint", pbrMetallicRoughness: {} };

  it("scores a clean closed box 100", () => {
    const report = lintModelFile(writeGlb({ meshes: [{ ...box(), material: 0 }], materials: [shaded] }));
    expect(report.findings.map((f) => f.rule)).toEqual([]);
    expect(report.overall).toBe(100);
  });

  it("finds a flipped triangle", () => {
    const mesh: TestMesh = box();
    mesh.indices.splice(0, 3, mesh.indices[0] as number, mesh.indices[2] as number, mesh.indices[1] as number);
    const report = lintModelFile(writeGlb({ meshes: [mesh] }));
    expect(report.findings.map((f) => f.rule)).toContain("model/flipped-faces");
    expect(report.categories.find((c) => c.category === "geometry")?.errors).toBeGreaterThan(0);
  });

  it("finds open edges, unless the material is double sided", () => {
    const quad: TestMesh = { positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], indices: [0, 1, 2, 0, 2, 3], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] };
    expect(ids(writeGlb({ meshes: [quad] }))).toContain("model/open-edges");
    expect(ids(writeGlb({ meshes: [{ ...quad, material: 0 }], materials: [{ doubleSided: true }] }))).not.toContain("model/open-edges");
  });

  it("finds degenerate triangles", () => {
    const mesh = box();
    mesh.indices.push(0, 0, 1);
    expect(ids(writeGlb({ meshes: [mesh] }))).toContain("model/degenerate-triangles");
  });

  it("finds missing normals, UVs and tangents", () => {
    const mesh: TestMesh = { ...box(), material: 0 };
    delete mesh.normals;
    delete mesh.uv;
    const textured = { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 0 } };
    const found = ids(writeGlb({ meshes: [mesh], materials: [textured], images: [{ width: 512, height: 512 }] }));
    expect(found).toEqual(expect.arrayContaining(["model/missing-normals", "model/missing-uv"]));
    const withUv: TestMesh = { ...box(), material: 0 };
    expect(ids(writeGlb({ meshes: [withUv], materials: [textured], images: [{ width: 512, height: 512 }] }))).toContain("model/missing-tangents");
  });

  it("finds odd textures and the memory budget", () => {
    const path = writeGlb({ meshes: [box()], images: [{ width: 6000, height: 3000 }] });
    expect(ids(path)).toEqual(expect.arrayContaining(["model/texture-size", "model/texture-not-power-of-two"]));
    expect(ids(path, { maxTextureMb: 10 })).toContain("model/texture-memory");
  });

  it("finds rig problems: duplicate names, mirrored scale, ground offset", () => {
    const path = writeGlb({
      meshes: [box()],
      nodes: [{ name: "Root", children: [1, 2] }, { name: "Part", mesh: 0, scale: [-1, 1, 1], translation: [0, 2, 0] }, { name: "Part", mesh: 0 }],
    });
    const found = ids(path);
    expect(found).toEqual(expect.arrayContaining(["model/duplicate-node-names", "model/mirrored-node"]));
    expect(ids(writeGlb({ meshes: [box()], nodes: [{ name: "Up", mesh: 0, translation: [0, 3, 0] }] }))).toContain("model/ground-offset");
  });

  it("flags the triangle budget only when asked", () => {
    const path = writeGlb({ meshes: [box()] });
    expect(ids(path)).not.toContain("model/triangle-budget");
    expect(ids(path, { maxTriangles: 10 })).toContain("model/triangle-budget");
  });

  it("flags a model that is almost, but not quite, mirror-symmetric", () => {
    const mesh: TestMesh = { positions: [], indices: [], normals: [] };
    for (let i = 0; i < 100; i++) {
      const shift = i < 8 ? 0.5 : 0;
      for (const side of [-1, 1]) {
        const b = mesh.positions.length / 3;
        const x = side * (1 + i * 0.1) + (side > 0 ? shift : 0);
        mesh.positions.push(x, 0, i, x, 1, i, x + side * 0.05, 0.5, i + 0.5);
        mesh.normals?.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        mesh.indices.push(...(side > 0 ? [b, b + 1, b + 2] : [b, b + 2, b + 1]));
      }
    }
    const report = lintModelFile(writeGlb({ meshes: [{ ...mesh, material: 0 }], materials: [{ doubleSided: true }] }));
    expect(report.findings.map((f) => f.rule)).toContain("model/asymmetry");
  });

  it("formats a brief report", () => {
    const text = formatModelReport(lintModelFile(writeGlb({ meshes: [box()] })));
    expect(text).toContain("overall: ");
    expect(text).toContain("geometry");
  });
});

describe("model command", () => {
  it("prints a summary and lints with --min-score", async () => {
    const path = writeGlb({ meshes: [box()] });
    const summary = await runCli(["model", path]);
    expect(summary.exitCode).toBe(0);
    expect(summary.output).toContain("12 triangles");
    const good = await runCli(["model", "lint", path, "--min-score", "90"]);
    expect(good.exitCode).toBe(0);
    const bad = await runCli(["model", "lint", path, "--min-score", "101"]);
    expect(bad.exitCode).toBe(1);
  });

  it("exits 1 on errors and prints JSON", async () => {
    const mesh = box();
    mesh.indices.splice(0, 3, mesh.indices[0] as number, mesh.indices[2] as number, mesh.indices[1] as number);
    const run = await runCli(["model", "lint", writeGlb({ meshes: [mesh] }), "--json"]);
    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.output).findings[0].rule).toBe("model/flipped-faces");
  });

  it("reports a missing file without a stack trace", async () => {
    const run = await runCli(["model", "/nonexistent/x.glb"]);
    expect(run.exitCode).toBe(1);
  });
});
