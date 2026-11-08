/**
 * The authoring kit for library families: small builders for spec nodes and parameters, so a family reads like the
 * model it makes. Everything here returns plain JSON for the model spec (see src/build/spec.ts); numbers may be
 * expressions such as "$width / 2".
 */
import type { ParamDef } from "../build/params.js";
import type { MaterialDef } from "./palette.js";

export type Num = number | string;
export type Vec = [Num, Num, Num];
export type SpecNode = Record<string, unknown>;

export const CATEGORIES = ["furniture", "street", "storage", "nature", "buildings", "vehicles", "props"] as const;
export type Category = (typeof CATEGORIES)[number];

/** One asset as a family writes it; the library adds the id, version and archetype. */
export interface AssetDraft {
  /** Unique within its category, lowercase words joined by "-" (e.g. "dining-chair-oak-ladderback"). */
  slug: string;
  /** A short human name: "Oak ladder-back dining chair". */
  title: string;
  /** One or two sentences: what it looks like and which way it faces. */
  description: string;
  /** Extra search words (English and Dutch); the family's own tags are added. */
  tags?: string[];
  params: ParamDef[];
  materials: Record<string, MaterialDef>;
  nodes: SpecNode[];
}

export interface Family {
  /** e.g. "dining-chair" */
  id: string;
  category: Category;
  /** The archetype every asset of this family is checked against. */
  archetype: string;
  /** Search words for the whole family, English and Dutch. */
  tags: string[];
  assets(): AssetDraft[];
}

/** Common keys of every node. */
export interface NodeOpts {
  at?: Vec;
  material?: string;
  rotate?: Vec;
  offset?: Vec;
  mirror?: string;
  repeat?: { count: Num; step?: Vec; around?: "x" | "y" | "z"; phase?: Num };
  vars?: Record<string, Num>;
  children?: SpecNode[];
}

/** Drops undefined values, so the JSON stays small. */
function clean(o: Record<string, unknown>): SpecNode {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** Rounds plain numbers to 4 decimals (positions in 0.1 mm), so the JSON stays readable. */
export const r4 = (v: Num): Num => (typeof v === "number" ? Math.round(v * 10000) / 10000 : v);
const vec = (v?: Vec): Vec | undefined => (v ? (v.map(r4) as Vec) : undefined);

function node(name: string, extra: Record<string, unknown>, o: NodeOpts = {}): SpecNode {
  return clean({
    name,
    ...extra,
    material: o.material,
    at: vec(o.at),
    offset: vec(o.offset),
    rotate: vec(o.rotate),
    mirror: o.mirror,
    repeat: o.repeat,
    vars: o.vars,
    children: o.children,
  });
}

/** An empty node that holds others (a pivot or a group). */
export const group = (name: string, children: SpecNode[], o: NodeOpts = {}): SpecNode => node(name, {}, { ...o, children });

export const box = (name: string, size: Vec, o: NodeOpts & { bevel?: Num; anchor?: "center" | "bottom" } = {}): SpecNode =>
  node(name, { shape: "box", size: vec(size), anchor: o.anchor, bevel: o.bevel === undefined ? undefined : r4(o.bevel) }, o);

export const cyl = (name: string, radius: Num, height: Num, o: NodeOpts & { axis?: "x" | "y" | "z"; segments?: Num; anchor?: "center" | "base"; bevel?: Num } = {}): SpecNode =>
  node(name, { shape: "cylinder", radius: r4(radius), height: r4(height), axis: o.axis, segments: o.segments, anchor: o.anchor, bevel: o.bevel === undefined ? undefined : r4(o.bevel) }, o);

export const ellipsoid = (name: string, radii: Vec, o: NodeOpts & { segments?: Num; lumps?: Num; seed?: Num } = {}): SpecNode =>
  node(name, { shape: "ellipsoid", radii: vec(radii), segments: o.segments, lumps: o.lumps, seed: o.seed }, o);

/** A surface of revolution about y from [radius, y] points, bottom to top. */
export const lathe = (name: string, profile: [Num, Num][], o: NodeOpts & { segments?: Num; caps?: boolean } = {}): SpecNode =>
  node(name, { shape: "lathe", profile: profile.map(([a, b]) => [r4(a), r4(b)]), segments: o.segments, caps: o.caps }, o);

export const tube = (name: string, path: Vec[], radius: Num | Num[], o: NodeOpts & { segments?: Num; caps?: boolean } = {}): SpecNode =>
  node(name, { shape: "tube", path: path.map((p) => vec(p)), ...(Array.isArray(radius) ? { radii: radius.map(r4) } : { radius: r4(radius) }), segments: o.segments, caps: o.caps }, o);

export const loft = (name: string, sections: Record<string, unknown>[], o: NodeOpts & { caps?: boolean } = {}): SpecNode => node(name, { shape: "loft", sections, caps: o.caps }, o);

/** A prism from a floor plan of [x, z] points (counter-clockwise seen from above), from y0 to y1. */
export const extrude = (name: string, plan: [Num, Num][], y0: Num, y1: Num, o: NodeOpts = {}): SpecNode =>
  node(name, { shape: "extrude", plan: plan.map(([a, b]) => [r4(a), r4(b)]), y0: r4(y0), y1: r4(y1) }, o);

export const roof = (name: string, r: { x0: Num; x1: Num; z0: Num; z1: Num; y: Num; rise: Num; kind?: "gable" | "hip" }, o: NodeOpts = {}): SpecNode =>
  node(name, { shape: "roof", x0: r4(r.x0), x1: r4(r.x1), z0: r4(r.z0), z1: r4(r.z1), y: r4(r.y), rise: r4(r.rise), kind: r.kind }, o);

/** A number parameter. */
export const num = (name: string, def: number, min: number, max: number, description: string): ParamDef => ({ name, type: "number", default: r4(def) as number, min, max, description });
export const int = (name: string, def: number, min: number, max: number, description: string): ParamDef => ({ name, type: "integer", default: def, min, max, description });

/** Every combination of the option lists, in a fixed order (the first list changes slowest). */
export function combos<T extends Record<string, readonly unknown[]>>(axes: T): { [K in keyof T]: T[K][number] }[] {
  let out: Record<string, unknown>[] = [{}];
  for (const [key, options] of Object.entries(axes)) out = out.flatMap((o) => options.map((v) => ({ ...o, [key]: v })));
  return out as { [K in keyof T]: T[K][number] }[];
}

/** Small deterministic random numbers (mulberry32): the same seed gives the same asset. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "Oak ladder-back" -> "oak-ladder-back". */
export const slugify = (...words: string[]): string =>
  words.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** "light_oak" -> "Light oak". */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
