import type { BuildScene } from "../glb.js";
import { BuildError, resolveParams, type ParamDef, type Params } from "../params.js";
import { house } from "./house.js";

export interface Generator {
  kind: string;
  description: string;
  params: ParamDef[];
  build(params: Params): BuildScene;
}

export const GENERATORS: Record<string, Generator> = { house };

export function generatorFor(kind: string): Generator {
  const g = GENERATORS[kind];
  if (!g) throw new BuildError(`unknown model kind "${kind}" (known: ${Object.keys(GENERATORS).join(", ")})`);
  return g;
}

/** Resolves and checks the parameters, then builds the scene. */
export function buildKind(kind: string, input: Record<string, unknown> = {}): BuildScene {
  const g = generatorFor(kind);
  return g.build(resolveParams(g.params, input, kind));
}
