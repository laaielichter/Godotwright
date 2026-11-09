/**
 * Shared builders for the vehicle families: linear expressions that can be evaluated at the defaults (so a family can
 * work out normals and directions in TypeScript while the spec keeps its `$param` expressions), wheels at their hub,
 * and a few finishes the palette does not have.
 */
import { box, cyl, ellipsoid, group, lathe, type Num, type SpecNode, type Vec } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";

/** Rounds to 4 decimals and prints without trailing zeros. */
export const f = (n: number): string => String(Math.round(n * 10000) / 10000);

/** A linear expression: { "": constant, name: coefficient } over spec variables ($name). */
export type Lin = Record<string, number>;

export const L = (c: number, terms: Record<string, number> = {}): Lin => ({ "": c, ...terms });

// These three run millions of times while a car is being shaped, so they walk the keys directly instead of building
// arrays of entries; the results (and their order) are the same.
export function ladd(...ls: Lin[]): Lin {
  const out: Lin = {};
  for (const l of ls) for (const k in l) out[k] = (out[k] ?? 0) + (l[k] as number);
  return out;
}

export function lscale(l: Lin, k: number): Lin {
  const out: Lin = {};
  for (const n in l) out[n] = (l[n] as number) * k;
  return out;
}
export const lsub = (a: Lin, b: Lin): Lin => ladd(a, lscale(b, -1));
export const lerpL = (a: Lin, b: Lin, t: number): Lin => ladd(lscale(a, 1 - t), lscale(b, t));

export function lev(l: Lin, env: Record<string, number>): number {
  let s = 0;
  for (const k in l) s += k === "" ? (l[k] as number) : (l[k] as number) * (env[k] ?? NaN);
  return s;
}

/** The expression for a linear expression: a plain number when it has no variables. */
export function ls(l: Lin): Num {
  const terms: string[] = [];
  let c = 0;
  for (const [k, v] of Object.entries(l)) {
    if (k === "") c += v;
    else if (Math.abs(v) > 1e-9) terms.push(`${terms.length ? (v < 0 ? "- " : "+ ") : v < 0 ? "-" : ""}${Math.abs(v - 1) < 1e-9 || Math.abs(v + 1) < 1e-9 ? "" : `${f(Math.abs(v))} * `}$${k}`);
  }
  if (terms.length === 0) return Math.round(c * 10000) / 10000;
  if (Math.abs(c) > 1e-9) terms.push(`${c < 0 ? "-" : "+"} ${f(Math.abs(c))}`);
  return terms.join(" ");
}

/** Wraps an expression in brackets when it has more than one term. */
export const br = (e: Num): string => (typeof e === "number" ? f(e) : /^[$\w.]+$/.test(e) ? e : `(${e})`);

/** Extra finishes for vehicles (linear RGB), calibrated for Godot: dark parts are painted, moulded or anodised. */
export const VMATS: Record<string, MaterialDef> = {
  tinted_glass: { color: [0.014, 0.018, 0.022, 0.93], metallic: 0.1, roughness: 0.03, alpha: "BLEND" },
  clear_glass: { color: [0.3, 0.35, 0.38, 0.32], metallic: 0, roughness: 0.03, alpha: "BLEND" },
  dark_glass: { color: [0.022, 0.028, 0.034], metallic: 0.3, roughness: 0.05 },
  trim_black: { color: [0.028, 0.028, 0.03], metallic: 0, roughness: 0.55, texture: "plastic" },
  satin_black: { color: [0.035, 0.035, 0.038], metallic: 0.3, roughness: 0.4, texture: "painted" },
  gloss_black: { color: [0.022, 0.022, 0.024], metallic: 0.2, roughness: 0.12 },
  tyre: { color: [0.03, 0.03, 0.032], metallic: 0, roughness: 0.86 },
  tyre_wall: { color: [0.038, 0.038, 0.04], metallic: 0, roughness: 0.68, texture: "plastic" },
  rubber_seal: { color: [0.026, 0.026, 0.028], metallic: 0, roughness: 0.72 },
  panel_gap: { color: [0.012, 0.012, 0.013], metallic: 0, roughness: 0.9 },
  lamp_lens: { color: [0.8, 0.83, 0.85], metallic: 0.2, roughness: 0.05, emissive: [0.5, 0.52, 0.55] },
  lamp_glass: { color: [0.55, 0.6, 0.62, 0.3], metallic: 0, roughness: 0.02, alpha: "BLEND" },
  reflector: { color: [0.86, 0.86, 0.87], metallic: 1, roughness: 0.12 },
  lamp_red: { color: [0.42, 0.02, 0.018], metallic: 0.1, roughness: 0.08, emissive: [0.3, 0.005, 0.004] },
  lamp_amber: { color: [0.7, 0.32, 0.02], metallic: 0.1, roughness: 0.08, emissive: [0.4, 0.15, 0.005] },
  plate: { color: [0.68, 0.68, 0.64], metallic: 0, roughness: 0.4, texture: "plastic" },
  plate_yellow: { color: [0.66, 0.45, 0.02], metallic: 0, roughness: 0.4, texture: "plastic" },
  upholstery: { color: [0.04, 0.038, 0.04], metallic: 0, roughness: 0.92, texture: "fabric" },
  upholstery_tan: { color: [0.32, 0.17, 0.08], metallic: 0, roughness: 0.6, texture: "leather" },
  carbon: { color: [0.035, 0.037, 0.042], metallic: 0, roughness: 0.32, texture: "fabric" },
  whitewall: { color: [0.64, 0.63, 0.59], metallic: 0, roughness: 0.6 },
  /** Wheels and running gear. */
  alloy: { color: [0.74, 0.75, 0.77], metallic: 1, roughness: 0.26, texture: "brushed" },
  alloy_dark: { color: [0.26, 0.27, 0.29], metallic: 1, roughness: 0.34, texture: "brushed" },
  steel_wheel: { color: [0.42, 0.43, 0.44], metallic: 0.35, roughness: 0.42, texture: "painted" },
  brake_disc: { color: [0.42, 0.42, 0.43], metallic: 1, roughness: 0.5, texture: "brushed" },
  caliper: { color: [0.38, 0.03, 0.02], metallic: 0.2, roughness: 0.4, texture: "painted" },
  chassis_black: { color: [0.032, 0.032, 0.034], metallic: 0.25, roughness: 0.6, texture: "painted" },
  powder_black: { color: [0.035, 0.035, 0.038], metallic: 0.25, roughness: 0.5, texture: "painted" },
  anodised_black: { color: [0.04, 0.04, 0.044], metallic: 0.35, roughness: 0.42, texture: "brushed" },
  stainless: { color: [0.64, 0.65, 0.66], metallic: 1, roughness: 0.24, texture: "brushed" },
  gelcoat_white: { color: [0.66, 0.66, 0.63], metallic: 0, roughness: 0.2 },
};

/** The finishes wheel() uses inside (spread into an asset's materials next to its rim and hub materials). */
export const WHEEL_MATS = (): Record<string, MaterialDef> =>
  ({ ...mats("chrome"), ...Object.fromEntries(["tyre", "tyre_wall", "brake_disc", "satin_black", "trim_black", "alloy", "alloy_dark", "steel_wheel", "chassis_black"].map((k) => [k, VMATS[k]!])) });

/**
 * A clear-coated car paint, "painted" (orange peel) texture: a little metallic flake (0.2-0.35) under a glossy clear
 * coat. Colours are kept to real paint: the strongest channel at most 0.7, and never darker than black paint.
 */
export const carPaint = (r: number, g: number, b: number, metallic = 0.3, roughness = 0.25): MaterialDef => {
  const k = Math.max(r, g, b) > 0.7 ? 0.7 / Math.max(r, g, b) : 1;
  const c = [r, g, b].map((v) => Math.max(0.014, Math.round(v * k * 1000) / 1000)) as [number, number, number];
  return { color: c, metallic: Math.min(0.35, Math.max(0.2, metallic)), roughness: Math.min(0.35, Math.max(0.2, roughness)), texture: "painted" };
};

export type WheelStyle = "alloy" | "steel" | "wire" | "truck" | "disc" | "chrome";

export interface WheelOpts {
  /** Tyre radius expression. */
  r: Num;
  /** Tyre width expression. */
  w: Num;
  style: WheelStyle;
  rim: string;
  tyre?: string;
  hub?: string;
  spokes?: number;
  whitewall?: string;
  segments?: number;
  /** Rim radius as a fraction of the tyre radius. */
  rimFrac?: number;
  /** Which side faces out: 1 = +x (a left wheel), -1 = -x. */
  side?: 1 | -1;
}

/**
 * A road wheel as a node at its hub (spins about x): a tyre with rounded shoulders, a rim, and spokes, a dish or a
 * hub cap on the outer face (+x, or -x with side -1). Uses the variables $r and $w inside.
 */
export function wheel(name: string, at: Vec, o: WheelOpts, extra: { mirror?: string } = {}): SpecNode {
  const seg = o.segments ?? 28;
  const rf = o.rimFrac ?? 0.66;
  const tyre = o.tyre ?? "tyre";
  const s = o.side ?? 1;
  const X = (k: number): string => `${f(k * s)} * $w`;
  /** A profile point: radius as a fraction of $r, position along the axle as a fraction of $w (outer face +). */
  const P = (a: number, b: number): [Num, Num] => [`${f(a)} * $r`, X(b)];
  const kids: SpecNode[] = [];
  // The tyre: rounded shoulders and a tread with four circumferential grooves.
  const gr = (r: number, b: number): [Num, Num] => [`${f(r)} * $r`, `${f(b)} * $w`];
  const prof: [Num, Num][] = [
    gr(rf, -0.43), gr(rf + 0.55 * (1 - rf), -0.505), gr(0.965, -0.47), gr(0.992, -0.41), gr(1, -0.36),
    gr(1, -0.285), gr(0.982, -0.27), gr(0.982, -0.2), gr(1, -0.185),
    gr(1, -0.04), gr(0.982, -0.025), gr(0.982, 0.025), gr(1, 0.04),
    gr(1, 0.185), gr(0.982, 0.2), gr(0.982, 0.27), gr(1, 0.285),
    gr(1, 0.36), gr(0.992, 0.41), gr(0.965, 0.47), gr(rf + 0.55 * (1 - rf), 0.505), gr(rf, 0.43), gr(rf, -0.43),
  ];
  kids.push(lathe("Tyre", prof, { material: tyre, rotate: [0, 0, -90], segments: seg, caps: false }));
  // A moulded sidewall band on the outer face (lettering ring), a touch glossier than the tread.
  if (!o.whitewall) kids.push(lathe("Sidewall", [P(rf + 0.28 * (1 - rf), 0.46), P(rf + 0.5 * (1 - rf), 0.518), P(rf + 0.8 * (1 - rf), 0.494), P(rf + 0.6 * (1 - rf), 0.47), P(rf + 0.28 * (1 - rf), 0.46)], { material: "tyre_wall", rotate: [0, 0, -90], segments: seg, caps: false }));
  if (o.whitewall) {
    kids.push(lathe("Whitewall", [P(rf + 0.04, 0.43), P(rf + 0.3 * (1 - rf), 0.52), P(rf + 0.6 * (1 - rf), 0.51), P(rf + 0.04, 0.43)], { material: o.whitewall, rotate: [0, 0, -90], segments: seg, caps: false }));
  }
  // The rim barrel and its outer lip.
  kids.push(lathe("Rim", [
    [rf - 0.03, -0.42], [rf + 0.02, -0.45], [rf + 0.025, -0.4], [rf + 0.025, 0.4], [rf + 0.03, 0.47],
    [rf - 0.005, 0.5], [rf - 0.05, 0.44], [rf - 0.05, -0.38], [rf - 0.03, -0.42],
  ].map(([a, b]) => P(a!, b!)), { material: o.rim, rotate: [0, 0, -90], segments: seg, caps: false }));
  // A rim-protector ridge on the sidewall and the valve stem.
  kids.push(lathe("Ridge", [P(rf + 0.07 * (1 - rf), 0.485), P(rf + 0.12 * (1 - rf), 0.515), P(rf + 0.17 * (1 - rf), 0.485), P(rf + 0.07 * (1 - rf), 0.485)], { material: tyre, rotate: [0, 0, -90], segments: seg, caps: false }));
  kids.push(cyl("Valve", "0.012 * $r", "0.05 * $w", { axis: "x", at: [X(0.5), `${f(rf - 0.04)} * $r`, `${f(0.2)} * $r`], segments: 6, material: "trim_black" }));
  const hub = o.hub ?? o.rim;
  switch (o.style) {
    case "alloy": {
      const n = o.spokes ?? 5;
      // Behind the open spokes: the dark inner barrel, the brake disc on its hat, and the lug nuts on the boss.
      kids.push(cyl("Disc", `${f(rf - 0.04)} * $r`, "0.06 * $w", { axis: "x", at: [X(-0.3), 0, 0], segments: seg, material: "trim_black" }));
      kids.push(cyl("Rotor", `${f(rf - 0.13)} * $r`, "0.07 * $w", { axis: "x", at: [X(-0.05), 0, 0], segments: seg, material: "brake_disc" }));
      kids.push(cyl("Hat", "0.26 * $r", "0.3 * $w", { axis: "x", at: [X(0.1), 0, 0], segments: 20, material: "alloy_dark" }));
      kids.push(cyl("Nut_{i}", "0.022 * $r", "0.08 * $w", { axis: "x", at: [X(0.43), "0.13 * $r", 0], repeat: { count: 5, around: "x", phase: 36 }, segments: 6, material: "chrome" }));
      kids.push(box("Spoke_{i}", ["0.1 * $w", `${f((rf - 0.2) * 1.05)} * $r`, `${f(n > 6 ? 0.07 : 0.12)} * $r`], { at: [X(0.34), `${f(0.2 + (rf - 0.2) / 2)} * $r`, 0], repeat: { count: n, around: "x" }, bevel: 0.006, material: o.rim }));
      kids.push(cyl("Boss", "0.2 * $r", "0.16 * $w", { axis: "x", at: [X(0.34), 0, 0], segments: 20, material: o.rim, bevel: 0.008 }));
      kids.push(cyl("Cap", "0.09 * $r", "0.04 * $w", { axis: "x", at: [X(0.43), 0, 0], segments: 16, material: hub }));
      break;
    }
    case "steel": {
      kids.push(lathe("Dish", [P(rf - 0.02, 0.3), P(rf * 0.75, 0.36), P(rf * 0.42, 0.28), P(rf * 0.4, 0.2), P(rf - 0.02, 0.2), P(rf - 0.02, 0.3)], { material: o.rim, rotate: [0, 0, -90], segments: seg, caps: false }));
      kids.push(cyl("Vent_{i}", `${f(0.055)} * $r`, "0.12 * $w", { axis: "x", at: [X(0.3), `${f(rf * 0.6)} * $r`, 0], repeat: { count: 6, around: "x" }, segments: 10, material: "trim_black" }));
      kids.push(cyl("Cap", `${f(rf * 0.42)} * $r`, "0.14 * $w", { axis: "x", at: [X(0.35), 0, 0], segments: 20, material: hub, bevel: 0.01 }));
      break;
    }
    case "chrome": {
      kids.push(cyl("Hubcap", `${f(rf - 0.02)} * $r`, "0.1 * $w", { axis: "x", at: [X(0.35), 0, 0], segments: seg, material: hub, bevel: 0.012 }));
      kids.push(ellipsoid("Dome", ["0.14 * $w", `${f(rf * 0.5)} * $r`, `${f(rf * 0.5)} * $r`], { at: [X(0.4), 0, 0], segments: 20, material: hub }));
      break;
    }
    case "wire": {
      const n = o.spokes ?? 24;
      kids.push(cyl("Spoke_{i}", `${f(0.012)} * $r`, `${f(rf - 0.12)} * $r`, { at: [X(0.1), `${f(0.08 + (rf - 0.12) / 2)} * $r`, 0], repeat: { count: n, around: "x" }, segments: 4, material: o.rim }));
      kids.push(cyl("Spinner", "0.13 * $r", "0.5 * $w", { axis: "x", at: [X(0.2), 0, 0], segments: 12, material: hub, bevel: 0.01 }));
      break;
    }
    case "truck": {
      kids.push(cyl("Disc", `${f(rf - 0.04)} * $r`, "0.08 * $w", { axis: "x", at: [X(0.25), 0, 0], segments: seg, material: o.rim }));
      kids.push(cyl("Hand_{i}", `${f(0.06)} * $r`, "0.1 * $w", { axis: "x", at: [X(0.27), `${f(rf * 0.62)} * $r`, 0], repeat: { count: 8, around: "x", phase: 22.5 }, segments: 10, material: "trim_black" }));
      kids.push(cyl("Boss", `${f(0.26)} * $r`, "0.3 * $w", { axis: "x", at: [X(0.32), 0, 0], segments: 20, material: hub, bevel: 0.01 }));
      kids.push(cyl("Nut_{i}", `${f(0.03)} * $r`, "0.36 * $w", { axis: "x", at: [X(0.33), `${f(0.18)} * $r`, 0], repeat: { count: 10, around: "x" }, segments: 6, material: "chrome" }));
      break;
    }
    case "disc": {
      kids.push(cyl("Disc", `${f(rf - 0.02)} * $r`, "0.12 * $w", { axis: "x", at: [X(0.36), 0, 0], segments: seg, material: o.rim, bevel: 0.01 }));
      kids.push(cyl("Cap", "0.12 * $r", "0.08 * $w", { axis: "x", at: [X(0.44), 0, 0], segments: 16, material: hub }));
      break;
    }
  }
  return group(name, kids, { at, vars: { r: o.r, w: o.w }, ...(extra.mirror ? { mirror: extra.mirror } : {}) });
}

/** A closed ring (torus-like) about y, from a circle of `minor` radius at `major` radius. */
export function ringProfile(major: Num, minor: number, steps = 8): [Num, Num][] {
  const out: [Num, Num][] = [];
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const c = Math.cos(a) * minor, sn = Math.sin(a) * minor;
    out.push([typeof major === "number" ? major + c : `${major} ${c < 0 ? "-" : "+"} ${f(Math.abs(c))}`, k === steps ? 0 : Math.round(sn * 10000) / 10000]);
  }
  return out;
}
