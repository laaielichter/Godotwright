/** Small helpers and extra finishes shared by the storage families. */
import type { MaterialDef } from "../../palette.js";
import { mats } from "../../palette.js";
import type { SpecNode } from "../../kit.js";

/** A dark recess: holes, slots, apertures, the inside of an opening. */
export const HOLE: MaterialDef = { color: [0.015, 0.014, 0.013], metallic: 0, roughness: 0.95 };

/** Extra finishes the palette lacks, by name. */
export const EXTRA: Record<string, MaterialDef> = {
  hole: HOLE,
  hdpe_blue: { color: [0.02, 0.12, 0.42], metallic: 0, roughness: 0.55 },
  hdpe_white: { color: [0.72, 0.72, 0.68], metallic: 0, roughness: 0.6 },
  hdpe_black: { color: [0.03, 0.03, 0.032], metallic: 0, roughness: 0.6 },
  hdpe_grey: { color: [0.32, 0.33, 0.33], metallic: 0, roughness: 0.6 },
  corten: { color: [0.26, 0.07, 0.03], metallic: 0.35, roughness: 0.75, texture: "concrete" },
  container_red: { color: [0.29, 0.048, 0.027], metallic: 0.3, roughness: 0.55 },
  container_blue: { color: [0.02, 0.08, 0.25], metallic: 0.3, roughness: 0.5 },
  container_green: { color: [0.03, 0.16, 0.06], metallic: 0.3, roughness: 0.55 },
  container_grey: { color: [0.3, 0.31, 0.31], metallic: 0.3, roughness: 0.55 },
  container_orange: { color: [0.62, 0.18, 0.03], metallic: 0.3, roughness: 0.5 },
  container_white: { color: [0.72, 0.72, 0.7], metallic: 0.2, roughness: 0.5 },
  container_teal: { color: [0.02, 0.2, 0.22], metallic: 0.3, roughness: 0.5 },
  container_yellow: { color: [0.7, 0.45, 0.02], metallic: 0.3, roughness: 0.5 },
  rope: { color: [0.5, 0.4, 0.24], metallic: 0, roughness: 0.95 },
  cardboard: { color: [0.46, 0.3, 0.15], metallic: 0, roughness: 0.95 },
  shrink_wrap: { color: [0.75, 0.8, 0.85, 0.45], metallic: 0, roughness: 0.2, alpha: "BLEND" },
  cable_black: { color: [0.02, 0.02, 0.022], metallic: 0, roughness: 0.55 },
  cable_orange: { color: [0.75, 0.2, 0.02], metallic: 0, roughness: 0.5 },
  cable_yellow: { color: [0.75, 0.55, 0.03], metallic: 0, roughness: 0.5 },
  cable_blue: { color: [0.03, 0.12, 0.45], metallic: 0, roughness: 0.5 },
  cable_green: { color: [0.05, 0.3, 0.08], metallic: 0, roughness: 0.5 },
  copper_wire: { color: [0.85, 0.48, 0.32], metallic: 1, roughness: 0.3 },
  tank_white: { color: [0.75, 0.75, 0.72], metallic: 0.2, roughness: 0.45 },
  tank_silver: { color: [0.62, 0.63, 0.64], metallic: 0.8, roughness: 0.35 },
  gas_green: { color: [0.03, 0.22, 0.08], metallic: 0.2, roughness: 0.4 },
  gas_maroon: { color: [0.25, 0.03, 0.04], metallic: 0.2, roughness: 0.4 },
};

/** Palette finishes and the extra ones above, ready for an asset's "materials". */
export function useMats(...names: (string | undefined)[]): Record<string, MaterialDef> {
  const out: Record<string, MaterialDef> = {};
  for (const n of names) {
    if (!n || out[n]) continue;
    out[n] = EXTRA[n] ?? (mats(n)[n] as MaterialDef);
  }
  return out;
}

/** Calls `make` for the front (+z, "F", sign 1) and the back (-z, "B", sign -1). */
export function frontBack(make: (s: 1 | -1, tag: "F" | "B") => SpecNode[]): SpecNode[] {
  return [...make(1, "F"), ...make(-1, "B")];
}

/** "a" or "an" before a word. */
export const an = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/** A readable finish name: "paint_red" -> "red", "light_oak" -> "light oak". */
export const finishName = (name: string): string =>
  name.replace(/^(paint|plastic|hdpe|container|cable|gas|tank|led)_/, "").replaceAll("_", " ");

/** Dutch words for common finishes, for the tags. */
export const DUTCH: Record<string, string> = {
  oak: "eiken", light_oak: "eiken", pine: "grenen", birch: "berken", walnut: "notenhout", teak: "teak", mahogany: "mahonie",
  weathered_wood: "verweerd hout", whitewash_wood: "witgewassen", rough_timber: "ruw hout", dark_stain: "donker gebeitst",
  steel: "staal", galvanised: "verzinkt", aluminium: "aluminium", brass: "messing", copper: "koper", rust: "roest",
  red: "rood", blue: "blauw", green: "groen", yellow: "geel", orange: "oranje", white: "wit", black: "zwart", grey: "grijs",
  olive: "olijfgroen", sand: "zandkleur", navy: "marineblauw", teal: "blauwgroen", forest: "donkergroen", cream: "crème",
  burgundy: "bordeaux", maroon: "kastanjebruin", silver: "zilver", purple: "paars", anthracite: "antraciet",
};

/** Search words for a finish: its plain name and the Dutch word. */
export function finishTags(name: string): string[] {
  const plain = finishName(name);
  const last = plain.split(" ").pop() ?? plain;
  return [plain, ...(DUTCH[name] ? [DUTCH[name] as string] : []), ...(DUTCH[last] && last !== name ? [DUTCH[last] as string] : [])];
}

/**
 * A label or band wrapped round a cylinder of radius `r` (an expression) about y, centred on +z: a curved strip
 * `deg` degrees wide from y0 to y1, `t` metres thick, standing proud of the surface by 2 mm.
 */
export function wrapLabel(name: string, r: string, deg: number, y0: string | number, y1: string | number, material: string, t = 0.004): SpecNode {
  const steps = 8;
  const outer: [string, string][] = [];
  const inner: [string, string][] = [];
  for (let k = 0; k <= steps; k++) {
    const a = ((-deg / 2 + (deg * k) / steps) * Math.PI) / 180;
    const s = Math.sin(a).toFixed(5), c = Math.cos(a).toFixed(5);
    outer.push([`(${r} + 0.002) * ${s}`, `(${r} + 0.002) * ${c}`]);
    inner.push([`(${r} - ${t}) * ${s}`, `(${r} - ${t}) * ${c}`]);
  }
  return { name, shape: "extrude", material, plan: [...outer, ...inner.reverse()], y0, y1 };
}

/**
 * An open ring (a washer, a rail, a band) about y: a closed rectangular section from radius r0 to r1 and height y0
 * to y1, swept round without end caps, so the middle stays open.
 */
export function ring(name: string, r0: string | number, r1: string | number, y0: string | number, y1: string | number, o: { segments?: number; material?: string; at?: [string | number, string | number, string | number]; repeat?: Record<string, unknown> } = {}): SpecNode {
  return {
    name, shape: "lathe", caps: false, segments: o.segments ?? 32,
    profile: [[r0, y0], [r1, y0], [r1, y1], [r0, y1], [r0, y0]],
    ...(o.material ? { material: o.material } : {}), ...(o.at ? { at: o.at } : {}), ...(o.repeat ? { repeat: o.repeat } : {}),
  };
}
