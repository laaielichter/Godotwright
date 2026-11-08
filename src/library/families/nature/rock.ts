import { ellipsoid, group, int, num, rng, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import type { MaterialDef } from "../../palette.js";
import { cutPlanes, lumpExtent, n4, natureMats } from "./common.js";

type Style = "boulder" | "pile" | "slab" | "cliff" | "pebbles" | "split";

interface StyleDef {
  title: string;
  dutch: string;
  /** [default, min, max] of the size (width) and height in metres. */
  size: [number, number, number];
  height: [number, number, number];
  segments: number;
  lumps: number;
  /** Flat fractures on the main stone and on the smaller ones (0: water-worn, round). */
  cuts: number;
  smallCuts: number;
  text: string;
}

const STYLES: Record<Style, StyleDef> = {
  boulder: { title: "boulder", dutch: "zwerfkei", size: [1.6, 0.6, 4], height: [1.1, 0.4, 3], segments: 30, lumps: 0.32, cuts: 7, smallCuts: 5, text: "a big weathered boulder with a few flat, sharp-edged fracture faces and two broken stones at its foot" },
  pile: { title: "rock pile", dutch: "rotsblokken", size: [2.4, 1, 5], height: [1, 0.4, 2.2], segments: 26, lumps: 0.3, cuts: 10, smallCuts: 8, text: "a heap of angular, freshly broken rocks with flat fracture faces around one large block" },
  slab: { title: "flat rock slab", dutch: "platte steen", size: [2.2, 1, 3.5], height: [0.35, 0.25, 0.8], segments: 26, lumps: 0.15, cuts: 9, smallCuts: 7, text: "a broad, flat slab of bedded rock with broken, sharp edges and two smaller slabs overlapping its edge" },
  cliff: { title: "cliff chunk", dutch: "rotsblok", size: [3, 1.5, 8], height: [3.5, 1.5, 8], segments: 32, lumps: 0.38, cuts: 15, smallCuts: 9, text: "a tall chunk of cliff, faceted by many flat fractures with sharp edges, with two broken blocks leaning against its foot" },
  pebbles: { title: "pebble cluster", dutch: "kiezels", size: [0.7, 0.3, 1.5], height: [0.12, 0.05, 0.3], segments: 14, lumps: 0.12, cuts: 0, smallCuts: 0, text: "a cluster of smooth, rounded pebbles in two rings around a larger cobble" },
  split: { title: "split boulder", dutch: "gespleten kei", size: [2, 0.8, 4], height: [1.3, 0.5, 2.6], segments: 30, lumps: 0.3, cuts: 7, smallCuts: 6, text: "a boulder cracked clean in two: each half shows a flat split face across the narrow crack, with a fallen fragment" },
};

/** Finish and whether moss grows on top. */
interface Finish {
  key: string;
  stone: string;
  moss: boolean;
  dutch: string;
}

const FINISHES: Record<Style, Finish[]> = {
  boulder: [
    { key: "granite", stone: "granite", moss: false, dutch: "graniet" },
    { key: "sandstone", stone: "sandstone", moss: false, dutch: "zandsteen" },
    { key: "basalt", stone: "basalt", moss: false, dutch: "basalt" },
    { key: "lichen", stone: "lichen", moss: false, dutch: "korstmos" },
    { key: "mossy", stone: "granite", moss: true, dutch: "bemost" },
  ],
  pile: [
    { key: "granite", stone: "granite", moss: false, dutch: "graniet" },
    { key: "limestone", stone: "limestone", moss: false, dutch: "kalksteen" },
    { key: "slate", stone: "slate", moss: false, dutch: "leisteen" },
    { key: "red", stone: "red_rock", moss: false, dutch: "rode rots" },
    { key: "mossy", stone: "mossy_rock", moss: true, dutch: "bemost" },
  ],
  slab: [
    { key: "slate", stone: "slate", moss: false, dutch: "leisteen" },
    { key: "sandstone", stone: "sandstone", moss: false, dutch: "zandsteen" },
    { key: "limestone", stone: "limestone", moss: false, dutch: "kalksteen" },
    { key: "red", stone: "sandstone_red", moss: false, dutch: "rode zandsteen" },
    { key: "mossy", stone: "granite", moss: true, dutch: "bemost" },
  ],
  cliff: [
    { key: "granite", stone: "granite", moss: false, dutch: "graniet" },
    { key: "basalt", stone: "basalt", moss: false, dutch: "basalt" },
    { key: "red", stone: "red_rock", moss: false, dutch: "rode rots" },
    { key: "chalk", stone: "chalk", moss: false, dutch: "krijt" },
    { key: "mossy", stone: "mossy_rock", moss: true, dutch: "bemost" },
  ],
  pebbles: [
    { key: "river", stone: "granite", moss: false, dutch: "rivierkeien" },
    { key: "quartz", stone: "quartz", moss: false, dutch: "kwarts" },
    { key: "slate", stone: "slate", moss: false, dutch: "leisteen" },
    { key: "sandstone", stone: "sandstone", moss: false, dutch: "zandsteen" },
    { key: "mossy", stone: "limestone", moss: true, dutch: "bemost" },
  ],
  split: [
    { key: "granite", stone: "granite", moss: false, dutch: "graniet" },
    { key: "limestone", stone: "limestone", moss: false, dutch: "kalksteen" },
    { key: "basalt", stone: "basalt", moss: false, dutch: "basalt" },
    { key: "lichen", stone: "lichen", moss: false, dutch: "korstmos" },
    { key: "mossy", stone: "mossy_rock", moss: true, dutch: "bemost" },
  ],
};

/**
 * One stone: a lumpy ellipsoid with radii in terms of $size and $height, lifted so its lowest point is exactly y = 0
 * (the lumps scale every direction by a factor that does not depend on the radii, so the depth is ry * low).
 */
function stone(name: string, rx: string, ryRaw: string, rz: string, x: string, z: string, seed: number, segments: number, lumps: number, moss: boolean, extra: { turn?: string; repeat?: SpecNode["repeat"]; flat?: number; material?: string; cuts?: number } = {}): SpecNode {
  const cuts = extra.cuts ?? 0;
  // Fractures move the lowest point: measure the cut stone, so it still rests exactly on y = 0.
  const e = lumpExtent(segments, lumps, seed, cuts);
  // Very flat or very tall lumpy shapes fold over themselves: keep the height within reach of the width.
  const ry = `min(max(${ryRaw}, (${rx}) * ${n4(extra.flat ?? 0.3)}), (${rx}) * 3)`;
  // Moss grows in ragged cushions over the top and down the shaded (-z) side, not as a neat cap.
  const children: SpecNode[] = moss
    ? [
        ellipsoid("Moss", [`(${rx}) * 0.72`, `max((${ry}) * 0.26, (${rx}) * 0.17)`, `(${rz}) * 0.66`], { at: [`(${rx}) * 0.08`, `(${ry}) * ${n4(e.high * 0.74)}`, `-(${rz}) * 0.1`], segments: 16, lumps: 0.32, seed: seed + 1, material: "moss" }),
        ellipsoid("Moss_Light", [`(${rx}) * 0.34`, `max((${ry}) * 0.16, (${rx}) * 0.12)`, `(${rz}) * 0.3`], { at: [`(${rx}) * 0.22`, `(${ry}) * ${n4(e.high * 0.86)}`, `(${rz}) * 0.12`], segments: 12, lumps: 0.3, seed: seed + 2, material: "moss_light" }),
        ellipsoid("Moss_Side", [`(${rx}) * 0.5`, `(${ry}) * 0.42`, `(${rz}) * 0.36`], { at: [`-(${rx}) * 0.1`, `(${ry}) * ${n4(e.high * 0.3)}`, `-(${rz}) * 0.62`], segments: 14, lumps: 0.45, seed: seed + 3, material: "moss" }),
      ]
    : [];
  const node = ellipsoid(name, [rx, ry, rz], {
    at: [x, `(${ry}) * ${n4(e.low)}`, z],
    rotate: extra.turn ? [0, extra.turn, 0] : undefined,
    ...(extra.material ? { material: extra.material } : {}),
    segments,
    lumps,
    seed,
    children,
    ...(extra.repeat ? { repeat: extra.repeat as { count: string; around: "y" } } : {}),
  });
  return cuts > 0 ? { ...node, cuts } : node;
}

/**
 * One half of a split boulder: a seed whose middle fracture (always close to vertical for an odd cut count) is deep,
 * the turn about y that points that face at the other half, and how far the face lies from the centre (in $size, for
 * radii $size * 0.2 across x and $size * 0.3 along z), so the two faces can be set a narrow crack apart.
 */
function splitHalf(start: number, cuts: number, faceTo: 1 | -1): { seed: number; turn: string; reach: number } {
  let best = { seed: start, turn: "0", reach: 0.2, depth: 2 };
  for (let k = 0; k < 160; k++) {
    const seed = start + k * 7;
    const plane = cutPlanes(seed, cuts)[(cuts - 1) / 2]!;
    if (Math.abs(plane.n[1]) > 0.12 || plane.offset >= best.depth) continue;
    const wx = plane.n[0] / 0.2, wz = plane.n[2] / 0.3;
    const phi = (Math.atan2(wz, wx) * 180) / Math.PI;
    // A turn of t degrees about y moves a direction at angle phi (from +x toward +z) to phi - t.
    const turn = faceTo > 0 ? phi : phi - 180;
    best = { seed, turn: n4(Math.round(turn * 10) / 10), reach: plane.offset / Math.hypot(wx, wz), depth: plane.offset };
  }
  return best;
}

/**
 * Natural rock in real albedos: granite is a speckled mid grey (light feldspar and dark mica grains, the "asphalt"
 * pattern), basalt and slate are near black, limestone and chalk a weathered grey-beige well below white. Fine-grained
 * stones get the pitted "concrete" surface. Every stone has a second, dirtier tone for the smaller blocks.
 */
const ROCK: Record<string, { color: [number, number, number]; texture: string; roughness: number }> = {
  granite: { color: [0.11, 0.106, 0.1], texture: "asphalt", roughness: 0.88 },
  basalt: { color: [0.042, 0.041, 0.04], texture: "asphalt", roughness: 0.85 },
  sandstone: { color: [0.18, 0.124, 0.068], texture: "asphalt", roughness: 0.95 },
  limestone: { color: [0.165, 0.157, 0.137], texture: "asphalt", roughness: 0.9 },
  slate: { color: [0.05, 0.054, 0.061], texture: "concrete", roughness: 0.8 },
  red_rock: { color: [0.15, 0.064, 0.035], texture: "asphalt", roughness: 0.95 },
  mossy_rock: { color: [0.078, 0.079, 0.066], texture: "asphalt", roughness: 0.95 },
  lichen: { color: [0.105, 0.11, 0.088], texture: "asphalt", roughness: 0.97 },
  sandstone_red: { color: [0.16, 0.074, 0.042], texture: "asphalt", roughness: 0.95 },
  chalk: { color: [0.25, 0.24, 0.212], texture: "concrete", roughness: 0.92 },
  quartz: { color: [0.21, 0.206, 0.196], texture: "concrete", roughness: 0.55 },
};

function rockMaterials(stone: string, fine: boolean): Record<string, MaterialDef> {
  const base = ROCK[stone] ?? ROCK.granite!;
  // Small pebbles are worn smooth: no coarse crystal speckle.
  const r = fine ? { ...base, texture: "concrete" } : base;
  const [cr, cg, cb] = r.color;
  const q = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    [stone]: { color: r.color, metallic: 0, roughness: r.roughness, texture: r.texture },
    // Smaller, lower stones: a little darker and browner, with soil and grime.
    [`${stone}_dirty`]: { color: [q(cr * 0.8 + 0.008), q(cg * 0.76 + 0.005), q(cb * 0.7 + 0.002)], metallic: 0, roughness: Math.min(1, r.roughness + 0.04), texture: r.texture },
  };
}

function rockAsset(style: Style, f: Finish, index: number): AssetDraft {
  const st = STYLES[style];
  const r = rng(index * 3301 + 29);
  const seed = (): number => Math.floor(r() * 90000) + 1;
  const turn = (): string => n4(Math.round(r() * 360));
  const { segments: seg, lumps } = st;
  const moss = f.moss;
  const dirty = `${f.stone}_dirty`;
  const nodes: SpecNode[] = [];
  const params = [
    num("size", st.size[0], st.size[1], st.size[2], "Width of the whole rock group across, in metres."),
    num("height", st.height[0], st.height[1], st.height[2], "Height of the main stone in metres."),
  ];
  const c1 = st.cuts, c2 = st.smallCuts;
  switch (style) {
    case "boulder":
      nodes.push(
        stone("Rock_1", "$size * 0.38", "$height * 0.48", "$size * 0.32", "0", "0", seed(), seg, lumps, moss, { turn: turn(), cuts: c1 }),
        stone("Rock_2", "$size * 0.12", "$height * 0.14", "$size * 0.1", "$size * 0.36", "$size * 0.16", seed(), 18, 0.35, false, { turn: turn(), material: dirty, cuts: c2 }),
        stone("Rock_3", "$size * 0.08", "$height * 0.09", "$size * 0.07", "-$size * 0.22", "$size * 0.28", seed(), 16, 0.35, false, { turn: turn(), material: dirty, cuts: c2 }),
      );
      break;
    case "pile": {
      const ring = seed();
      nodes.push(
        stone("Rock_Main", "$size * 0.24", "$height * 0.5", "$size * 0.2", "0", "0", seed(), seg, lumps, moss, { turn: turn(), cuts: c1 }),
        stone("Rock_{i}", "$size * (0.13 + 0.04 * sin($i * 2.3))", "$height * (0.26 + 0.1 * sin($i * 1.7 + 1))", "$size * (0.11 + 0.03 * cos($i * 1.9))", "$size * 0.27", "0", ring, 20, 0.32, moss, {
          turn: "$i * 67",
          material: dirty,
          repeat: { count: "$stones", around: "y", phase: Math.round(r() * 40) },
          cuts: c2,
        }),
      );
      params.push(int("stones", 6, 4, 9, "Number of rocks around the main block."));
      break;
    }
    case "slab":
      nodes.push(
        stone("Rock_1", "$size * 0.4", "$height * 0.5", "$size * 0.3", "0", "0", seed(), seg, lumps, moss, { turn: turn(), flat: 0.12, cuts: c1 }),
        stone("Rock_2", "$size * 0.2", "$height * 0.32", "$size * 0.16", "$size * 0.34", "$size * 0.12", seed(), 20, lumps, false, { turn: turn(), flat: 0.12, material: dirty, cuts: c2 }),
        stone("Rock_3", "$size * 0.15", "$height * 0.26", "$size * 0.12", "-$size * 0.3", "-$size * 0.16", seed(), 20, lumps, false, { turn: turn(), flat: 0.12, material: dirty, cuts: c2 }),
      );
      break;
    case "cliff":
      nodes.push(
        stone("Rock_1", "$size * 0.32", "$height * 0.5", "$size * 0.26", "0", "0", seed(), seg, lumps, moss, { turn: turn(), cuts: c1 }),
        stone("Rock_2", "$size * 0.18", "$height * 0.2", "$size * 0.16", "$size * 0.3", "$size * 0.12", seed(), 20, 0.4, false, { turn: turn(), material: dirty, cuts: c2 }),
        stone("Rock_3", "$size * 0.14", "$height * 0.14", "$size * 0.12", "-$size * 0.24", "$size * 0.2", seed(), 18, 0.4, false, { turn: turn(), material: dirty, cuts: c2 }),
      );
      break;
    case "pebbles": {
      const inner = seed(), outer = seed();
      nodes.push(
        stone("Rock_Cobble", "$size * 0.17", "$height * 0.5", "$size * 0.14", "0", "0", seed(), 18, lumps, moss, { turn: turn() }),
        stone("Rock_{i}", "$size * (0.1 + 0.02 * sin($i * 2.1))", "$height * (0.3 + 0.08 * sin($i * 1.3))", "$size * 0.08", "$size * 0.2", "0", inner, seg, lumps, false, { turn: "$i * 53", repeat: { count: 5, around: "y", phase: 10 } }),
        stone("Rock_Outer_{i}", "$size * (0.075 + 0.02 * sin($i * 1.7))", "$height * (0.22 + 0.06 * cos($i * 2.2))", "$size * 0.06", "$size * 0.33", "0", outer, seg, lumps, false, { turn: "$i * 41", repeat: { count: "$pebbles", around: "y", phase: 25 }, material: dirty }),
      );
      params.push(int("pebbles", 10, 6, 14, "Number of pebbles in the outer ring."));
      break;
    }
    case "split": {
      // The two halves turn their deepest upright fracture toward each other, a crack of 4-5 % of the width apart.
      const right = splitHalf(seed(), c1, -1), left = splitHalf(seed(), c1, 1);
      nodes.push(
        stone("Rock_1", "$size * 0.2", "$height * 0.48", "$size * 0.3", `$size * ${n4(0.022 + right.reach)}`, "0", right.seed, seg, lumps, moss, { turn: right.turn, cuts: c1 }),
        stone("Rock_2", "$size * 0.2", "$height * 0.46", "$size * 0.3", `-$size * ${n4(0.022 + left.reach)}`, "$size * 0.02", left.seed, seg, lumps, moss, { turn: left.turn, cuts: c1 }),
        stone("Rock_3", "$size * 0.09", "$height * 0.12", "$size * 0.08", "$size * 0.04", "$size * 0.36", seed(), 16, 0.35, false, { turn: turn(), material: dirty, cuts: c2 }),
      );
      break;
    }
  }
  const count = nodes.length;
  return {
    slug: slugify("rock", style, f.key),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${st.title}`,
    description: `${st.text.charAt(0).toUpperCase()}${st.text.slice(1)}, in ${f.stone.replace(/_/g, " ")}${moss ? ", with moss growing over the top" : ""}. Every stone is its own node and rests on y = 0; the group faces +z.`,
    tags: [style, st.dutch, f.key, f.dutch, f.stone.replace(/_/g, " "), ...(moss ? ["moss", "mos"] : []), ...(count > 2 ? ["rocks", "stenen"] : [])],
    params,
    materials: { ...rockMaterials(f.stone, style === "pebbles"), ...(moss ? natureMats(mats, "moss", "moss_light") : {}) },
    nodes: [group("Rocks", nodes, { material: f.stone })],
  };
}

export const rockFamily: Family = {
  id: "rock",
  category: "nature",
  archetype: "prop.rock",
  tags: ["rock", "rots", "stone", "steen", "boulder", "kei", "nature", "natuur", "landscape", "landschap"],
  assets: () => {
    const out: AssetDraft[] = [];
    let k = 0;
    for (const style of Object.keys(STYLES) as Style[]) for (const f of FINISHES[style]) out.push(rockAsset(style, f, k++));
    return out;
  },
};
