/**
 * Small-boat hull sections for the boat families: a V hull with chines, a sheer that rises to the bow and a keel that
 * lifts out of the water at the stem. The waterline is y = 0. Sections use $L2 (half length), $B2 (half beam),
 * $fb (freeboard at the transom) and $d (draught).
 */
import type { Num } from "../../kit.js";
import { f } from "./parts.js";

export interface HullShape {
  /** Beam at the transom as a fraction of the widest beam. */
  transom: number;
  /** How far the sheer rises at the bow (fraction of the freeboard). */
  sheerRise: number;
  /** Keel height at the stem as a fraction of the freeboard (above the water). */
  stemRise: number;
  /** Deadrise: 0 = flat bottom, 1 = deep V. */
  vee: number;
  /** Round bilge (no hard chine), as on a clinker rowing boat. */
  round?: boolean;
  /** Beam at the stem as a fraction of the beam. */
  stem?: number;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

export function beamAt(h: HullShape, s: number): number {
  if (s <= 0.45) return h.transom + (1 - h.transom) * smooth(s / 0.45);
  const u = (s - 0.45) / 0.55;
  return 1 - (1 - (h.stem ?? 0.07)) * Math.pow(u, 1.8);
}

/** The keel (y) as a mix of draught and freeboard: [draught factor, freeboard factor]. */
export function keelAt(h: HullShape, s: number): [number, number] {
  if (s <= 0.55) return [-(0.82 + 0.18 * smooth(s / 0.55)), 0];
  const u = smooth((s - 0.55) / 0.45);
  return [-(1 - u), u * h.stemRise];
}

export function sheerAt(h: HullShape, s: number): number {
  return 1 + h.sheerRise * s * s;
}

/** The outer outline of a section at s (0 = transom, 1 = stem), from the left sheer round the keel to the right sheer. */
export function outline(h: HullShape, s: number, lift = 0): [Num, Num][] {
  const bw = beamAt(h, s);
  const [kd, kf] = keelAt(h, s);
  const sh = sheerAt(h, s) + lift;
  const keel = `${f(kd)} * $d + ${f(kf)} * $fb`;
  const top = `${f(sh)} * $fb`;
  const y = (t: number): string => `${keel} + (${top} - (${keel})) * ${f(t)}`;
  const pts: [number, number][] = h.round
    ? [[1, 1], [0.995, 0.75], [0.97, 0.5], [0.9, 0.3], [0.75, 0.16], [0.5, 0.06], [0.22, 0.012]]
    : [[1, 1], [0.985, 0.55], [0.96, 0.3 * (1 - 0.3 * h.vee)], [0.86, 0.26 * (1 - 0.3 * h.vee) * 0.92], [0.45, 0.12 * h.vee + 0.02], [0.15, 0.03 * h.vee + 0.004]];
  const half: [Num, Num][] = pts.map(([x, t]) => [`${f(x * bw)} * $B2`, y(t)]);
  return [...half, [0, y(0)], ...[...half].reverse().map(([x, yy]) => [`-${x}`, yy] as [Num, Num])];
}

/** An open shell section: the outer outline, then the inner one back (thickness th), so the hull is open on top. */
export function shellSection(h: HullShape, s: number, th: string): { z: string; points: [Num, Num][] } {
  const out = outline(h, s);
  const inner = [...out].reverse().map(([x, y], i, arr) => {
    const top = i === 0 || i === arr.length - 1;
    if (x === 0) return [0, `${y} + ${th}`] as [Num, Num];
    const sx = typeof x === "string" && x.startsWith("-") ? 1 : -1;
    return [`${x} ${sx > 0 ? "+" : "-"} ${th}`, top ? y : `${y} + ${th}`] as [Num, Num];
  });
  return { z: `-$L2 + ${f(2 * s)} * $L2`, points: [...out, ...inner] };
}

export function solidSection(h: HullShape, s: number): { z: string; points: [Num, Num][] } {
  return { z: `-$L2 + ${f(2 * s)} * $L2`, points: outline(h, s) };
}
