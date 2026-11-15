/**
 * Rough stones for the props families: lumpy ellipsoids with flat fractures (`cuts`), set down so that their lowest
 * point touches the ground. A cut moves the lowest point of a stone, and it depends on the seed, so the depth is
 * measured here from the same shape the build makes (in unit space: the radii only scale it).
 */
import { fracturedEllipsoid, lumpyEllipsoid } from "../../../build/shapes.js";
import { ellipsoid, type NodeOpts, type Num, type SpecNode } from "../../kit.js";

/** How far below its centre a stone of radius 1 (in y) reaches: the depth to lift it by, per unit of its y radius. */
export function sink(seed: number, lumps: number, cuts: number, segments: number): number {
  const mesh = cuts > 0 ? fracturedEllipsoid(1, 1, 1, segments, lumps, seed, cuts, "m") : lumpyEllipsoid(1, 1, 1, segments, lumps, seed, "m");
  let low = 0;
  for (const p of mesh.prims.values()) for (let i = 1; i < p.positions.length; i += 3) low = Math.min(low, p.positions[i]!);
  return -low;
}

/** The index of copy $i within a cycle of p (the expression language has no modulo). */
export const cycle = (p: number): string => `($i - ${p} * floor($i / ${p}))`;

/**
 * An expression for the sink of copy $i of a repeat whose seed is seed(k) with k = $i modulo p (see cycle): a sum of
 * indicator terms, one per seed in the cycle (the expression language has no lookup tables). With count "fixed" the
 * repeat has at most p copies and $i is the index itself.
 */
export function sinkByIndex(p: number, seed: (k: number) => number, lumps: number, cuts: number, segments: number, o: { count?: "fixed" } = {}): string {
  // A repeat of a fixed count of at most p copies needs no cycle; round the sink up so no stone dips below y = 0.
  const index = o.count === "fixed" ? "$i" : cycle(p);
  const terms: string[] = [];
  for (let k = 0; k < p; k++) terms.push(`${(Math.ceil(sink(seed(k), lumps, cuts, segments) * 1000) / 1000).toFixed(3)} * clamp(1 - abs(${index} - ${k}), 0, 1)`);
  return `(${terms.join(" + ")})`;
}

/** A fractured stone: the kit's ellipsoid with `cuts` (0-24) added. */
export function stone(name: string, radii: [Num, Num, Num], o: NodeOpts & { segments?: Num; lumps?: Num; seed?: Num; cuts: number }): SpecNode {
  const { cuts, ...rest } = o;
  return { ...ellipsoid(name, radii, rest), cuts } as SpecNode;
}
