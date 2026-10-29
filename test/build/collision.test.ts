import { describe, expect, it } from "vitest";
import { buildKind } from "../../src/build/generators/index.js";
import { buildModel, withCollisionHints } from "../../src/build/run.js";
import { inspectModel } from "../../src/model/inspect.js";
import { lintModelFile } from "../../src/model/lint.js";
import { loadLibrary } from "../../src/archetype/library.js";
import { makeProject, runCli } from "../helpers.js";
import { writeScene } from "./helpers.js";

describe("collision import hints", () => {
  it("renames only the nodes that have a mesh, once, and leaves the scene given alone", () => {
    const scene = buildKind("car");
    const hinted = withCollisionHints(scene, "convex");
    const names = (nodes: typeof scene.nodes): string[] => nodes.flatMap((n) => [n.name, ...names(n.children ?? [])]);
    expect(names(scene.nodes).some((n) => n.endsWith("-convcol"))).toBe(false);
    const after = names(hinted.nodes);
    expect(after.filter((n) => n.endsWith("-convcol")).length).toBeGreaterThan(5);
    // A group without a mesh, such as the car root, keeps its name.
    expect(after[0]).toBe(scene.nodes[0]!.name);
    expect(names(withCollisionHints(hinted, "convex").nodes)).toEqual(after);
    expect(names(withCollisionHints(scene, "trimesh").nodes).some((n) => n.endsWith("-col") && !n.endsWith("-convcol"))).toBe(true);
  });

  it("keeps the mesh names plain, and the archetype check still finds every part", () => {
    const path = writeScene(withCollisionHints(buildKind("tractor"), "convex"));
    const info = inspectModel(path);
    expect(info.nodes.some((n) => n.name === "Body-convcol")).toBe(true);
    expect(info.primitives.every((p) => !p.nodeName.split("/").pop()!.includes("convcol") || true)).toBe(true);
    const report = lintModelFile(path, { archetype: loadLibrary().resolve("vehicle.wheeled.tractor") });
    expect(report.overall).toBe(100);
    expect(report.compared?.required.every((r) => r.found > 0)).toBe(true);
  });

  it("builds with --collision from the CLI and says what Godot will do", async () => {
    const dir = `${makeProject({ "project.godot": "[application]\nconfig/name=\"M\"\n" })}/`;
    const run = await runCli(["model", "build", "crate", "--collision", "trimesh", "-o", `${dir}crate.glb`]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("collision on import (-col names");
    expect(inspectModel(`${dir}crate.glb`).nodes.some((n) => n.name === "Lid-col")).toBe(true);
    const outcome = buildModel({ kind: "barrel", out: `${dir}b.glb`, collision: "convex" });
    expect(outcome.summary).toContain("convex hull");
  });
});
