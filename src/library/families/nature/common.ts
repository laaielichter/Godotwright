/**
 * Small helpers shared by the nature families: numbers written into expressions, the true extent of a lumpy
 * ellipsoid (so a rock can be sunk until its lowest point is exactly on y = 0), and a few local materials.
 */
import { fracturedEllipsoid, lumpyEllipsoid, noise3 } from "../../../build/shapes.js";
import type { MaterialDef } from "../../palette.js";

/** A number for an expression: at most 4 decimals, never "-0". */
export const n4 = (v: number): string => {
  const r = Math.round(v * 10000) / 10000;
  return String(r === 0 ? 0 : r);
};

/** "a * $x" as an expression, dropping a factor of 1. */
export const times = (factor: number, variable: string): string => (Math.abs(factor - 1) < 1e-9 ? variable : `${variable} * ${n4(factor)}`);

export interface LumpExtent {
  /** The lowest point of a unit lumpy ellipsoid (radii 1), as a positive depth below its centre. */
  low: number;
  /** The highest point above its centre. */
  high: number;
  /** The furthest point from the y axis. */
  side: number;
}

const extents = new Map<string, LumpExtent>();

/**
 * How far a lumpy ellipsoid really reaches. The lumps scale each direction by a factor that does not depend on the
 * radii, so for radii [rx, ry, rz] the lowest point is exactly ry * low below the centre.
 */
export function lumpExtent(segments: number, lumps: number, seed: number, cuts = 0): LumpExtent {
  const key = `${segments}/${lumps}/${seed}/${cuts}`;
  const hit = extents.get(key);
  if (hit) return hit;
  // The fracture planes are cut in unit space before the radii are applied, so the same rule holds for a cut stone.
  const mesh = cuts > 0 ? fracturedEllipsoid(1, 1, 1, segments, lumps, seed, cuts, "m") : lumpyEllipsoid(1, 1, 1, segments, lumps, seed, "m");
  let low = 0, high = 0, side = 0;
  for (const p of mesh.prims.values()) {
    for (let v = 0; v < p.positions.length; v += 3) {
      const x = p.positions[v] as number, y = p.positions[v + 1] as number, z = p.positions[v + 2] as number;
      low = Math.max(low, -y);
      high = Math.max(high, y);
      side = Math.max(side, Math.hypot(x, z));
    }
  }
  const out = { low, high, side };
  extents.set(key, out);
  return out;
}

/**
 * The fracture planes of a cut ellipsoid (unit space, before the radii): the outward normal and the distance of the
 * plane from the centre, in the order they are cut. The same rule as the builder's, so a family can turn a stone until
 * one fracture faces where it wants it (the clean face of a split boulder).
 */
export function cutPlanes(seed: number, cuts: number): { n: [number, number, number]; offset: number }[] {
  const rand = (n: number): number => (noise3(n * 1.37 + 0.5, seed * 0.173 + 2.5, n * 0.71 + 7.25, seed + 101) + 1) / 2;
  const out: { n: [number, number, number]; offset: number }[] = [];
  for (let c = 0; c < cuts; c++) {
    const z = 1 - 2 * ((c + 0.5 + 0.6 * (rand(c) - 0.5)) / cuts);
    const theta = c * 2.399963 + rand(c + 50) * 1.2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out.push({ n: [r * Math.cos(theta), z, r * Math.sin(theta)], offset: 1 - (0.08 + 0.22 * rand(c + 100)) });
  }
  return out;
}

/**
 * Writes variables straight into a node and its children ("$g" becomes "(expression)"), for values that depend on $i
 * of the node's own repeat: the builder evaluates a node's `vars` before its copies get their $i.
 */
export function inlineVars<T>(node: T, vars: Record<string, string>): T {
  const names = Object.keys(vars).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\$(${names.join("|")})(?![A-Za-z0-9_])`, "g");
  const sub = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(pattern, (_, k: string) => `(${vars[k]})`);
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
    return v;
  };
  return sub(node) as T;
}

/** Inlines the `vars` of every repeated node (whose vars may use its own $i) into that node, all through a tree. */
export function inlineRepeatVars(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  return nodes.map((node) => {
    let n = node;
    const vars = n["vars"] as Record<string, string | number> | undefined;
    if (n["repeat"] && vars) {
      const { vars: _drop, ...rest } = n;
      n = inlineVars(rest, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)])));
    }
    const children = n["children"] as Record<string, unknown>[] | undefined;
    return children ? { ...n, children: inlineRepeatVars(children) } : n;
  });
}

/** Picks one item of a list with a random number in [0, 1). */
export const pick = <T>(r: number, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(r * list.length))] as T;

const leaf = (r: number, g: number, b: number, roughness = 0.8): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "leaf", doubleSided: true });
const blade = (r: number, g: number, b: number): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness: 0.85, texture: "grass", doubleSided: true });
const plain = (r: number, g: number, b: number, roughness = 0.75, extra: Partial<MaterialDef> = {}): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, ...extra });
const barkOf = (r: number, g: number, b: number, roughness = 0.95): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "bark" });

/**
 * Materials of the nature families, in real-world albedos (linear RGB). Real foliage is dark (a leaf reflects about
 * 5-15 % of green light), bark is a dark brown or grey, and stones sit between 0.05 (basalt) and 0.4 (chalk). Several
 * entries carry the name of a shared palette entry: these override the palette's brighter studio colours for nature.
 */
export const LOCAL: Record<string, MaterialDef> = {
  // Leaves, from the shaded inside of a crown to its sunlit tips.
  leaf_shade: leaf(0.022, 0.046, 0.016, 0.85),
  leaf_dark: leaf(0.03, 0.066, 0.02),
  leaf_green: leaf(0.04, 0.085, 0.022),
  leaf_light: leaf(0.07, 0.125, 0.03),
  leaf_tip: leaf(0.095, 0.145, 0.035, 0.75),
  leaf_autumn: leaf(0.3, 0.095, 0.018),
  leaf_autumn_dark: leaf(0.13, 0.045, 0.014, 0.85),
  leaf_red_dark: leaf(0.09, 0.02, 0.014, 0.85),
  leaf_red: leaf(0.2, 0.03, 0.018),
  leaf_yellow: leaf(0.34, 0.225, 0.025),
  leaf_blossom: leaf(0.62, 0.38, 0.44, 0.75),
  leaf_box: leaf(0.034, 0.078, 0.02),
  leaf_purple: leaf(0.095, 0.024, 0.038),
  leaf_silver: leaf(0.06, 0.085, 0.055),
  leaf_variegated: leaf(0.16, 0.2, 0.055),
  needles: leaf(0.022, 0.052, 0.027, 0.85),
  needles_blue: leaf(0.034, 0.06, 0.06, 0.85),
  needles_light: leaf(0.05, 0.108, 0.03, 0.85),
  needles_tip: leaf(0.075, 0.14, 0.04, 0.85),
  needles_blue_tip: leaf(0.055, 0.088, 0.08, 0.85),
  needles_shade: leaf(0.016, 0.034, 0.02, 0.9),
  cypress_green: leaf(0.02, 0.046, 0.022, 0.85),
  larch_gold: leaf(0.3, 0.19, 0.03),
  frond: plain(0.05, 0.115, 0.03, 0.65, { doubleSided: true, texture: "grass" }),
  palm_frond_light: plain(0.075, 0.13, 0.032, 0.65, { doubleSided: true, texture: "grass" }),
  palm_frond_blue: plain(0.055, 0.095, 0.078, 0.6, { doubleSided: true, texture: "grass" }),
  palm_frond_dry: plain(0.2, 0.155, 0.065, 0.8, { doubleSided: true, texture: "grass" }),
  dead_frond: plain(0.13, 0.088, 0.048, 0.95, { doubleSided: true, texture: "grass" }),
  palm_rachis: plain(0.13, 0.14, 0.055, 0.65),
  crownshaft: plain(0.09, 0.15, 0.065, 0.55),
  // Grass, reeds and ferns.
  blade_green: blade(0.05, 0.11, 0.025),
  blade_light: blade(0.1, 0.165, 0.04),
  blade_dry: blade(0.34, 0.26, 0.115),
  blade_blue: blade(0.095, 0.14, 0.14),
  blade_red: blade(0.2, 0.035, 0.03),
  fern_green: leaf(0.04, 0.1, 0.022, 0.75),
  grass_green: { color: [0.06, 0.12, 0.03], metallic: 0, roughness: 0.95, texture: "grass" },
  grass_dry: { color: [0.32, 0.25, 0.11], metallic: 0, roughness: 0.95, texture: "grass" },
  reed_brown: plain(0.17, 0.095, 0.045, 0.85),
  plume_cream: plain(0.48, 0.43, 0.33, 0.95),
  moss: { color: [0.026, 0.046, 0.012], metallic: 0, roughness: 1, texture: "ground" },
  moss_light: { color: [0.045, 0.07, 0.018], metallic: 0, roughness: 1, texture: "ground" },
  // Bark and wood.
  bark_brown: barkOf(0.065, 0.047, 0.033),
  bark_grey: barkOf(0.072, 0.068, 0.061, 0.9),
  // Birch: chalky, warm white bark, smooth between the dark lenticel marks (which the families add as their own parts).
  bark_birch: { color: [0.19, 0.182, 0.16], metallic: 0, roughness: 0.8, texture: "plaster" },
  birch_mark: barkOf(0.032, 0.029, 0.026, 0.95),
  bark_red: barkOf(0.075, 0.043, 0.027, 0.92),
  bark_dark: barkOf(0.055, 0.042, 0.032),
  palm_bark: barkOf(0.1, 0.08, 0.058),
  palm_bark_grey: barkOf(0.12, 0.113, 0.1, 0.9),
  // Solid timber: continuous grain without plank joints, for cut faces and sawn ends.
  heartwood: { color: [0.2, 0.115, 0.055], metallic: 0, roughness: 0.85, texture: "grain" },
  sapwood: { color: [0.26, 0.18, 0.095], metallic: 0, roughness: 0.85, texture: "grain" },
  rotten_wood: { color: [0.1, 0.065, 0.04], metallic: 0, roughness: 1, texture: "grain" },
  weathered_wood: { color: [0.11, 0.1, 0.085], metallic: 0, roughness: 0.92, texture: "grain" },
  fungus_shelf: plain(0.3, 0.19, 0.08, 0.75),
  soil: { color: [0.1, 0.066, 0.04], metallic: 0, roughness: 1, texture: "ground" },
  // Fruit and berries.
  apple_red: plain(0.4, 0.04, 0.025, 0.4),
  apple_green: plain(0.2, 0.32, 0.05, 0.4),
  cherry_fruit: plain(0.22, 0.01, 0.02, 0.3),
  pear_yellow: plain(0.45, 0.36, 0.08, 0.5),
  coconut: plain(0.16, 0.1, 0.045, 0.6),
  date_fruit: plain(0.36, 0.14, 0.025, 0.5),
  berry_red: plain(0.4, 0.02, 0.025, 0.3),
  snow: { color: [0.56, 0.58, 0.62], metallic: 0, roughness: 0.8, texture: "sand" },
  // Flowers: petals in real flower colours, never pure primaries.
  flower_white: plain(0.55, 0.55, 0.5, 0.65),
  flower_pink: plain(0.5, 0.14, 0.25, 0.65),
  flower_purple: plain(0.2, 0.05, 0.34, 0.65),
  flower_yellow: plain(0.55, 0.35, 0.016, 0.65),
  flower_red: plain(0.45, 0.02, 0.03, 0.6),
  flower_blue: plain(0.07, 0.13, 0.46, 0.65),
  petal_white: plain(0.56, 0.56, 0.5, 0.6, { doubleSided: true, texture: "plaster" }),
  petal_yellow: plain(0.56, 0.35, 0.015, 0.6, { doubleSided: true, texture: "plaster" }),
  petal_red: plain(0.45, 0.02, 0.03, 0.6, { doubleSided: true, texture: "plaster" }),
  petal_pink: plain(0.5, 0.15, 0.25, 0.6, { doubleSided: true, texture: "plaster" }),
  petal_purple: plain(0.22, 0.055, 0.36, 0.6, { doubleSided: true, texture: "plaster" }),
  petal_blue: plain(0.07, 0.13, 0.48, 0.6, { doubleSided: true, texture: "plaster" }),
  petal_orange: plain(0.5, 0.15, 0.012, 0.6, { doubleSided: true, texture: "plaster" }),
  stem_green: plain(0.05, 0.115, 0.028, 0.7),
  stem_dark: plain(0.03, 0.068, 0.02, 0.75),
  sepal_green: plain(0.045, 0.105, 0.025, 0.7, { doubleSided: true }),
  leaf_flower: plain(0.045, 0.108, 0.028, 0.65, { doubleSided: true }),
  seed_disc: plain(0.07, 0.04, 0.015, 0.95),
  pollen: plain(0.5, 0.32, 0.025, 0.8),
  stamen_dark: plain(0.15, 0.05, 0.02, 0.6),
  // Mushrooms.
  mushroom_red: plain(0.3, 0.025, 0.018, 0.45, { texture: "plaster" }),
  mushroom_brown: plain(0.22, 0.12, 0.05, 0.6, { texture: "plaster" }),
  mushroom_cream: plain(0.38, 0.33, 0.24, 0.75),
  gill_cream: plain(0.36, 0.31, 0.22, 0.85),
  gill_dark: plain(0.11, 0.075, 0.055, 0.9),
  spot_white: plain(0.48, 0.46, 0.41, 0.75),
  mushroom_yellow: plain(0.4, 0.26, 0.03, 0.55, { texture: "plaster" }),
  mushroom_blue: plain(0.04, 0.1, 0.3, 0.4, { emissive: [0.01, 0.04, 0.12] }),
  mushroom_purple: plain(0.22, 0.05, 0.3, 0.4, { emissive: [0.06, 0.01, 0.09] }),
  mushroom_glow: plain(0.25, 0.5, 0.28, 0.35, { emissive: [0.05, 0.22, 0.09] }),
  stem_white: plain(0.32, 0.3, 0.255, 0.8, { texture: "plaster" }),
  stem_tan: plain(0.27, 0.2, 0.12, 0.8, { texture: "plaster" }),
  chanterelle: plain(0.45, 0.25, 0.025, 0.6),
  ink_cap: plain(0.32, 0.3, 0.27, 0.75),
  ink_black: plain(0.03, 0.03, 0.032, 0.4),
  // Garden pots.
  terracotta: plain(0.2, 0.07, 0.035, 0.85, { texture: "plaster" }),
  ceramic_celadon: plain(0.2, 0.28, 0.22, 0.2),
  ceramic_black: plain(0.035, 0.035, 0.038, 0.2),
};

/** Materials by name from the shared palette or LOCAL. */
export function natureMats(palette: (...names: string[]) => Record<string, MaterialDef>, ...names: string[]): Record<string, MaterialDef> {
  const out: Record<string, MaterialDef> = {};
  for (const name of new Set(names)) {
    const local = LOCAL[name];
    if (local) out[name] = local;
    else Object.assign(out, palette(name));
  }
  return out;
}
