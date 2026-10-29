import { at } from "./num.js";
import { transformPoint, type ModelInfo, type PrimitiveInfo } from "./inspect.js";

type V3 = [number, number, number];

export interface PartBox {
  /** Node path. */
  path: string;
  /** The group this part belongs to in the views (a child of the root, or the node itself). */
  group: string;
  min: V3;
  max: V3;
  triangles: number;
}

export interface SeparatePart {
  /** The nodes that hang together but not with the rest. */
  nodes: string[];
  /** Distance in metres to the nearest part of the main body. */
  gap: number;
  /** True when the group touches the ground (y = 0). */
  grounded: boolean;
}

const sizeOf = (p: { min: V3; max: V3 }): V3 => [p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]];

/** One bounding box per node that holds geometry, in world space. */
export function partBoxes(info: ModelInfo): PartBox[] {
  const byNode = new Map<string, { min: V3; max: V3; triangles: number }>();
  for (const prim of info.primitives) {
    const entry = byNode.get(prim.nodeName) ?? { min: [Infinity, Infinity, Infinity] as V3, max: [-Infinity, -Infinity, -Infinity] as V3, triangles: 0 };
    for (let v = 0; v < prim.vertices; v++) {
      const p = transformPoint(prim.world, at(prim.positions, v * 3), at(prim.positions, v * 3 + 1), at(prim.positions, v * 3 + 2));
      for (let a = 0; a < 3; a++) {
        entry.min[a] = Math.min(at(entry.min, a), at(p, a));
        entry.max[a] = Math.max(at(entry.max, a), at(p, a));
      }
    }
    entry.triangles += prim.triangles;
    byNode.set(prim.nodeName, entry);
  }
  const roots = new Set(info.nodes.filter((n) => n.depth === 0).map((n) => n.path));
  // A model with one root node (the usual case) is shown by the parts under that root.
  const single = roots.size === 1 ? [...roots][0] : undefined;
  return [...byNode].map(([path, box]) => {
    const segments = path.split("/");
    const group = single !== undefined && segments.length > 1 ? segments.slice(0, 2).join("/") : segments.slice(0, 1).join("/");
    return { path, group, ...box };
  });
}

const gapBetween = (a: PartBox, b: PartBox): number => {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(0, at(a.min, k) - at(b.max, k), at(b.min, k) - at(a.max, k));
    sum += d * d;
  }
  return Math.sqrt(sum);
};

/**
 * Parts that do not touch the rest. Boxes are compared (so a gap inside a hollow shape is not seen), with a tolerance of
 * 1% of the model size. The group of touching parts with the biggest box is the main body; every other group is reported.
 */
export function separateParts(info: ModelInfo, boxes: PartBox[] = partBoxes(info)): SeparatePart[] {
  if (boxes.length < 2 || !info.bounds) return [];
  const diag = Math.hypot(...info.bounds.size);
  const tol = Math.max(0.03, 0.01 * diag);
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (gapBetween(boxes[i] as PartBox, boxes[j] as PartBox) <= tol) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  boxes.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  if (groups.size < 2) return [];
  // The main body is the group that takes up the most room (the volume of the box around the whole group).
  const volume = (members: number[]): number => {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const i of members) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(at(min, a), at((boxes[i] as PartBox).min, a));
      max[a] = Math.max(at(max, a), at((boxes[i] as PartBox).max, a));
    }
    return Math.max(max[0] - min[0], 1e-3) * Math.max(max[1] - min[1], 1e-3) * Math.max(max[2] - min[2], 1e-3);
  };
  const sorted = [...groups.values()].sort((a, b) => volume(b) - volume(a));
  const main = sorted[0] as number[];
  return sorted.slice(1).map((members) => {
    let gap = Infinity;
    for (const i of members) for (const j of main) gap = Math.min(gap, gapBetween(boxes[i] as PartBox, boxes[j] as PartBox));
    return {
      nodes: members.map((i) => (boxes[i] as PartBox).path),
      gap,
      grounded: members.some((i) => (boxes[i] as PartBox).min[1] <= tol),
    };
  });
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

interface ViewSpec {
  title: string;
  /** Which world axes run right and up in the picture, and which axis points at the viewer (larger is nearer when `nearer` is 1). */
  right: 0 | 1 | 2;
  up: 0 | 1 | 2;
  depth: 0 | 1 | 2;
  nearer: 1 | -1;
  /** Flip the up axis (the top view draws +z downwards, so the front of the model is at the bottom). */
  flipUp?: boolean;
  ground?: boolean;
}

function fillTriangle(
  grid: { cell: string[][]; depth: number[][] },
  letter: string,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  cols: number,
  rows: number,
): void {
  const minC = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxC = Math.min(cols - 1, Math.floor(Math.max(a[0], b[0], c[0])));
  const minR = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxR = Math.min(rows - 1, Math.floor(Math.max(a[1], b[1], c[1])));
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const put = (col: number, row: number, depth: number): void => {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    if (depth >= (grid.depth[row] as number[])[col]!) {
      (grid.depth[row] as number[])[col] = depth;
      (grid.cell[row] as string[])[col] = letter;
    }
  };
  // Cells whose centre lies inside the triangle ...
  if (Math.abs(det) > 1e-12) {
    for (let r = minR; r <= maxR; r++) {
      for (let col = minC; col <= maxC; col++) {
        const px = col + 0.5, py = r + 0.5;
        const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det;
        const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= 0 && l2 >= 0 && l3 >= 0) put(col, r, l1 * a[2] + l2 * b[2] + l3 * c[2]);
      }
    }
  }
  // ... and the cells along its edges, so thin triangles (a rail, a blade seen edge on) do not vanish.
  for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      put(Math.floor(p[0] + (q[0] - p[0]) * t), Math.floor(p[1] + (q[1] - p[1]) * t), p[2] + (q[2] - p[2]) * t);
    }
  }
}

/** One orthographic view as text: each character is a cell, filled with the letter of the part in front. */
function renderView(info: ModelInfo, spec: ViewSpec, letters: Map<string, string>, cellW: number): string[] {
  const bounds = info.bounds;
  if (!bounds) return [];
  const spanR = Math.max(bounds.size[spec.right], 1e-6), spanU = Math.max(bounds.size[spec.up], 1e-6);
  const rows = Math.max(1, Math.ceil(spanU / (cellW * 2)));
  const cols = Math.max(1, Math.ceil(spanR / cellW));
  const cellH = cellW * 2;
  const grid = { cell: Array.from({ length: rows }, () => new Array<string>(cols).fill(" ")), depth: Array.from({ length: rows }, () => new Array<number>(cols).fill(-Infinity)) };
  const project = (p: V3): [number, number, number] => {
    const x = (p[spec.right] - bounds.min[spec.right]) / cellW;
    const along = (p[spec.up] - bounds.min[spec.up]) / cellH;
    // Normally larger values are drawn higher up; a flipped axis grows downwards (the front of a model at the bottom of the top view).
    const y = spec.flipUp ? along : rows - along;
    return [x, y, p[spec.depth] * spec.nearer];
  };
  for (const prim of info.primitives as PrimitiveInfo[]) {
    const letter = letters.get(prim.nodeName) ?? "?";
    const pts: V3[] = [];
    for (let v = 0; v < prim.vertices; v++) pts.push(transformPoint(prim.world, at(prim.positions, v * 3), at(prim.positions, v * 3 + 1), at(prim.positions, v * 3 + 2)));
    for (let t = 0; t < prim.indices.length; t += 3) {
      fillTriangle(grid, letter, project(pts[at(prim.indices, t)] as V3), project(pts[at(prim.indices, t + 1)] as V3), project(pts[at(prim.indices, t + 2)] as V3), cols, rows);
    }
  }
  const lines = grid.cell.map((row) => row.join("").replace(/\s+$/, ""));
  if (spec.ground && bounds.min[1] <= 0 && bounds.max[1] > 0) {
    const row = Math.round(rows - (0 - bounds.min[1]) / cellH);
    if (row >= 0 && row < rows) {
      const line = (lines[row] ?? "").padEnd(cols, " ").split("");
      for (let c = 0; c < cols; c++) if (line[c] === " ") line[c] = "-";
      lines[row] = line.join("");
    }
  }
  return [spec.title, ...lines];
}

const f2 = (n: number): string => n.toFixed(2);

/** What a text-only reader needs to "see" a model: the parts with their boxes, three views and what floats. */
export function viewModel(info: ModelInfo, options: { width?: number; only?: "front" | "side" | "top" } = {}): string {
  if (!info.bounds) return `${info.file}: the file holds no geometry.\n`;
  const width = Math.min(120, Math.max(20, options.width ?? 48));
  const boxes = partBoxes(info);
  const groups = [...new Set(boxes.map((b) => b.group))];
  const letters = new Map<string, string>();
  groups.forEach((g, i) => boxes.filter((b) => b.group === g).forEach((b) => letters.set(b.path, LETTERS[i % LETTERS.length] as string)));

  const out: string[] = [];
  const [sx, sy, sz] = info.bounds.size;
  out.push(`${info.file}: ${info.triangles.toLocaleString("en-US")} triangles, ${info.nodes.length} nodes, size ${f2(sx)} x ${f2(sy)} x ${f2(sz)} m (x y z), lowest point y = ${f2(info.bounds.min[1])}`);
  out.push("");
  const views = {
    front: { title: "FRONT (from +z, the model's front; its left is on the right)", right: 0, up: 1, depth: 2, nearer: 1, ground: true },
    side: { title: "SIDE (from the right of the model; its front is on the right)", right: 2, up: 1, depth: 0, nearer: -1, ground: true },
    top: { title: "TOP (from above; the front is at the bottom)", right: 0, up: 2, depth: 1, nearer: 1, flipUp: true },
  } as const satisfies Record<string, ViewSpec>;
  // One scale for every view, so sizes compare across them. A character is about twice as tall as it is wide.
  const across = Math.max(sx, sz, 1e-6);
  const tall = Math.max(sy, sz, 1e-6);
  const cellW = Math.max(across / width, tall / (32 * 2));
  out.push(`Scale: 1 character = ${cellW.toFixed(cellW < 0.1 ? 3 : 2)} m wide and ${(cellW * 2).toFixed(cellW < 0.05 ? 3 : 2)} m tall, the same in every view.`, "");
  for (const name of ["front", "side", "top"] as const) {
    if (options.only && options.only !== name) continue;
    out.push(...renderView(info, views[name], letters, cellW), "");
  }

  out.push("PARTS (letter, node, size x y z in metres, lowest y):");
  groups.forEach((g, i) => {
    const members = boxes.filter((b) => b.group === g);
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const b of members) for (let a = 0; a < 3; a++) {
      min[a] = Math.min(at(min, a), at(b.min, a));
      max[a] = Math.max(at(max, a), at(b.max, a));
    }
    const size = sizeOf({ min, max });
    const tris = members.reduce((n, b) => n + b.triangles, 0);
    out.push(`  ${LETTERS[i % LETTERS.length]}  ${g}  ${f2(size[0])} x ${f2(size[1])} x ${f2(size[2])}  y ${f2(min[1])}..${f2(max[1])}  ${tris} triangles${members.length > 1 ? `, ${members.length} nodes` : ""}`);
  });

  const separate = separateParts(info, boxes);
  out.push("");
  if (separate.length === 0) out.push("CONNECTED: every part touches another part (compared by bounding boxes).");
  else {
    out.push("SEPARATE PARTS (they do not touch the main body, compared by bounding boxes):");
    for (const s of separate) {
      const names = s.nodes.length > 4 ? `${s.nodes.slice(0, 4).join(", ")} and ${s.nodes.length - 4} more` : s.nodes.join(", ");
      out.push(`  ${names}: ${f2(s.gap)} m from the rest${s.grounded ? " (stands on the ground)" : " (floats in the air)"}`);
    }
  }
  return `${out.join("\n")}\n`;
}
