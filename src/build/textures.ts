import { encodePng } from "../screenshot/png.js";

/**
 * Procedural, seamless textures for the material presets: a colour map and a normal map per pattern, written into the
 * .glb as PNG. Everything is computed here from seeded noise, so the same pattern and colour always give the same bytes,
 * and nothing is downloaded or read from disk.
 */

type RGB = [number, number, number];

export interface PatternOutput {
  /** Linear RGB, three floats per pixel, rows from the top of the image. */
  albedo: Float32Array;
  /** Relief from 0 (deep) to 1 (high), one float per pixel. */
  height: Float32Array;
}

export interface Pattern {
  /** One repeat of the texture covers this many metres. */
  tile: number;
  /** How strongly the relief shows in the normal map. */
  relief: number;
  /** What the pattern looks like, in a few words. */
  description: string;
  make(size: number, color: RGB): PatternOutput;
}

export interface MaterialTextures {
  /** sRGB colour map (PNG). */
  albedo: Buffer;
  /** Tangent-space normal map (PNG), +Y towards the top of the image as glTF expects. */
  normal: Buffer;
  /** Metres covered by one repeat. */
  tile: number;
}

/** Pixels per side. A power of two, so mipmaps and VRAM compression work. */
export const TEXTURE_SIZE = 256;

// ---------------------------------------------------------------------------------------------------------------------
// Noise that repeats: every lattice is wrapped at its period, so the texture tiles without a seam.

function hash(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A random number in 0..1 for a lattice point. */
const rand = (i: number, j: number, seed: number): number => hash(i, j, seed) / 4294967296;

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Value noise in -1..1 at (x, y) in lattice units, repeating every px by py cells. */
function vnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const c = (i: number, j: number): number => rand(mod(i, px), mod(j, py), seed) * 2 - 1;
  return mix(mix(c(xi, yi), c(xi + 1, yi), u), mix(c(xi, yi + 1), c(xi + 1, yi + 1), u), v);
}

/** Fractal noise in about -1..1 at texture coordinates (u, v) in 0..1, starting with fx by fy cells. */
function fbm(u: number, v: number, fx: number, fy: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const kx = fx << o, ky = fy << o;
    sum += amp * vnoise(u * kx, v * ky, kx, ky, seed + o * 131);
    norm += amp;
    amp *= gain;
  }
  return sum / norm;
}

/** Cellular noise: distance to the nearest and second nearest of one jittered point per cell, and the nearest cell's id. */
function cells(u: number, v: number, gx: number, gy: number, seed: number, jitter = 0.8): { f1: number; f2: number; id: number } {
  const x = u * gx, y = v * gy;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = Infinity, f2 = Infinity, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const ci = mod(xi + i, gx), cj = mod(yi + j, gy);
      const h = hash(ci, cj, seed);
      const ox = 0.5 + (((h & 0xffff) / 65535) - 0.5) * jitter;
      const oy = 0.5 + (((h >>> 16) / 65535) - 0.5) * jitter;
      const d = Math.hypot(xi + i + ox - x, yi + j + oy - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = h;
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

const scale = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
const blend = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Runs `pixel` for every pixel and collects colour and relief. */
function paint(size: number, pixel: (u: number, v: number) => [RGB, number]): PatternOutput {
  const albedo = new Float32Array(size * size * 3);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [c, h] = pixel((x + 0.5) / size, (y + 0.5) / size);
      const k = y * size + x;
      albedo[k * 3] = c[0];
      albedo[k * 3 + 1] = c[1];
      albedo[k * 3 + 2] = c[2];
      height[k] = h;
    }
  }
  return { albedo, height };
}

/** Distance to the nearest edge of a cell in 0..1, in the same units: 0 on the edge. */
const edgeDistance = (f: number): number => Math.min(f, 1 - f);

// ---------------------------------------------------------------------------------------------------------------------
// The patterns. u runs to the right, v down the image; on a wall u is horizontal and v points down.

const MORTAR: RGB = [0.4, 0.38, 0.34];
const luminance = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Mortar for a wall of this colour: a neutral grey-beige a little lighter than the bricks or stones (as real joints
 * are), never lighter than fresh mortar. A fixed light mortar made dark walls look half again as light as their colour.
 */
function mortarFor(c: RGB): RGB {
  return scale(MORTAR, Math.min(1, (luminance(c) * 1.3) / luminance(MORTAR)));
}

export const PATTERNS: Record<string, Pattern> = {
  brick: {
    tile: 0.9,
    relief: 2.2,
    description: "running-bond brickwork with mortar joints",
    make: (n, c) =>
      paint(n, (u, v) => {
        const rows = 12, perRow = 4;
        const row = Math.floor(v * rows);
        const fu = u * perRow + (row % 2 ? 0.5 : 0);
        const col = mod(Math.floor(fu), perRow);
        const bu = fu - Math.floor(fu), bv = v * rows - row;
        const joint = Math.min(edgeDistance(bu) * 0.225, edgeDistance(bv) * 0.075);
        const inBrick = smooth(clamp01((joint - 0.004) / 0.004));
        const r = rand(col, row, 7), r2 = rand(col, row, 8);
        const brick = blend(scale(c, 0.78 + 0.44 * r), [c[0] * 0.55, c[1] * 0.42, c[2] * 0.36], r2 > 0.85 ? 0.6 : 0);
        const grain = 1 + 0.1 * fbm(u, v, 16, 16, 3, 3);
        const mortar = scale(mortarFor(c), 0.9 + 0.2 * fbm(u, v, 32, 32, 2, 5));
        return [blend(mortar, scale(brick, grain), inBrick), 0.25 + 0.7 * inBrick + 0.05 * fbm(u, v, 32, 32, 2, 9)];
      }),
  },
  roof_tile: {
    tile: 1.2,
    relief: 3,
    description: "rows of curved clay roof tiles",
    make: (n, c) =>
      paint(n, (u, v) => {
        const cols = 4, rows = 5;
        const fu = u * cols, fv = v * rows;
        const col = Math.floor(fu), row = Math.floor(fv);
        const tu = fu - col, tv = fv - row;
        const wave = 0.5 + 0.5 * Math.sin(tu * Math.PI * 2 - Math.PI / 2);
        const lip = smooth(clamp01((1 - tv) / 0.08));
        const h = clamp01(0.15 + 0.5 * wave + 0.35 * tv) * lip;
        const r = rand(col, row, 11);
        const shade = 0.55 + 0.45 * smooth(clamp01(tv / 0.35));
        const tile = scale(c, (0.82 + 0.3 * r) * shade * (0.85 + 0.25 * wave) * (1 + 0.08 * fbm(u, v, 24, 24, 3, 4)));
        return [tile, h];
      }),
  },
  roof_slate: {
    tile: 1.0,
    relief: 2,
    description: "overlapping rectangular slates",
    make: (n, c) =>
      paint(n, (u, v) => {
        // An even number of rows, so the half-slate offset of odd rows carries on across the repeat.
        const cols = 4, rows = 6;
        const row = Math.floor(v * rows);
        const fu = u * cols + (row % 2 ? 0.5 : 0);
        const col = mod(Math.floor(fu), cols);
        const tu = fu - Math.floor(fu), tv = v * rows - row;
        const gap = smooth(clamp01((edgeDistance(tu) * 0.25) / 0.006));
        const lip = smooth(clamp01((1 - tv) / 0.05));
        const r = rand(col, row, 21);
        const slate = scale(c, (0.8 + 0.4 * r) * (0.75 + 0.25 * smooth(clamp01(tv / 0.3))) * (1 + 0.07 * fbm(u, v, 32, 32, 3, 2)));
        return [scale(slate, 0.4 + 0.6 * gap), (0.2 + 0.8 * tv) * lip * gap];
      }),
  },
  wood: {
    tile: 1.2,
    relief: 1.2,
    description: "planks with grain along u",
    make: (n, c) =>
      paint(n, (u, v) => {
        const planks = 8;
        const fv = v * planks, plank = Math.floor(fv), tv = fv - plank;
        const joint = rand(plank, 0, 31);
        const du = mod(u - joint, 1);
        const butt = smooth(clamp01(Math.min(du, 1 - du) * 1.2 / 0.004));
        const seam = smooth(clamp01((edgeDistance(tv) * 0.15) / 0.004));
        const grain = fbm(u, v, 2, 48, 4, 33 + plank);
        const rings = 0.5 + 0.5 * Math.sin((v * planks * 6 + grain * 3 + rand(plank, 1, 34) * 6) * Math.PI);
        const tone = (0.78 + 0.3 * rand(plank, 2, 35)) * (0.82 + 0.25 * rings);
        const wood = blend(scale(c, tone), scale(c, 0.55), 0.15 * smooth(clamp01(fbm(u, v, 4, 16, 2, 36) * 2)));
        const gap = butt * seam;
        return [scale(wood, 0.35 + 0.65 * gap), 0.3 + 0.6 * gap + 0.1 * rings * gap];
      }),
  },
  grain: {
    tile: 1.0,
    relief: 0.9,
    description: "solid timber: continuous grain along v, without plank joints (turned legs, posts, handles, single boards)",
    make: (n, c) =>
      paint(n, (u, v) => {
        const warp = fbm(u, v, 3, 1, 3, 37);
        const streak = fbm(u, v, 40, 2, 4, 38);
        const rings = 0.5 + 0.5 * Math.sin((u * 14 + warp * 2.2 + 0.4 * streak) * Math.PI * 2);
        const tone = (0.86 + 0.18 * rings) * (0.95 + 0.1 * streak) * (0.96 + 0.08 * fbm(u, v, 2, 2, 2, 39));
        return [blend(scale(c, tone), scale(c, 0.6), 0.12 * smooth(clamp01(fbm(u, v, 8, 1, 2, 40) * 2))), clamp01(0.45 + 0.35 * rings * 0.6 + 0.2 * streak)];
      }),
  },
  bark: {
    tile: 1.0,
    relief: 4,
    description: "furrowed bark: tall plates separated by dark fissures running up the trunk, with finer cracks",
    make: (n, c) =>
      paint(n, (u, v) => {
        // Tall narrow plates (cellular noise stretched along the trunk and warped sideways) with a finer layer of cracks.
        const wu = u + 0.035 * fbm(u, v, 3, 2, 3, 41);
        const a = cells(wu, v, 12, 2, 42, 0.95);
        const b = cells(wu + 0.3, v + 0.1, 28, 6, 46, 0.9);
        const plate = smooth(clamp01((a.f2 - a.f1) / 0.3));
        const crack = smooth(clamp01((b.f2 - b.f1) / 0.32));
        const ridge = 0.68 * plate + 0.32 * crack;
        const shade = 0.86 + 0.28 * ((a.id >>> 8 & 0xff) / 255);
        const fine = fbm(u, v, 30, 8, 3, 44);
        const tone = (0.45 + 0.75 * ridge) * shade * (1 + 0.14 * fine);
        return [blend(scale(c, tone), [c[0] * 0.5, c[1] * 0.46, c[2] * 0.43], (1 - ridge) * 0.35), clamp01(0.08 + 0.8 * ridge + 0.1 * fine)];
      }),
  },
  granite: {
    tile: 1.0,
    relief: 1.0,
    description: "granite and similar crystalline stone: a grey ground with dense light and dark mineral flecks",
    make: (n, c) =>
      paint(n, (u, v) => {
        // Three scales of flecks: quartz and feldspar (light), mica and hornblende (dark), each a cell with its own tone.
        const a = cells(u, v, 70, 70, 201, 1), b = cells(u + 0.31, v + 0.17, 110, 110, 202, 1), d = cells(u + 0.62, v + 0.43, 40, 40, 203, 1);
        const speck = (cell: { f1: number; id: number }, size: number): number => {
          const k = (cell.id >>> 8 & 0xff) / 255;
          const inside = 1 - smooth(clamp01((cell.f1 - size) / (size * 0.35)));
          return (k > 0.62 ? 0.5 : k < 0.3 ? -0.6 : 0) * inside;
        };
        const flecks = speck(a, 0.34) + 0.8 * speck(b, 0.3) + 0.7 * speck(d, 0.38);
        const blotch = fbm(u, v, 5, 5, 4, 204);
        const grain = fbm(u, v, 96, 96, 2, 205);
        return [scale(c, Math.max(0.3, 0.95 + 0.14 * blotch + 0.05 * grain + 0.4 * flecks)), clamp01(0.5 + 0.25 * grain + 0.2 * flecks)];
      }),
  },
  concrete: {
    tile: 2.0,
    relief: 0.6,
    description: "cast concrete with blotches and small pores",
    make: (n, c) =>
      paint(n, (u, v) => {
        const blotch = fbm(u, v, 3, 3, 4, 51);
        const fine = fbm(u, v, 64, 64, 2, 52);
        const pore = cells(u, v, 40, 40, 53, 1);
        const pit = 1 - smooth(clamp01(1 - pore.f1 / 0.14)) * ((pore.id >>> 24) / 255 > 0.7 ? 1 : 0);
        return [scale(c, (0.92 + 0.12 * blotch + 0.05 * fine) * (0.75 + 0.25 * pit)), clamp01(0.6 + 0.1 * fine + 0.3 * (pit - 1) + 0.05 * blotch)];
      }),
  },
  asphalt: {
    tile: 2.0,
    relief: 0.8,
    description: "asphalt with light and dark stones in it",
    make: (n, c) =>
      paint(n, (u, v) => {
        const stones = cells(u, v, 90, 90, 61, 1);
        const kind = (stones.id & 0xff) / 255;
        const stone = 1 - smooth(clamp01((stones.f1 - 0.25) / 0.15));
        const tint = kind > 0.8 ? 2.6 : kind < 0.3 ? 0.6 : 1.4;
        const wear = fbm(u, v, 3, 3, 3, 62);
        const base = scale(c, 0.9 + 0.15 * wear);
        return [blend(base, scale(c, tint * (1 + 0.1 * wear)), stone * 0.7), clamp01(0.4 + 0.5 * stone)];
      }),
  },
  plaster: {
    tile: 2.0,
    relief: 0.5,
    description: "rough-cast render",
    make: (n, c) =>
      paint(n, (u, v) => {
        const stipple = fbm(u, v, 64, 64, 2, 71);
        const blotch = fbm(u, v, 4, 4, 3, 72);
        return [scale(c, 0.95 + 0.06 * blotch + 0.04 * stipple), clamp01(0.5 + 0.5 * stipple)];
      }),
  },
  leaf: {
    tile: 1.0,
    relief: 5,
    description: "dense foliage: clusters of leaves with dark gaps",
    make: (n, c) =>
      paint(n, (u, v) => {
        const a = cells(u, v, 9, 9, 81, 0.9), b = cells(u + 0.37, v + 0.21, 13, 13, 82, 0.9);
        const la = clamp01(1 - a.f1 / 0.62), lb = clamp01(1 - b.f1 / 0.6);
        const top = la >= lb ? a : b;
        const h = Math.max(la, lb);
        const k = (top.id >>> 8 & 0xff) / 255;
        const leaf = blend(scale(c, 0.7 + 0.6 * k), [c[0] * 1.6 + 0.02, c[1] * 1.25, c[2] * 0.6], k > 0.85 ? 0.5 : 0);
        const depth = smooth(clamp01(h / 0.35));
        return [scale(leaf, (0.35 + 0.65 * depth) * (1 + 0.1 * fbm(u, v, 32, 32, 2, 83))), h];
      }),
  },
  grass: {
    tile: 2.0,
    relief: 1.5,
    description: "short grass with lighter and darker patches",
    make: (n, c) =>
      paint(n, (u, v) => {
        const patch = fbm(u, v, 4, 4, 4, 91);
        const blades = fbm(u, v, 128, 32, 2, 92);
        const soil = smooth(clamp01((fbm(u, v, 6, 6, 3, 93) - 0.45) / 0.2));
        const green = blend(scale(c, 0.85 + 0.3 * patch), [c[0] * 1.5 + 0.03, c[1] * 1.15, c[2] * 0.7], clamp01(patch));
        const col = blend(scale(green, 0.85 + 0.25 * blades), [0.11, 0.07, 0.04], soil * 0.7);
        return [col, clamp01(0.5 + 0.4 * blades - 0.3 * soil)];
      }),
  },
  stone: {
    tile: 1.2,
    relief: 3,
    description: "dressed stone blocks in courses",
    make: (n, c) =>
      paint(n, (u, v) => {
        const rows = 4, perRow = 2;
        const row = Math.floor(v * rows);
        const fu = u * perRow + (row % 2 ? 0.5 : 0);
        const col = mod(Math.floor(fu), perRow);
        const bu = fu - Math.floor(fu), bv = v * rows - row;
        const joint = Math.min(edgeDistance(bu) * 0.6, edgeDistance(bv) * 0.3);
        const chip = 0.012 * (1 + fbm(u, v, 24, 24, 2, 101));
        const face = smooth(clamp01((joint - chip) / 0.01));
        const r = rand(col, row, 102);
        const rough = fbm(u, v, 12, 12, 4, 103 + col + row * 7);
        const block = scale(c, (0.82 + 0.3 * r) * (1 + 0.12 * rough));
        return [blend(scale(mortarFor(c), 0.85), block, face), clamp01(0.2 + 0.65 * face + 0.15 * rough * face)];
      }),
  },
  sand: {
    tile: 2.0,
    relief: 1,
    description: "sand with wind ripples",
    make: (n, c) =>
      paint(n, (u, v) => {
        const warp = fbm(u, v, 3, 3, 3, 111);
        const ripple = 0.5 + 0.5 * Math.sin((v * 24 + warp * 2.5) * Math.PI * 2);
        const grain = fbm(u, v, 128, 128, 1, 112);
        return [scale(c, 0.92 + 0.08 * ripple + 0.06 * grain + 0.05 * warp), clamp01(0.3 + 0.5 * ripple + 0.2 * grain)];
      }),
  },
  water: {
    tile: 6.0,
    relief: 3,
    description: "small waves and ripples",
    make: (n, c) =>
      paint(n, (u, v) => {
        const big = fbm(u, v, 4, 6, 3, 121);
        const small = fbm(u, v, 16, 24, 3, 122);
        return [scale(c, 0.95 + 0.08 * big), clamp01(0.5 + 0.35 * big + 0.15 * small)];
      }),
  },
  fabric: {
    tile: 0.3,
    relief: 1.4,
    description: "woven cloth: a plain weave of warp and weft threads, slightly uneven",
    make: (n, c) =>
      paint(n, (u, v) => {
        const threads = 48;
        const fu = u * threads, fv = v * threads;
        const iu = Math.floor(fu), iv = Math.floor(fv);
        const tu = fu - iu, tv = fv - iv;
        // Plain weave: in even cells the warp (along v) lies on top, in odd cells the weft.
        const warpUp = (iu + iv) % 2 === 0;
        const warp = Math.sin(tu * Math.PI), weft = Math.sin(tv * Math.PI);
        const h = warpUp ? 0.5 + 0.5 * warp * (0.6 + 0.4 * weft) : 0.5 + 0.5 * weft * (0.6 + 0.4 * warp);
        const slub = 1 + 0.07 * fbm(u, v, 4, 64, 2, 141) + 0.05 * fbm(u, v, 64, 4, 2, 142);
        const fuzz = 1 + 0.05 * fbm(u, v, 32, 32, 2, 143);
        return [scale(c, (0.82 + 0.3 * h) * slub * fuzz), clamp01(h)];
      }),
  },
  leather: {
    tile: 0.5,
    relief: 1.8,
    description: "leather: fine pebbled grain with soft creases",
    make: (n, c) =>
      paint(n, (u, v) => {
        const grain = cells(u, v, 40, 40, 151, 0.9);
        const pebble = smooth(clamp01((grain.f2 - grain.f1) / 0.25));
        const crease = 1 - smooth(clamp01(Math.abs(fbm(u, v, 3, 3, 3, 152)) / 0.06)) * 0.5;
        const tone = (0.84 + 0.2 * pebble + 0.1 * fbm(u, v, 4, 4, 3, 153)) * (0.9 + 0.1 * crease);
        return [scale(c, tone), clamp01(0.3 + 0.55 * pebble * crease + 0.15 * crease)];
      }),
  },
  painted: {
    tile: 1.0,
    relief: 0.35,
    description: "painted surface: a faint orange-peel ripple and slightly uneven gloss",
    make: (n, c) =>
      paint(n, (u, v) => {
        const peel = fbm(u, v, 24, 24, 3, 161);
        const mottle = fbm(u, v, 3, 3, 3, 162);
        return [scale(c, 0.96 + 0.05 * mottle + 0.015 * peel), clamp01(0.5 + 0.5 * peel)];
      }),
  },
  plastic: {
    tile: 0.5,
    relief: 0.4,
    description: "moulded plastic: a fine spark-eroded texture",
    make: (n, c) =>
      paint(n, (u, v) => {
        const fine = fbm(u, v, 96, 96, 2, 171);
        const spot = cells(u, v, 60, 60, 172, 1);
        const pit = 1 - 0.5 * smooth(clamp01(1 - spot.f1 / 0.3));
        return [scale(c, 0.95 + 0.04 * fine + 0.04 * pit + 0.02 * fbm(u, v, 3, 3, 2, 173)), clamp01(0.5 + 0.3 * fine + 0.2 * (pit - 0.75))];
      }),
  },
  brushed: {
    tile: 0.6,
    relief: 0.5,
    description: "brushed metal: fine streaks along u",
    make: (n, c) =>
      paint(n, (u, v) => {
        const streak = fbm(u, v, 2, 160, 3, 181);
        const wide = fbm(u, v, 1, 12, 2, 182);
        return [scale(c, 0.93 + 0.08 * streak + 0.04 * wide), clamp01(0.5 + 0.5 * streak)];
      }),
  },
  rust: {
    tile: 1.0,
    relief: 1.6,
    description: "rusted steel: blotches of orange and dark oxide with pits",
    make: (n, c) =>
      paint(n, (u, v) => {
        const blotch = smooth(clamp01((fbm(u, v, 4, 4, 4, 191) + 0.15) / 0.6));
        const pits = cells(u, v, 36, 36, 192, 1);
        const pit = smooth(clamp01(1 - pits.f1 / 0.22)) * ((pits.id >>> 24) / 255 > 0.6 ? 1 : 0);
        const orange: RGB = [c[0] * 1.35 + 0.02, c[1] * 0.95, c[2] * 0.6];
        const dark: RGB = [c[0] * 0.45, c[1] * 0.4, c[2] * 0.38];
        const col = blend(blend(dark, c, 0.5 + 0.5 * blotch), orange, 0.35 * blotch * (0.5 + 0.5 * fbm(u, v, 16, 16, 2, 193)));
        return [scale(col, 1 - 0.35 * pit), clamp01(0.55 + 0.2 * blotch - 0.45 * pit + 0.1 * fbm(u, v, 32, 32, 2, 194))];
      }),
  },
  ground: {
    tile: 4.0,
    relief: 1,
    description: "neutral ground detail, to be coloured by vertex colours",
    make: (n, c) =>
      paint(n, (u, v) => {
        const patch = fbm(u, v, 4, 4, 4, 131);
        const fine = fbm(u, v, 64, 64, 2, 132);
        const pebbles = cells(u, v, 48, 48, 133, 1);
        const pebble = (1 - smooth(clamp01(pebbles.f1 / 0.3))) * ((pebbles.id >>> 24) / 255 > 0.8 ? 1 : 0);
        return [scale(c, 0.88 + 0.12 * patch + 0.06 * fine + 0.12 * pebble), clamp01(0.5 + 0.25 * fine + 0.25 * pebble)];
      }),
  },
};

export const PATTERN_NAMES = Object.keys(PATTERNS);

// ---------------------------------------------------------------------------------------------------------------------
// Normal map and PNG.

/** A tangent-space normal map from a relief map, with wrap-around so it tiles. +Y points to the top of the image. */
export function normalMap(height: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  const h = (x: number, y: number): number => height[mod(y, size) * size + mod(x, size)] as number;
  const k = (strength * size) / 256;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel: slope along the image's right (+x) and down (+row).
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) / 8;
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) / 8;
      // The surface rises to the right by dx and towards the top of the image by -dy.
      const nx = -dx * k, ny = dy * k, l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 3;
      out[i] = Math.round((nx / l * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** Linear 0..1 to an sRGB byte. */
function srgbByte(v: number): number {
  const c = clamp01(v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

export { encodePng };

const cache = new Map<string, MaterialTextures>();

/** The colour and normal map of a pattern in a colour (linear RGB), made once per process. */
export function texturesFor(pattern: string, color: RGB, size = TEXTURE_SIZE): MaterialTextures {
  const p = Object.hasOwn(PATTERNS, pattern) ? PATTERNS[pattern] : undefined;
  if (!p) throw new Error(`unknown texture pattern "${pattern}" (known: ${PATTERN_NAMES.join(", ")})`);
  const key = `${pattern}|${color.map((v) => v.toFixed(4)).join(",")}|${size}`;
  const known = cache.get(key);
  if (known) return known;
  const out = p.make(size, color);
  const rgb = new Uint8Array(size * size * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = srgbByte(out.albedo[i] as number);
  const made: MaterialTextures = { albedo: encodePng(size, size, rgb), normal: encodePng(size, size, normalMap(out.height, size, p.relief)), tile: p.tile };
  cache.set(key, made);
  return made;
}
