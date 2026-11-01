import { closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { loadLibrary } from "../archetype/library.js";
import { contractFromModel } from "../model/contract.js";
import { inspectModel } from "../model/inspect.js";
import { lintModelFile, type ModelReport } from "../model/lint.js";
import { buildGlb, type BuildNode, type BuildScene } from "./glb.js";
import { buildKind } from "./generators/index.js";
import { heightmapSceneText, heightmapShapeText } from "./heightmap.js";
import { findProjectRoot } from "../project/files.js";
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
   * "heightmap" (terrain tiles only) writes a HeightMapShape3D next to the .glb (`<name>.heightmap.tres`) and, inside a
   * Godot project, a scene with the tile and its StaticBody3D (`<name>.tscn`): faster than a trimesh, and the same ground.
   */
  collision?: "convex" | "trimesh" | "heightmap";
}

type ImportHint = "convex" | "trimesh";

export const COLLISION_SUFFIX: Record<ImportHint, string> = { convex: "-convcol", trimesh: "-col" };

/** Appends the import hint to every node that has a mesh (a copy; the scene given is not changed). */
export function withCollisionHints(scene: BuildScene, collision: ImportHint): BuildScene {
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
  /** Other files written: the heightmap shape and scene of a terrain tile. */
  extra: string[];
  /** One line: size, triangles, nodes, score and what it was checked as. */
  summary: string;
  report: ModelReport;
}

/** Builds a model, writes it, and lints it (against its archetype when the kind or spec names one). */
export function buildModel(request: BuildRequest): BuildOutcome {
  if (!request.kind && request.spec === undefined) throw new BuildError("give a kind (see `model kinds`) or a full spec (see `model spec`)");
  const params = request.params ?? {};
  const built = request.kind ? buildKind(request.kind, { ...(request.spec as object | undefined), ...params }) : buildSpec(request.spec, params);
  if (request.collision === "heightmap" && !built.heightmap) {
    throw new BuildError("heightmap collision is for terrain tiles (kind terrain); use trimesh for other static models");
  }
  const scene = request.collision && request.collision !== "heightmap" ? withCollisionHints(built, request.collision) : built;
  mkdirSync(dirname(request.out), { recursive: true });
  writeFileSync(request.out, buildGlb(scene));
  const extra: string[] = [];
  const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
  /** Opens a file next to the model, never through a link: O_NOFOLLOW makes the open itself refuse one (not on Windows). */
  const open = (file: string, flags: number): number => {
    try {
      return openSync(file, flags | NOFOLLOW, 0o644);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new BuildError(`${file} is a link; not writing through it`);
      throw error;
    }
  };
  const write = (fd: number, text: string): void => {
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
  };
  /** Writes (or replaces) a file next to the model. */
  const writeBeside = (file: string, text: string): void => {
    write(open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC), text);
    extra.push(file);
  };
  /** Writes a new file next to the model; an existing one is left as it is. Says whether it now holds `text`. */
  const writeNew = (file: string, text: string): "written" | "same" | "kept" => {
    try {
      write(open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL), text);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const fd = open(file, constants.O_RDONLY);
      let current: string;
      try {
        current = readFileSync(fd, "utf8");
      } finally {
        closeSync(fd);
      }
      return current === text ? "same" : "kept";
    }
    return "written";
  };
  let collisionNote = "";
  if (request.collision === "heightmap" && scene.heightmap) {
    const map = scene.heightmap;
    const stem = request.out.replace(/\.glb$/i, "");
    const shapeFile = `${stem}.heightmap.tres`;
    writeBeside(shapeFile, heightmapShapeText(map));
    const root = findProjectRoot(dirname(request.out));
    const res = (file: string): string => `res://${relative(root!, file).split(sep).join("/")}`;
    if (root) {
      const sceneFile = `${stem}.tscn`;
      const text = heightmapSceneText(res(request.out), res(shapeFile), map.step);
      if (writeNew(sceneFile, text) !== "kept") {
        extra.push(sceneFile);
        collisionNote = `; ${sceneFile}: the tile with a StaticBody3D and its HeightMapShape3D (${map.size} x ${map.size} points, ${map.step} m apart), ready to place`;
      } else {
        collisionNote = `; ${sceneFile} exists and was kept: give its CollisionShape3D the shape ${res(shapeFile)} and a uniform scale of ${map.step}`;
      }
    } else {
      collisionNote = `; not inside a Godot project, so no scene: add a StaticBody3D with a CollisionShape3D, shape ${shapeFile}, uniform scale ${map.step}`;
    }
    collisionNote = `, heightmap collision in ${shapeFile}${collisionNote}`;
  }
  const info = inspectModel(request.out);
  const library = loadLibrary();
  if (scene.archetype && !library.get(scene.archetype)) throw new BuildError(`unknown archetype "${scene.archetype}" (see \`model archetypes\`)`);
  const report = lintModelFile(request.out, scene.archetype ? { archetype: library.resolve(scene.archetype) } : {});
  const size = info.bounds?.size.map((v) => v.toFixed(2)).join(" x ") ?? "?";
  const hint =
    request.collision === "heightmap"
      ? collisionNote
      : request.collision
        ? `, collision on import (${COLLISION_SUFFIX[request.collision]} names: Godot makes a ${request.collision === "convex" ? "convex hull" : "trimesh"} StaticBody3D per mesh)`
        : "";
  const summary = `built ${request.out}: ${info.triangles.toLocaleString("en-US")} triangles, ${info.nodes.length} nodes, ${size} m (x y z), lint ${report.overall}/100${report.archetype ? ` (checked as ${report.archetype})` : ""}${hint}`;
  if (request.contractOut) {
    mkdirSync(dirname(request.contractOut), { recursive: true });
    writeFileSync(request.contractOut, `${JSON.stringify(contractFromModel(info), null, 2)}\n`);
  }
  return { file: request.out, extra, summary, report };
}
