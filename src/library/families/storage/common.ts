/** Small helpers and extra finishes shared by the storage families. */
import type { MaterialDef } from "../../palette.js";
import { mats, PALETTE } from "../../palette.js";
import { box, group, type SpecNode } from "../../kit.js";

/** A dark recess: holes, slots, apertures, the inside of an opening. */
export const HOLE: MaterialDef = { color: [0.015, 0.014, 0.013], metallic: 0, roughness: 0.95 };

const paintFin = (r: number, g: number, b: number, roughness = 0.5, metallic = 0.15): MaterialDef => ({ color: [r, g, b], metallic, roughness, texture: "painted" });
const plasticFin = (r: number, g: number, b: number, roughness = 0.55): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "plastic" });
/** Sawn timber: storage woods are single boards, slats, battens, staves and handles, so solid grain without plank joints. */
const woodFin = (r: number, g: number, b: number, roughness = 0.75): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "grain" });
/** Container paint: satin marine paint on steel; the weathering comes from darker oxidised valleys and rust run-offs. */
const weatheredFin = (r: number, g: number, b: number, roughness = 0.6): MaterialDef => ({ color: [r, g, b], metallic: 0.2, roughness, texture: "painted" });

/**
 * Finishes for a warehouse or a dock, by name. Names the palette also has (paint_red, pine, ...) are recalibrated here
 * for storage: muted industrial RAL-like paints instead of toy primaries, real plastics, darker real woods, kraft
 * cardboard. Asset ids keep their finish names; only the look changes.
 */
export const EXTRA: Record<string, MaterialDef> = {
  hole: HOLE,
  // Painted steel and wood (RAL-like, semi-gloss with an orange-peel ripple).
  paint_red: paintFin(0.28, 0.035, 0.028),
  paint_blue: paintFin(0.03, 0.065, 0.17),
  paint_navy: paintFin(0.018, 0.032, 0.075),
  paint_green: paintFin(0.035, 0.1, 0.048),
  paint_forest: paintFin(0.028, 0.065, 0.034, 0.6),
  paint_yellow: paintFin(0.45, 0.3, 0.028),
  paint_orange: paintFin(0.42, 0.13, 0.024),
  paint_white: paintFin(0.45, 0.45, 0.425, 0.5, 0.05),
  paint_cream: paintFin(0.46, 0.41, 0.31, 0.55, 0),
  paint_black: paintFin(0.03, 0.03, 0.032, 0.5),
  paint_grey: paintFin(0.16, 0.17, 0.17, 0.55),
  paint_anthracite: paintFin(0.05, 0.055, 0.06, 0.55),
  paint_olive: paintFin(0.08, 0.088, 0.04, 0.7, 0.1),
  paint_sand: paintFin(0.34, 0.27, 0.16, 0.7, 0.1),
  paint_sky: paintFin(0.11, 0.21, 0.3, 0.5, 0.1),
  // Moulded plastics: muted, satin, spark-eroded.
  plastic_red: plasticFin(0.27, 0.035, 0.03),
  plastic_blue: plasticFin(0.03, 0.065, 0.17),
  plastic_green: plasticFin(0.035, 0.1, 0.042),
  plastic_yellow: plasticFin(0.45, 0.3, 0.028),
  plastic_orange: plasticFin(0.42, 0.13, 0.024),
  plastic_grey: plasticFin(0.14, 0.15, 0.15, 0.6),
  plastic_white: plasticFin(0.47, 0.47, 0.44, 0.5),
  plastic_black: plasticFin(0.03, 0.03, 0.032, 0.6),
  hdpe_blue: plasticFin(0.02, 0.05, 0.155, 0.6),
  hdpe_white: plasticFin(0.38, 0.375, 0.335, 0.62),
  hdpe_black: plasticFin(0.035, 0.035, 0.037, 0.62),
  hdpe_grey: plasticFin(0.14, 0.145, 0.145, 0.62),
  // Woods as they really are (the palette's are a little pale for rough warehouse timber).
  pine: woodFin(0.3, 0.19, 0.09), // fresh pine: the deck of a pallet in the sun reads pale, so keep it honest
  birch: woodFin(0.34, 0.26, 0.15, 0.7),
  light_oak: woodFin(0.32, 0.2, 0.09, 0.7),
  oak: woodFin(0.26, 0.15, 0.065, 0.7),
  rough_timber: woodFin(0.26, 0.17, 0.085, 0.9),
  weathered_wood: woodFin(0.22, 0.19, 0.155, 0.92),
  whitewash_wood: woodFin(0.3, 0.285, 0.25, 0.85),
  // Corten and ISO container paints: weathered steel, mottled with oxide.
  corten: { color: [0.22, 0.075, 0.03], metallic: 0.15, roughness: 0.85, texture: "rust" },
  container_red: weatheredFin(0.17, 0.042, 0.03),
  container_blue: weatheredFin(0.028, 0.055, 0.125),
  container_green: weatheredFin(0.032, 0.075, 0.042),
  container_grey: weatheredFin(0.17, 0.18, 0.18),
  container_orange: weatheredFin(0.33, 0.105, 0.03),
  container_white: weatheredFin(0.44, 0.44, 0.41, 0.55),
  container_teal: weatheredFin(0.022, 0.08, 0.085),
  container_yellow: weatheredFin(0.38, 0.26, 0.03),
  rope: { color: [0.24, 0.175, 0.095], metallic: 0, roughness: 0.95, texture: "fabric" },
  canvas_beige: { color: [0.21, 0.18, 0.125], metallic: 0, roughness: 0.95, texture: "fabric" }, // jute: sack tops face the sun
  sand: { color: [0.5, 0.4, 0.25], metallic: 0, roughness: 1, texture: "sand" },
  /** Kraft corrugated board, a little mottled. */
  cardboard: { color: [0.3, 0.19, 0.095], metallic: 0, roughness: 0.92, texture: "painted" },
  /** Brown packing tape, a touch glossier and lighter than the board. */
  tape: { color: [0.36, 0.22, 0.09], metallic: 0, roughness: 0.4 },
  /** A white printed shipping label. */
  label_white: { color: [0.62, 0.62, 0.6], metallic: 0, roughness: 0.6 },
  shrink_wrap: { color: [0.8, 0.82, 0.85, 0.12], metallic: 0, roughness: 0.3, alpha: "BLEND" },
  cable_black: plasticFin(0.03, 0.03, 0.032, 0.5),
  cable_orange: plasticFin(0.42, 0.12, 0.022, 0.45),
  cable_yellow: plasticFin(0.45, 0.31, 0.03, 0.45),
  cable_blue: plasticFin(0.03, 0.065, 0.18, 0.45),
  cable_green: plasticFin(0.035, 0.11, 0.045, 0.45),
  copper_wire: { color: [0.85, 0.48, 0.32], metallic: 1, roughness: 0.35, texture: "brushed" },
  tank_white: paintFin(0.34, 0.34, 0.32, 0.5, 0.1), // a tank roof faces the sun: keep the white off-white
  tank_silver: { color: [0.4, 0.41, 0.42], metallic: 0.6, roughness: 0.55, texture: "brushed" }, // aluminium paint, weathered
  /** Site concrete, weathered grey. */
  concrete: { color: [0.18, 0.177, 0.168], metallic: 0, roughness: 0.92, texture: "concrete" }, // plinth tops face the sun
  concrete_dark: { color: [0.12, 0.12, 0.116], metallic: 0, roughness: 0.92, texture: "concrete" },
  gas_green: paintFin(0.03, 0.15, 0.06, 0.45),
  gas_maroon: paintFin(0.2, 0.03, 0.035, 0.45),
  /** Hot-dip galvanised steel: a dull spangled grey. */
  galvanised: { color: [0.3, 0.31, 0.315], metallic: 0.55, roughness: 0.62, texture: "plastic" },
  /** Mill-finish aluminium sheet outdoors: duller than the palette's polished aluminium (a silo roof mirrors the sky). */
  aluminium: { color: [0.55, 0.56, 0.57], metallic: 0.8, roughness: 0.5, texture: "brushed" },
  /** Oil, dust and grime: a dark smudge at the foot of things. */
  grime: { color: [0.05, 0.045, 0.04], metallic: 0, roughness: 0.9, texture: "rust" },
  /** A translucent film of road dust and grime over the lower part of a wall. */
  grime_film: { color: [0.07, 0.055, 0.04, 0.35], metallic: 0, roughness: 0.95, alpha: "BLEND" },
  /** Fresh orange-brown rust, for streaks and patches. */
  rust_streak: { color: [0.2, 0.075, 0.03], metallic: 0, roughness: 0.92, texture: "rust" },
};

/** A finish by name: the storage table, the palette, or a derived one ("<name>_worn", "<name>_dark"). */
function resolve(n: string): MaterialDef {
  const direct = EXTRA[n] ?? PALETTE[n];
  // Palette woods are planked ("wood"); storage timber is single boards and staves: solid grain.
  if (direct) return direct.texture === "wood" ? { ...direct, texture: "grain" } : direct;
  const m = /^(.+)_(worn|dark|grime)$/.exec(n);
  const base = m ? (EXTRA[m[1] as string] ?? PALETTE[m[1] as string]) : undefined;
  if (!m || !base) return mats(n)[n] as MaterialDef;
  const [r, g, b] = base.color;
  const k = m[2] === "worn" ? 0.95 : m[2] === "dark" ? 0.7 : 0.5;
  return {
    color: [r * k, g * k, b * k],
    metallic: Math.min(base.metallic, m[2] === "worn" ? 0.2 : base.metallic),
    roughness: Math.min(0.95, base.roughness + (m[2] === "dark" ? 0.05 : 0.15)),
    texture: "rust",
  };
}

/** The weathered version of a finish: the same colour mottled with oxide and wear (resolved by useMats). */
export const worn = (name: string): string => `${name}_worn`;
/** A darker shade of a finish, for recesses and valleys (resolved by useMats). */
export const dark = (name: string): string => `${name}_dark`;
/** A grimy, half-dark version of a finish, for the base of a thing (resolved by useMats). */
export const grimy = (name: string): string => `${name}_grime`;

/** Storage finishes, palette finishes and derived ones, ready for an asset's "materials". */
export function useMats(...names: (string | undefined)[]): Record<string, MaterialDef> {
  const out: Record<string, MaterialDef> = {};
  for (const n of names) {
    if (!n || out[n]) continue;
    out[n] = resolve(n);
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
  // Facets tangent to the surface: robust in any renderer, unlike a concave extruded arc.
  const steps = Math.max(4, Math.round(deg / 5));
  const da = (deg / steps) * Math.PI / 180;
  const facets: SpecNode[] = [];
  for (let k = 0; k < steps; k++) {
    const a = ((-deg / 2 + (deg * (k + 0.5)) / steps) * Math.PI) / 180;
    const s = Math.sin(a).toFixed(5), c = Math.cos(a).toFixed(5);
    facets.push(box(`Facet_${k + 1}`, [`2 * (${r} + 0.002) * ${Math.tan(da / 2).toFixed(5)} + 0.001`, `(${y1}) - (${y0})`, t + 0.002], {
      at: [`(${r} + 0.002 - ${(t / 2 + 0.001).toFixed(4)}) * ${s}`, `((${y0}) + (${y1})) / 2`, `(${r} + 0.002 - ${(t / 2 + 0.001).toFixed(4)}) * ${c}`],
      rotate: [0, +(a * 180 / Math.PI).toFixed(3), 0],
    }));
  }
  return group(name, facets, { material });
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

/** A blocky stencil font on a 3 x 5 grid: each glyph is a list of strokes [x0, y0, x1, y1]. */
export const GLYPHS: Record<string, [number, number, number, number][]> = {
  A: [[0, 0, 1, 4], [2, 0, 3, 4], [0, 4, 3, 5], [1, 2, 2, 3]],
  B: [[0, 0, 1, 5], [1, 4, 2.4, 5], [1, 2, 2.4, 3], [1, 0, 2.4, 1], [2.2, 3, 3, 4.4], [2.2, 0.6, 3, 2]],
  C: [[0, 0, 1, 5], [1, 4, 3, 5], [1, 0, 3, 1]],
  D: [[0, 0, 1, 5], [1, 4, 2, 5], [1, 0, 2, 1], [2, 1, 3, 4]],
  E: [[0, 0, 1, 5], [1, 4, 3, 5], [1, 2, 2.5, 3], [1, 0, 3, 1]],
  F: [[0, 0, 1, 5], [1, 4, 3, 5], [1, 2, 2.5, 3]],
  G: [[0, 0, 1, 5], [1, 4, 3, 5], [1, 0, 3, 1], [2, 1, 3, 2.5], [1.6, 2, 2, 2.5]],
  H: [[0, 0, 1, 5], [2, 0, 3, 5], [1, 2, 2, 3]],
  I: [[1, 0, 2, 5]],
  K: [[0, 0, 1, 5], [1, 2, 2, 3], [2, 3, 3, 5], [2, 0, 3, 2]],
  L: [[0, 0, 1, 5], [1, 0, 3, 1]],
  M: [[0, 0, 0.9, 5], [2.1, 0, 3, 5], [0.9, 4, 2.1, 5], [1.25, 2.5, 1.75, 4]],
  N: [[0, 0, 1, 5], [2, 0, 3, 5], [1, 3, 1.6, 4.4], [1.4, 2, 2, 3.4]],
  O: [[0, 0, 1, 5], [2, 0, 3, 5], [1, 4, 2, 5], [1, 0, 2, 1]],
  P: [[0, 0, 1, 5], [1, 4, 3, 5], [2, 2.5, 3, 4], [1, 2, 3, 3]],
  R: [[0, 0, 1, 5], [1, 4, 3, 5], [2, 2.5, 3, 4], [1, 2, 2.4, 3], [2, 0, 3, 2]],
  S: [[0, 2, 1, 5], [1, 4, 3, 5], [1, 2, 3, 3], [2, 0, 3, 2], [0, 0, 2, 1]],
  T: [[0, 4, 3, 5], [1, 0, 2, 4]],
  U: [[0, 0, 1, 5], [2, 0, 3, 5], [1, 0, 2, 1]],
  X: [[0, 3, 1, 5], [2, 3, 3, 5], [0.8, 2, 2.2, 3], [0, 0, 1, 2], [2, 0, 3, 2]],
  Y: [[0, 3, 1, 5], [2, 3, 3, 5], [0.8, 2, 2.2, 3], [1, 0, 2, 2]],
  "0": [[0, 0, 1, 5], [2, 0, 3, 5], [1, 4, 2, 5], [1, 0, 2, 1]],
  "1": [[1, 0, 2, 5], [0.3, 3.8, 1, 4.6]],
  "2": [[0, 4, 3, 5], [2, 2, 3, 4], [0, 2, 2, 3], [0, 0, 1, 2], [1, 0, 3, 1]],
  "3": [[0, 4, 2, 5], [0.6, 2, 2, 3], [0, 0, 2, 1], [2, 0, 3, 5]],
  "4": [[0, 2, 1, 5], [1, 2, 2, 3], [2, 0, 3, 5]],
  "5": [[0, 4, 3, 5], [0, 2, 1, 4], [1, 2, 3, 3], [2, 0, 3, 2], [0, 0, 2, 1]],
  "7": [[0, 4, 3, 5], [2, 0, 3, 4]],
  "8": [[0, 0, 1, 5], [2, 0, 3, 5], [1, 4, 2, 5], [1, 2, 2, 3], [1, 0, 2, 1]],
  "-": [[0.3, 2, 2.7, 3]],
};

/**
 * A stencilled word, its strokes standing `t` metres proud of a face. `face`: "+z"/"-z"/"+x"/"-x" walls read from
 * outside, "top" read from +z. `at` is the centre of the text on the face; `u` the stroke width (a letter is 3u by 5u).
 */
export function stencil(name: string, word: string, face: "+z" | "-z" | "+x" | "-x" | "top", at: [string | number, string | number, string | number], u: number, material: string, t = 0.004): SpecNode {
  const adv = 4 * u;
  const half = (word.length * adv - u) / 2;
  const strokes: SpecNode[] = [];
  [...word.toUpperCase()].forEach((ch, li) => {
    (GLYPHS[ch] ?? []).forEach(([x0, y0, x1, y1], k) => {
      const a = +(li * adv + ((x0 + x1) / 2) * u - half).toFixed(4); // along the reading direction
      const b = +(((y0 + y1) / 2 - 2.5) * u).toFixed(4); // up the letter
      const w = +((x1 - x0) * u).toFixed(4), h = +((y1 - y0) * u).toFixed(4);
      const [size, pos]: [[number, number, number], [number, number, number]] =
        face === "+z" ? [[w, h, t], [a, b, 0]]
          : face === "-z" ? [[w, h, t], [-a, b, 0]]
            : face === "+x" ? [[t, h, w], [0, b, -a]]
              : face === "-x" ? [[t, h, w], [0, b, a]]
                : [[w, t, h], [a, 0, -b]];
      strokes.push(box(`S${li + 1}_${k + 1}`, size, { at: pos }));
    });
  });
  return group(name, strokes, { at, material });
}

type Raw = Record<string, unknown>;

/**
 * A box board laid along `axis` with its timber grain running along it. The "grain" texture runs up the side faces of
 * an upright box, so the board is built standing and turned down onto the axis: all its long faces show long grain.
 * Takes a node made by box(); a board with its own rotation or children becomes a group of the same name holding the
 * turned "Solid" and the children, so names, pivots, part counts and child positions stay as they were.
 */
export function laid(axis: "x" | "z", n: SpecNode): SpecNode {
  const r = n as Raw;
  if (r["shape"] !== "box") throw new Error(`laid: ${String(r["name"])} is not a box`);
  const [a, b, c] = r["size"] as [string | number, string | number, string | number];
  const bottom = r["anchor"] === "bottom";
  const [ox = 0, oy = 0, oz = 0] = (r["offset"] as (string | number)[] | undefined) ?? [];
  const sum = (...t: (string | number)[]): string | number => {
    const parts = t.filter((v) => v !== 0 && v !== "0");
    return parts.length === 0 ? 0 : parts.length === 1 ? (parts[0] as string | number) : parts.map((v) => `(${v})`).join(" + ");
  };
  // The offset in the turned box's own frame: Rz(90) takes x to y and y to -x; Rx(90) takes y to z and z to -y.
  const solid: Raw = axis === "x"
    ? { shape: "box", size: [b, a, c], rotate: [0, 0, 90], offset: [sum(oy, bottom ? `(${b}) / 2` : 0), `-(${ox})`, oz] }
    : { shape: "box", size: [a, c, b], rotate: [90, 0, 0], offset: [ox, oz, `-(${sum(oy, bottom ? `(${b}) / 2` : 0)})`] };
  if (r["bevel"] !== undefined) solid["bevel"] = r["bevel"];
  const off = solid["offset"] as (string | number)[];
  if (off.every((v) => v === 0 || v === "-(0)")) delete solid["offset"];
  if (r["rotate"] === undefined && r["children"] === undefined) {
    const { size: _s, anchor: _a, offset: _o, bevel: _b, ...rest } = r;
    return { ...rest, ...solid } as SpecNode;
  }
  const { shape: _sh, size: _s, anchor: _a, offset: _o, bevel: _b, children, ...rest } = r;
  return { ...rest, children: [{ name: "Solid", ...solid }, ...((children as SpecNode[] | undefined) ?? [])] } as SpecNode;
}
