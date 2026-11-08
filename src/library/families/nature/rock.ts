import { ellipsoid, group, int, num, rng, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import type { MaterialDef } from "../../palette.js";
import { lumpExtent, n4, natureMats } from "./common.js";

type Style = "boulder" | "pile" | "slab" | "cliff" | "pebbles" | "split";

interface StyleDef {
  title: string;
  dutch: string;
  /** [default, min, max] of the size (width) and height in metres. */
  size: [number, number, number];
  height: [number, number, number];
  segments: number;
  lumps: number;
  text: string;
}

const STYLES: Record<Style, StyleDef> = {
  boulder: { title: "boulder", dutch: "zwerfkei", size: [1.6, 0.6, 4], height: [1.1, 0.4, 3], segments: 20, lumps: 0.4, text: "a big rounded boulder with two smaller stones at its foot" },
  pile: { title: "rock pile", dutch: "rotsblokken", size: [2.4, 1, 5], height: [1, 0.4, 2.2], segments: 16, lumps: 0.45, text: "a heap of angular rocks around one large block" },
  slab: { title: "flat rock slab", dutch: "platte steen", size: [2.2, 1, 3.5], height: [0.35, 0.25, 0.8], segments: 12, lumps: 0.15, text: "a broad, flat slab of rock with two smaller slabs overlapping its edge" },
  cliff: { title: "cliff chunk", dutch: "rotsblok", size: [3, 1.5, 8], height: [3.5, 1.5, 8], segments: 10, lumps: 0.5, text: "a tall, faceted chunk of cliff with two broken blocks leaning against its foot" },
  pebbles: { title: "pebble cluster", dutch: "kiezels", size: [0.7, 0.3, 1.5], height: [0.12, 0.05, 0.3], segments: 10, lumps: 0.12, text: "a cluster of smooth, rounded pebbles in two rings around a larger cobble" },
  split: { title: "split boulder", dutch: "gespleten kei", size: [2, 0.8, 4], height: [1.3, 0.5, 2.6], segments: 18, lumps: 0.35, text: "a boulder cracked clean in two, the halves leaning apart, with a fallen fragment" },
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
function stone(name: string, rx: string, ryRaw: string, rz: string, x: string, z: string, seed: number, segments: number, lumps: number, moss: boolean, extra: { turn?: string; repeat?: SpecNode["repeat"]; flat?: number } = {}): SpecNode {
  const e = lumpExtent(segments, lumps, seed);
  // Very flat or very tall lumpy shapes fold over themselves: keep the height within reach of the width.
  const ry = `min(max(${ryRaw}, (${rx}) * ${n4(extra.flat ?? 0.3)}), (${rx}) * 3)`;
  const children: SpecNode[] = moss
    ? [ellipsoid("Moss", [`(${rx}) * 0.78`, `max((${ry}) * 0.28, (${rx}) * 0.13)`, `(${rz}) * 0.78`], { at: [0, `(${ry}) * ${n4(e.high * 0.72)}`, 0], segments: 14, lumps: 0.15, seed: seed + 1, material: "moss" })]
    : [];
  return ellipsoid(name, [rx, ry, rz], {
    at: [x, `(${ry}) * ${n4(e.low)}`, z],
    rotate: extra.turn ? [0, extra.turn, 0] : undefined,
    segments,
    lumps,
    seed,
    children,
    ...(extra.repeat ? { repeat: extra.repeat as { count: string; around: "y" } } : {}),
  });
}

/** Natural rock: a speckled surface (the palette's "stone" pattern is dressed masonry), pale colours toned to grey-beige. */
function weathered(m: MaterialDef): MaterialDef {
  const [r, g, b] = m.color;
  const top = Math.max(r, g, b);
  const k = top > 0.26 ? 0.26 / top : 1;
  // A touch of warm grey mixed in, so a white stone does not render as flat white.
  const mix = (c: number, warm: number): number => Math.round((c * k * 0.85 + warm * 0.15) * 1000) / 1000;
  return { ...m, color: [mix(r, 0.24), mix(g, 0.21), mix(b, 0.17)], roughness: Math.max(m.roughness, 0.92), texture: "concrete" };
}

function rockAsset(style: Style, f: Finish, index: number): AssetDraft {
  const st = STYLES[style];
  const r = rng(index * 3301 + 29);
  const seed = (): number => Math.floor(r() * 90000) + 1;
  const turn = (): string => n4(Math.round(r() * 360));
  const { segments: seg, lumps } = st;
  const moss = f.moss;
  const nodes: SpecNode[] = [];
  const params = [
    num("size", st.size[0], st.size[1], st.size[2], "Width of the whole rock group across, in metres."),
    num("height", st.height[0], st.height[1], st.height[2], "Height of the main stone in metres."),
  ];
  switch (style) {
    case "boulder":
      nodes.push(
        stone("Rock_1", "$size * 0.38", "$height * 0.48", "$size * 0.32", "0", "0", seed(), seg, lumps, moss, { turn: turn() }),
        stone("Rock_2", "$size * 0.12", "$height * 0.14", "$size * 0.1", "$size * 0.36", "$size * 0.16", seed(), 12, 0.45, false, { turn: turn() }),
        stone("Rock_3", "$size * 0.08", "$height * 0.09", "$size * 0.07", "-$size * 0.22", "$size * 0.28", seed(), 10, 0.45, false, { turn: turn() }),
      );
      break;
    case "pile": {
      const ring = seed();
      nodes.push(
        stone("Rock_Main", "$size * 0.24", "$height * 0.5", "$size * 0.2", "0", "0", seed(), seg, lumps, moss, { turn: turn() }),
        stone("Rock_{i}", "$size * (0.13 + 0.04 * sin($i * 2.3))", "$height * (0.26 + 0.1 * sin($i * 1.7 + 1))", "$size * (0.11 + 0.03 * cos($i * 1.9))", "$size * 0.27", "0", ring, 12, 0.5, moss, {
          turn: "$i * 67",
          repeat: { count: "$stones", around: "y", phase: Math.round(r() * 40) },
        }),
      );
      params.push(int("stones", 6, 4, 9, "Number of rocks around the main block."));
      break;
    }
    case "slab":
      nodes.push(
        stone("Rock_1", "$size * 0.4", "$height * 0.5", "$size * 0.3", "0", "0", seed(), seg, lumps, moss, { turn: turn(), flat: 0.12 }),
        stone("Rock_2", "$size * 0.2", "$height * 0.32", "$size * 0.16", "$size * 0.34", "$size * 0.12", seed(), 12, lumps, false, { turn: turn(), flat: 0.12 }),
        stone("Rock_3", "$size * 0.15", "$height * 0.26", "$size * 0.12", "-$size * 0.3", "-$size * 0.16", seed(), 12, lumps, false, { turn: turn(), flat: 0.12 }),
      );
      break;
    case "cliff":
      nodes.push(
        stone("Rock_1", "$size * 0.32", "$height * 0.5", "$size * 0.26", "0", "0", seed(), seg, lumps, moss, { turn: turn() }),
        stone("Rock_2", "$size * 0.18", "$height * 0.2", "$size * 0.16", "$size * 0.3", "$size * 0.12", seed(), 9, 0.5, false, { turn: turn() }),
        stone("Rock_3", "$size * 0.14", "$height * 0.14", "$size * 0.12", "-$size * 0.24", "$size * 0.2", seed(), 8, 0.5, false, { turn: turn() }),
      );
      break;
    case "pebbles": {
      const inner = seed(), outer = seed();
      nodes.push(
        stone("Rock_Cobble", "$size * 0.17", "$height * 0.5", "$size * 0.14", "0", "0", seed(), 14, lumps, moss, { turn: turn() }),
        stone("Rock_{i}", "$size * (0.1 + 0.02 * sin($i * 2.1))", "$height * (0.3 + 0.08 * sin($i * 1.3))", "$size * 0.08", "$size * 0.2", "0", inner, seg, lumps, false, { turn: "$i * 53", repeat: { count: 5, around: "y", phase: 10 } }),
        stone("Rock_Outer_{i}", "$size * (0.075 + 0.02 * sin($i * 1.7))", "$height * (0.22 + 0.06 * cos($i * 2.2))", "$size * 0.06", "$size * 0.33", "0", outer, seg, lumps, false, { turn: "$i * 41", repeat: { count: "$pebbles", around: "y", phase: 25 } }),
      );
      params.push(int("pebbles", 10, 6, 14, "Number of pebbles in the outer ring."));
      break;
    }
    case "split":
      nodes.push(
        stone("Rock_1", "$size * 0.2", "$height * 0.48", "$size * 0.3", "$size * 0.19", "0", seed(), seg, lumps, moss, { turn: "6" }),
        stone("Rock_2", "$size * 0.19", "$height * 0.45", "$size * 0.29", "-$size * 0.19", "0", seed(), seg, lumps, moss, { turn: "-8" }),
        stone("Rock_3", "$size * 0.09", "$height * 0.12", "$size * 0.08", "$size * 0.02", "$size * 0.33", seed(), 10, 0.45, false, { turn: turn() }),
      );
      break;
  }
  const count = nodes.length;
  return {
    slug: slugify("rock", style, f.key),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${st.title}`,
    description: `${st.text.charAt(0).toUpperCase()}${st.text.slice(1)}, in ${f.stone.replace(/_/g, " ")}${moss ? ", with moss growing over the top" : ""}. Every stone is its own node and rests on y = 0; the group faces +z.`,
    tags: [style, st.dutch, f.key, f.dutch, f.stone.replace(/_/g, " "), ...(moss ? ["moss", "mos"] : []), ...(count > 2 ? ["rocks", "stenen"] : [])],
    params,
    // Natural rock: the palette colour with a weathered, speckled surface (the "stone" pattern is dressed masonry).
    // Pale stones (chalk, limestone, quartz) are toned down a little so they read as weathered rock, not plaster.
    materials: Object.fromEntries(Object.entries(natureMats(mats, f.stone, ...(moss ? ["moss"] : []))).map(([k, v]) => [k, k === f.stone ? weathered(v) : v])),
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
