import { ModelError } from "../model/gltf.js";

export class BuildError extends ModelError {}

export interface ParamDef {
  name: string;
  type: "number" | "integer" | "boolean" | "enum";
  default: number | boolean | string;
  min?: number;
  max?: number;
  options?: string[];
  description: string;
}

export type Params = Record<string, number | boolean | string>;

/** Merges input over the defaults and checks names, types and ranges. Strings from the command line are converted. */
export function resolveParams(defs: ParamDef[], input: Record<string, unknown>, kind: string): Params {
  const out: Params = Object.fromEntries(defs.map((d) => [d.name, d.default]));
  for (const [key, raw] of Object.entries(input)) {
    const def = defs.find((d) => d.name === key);
    if (!def) throw new BuildError(`${kind}: unknown parameter "${key}" (known: ${defs.map((d) => d.name).join(", ")})`);
    out[key] = convert(def, raw, kind);
  }
  return out;
}

function convert(def: ParamDef, raw: unknown, kind: string): number | boolean | string {
  const fail = (why: string): never => {
    throw new BuildError(`${kind}: parameter "${def.name}" ${why}`);
  };
  if (def.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "false") return raw === "true";
    return fail("must be true or false");
  }
  if (def.type === "enum") {
    if (typeof raw === "string" && def.options?.includes(raw)) return raw;
    return fail(`must be one of ${def.options?.join(", ")}`);
  }
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return fail("must be a number");
  if (def.type === "integer" && !Number.isInteger(value)) return fail("must be a whole number");
  if (def.min !== undefined && value < def.min) return fail(`must be at least ${def.min}`);
  if (def.max !== undefined && value > def.max) return fail(`must be at most ${def.max}`);
  return value;
}

/** Small deterministic random numbers (mulberry32): the same seed always gives the same model. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
