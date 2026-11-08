/**
 * Small helpers shared by the nature families: numbers written into expressions, the true extent of a lumpy
 * ellipsoid (so a rock can be sunk until its lowest point is exactly on y = 0), and a few local materials.
 */
import { lumpyEllipsoid } from "../../../build/shapes.js";
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
export function lumpExtent(segments: number, lumps: number, seed: number): LumpExtent {
  const key = `${segments}/${lumps}/${seed}`;
  const hit = extents.get(key);
  if (hit) return hit;
  const mesh = lumpyEllipsoid(1, 1, 1, segments, lumps, seed, "m");
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

/** Picks one item of a list with a random number in [0, 1). */
export const pick = <T>(r: number, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(r * list.length))] as T;

/** Materials the shared palette does not have. */
export const LOCAL: Record<string, MaterialDef> = {
  snow: { color: [0.86, 0.88, 0.92], metallic: 0, roughness: 0.75 },
  apple_red: { color: [0.55, 0.04, 0.03], metallic: 0, roughness: 0.4 },
  apple_green: { color: [0.35, 0.55, 0.08], metallic: 0, roughness: 0.4 },
  cherry_fruit: { color: [0.3, 0.005, 0.02], metallic: 0, roughness: 0.3 },
  pear_yellow: { color: [0.62, 0.5, 0.1], metallic: 0, roughness: 0.5 },
  coconut: { color: [0.22, 0.15, 0.06], metallic: 0, roughness: 0.6 },
  date_fruit: { color: [0.55, 0.25, 0.04], metallic: 0, roughness: 0.5 },
  palm_bark: { color: [0.3, 0.25, 0.19], metallic: 0, roughness: 0.95, texture: "bark" },
  palm_bark_grey: { color: [0.42, 0.4, 0.36], metallic: 0, roughness: 0.9, texture: "bark" },
  palm_rachis: { color: [0.25, 0.27, 0.09], metallic: 0, roughness: 0.6 },
  palm_frond_dry: { color: [0.35, 0.3, 0.1], metallic: 0, roughness: 0.75, doubleSided: true },
  palm_frond_blue: { color: [0.12, 0.22, 0.17], metallic: 0, roughness: 0.6, doubleSided: true },
  palm_frond_light: { color: [0.16, 0.34, 0.06], metallic: 0, roughness: 0.55, doubleSided: true },
  dead_frond: { color: [0.32, 0.24, 0.13], metallic: 0, roughness: 0.95, doubleSided: true },
  crownshaft: { color: [0.18, 0.3, 0.12], metallic: 0, roughness: 0.5 },
  larch_gold: { color: [0.62, 0.42, 0.06], metallic: 0, roughness: 0.8, texture: "leaf", doubleSided: true },
  needles_light: { color: [0.1, 0.25, 0.06], metallic: 0, roughness: 0.8, texture: "leaf", doubleSided: true },
  cypress_green: { color: [0.03, 0.09, 0.035], metallic: 0, roughness: 0.85, texture: "leaf", doubleSided: true },
  leaf_box: { color: [0.05, 0.16, 0.03], metallic: 0, roughness: 0.7, texture: "leaf", doubleSided: true },
  leaf_purple: { color: [0.18, 0.04, 0.08], metallic: 0, roughness: 0.7, texture: "leaf", doubleSided: true },
  leaf_silver: { color: [0.13, 0.17, 0.12], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_variegated: { color: [0.32, 0.45, 0.12], metallic: 0, roughness: 0.7, texture: "leaf", doubleSided: true },
  flower_white: { color: [0.86, 0.86, 0.82], metallic: 0, roughness: 0.65 },
  flower_pink: { color: [0.8, 0.25, 0.45], metallic: 0, roughness: 0.65 },
  flower_purple: { color: [0.35, 0.1, 0.55], metallic: 0, roughness: 0.65 },
  flower_yellow: { color: [0.85, 0.62, 0.05], metallic: 0, roughness: 0.65 },
  flower_red: { color: [0.6, 0.03, 0.04], metallic: 0, roughness: 0.6 },
  flower_blue: { color: [0.15, 0.25, 0.75], metallic: 0, roughness: 0.65 },
  berry_red: { color: [0.55, 0.02, 0.03], metallic: 0, roughness: 0.3 },
  stem_green: { color: [0.08, 0.22, 0.04], metallic: 0, roughness: 0.7 },
  stem_dark: { color: [0.05, 0.12, 0.03], metallic: 0, roughness: 0.75 },
  sepal_green: { color: [0.07, 0.2, 0.04], metallic: 0, roughness: 0.7, doubleSided: true },
  leaf_flower: { color: [0.07, 0.24, 0.05], metallic: 0, roughness: 0.65, doubleSided: true },
  seed_disc: { color: [0.12, 0.06, 0.02], metallic: 0, roughness: 0.95 },
  pollen: { color: [0.85, 0.6, 0.05], metallic: 0, roughness: 0.8 },
  stamen_dark: { color: [0.25, 0.08, 0.03], metallic: 0, roughness: 0.6 },
  blade_green: { color: [0.09, 0.24, 0.04], metallic: 0, roughness: 0.85, texture: "grass", doubleSided: true },
  blade_light: { color: [0.2, 0.36, 0.07], metallic: 0, roughness: 0.85, texture: "grass", doubleSided: true },
  blade_dry: { color: [0.52, 0.42, 0.2], metallic: 0, roughness: 0.9, texture: "grass", doubleSided: true },
  blade_blue: { color: [0.18, 0.28, 0.3], metallic: 0, roughness: 0.85, texture: "grass", doubleSided: true },
  blade_red: { color: [0.35, 0.06, 0.05], metallic: 0, roughness: 0.85, texture: "grass", doubleSided: true },
  fern_green: { color: [0.06, 0.2, 0.03], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  reed_brown: { color: [0.25, 0.14, 0.06], metallic: 0, roughness: 0.8 },
  plume_cream: { color: [0.75, 0.68, 0.52], metallic: 0, roughness: 0.95 },
  lichen: { color: [0.45, 0.48, 0.32], metallic: 0, roughness: 1, texture: "stone" },
  sandstone_red: { color: [0.5, 0.25, 0.12], metallic: 0, roughness: 0.92, texture: "stone" },
  chalk: { color: [0.78, 0.76, 0.7], metallic: 0, roughness: 0.9, texture: "stone" },
  quartz: { color: [0.75, 0.72, 0.7], metallic: 0, roughness: 0.4, texture: "stone" },
  rotten_wood: { color: [0.18, 0.12, 0.07], metallic: 0, roughness: 1, texture: "wood" },
  sapwood: { color: [0.7, 0.55, 0.33], metallic: 0, roughness: 0.85, texture: "wood" },
  fungus_shelf: { color: [0.5, 0.33, 0.14], metallic: 0, roughness: 0.7 },
  gill_cream: { color: [0.75, 0.68, 0.52], metallic: 0, roughness: 0.85 },
  gill_dark: { color: [0.2, 0.14, 0.1], metallic: 0, roughness: 0.9 },
  spot_white: { color: [0.88, 0.86, 0.8], metallic: 0, roughness: 0.7 },
  mushroom_yellow: { color: [0.78, 0.5, 0.05], metallic: 0, roughness: 0.5 },
  mushroom_blue: { color: [0.08, 0.2, 0.6], metallic: 0, roughness: 0.4, emissive: [0.02, 0.1, 0.3] },
  mushroom_purple: { color: [0.35, 0.08, 0.45], metallic: 0, roughness: 0.4, emissive: [0.12, 0.02, 0.18] },
  mushroom_glow: { color: [0.4, 0.8, 0.45], metallic: 0, roughness: 0.3, emissive: [0.15, 0.6, 0.25] },
  stem_white: { color: [0.82, 0.8, 0.72], metallic: 0, roughness: 0.75 },
  stem_tan: { color: [0.6, 0.48, 0.32], metallic: 0, roughness: 0.8 },
  chanterelle: { color: [0.85, 0.5, 0.06], metallic: 0, roughness: 0.6 },
  ink_cap: { color: [0.55, 0.52, 0.48], metallic: 0, roughness: 0.7 },
  ink_black: { color: [0.04, 0.04, 0.045], metallic: 0, roughness: 0.4 },
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
