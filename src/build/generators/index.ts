import type { BuildScene } from "../glb.js";
import { BuildError, resolveParams, type ParamDef, type Params } from "../params.js";
import { buildSpec } from "../spec.js";
import { loadRecipes } from "../recipes.js";
import { house } from "./house.js";

export interface Generator {
  kind: string;
  description: string;
  /** The archetype this kind makes, so a build is checked against it. */
  archetype?: string;
  params: ParamDef[];
  build(params: Params): BuildScene;
}

export const GENERATORS: Record<string, Generator> = { house };

/** Every kind `model build` accepts: the built-in generators and the recipes in data/recipes. */
export function allKinds(): { kind: string; description: string; params: ParamDef[]; archetype?: string }[] {
  return [
    ...Object.values(GENERATORS).map((g) => ({ kind: g.kind, description: g.description, params: g.params, ...(g.archetype ? { archetype: g.archetype } : {}) })),
    ...[...loadRecipes().values()].map((r) => ({ kind: r.kind, description: r.description, params: r.params, ...(r.archetype ? { archetype: r.archetype } : {}) })),
  ];
}

export function generatorFor(kind: string): Generator {
  const g = GENERATORS[kind];
  if (!g) throw new BuildError(`unknown model kind "${kind}" (known: ${allKinds().map((k) => k.kind).join(", ")})`);
  return g;
}

/** Resolves and checks the parameters, then builds the scene. */
export function buildKind(kind: string, input: Record<string, unknown> = {}): BuildScene {
  const recipe = loadRecipes().get(kind);
  if (recipe && !GENERATORS[kind]) return buildSpec(recipe.spec, input);
  const g = generatorFor(kind);
  const scene = g.build(resolveParams(g.params, input, kind));
  return g.archetype ? { ...scene, archetype: g.archetype } : scene;
}
