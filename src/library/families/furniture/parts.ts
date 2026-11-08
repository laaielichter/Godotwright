/**
 * Small shared builders for the furniture families: handles, knobs, rings and hollow shells, so every family gets the
 * same well-made hardware without repeating it.
 */
import type { MaterialDef } from "../../palette.js";
import { box, group, lathe, loft, tube, type Num, type NodeOpts, type SpecNode, type Vec } from "../../kit.js";

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
  book_red: { color: [0.32, 0.04, 0.03], metallic: 0, roughness: 0.7 },
  book_blue: { color: [0.04, 0.08, 0.2], metallic: 0, roughness: 0.7 },
  book_green: { color: [0.05, 0.16, 0.08], metallic: 0, roughness: 0.7 },
  book_cream: { color: [0.62, 0.55, 0.42], metallic: 0, roughness: 0.75 },
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
