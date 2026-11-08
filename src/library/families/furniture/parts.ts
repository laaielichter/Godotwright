/**
 * Small shared builders for the furniture families: handles, knobs, rings and hollow shells, so every family gets the
 * same well-made hardware without repeating it.
 */
import { PALETTE, type MaterialDef } from "../../palette.js";
import { box, group, lathe, loft, tube, type Num, type NodeOpts, type SpecNode, type Vec } from "../../kit.js";

const wood = (r: number, g: number, b: number, roughness = 0.62): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "wood" });
const cloth = (r: number, g: number, b: number, roughness = 0.94): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "fabric" });
const hide = (r: number, g: number, b: number, roughness = 0.5): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "leather" });
const paint = (r: number, g: number, b: number, roughness = 0.5, metallic = 0): MaterialDef => ({ color: [r, g, b], metallic, roughness, texture: "painted" });
const coat = (r: number, g: number, b: number, roughness = 0.55): MaterialDef => ({ color: [r, g, b], metallic: 0.28, roughness, texture: "painted" });
const metal = (r: number, g: number, b: number, roughness: number, texture?: string): MaterialDef => ({ color: [r, g, b], metallic: 1, roughness, ...(texture ? { texture } : {}) });

/**
 * Furniture-catalogue finishes, under the same names as the library palette so slugs and titles stay put: real
 * stained-wood tones (oak, walnut, cherry are darker and redder than raw timber), muted designer upholstery with a
 * woven or grained texture, off-white rather than paper-white paint, powder-coated dark metal and brushed or satin
 * bright metal. `fmats` prefers these over the palette.
 */
export const FURNITURE_FINISHES: Record<string, MaterialDef> = {
  // Woods: finished furniture timber, with grain.
  oak: wood(0.26, 0.145, 0.062, 0.58),
  light_oak: wood(0.32, 0.2, 0.095, 0.6),
  walnut: wood(0.13, 0.068, 0.034, 0.52),
  pine: wood(0.34, 0.21, 0.09, 0.66),
  birch: wood(0.38, 0.27, 0.15, 0.6),
  cherry: wood(0.2, 0.075, 0.035, 0.48),
  mahogany: wood(0.17, 0.052, 0.026, 0.42),
  teak: wood(0.23, 0.115, 0.045, 0.58),
  weathered_wood: wood(0.25, 0.22, 0.18, 0.9),
  whitewash_wood: wood(0.4, 0.37, 0.32, 0.78),
  dark_stain: wood(0.1, 0.056, 0.03, 0.6),
  rough_timber: wood(0.25, 0.155, 0.08, 0.85),
  bamboo: wood(0.38, 0.27, 0.12, 0.55),
  // Paints: eggshell lacquer on wood or metal; whites are warm off-whites.
  paint_white: paint(0.5, 0.48, 0.44, 0.45),
  paint_cream: paint(0.44, 0.38, 0.27, 0.5),
  paint_black: paint(0.032, 0.031, 0.03, 0.45),
  paint_grey: paint(0.2, 0.205, 0.2, 0.5),
  paint_anthracite: paint(0.05, 0.053, 0.056, 0.5),
  paint_navy: paint(0.022, 0.036, 0.085, 0.45),
  paint_mint: paint(0.15, 0.21, 0.165, 0.5),
  paint_olive: paint(0.12, 0.13, 0.065, 0.55),
  paint_red: paint(0.34, 0.045, 0.03, 0.45),
  paint_sand: paint(0.42, 0.34, 0.22, 0.6),
  // Upholstery: muted designer colours.
  linen: cloth(0.32, 0.28, 0.22, 0.96),
  fabric_cream: cloth(0.34, 0.3, 0.24, 0.95),
  fabric_mustard: cloth(0.28, 0.17, 0.05),
  fabric_teal: cloth(0.035, 0.075, 0.078),
  fabric_terracotta: cloth(0.24, 0.09, 0.05),
  velvet_green: cloth(0.04, 0.07, 0.05, 0.8),
  velvet_red: cloth(0.12, 0.03, 0.033, 0.8),
  velvet_blue: cloth(0.04, 0.052, 0.1, 0.8),
  wool_grey: cloth(0.16, 0.155, 0.145, 0.98),
  wool_charcoal: cloth(0.048, 0.048, 0.05, 0.98),
  leather_brown: hide(0.09, 0.042, 0.022, 0.45),
  leather_black: hide(0.03, 0.027, 0.025, 0.42),
  leather_tan: hide(0.19, 0.09, 0.04, 0.5),
  // Metals: satin bright metal, powder-coated dark metal (never a black mirror).
  brass: metal(0.78, 0.58, 0.3, 0.32, "brushed"),
  bronze: metal(0.5, 0.33, 0.18, 0.42, "brushed"),
  copper: metal(0.82, 0.48, 0.34, 0.35, "brushed"),
  chrome: metal(0.86, 0.86, 0.87, 0.2),
  brushed_steel: metal(0.58, 0.59, 0.6, 0.45, "brushed"),
  aluminium: metal(0.78, 0.79, 0.8, 0.45, "brushed"),
  gunmetal: metal(0.34, 0.35, 0.37, 0.42, "brushed"),
  black_steel: coat(0.045, 0.045, 0.047, 0.55),
  cast_iron: coat(0.04, 0.038, 0.037, 0.65),
  galvanised: { color: [0.48, 0.49, 0.49], metallic: 0.7, roughness: 0.62, texture: "brushed" },
  // Stone, ceramics and glass.
  marble: { color: [0.5, 0.49, 0.46], metallic: 0, roughness: 0.25, texture: "plaster" },
  marble_black: { color: [0.035, 0.034, 0.036], metallic: 0, roughness: 0.22, texture: "plaster" },
  granite: { color: [0.2, 0.195, 0.19], metallic: 0, roughness: 0.4, texture: "concrete" },
  concrete: { color: [0.34, 0.33, 0.31], metallic: 0, roughness: 0.85, texture: "concrete" },
  terracotta: { color: [0.26, 0.1, 0.05], metallic: 0, roughness: 0.85, texture: "plaster" },
  ceramic_white: { color: [0.54, 0.53, 0.5], metallic: 0, roughness: 0.15 },
  ceramic_blue: { color: [0.035, 0.08, 0.2], metallic: 0, roughness: 0.15 },
  ceramic_celadon: { color: [0.28, 0.38, 0.3], metallic: 0, roughness: 0.18 },
  ceramic_ochre: { color: [0.42, 0.22, 0.05], metallic: 0, roughness: 0.2 },
  aged_copper: { color: [0.1, 0.17, 0.13], metallic: 0.3, roughness: 0.7, texture: "painted" },
  // Small parts.
  rubber: { color: [0.03, 0.03, 0.032], metallic: 0, roughness: 0.9, texture: "plastic" },
  plastic_black: { color: [0.035, 0.035, 0.038], metallic: 0, roughness: 0.5, texture: "plastic" },
  plastic_white: { color: [0.6, 0.6, 0.58], metallic: 0, roughness: 0.45, texture: "plastic" },
  plastic_grey: { color: [0.2, 0.205, 0.21], metallic: 0, roughness: 0.5, texture: "plastic" },
  // Shadow behind door and drawer gaps, so the reveals read as dark lines.
  reveal: { color: [0.02, 0.018, 0.016], metallic: 0, roughness: 1 },
};

/** Furniture finishes by name: the catalogue version where there is one, else the library palette. */
export function fmats(...names: string[]): Record<string, MaterialDef> {
  const out: Record<string, MaterialDef> = {};
  for (const name of names) {
    const m = FURNITURE_FINISHES[name] ?? PALETTE[name];
    if (!m) throw new Error(`furniture: no material "${name}"`);
    out[name] = m;
  }
  return out;
}

/** a + b for a number or an expression. */
export const plus = (a: Num, b: number): Num => (typeof a === "number" ? Math.round((a + b) * 10000) / 10000 : b === 0 ? a : `${a} ${b < 0 ? "-" : "+"} ${Math.abs(b)}`);

/**
 * A closed ring (a torus) about the y axis: tube radius r around a circle of radius R at height y. Footrests, rims,
 * lamp rings. Built as a lathe whose profile is a closed circle, so the surface is closed without caps.
 */
export function ring(name: string, R: Num, r: number, y: Num, o: NodeOpts & { segments?: number; sides?: number } = {}): SpecNode {
  const n = o.sides ?? 10;
  const pts: [Num, Num][] = [];
  for (let k = 0; k <= n; k++) {
    const a = -Math.PI / 2 + (2 * Math.PI * (k % n)) / n;
    pts.push([plus(R, r * Math.cos(a)), plus(y, r * Math.sin(a))]);
  }
  const { sides: _s, segments, ...rest } = o;
  return lathe(name, pts, { segments: segments ?? 24, caps: false, ...rest });
}

/**
 * A hollow shell of revolution with wall thickness t (a lamp shade, a bowl, a glass): the outer profile bottom to top,
 * then the same profile inside, as one closed loop. Outer radii must stay larger than t.
 */
export function shell(name: string, outer: [Num, Num][], t: number, o: NodeOpts & { segments?: number } = {}): SpecNode {
  const inner = [...outer].reverse().map(([r, y]): [Num, Num] => [plus(r, -t), y]);
  const first = outer[0] as [Num, Num];
  return lathe(name, [...outer, ...inner, first], { segments: o.segments ?? 24, caps: false, ...o });
}

/** A round knob pointing +z from its node origin (the face it is screwed into). */
export function knob(name: string, at: Vec, material: string, size = 1, o: NodeOpts = {}): SpecNode {
  const s = (v: number): number => Math.round(v * size * 10000) / 10000;
  return lathe(name, [[s(0.006), -0.003], [s(0.006), s(0.012)], [s(0.013), s(0.016)], [s(0.016), s(0.022)], [s(0.012), s(0.028)], [s(0.005), s(0.03)]], { at, rotate: [90, 0, 0], segments: 12, material, ...o });
}

/** A bar handle along x of length len (between the posts), standing off the face by 0.03, pointing +z. */
export function barHandle(name: string, len: Num, at: Vec, material: string, o: NodeOpts & { radius?: number; standoff?: number } = {}): SpecNode {
  const h = typeof len === "number" ? len / 2 : `(${len}) / 2`;
  const nh = typeof len === "number" ? -len / 2 : `-(${len}) / 2`;
  const s = o.standoff ?? 0.03;
  const { radius, standoff: _s, ...rest } = o;
  return tube(name, [[nh, 0, -0.004], [nh, 0, s], [h, 0, s], [h, 0, -0.004]], radius ?? 0.006, { at, segments: 10, material, ...rest });
}

/** A cup (bin) pull: a half shell below a back plate, pointing +z. */
export function cupPull(name: string, at: Vec, material: string): SpecNode {
  return box(name, [0.085, 0.032, 0.012], {
    at, material, bevel: 0.004,
    children: [tube("Cup", [[-0.036, 0.004, 0.004], [-0.03, -0.01, 0.02], [0, -0.016, 0.026], [0.03, -0.01, 0.02], [0.036, 0.004, 0.004]], 0.006, { segments: 8 })],
  });
}

/** A label holder (filing cabinets): a thin frame with a white card. */
export function labelHolder(name: string, at: Vec, material: string): SpecNode {
  return box(name, [0.08, 0.035, 0.006], { at, material, bevel: 0.002, children: [box("Card", [0.068, 0.025, 0.004], { at: [0, 0, 0.002], material: "plastic_white" })] });
}

/**
 * A tapered leg with a rounded-square section, standing on y = 0 at `at` and `h` high: `top` and `bottom` are the side
 * lengths at each end. Built as a loft turned upright, so its faces shade flat with softened corners.
 */
export function squareLeg(name: string, at: Vec, h: Num, top: number, bottom: number, mirror?: string, o: NodeOpts = {}): SpecNode {
  const sec = (z: Num, s: number) => ({ z, superellipse: { width: s, height: s, n: 7, count: 20 } });
  return loft(name, [sec(0, bottom), sec(0.012, bottom + 0.004), sec(h, top)], { at, rotate: [-90, 0, 0], ...(mirror ? { mirror } : {}), ...o });
}

/** Book cover colours for `books`. */
export const BOOK_MATERIALS: Record<string, MaterialDef> = {
  book_red: { color: [0.22, 0.035, 0.03], metallic: 0, roughness: 0.75, texture: "fabric" },
  book_blue: { color: [0.03, 0.055, 0.13], metallic: 0, roughness: 0.75, texture: "fabric" },
  book_green: { color: [0.04, 0.1, 0.06], metallic: 0, roughness: 0.75, texture: "fabric" },
  book_cream: { color: [0.5, 0.44, 0.33], metallic: 0, roughness: 0.8, texture: "leather" },
};

/**
 * A row of books standing on a surface at local y = `y`, spread over a share of the width `$sw` that changes with `$s`
 * (`index`, the shelf index, by default the $i of the shelf it stands on). `$bh` is the clear height and `$bd` the usable depth.
 */
export function books(name: string, y: Num, x0: Num = "-$sw / 2 + 0.03", index: Num = "$i"): SpecNode {
  const mats = ["book_red", "book_blue", "book_cream", "book_green"];
  return group(name, mats.map((m, k) =>
    box(`Book_${k + 1}_{i}`, [0.024, `min($bh, 0.16 + 0.08 * abs(sin(($i + $bi * 3) * 1.9 + ${k})))`, `min($bd, 0.14 + 0.05 * abs(cos($i * 2.3 + ${k})))`], {
      at: [`${x0} + ${k * 0.026}`, y, 0], anchor: "bottom", material: m,
      repeat: { count: "max(1, floor($sw * (0.3 + 0.25 * abs(sin($bi * 2.1 + 0.5))) / 0.104))", step: [0.104, 0, 0] },
    })), { vars: { bi: index } });
}
