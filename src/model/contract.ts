import { existsSync, readFileSync } from "node:fs";
import type { ResolvedArchetype } from "../archetype/types.js";
import { ModelError } from "./gltf.js";
import type { ModelInfo } from "./inspect.js";
import { MODEL_RULES, type ModelFinding } from "./rules.js";

export interface Measure {
  value: number;
  /** Allowed difference in metres (default 1% of the value, at least 1 mm). */
  tolerance?: number;
  /** Where the number comes from, so a later change can be judged. */
  source?: string;
}

/** What a model must keep: node names, overall size, budget. Stored as model.contract.json. */
export interface ModelContract {
  version: 1;
  /** Free text: where the contract came from. Not checked. */
  description?: string;
  /** Node names (or paths) that must exist. */
  nodes?: string[];
  /** When true, the nodes must also appear in this order. */
  ordered?: boolean;
  /** When true, no other nodes are allowed. */
  exact?: boolean;
  /** Bounding box size in metres, per axis. */
  size?: { x?: Measure; y?: Measure; z?: Measure };
  /** Lowest point (y) in metres. */
  lowestY?: Measure;
  maxTriangles?: number;
}

export function loadContract(file: string): ModelContract {
  if (!existsSync(file)) throw new ModelError(`${file}: contract file not found`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ModelError(`${file}: invalid JSON (${(error as Error).message})`);
  }
  const c = raw as Partial<ModelContract>;
  if (typeof raw !== "object" || raw === null || c.version !== 1) throw new ModelError(`${file}: not a model contract (expected "version": 1)`);
  if (c.nodes !== undefined && !(Array.isArray(c.nodes) && c.nodes.every((n) => typeof n === "string"))) throw new ModelError(`${file}: "nodes" must be a list of names`);
  for (const [key, m] of [...Object.entries(c.size ?? {}), ["lowestY", c.lowestY] as const]) {
    if (m !== undefined && typeof (m as Measure).value !== "number") throw new ModelError(`${file}: "${key}" needs a numeric "value"`);
  }
  return c as ModelContract;
}

/** Builds a contract from a model as it is now: a starting point to review and tighten. */
export function contractFromModel(info: ModelInfo): ModelContract {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const contract: ModelContract = { version: 1, nodes: info.nodes.map((n) => n.path), ordered: true };
  if (info.bounds) {
    const [x, y, z] = info.bounds.size;
    contract.size = { x: { value: round(x) }, y: { value: round(y) }, z: { value: round(z) } };
    contract.lowestY = { value: round(info.bounds.min[1]), tolerance: 0.02 };
  }
  contract.maxTriangles = Math.ceil((info.triangles * 1.05) / 1000) * 1000;
  return contract;
}

/**
 * Builds a starting contract from what a thing usually is, for a model that does not exist yet.
 * Only parts that occur once are listed by name (a wheel has many names); the size is the middle of the
 * typical range, give or take the width of that range, and the description says where that range comes from.
 */
export function contractFromArchetype(arch: ResolvedArchetype): ModelContract {
  const contract: ModelContract = { version: 1, description: `Starting contract for ${arch.name} (${arch.id}) from the archetype library. Review it, give the nodes the names you use, and tighten the sizes.` };
  const single = arch.parts.filter((p) => p.required && (p.count === undefined || p.count === 1)).map((p) => p.name);
  if (single.length) contract.nodes = single;
  if (arch.scale) {
    contract.description += ` Sizes: ${arch.scale.source} (class ${arch.scale.confidence}).`;
    const measure = (range: [number, number] | undefined): Measure | undefined => {
      if (!range) return undefined;
      const mid = (range[0] + range[1]) / 2;
      return { value: Math.round(mid * 1000) / 1000, tolerance: Math.round((range[1] - range[0]) * 1000) / 1000 };
    };
    const x = measure(arch.scale.width), y = measure(arch.scale.height), z = measure(arch.scale.length);
    if (x || y || z) contract.size = { ...(x ? { x } : {}), ...(y ? { y } : {}), ...(z ? { z } : {}) };
  }
  if (!arch.chain.includes("vessel")) contract.lowestY = { value: 0, tolerance: 0.05 };
  contract.maxTriangles = 20000;
  return contract;
}

function tolerance(m: Measure): number {
  return m.tolerance ?? Math.max(0.001, Math.abs(m.value) * 0.01);
}

export function checkContract(info: ModelInfo, contract: ModelContract): ModelFinding[] {
  const out: ModelFinding[] = [];
  const add = (rule: string, message: string, node?: string) => {
    const def = MODEL_RULES[rule];
    if (def) out.push({ rule, category: def.category, severity: def.severity, file: info.file, ...(node ? { node } : {}), message });
  };
  const has = (wanted: string) => info.nodes.find((n) => n.path === wanted || n.name === wanted);

  const wanted = contract.nodes ?? [];
  for (const name of wanted) if (!has(name)) add("model/contract-missing-node", `The contract needs a node "${name}", but the model has none.`, name);
  if (contract.ordered) {
    const found = wanted.map((w) => info.nodes.findIndex((n) => n.path === w || n.name === w)).filter((i) => i >= 0);
    if (found.some((index, i) => i > 0 && index < (found[i - 1] as number))) add("model/contract-order", "The listed nodes appear in a different order than in the contract.");
  }
  if (contract.exact) {
    for (const n of info.nodes) if (!wanted.some((w) => w === n.path || w === n.name)) add("model/contract-extra-node", `Node "${n.path}" is not in the contract.`, n.path);
  }
  if (info.bounds) {
    const axes = ["x", "y", "z"] as const;
    axes.forEach((axis, i) => {
      const m = contract.size?.[axis];
      if (!m) return;
      const got = info.bounds?.size[i] ?? 0;
      if (Math.abs(got - m.value) > tolerance(m)) {
        add("model/contract-size", `Size ${axis} is ${got.toFixed(3)} m, the contract says ${m.value} m ± ${tolerance(m).toFixed(3)}${m.source ? ` (${m.source})` : ""}.`);
      }
    });
    if (contract.lowestY && Math.abs(info.bounds.min[1] - contract.lowestY.value) > tolerance(contract.lowestY)) {
      add("model/contract-ground", `The lowest point is y = ${info.bounds.min[1].toFixed(3)}, the contract says ${contract.lowestY.value}.`);
    }
  }
  if (contract.maxTriangles !== undefined && info.triangles > contract.maxTriangles) {
    add("model/contract-triangles", `${info.triangles.toLocaleString("en-US")} triangles; the contract allows ${contract.maxTriangles.toLocaleString("en-US")}.`);
  }
  return out;
}
