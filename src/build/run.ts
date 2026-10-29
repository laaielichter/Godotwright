import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadLibrary } from "../archetype/library.js";
import { contractFromModel } from "../model/contract.js";
import { inspectModel } from "../model/inspect.js";
import { lintModelFile, type ModelReport } from "../model/lint.js";
import { buildGlb, type BuildNode, type BuildScene } from "./glb.js";
import { buildKind } from "./generators/index.js";
import { BuildError } from "./params.js";
import { buildSpec } from "./spec.js";

export interface BuildRequest {
  /** A ready-made kind; then `params` are its parameters. */
  kind?: string;
  /** A full model spec (parsed JSON); then `params` are overrides of the spec's own parameters. */
  spec?: unknown;
  params?: Record<string, unknown>;
  /** Where the .glb goes. */
  out: string;
  /** Also write a model.contract.json here. */
  contractOut?: string;
  /**
   * Add Godot import hints to the node names, so Godot creates collision shapes when it imports the file:
   * "convex" appends -convcol (a convex hull per mesh), "trimesh" appends -col (the exact triangles, for static
   * things such as buildings and terrain). Godot strips the suffix, so node names in the scene stay the same.
   */
  collision?: "convex" | "trimesh";
}

export const COLLISION_SUFFIX: Record<NonNullable<BuildRequest["collision"]>, string> = { convex: "-convcol", trimesh: "-col" };

/** Appends the import hint to every node that has a mesh (a copy; the scene given is not changed). */
export function withCollisionHints(scene: BuildScene, collision: NonNullable<BuildRequest["collision"]>): BuildScene {
  const suffix = COLLISION_SUFFIX[collision];
  const mark = (node: BuildNode): BuildNode => ({
    ...node,
    name: node.mesh && !node.mesh.empty && !node.name.endsWith(suffix) ? `${node.name}${suffix}` : node.name,
    ...(node.children ? { children: node.children.map(mark) } : {}),
  });
  return { ...scene, nodes: scene.nodes.map(mark) };
}

export interface BuildOutcome {
  file: string;
  /** One line: size, triangles, nodes, score and what it was checked as. */
  summary: string;
  report: ModelReport;
}

/** Builds a model, writes it, and lints it (against its archetype when the kind or spec names one). */
export function buildModel(request: BuildRequest): BuildOutcome {
  if (!request.kind && request.spec === undefined) throw new BuildError("give a kind (see `model kinds`) or a full spec (see `model spec`)");
  const params = request.params ?? {};
  const built = request.kind ? buildKind(request.kind, { ...(request.spec as object | undefined), ...params }) : buildSpec(request.spec, params);
  const scene = request.collision ? withCollisionHints(built, request.collision) : built;
  mkdirSync(dirname(request.out), { recursive: true });
  writeFileSync(request.out, buildGlb(scene));
  const info = inspectModel(request.out);
  const library = loadLibrary();
  if (scene.archetype && !library.get(scene.archetype)) throw new BuildError(`unknown archetype "${scene.archetype}" (see \`model archetypes\`)`);
  const report = lintModelFile(request.out, scene.archetype ? { archetype: library.resolve(scene.archetype) } : {});
  const size = info.bounds?.size.map((v) => v.toFixed(2)).join(" x ") ?? "?";
  const hint = request.collision ? `, collision on import (${COLLISION_SUFFIX[request.collision]} names: Godot makes a ${request.collision === "convex" ? "convex hull" : "trimesh"} StaticBody3D per mesh)` : "";
  const summary = `built ${request.out}: ${info.triangles.toLocaleString("en-US")} triangles, ${info.nodes.length} nodes, ${size} m (x y z), lint ${report.overall}/100${report.archetype ? ` (checked as ${report.archetype})` : ""}${hint}`;
  if (request.contractOut) {
    mkdirSync(dirname(request.contractOut), { recursive: true });
    writeFileSync(request.contractOut, `${JSON.stringify(contractFromModel(info), null, 2)}\n`);
  }
  return { file: request.out, summary, report };
}
