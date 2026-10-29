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
      const capNormal = normalize(sub(centre, ringCentre(rings[next] as V3[])));
      const c = b.vertex(p, centre, capNormal, [0, 0]);
      const verts = ring.map((q) => b.vertex(p, q, capNormal, projectCapUv(q, capNormal)));
      for (let j = 0; j < n; j++) {
        const a = verts[j] as number, d = verts[(j + 1) % n] as number;
        const winding = dot(cross(sub(ring[(j + 1) % n] as V3, ring[j] as V3), sub(centre, ring[j] as V3)), capNormal);
        p.indices.push(c, ...(winding >= 0 ? [a, d] : [d, a]));
      }
    }
  }
  return b;
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
