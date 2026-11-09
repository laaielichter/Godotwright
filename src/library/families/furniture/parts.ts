/**
 * Small shared builders for the furniture families: handles, knobs, rings and hollow shells, so every family gets the
 * same well-made hardware without repeating it.
 */
import { PALETTE, type MaterialDef } from "../../palette.js";
import { box, cyl, ellipsoid, group, lathe, loft, tube, type Num, type NodeOpts, type SpecNode, type Vec } from "../../kit.js";

const wood = (r: number, g: number, b: number, roughness = 0.62): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "grain" });
const cloth = (r: number, g: number, b: number, roughness = 0.94): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "fabric" });
const hide = (r: number, g: number, b: number, roughness = 0.5): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "leather" });
const paint = (r: number, g: number, b: number, roughness = 0.5, metallic = 0): MaterialDef => ({ color: [r, g, b], metallic, roughness, texture: "painted" });
const coat = (r: number, g: number, b: number, roughness = 0.55): MaterialDef => ({ color: [r, g, b], metallic: 0.28, roughness, texture: "painted" });
const metal = (r: number, g: number, b: number, roughness: number, texture?: string, metallic = 1): MaterialDef => ({ color: [r, g, b], metallic, roughness, ...(texture ? { texture } : {}) });

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
  walnut: wood(0.13, 0.068, 0.034, 0.6),
  pine: wood(0.34, 0.21, 0.09, 0.66),
  birch: wood(0.38, 0.27, 0.15, 0.6),
  cherry: wood(0.2, 0.075, 0.035, 0.48),
  mahogany: wood(0.17, 0.052, 0.026, 0.42),
  teak: wood(0.23, 0.115, 0.045, 0.58),
  weathered_wood: wood(0.25, 0.22, 0.18, 0.9),
  whitewash_wood: wood(0.4, 0.37, 0.32, 0.78),
  dark_stain: wood(0.11, 0.06, 0.032, 0.74),
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
  leather_black: hide(0.046, 0.042, 0.039, 0.36),
  leather_tan: hide(0.19, 0.09, 0.04, 0.5),
  // Metals: satin bright metal, powder-coated dark metal (never a black mirror).
  // Bright metals are a little rough and warm, so they show their own colour under an open sky instead of mirroring
  // it blue: brass is a clear yellow gold, chrome a soft polished highlight, steel and aluminium satin.
  brass: metal(0.88, 0.64, 0.26, 0.38, "brushed", 0.92),
  bronze: metal(0.6, 0.4, 0.2, 0.45, "brushed", 0.92),
  copper: metal(0.88, 0.52, 0.36, 0.42, "brushed", 0.92),
  chrome: metal(0.8, 0.76, 0.68, 0.42, undefined, 0.85),
  brushed_steel: metal(0.62, 0.59, 0.53, 0.55, "brushed", 0.85),
  aluminium: metal(0.78, 0.75, 0.68, 0.52, "brushed", 0.85),
  gunmetal: metal(0.36, 0.36, 0.37, 0.48, "brushed", 0.9),
  black_steel: coat(0.045, 0.045, 0.047, 0.55),
  cast_iron: coat(0.04, 0.038, 0.037, 0.65),
  galvanised: { color: [0.4, 0.41, 0.41], metallic: 0.8, roughness: 0.55, texture: "brushed" },
  // Stone, ceramics and glass.
  lining_lit: { color: [0.4, 0.36, 0.28], metallic: 0, roughness: 0.9, texture: "fabric", emissive: [0.1, 0.085, 0.06] },
  glass_cabinet: { color: [0.7, 0.8, 0.85, 0.16], metallic: 0, roughness: 0.03, alpha: "BLEND" },
  marble: { color: [0.5, 0.49, 0.46], metallic: 0, roughness: 0.25, texture: "plaster" },
  marble_black: { color: [0.035, 0.034, 0.036], metallic: 0, roughness: 0.22, texture: "plaster" },
  granite: { color: [0.2, 0.195, 0.19], metallic: 0, roughness: 0.4, texture: "concrete" },
  concrete: { color: [0.34, 0.33, 0.31], metallic: 0, roughness: 0.85, texture: "concrete" },
  terracotta: { color: [0.26, 0.1, 0.05], metallic: 0, roughness: 0.82 },
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
    if (name.endsWith("_tube")) {
      const base = fmats(name.slice(0, -5))[name.slice(0, -5)] as MaterialDef;
      const { texture: _t, ...plain } = base;
      out[name] = plain;
      continue;
    }
    const m = FURNITURE_FINISHES[name] ?? PALETTE[name];
    if (!m) throw new Error(`furniture: no material "${name}"`);
    out[name] = m;
  }
  return out;
}

/**
 * The finish to use on thin tubes and posts: a brushed metal streaks across a round section like wound tape, so its
 * tube version (`name_tube`, registered by `fmats`) is the same metal without the brushed texture. Other finishes are unchanged.
 */
export function tubular(name: string): string {
  const m = FURNITURE_FINISHES[name] ?? PALETTE[name];
  return m && m.texture === "brushed" ? `${name}_tube` : name;
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

/** A drop-ring pull: a round backplate with a post at the top and a ring hanging from it, pointing +z. */
export function ringPull(name: string, at: Vec, material: string): SpecNode {
  const R = 0.0275;
  const rr = (v: number): number => Math.round(v * 10000) / 10000;
  const section = Array.from({ length: 10 }, (_, k): [number, number] => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / 10;
    return [rr(R + 0.0042 * Math.cos(a)), rr(0.0042 * Math.sin(a))];
  });
  return cyl(name, 0.02, 0.008, {
    at, material, segments: 20, rotate: [90, 0, 0], bevel: 0.002,
    children: [
      cyl("Post", 0.0055, 0.016, { at: [0, 0.008, -0.013], segments: 10 }),
      lathe("Ring", [...section, section[0] as [number, number]], { at: [0, 0.012, 0.0135], segments: 22, caps: false }),
    ],
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
const bookCloth = (r: number, g: number, b: number, texture = "fabric", roughness = 0.75): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture });
export const BOOK_MATERIALS: Record<string, MaterialDef> = {
  book_red: bookCloth(0.22, 0.035, 0.03),
  book_blue: bookCloth(0.03, 0.055, 0.13),
  book_green: bookCloth(0.04, 0.1, 0.06),
  book_cream: bookCloth(0.5, 0.44, 0.33, "leather", 0.8),
  book_brown: bookCloth(0.12, 0.055, 0.025, "leather", 0.55),
  book_mustard: bookCloth(0.34, 0.21, 0.04),
  book_grey: bookCloth(0.14, 0.145, 0.15, "fabric", 0.8),
  book_burgundy: bookCloth(0.1, 0.015, 0.025, "leather", 0.55),
  book_teal: bookCloth(0.03, 0.12, 0.12),
  book_black: bookCloth(0.03, 0.03, 0.032, "leather", 0.5),
  book_gilt: { color: [0.75, 0.55, 0.2], metallic: 0.8, roughness: 0.4 },
  book_pages: { color: [0.55, 0.5, 0.4], metallic: 0, roughness: 0.9 },
};

/**
 * A row of books standing on a surface at local y = `y`, spread over a share of the width `$sw` that changes with `$s`
 * (`index`, the shelf index, by default the $i of the shelf it stands on). `$bh` is the clear height and `$bd` the usable depth.
 * Ten different covers in ten slots whose widths, heights and depths all vary, and gilt bands on the spines.
 */
export function books(name: string, y: Num, x0: Num = "-$sw / 2 + 0.03", index: Num = "$i"): SpecNode {
  const mats = ["book_red", "book_teal", "book_cream", "book_brown", "book_blue", "book_mustard", "book_burgundy", "book_green", "book_grey", "book_black"];
  const slots = 10;
  const pitch = 0.026 * slots;
  const count = `max(1, floor($sw * (0.3 + 0.25 * abs(sin($bi * 2.1 + 0.5))) / ${pitch + 0.002}))`;
  const book = (k: number): SpecNode => {
    const m = mats[k % mats.length] as string;
    const bw = `(0.017 + 0.013 * abs(sin($i * 1.7 + ${k * 2.9} + $bi)))`;
    const bk = `min($bh, 0.15 + 0.09 * abs(sin(($i + $bi * 3) * 1.9 + ${k * 1.3})))`;
    const bz = `min($bd, 0.14 + 0.05 * abs(cos($i * 2.3 + ${k})))`;
    return box(`Book_${k + 1}_{i}`, [bw, bk, bz], {
      at: [`${x0} + ${(k % slots) * 0.026}`, y, 0], anchor: "bottom", material: m,
      repeat: { count, step: [pitch + 0.002, 0, 0] },
      children: [
        box("Band_T", [`${bw} + 0.002`, 0.008, 0.002], { at: [0, `${bk} * 0.8`, `${bz} / 2`], material: "book_gilt" }),
        box("Band_B", [`${bw} + 0.002`, 0.005, 0.002], { at: [0, `${bk} * 0.18`, `${bz} / 2`], material: "book_gilt" }),
      ],
    });
  };
  return group(name, Array.from({ length: slots }, (_, k) => book(k)), { vars: { bi: index } });
}

/** a + b / 2 for numbers or expressions. */
const addHalf = (a: Num, b: Num): Num => (typeof a === "number" && typeof b === "number" ? Math.round((a + b / 2) * 10000) / 10000 : `(${a}) + (${b}) / 2`);

/**
 * A solid board of timber, size [x, y, z] as for a box, whose grain runs along its length (`along` x or z) on every face,
 * also on the edges and the front. A plain box maps the side faces with the grain upright, which reads wrong on a rail or
 * an apron. Built as a box turned about z (along x) or x (along z); keep children off it.
 */
export function board(name: string, size: Vec, along: "x" | "z", o: NodeOpts & { bevel?: Num; anchor?: "center" | "bottom" } = {}): SpecNode {
  const [w, h, d] = size;
  const { anchor, ...rest } = o;
  const at: Vec = (o.at as Vec | undefined) ?? [0, 0, 0];
  const placed: Vec = anchor === "bottom" ? [at[0], addHalf(at[1], h), at[2]] : at;
  return along === "x"
    ? box(name, [h, w, d], { ...rest, at: placed, rotate: [0, 0, 90] })
    : box(name, [w, d, h], { ...rest, at: placed, rotate: [90, 0, 0] });
}

/** Linear colour of a finish, darker by factor k: the shadow of a pleat or tuft in that fabric or leather. */
export function shade(name: string, k = 0.45): Record<string, MaterialDef> {
  const m = FURNITURE_FINISHES[name] ?? PALETTE[name];
  if (!m) throw new Error(`furniture: no material "${name}"`);
  const [r, g, b] = m.color;
  return { [`${name}_tuft`]: { ...m, color: [Math.max(0.012, r * k), Math.max(0.012, g * k), Math.max(0.012, b * k)], roughness: Math.min(1, m.roughness + 0.1) } };
}

/**
 * Deep buttoned (capitonné) tufting on a padded face that looks +z, from the node origin: rows of buttons, each sunk in a
 * dark dimple, joined by dark diagonal pleats into the classic diamond pattern. `cover` is the upholstery; its `_tuft`
 * shade (see `shade`) must be in the materials. Rows alternate between `cols` and `cols - 1` buttons at spacing `sx`
 * across and `sy` up, starting at the origin (bottom row, centred). `cols` may be an expression.
 */
export function tufting(name: string, cover: string, cols: Num, rows: number, sx: number, sy: Num, o: NodeOpts = {}): SpecNode {
  const dark = `${cover}_tuft`;
  const hx = Math.round((sx / 2) * 10000) / 10000;
  const pleat = (k: number, sxn: number, syn: number): SpecNode =>
    tube(`Pleat_${k}`, [[0.014 * sxn, 0.014 * syn, 0.001], [Math.round(hx * 0.9 * sxn * 10000) / 10000, `(${sy}) * 0.9 * ${syn}`, 0.001]], 0.0035, { segments: 6, material: dark });
  const tuft: SpecNode[] = [
    lathe("Dimple", [[0.004, -0.004], [0.022, -0.004], [0.026, 0.0015], [0.004, 0.002]], { rotate: [90, 0, 0], segments: 14, material: dark }),
    ellipsoid("Button", [0.013, 0.013, 0.008], { at: [0, 0, 0.003], segments: 12, material: cover }),
  ];
  const rowNodes: SpecNode[] = [];
  for (let r = 0; r < rows; r++) {
    const odd = r % 2 === 1;
    const n: Num = odd ? (typeof cols === "number" ? cols - 1 : `(${cols}) - 1`) : cols;
    const pleats: SpecNode[] = [];
    // Pleats run diagonally up from every button to its two neighbours in the row above.
    if (r < rows - 1) pleats.push(pleat(1, 1, 1), pleat(2, -1, 1));
    rowNodes.push(group(`Tuft_${r + 1}_{i}`, [...tuft, ...pleats], {
      at: [`-((${n}) - 1) * ${sx} / 2`, `${r} * (${sy})`, 0],
      repeat: { count: n, step: [sx, 0, 0] },
    }));
  }
  return group(name, rowNodes, o);
}

/**
 * A plump pillow lying along x, `w` wide (an expression), 2 * dz deep and about 1.5 * hy thick: a loft of pointed lens sections
 * (crisp seam edge, rounder on top than underneath where it rests), full in the middle and pinched flat at the four
 * corners, with piping along both long seams in the `${material}_tuft` shade. The node origin is the centre of its
 * underside.
 */
export function pillow(name: string, w: string, dz: number, hy: number, material: string, o: NodeOpts = {}): SpecNode {
  const count = 20;
  const r4 = (v: number): number => Math.round(v * 10000) / 10000;
  const lens = (t: number): [number, number][] => {
    const f = Math.max(0.09, Math.sqrt(1 - Math.abs(t) ** 6)) * (1 + 0.04 * (1 - t * t) * Math.sin(3 * t + 0.6));
    const g = 0.92 + 0.08 * t ** 4;
    return Array.from({ length: count }, (_, k): [number, number] => {
      const a = (2 * Math.PI * k) / count;
      const s = Math.sin(a);
      const y = hy * f * Math.sign(s) * Math.abs(s) ** 1.5 * (s < 0 ? 0.55 : 1);
      return [r4(dz * g * Math.cos(a)), r4(y + hy * 0.55 * 0.97)];
    });
  };
  const stations = [-1, -0.97, -0.88, -0.65, -0.32, 0, 0.32, 0.65, 0.88, 0.97, 1];
  const seam = (side: number): SpecNode =>
    tube(side > 0 ? "Seam_F" : "Seam_B", stations.slice(1, -1).map((t): [string, number, number] => [`(${w}) / 2 * ${t}`, r4(hy * 0.55 * 0.97), r4(side * dz * (0.92 + 0.08 * t ** 4) - side * 0.002)]), 0.0045, { segments: 6, material: `${material}_tuft` });
  return group(name, [
    loft("Case", stations.map((t) => ({ z: `(${w}) / 2 * ${t}`, points: lens(t) })), { rotate: [0, 90, 0], material }),
    seam(1),
    seam(-1),
  ], o);
}


/**
 * An upholstered cushion, `w` wide (x, an expression), `h` thick and `d` deep (z, an expression), with its origin at the
 * centre: a lofted case with soft rounded edges and a crowned top that swells towards the middle (no crease), welt
 * piping on the seam line round the top and bottom, and optionally `tufts` deep-buttoned dimples across the crown (each
 * with four `pleats` unless `pleats` is false) or a top-stitched `seam`. The `${cover}_tuft` shade of `cover` (see `shade`)
 * must be in the materials when `tufts` or `seam` is used. `bevel` is the edge radius. Keep other nodes off it.
 */
export function cushion(name: string, w: Num, h: number, d: Num, cover: string, o: NodeOpts & { bevel?: number; crown?: number; tufts?: number; pleats?: boolean; seam?: boolean } = {}): SpecNode {
  const { bevel: bv, crown: cr, tufts, pleats, seam, ...rest } = o;
  const e = Math.min(bv ?? 0.04, h * 0.45);
  const crown = cr ?? 0.014;
  const r4n = (v: number): number => Math.round(v * 10000) / 10000;
  const N = 28;
  const dark = `${cover}_tuft`;
  const W2 = (k: number, off = 0): Num => (typeof w === "number" ? r4n((w / 2) * k - off * Math.sign(k)) : `(${w}) / 2 * ${r4n(k)}${off ? ` ${k < 0 ? "+" : "-"} ${r4n(off)}` : ""}`);
  const D2 = (sign: number, u: number): Num => (typeof d === "number" ? r4n(sign * (d / 2 - u)) : `${sign < 0 ? "-" : ""}((${d}) / 2 - ${r4n(u)})`);
  const Dk = (k: number): Num => (typeof d === "number" ? r4n((d / 2) * k) : `(${d}) / 2 * ${r4n(k)}`);
  // Edge inset of the rounded end at distance u from the end face.
  const delta = (u: number): number => (u >= e ? 0 : e - Math.sqrt(Math.max(0, e * e - (e - u) * (e - u))));
  const sections = (): Record<string, unknown>[] => {
    const stations: { z: Num; d: number; c: number }[] = [];
    const ends = [0, 0.004, 0.011, 0.021, e * 0.7, e];
    for (const u of ends) stations.push({ z: D2(-1, u), d: delta(u), c: 0 });
    stations.push({ z: Dk(-0.4), d: 0, c: 0.84 }, { z: 0, d: 0, c: 1 }, { z: Dk(0.4), d: 0, c: 0.84 });
    for (const u of [...ends].reverse()) stations.push({ z: D2(1, u), d: delta(u), c: 0 });
    // The crown fades out towards the end faces along the rounded edge.
    return stations.map((st) => {
      const c = st.c === 0 && st.d === 0 ? 0.55 : st.c;
      const pts: [Num, Num][] = [];
      for (let k = 0; k < N; k++) {
        const a = (2 * Math.PI * k) / N;
        const cs = Math.cos(a), sn = Math.sin(a);
        const cf = Math.sign(cs) * Math.abs(cs) ** (2 / 5);
        const sf = Math.sign(sn) * Math.abs(sn) ** (2 / 5);
        const y = (h / 2 - st.d) * sf + (sf > 0 ? crown * c * (1 - cf * cf) * sf : 0);
        pts.push([W2(cf, st.d * Math.sign(cf)), r4n(y)]);
      }
      return { z: st.z, points: pts };
    });
  };
  const loop = (y: number, tag: string): SpecNode => {
    const fx = (1 - (Math.abs(y) / (h / 2)) ** 5) ** (1 / 5);
    const c = 0.045;
    const xa = (k: number): Num => W2(fx, k);
    const xb = (k: number): Num => W2(-fx, k);
    const za = (k: number): Num => D2(1, k);
    const zb = (k: number): Num => D2(-1, k);
    const y4 = r4n(y);
    const zi = 0.012;
    return tube(`Welt_${tag}`, [
      [xb(c), y4, za(zi)], [xa(c), y4, za(zi)], [xa(0), y4, za(zi + c)], [xa(0), y4, zb(zi + c)],
      [xa(c), y4, zb(zi)], [xb(c), y4, zb(zi)], [xb(0), y4, zb(zi + c)], [xb(0), y4, za(zi + c)], [xb(c), y4, za(zi)],
    ], 0.0058, { segments: 8 });
  };
  const kids: SpecNode[] = [loop(h / 2 * 0.8, "T"), loop(-h / 2 * 0.8, "B")];
  if (seam) {
    const s = 0.04;
    const y4 = r4n(h / 2 + crown * 0.5);
    kids.push(tube("Stitch", [[W2(-0.8, s), y4, D2(-1, s)], [W2(0.8, s), y4, D2(-1, s)], [W2(0.8, s), y4, D2(1, s)], [W2(-0.8, s), y4, D2(1, s)], [W2(-0.8, s), y4, D2(-1, s)]], 0.0016, { segments: 5, material: dark }));
  }
  if (tufts && tufts > 0) {
    const top = r4n(h / 2 + crown * 0.97);
    for (let k = 0; k < tufts; k++) {
      const f = tufts === 1 ? 0 : (k / (tufts - 1)) * 2 - 1;
      const x: Num = typeof w === "number" ? r4n((w / 2) * 0.6 * f) : `(${w}) / 2 * ${r4n(0.6 * f)}`;
      kids.push(group(`Tuft_${k + 1}`, [
        lathe("Dimple", [[0.004, -0.007], [0.021, -0.003], [0.026, 0.002], [0.004, 0.002]], { segments: 14, material: dark }),
        ellipsoid("Button", [0.012, 0.007, 0.012], { at: [0, 0.0015, 0], segments: 12 }),
        ...(pleats === false ? [] : [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz], q) =>
          tube(`Pleat_${q + 1}`, [[0.012 * (sx as number), 0.0005, 0.012 * (sz as number)], [0.05 * (sx as number), 0.0005, 0.05 * (sz as number)]], 0.0028, { segments: 5, material: dark }))),
      ], { at: [x, top, 0] }));
    }
  }
  const body = loft("Case", sections());
  return group(name, [body, ...kids], rest);
}
