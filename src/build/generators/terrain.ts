import type { Material } from "../materials.js";
import type { BuildNode, BuildScene } from "../glb.js";
import { MeshBuilder, normalize, type V3 } from "../mesh.js";
import type { ParamDef, Params } from "../params.js";
import type { Generator } from "./index.js";

/** Gradient noise on an integer lattice. Only + - * and a table lookup, so every platform gives the same numbers. */
const GRADIENTS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];

function lattice(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Perlin-style noise, roughly in -1..1. */
export function noise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const corner = (ix: number, iz: number, dx: number, dz: number): number => {
    const g = GRADIENTS[lattice(ix, iz, seed) & 7] as [number, number];
    return g[0] * dx + g[1] * dz;
  };
  const u = fade(fx), v = fade(fz);
  const a = corner(x0, z0, fx, fz) + u * (corner(x0 + 1, z0, fx - 1, fz) - corner(x0, z0, fx, fz));
  const b = corner(x0, z0 + 1, fx, fz - 1) + u * (corner(x0 + 1, z0 + 1, fx - 1, fz - 1) - corner(x0, z0 + 1, fx, fz - 1));
  return (a + v * (b - a)) * 1.4;
}

/**
 * Fractal noise: each octave has twice the frequency and half the weight. Result in about -1..1.
 * Octaves finer than `maxFrequency` are left out: detail the grid cannot show only makes spikes and flipped faces.
 */
function fbm(x: number, z: number, seed: number, octaves: number, maxFrequency = Infinity): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves && (o === 0 || f <= maxFrequency); o++) {
    sum += amp * noise2(x * f, z * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const TERRAIN_PARAMS: ParamDef[] = [
  { name: "tileSize", type: "number", default: 256, min: 64, max: 1024, description: "Width and depth of the tile in metres." },
  { name: "resolution", type: "enum", default: "129", options: ["33", "65", "129", "257"], description: "Vertices per side. A power of two plus one, so the last row of a tile is the first row of the next." },
  { name: "relief", type: "enum", default: "hills", options: ["plains", "hills", "mountains", "island"], description: "The kind of landscape. An island is one landmass around the world origin with sea floor around it." },
  { name: "maxHeight", type: "number", default: 60, min: 5, max: 1500, description: "Height scale in metres: about the height difference of hills, the peak height of mountains." },
  { name: "baseLevel", type: "number", default: 8, min: -50, max: 200, description: "Average ground height above sea level (y = 0) in metres." },
  { name: "featureSize", type: "number", default: 120, min: 20, max: 1000, description: "Size in metres of the largest bumps (the wavelength of the base noise)." },
  { name: "tileX", type: "integer", default: 0, min: -1000, max: 1000, description: "Place of the tile in the world grid, along x. The tile centre is at tileX * tileSize." },
  { name: "tileZ", type: "integer", default: 0, min: -1000, max: 1000, description: "Place of the tile in the world grid, along z. The tile centre is at tileZ * tileSize." },
  { name: "seed", type: "integer", default: 1, min: 0, max: 1000000, description: "The same seed gives the same landscape in every tile, so neighbouring tiles continue each other." },
  { name: "lakeRadius", type: "number", default: 0, min: 0, max: 2000, description: "Radius of a lake in metres; 0 means no lake. The lake is part of the world, so it can span several tiles." },
  { name: "lakeX", type: "number", default: 0, min: -100000, max: 100000, description: "World x of the lake centre in metres." },
  { name: "lakeZ", type: "number", default: 0, min: -100000, max: 100000, description: "World z of the lake centre in metres." },
  { name: "lakeDepth", type: "number", default: 4, min: 0.5, max: 100, description: "How deep the lake is below its water level at the centre, in metres." },
];

/** The ground height before a lake is carved, in metres above sea level. */
function baseHeight(p: Params, wx: number, wz: number): number {
  const size = p["tileSize"] as number, relief = p["relief"] as string;
  const amp = p["maxHeight"] as number, base = p["baseLevel"] as number, seed = p["seed"] as number;
  const feature = p["featureSize"] as number;
  const f = 1 / feature;
  const x = wx * f, z = wz * f;
  // The finest wave the grid can show is about four steps long; the same limit holds in every tile.
  const maxFrequency = feature / (4 * (size / (Number(p["resolution"]) - 1)));
  switch (relief) {
    case "plains":
      return base + amp * 0.25 * fbm(x, z, seed, 4, maxFrequency);
    case "mountains": {
      // A smoothed absolute value: a sharp crease in the ridges would make faces that point against their neighbours.
      const nz = noise2(x * 0.7, z * 0.7, seed);
      const ridge = 1.2 - Math.sqrt(nz * nz + 0.04);
      return base + amp * (0.9 * ridge * ridge - 0.25) + amp * 0.08 * fbm(x * 4, z * 4, seed + 7, 3, maxFrequency / 4);
    }
    case "island": {
      const radius = size * 0.45;
      const mask = 1 - smoothstep(0.3, 1, Math.hypot(wx, wz) / radius);
      const land = base + amp * 0.5 * (0.6 + fbm(x, z, seed, 5, maxFrequency));
      return land * mask - (20 + amp * 0.2) * (1 - mask);
    }
    default:
      return base + amp * 0.5 * fbm(x, z, seed, 5, maxFrequency);
  }
}

export interface Lake {
  x: number;
  z: number;
  radius: number;
  depth: number;
  /** Height of the water surface in metres above sea level. */
  level: number;
}

const lakes = new WeakMap<Params, Lake | null>();

/**
 * The lowest ground height on the rim of a lake. The ring is sampled at eight points per wave the grid can show (the shortest
 * wave is the smaller of the feature size and four grid steps, see fbm), so every dip is found. Each dip is then refined to its
 * true lowest point, because on steep ground the samples alone can miss by metres.
 */
function lowestOnRim(p: Params, x: number, z: number, radius: number): number {
  const feature = p["featureSize"] as number, size = p["tileSize"] as number;
  const spacing = Math.min(feature / 8, size / (Number(p["resolution"]) - 1) / 2);
  const n = Math.max(8, Math.ceil((2 * Math.PI * radius) / spacing));
  const angle = (2 * Math.PI) / n;
  const ground = (a: number): number => baseHeight(p, x + radius * Math.cos(a), z + radius * Math.sin(a));
  const sampled = Array.from({ length: n }, (_, k) => ground(k * angle));
  const phi = (Math.sqrt(5) - 1) / 2;
  let rim = Infinity;
  for (let k = 0; k < n; k++) {
    const h = sampled[k] as number;
    if (h > (sampled[(k + n - 1) % n] as number) || h > (sampled[(k + 1) % n] as number)) continue;
    // Golden-section search between the two neighbours of this dip.
    let lo = (k - 1) * angle, hi = (k + 1) * angle;
    let c = hi - phi * (hi - lo), d = lo + phi * (hi - lo);
    let fc = ground(c), fd = ground(d);
    for (let i = 0; i < 30; i++) {
      if (fc < fd) {
        hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = ground(c);
      } else {
        lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = ground(d);
      }
    }
    rim = Math.min(rim, h, fc, fd);
  }
  return rim;
}

/** The lake of these parameters, if there is one. Its water level is half a metre under the lowest point of its rim, so the water never spills. */
export function lakeOf(p: Params): Lake | undefined {
  const known = lakes.get(p);
  if (known !== undefined) return known ?? undefined;
  const radius = p["lakeRadius"] as number;
  let lake: Lake | null = null;
  if (radius > 0) {
    const x = p["lakeX"] as number, z = p["lakeZ"] as number;
    lake = { x, z, radius, depth: p["lakeDepth"] as number, level: lowestOnRim(p, x, z, radius) - 0.5 };
  }
  lakes.set(p, lake);
  return lake ?? undefined;
}

/**
 * The ground height at a world position, in metres above sea level, with the lake basin carved in.
 * The same function serves every tile, which is what makes borders match, also across a lake.
 */
export function terrainHeight(p: Params, wx: number, wz: number): number {
  const ground = baseHeight(p, wx, wz);
  const lake = lakeOf(p);
  if (!lake) return ground;
  const r = Math.hypot(wx - lake.x, wz - lake.z);
  // A parabolic bowl under the water level, blended into the surrounding ground between 0.8 and 1.4 radii.
  const bowl = lake.level - lake.depth * Math.max(0, 1 - (r / lake.radius) ** 2);
  const weight = 1 - smoothstep(0.8 * lake.radius, 1.4 * lake.radius, r);
  return ground - (ground - bowl) * weight;
}

const LAKE_WATER: Material = { name: "lake_water", color: [0.08, 0.3, 0.42, 0.7], metallic: 0, roughness: 0.08, alpha: "BLEND", doubleSided: true };

const GROUND: Material = { name: "terrain_ground", color: [0.28, 0.4, 0.17, 1], metallic: 0, roughness: 0.95 };
/** One texture repeat per this many metres, counted from the world origin so a texture runs on across tiles. */
const UV_METERS = 8;

export const terrain: Generator = {
  kind: "terrain",
  archetype: "world.terrain",
  description: "A heightmap terrain tile: a grid of ground heights from seeded noise (plains, hills, mountains or an island), with smooth normals and an optional lake. Tiles with the same seed continue each other exactly, so a world can be cut into tiles.",
  params: TERRAIN_PARAMS,
  build(p: Params): BuildScene {
    const size = p["tileSize"] as number, n = Number(p["resolution"]);
    const tx = p["tileX"] as number, tz = p["tileZ"] as number;
    const step = size / (n - 1);
    const cx = tx * size, cz = tz * size;
    const h = (i: number, j: number): number => terrainHeight(p, cx - size / 2 + i * step, cz - size / 2 + j * step);

    // Heights one ring beyond the tile as well, so the normals on the border are the same on both sides of it.
    const m = n + 2;
    const heights = new Float64Array(m * m);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) heights[j * m + i] = h(i - 1, j - 1);
    const H = (i: number, j: number): number => heights[(j + 1) * m + (i + 1)] as number;
    /** The two triangles of the quad at (i, j), their (unnormalised) normals added up: the weight is the area. */
    const quadNormal = (i: number, j: number): V3 => {
      const h00 = H(i, j), h10 = H(i + 1, j), h01 = H(i, j + 1), h11 = H(i + 1, j + 1);
      return [-step * (h10 - h00) + step * (h01 - h11), 2 * step * step, -step * (h01 - h00) - step * (h11 - h10)];
    };

    const mesh = new MeshBuilder();
    const prim = mesh.prim("terrain_ground");
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const wx = cx - size / 2 + i * step, wz = cz - size / 2 + j * step;
        // The four quads around the vertex, each weighted by its area, so a face never points against the vertex normals.
        let sx = 0, sy = 0, sz = 0;
        for (const [qi, qj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]] as const) {
          const q = quadNormal(qi, qj);
          sx += q[0]; sy += q[1]; sz += q[2];
        }
        mesh.vertex(prim, [-size / 2 + i * step, H(i, j), -size / 2 + j * step], normalize([sx, sy, sz]), [wx / UV_METERS, wz / UV_METERS]);
      }
    }
    const index = (i: number, j: number): number => j * n + i;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        prim.indices.push(index(i, j), index(i, j + 1), index(i + 1, j));
        prim.indices.push(index(i + 1, j), index(i, j + 1), index(i + 1, j + 1));
      }
    }
    const children: BuildNode[] = [{ name: "Surface", mesh }];
    const materials: Record<string, Material> = { terrain_ground: GROUND };
    const lake = lakeOf(p);
    if (lake) {
      // Water on every grid cell that has a corner under the water level. Cells that stick out over the shore are hidden by the ground.
      const water = new MeshBuilder();
      const wp = water.prim("lake_water");
      const vertex = new Map<number, number>();
      const corner = (i: number, j: number): number => {
        const key = j * n + i;
        let id = vertex.get(key);
        if (id === undefined) {
          id = water.vertex(wp, [-size / 2 + i * step, lake.level, -size / 2 + j * step], [0, 1, 0], [(cx - size / 2 + i * step) / UV_METERS, (cz - size / 2 + j * step) / UV_METERS]);
          vertex.set(key, id);
        }
        return id;
      };
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          // Only near the lake: low ground elsewhere is not part of it.
          if (Math.hypot(cx - size / 2 + (i + 0.5) * step - lake.x, cz - size / 2 + (j + 0.5) * step - lake.z) > lake.radius * 1.1 + step) continue;
          if (Math.min(H(i, j), H(i + 1, j), H(i, j + 1), H(i + 1, j + 1)) >= lake.level) continue;
          wp.indices.push(corner(i, j), corner(i, j + 1), corner(i + 1, j));
          wp.indices.push(corner(i + 1, j), corner(i, j + 1), corner(i + 1, j + 1));
        }
      }
      if (!water.empty) {
        children.push({ name: "Water", mesh: water });
        materials["lake_water"] = LAKE_WATER;
      }
    }
    return { materials, nodes: [{ name: "Terrain", children }] };
  },
};

export const SEA_PARAMS: ParamDef[] = [
  { name: "size", type: "number", default: 1000, min: 500, max: 20000, description: "Width and depth of the water plane in metres." },
  { name: "subdivisions", type: "integer", default: 64, min: 4, max: 256, description: "Quads per side. A finer plane lets a vertex shader make waves; a coarse one is cheaper." },
  { name: "depth", type: "number", default: 40, min: 5, max: 200, description: "How far the sea floor lies below the surface in metres." },
];

const WATER: Material = { name: "sea_water", color: [0.05, 0.25, 0.4, 0.75], metallic: 0, roughness: 0.08, alpha: "BLEND" };
const SEA_FLOOR: Material = { name: "sea_floor", color: [0.55, 0.5, 0.35, 1], metallic: 0, roughness: 1 };

/** A flat grid of quads facing up at height y. */
function plane(size: number, divisions: number, y: number, material: string): MeshBuilder {
  const mesh = new MeshBuilder();
  const prim = mesh.prim(material);
  const step = size / divisions;
  const up: V3 = [0, 1, 0];
  for (let j = 0; j <= divisions; j++) {
    for (let i = 0; i <= divisions; i++) {
      const x = -size / 2 + i * step, z = -size / 2 + j * step;
      mesh.vertex(prim, [x, y, z], up, [x / UV_METERS, z / UV_METERS]);
    }
  }
  const index = (i: number, j: number): number => j * (divisions + 1) + i;
  for (let j = 0; j < divisions; j++) {
    for (let i = 0; i < divisions; i++) {
      prim.indices.push(index(i, j), index(i, j + 1), index(i + 1, j));
      prim.indices.push(index(i + 1, j), index(i, j + 1), index(i + 1, j + 1));
    }
  }
  return mesh;
}

export const sea: Generator = {
  kind: "sea",
  archetype: "world.water.sea",
  description: "A sea: a flat, subdivided water plane at sea level (y = 0) for a wave shader, and a flat sea floor below it. The surface is a separate node so the water can follow the camera.",
  params: SEA_PARAMS,
  build(p: Params): BuildScene {
    const size = p["size"] as number, divisions = p["subdivisions"] as number, depth = p["depth"] as number;
    return {
      materials: { sea_water: WATER, sea_floor: SEA_FLOOR },
      nodes: [{ name: "Sea", children: [{ name: "Surface", mesh: plane(size, divisions, 0, "sea_water") }, { name: "Floor", mesh: plane(size, 1, -depth, "sea_floor") }] }],
    };
  },
};
