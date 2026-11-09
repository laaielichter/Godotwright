import { at } from "../model/num.js";
import { MeshBuilder, UV_PER_METER, add, cross, dot, length, normalize, projectUv, sub, type V3 } from "./mesh.js";

/** A box from its two corners, all six faces facing out. */
export function box(min: V3, max: V3, material: string): MeshBuilder {
  const b = new MeshBuilder();
  const centre: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  b.convexFace([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], centre, material);
  b.convexFace([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], centre, material);
  b.convexFace([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], centre, material);
  b.convexFace([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], centre, material);
  b.convexFace([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], centre, material);
  b.convexFace([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], centre, material);
  return b;
}

type P2 = [number, number];

function signedArea(poly: P2[]): number {
  let a = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] as P2;
    a += p[0] * q[1] - q[0] * p[1];
  });
  return a / 2;
}

/** Ear clipping for a simple polygon with positive signed area in (x, z). Returns index triples. */
export function triangulate(poly: P2[]): [number, number, number][] {
  const ids = poly.map((_, i) => i);
  const out: [number, number, number][] = [];
  const cross2 = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = poly.length * poly.length;
  while (ids.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < ids.length; i++) {
      const ia = ids[(i + ids.length - 1) % ids.length] as number;
      const ib = ids[i] as number;
      const ic = ids[(i + 1) % ids.length] as number;
      const a = poly[ia] as P2, b = poly[ib] as P2, c = poly[ic] as P2;
      if (cross2(a, b, c) <= 1e-12) continue;
      const inside = ids.some((id) => {
        if (id === ia || id === ib || id === ic) return false;
        const p = poly[id] as P2;
        return cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
      });
      if (inside) continue;
      out.push([ia, ib, ic]);
      ids.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (ids.length === 3) out.push([ids[0] as number, ids[1] as number, ids[2] as number]);
  return out;
}

/** A prism from a floor plan (x, z points, either direction) between two heights; walls and both caps. */
export function extrude(plan: P2[], y0: number, y1: number, material: string): MeshBuilder {
  const poly = signedArea(plan) >= 0 ? plan : [...plan].reverse();
  const b = new MeshBuilder();
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] as P2;
    // With positive area the outside lies to the right of p -> q, so the quad runs q, p, p', q'.
    b.quad([q[0], y0, q[1]], [p[0], y0, p[1]], [p[0], y1, p[1]], [q[0], y1, q[1]], material);
  });
  for (const [i, j, k] of triangulate(poly)) {
    const a = poly[i] as P2, c = poly[j] as P2, d = poly[k] as P2;
    b.tri([a[0], y1, a[1]], [d[0], y1, d[1]], [c[0], y1, c[1]], material);
    b.tri([a[0], y0, a[1]], [c[0], y0, c[1]], [d[0], y0, d[1]], material);
  }
  return b;
}

export interface RoofOptions {
  /** Footprint of the eaves (include the overhang), in x and z. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Height of the eaves and the rise to the ridge. */
  y: number;
  rise: number;
  /** "gable": two slopes and two triangular ends. "hip": four slopes. */
  kind: "gable" | "hip";
  material: string;
}

/** A solid roof (closed underneath) with its ridge along the longer side. */
export function roof(o: RoofOptions): MeshBuilder {
  const b = new MeshBuilder();
  const alongZ = o.z1 - o.z0 >= o.x1 - o.x0;
  // Local coordinates: s runs along the ridge, t across it.
  const s0 = alongZ ? o.z0 : o.x0, s1 = alongZ ? o.z1 : o.x1;
  const t0 = alongZ ? o.x0 : o.z0, t1 = alongZ ? o.x1 : o.z1;
  const map = (s: number, t: number, y: number): V3 => (alongZ ? [t, y, s] : [s, y, t]);
  const tm = (t0 + t1) / 2;
  const inset = o.kind === "hip" ? Math.min((t1 - t0) / 2, (s1 - s0) / 2) : 0;
  const yr = o.y + o.rise;
  const centre = map((s0 + s1) / 2, tm, o.y + o.rise / 3);
  const r0 = map(s0 + inset, tm, yr), r1 = map(s1 - inset, tm, yr);
  const c00 = map(s0, t0, o.y), c01 = map(s0, t1, o.y), c10 = map(s1, t0, o.y), c11 = map(s1, t1, o.y);
  const ridgeIsPoint = length(sub(r0, r1)) < 1e-9;
  b.convexFace([c00, c01, c11, c10], centre, o.material);
  if (ridgeIsPoint) {
    for (const [p, q] of [[c00, c01], [c01, c11], [c11, c10], [c10, c00]] as const) b.convexFace([p, q, r0], centre, o.material);
    return b;
  }
  b.convexFace([c00, c10, r1, r0], centre, o.material);
  b.convexFace([c01, c11, r1, r0], centre, o.material);
  b.convexFace([c00, c01, r0], centre, o.material);
  b.convexFace([c10, c11, r1], centre, o.material);
  return b;
}

export interface SurfaceOptions {
  material: string;
  /** Close the first and last ring with a flat cap (default true). */
  caps?: boolean;
}

/**
 * Smooth surface through rings of points. Every ring has the same number of points and is
 * closed around (the last point connects to the first). Normals are averaged between
 * neighbouring faces, and the whole shell is flipped if it was built inside out.
 */
export function ringSurface(rings: V3[][], options: SurfaceOptions): MeshBuilder {
  const b = new MeshBuilder();
  const n = rings[0]?.length ?? 0;
  if (rings.length < 2 || n < 3) return b;
  const grid = (i: number, j: number): V3 => (rings[i] as V3[])[((j % n) + n) % n] as V3;

  const faceNormal = (i: number, j: number): V3 => {
    const a = grid(i, j), c = grid(i + 1, j + 1);
    return cross(sub(grid(i + 1, j), a), sub(c, a));
  };
  // The two triangles of the quad at stripe i (between ring i and i + 1), column j.
  const quadNormal = (i: number, j: number): V3 => add(faceNormal(i, j), cross(sub(grid(i + 1, j + 1), grid(i, j)), sub(grid(i, j + 1), grid(i, j))));
  /** Smooth normal of ring r at column j, as seen from stripe s: neighbouring columns are always blended, the other stripe only when the angle is gentle. */
  const normalFor = (r: number, j: number, s: number): V3 => {
    const own = normalize(add(quadNormal(s, j - 1), quadNormal(s, j)));
    const o = s === r ? r - 1 : r;
    if (o < 0 || o >= rings.length - 1) return own;
    const other = normalize(add(quadNormal(o, j - 1), quadNormal(o, j)));
    return dot(own, other) > 0.5 ? normalize(add(own, other)) : own;
  };

  // Arc length along each ring and between rings gives even texture density.
  const along: number[] = [0];
  for (let i = 1; i < rings.length; i++) along.push(at(along, i - 1) + length(sub(grid(i, 0), grid(i - 1, 0))));
  const ringLength = (i: number): number => rings[i]!.reduce((acc, _, j) => acc + length(sub(grid(i, j + 1), grid(i, j))), 0);

  const p = b.prim(options.material);
  // Each stripe has its own two rows of vertices, so a sharp edge between stripes keeps a sharp edge.
  const row = (r: number, s: number): number[] => {
    const total = ringLength(r);
    let run = 0;
    const out: number[] = [];
    for (let j = 0; j <= n; j++) {
      const point = grid(r, j);
      if (j > 0) run += length(sub(point, grid(r, j - 1)));
      out.push(b.vertex(p, point, normalFor(r, j, s), [(run || (j === n ? total : 0)) * UV_PER_METER, -at(along, r) * UV_PER_METER]));
    }
    return out;
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    const top = row(i, i);
    const bottom = row(i + 1, i);
    for (let j = 0; j < n; j++) {
      const a = top[j] as number, c = top[j + 1] as number;
      const d = bottom[j] as number, e = bottom[j + 1] as number;
      const degenerateStart = length(sub(grid(i, j), grid(i, j + 1))) < 1e-9;
      const degenerateEnd = length(sub(grid(i + 1, j), grid(i + 1, j + 1))) < 1e-9;
      if (!degenerateStart) p.indices.push(a, d, c);
      if (!degenerateEnd) p.indices.push(c, d, e);
    }
  }
  // The side faces first: flip them if they face inwards, judged against the centre of all points.
  const all = rings.flat();
  const middle = all.reduce<V3>((sum, q) => add(sum, [q[0] / all.length, q[1] / all.length, q[2] / all.length]), [0, 0, 0]);
  let facing = 0;
  for (let v = 0; v < p.positions.length; v += 3) {
    facing += dot([at(p.normals, v), at(p.normals, v + 1), at(p.normals, v + 2)], sub([at(p.positions, v), at(p.positions, v + 1), at(p.positions, v + 2)], middle));
  }
  if (facing < 0) flipShell(p.normals, p.indices);

  if (options.caps !== false) {
    for (const [i, next] of [[0, 1], [rings.length - 1, rings.length - 2]] as const) {
      const ring = rings[i] as V3[];
      const centre = ringCentre(ring);
      if (ring.every((q) => length(sub(q, centre)) < 1e-9)) continue;
      const capNormal = ringNormal(ring, sub(centre, ringCentre(rings[next] as V3[])));
      const verts = ring.map((q) => b.vertex(p, q, capNormal, projectCapUv(q, capNormal)));
      for (const [j, k, l] of capTriangles(ring, capNormal)) p.indices.push(verts[j] as number, verts[k] as number, verts[l] as number);
    }
  }
  return b;
}

/**
 * Triangles that cover a flat ring, concave or not, all facing the way `normal` points. The ring is
 * ear-clipped in the plane that drops the normal's largest component, so it keeps its own outline.
 */
function capTriangles(ring: V3[], normal: V3): [number, number, number][] {
  const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2]);
  const [u, v] = ax >= ay && ax >= az ? ([1, 2] as const) : ay >= az ? ([0, 2] as const) : ([0, 1] as const);
  const flat: P2[] = ring.map((q): P2 => [q[u], q[v]]);
  const order = signedArea(flat) >= 0 ? flat.map((_, i) => i) : flat.map((_, i) => flat.length - 1 - i);
  const point = (k: number): V3 => ring[k] as V3;
  return triangulate(order.map((i) => flat[i] as P2)).map(([a, b, c]): [number, number, number] => {
    const i = order[a] as number, j = order[b] as number, k = order[c] as number;
    return dot(cross(sub(point(j), point(i)), sub(point(k), point(i))), normal) >= 0 ? [i, j, k] : [i, k, j];
  });
}

/**
 * The normal of a flat ring, from its own points (Newell's method), turned to point the way `towards` does.
 * A ring of a loft need not be parallel to the next one, so the direction between centres is not its normal.
 */
function ringNormal(ring: V3[], towards: V3): V3 {
  let sum: V3 = [0, 0, 0];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] as V3;
    sum = add(sum, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
  });
  const unit = normalize(sum);
  return dot(unit, towards) < 0 ? [-unit[0], -unit[1], -unit[2]] : unit;
}

function ringCentre(ring: V3[]): V3 {
  return ring.reduce<V3>((s, q) => add(s, [q[0] / ring.length, q[1] / ring.length, q[2] / ring.length]), [0, 0, 0]);
}

function projectCapUv(p: V3, n: V3): [number, number] {
  return projectUv(p, n);
}

/** Reverses the triangles and normals of a shell. */
function flipShell(normals: number[], indices: number[]): void {
  for (let t = 0; t < indices.length; t += 3) {
    const second = at(indices, t + 1);
    indices[t + 1] = at(indices, t + 2);
    indices[t + 2] = second;
  }
  for (let i = 0; i < normals.length; i++) normals[i] = -at(normals, i);
}

/**
 * Turns a profile of (radius, height) points into a surface of revolution around the y axis:
 * wheels, tanks, masts, trunks. A radius of 0 at either end closes the shape to a point.
 */
export function lathe(profile: [number, number][], segments: number, material: string, caps = true): MeshBuilder {
  const rings = profile.map(([r, y]) =>
    Array.from({ length: segments }, (_, k): V3 => {
      const angle = (k / segments) * Math.PI * 2;
      return [r * Math.cos(angle), y, r * Math.sin(angle)];
    }),
  );
  return ringSurface(rings, { material, caps });
}

/** A cylinder standing on y0 (radius r, height h). */
export function cylinder(r: number, y0: number, h: number, segments: number, material: string): MeshBuilder {
  return lathe([[r, y0], [r, y0 + h]], segments, material, true);
}

/** A sphere or ellipsoid with radii (rx, ry, rz) centred at the origin. */
export function ellipsoid(rx: number, ry: number, rz: number, segments: number, material: string): MeshBuilder {
  const rows = Math.max(4, Math.round(segments / 2));
  const rings: V3[][] = [];
  for (let i = 0; i <= rows; i++) {
    const phi = (i / rows) * Math.PI;
    rings.push(
      Array.from({ length: segments }, (_, k): V3 => {
        const angle = (k / segments) * Math.PI * 2;
        return [rx * Math.sin(phi) * Math.cos(angle), ry * Math.cos(phi), rz * Math.sin(phi) * Math.sin(angle)];
      }),
    );
  }
  return ringSurface(rings, { material, caps: false });
}

/**
 * A box with rounded edges and corners of radius `radius` (clamped to half the smallest side). Flat faces stay flat;
 * the rounded strips have smooth normals, so the edges catch the light. `steps` rows per half edge (2 = 4 rows per edge).
 */
export function roundedBox(min: V3, max: V3, radius: number, material: string, steps = 2): MeshBuilder {
  const half: V3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
  const centre: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const r = Math.min(radius, half[0], half[1], half[2]);
  if (!(r > 1e-6)) return box(min, max, material);
  const inner: V3 = [half[0] - r, half[1] - r, half[2] - r];
  /** Sample points along one axis of a face: the rounded strip at each end at even angles, the flat part between. */
  const samples = (axis: 0 | 1 | 2): number[] => {
    const c = at(inner, axis);
    // The last row is the face of the box itself (tan(pi / 4) is not exactly 1), so neighbouring faces meet exactly.
    const edge = Array.from({ length: steps }, (_, k) => (k + 1 === steps ? at(half, axis) : c + r * Math.tan((((k + 1) / steps) * Math.PI) / 4)));
    const out = [...edge.map((v) => -v).reverse(), -c, c, ...edge];
    return out.filter((v, i) => i === 0 || Math.abs(v - (out[i - 1] as number)) > 1e-9);
  };
  const b = new MeshBuilder();
  const p = b.prim(material);
  // For a face along axis a, axes (u, v) are chosen so that u x v points along +a.
  const faces: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2][] = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
  for (const [a, u, v] of faces) {
    const su = samples(u), sv = samples(v);
    for (const sign of [1, -1]) {
      const faceNormal: V3 = [0, 0, 0];
      faceNormal[a] = sign;
      const ids: number[][] = su.map((pu) =>
        sv.map((pv) => {
          const q: V3 = [0, 0, 0];
          q[a] = sign * at(half, a);
          q[u] = pu;
          q[v] = pv;
          const core: V3 = [Math.max(-inner[0], Math.min(inner[0], q[0])), Math.max(-inner[1], Math.min(inner[1], q[1])), Math.max(-inner[2], Math.min(inner[2], q[2]))];
          const n = normalize(sub(q, core));
          const point: V3 = [centre[0] + core[0] + n[0] * r, centre[1] + core[1] + n[1] * r, centre[2] + core[2] + n[2] * r];
          return b.vertex(p, point, n, projectUv(point, faceNormal));
        }),
      );
      for (let i = 0; i + 1 < su.length; i++) {
        for (let j = 0; j + 1 < sv.length; j++) {
          const a0 = ids[i]![j]!, a1 = ids[i + 1]![j]!, a2 = ids[i + 1]![j + 1]!, a3 = ids[i]![j + 1]!;
          if (sign > 0) p.indices.push(a0, a1, a2, a0, a2, a3);
          else p.indices.push(a0, a2, a1, a0, a3, a2);
        }
      }
    }
  }
  return b;
}

/** The (radius, y) profile of a cylinder on y0 of height h whose two rim edges are rounded with radius `bevel`. */
export function roundedCylinderProfile(r: number, y0: number, h: number, bevel: number, steps = 4): [number, number][] {
  const b = Math.min(bevel, r * 0.999, h / 2);
  if (!(b > 1e-6)) return [[r, y0], [r, y0 + h]];
  const arc = (cy: number, from: number, to: number): [number, number][] =>
    Array.from({ length: steps + 1 }, (_, k): [number, number] => {
      const t = from + ((to - from) * k) / steps;
      return [r - b + b * Math.cos(t), cy + b * Math.sin(t)];
    });
  const bottom = arc(y0 + b, -Math.PI / 2, 0);
  const top = arc(y0 + h - b, 0, Math.PI / 2);
  const profile: [number, number][] = [[0, y0], ...bottom, ...(h - 2 * b > 1e-6 ? top : top.slice(1)), [0, y0 + h]];
  return profile;
}

/** A cylinder standing on y0 with rounded rim edges. */
export function roundedCylinder(r: number, y0: number, h: number, segments: number, bevel: number, material: string): MeshBuilder {
  return lathe(roundedCylinderProfile(r, y0, h, bevel), segments, material, true);
}

/** Smooth 3D value noise in about -1..1, the same on every platform (integer hashing only). */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const hash = (i: number, j: number, k: number): number => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647) ^ Math.imul(seed + 1, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
  };
  const s = (t: number): number => t * t * (3 - 2 * t);
  const u = s(fx), v = s(fy), w = s(fz);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const x00 = lerp(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), x10 = lerp(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u);
  const x01 = lerp(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), x11 = lerp(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/**
 * A sphere or ellipsoid whose surface bulges in and out by up to `lumps` of its radius (0 = smooth), from seeded noise
 * over the direction: tree crowns, bushes, rocks, clouds. The same seed gives the same shape.
 */
export function lumpyEllipsoid(rx: number, ry: number, rz: number, segments: number, lumps: number, seed: number, material: string): MeshBuilder {
  if (!(lumps > 0)) return ellipsoid(rx, ry, rz, segments, material);
  const rows = Math.max(4, Math.round(segments / 2));
  const rings: V3[][] = [];
  for (let i = 0; i <= rows; i++) {
    const phi = (i / rows) * Math.PI;
    rings.push(
      Array.from({ length: segments }, (_, k): V3 => {
        const angle = (k / segments) * Math.PI * 2;
        const d: V3 = [Math.sin(phi) * Math.cos(angle), Math.cos(phi), Math.sin(phi) * Math.sin(angle)];
        const f = 1.7;
        const bump = noise3(d[0] * f + 11.3, d[1] * f + 5.1, d[2] * f + 7.7, seed) + 0.5 * noise3(d[0] * f * 2.3, d[1] * f * 2.3, d[2] * f * 2.3, seed + 17);
        const scale = Math.max(0.2, 1 + (lumps * bump) / 1.5);
        return [rx * d[0] * scale, ry * d[1] * scale, rz * d[2] * scale];
      }),
    );
  }
  return ringSurface(rings, { material, caps: false });
}

/**
 * A round tube along a path of points (pipes, rails, handlebars, frames, cables, branches). `radii` gives the radius at
 * each point (one value for all). Corners are mitred so the tube keeps its thickness; add points to round a bend.
 */
export function tube(path: V3[], radii: number[], segments: number, material: string, caps = true): MeshBuilder {
  const points: V3[] = [];
  const rs: number[] = [];
  path.forEach((q, i) => {
    const last = points[points.length - 1];
    if (last && length(sub(q, last)) < 1e-9) return;
    points.push(q);
    rs.push(radii[Math.min(i, radii.length - 1)] as number);
  });
  if (points.length < 2) return new MeshBuilder();
  const dirs: V3[] = points.slice(1).map((q, i) => normalize(sub(q, points[i] as V3)));
  let normal: V3 | undefined;
  const rings: V3[][] = points.map((q, i) => {
    const before = dirs[i - 1], after = dirs[i];
    const both = before && after ? add(before, after) : undefined;
    const t = both && length(both) > 1e-6 ? normalize(both) : ((after ?? before) as V3);
    if (!normal) {
      const helper: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      normal = normalize(cross(cross(t, helper), t));
    } else {
      // Parallel transport: keep the previous normal, minus its part along the new direction.
      const projected = sub(normal, [t[0] * dot(normal, t), t[1] * dot(normal, t), t[2] * dot(normal, t)]);
      normal = length(projected) > 1e-6 ? normalize(projected) : normalize(cross(cross(t, [0, 1, 0]), t));
    }
    const binormal = cross(t, normal);
    // A mitred corner: the ring is stretched along the bend so both legs of the tube keep their radius.
    const bend = before && after ? sub(after, before) : undefined;
    const m: V3 | undefined = bend && length(bend) > 1e-6 ? normalize(bend) : undefined;
    const stretch = before ? 1 / Math.max(0.35, dot(t, before)) : 1;
    const r = rs[i] as number;
    const n0 = normal;
    return Array.from({ length: segments }, (_, k): V3 => {
      const angle = (k / segments) * Math.PI * 2;
      let dir: V3 = add([n0[0] * Math.cos(angle), n0[1] * Math.cos(angle), n0[2] * Math.cos(angle)], [binormal[0] * Math.sin(angle), binormal[1] * Math.sin(angle), binormal[2] * Math.sin(angle)]);
      if (m) {
        const along = dot(dir, m) * (stretch - 1);
        dir = add(dir, [m[0] * along, m[1] * along, m[2] * along]);
      }
      return [q[0] + dir[0] * r, q[1] + dir[1] * r, q[2] + dir[2] * r];
    });
  });
  return ringSurface(rings, { material, caps });
}

/**
 * A lumpy ellipsoid with `cuts` flat fractures: seeded planes slice caps off the stone, as a break or a split does, so
 * it gets flat faces with sharp edges between them (rocks, boulders, cliff chunks, broken stone). The rest of the
 * surface stays smooth: normals are shared only between faces that meet at a gentle angle. The same seed gives the
 * same stone, and the planes are cut before the radii are applied, so a fracture stays flat on any ellipsoid.
 */
export function fracturedEllipsoid(rx: number, ry: number, rz: number, segments: number, lumps: number, seed: number, cuts: number, material: string): MeshBuilder {
  const rows = Math.max(4, Math.round(segments / 2));
  // The unit-space surface: a lumpy sphere, as lumpyEllipsoid makes it.
  const grid: V3[][] = [];
  for (let i = 0; i <= rows; i++) {
    const phi = (i / rows) * Math.PI;
    grid.push(
      Array.from({ length: segments }, (_, k): V3 => {
        const angle = (k / segments) * Math.PI * 2;
        const d: V3 = [Math.sin(phi) * Math.cos(angle), Math.cos(phi), Math.sin(phi) * Math.sin(angle)];
        if (lumps <= 0) return d;
        const f = 1.7;
        const bump = noise3(d[0] * f + 11.3, d[1] * f + 5.1, d[2] * f + 7.7, seed) + 0.5 * noise3(d[0] * f * 2.3, d[1] * f * 2.3, d[2] * f * 2.3, seed + 17);
        const k2 = Math.max(0.2, 1 + (lumps * bump) / 1.5);
        return [d[0] * k2, d[1] * k2, d[2] * k2];
      }),
    );
  }
  // Fracture planes: a direction spread over the sphere and a depth of 8-30 % of the radius; points beyond a plane
  // are moved back onto it along its normal.
  const rand = (n: number): number => (noise3(n * 1.37 + 0.5, seed * 0.173 + 2.5, n * 0.71 + 7.25, seed + 101) + 1) / 2;
  for (let c = 0; c < cuts; c++) {
    const z = 1 - 2 * ((c + 0.5 + 0.6 * (rand(c) - 0.5)) / cuts);
    const theta = c * 2.399963 + rand(c + 50) * 1.2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const n: V3 = [r * Math.cos(theta), z, r * Math.sin(theta)];
    const offset = 1 - (0.08 + 0.22 * rand(c + 100));
    for (const ring of grid) {
      for (let k = 0; k < ring.length; k++) {
        const q = ring[k]!;
        const over = dot(q, n) - offset;
        if (over > 0) ring[k] = [q[0] - over * n[0], q[1] - over * n[1], q[2] - over * n[2]];
      }
    }
  }
  const point = (i: number, k: number): V3 => {
    const q = grid[i]![((k % segments) + segments) % segments]!;
    return [q[0] * rx, q[1] * ry, q[2] * rz];
  };
  // A vertex is the pole for the first and last ring, else its grid point.
  const key = (i: number, k: number): string => (i === 0 ? "top" : i === rows ? "bottom" : `${i}:${((k % segments) + segments) % segments}`);
  type Face = { pts: V3[]; keys: string[]; n: V3 };
  const faces: Face[] = [];
  const addFace = (a: [number, number], b: [number, number], c: [number, number]): void => {
    const pts = [point(...a), point(...b), point(...c)];
    const n = cross(sub(pts[1]!, pts[0]!), sub(pts[2]!, pts[0]!));
    // A triangle at a pole has two corners on the same point: it is not part of the surface.
    if (length(n) < 1e-14) return;
    faces.push({ pts, keys: [key(...a), key(...b), key(...c)], n });
  };
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < segments; k++) {
      // Wound so that the faces point outwards (counter-clockwise seen from outside).
      addFace([i, k], [i + 1, k + 1], [i + 1, k]);
      addFace([i, k], [i, k + 1], [i + 1, k + 1]);
    }
  }
  const around = new Map<string, Face[]>();
  for (const f of faces) for (const k of f.keys) around.set(k, [...(around.get(k) ?? []), f]);
  const crease = Math.cos((40 * Math.PI) / 180);
  const b = new MeshBuilder();
  const p = b.prim(material);
  for (const f of faces) {
    const own = normalize(f.n);
    const base = p.positions.length / 3;
    f.pts.forEach((pt, v) => {
      let sum: V3 = [0, 0, 0];
      for (const g of around.get(f.keys[v]!) ?? []) if (dot(normalize(g.n), own) > crease) sum = add(sum, g.n);
      b.vertex(p, pt, normalize(sum), projectUv(pt, own));
    });
    p.indices.push(base, base + 1, base + 2);
  }
  return b;
}
