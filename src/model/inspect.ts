import { type Gltf, type GltfMaterial, type GltfPrimitive, type LoadedGltf, ModelError, loadGltf, readAccessor, readUri } from "./gltf.js";
import { imageSize } from "./images.js";
import { at } from "./num.js";

export interface NodeInfo {
  index: number;
  name: string;
  path: string;
  depth: number;
  mesh?: string;
  triangles: number;
  scale: [number, number, number];
  /** True when the world transform mirrors the mesh (negative determinant). */
  mirrored: boolean;
  /** Where the node's origin (its pivot) is in the world. */
  origin: [number, number, number];
}

export interface PrimitiveInfo {
  node: number;
  nodeName: string;
  material?: number;
  triangles: number;
  vertices: number;
  hasNormals: boolean;
  hasUv: boolean;
  hasTangents: boolean;
  uvOutOfRange: boolean;
  /** Triangle indices into `positions` (local space). */
  indices: Uint32Array;
  /** Local-space positions, flat xyz. */
  positions: Float64Array;
  /** Vertex normals, flat xyz, when the mesh has them. */
  normals?: Float64Array;
  /** Column-major world matrix of the node that holds the mesh. */
  world: number[];
}

export interface TextureInfo {
  index: number;
  name: string;
  width?: number;
  height?: number;
  format?: string;
  /** Estimated uncompressed RGBA memory with a full mipmap chain. */
  megabytes: number;
  roles: string[];
}

export interface ModelInfo {
  file: string;
  bytes: number;
  generator?: string;
  nodes: NodeInfo[];
  primitives: PrimitiveInfo[];
  materials: { index: number; name: string; doubleSided: boolean; textured: boolean; normalMapped: boolean }[];
  textures: TextureInfo[];
  triangles: number;
  animations: number;
  /** World-space bounding box over all vertices, or undefined for a model without geometry. */
  bounds?: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
}

export type Mat = number[];

export function identity(): Mat {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function multiply(a: Mat, b: Mat): Mat {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] = at(out, c * 4 + r) + at(a, k * 4 + r) * at(b, c * 4 + k);
  return out;
}

export function localMatrix(node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Mat {
  if (node.matrix?.length === 16) return [...node.matrix];
  const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
  const [x = 0, y = 0, z = 0, w = 1] = node.rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function transformPoint(m: Mat, x: number, y: number, z: number): [number, number, number] {
  const g = (i: number) => at(m, i);
  return [g(0) * x + g(4) * y + g(8) * z + g(12), g(1) * x + g(5) * y + g(9) * z + g(13), g(2) * x + g(6) * y + g(10) * z + g(14)];
}

function determinant3(m: Mat): number {
  const g = (i: number) => at(m, i);
  return g(0) * (g(5) * g(10) - g(9) * g(6)) - g(4) * (g(1) * g(10) - g(9) * g(2)) + g(8) * (g(1) * g(6) - g(5) * g(2));
}

function scaleOf(m: Mat): [number, number, number] {
  const g = (i: number) => at(m, i);
  return [Math.hypot(g(0), g(1), g(2)), Math.hypot(g(4), g(5), g(6)), Math.hypot(g(8), g(9), g(10))];
}

function triangleIndices(model: LoadedGltf, prim: GltfPrimitive, vertexCount: number): Uint32Array {
  let raw: number[];
  if (prim.indices !== undefined) raw = Array.from(readAccessor(model, prim.indices).data);
  else raw = Array.from({ length: vertexCount }, (_, i) => i);
  const mode = prim.mode ?? 4;
  if (mode === 4) return Uint32Array.from(raw.slice(0, raw.length - (raw.length % 3)));
  const out: number[] = [];
  const r = (i: number) => at(raw, i);
  if (mode === 5) for (let i = 0; i + 2 < raw.length; i++) out.push(...(i % 2 ? [r(i + 1), r(i), r(i + 2)] : [r(i), r(i + 1), r(i + 2)]));
  else if (mode === 6) for (let i = 1; i + 1 < raw.length; i++) out.push(r(0), r(i), r(i + 1));
  return Uint32Array.from(out);
}

function materialInfo(m: GltfMaterial, index: number) {
  const textured = Boolean(m.pbrMetallicRoughness?.baseColorTexture || m.pbrMetallicRoughness?.metallicRoughnessTexture || m.normalTexture || m.emissiveTexture || m.occlusionTexture);
  return { index, name: m.name ?? `material_${index}`, doubleSided: Boolean(m.doubleSided), textured, normalMapped: Boolean(m.normalTexture) };
}

function textureRoles(json: Gltf): Map<number, string[]> {
  const roles = new Map<number, string[]>();
  const add = (index: number | undefined, role: string) => {
    if (index !== undefined) roles.set(index, [...(roles.get(index) ?? []), role]);
  };
  for (const m of json.materials ?? []) {
    add(m.pbrMetallicRoughness?.baseColorTexture?.index, "color");
    add(m.pbrMetallicRoughness?.metallicRoughnessTexture?.index, "metal/rough");
    add(m.normalTexture?.index, "normal");
    add(m.occlusionTexture?.index, "occlusion");
    add(m.emissiveTexture?.index, "emissive");
  }
  return roles;
}

function readTextures(model: LoadedGltf): TextureInfo[] {
  const roles = textureRoles(model.json);
  return (model.json.textures ?? []).map((t, index) => {
    const image = t.source === undefined ? undefined : model.json.images?.[t.source];
    let bytes: Buffer | undefined;
    if (image?.bufferView !== undefined) {
      const view = model.json.bufferViews?.[image.bufferView];
      const buffer = view && model.buffers[view.buffer];
      if (view && buffer) bytes = buffer.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    } else if (image?.uri) bytes = readUri(image.uri, model.dir);
    const size = bytes && imageSize(bytes);
    return {
      index,
      name: image?.name ?? image?.uri?.slice(0, 40) ?? `texture_${index}`,
      width: size?.width,
      height: size?.height,
      format: size?.format ?? image?.mimeType?.replace("image/", ""),
      megabytes: size ? (size.width * size.height * 4 * (4 / 3)) / 1048576 : 0,
      roles: roles.get(index) ?? [],
    };
  });
}

/** Reads a model and gathers everything the report and the lint rules need. */
export function inspectModel(file: string): ModelInfo {
  const model = loadGltf(file);
  const json = model.json;
  const nodes: NodeInfo[] = [];
  const primitives: PrimitiveInfo[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const seen = new Set<number>();

  const walk = (index: number, parent: Mat, parentPath: string, depth: number): void => {
    const node = json.nodes?.[index];
    if (!node) throw new ModelError(`${file}: node ${index} does not exist`);
    if (seen.has(index)) throw new ModelError(`${file}: node ${index} is reached twice (cycle or shared child)`);
    seen.add(index);
    const world = multiply(parent, localMatrix(node));
    const name = node.name ?? `node_${index}`;
    const path = parentPath ? `${parentPath}/${name}` : name;
    let triangles = 0;
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      if (!mesh) throw new ModelError(`${file}: mesh ${node.mesh} does not exist`);
      for (const prim of mesh.primitives) {
        const posIndex = prim.attributes.POSITION;
        if (posIndex === undefined) continue;
        const pos = readAccessor(model, posIndex);
        const indices = triangleIndices(model, prim, pos.count);
        let uvOutOfRange = false;
        if (prim.attributes.TEXCOORD_0 !== undefined) {
          const uv = readAccessor(model, prim.attributes.TEXCOORD_0).data;
          for (let i = 0; i < uv.length; i++) if (at(uv, i) < -0.001 || at(uv, i) > 1.001) { uvOutOfRange = true; break; }
        }
        for (let i = 0; i < pos.count; i++) {
          const p = transformPoint(world, at(pos.data, i * 3), at(pos.data, i * 3 + 1), at(pos.data, i * 3 + 2));
          for (let a = 0; a < 3; a++) { min[a] = Math.min(at(min, a), at(p, a)); max[a] = Math.max(at(max, a), at(p, a)); }
        }
        triangles += indices.length / 3;
        primitives.push({
          node: index, nodeName: path, material: prim.material, triangles: indices.length / 3, vertices: pos.count,
          hasNormals: prim.attributes.NORMAL !== undefined, hasUv: prim.attributes.TEXCOORD_0 !== undefined,
          hasTangents: prim.attributes.TANGENT !== undefined, uvOutOfRange, indices, positions: pos.data, world,
          ...(prim.attributes.NORMAL === undefined ? {} : { normals: readAccessor(model, prim.attributes.NORMAL).data }),
        });
      }
    }
    nodes.push({ index, name, path, depth, mesh: node.mesh === undefined ? undefined : (json.meshes?.[node.mesh]?.name ?? `mesh_${node.mesh}`), triangles, scale: scaleOf(world), mirrored: determinant3(world) < 0, origin: [at(world, 12), at(world, 13), at(world, 14)] });
    for (const child of node.children ?? []) walk(child, world, path, depth + 1);
  };

  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  for (const root of roots) walk(root, identity(), "", 0);

  const hasBounds = Number.isFinite(min[0]);
  return {
    file,
    bytes: model.bytes,
    generator: json.asset?.generator,
    nodes,
    primitives,
    materials: (json.materials ?? []).map(materialInfo),
    textures: readTextures(model),
    triangles: primitives.reduce((n, p) => n + p.triangles, 0),
    animations: json.animations?.length ?? 0,
    bounds: hasBounds ? { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] } : undefined,
  };
}
