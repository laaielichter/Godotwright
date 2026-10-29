import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadLibrary } from "../archetype/library.js";
import { contractFromModel } from "../model/contract.js";
import { inspectModel } from "../model/inspect.js";
import { lintModelFile, type ModelReport } from "../model/lint.js";
import { buildGlb } from "./glb.js";
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
  const scene = request.kind ? buildKind(request.kind, { ...(request.spec as object | undefined), ...params }) : buildSpec(request.spec, params);
  mkdirSync(dirname(request.out), { recursive: true });
  writeFileSync(request.out, buildGlb(scene));
  const info = inspectModel(request.out);
  const library = loadLibrary();
  if (scene.archetype && !library.get(scene.archetype)) throw new BuildError(`unknown archetype "${scene.archetype}" (see \`model archetypes\`)`);
  const report = lintModelFile(request.out, scene.archetype ? { archetype: library.resolve(scene.archetype) } : {});
  const size = info.bounds?.size.map((v) => v.toFixed(2)).join(" x ") ?? "?";
  const summary = `built ${request.out}: ${info.triangles.toLocaleString("en-US")} triangles, ${info.nodes.length} nodes, ${size} m (x y z), lint ${report.overall}/100${report.archetype ? ` (checked as ${report.archetype})` : ""}`;
  if (request.contractOut) {
    mkdirSync(dirname(request.contractOut), { recursive: true });
    writeFileSync(request.contractOut, `${JSON.stringify(contractFromModel(info), null, 2)}\n`);
  }
  return { file: request.out, summary, report };
}
