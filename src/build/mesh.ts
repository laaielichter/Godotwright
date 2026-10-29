import { at } from "../model/num.js";

export type V3 = [number, number, number];

/** One material's triangles: flat arrays, three floats per vertex (two for UVs). */
export interface Prim {
  material: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** UV tiles per metre: a 4 m wall repeats the texture once. */
export const UV_PER_METER = 0.25;

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: V3): V3 {
  const l = length(a);
  return l < 1e-12 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

/** Meshes grouped by material. Triangles wind counter-clockwise seen from outside (glTF). */
export class MeshBuilder {
  readonly prims = new Map<string, Prim>();

  prim(material: string): Prim {
    let p = this.prims.get(material);
    if (!p) {
      p = { material, positions: [], normals: [], uvs: [], indices: [] };
      this.prims.set(material, p);
    }
    return p;
  }

  get triangles(): number {
    let n = 0;
    for (const p of this.prims.values()) n += p.indices.length / 3;
    return n;
  }

  get empty(): boolean {
    return this.triangles === 0;
  }

  /** Adds one vertex and returns its index in the primitive. */
  vertex(p: Prim, position: V3, normal: V3, uv: [number, number]): number {
    p.positions.push(...position);
    p.normals.push(...normal);
    p.uvs.push(...uv);
    return p.positions.length / 3 - 1;
  }

  /** A flat-shaded triangle with box-projected UVs. Returns false for a triangle without area. */
  tri(a: V3, b: V3, c: V3, material: string): boolean {
    const n = cross(sub(b, a), sub(c, a));
    if (length(n) < 1e-12) return false;
    const normal = normalize(n);
    const p = this.prim(material);
    const base = p.positions.length / 3;
    for (const point of [a, b, c]) this.vertex(p, point, normal, projectUv(point, normal));
    p.indices.push(base, base + 1, base + 2);
    return true;
  }

  quad(a: V3, b: V3, c: V3, d: V3, material: string): void {
    this.tri(a, b, c, material);
    this.tri(a, c, d, material);
  }

  /** A flat polygon (convex) wound so it faces away from `inside`. */
  convexFace(points: V3[], inside: V3, material: string): void {
    const first = points[0];
    const second = points[1];
    const third = points[2];
    if (!first || !second || !third) return;
    const centre: V3 = [0, 0, 0];
    for (const p of points) for (let i = 0; i < 3; i++) centre[i] = at(centre, i) + at(p, i) / points.length;
    const outward = dot(cross(sub(second, first), sub(third, first)), sub(centre, inside)) >= 0;
    const ordered = outward ? points : [...points].reverse();
    for (let i = 1; i + 1 < ordered.length; i++) this.tri(ordered[0] as V3, ordered[i] as V3, ordered[i + 1] as V3, material);
  }

  merge(other: MeshBuilder): this {
    for (const o of other.prims.values()) {
      const p = this.prim(o.material);
      const base = p.positions.length / 3;
      p.positions.push(...o.positions);
      p.normals.push(...o.normals);
      p.uvs.push(...o.uvs);
      p.indices.push(...o.indices.map((i) => i + base));
    }
    return this;
  }

  /** Applies a rotation or translation to positions, and the rotation to normals. */
  private map(point: (p: V3) => V3, direction: (n: V3) => V3): this {
    for (const p of this.prims.values()) {
      for (let i = 0; i < p.positions.length; i += 3) {
        const moved = point([at(p.positions, i), at(p.positions, i + 1), at(p.positions, i + 2)]);
        p.positions[i] = moved[0];
        p.positions[i + 1] = moved[1];
        p.positions[i + 2] = moved[2];
        const turned = direction([at(p.normals, i), at(p.normals, i + 1), at(p.normals, i + 2)]);
        p.normals[i] = turned[0];
        p.normals[i + 1] = turned[1];
        p.normals[i + 2] = turned[2];
      }
    }
    return this;
  }

  translate(dx: number, dy: number, dz: number): this {
    return this.map((p) => [p[0] + dx, p[1] + dy, p[2] + dz], (n) => n);
  }

  /** Rotates around an axis through the origin (radians, right-handed). */
  rotate(axis: "x" | "y" | "z", radians: number): this {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    const turn = (p: V3): V3 => {
      if (axis === "x") return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
      if (axis === "y") return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
      return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
    };
    return this.map(turn, turn);
  }

  scale(factor: number): this {
    return this.map((p) => [p[0] * factor, p[1] * factor, p[2] * factor], (n) => n);
  }

  /** The mirror image in the x = 0 plane (winding flipped so faces still point out). */
  mirroredX(): MeshBuilder {
    const mirrored = new MeshBuilder();
    for (const o of this.prims.values()) {
      const p = mirrored.prim(o.material);
      p.positions = o.positions.map((v, i) => (i % 3 === 0 ? -v : v));
      p.normals = o.normals.map((v, i) => (i % 3 === 0 ? -v : v));
      p.uvs = [...o.uvs];
      p.indices = [];
      for (let i = 0; i < o.indices.length; i += 3) p.indices.push(at(o.indices, i), at(o.indices, i + 2), at(o.indices, i + 1));
    }
    return mirrored;
  }

  /** The mesh plus its mirror image in the x = 0 plane; left and right match exactly. */
  withMirrorX(): MeshBuilder {
    return new MeshBuilder().merge(this).merge(this.mirroredX());
  }
}

/** UV from the dominant axis of the face normal, at UV_PER_METER tiles per metre. */
export function projectUv(p: V3, n: V3): [number, number] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0] * UV_PER_METER, p[2] * UV_PER_METER];
  if (ax >= az) return [p[2] * UV_PER_METER, -p[1] * UV_PER_METER];
  return [p[0] * UV_PER_METER, -p[1] * UV_PER_METER];
}
