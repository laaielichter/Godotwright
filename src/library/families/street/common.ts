/**
 * Shared bits of the street families: street-calibrated finishes and the material picker.
 *
 * Street furniture is municipal kit that lives outdoors: RAL powder coats and road paints (never pure primaries),
 * dull weathered hot-dip galvanising, cast concrete with a texture, retroreflective sheeting on signs and cones, and
 * grime that collects at the foot. The table below re-tunes the palette names the street families use to those
 * real-world finishes (linear albedo, sRGB in comments) and adds a few finishes the palette lacks; GRIME() derives a
 * dusty and a heavily soiled version of an asset's foot finish for the grime bands.
 */
import { PALETTE, type MaterialDef } from "../../palette.js";
import { lathe, box, type NodeOpts, type Num, type SpecNode } from "../../kit.js";

/** A powder coat or enamel on metal: a little metallic sheen, an orange-peel texture, outdoor-dull. */
const coat = (r: number, g: number, b: number, roughness = 0.5, metallic = 0.2): MaterialDef => ({ color: [r, g, b], metallic, roughness, texture: "painted" });
/** Moulded street plastic (PE/PVC), UV-dulled. */
const pe = (r: number, g: number, b: number, roughness = 0.6): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "plastic" });
/** Retroreflective sheeting (micro-prismatic): bright, a touch of sheen, a fine moulded pattern. */
const sheeting = (r: number, g: number, b: number): MaterialDef => ({ color: [r, g, b], metallic: 0.25, roughness: 0.28, texture: "plastic" });
/** Outdoor timber: unsealed, a bit grey and rough. Street timber is single boards, posts and staves: solid grain, no plank joints. */
const timber = (r: number, g: number, b: number, roughness = 0.8): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "grain" });
const stone = (r: number, g: number, b: number, texture = "stone", roughness = 0.88): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture });

/** Finishes for the street: palette names re-tuned to municipal reality, plus local ones. */
export const LOCAL: Record<string, MaterialDef> = {
  // --- Paints on metal (RAL) ---
  paint_red: coat(0.36, 0.028, 0.024), // RAL 3000 flame red
  paint_yellow: coat(0.6, 0.38, 0.02), // RAL 1023 traffic yellow
  paint_green: coat(0.014, 0.07, 0.035), // RAL 6005 moss green
  paint_forest: coat(0.018, 0.042, 0.028), // RAL 6009 fir green
  paint_blue: coat(0.018, 0.07, 0.2), // RAL 5010 gentian blue
  paint_navy: coat(0.018, 0.028, 0.06), // RAL 5011 steel blue
  paint_black: coat(0.032, 0.032, 0.034, 0.55, 0.25), // RAL 9005 jet black, outdoor dull
  paint_anthracite: coat(0.048, 0.056, 0.062, 0.55, 0.25), // RAL 7016 anthracite grey
  paint_grey: coat(0.2, 0.21, 0.21, 0.55), // RAL 7037 dust grey
  paint_white: coat(0.6, 0.61, 0.58, 0.5, 0.05), // RAL 9016 traffic white
  paint_cream: coat(0.6, 0.55, 0.43, 0.55, 0), // RAL 9001 cream
  paint_burgundy: coat(0.11, 0.016, 0.022), // RAL 3005 wine red
  paint_olive: coat(0.11, 0.12, 0.065, 0.6), // RAL 6003 olive green
  cast_iron: coat(0.04, 0.04, 0.042, 0.6, 0.25), // painted cast iron, matte black
  black_steel: coat(0.036, 0.036, 0.04, 0.5, 0.3), // black powder coat
  amsterdam_brown: coat(0.075, 0.026, 0.016, 0.6, 0.22), // Amsterdammertje red-brown
  pillar_red: coat(0.36, 0.02, 0.018, 0.5, 0.15), // post office pillar red
  postal_blue: coat(0.016, 0.045, 0.15, 0.5, 0.15),
  postal_orange: coat(0.5, 0.15, 0.015, 0.5, 0.1), // PostNL orange
  postal_yellow: coat(0.56, 0.37, 0.016, 0.5, 0.1), // post horn yellow
  screen_cyan: { color: [0.015, 0.09, 0.12], metallic: 0, roughness: 0.2, emissive: [0.01, 0.1, 0.14] }, // a dimmed LCD
  // --- Bare and weathered metals ---
  galvanised: { color: [0.16, 0.168, 0.168], metallic: 0.35, roughness: 0.78, texture: "plastic" }, // dull hot-dip zinc (thin tubes catch the sky: keep it dark)
  steel: { color: [0.42, 0.43, 0.44], metallic: 0.85, roughness: 0.55, texture: "brushed" }, // bolts, clamps
  brushed_steel: { color: [0.55, 0.56, 0.57], metallic: 1, roughness: 0.38 }, // satin stainless (brush marks would run round a post)
  aluminium: { color: [0.62, 0.63, 0.64], metallic: 0.9, roughness: 0.45, texture: "brushed" }, // anodised, matte
  chrome: { color: [0.8, 0.8, 0.81], metallic: 1, roughness: 0.18 },
  brass: { color: [0.62, 0.46, 0.22], metallic: 1, roughness: 0.48, texture: "brushed" }, // tarnished outdoor brass
  bronze: { color: [0.2, 0.13, 0.07], metallic: 0.45, roughness: 0.62, texture: "rust" }, // statuary bronze, patinated
  gold: { color: [0.75, 0.56, 0.26], metallic: 1, roughness: 0.38 }, // gilded band
  corten: { color: [0.2, 0.07, 0.028], metallic: 0.1, roughness: 0.88, texture: "rust" }, // weathering steel
  rust: { color: [0.2, 0.075, 0.03], metallic: 0.1, roughness: 0.9, texture: "rust" },
  /** Old painted iron going over: black paint with rust breaking through. */
  iron_worn: { color: [0.06, 0.04, 0.032], metallic: 0.2, roughness: 0.7, texture: "rust" },
  sign_grey: { color: [0.52, 0.53, 0.54], metallic: 0.8, roughness: 0.55, texture: "brushed" }, // aluminium sign backing
  // --- Plastics ---
  plastic_orange: pe(0.58, 0.12, 0.014), // RAL 2009 traffic orange PVC
  plastic_red: pe(0.38, 0.03, 0.024),
  plastic_yellow: pe(0.58, 0.38, 0.02),
  plastic_green: pe(0.022, 0.085, 0.04), // municipal wheelie-bin green
  plastic_blue: pe(0.018, 0.06, 0.17),
  plastic_grey: pe(0.11, 0.115, 0.115),
  plastic_black: pe(0.035, 0.035, 0.037),
  plastic_white: pe(0.58, 0.58, 0.56, 0.5),
  fibreglass_white: pe(0.46, 0.46, 0.44, 0.45),
  water_barrier_red: pe(0.36, 0.03, 0.025, 0.65),
  water_barrier_white: pe(0.56, 0.56, 0.53, 0.65),
  rubber: { color: [0.03, 0.03, 0.032], metallic: 0, roughness: 0.9, texture: "plastic" },
  // --- Retroreflective sheeting (signs, cones, bands) ---
  reflector_white: sheeting(0.6, 0.61, 0.6),
  reflector_red: sheeting(0.38, 0.02, 0.02),
  reflector_amber: sheeting(0.6, 0.26, 0.014),
  sheet_white: sheeting(0.6, 0.61, 0.6),
  sheet_red: sheeting(0.34, 0.022, 0.022),
  sheet_blue: sheeting(0.014, 0.055, 0.19),
  sheet_yellow: sheeting(0.58, 0.37, 0.016),
  sheet_grey: sheeting(0.2, 0.21, 0.21),
  sheet_black: { color: [0.03, 0.03, 0.032], metallic: 0, roughness: 0.55, texture: "painted" }, // printed ink
  // --- Stone and concrete ---
  concrete: stone(0.16, 0.157, 0.148, "concrete", 0.92), // cast concrete (tops in the sun read light: keep it mid grey)
  concrete_dark: stone(0.1, 0.1, 0.095, "concrete", 0.92),
  granite: stone(0.15, 0.15, 0.143, "concrete", 0.75), // fine-grained cut stone
  limestone: stone(0.27, 0.255, 0.215, "concrete"),
  sandstone: stone(0.27, 0.18, 0.09, "concrete"),
  terracotta: { color: [0.32, 0.1, 0.05], metallic: 0, roughness: 0.88, texture: "concrete" },
  slate: { color: [0.05, 0.055, 0.065], metallic: 0, roughness: 0.75, texture: "roof_slate" },
  ceramic_blue: { color: [0.03, 0.08, 0.24], metallic: 0, roughness: 0.2 },
  ceramic_celadon: { color: [0.3, 0.4, 0.32], metallic: 0, roughness: 0.22 },
  ceramic_black: { color: [0.03, 0.03, 0.032], metallic: 0, roughness: 0.2 },
  // --- Outdoor timber ---
  oak: timber(0.3, 0.18, 0.08),
  light_oak: timber(0.34, 0.22, 0.11, 0.75),
  teak: timber(0.3, 0.17, 0.075),
  pine: timber(0.36, 0.235, 0.115),
  walnut: timber(0.12, 0.062, 0.032, 0.7),
  weathered_wood: timber(0.25, 0.22, 0.18, 0.92),
  rough_timber: timber(0.24, 0.155, 0.08, 0.92),
  bamboo: timber(0.36, 0.26, 0.12, 0.7),
  dark_stain: timber(0.1, 0.06, 0.035, 0.65),
  // --- Planting and logs ---
  bark_brown: { color: [0.12, 0.08, 0.05], metallic: 0, roughness: 0.95, texture: "bark" },
  bark_grey: { color: [0.2, 0.19, 0.17], metallic: 0, roughness: 0.95, texture: "bark" },
  bark_red: { color: [0.18, 0.075, 0.04], metallic: 0, roughness: 0.92, texture: "bark" },
  leaf_green: { color: [0.06, 0.14, 0.035], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_dark: { color: [0.035, 0.09, 0.025], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_light: { color: [0.11, 0.2, 0.045], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  grass_dry: { color: [0.3, 0.24, 0.1], metallic: 0, roughness: 0.95, texture: "grass" },
  moss: { color: [0.06, 0.1, 0.02], metallic: 0, roughness: 1, texture: "grass" },
  soil: { color: [0.09, 0.06, 0.035], metallic: 0, roughness: 1, texture: "ground" },
  petal_red: { color: [0.45, 0.02, 0.03], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_yellow: { color: [0.65, 0.45, 0.02], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_pink: { color: [0.6, 0.2, 0.3], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_purple: { color: [0.18, 0.05, 0.3], metallic: 0, roughness: 0.6, doubleSided: true },
  // --- Odds and ends ---
  /** A dark recess: the inside of a bin, a mail slot. */
  opening_dark: { color: [0.014, 0.014, 0.016], metallic: 0, roughness: 0.95 },
  glow_warm_glass: { color: [0.85, 0.78, 0.64, 0.85], metallic: 0, roughness: 0.3, emissive: [1, 0.82, 0.55], alpha: "BLEND" },
  glow_globe: { color: [0.8, 0.8, 0.78, 0.9], metallic: 0, roughness: 0.35, emissive: [0.9, 0.85, 0.75], alpha: "BLEND" },
};

/** The named finishes from the street table or the palette. */
export function useMats(...names: (string | undefined)[]): Record<string, MaterialDef> {
  const out: Record<string, MaterialDef> = {};
  for (const n of names) {
    if (!n) continue;
    const m = LOCAL[n] ?? PALETTE[n];
    if (!m) throw new Error(`street: no material "${n}"`);
    out[n] = m;
  }
  return out;
}

/** Road dirt: what splash and dust leave on the foot of street furniture. */
const DIRT: [number, number, number] = [0.075, 0.06, 0.042];

/** The finish `body` soiled by road dirt: `k` of its own colour, the rest dirt, duller and less metallic. */
function soiled(body: MaterialDef, k: number, heavy: boolean): MaterialDef {
  // Bare metal looks darker than its albedo (it mirrors the ground and the shade); its dirt film is matte, so start
  // from what the metal reads as, not from its albedo, or the band reads as a pale ring.
  const bare = body.metallic >= 0.5;
  const dim = bare ? 0.04 + 0.075 * Math.max(0, (k - 0.45) / 0.42) : (1 - 0.6 * body.metallic * body.metallic) * 0.78;
  const [r, g, b] = body.color.map((c) => c * dim) as [number, number, number];
  // Heavy dirt on metal and paint reads as rust bloom; on plastic, wood and stone as blotchy road film.
  const onMetal = body.texture === undefined || body.texture === "painted" || body.texture === "brushed" || body.texture === "rust" || body.metallic >= 0.5;
  // Dirt on bare polished metal is darker than the mirror around it, matte and patchy (oxide texture), never a pale ring.
  const dirt: [number, number, number] = bare ? [0.014, 0.012, 0.01] : DIRT;
  const tex = bare ? "rust" : heavy ? (onMetal ? "rust" : "concrete") : body.texture;
  return {
    color: [r * k + dirt[0] * (1 - k), g * k + dirt[1] * (1 - k), b * k + dirt[2] * (1 - k)],
    metallic: Math.min(bare ? 0.15 : 0.3, body.metallic * (heavy ? 0.3 : 0.6)), // a dirt film is matte
    roughness: Math.max(body.roughness, heavy ? 0.9 : bare ? 0.85 : 0.75),
    ...(tex ? { texture: tex } : {}),
  };
}

/**
 * The grime finishes for an asset whose foot is in `body`: "grime_light" (a faint film that fades the band into the
 * clean finish above), "grime" (a dulled, dusty band) and "grime_heavy" (the splash zone right at the ground, blotchy
 * with dirt). The shells are opaque, a few mm proud of the body and nested, so the dirt steps up in three soft stages
 * instead of ending in one hard line: a see-through film would cast a shadow onto the body just under it and break up
 * into shadow acne.
 */
export function GRIME(body: string): Record<string, MaterialDef> {
  const m = LOCAL[body] ?? PALETTE[body];
  if (!m) throw new Error(`street: no material "${body}"`);
  return { grime_light: soiled(m, 0.87, false), grime: soiled(m, 0.7, false), grime_heavy: soiled(m, 0.45, true) };
}

/** The share of the band height each stage covers: the faint film all of it, the dusty band, the splash zone. */
const STAGES: [string, number, number][] = [["grime_light", 1, 0.002], ["grime", 0.68, 0.0035], ["grime_heavy", 0.38, 0.005]];

/** Three grime shells around a round foot (radius rb at the ground, rt at height h): all of h, 68% and 38% of it. */
export function grimeRound(name: string, rb: Num, rt: Num, h: Num, at: [Num, Num, Num] = [0, 0, 0], segments = 24): SpecNode[] {
  const r = (k: number, d: number): string => `(${rb}) + ((${rt}) - (${rb})) * ${k} + ${d}`;
  return STAGES.map(([material, k, d], i) => lathe(`${name}_${i + 1}`, [[r(0, d), 0.001], [r(k, d), `(${h}) * ${k}`]], { at, segments, material }));
}

/**
 * Grime shells that follow a lathe profile (radius, height) of the foot: the faint film covers all the points, the
 * dusty band stops 40% of the way up the last segment, the splash zone at the second last point. At least three points,
 * from the ground up.
 */
export function grimeProfile(name: string, pts: [Num, Num][], o: { segments?: number; at?: [Num, Num, Num]; rotate?: [Num, Num, Num] } = {}): SpecNode[] {
  const shell = (n: string, p: [Num, Num][], d: number, material: string): SpecNode =>
    lathe(n, p.map(([r, y]) => [`(${r}) + ${d}`, y] as [Num, Num]), { segments: o.segments ?? 24, ...(o.at ? { at: o.at } : {}), ...(o.rotate ? { rotate: o.rotate } : {}), material });
  const [ra, ya] = pts[pts.length - 2]!;
  const [rb, yb] = pts[pts.length - 1]!;
  const mid: [Num, Num] = [`(${ra}) + ((${rb}) - (${ra})) * 0.4`, `(${ya}) + ((${yb}) - (${ya})) * 0.4`];
  return [
    shell(`${name}_1`, pts, 0.002, "grime_light"),
    shell(`${name}_2`, [...pts.slice(0, -1), mid], 0.0035, "grime"),
    shell(`${name}_3`, pts.slice(0, -1), 0.005, "grime_heavy"),
  ];
}

/** The same for a box foot w x d (centred at `at`), h tall. */
export function grimeBox(name: string, w: Num, d: Num, h: Num, at: [Num, Num, Num] = [0, 0, 0], bevel: Num = 0): SpecNode[] {
  const b = bevel ? { bevel } : {};
  return STAGES.map(([material, k, p], i) =>
    box(`${name}_${i + 1}`, [`(${w}) + ${2 * p}`, `(${h}) * ${k}`, `(${d}) + ${2 * p}`], { at: [at[0], `(${at[1]}) + 0.001`, at[2]], anchor: "bottom", material, ...b }),
  );
}

/**
 * A timber board along x (size: length, thickness, width) with the grain running along it. The "grain" texture runs
 * up the side faces of an upright box, so the board is built standing and laid down (rotate z 90): its long faces then
 * all show long grain. Takes the box options except rotate (put a tilt on a parent group).
 */
export function boardX(name: string, size: [Num, Num, Num], o: Omit<NodeOpts, "rotate" | "offset"> & { bevel?: Num; anchor?: "center" | "bottom" } = {}): SpecNode {
  const [l, h, d] = size;
  const { anchor, ...rest } = o;
  return box(name, [h, l, d], { ...rest, rotate: [0, 0, 90], ...(anchor === "bottom" ? { offset: [`(${h}) / 2`, 0, 0] } : {}) });
}

/** The same for a board along z (size: width, thickness, length), built standing and laid down (rotate x 90). */
export function boardZ(name: string, size: [Num, Num, Num], o: Omit<NodeOpts, "rotate" | "offset"> & { bevel?: Num; anchor?: "center" | "bottom" } = {}): SpecNode {
  const [w, h, l] = size;
  const { anchor, ...rest } = o;
  return box(name, [w, l, h], { ...rest, rotate: [90, 0, 0], ...(anchor === "bottom" ? { offset: [0, 0, `-(${h}) / 2`] } : {}) });
}

/** A readable name for a finish. */
export const nice = (name: string): string =>
  name.replace(/^(paint|plastic|ceramic|glass|bark|leaf|petal|postal|pillar|water_barrier)_(.+)$/, "$2").replaceAll("_", " ");

/** First letter upper case. */
export const up = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
