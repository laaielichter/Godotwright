/** Timber helpers for the props families. */
import type { SpecNode } from "../../kit.js";

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
