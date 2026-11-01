import { writeFileSync } from "node:fs";
import { at } from "../model/num.js";
import { MATERIALS, type Material } from "./materials.js";
import { MeshBuilder, UV_PER_METER, cross, dot, normalize, sub, type Prim, type V3 } from "./mesh.js";
import { texturesFor } from "./textures.js";

export interface BuildNode {
  name: string;
  translation?: V3;
  /** Rotation as a quaternion (x, y, z, w). */
  rotation?: [number, number, number, number];
  mesh?: MeshBuilder;
  children?: BuildNode[];
}

export interface BuildScene {
  nodes: BuildNode[];
  /** Overrides or additions to the preset materials, by name. */
  materials?: Record<string, Material>;
  /** What the model is, as an archetype id; `model build` checks the result against it. */
  archetype?: string;
  /** For a heightmap terrain tile: its ground as a height grid, for a HeightMapShape3D (`model build --collision heightmap`). */
  heightmap?: Heightmap;
}

/**
 * A square grid of ground heights, centred on the model origin like Godot's HeightMapShape3D. `heights[j * size + i]` is the
 * height at x = (i - (size - 1) / 2) * step, z = (j - (size - 1) / 2) * step. Each cell is split along the diagonal from
 * (i + 1, j) to (i, j + 1), as in the mesh and in both Godot physics engines, so collision and ground agree everywhere.
 */
export interface Heightmap {
  /** Points per side. */
  size: number;
  /** Metres between points. */
  step: number;
  heights: number[];
}

interface Chunk {
  data: Buffer;
  target?: number;
}

/**
 * Per-vertex tangents (xyz + handedness) from the UVs, averaged over the triangles at a vertex. The tangent points to +u;
 * the handedness makes cross(normal, tangent) * w point to -v, the top of the image, as glTF normal maps expect.
 */
export function computeTangents(p: Prim): number[] {
  const n = p.positions.length / 3;
  const tan = new Array<number>(n * 3).fill(0);
  const bit = new Array<number>(n * 3).fill(0);
  const pos = (i: number): V3 => [at(p.positions, i * 3), at(p.positions, i * 3 + 1), at(p.positions, i * 3 + 2)];
  for (let t = 0; t < p.indices.length; t += 3) {
    const i0 = at(p.indices, t), i1 = at(p.indices, t + 1), i2 = at(p.indices, t + 2);
    const e1 = sub(pos(i1), pos(i0)), e2 = sub(pos(i2), pos(i0));
    const du1 = at(p.uvs, i1 * 2) - at(p.uvs, i0 * 2), dv1 = at(p.uvs, i1 * 2 + 1) - at(p.uvs, i0 * 2 + 1);
    const du2 = at(p.uvs, i2 * 2) - at(p.uvs, i0 * 2), dv2 = at(p.uvs, i2 * 2 + 1) - at(p.uvs, i0 * 2 + 1);
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) continue;
    const r = 1 / det;
    const tv: V3 = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
    const bv: V3 = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
    for (const i of [i0, i1, i2]) for (let k = 0; k < 3; k++) {
      tan[i * 3 + k] = at(tan, i * 3 + k) + at(tv, k);
      bit[i * 3 + k] = at(bit, i * 3 + k) + at(bv, k);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const nv: V3 = [at(p.normals, i * 3), at(p.normals, i * 3 + 1), at(p.normals, i * 3 + 2)];
    const tv: V3 = [at(tan, i * 3), at(tan, i * 3 + 1), at(tan, i * 3 + 2)];
    const d = dot(nv, tv);
    let t = normalize([tv[0] - nv[0] * d, tv[1] - nv[1] * d, tv[2] - nv[2] * d]);
    if (Math.hypot(...tv) < 1e-12) t = normalize(Math.abs(nv[1]) < 0.9 ? cross([0, 1, 0], nv) : cross([1, 0, 0], nv));
    const bv: V3 = [at(bit, i * 3), at(bit, i * 3 + 1), at(bit, i * 3 + 2)];
    out.push(t[0], t[1], t[2], dot(cross(nv, t), bv) < 0 ? 1 : -1);
  }
  return out;
}

function pad4(buffer: Buffer): Buffer {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra)]) : buffer;
}

function floats(values: number[]): Buffer {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => data.writeFloatLE(v, i * 4));
  return data;
}

export interface GlbOptions {
  /** Write texture maps for materials that have a pattern (default true); false keeps plain colours and smaller files. */
  textures?: boolean;
}

/** Builds a binary glTF. The same scene always gives the same bytes. */
export function buildGlb(scene: BuildScene, options: GlbOptions = {}): Buffer {
  const chunks: Chunk[] = [];
  const views: object[] = [];
  const accessors: object[] = [];
  const materials: object[] = [];
  const materialIndex = new Map<string, number>();
  const meshes: object[] = [];
  const nodes: object[] = [];
  const images: object[] = [];
  const textures: object[] = [];
  const textureIndex = new Map<Buffer, number>();
  const extensionsUsed = new Set<string>();
  let offset = 0;

  const view = (data: Buffer, target?: number): number => {
    const padded = pad4(data);
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.length, ...(target ? { target } : {}) });
    chunks.push({ data: padded });
    offset += padded.length;
    return views.length - 1;
  };
  const accessor = (values: number[], type: string, width: number, bounds = false): number => {
    const bufferView = view(floats(values), 34962);
    const entry: Record<string, unknown> = { bufferView, componentType: 5126, count: values.length / width, type };
    if (bounds) {
      const min = new Array<number>(width).fill(Infinity), max = new Array<number>(width).fill(-Infinity);
      for (let i = 0; i < values.length; i++) {
        min[i % width] = Math.min(at(min, i % width), at(values, i));
        max[i % width] = Math.max(at(max, i % width), at(values, i));
      }
      // The buffer stores float32, so the bounds are written as the float32 values a reader will see.
      entry["min"] = min.map((v) => Math.fround(v));
      entry["max"] = max.map((v) => Math.fround(v));
    }
    accessors.push(entry);
    return accessors.length - 1;
  };
  /** An embedded PNG as a texture (one sampler: linear, mipmapped, repeating). The same bytes are stored once. */
  const texture = (png: Buffer, name: string): number => {
    const known = textureIndex.get(png);
    if (known !== undefined) return known;
    images.push({ name, mimeType: "image/png", bufferView: view(png) });
    textures.push({ sampler: 0, source: images.length - 1 });
    textureIndex.set(png, textures.length - 1);
    return textures.length - 1;
  };
  const material = (name: string): number => {
    const known = materialIndex.get(name);
    if (known !== undefined) return known;
    const m = scene.materials?.[name] ?? MATERIALS[name];
    if (!m) throw new Error(`unknown material "${name}"`);
    let pbr: Record<string, unknown> = { baseColorFactor: m.color, metallicFactor: m.metallic, roughnessFactor: m.roughness };
    let normalTexture: Record<string, unknown> | undefined;
    if (m.texture && options.textures !== false) {
      const maps = texturesFor(m.texture, [m.color[0], m.color[1], m.color[2]]);
      const repeat = (m.uvMeters ?? 1 / UV_PER_METER) / maps.tile;
      const transform = repeat === 1 ? {} : { extensions: { KHR_texture_transform: { scale: [repeat, repeat] } } };
      if (repeat !== 1) extensionsUsed.add("KHR_texture_transform");
      // The colour is in the colour map; the factor keeps only the alpha.
      pbr = { ...pbr, baseColorFactor: [1, 1, 1, m.color[3]], baseColorTexture: { index: texture(maps.albedo, `${m.texture}_${m.name}_color`), ...transform } };
      normalTexture = { index: texture(maps.normal, `${m.texture}_${m.name}_normal`), ...transform };
    }
    materials.push({
      name: m.name,
      pbrMetallicRoughness: pbr,
      ...(normalTexture ? { normalTexture } : {}),
      ...(m.alpha ? { alphaMode: m.alpha } : {}),
      ...(m.doubleSided ? { doubleSided: true } : {}),
      ...(m.emissive ? { emissiveFactor: m.emissive } : {}),
    });
    materialIndex.set(name, materials.length - 1);
    return materials.length - 1;
  };
  const meshFor = (mesh: MeshBuilder, name: string): number => {
    const primitives = [...mesh.prims.values()]
      .filter((p) => p.indices.length > 0)
      .map((p) => {
        const attributes = {
          POSITION: accessor(p.positions, "VEC3", 3, true),
          NORMAL: accessor(p.normals, "VEC3", 3),
          TEXCOORD_0: accessor(p.uvs, "VEC2", 2),
          TANGENT: accessor(computeTangents(p), "VEC4", 4),
          ...(p.colors && p.colors.length === (p.positions.length / 3) * 4 ? { COLOR_0: accessor(p.colors, "VEC4", 4) } : {}),
        };
        const idx = Buffer.alloc(p.indices.length * 4);
        p.indices.forEach((v, i) => idx.writeUInt32LE(v, i * 4));
        const bufferView = view(idx, 34963);
        accessors.push({ bufferView, componentType: 5125, count: p.indices.length, type: "SCALAR" });
        return { attributes, indices: accessors.length - 1, material: material(p.material), mode: 4 };
      });
    meshes.push({ name, primitives });
    return meshes.length - 1;
  };
  const addNode = (node: BuildNode): number => {
    const entry: Record<string, unknown> = { name: node.name };
    if (node.translation) entry["translation"] = node.translation;
    if (node.rotation) entry["rotation"] = node.rotation;
    // An import hint (-col, -convcol) belongs to the node; the mesh keeps the plain name.
    if (node.mesh && !node.mesh.empty) entry["mesh"] = meshFor(node.mesh, node.name.replace(/-(convcol|col|colonly|convcolonly)$/, ""));
    const index = nodes.length;
    nodes.push(entry);
    const children = (node.children ?? []).map(addNode);
    if (children.length) entry["children"] = children;
    return index;
  };
  const roots = scene.nodes.map(addNode);

  const json = {
    asset: { version: "2.0", generator: "Godotwright" },
    ...(extensionsUsed.size ? { extensionsUsed: [...extensionsUsed].sort() } : {}),
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    meshes,
    materials,
    ...(textures.length ? { textures, images, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const jsonChunk = pad4Json(Buffer.from(JSON.stringify(json)));
  const bin = Buffer.concat(chunks.map((c) => c.data));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonChunk.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonChunk, bh, bin]);
}

function pad4Json(buffer: Buffer): Buffer {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra, 0x20)]) : buffer;
}

export function writeGlbFile(path: string, scene: BuildScene): Buffer {
  const glb = buildGlb(scene);
  writeFileSync(path, glb);
  return glb;
}
