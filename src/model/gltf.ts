import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

/** Subset of the glTF 2.0 JSON that Godotwright reads. */
export interface Gltf {
  asset?: { version?: string; generator?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  materials?: GltfMaterial[];
  textures?: { source?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  skins?: unknown[];
  animations?: { name?: string; channels?: { target?: { node?: number; path?: string } }[] }[];
}

export interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GltfMaterial {
  name?: string;
  doubleSided?: boolean;
  alphaMode?: string;
  normalTexture?: { index: number };
  occlusionTexture?: { index: number };
  emissiveTexture?: { index: number };
  pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicRoughnessTexture?: { index: number } };
}

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  sparse?: unknown;
}

export interface LoadedGltf {
  file: string;
  bytes: number;
  json: Gltf;
  buffers: Buffer[];
  /** Directory used to resolve external images. */
  dir: string;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export class ModelError extends Error {}

/** Loads a .glb or .gltf file (embedded or external buffers). Throws ModelError with a clear message. */
export function loadGltf(file: string): LoadedGltf {
  if (!existsSync(file)) throw new ModelError(`${file}: file not found`);
  const data = readFileSync(file);
  const dir = dirname(resolve(file));
  const ext = extname(file).toLowerCase();
  if (ext === ".glb" || (data.length >= 4 && data.readUInt32LE(0) === GLB_MAGIC)) return loadGlb(file, data, dir);
  if (ext === ".gltf") return loadText(file, data, dir);
  throw new ModelError(`${file}: not a .glb or .gltf file`);
}

function loadGlb(file: string, data: Buffer, dir: string): LoadedGltf {
  if (data.length < 20 || data.readUInt32LE(0) !== GLB_MAGIC) throw new ModelError(`${file}: not a GLB file (bad magic)`);
  const version = data.readUInt32LE(4);
  if (version !== 2) throw new ModelError(`${file}: GLB version ${version} is not supported (need 2)`);
  const length = Math.min(data.readUInt32LE(8), data.length);
  let json: Gltf | undefined;
  let bin: Buffer | undefined;
  for (let pos = 12; pos + 8 <= length; ) {
    const size = data.readUInt32LE(pos);
    const type = data.readUInt32LE(pos + 4);
    const body = data.subarray(pos + 8, pos + 8 + size);
    if (body.length < size) throw new ModelError(`${file}: GLB is truncated`);
    if (type === CHUNK_JSON && !json) json = parseJson(file, body.toString("utf8"));
    else if (type === CHUNK_BIN && !bin) bin = body;
    pos += 8 + size + ((4 - (size % 4)) % 4);
  }
  if (!json) throw new ModelError(`${file}: GLB has no JSON chunk`);
  const buffers = (json.buffers ?? []).map((b, i) => (i === 0 && !b.uri && bin ? bin : resolveBuffer(file, b.uri, dir)));
  return { file, bytes: data.length, json, buffers, dir };
}

function loadText(file: string, data: Buffer, dir: string): LoadedGltf {
  const json = parseJson(file, data.toString("utf8"));
  const buffers = (json.buffers ?? []).map((b) => resolveBuffer(file, b.uri, dir));
  return { file, bytes: data.length, json, buffers, dir };
}

function parseJson(file: string, text: string): Gltf {
  try {
    const json = JSON.parse(text) as Gltf;
    if (!json.asset?.version?.startsWith("2")) throw new ModelError(`${file}: not a glTF 2.0 file`);
    return json;
  } catch (error) {
    if (error instanceof ModelError) throw error;
    throw new ModelError(`${file}: invalid glTF JSON (${(error as Error).message})`);
  }
}

function resolveBuffer(file: string, uri: string | undefined, dir: string): Buffer {
  if (!uri) return Buffer.alloc(0);
  const bytes = readUri(uri, dir);
  if (!bytes) throw new ModelError(`${file}: buffer file not found: ${uri}`);
  return bytes;
}

/** Reads a data: URI or a file next to the model. Returns undefined when the file is missing. */
export function readUri(uri: string, dir: string): Buffer | undefined {
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    return comma < 0 ? undefined : Buffer.from(uri.slice(comma + 1), uri.slice(0, comma).includes(";base64") ? "base64" : "utf8");
  }
  const path = resolve(dir, decodeURIComponent(uri));
  return existsSync(path) ? readFileSync(path) : undefined;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Reads an accessor into a flat Float64Array (normalized integers become 0..1 or -1..1). */
export function readAccessor(model: LoadedGltf, index: number): { data: Float64Array; width: number; count: number } {
  const acc = model.json.accessors?.[index];
  if (!acc) throw new ModelError(`${model.file}: accessor ${index} does not exist`);
  const width = COMPONENTS[acc.type];
  const size = BYTES[acc.componentType];
  if (!width || !size) throw new ModelError(`${model.file}: accessor ${index} has an unsupported type`);
  const out = new Float64Array(acc.count * width);
  if (acc.bufferView === undefined) return { data: out, width, count: acc.count };
  const view = model.json.bufferViews?.[acc.bufferView];
  const buffer = view && model.buffers[view.buffer];
  if (!view || !buffer) throw new ModelError(`${model.file}: accessor ${index} points at a missing buffer`);
  const stride = view.byteStride ?? width * size;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  if (base + (acc.count - 1) * stride + width * size > buffer.length) throw new ModelError(`${model.file}: accessor ${index} reads past the end of its buffer`);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < width; c++) {
      const at = base + i * stride + c * size;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = buffer.readFloatLE(at); break;
        case 5125: v = buffer.readUInt32LE(at); break;
        case 5123: v = buffer.readUInt16LE(at); break;
        case 5122: v = buffer.readInt16LE(at); break;
        case 5121: v = buffer.readUInt8(at); break;
        default: v = buffer.readInt8(at);
      }
      if (acc.normalized) {
        const max = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[acc.componentType as 5121 | 5123 | 5120 | 5122] ?? 1;
        v = Math.max(v / max, -1);
      }
      out[i * width + c] = v;
    }
  }
  return { data: out, width, count: acc.count };
}
