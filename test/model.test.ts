import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLibrary } from "../src/archetype/library.js";
import { contractFromArchetype, contractFromModel, loadContract } from "../src/model/contract.js";
import { formatModelReport } from "../src/model/format.js";
import { inspectModel } from "../src/model/inspect.js";
import { ModelError, loadGltf } from "../src/model/gltf.js";
import { lintModelFile } from "../src/model/lint.js";
import { box, writeGlb, type TestMesh } from "./model-helpers.js";
import { makeProject, runCli } from "./helpers.js";

const ids = (path: string, options = {}) => lintModelFile(path, options).findings.map((f) => f.rule);

/** Rewrites the JSON chunk of a .glb written by writeGlb, so a test can break one field of it. */
function editGlbJson(path: string, edit: (json: any) => void): string {
  const data = readFileSync(path);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8"));
  edit(json);
  const body = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4, 0x20)]);
  const header = Buffer.from(data.subarray(0, 12));
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(padded.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const rest = data.subarray(20 + jsonLength);
  header.writeUInt32LE(12 + 8 + padded.length + rest.length, 8);
  writeFileSync(path, Buffer.concat([header, jsonHead, padded, rest]));
  return path;
}

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

  it("finds a flat triangle whose three distinct vertices lie on one line", () => {
    const sliver: TestMesh = { positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], indices: [0, 1, 2], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1] };
    expect(ids(writeGlb({ meshes: [sliver] }))).toContain("model/degenerate-triangles");
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

  it("reports a mirror once, where it starts, with its signed scale", () => {
    const path = writeGlb({
      meshes: [box()],
      nodes: [{ name: "Left", children: [1, 2], scale: [-1, 1, 1] }, { name: "A", mesh: 0 }, { name: "B", mesh: 0, translation: [2, 0, 0] }],
      roots: [0],
    });
    const mirrored = lintModelFile(path).findings.filter((f) => f.rule === "model/mirrored-node");
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]?.node).toBe("Left");
    expect(mirrored[0]?.message).toContain("-1.00, 1.00, 1.00");
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

describe("model contract", () => {
  const named = (names: string[]) => writeGlb({ meshes: [box(2, 1, 4)], nodes: names.map((name) => ({ name, mesh: 0 })), roots: names.map((_, i) => i) });
  const contractFile = (contract: object) => makeProject({ "model.contract.json": JSON.stringify({ version: 1, ...contract }) }) + "/model.contract.json";
  const rules = (path: string, contract: object) => lintModelFile(path, { contract: loadContract(contractFile(contract)) }).findings.map((f) => f.rule);

  it("passes a model that keeps its contract", () => {
    const path = named(["Body", "Wheel"]);
    expect(rules(path, { nodes: ["Body", "Wheel"], ordered: true, size: { x: { value: 2 }, y: { value: 1 }, z: { value: 4 } }, lowestY: { value: 0 } }).filter((r) => r.startsWith("model/contract"))).toEqual([]);
  });

  it("reports a missing or renamed node, extra nodes and a changed order", () => {
    const path = named(["Wheel", "Body", "Extra"]);
    expect(rules(path, { nodes: ["Body", "Door"] })).toContain("model/contract-missing-node");
    expect(rules(path, { nodes: ["Body", "Wheel"], ordered: true })).toContain("model/contract-order");
    expect(rules(path, { nodes: ["Body", "Wheel"], exact: true })).toContain("model/contract-extra-node");
  });

  it("reports a size outside the tolerance, and accepts one inside it", () => {
    const path = named(["Body"]);
    expect(rules(path, { size: { x: { value: 2.03, tolerance: 0.01 } } })).toContain("model/contract-size");
    expect(rules(path, { size: { x: { value: 2.03, tolerance: 0.05 } } })).not.toContain("model/contract-size");
    expect(rules(path, { size: { z: { value: 4.04 } } })).not.toContain("model/contract-size");
    expect(rules(path, { size: { z: { value: 4.2 } } })).toContain("model/contract-size");
  });

  it("reports the ground level and the triangle budget", () => {
    const path = named(["Body"]);
    expect(rules(path, { lowestY: { value: 0.5 } })).toContain("model/contract-ground");
    expect(rules(path, { maxTriangles: 5 })).toContain("model/contract-triangles");
  });

  it("writes a starting contract that the same model passes", () => {
    const path = named(["Body", "Wheel"]);
    const contract = contractFromModel(inspectModel(path));
    expect(contract.nodes).toEqual(["Body", "Wheel"]);
    const report = lintModelFile(path, { contract });
    expect(report.findings.filter((f) => f.rule.startsWith("model/contract"))).toEqual([]);
  });

  it("rejects a file that is not a contract", () => {
    const root = makeProject({ "bad.json": "{ nope", "other.json": JSON.stringify({ hello: 1 }) });
    expect(() => loadContract(`${root}/bad.json`)).toThrow(/invalid JSON/);
    expect(() => loadContract(`${root}/other.json`)).toThrow(/not a model contract/);
    expect(() => loadContract(`${root}/missing.json`)).toThrow(/not found/);
  });

  it("refuses a value of the wrong type, instead of crashing or silently ignoring it", () => {
    const loads = (contract: object) => () => loadContract(makeProject({ "c.json": JSON.stringify({ version: 1, ...contract }) }) + "/c.json");
    expect(loads({ lowestY: null })).toThrow(ModelError);
    expect(loads({ lowestY: null })).toThrow(/"lowestY" must be an object/);
    expect(loads({ size: 5 })).toThrow(/"size" must be an object/);
    expect(loads({ size: { x: null } })).toThrow(/"size.x" must be an object/);
    expect(loads({ size: { X: { value: 2 } } })).toThrow(/unknown axis "X"/);
    expect(loads({ size: { x: { value: "2" } } })).toThrow(/needs a finite numeric "value"/);
    expect(loads({ size: { x: { value: 2, tolerance: -1 } } })).toThrow(/"tolerance"/);
    expect(loads({ ordered: "yes" })).toThrow(/"ordered" must be true or false/);
    expect(loads({ exact: 1 })).toThrow(/"exact" must be true or false/);
    expect(loads({ maxTriangles: "many" })).toThrow(/"maxTriangles" must be a number/);
  });

  it("loads a contract with every field as the checker expects it", () => {
    const file = contractFile({ nodes: ["Body"], ordered: true, exact: false, size: { x: { value: 2, tolerance: 0.1, source: "spec" } }, lowestY: { value: 0 }, maxTriangles: 100 });
    expect(loadContract(file)).toMatchObject({ version: 1, maxTriangles: 100, size: { x: { value: 2 } } });
  });

  it("works from the command line", async () => {
    const path = named(["Body"]);
    const made = await runCli(["model", "contract", path]);
    expect(JSON.parse(made.output).nodes).toEqual(["Body"]);
    const file = contractFile({ nodes: ["Body", "Gone"] });
    const run = await runCli(["model", "lint", path, "--contract", file]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("contract-missing-node");
  });
});

describe("model contract --archetype", () => {
  const library = loadLibrary();

  it("lists the parts that occur once, the typical size and the budget", () => {
    const c = contractFromArchetype(library.resolve("vehicle.wheeled.car"));
    expect(c.nodes).toEqual(expect.arrayContaining(["Body"]));
    expect(c.nodes).not.toContain("Wheel");
    const width = library.resolve("vehicle.wheeled.car").scale!.width!;
    expect(c.size!.x!.value).toBeCloseTo((width[0] + width[1]) / 2);
    expect(c.size!.x!.tolerance).toBeCloseTo(width[1] - width[0]);
    expect(c.lowestY).toEqual({ value: 0, tolerance: 0.05 });
    expect(c.maxTriangles).toBe(20000);
    expect(c.description).toMatch(/class C/);
  });

  it("leaves out the ground rule for a vessel, and a size the archetype does not give", () => {
    const ship = contractFromArchetype(library.resolve("vessel.ship"));
    expect(ship.lowestY).toBeUndefined();
    const barrel = contractFromArchetype(library.resolve("prop.barrel"));
    expect(barrel.size!.z).toBeUndefined();
    expect(barrel.size!.x).toBeDefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });
  /** Runs the CLI and also returns what it wrote to stderr (problems and notes). */
  const withErrors = async (args: string[]) => {
    let errors = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => ((errors += String(chunk)), true));
    const run = await runCli(args);
    return { ...run, errors };
  };

  it("writes a contract the checker accepts, from an id or a name in either language", async () => {
    for (const what of ["vehicle.wheeled.car", "helikopter"]) {
      const run = await runCli(["model", "contract", "--archetype", what]);
      expect(run.exitCode, what).toBe(0);
      const file = makeProject({ "model.contract.json": run.output }) + "/model.contract.json";
      expect(loadContract(file).version).toBe(1);
    }
  });

  it("says so for a generic match, and refuses a file together with --archetype or nothing at all", async () => {
    const generic = await withErrors(["model", "contract", "--archetype", "asdfgh"]);
    expect(generic.exitCode).toBe(0);
    expect(generic.errors).toMatch(/closest family/);
    process.exitCode = undefined;
    const both = await withErrors(["model", "contract", writeGlb({ meshes: [box(1, 1, 1)] }), "--archetype", "car"]);
    expect(both.exitCode).toBe(1);
    expect(both.errors).toMatch(/not both/);
    process.exitCode = undefined;
    const none = await withErrors(["model", "contract"]);
    expect(none.exitCode).toBe(1);
    expect(none.errors).toMatch(/--archetype/);
  });
});

describe("model recipes", () => {
  it("lists every recipe with its archetype, and as JSON", async () => {
    const { loadRecipes } = await import("../src/build/recipes.js");
    const recipes = [...loadRecipes().values()];
    const text = await runCli(["model", "recipes"]);
    expect(text.exitCode).toBe(0);
    for (const r of recipes) expect(text.output).toContain(`${r.kind}  (${r.archetype},`);
    const json = JSON.parse((await runCli(["model", "recipes", "--json"])).output) as { kind: string; archetype: string | null; params: { name: string }[] }[];
    expect(json.map((r) => r.kind)).toEqual(recipes.map((r) => r.kind));
    expect(json.every((r) => r.archetype && r.params.length > 0)).toBe(true);
  });
});

describe("model accessors", () => {
  it("refuses sparse accessors instead of reading them as zeros", () => {
    const path = editGlbJson(writeGlb({ meshes: [box()] }), (j) => {
      j.accessors[0].sparse = { count: 1, indices: { bufferView: 0, componentType: 5125 }, values: { bufferView: 0 } };
    });
    expect(() => inspectModel(path)).toThrow(ModelError);
    expect(() => inspectModel(path)).toThrow(/sparse/);
  });

  it("refuses an index past the last vertex", () => {
    const mesh = box();
    mesh.indices.push(0, 1, 99);
    expect(() => inspectModel(writeGlb({ meshes: [mesh] }))).toThrow(ModelError);
    expect(() => inspectModel(writeGlb({ meshes: [mesh] }))).toThrow(/index 99 is not one of the 24 vertices/);
  });

  it("refuses an accessor that reads past its buffer view", () => {
    const short = editGlbJson(writeGlb({ meshes: [box()] }), (j) => {
      j.bufferViews[0].byteLength = 12;
    });
    expect(() => inspectModel(short)).toThrow(/reads past the end of its buffer view/);
  });

  it("gives a clear error for a count that is negative, fractional or too large", () => {
    for (const count of [-1, 1.5, 1e12]) {
      const path = editGlbJson(writeGlb({ meshes: [box()] }), (j) => {
        j.accessors[0].count = count;
      });
      expect(() => inspectModel(path), String(count)).toThrow(ModelError);
      expect(() => inspectModel(path), String(count)).toThrow(/accessor 0/);
    }
  });
});

/** The given faces of a box() as a mesh of their own, with one material slot. */
function faces(mesh: TestMesh, which: number[], material: number): TestMesh {
  const out: TestMesh = { positions: [], indices: [], normals: [], uv: [], material };
  which.forEach((face, n) => {
    for (let k = 0; k < 4; k++) {
      const v = face * 4 + k;
      out.positions.push(...mesh.positions.slice(v * 3, v * 3 + 3));
      out.normals?.push(...(mesh.normals ?? []).slice(v * 3, v * 3 + 3));
      out.uv?.push(...(mesh.uv ?? []).slice(v * 2, v * 2 + 2));
    }
    out.indices.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
  });
  return out;
}

/** Writes a .glb whose one node draws every part, one primitive each, as a mesh with several material slots does. */
function writeOneNode(parts: TestMesh[], materials: object[] = []): string {
  return editGlbJson(writeGlb({ meshes: parts, materials }), (j) => {
    j.meshes = [{ primitives: j.meshes.map((m: { primitives: unknown[] }) => m.primitives[0]) }];
    j.nodes = [{ name: "Body", mesh: 0 }];
    j.scenes[0].nodes = [0];
  });
}

describe("model surfaces split over primitives", () => {
  const cube = box();

  it("welds a closed mesh split into two primitives, so it has no open edges", () => {
    const split = writeOneNode([faces(cube, [0, 1, 2], 0), faces(cube, [3, 4, 5], 1)], [{}, {}]);
    expect(lintModelFile(split).findings.map((f) => f.rule)).toEqual([]);
  });

  it("does not check a line or point primitive as a surface", () => {
    const textured = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    const images = [{ width: 64, height: 64 }];
    const bare: TestMesh = { ...box(), material: 0, normals: undefined, uv: undefined };
    const asTriangles = writeGlb({ meshes: [bare], materials: textured, images });
    expect(ids(asTriangles)).toEqual(expect.arrayContaining(["model/missing-normals", "model/missing-uv"]));
    const asLines = editGlbJson(writeGlb({ meshes: [bare], materials: textured, images }), (j) => {
      j.meshes[0].primitives[0].mode = 1;
    });
    const found = lintModelFile(asLines).findings;
    expect(found.map((f) => f.rule)).toEqual(["model/empty-geometry"]);
    expect(found[0]?.severity).toBe("info");
    expect(found[0]?.message).toMatch(/only lines or points/);
  });

  it("reports missing normals once per node, not once per primitive", () => {
    const bare = writeOneNode([{ ...faces(cube, [0, 1, 2], 0), normals: undefined }, { ...faces(cube, [3, 4, 5], 1), normals: undefined }], [{}, {}]);
    expect(ids(bare).filter((rule) => rule === "model/missing-normals")).toHaveLength(1);
  });
});

describe("model malformed files", () => {
  /** Expects the error to be a ModelError that says `message`, so the user sees the file and the cause. */
  const refuses = (path: string, message: RegExp) => {
    expect(() => inspectModel(path)).toThrow(ModelError);
    expect(() => inspectModel(path)).toThrow(message);
  };

  it("names the file and the broken part, instead of a bare TypeError", () => {
    refuses(editGlbJson(writeGlb({ meshes: [box()] }), (j) => { j.meshes[0].primitives = "nope"; }), /mesh 0 has no primitive list/);
    refuses(editGlbJson(writeGlb({ meshes: [box()] }), (j) => { delete j.meshes[0].primitives[0].attributes; }), /primitive 0 of mesh 0 has no attributes/);
    refuses(editGlbJson(writeGlb({ meshes: [box()] }), (j) => { delete j.meshes[0].primitives[0].attributes.POSITION; }), /primitive 0 of mesh 0 has no POSITION/);
    refuses(editGlbJson(writeGlb({ meshes: [box()] }), (j) => { j.nodes[0].children = 5; }), /node 0 children must be a list/);
    refuses(editGlbJson(writeGlb({ meshes: [box()] }), (j) => { j.buffers = "x"; }), /"buffers" must be a list/);
    refuses(editGlbJson(writeGlb({ meshes: [box()] }), (j) => { j.materials = [null]; }), /"materials" must be a list of objects/);
  });

  it("refuses a scene that does not exist, instead of drawing nothing", () => {
    refuses(editGlbJson(writeGlb({ meshes: [box()] }), (j) => { j.scene = 5; }), /scene 5 does not exist/);
  });

  it("refuses an image that points at a missing buffer view", () => {
    refuses(editGlbJson(writeGlb({ meshes: [box()], images: [{ width: 4, height: 4 }] }), (j) => { j.images[0].bufferView = 99; }), /image 0 points at a missing buffer view/);
  });

  it("says the file is not glTF when the JSON is not an object", () => {
    const root = makeProject({ "null.gltf": "null" });
    expect(() => loadGltf(`${root}/null.gltf`)).toThrow(/not a glTF 2.0 file/);
  });
});

describe("model files outside the model's folder", () => {
  /** A one-triangle .gltf whose only buffer has the given uri. */
  const gltfWith = (uri: string) =>
    JSON.stringify({
      asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ uri, byteLength: 36 }],
    });

  it("reads buffers next to the model, and refuses files outside its folder", () => {
    const root = makeProject({
      "outside.bin": "\0".repeat(36),
      "models/inside.bin": "\0".repeat(36),
      "models/inside.gltf": gltfWith("inside.bin"),
      "models/escape.gltf": gltfWith("../outside.bin"),
      "models/encoded.gltf": gltfWith("..%2Foutside.bin"),
      "models/malformed.gltf": gltfWith("%E0%A4%A"),
    });
    writeFileSync(join(root, "models", "absolute.gltf"), gltfWith(join(root, "outside.bin")));
    symlinkSync(join(root, "outside.bin"), join(root, "models", "link.bin"));
    writeFileSync(join(root, "models", "link.gltf"), gltfWith("link.bin"));
    const model = (name: string) => join(root, "models", name);
    expect(() => inspectModel(model("inside.gltf"))).not.toThrow();
    for (const name of ["escape.gltf", "encoded.gltf", "absolute.gltf", "malformed.gltf", "link.gltf"]) {
      expect(() => inspectModel(model(name)), name).toThrow(ModelError);
    }
    expect(() => inspectModel(model("escape.gltf"))).toThrow(/inside the model's folder/);
    expect(() => inspectModel(model("malformed.gltf"))).toThrow(/not valid percent-encoding/);
  });
});
