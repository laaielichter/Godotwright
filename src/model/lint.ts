import { checkArchetype } from "../archetype/check.js";
import type { ResolvedArchetype } from "../archetype/types.js";
import { checkContract, type ModelContract } from "./contract.js";
import { inspectModel, transformPoint, type ModelInfo, type PrimitiveInfo } from "./inspect.js";
import { at } from "./num.js";
import { MODEL_CATEGORIES, MODEL_RULES, MODEL_WEIGHTS, type ModelCategory, type ModelFinding, type ModelSeverity } from "./rules.js";

export interface LintOptions {
  /** Triangle budget for the whole file; no check when undefined. */
  maxTriangles?: number;
  /** Texture memory budget in MB; default 512. */
  maxTextureMb?: number;
  /** Node names, sizes and budget the model must keep. */
  contract?: ModelContract;
  /** What the model should be (see `model identify`): adds the archetype checks and category. */
  archetype?: ResolvedArchetype;
}

export interface ModelCategoryScore {
  category: ModelCategory;
  score: number;
  errors: number;
  warnings: number;
  infos: number;
}

export interface ModelReport {
  file: string;
  triangles: number;
  nodes: number;
  overall: number;
  /** The archetype id the model was checked against, when one was given. */
  archetype?: string;
  categories: ModelCategoryScore[];
  findings: ModelFinding[];
}

const PENALTY: Record<ModelSeverity, number> = { error: 12, warning: 4, info: 1 };
const RULE_CAP = 30;

export function lintModelFile(file: string, options: LintOptions = {}): ModelReport {
  return lintModel(inspectModel(file), options);
}

export function lintModel(info: ModelInfo, options: LintOptions = {}): ModelReport {
  const findings: ModelFinding[] = [];
  const add: Add = (rule, message, node, severity) => {
    const def = MODEL_RULES[rule];
    if (def) findings.push({ rule, category: def.category, severity: severity ?? def.severity, file: info.file, ...(node ? { node } : {}), message });
  };

  if (info.triangles === 0) add("model/empty-geometry", "The file holds no triangles.");
  checkRig(info, add);
  const uvReported = new Set<string>();
  const sheet = options.archetype?.sheet === true;
  for (const prims of primitivesByNode(info.primitives)) checkNode(info, prims, add, uvReported, sheet);
  checkTextures(info, options, add);
  checkSymmetry(info, add);
  if (options.contract) findings.push(...checkContract(info, options.contract));
  if (options.archetype && options.archetype.id !== "thing") findings.push(...checkArchetype(info, options.archetype));

  if (options.maxTriangles !== undefined && info.triangles > options.maxTriangles) {
    add("model/triangle-budget", `${info.triangles.toLocaleString("en-US")} triangles; the budget is ${options.maxTriangles.toLocaleString("en-US")}.`);
  }
  if (info.materials.length > 32) add("model/many-materials", `${info.materials.length} materials; every one costs a draw call.`);

  const order: Record<ModelSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule));
  const checked = options.archetype !== undefined && options.archetype.id !== "thing";
  const categories = (checked ? [...MODEL_CATEGORIES, "archetype" as const] : MODEL_CATEGORIES).map((c) => score(c, findings));
  // With an archetype check, it takes a fifth of the score and the other categories share the rest.
  const weight = (c: ModelCategory): number => (!checked ? MODEL_WEIGHTS[c] : c === "archetype" ? MODEL_WEIGHTS.archetype : MODEL_WEIGHTS[c] * (1 - MODEL_WEIGHTS.archetype));
  const overall = Math.round(categories.reduce((sum, c) => sum + c.score * weight(c.category), 0));
  return { file: info.file, triangles: info.triangles, nodes: info.nodes.length, overall, ...(checked && options.archetype ? { archetype: options.archetype.id } : {}), categories, findings };
}

type Add = (rule: string, message: string, node?: string, severity?: ModelSeverity) => void;

function checkRig(info: ModelInfo, add: Add): void {
  const seen = new Set<string>();
  for (const n of info.nodes) {
    if (/^node_\d+$/.test(n.name)) add("model/unnamed-node", `Node ${n.index} has no name.`, n.path);
    if (seen.has(n.path)) add("model/duplicate-node-names", `Another node at ${n.path} has the same name.`, n.path);
    seen.add(n.path);
    if (n.mirrored) add("model/mirrored-node", `Scale ${n.scale.map((v) => v.toFixed(2)).join(", ")} mirrors this node and everything under it.`, n.path);
  }
  if (info.bounds && info.triangles > 0 && Math.abs(info.bounds.min[1]) > 0.05) {
    add("model/ground-offset", `The lowest point is at y = ${info.bounds.min[1].toFixed(3)}.`);
  }
}

interface EdgeStats {
  edges: number;
  open: number;
  flipped: number;
  /** Triangles that face against their own vertex normals (the visible kind of flip). */
  againstNormals: number;
  triangles: number;
  nonManifold: number;
  degenerate: number;
}

/** The primitives of each node, in file order. A mesh's parts join each other, so they are checked together. */
function primitivesByNode(prims: PrimitiveInfo[]): PrimitiveInfo[][] {
  const groups = new Map<number, PrimitiveInfo[]>();
  for (const prim of prims) {
    const group = groups.get(prim.node);
    if (group) group.push(prim);
    else groups.set(prim.node, [prim]);
  }
  return [...groups.values()];
}

/** Checks one node: its primitives are welded together, so a closed mesh split by material is still closed. */
function checkNode(info: ModelInfo, prims: PrimitiveInfo[], add: Add, uvReported: Set<string>, sheet: boolean): void {
  const node = prims[0]?.nodeName ?? "";
  if (prims.some((p) => !p.hasNormals)) add("model/missing-normals", "The mesh has no NORMAL data.", node);
  for (const prim of prims) {
    const mat = prim.material === undefined ? undefined : info.materials[prim.material];
    if (mat?.textured && !prim.hasUv) add("model/missing-uv", `Material "${mat.name}" uses a texture, but the mesh has no TEXCOORD_0.`, node);
    if (mat?.normalMapped && !prim.hasTangents) add("model/missing-tangents", `Material "${mat.name}" has a normal map, but the mesh has no TANGENT data.`, node);
    // UVs outside 0..1 only matter when a texture is sampled with them.
    if (prim.uvOutOfRange && mat?.textured && !uvReported.has(node)) {
      uvReported.add(node);
      add("model/uv-out-of-range", "Some UVs lie outside 0..1.", node);
    }
  }
  const edges = analyseEdges(prims, sheet);
  const triangles = prims.reduce((n, p) => n + p.triangles, 0);
  const againstNormals = prims.reduce((n, p) => n + trianglesAgainstNormals(p), 0);
  reportEdges(node, { ...edges, triangles, againstNormals }, add);
}

/** One finding per node and rule; the severity follows how much of the surface is affected. */
function reportEdges(node: string, e: EdgeStats, add: Add): void {
  const pct = (n: number, of: number) => `${((n / Math.max(of, 1)) * 100).toFixed(2)}%`;
  const severity = (ratio: number): ModelSeverity => (ratio >= 0.01 ? "error" : ratio >= 0.0005 ? "warning" : "info");
  if (e.againstNormals > 0) {
    add("model/flipped-faces", `${e.againstNormals.toLocaleString("en-US")} triangles (${pct(e.againstNormals, e.triangles)}) face against their own normals, so they light wrong and show as backfaces.`, node, severity(e.againstNormals / Math.max(e.triangles, 1)));
  }
  if (e.flipped > 0) {
    add("model/flipped-faces", `${e.flipped.toLocaleString("en-US")} edges (${pct(e.flipped, e.edges)}) join triangles that face opposite ways (the mesh has no normals to compare with).`, node, severity(e.flipped / Math.max(e.edges, 1)));
  }
  if (e.open > 0) {
    const ratio = e.open / Math.max(e.edges, 1);
    add("model/open-edges", `${e.open.toLocaleString("en-US")} open edges (${pct(e.open, e.edges)}) on a single-sided surface; seen from behind it is see-through.`, node, ratio >= 0.01 ? "warning" : "info");
  }
  if (e.nonManifold > 0) add("model/non-manifold", `${e.nonManifold.toLocaleString("en-US")} edges are shared by more than two triangles.`, node);
  if (e.degenerate > 0) add("model/degenerate-triangles", `${e.degenerate.toLocaleString("en-US")} triangles have no area.`, node);
}

/** Counts triangles whose geometric normal points against the sum of their vertex normals. */
export function trianglesAgainstNormals(prim: PrimitiveInfo): number {
  const n = prim.normals;
  if (!n) return 0;
  const p = prim.positions;
  let count = 0;
  for (let t = 0; t < prim.indices.length; t += 3) {
    const i = at(prim.indices, t) * 3, j = at(prim.indices, t + 1) * 3, k = at(prim.indices, t + 2) * 3;
    const ux = at(p, j) - at(p, i), uy = at(p, j + 1) - at(p, i + 1), uz = at(p, j + 2) - at(p, i + 2);
    const vx = at(p, k) - at(p, i), vy = at(p, k + 1) - at(p, i + 1), vz = at(p, k + 2) - at(p, i + 2);
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * gx + gy * gy + gz * gz < 1e-18) continue;
    const dot = gx * (at(n, i) + at(n, j) + at(n, k)) + gy * (at(n, i + 1) + at(n, j + 1) + at(n, k + 1)) + gz * (at(n, i + 2) + at(n, j + 2) + at(n, k + 2));
    if (dot < 0) count++;
  }
  return count;
}

/**
 * Welds vertices by position across the primitives of one node and counts edge problems.
 * With `sheet`, an open edge that lies on the outer border of the surface (along x or z) is expected and not counted:
 * a terrain tile or a water plane ends there, and its neighbour continues it.
 */
export function analyseEdges(prims: PrimitiveInfo[], sheet = false): { edges: number; open: number; flipped: number; nonManifold: number; degenerate: number } {
  const weld = new Map<string, number>();
  /** x and z of each welded vertex, to tell border edges from holes. */
  const gx: number[] = [], gz: number[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  // Every primitive of a node shares the node's transform, so their local positions can be welded together.
  const ids = prims.map((prim) => {
    const id = new Uint32Array(prim.vertices);
    for (let v = 0; v < prim.vertices; v++) {
      const x = at(prim.positions, v * 3), z = at(prim.positions, v * 3 + 2);
      const key = `${Math.round(x * 1e5)},${Math.round(at(prim.positions, v * 3 + 1) * 1e5)},${Math.round(z * 1e5)}`;
      let w = weld.get(key);
      if (w === undefined) { w = weld.size; weld.set(key, w); gx.push(x); gz.push(z); }
      id[v] = w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return id;
  });
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;
  const onBorder = (a: number, b: number): boolean => {
    const ax = at(gx, a), bx = at(gx, b), az = at(gz, a), bz = at(gz, b);
    return (near(ax, minX) && near(bx, minX)) || (near(ax, maxX) && near(bx, maxX)) || (near(az, minZ) && near(bz, minZ)) || (near(az, maxZ) && near(bz, maxZ));
  };
  // value = uses * 16 + flags: 1 low->high, 2 high->low (the direction), 4 a use from a double-sided primitive, 8 a use from one with normals
  const edges = new Map<number, number>();
  const stride = 67108864;
  let degenerate = 0;
  prims.forEach((prim, p) => {
    const id = ids[p] as Uint32Array;
    const flags = (prim.doubleSided ? 4 : 0) | (prim.hasNormals ? 8 : 0);
    for (let t = 0; t < prim.indices.length; t += 3) {
      const a = at(id, at(prim.indices, t));
      const b = at(id, at(prim.indices, t + 1));
      const c = at(id, at(prim.indices, t + 2));
      if (a === b || b === c || a === c) { degenerate++; continue; }
      for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
        const key = Math.min(from, to) * stride + Math.max(from, to);
        const dir = from < to ? 1 : 2;
        const old = edges.get(key) ?? 0;
        edges.set(key, (Math.floor(old / 16) + 1) * 16 + ((old % 16) | flags | dir));
      }
    }
  });
  let open = 0, flipped = 0, nonManifold = 0;
  for (const [key, value] of edges) {
    const uses = Math.floor(value / 16);
    const mask = value % 4;
    if (uses === 1) {
      // Only a single-sided surface has holes: seen from behind, a double-sided one is still closed.
      if ((value & 4) === 0 && !(sheet && onBorder(Math.floor(key / stride), key % stride))) open++;
    }
    else if (uses === 2 && mask !== 3 && (value & 8) === 0) flipped++;
    else if (uses > 2) nonManifold++;
  }
  return { edges: edges.size, open, flipped, nonManifold, degenerate };
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function checkTextures(info: ModelInfo, options: LintOptions, add: Add): void {
  for (const t of info.textures) {
    if (t.width === undefined || t.height === undefined) continue;
    if (Math.max(t.width, t.height) > 4096) add("model/texture-size", `${t.name} is ${t.width}x${t.height}.`);
    if (!isPowerOfTwo(t.width) || !isPowerOfTwo(t.height)) add("model/texture-not-power-of-two", `${t.name} is ${t.width}x${t.height}.`);
  }
  const mb = info.textures.reduce((n, t) => n + t.megabytes, 0);
  const budget = options.maxTextureMb ?? 512;
  if (mb > budget) add("model/texture-memory", `About ${mb.toFixed(0)} MB of textures (uncompressed estimate); the budget is ${budget} MB.`);
}

const SYMMETRY_SAMPLE = 200_000;

/** Reports models that are nearly mirror-symmetric in x, but with a few vertices that have no partner. */
function checkSymmetry(info: ModelInfo, add: Add): void {
  const b = info.bounds;
  if (!b || info.triangles === 0) return;
  const centre = (b.min[0] + b.max[0]) / 2;
  if (Math.abs(centre) > b.size[0] * 0.05) return;
  const tol = Math.max(b.size[0], b.size[1], b.size[2]) * 0.0005;
  const cell = tol * 2;
  const grid = new Map<string, true>();
  const key = (x: number, y: number, z: number) => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  const points: [number, number, number][] = [];
  for (const prim of info.primitives) {
    for (let v = 0; v < prim.vertices; v++) {
      const p = transformPoint(prim.world, at(prim.positions, v * 3), at(prim.positions, v * 3 + 1), at(prim.positions, v * 3 + 2));
      points.push(p);
      grid.set(key(p[0], p[1], p[2]), true);
    }
  }
  const step = Math.max(1, Math.floor(points.length / SYMMETRY_SAMPLE));
  let total = 0, matched = 0;
  const near = (x: number, y: number, z: number): boolean => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (grid.has(key(x + dx * cell, y + dy * cell, z + dz * cell))) return true;
    }
    return false;
  };
  for (let i = 0; i < points.length; i += step) {
    const p = points[i] as [number, number, number];
    total++;
    if (near(2 * centre - p[0], p[1], p[2])) matched++;
  }
  const share = matched / total;
  if (share >= 0.6 && share < 0.999) {
    add("model/asymmetry", `${((1 - share) * 100).toFixed(1)}% of the vertices have no mirror partner within ${(tol * 1000).toFixed(1)} mm, while the rest matches (left and right should be equal).`);
  }
}

function score(category: ModelCategory, findings: ModelFinding[]): ModelCategoryScore {
  const mine = findings.filter((f) => f.category === category);
  const perRule = new Map<string, number>();
  for (const f of mine) perRule.set(f.rule, Math.min(RULE_CAP, (perRule.get(f.rule) ?? 0) + PENALTY[f.severity]));
  const value = 100 - [...perRule.values()].reduce((a, b) => a + b, 0);
  return {
    category,
    score: Math.max(0, Math.round(value)),
    errors: mine.filter((f) => f.severity === "error").length,
    warnings: mine.filter((f) => f.severity === "warning").length,
    infos: mine.filter((f) => f.severity === "info").length,
  };
}

