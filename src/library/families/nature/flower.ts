import { cyl, ellipsoid, group, int, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { n4, natureMats } from "./common.js";

type Kind = "tulip" | "sunflower" | "daisy" | "rose" | "lily";

interface Flower {
  kind: Kind;
  key: string;
  title: string;
  dutch: string;
  petal: string;
  centre: string;
  height: [number, number, number];
  head: [number, number, number];
  petals?: [number, number, number];
  /** A bunch of this many stems (a count parameter), or a single flower. */
  cluster?: [number, number, number];
  text: string;
}

const FLOWERS: Flower[] = [
  { kind: "tulip", key: "red", title: "Red tulip", dutch: "rode tulp", petal: "petal_red", centre: "stamen_dark", height: [0.4, 0.25, 0.6], head: [0.035, 0.025, 0.05], text: "a red tulip: a closed cup of six petals in two rings on a straight stem, with broad, arching grey-green leaves" },
  { kind: "tulip", key: "yellow", title: "Yellow tulip", dutch: "gele tulp", petal: "petal_yellow", centre: "stamen_dark", height: [0.38, 0.25, 0.6], head: [0.033, 0.025, 0.05], text: "a yellow tulip: a closed cup of six petals in two rings on a straight stem, with broad, arching leaves" },
  { kind: "tulip", key: "bunch", title: "Bunch of pink tulips", dutch: "bos roze tulpen", petal: "petal_pink", centre: "stamen_dark", height: [0.42, 0.25, 0.6], head: [0.034, 0.025, 0.05], cluster: [7, 3, 12], text: "a clump of pink tulips on stems leaning slightly outward, with broad leaves at their feet" },
  { kind: "sunflower", key: "tall", title: "Tall sunflower", dutch: "zonnebloem", petal: "petal_yellow", centre: "seed_disc", height: [1.8, 1, 2.5], head: [0.15, 0.08, 0.22], petals: [22, 14, 30], text: "a tall sunflower: a thick, hairy stem with big heart-shaped leaves and a heavy head turned to the front, a brown seed disc ringed by two rows of yellow rays" },
  { kind: "sunflower", key: "dwarf", title: "Dwarf sunflower", dutch: "dwergzonnebloem", petal: "petal_orange", centre: "seed_disc", height: [0.6, 0.4, 1], head: [0.08, 0.05, 0.12], petals: [18, 12, 26], text: "a short garden sunflower with an orange-gold head facing the front over broad leaves" },
  { kind: "daisy", key: "white", title: "White daisy", dutch: "margriet", petal: "petal_white", centre: "pollen", height: [0.45, 0.2, 0.8], head: [0.035, 0.02, 0.06], petals: [20, 12, 28], text: "an ox-eye daisy: a ring of slender white rays round a domed yellow heart on a thin, branching stem" },
  { kind: "daisy", key: "echinacea", title: "Purple coneflower", dutch: "zonnehoed", petal: "petal_purple", centre: "fungus_shelf", height: [0.7, 0.4, 1.1], head: [0.05, 0.03, 0.07], petals: [14, 10, 20], text: "a purple coneflower: drooping pink-purple rays round a tall, spiky orange-brown cone" },
  { kind: "daisy", key: "patch", title: "Daisy patch", dutch: "madeliefjes", petal: "petal_white", centre: "pollen", height: [0.15, 0.1, 0.3], head: [0.015, 0.01, 0.025], petals: [16, 12, 22], cluster: [9, 5, 14], text: "a low patch of small daisies on short stems among a rosette of leaves" },
  { kind: "rose", key: "red", title: "Red rose", dutch: "rode roos", petal: "petal_red", centre: "petal_red", height: [0.6, 0.35, 1], head: [0.04, 0.03, 0.06], petals: [5, 4, 7], text: "a red garden rose: a full, cupped bloom of three rings of curled petals on a green calyx, with compound leaves on a slender stem" },
  { kind: "rose", key: "pink", title: "Pink rose", dutch: "roze roos", petal: "petal_pink", centre: "petal_pink", height: [0.55, 0.35, 1], head: [0.045, 0.03, 0.06], petals: [6, 4, 7], text: "a pink rose: an open, cupped bloom of layered petals on a slender stem with compound leaves" },
  { kind: "rose", key: "white", title: "White rose", dutch: "witte roos", petal: "petal_white", centre: "petal_white", height: [0.6, 0.35, 1], head: [0.04, 0.03, 0.06], petals: [5, 4, 7], text: "a white rose: a tight, high-centred bloom of curled petals on a slender stem with compound leaves" },
  { kind: "lily", key: "white", title: "White lily", dutch: "witte lelie", petal: "petal_white", centre: "stamen_dark", height: [0.9, 0.5, 1.4], head: [0.08, 0.05, 0.11], petals: [6, 6, 6], text: "a white lily: six long, flaring petals curling back from a trumpet, with six dark-tipped stamens, on a tall leafy stem" },
  { kind: "lily", key: "tiger", title: "Orange tiger lily", dutch: "tijgerlelie", petal: "petal_orange", centre: "stamen_dark", height: [1, 0.6, 1.5], head: [0.07, 0.05, 0.1], petals: [6, 6, 6], text: "an orange tiger lily: six strongly recurved petals and long stamens, on a tall stem with narrow leaves" },
  { kind: "tulip", key: "purple", title: "Purple tulip", dutch: "paarse tulp", petal: "petal_purple", centre: "stamen_dark", height: [0.45, 0.25, 0.6], head: [0.036, 0.025, 0.05], text: "a deep purple tulip: a tall, closed cup of six petals on a straight stem, with broad, arching leaves" },
  { kind: "rose", key: "bunch", title: "Bunch of red roses", dutch: "bos rode rozen", petal: "petal_red", centre: "petal_red", height: [0.55, 0.35, 0.9], head: [0.035, 0.025, 0.05], petals: [5, 4, 7], cluster: [5, 3, 9], text: "a small bunch of red roses on stems leaning outward, with compound leaves" },
  { kind: "daisy", key: "blue-aster", title: "Blue aster", dutch: "aster", petal: "petal_blue", centre: "pollen", height: [0.5, 0.3, 0.8], head: [0.03, 0.02, 0.045], petals: [24, 16, 30], text: "a blue aster: a ring of many fine blue rays round a small yellow heart on a slim stem" },
];

/** Petals and centre of a head, facing +y, in terms of $hr (head radius) and $np (petal count). */
function head(f: Flower): SpecNode[] {
  switch (f.kind) {
    case "tulip":
      return [
        ellipsoid("Petal_{i}", ["$hr * 0.16 + 0.002", "$hr * 1.15", "$hr * 0.62"], { at: ["$hr * 0.48", "$hr * 1.0", 0], rotate: [0, 0, 7], segments: 12, repeat: { count: 3, around: "y", phase: 0 } }),
        ellipsoid("PetalInner_{i}", ["$hr * 0.15 + 0.002", "$hr * 1.1", "$hr * 0.58"], { at: ["$hr * 0.36", "$hr * 1.05", 0], rotate: [0, 0, 5], segments: 12, repeat: { count: 3, around: "y", phase: 60 } }),
        cyl("Centre", "$hr * 0.2", "$hr * 1.2", { at: [0, "$hr * 0.7", 0], segments: 8, material: f.centre }),
        ellipsoid("Base", ["$hr * 0.45", "$hr * 0.3", "$hr * 0.45"], { at: [0, "$hr * 0.2", 0], segments: 10, material: f.petal }),
      ];
    case "sunflower":
      return [
        cyl("Centre", "$hr * 0.55", "$hr * 0.16", { at: [0, "$hr * 0.08", 0], segments: 24, bevel: "$hr * 0.05", material: f.centre }),
        ellipsoid("Seeds", ["$hr * 0.5", "$hr * 0.08", "$hr * 0.5"], { at: [0, "$hr * 0.16", 0], segments: 18, material: f.centre }),
        ellipsoid("Petal_{i}", ["$hr * 0.3", "$hr * 0.02 + 0.002", "$hr * 0.09"], { at: ["$hr * 0.8", "$hr * 0.08", 0], rotate: [0, 0, "6 + 4 * sin($i * 2.1)"], segments: 10, repeat: { count: "$np", around: "y", phase: 0 } }),
        ellipsoid("PetalBack_{i}", ["$hr * 0.28", "$hr * 0.02 + 0.002", "$hr * 0.09"], { at: ["$hr * 0.76", "$hr * 0.03", 0], rotate: [0, 0, "-4 + 3 * sin($i * 1.7)"], segments: 10, repeat: { count: "$np", around: "y", phase: 180 / 22 } }),
        ellipsoid("Bracts", ["$hr * 0.6", "$hr * 0.12", "$hr * 0.6"], { at: [0, "-$hr * 0.02", 0], segments: 16, material: "sepal_green" }),
      ];
    case "daisy":
      return [
        ellipsoid("Centre", ["$hr * 0.32", f.key === "echinacea" ? "$hr * 0.45" : "$hr * 0.18", "$hr * 0.32"], { at: [0, f.key === "echinacea" ? "$hr * 0.2" : "$hr * 0.06", 0], segments: 14, material: f.centre }),
        ellipsoid("Petal_{i}", ["$hr * 0.42", "$hr * 0.03 + 0.001", "$hr * 0.08"], { at: ["$hr * 0.68", 0, 0], rotate: [0, 0, f.key === "echinacea" ? "-28 + 6 * sin($i * 2.3)" : "4 * sin($i * 2.3)"], segments: 8, repeat: { count: "$np", around: "y", phase: 0 } }),
        ellipsoid("Calyx", ["$hr * 0.34", "$hr * 0.12", "$hr * 0.34"], { at: [0, "-$hr * 0.08", 0], segments: 10, material: "sepal_green" }),
      ];
    case "rose":
      return [
        ellipsoid("Petal_{i}", ["$hr * 0.12 + 0.002", "$hr * 0.6", "$hr * 0.52"], { at: ["$hr * 0.62", "$hr * 0.55", 0], rotate: [0, 0, -24], segments: 12, repeat: { count: "$np", around: "y", phase: 0 } }),
        ellipsoid("PetalMid_{i}", ["$hr * 0.1 + 0.002", "$hr * 0.55", "$hr * 0.42"], { at: ["$hr * 0.42", "$hr * 0.68", 0], rotate: [0, 0, -6], segments: 12, repeat: { count: "$np", around: "y", phase: 36 } }),
        ellipsoid("PetalInner_{i}", ["$hr * 0.09 + 0.002", "$hr * 0.45", "$hr * 0.3"], { at: ["$hr * 0.22", "$hr * 0.78", 0], rotate: [0, 0, 8], segments: 10, repeat: { count: 4, around: "y", phase: 15 } }),
        ellipsoid("Centre", ["$hr * 0.2", "$hr * 0.38", "$hr * 0.2"], { at: [0, "$hr * 0.8", 0], segments: 10, material: f.centre }),
        ellipsoid("Hip", ["$hr * 0.32", "$hr * 0.28", "$hr * 0.32"], { at: [0, "$hr * 0.12", 0], segments: 10, material: "sepal_green" }),
        ellipsoid("Sepal_{i}", ["$hr * 0.45", "$hr * 0.03 + 0.001", "$hr * 0.08"], { at: ["$hr * 0.38", "$hr * 0.05", 0], rotate: [0, 0, -30], segments: 8, material: "sepal_green", repeat: { count: 5, around: "y", phase: 20 } }),
      ];
    case "lily":
      return [
        ellipsoid("Petal_{i}", ["$hr * 0.62", "$hr * 0.03 + 0.002", "$hr * 0.17"], { at: ["$hr * 0.5", "$hr * 0.55", 0], rotate: [0, 0, f.key === "tiger" ? 58 : 46], segments: 12, repeat: { count: 3, around: "y", phase: 0 } }),
        ellipsoid("PetalInner_{i}", ["$hr * 0.6", "$hr * 0.03 + 0.002", "$hr * 0.2"], { at: ["$hr * 0.48", "$hr * 0.6", 0], rotate: [0, 0, f.key === "tiger" ? 62 : 50], segments: 12, repeat: { count: 3, around: "y", phase: 60 } }),
        ellipsoid("Throat", ["$hr * 0.2", "$hr * 0.4", "$hr * 0.2"], { at: [0, "$hr * 0.35", 0], segments: 12, material: f.petal }),
        group("Stamen_{i}", [
          tube("Filament", [[0, "$hr * 0.3", 0], ["$hr * 0.25", "$hr * 0.9", 0], ["$hr * 0.45", "$hr * 1.2", 0]], "$hr * 0.018 + 0.0008", { segments: 5, material: "stem_green" }),
          ellipsoid("Anther", ["$hr * 0.05", "$hr * 0.025 + 0.001", "$hr * 0.025 + 0.001"], { at: ["$hr * 0.47", "$hr * 1.22", 0], segments: 8, material: f.centre }),
        ], { repeat: { count: 6, around: "y", phase: 30 } }),
        tube("Centre", [[0, "$hr * 0.3", 0], [0, "$hr * 1.25", "$hr * 0.05"]], "$hr * 0.025 + 0.001", { segments: 6, material: "stem_green" }),
      ];
  }
}

/**
 * A real leaf blade instead of a flat, smooth lens: it runs out from its base along +z (length `len`, widest `wide`
 * across), folded along the midrib into a shallow V so the edges stand up, arched so the tip bows away, and lifted
 * `lift` degrees from the ground (90: upright, against the stem). The blade is a closed, thin loft.
 */
function blade(name: string, len: string, wide: string, o: { lift: number; arch: number; fold: number; twist?: number; at?: [string | number, string | number, string | number]; repeat?: { count: string | number; around: "y"; phase: number } }): SpecNode {
  const us = [0, 0.1, 0.28, 0.48, 0.68, 0.86, 1];
  const ws = [0.42, 0.82, 1, 0.92, 0.7, 0.38, 0.06];
  const sections = us.map((u, k) => {
    const w = `(${wide}) * ${n4(ws[k]! / 2)}`;
    // The tip bows away from the upper face; the fold flattens out toward the tip.
    const d = `-(${len}) * ${n4(o.arch * u * u)}`;
    const f = n4(o.fold * (1 - 0.6 * u));
    return { z: `(${len}) * ${n4(u)}`, points: [[w, `${d} + ${w} * ${f}`], ["0", `${d} + ${w} * 0.08 + 0.0008`], [`-${w}`, `${d} + ${w} * ${f}`], ["0", d]] };
  });
  return loft(name, sections, { at: o.at, rotate: [-o.lift, o.twist ?? 0, 0], ...(o.repeat ? { repeat: o.repeat } : {}) });
}

/** Head tilt toward the front (+z), degrees. */
const TILT: Record<Kind, number> = { tulip: 4, sunflower: 70, daisy: 30, rose: 12, lily: 55 };

/** One flower: stem, leaves and head, standing at the origin. $h is the stem height. */
function plant(f: Flower, leanX: string, leanZ: string): SpecNode[] {
  const bend = f.kind === "sunflower" ? "$h * 0.1" : "$h * 0.05";
  const top: [string, string, string] = [leanX, "$h", `${leanZ} + ${bend}`];
  const stemR = f.kind === "sunflower" ? "$hr * 0.16 + 0.006" : "$hr * 0.08 + 0.002";
  const leaves: SpecNode[] = [];
  switch (f.kind) {
    case "tulip":
      // Two broad, channelled leaves clasping the foot of the stem and arching out, and a narrower one higher up.
      leaves.push(
        group("Leaf_{i}", [blade("Blade", "$h * 0.62", "$h * 0.15 + 0.012", { lift: 76, arch: 0.32, fold: 0.55, twist: 8 })], { repeat: { count: 2, around: "y", phase: 30 } }),
        group("LeafUpper", [blade("Blade", "$h * 0.4", "$h * 0.08 + 0.008", { lift: 70, arch: 0.4, fold: 0.6, twist: -10 })], { at: [0, "$h * 0.14", 0], rotate: [0, 120, 0] }),
      );
      break;
    case "sunflower":
      leaves.push(group("Leaf_{i}", [blade("Blade", "$hr * 1.5", "$hr * 1.15", { lift: 28, arch: 0.35, fold: 0.3 })], { at: [0, "$h * (0.25 + 0.14 * $i)", 0], repeat: { count: 4, around: "y", phase: 20 } }));
      break;
    case "daisy":
      leaves.push(group("Leaf_{i}", [blade("Blade", "$h * 0.24 + 0.02", "$h * 0.07 + 0.008", { lift: 22, arch: 0.3, fold: 0.45, twist: 6 })], { at: [0, 0.002, 0], repeat: { count: 5, around: "y", phase: 10 } }));
      break;
    case "rose":
      leaves.push(group("Leaf_{i}", [
        tube("Petiole", [[0, 0, 0], ["$h * 0.12", "$h * 0.05", 0]], "$h * 0.004 + 0.001", { segments: 5 }),
        ellipsoid("Leaflet", ["$h * 0.05", "$h * 0.005 + 0.001", "$h * 0.03"], { at: ["$h * 0.13", "$h * 0.05", 0], segments: 10 }),
        ellipsoid("LeafletL", ["$h * 0.04", "$h * 0.005 + 0.001", "$h * 0.025"], { at: ["$h * 0.07", "$h * 0.035", "$h * 0.03"], rotate: [0, -50, 0], segments: 10 }),
        ellipsoid("LeafletR", ["$h * 0.04", "$h * 0.005 + 0.001", "$h * 0.025"], { at: ["$h * 0.07", "$h * 0.035", "-$h * 0.03"], rotate: [0, 50, 0], segments: 10 }),
      ], { at: [0, "$h * (0.3 + 0.18 * $i)", 0], repeat: { count: 3, around: "y", phase: 40 } }));
      break;
    case "lily":
      leaves.push(group("Leaf_{i}", [blade("Blade", "$h * 0.14", "$h * 0.026 + 0.003", { lift: 48, arch: 0.35, fold: 0.6 })], { at: [0, "$h * (0.2 + 0.07 * $i)", 0], repeat: { count: 8, around: "y", phase: 0 } }));
      break;
  }
  return [
    tube("Stem", [[0, 0, 0], [`${leanX} * 0.3`, "$h * 0.35", `${leanZ} * 0.3`], [`${leanX} * 0.7`, "$h * 0.75", `${leanZ} * 0.7 + ${bend} * 0.4`], top], [stemR, stemR, `${stemR} * 0.9`, `${stemR} * 0.8`], { segments: 7, material: f.kind === "sunflower" ? "stem_dark" : "stem_green" }),
    group("Leaves", leaves, { material: "leaf_flower" }),
    group("Head", head(f), { at: top, rotate: [TILT[f.kind], f.kind === "sunflower" ? 14 : 0, 0], material: f.petal }),
  ];
}

function flowerAsset(f: Flower): AssetDraft {
  const params = [
    num("height", f.height[0], f.height[1], f.height[2], "Height of the stem to the flower head, in metres."),
    num("headRadius", f.head[0], f.head[1], f.head[2], "Radius of the flower head in metres."),
  ];
  if (f.petals && f.petals[1] !== f.petals[2]) params.push(int("petals", f.petals[0], f.petals[1], f.petals[2], f.kind === "rose" ? "Petals in the outer ring of the bloom." : "Number of petals (rays) round the head."));
  const vars: Record<string, string> = { h: "$height", hr: "$headRadius", np: f.petals && f.petals[1] !== f.petals[2] ? "$petals" : String(f.petals?.[0] ?? 6) };
  let nodes: SpecNode[];
  if (f.cluster) {
    params.push(int("stems", f.cluster[0], f.cluster[1], f.cluster[2], "Number of flowers in the bunch."));
    nodes = [
      group("Bunch", [
        group("Bloom_{i}", [group("Plant", plant(f, "$height * 0.12", "0"), { vars: { h: "$height * (0.85 + 0.15 * sin($i * 2.3 + 0.5))" } })], {
          at: ["$headRadius * 1.6", 0, 0],
          rotate: [0, 0, 0],
          repeat: { count: "$stems", around: "y", phase: 10 },
        }),
        group("Middle", plant(f, "0", "0")),
      ], { vars }),
    ];
  } else nodes = [group("Flower", plant(f, "0", "0"), { vars })];
  const centreMat = f.centre;
  return {
    slug: slugify("flower", f.kind, f.key),
    title: f.title,
    description: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)}. ${f.cluster ? "It stands on y = 0, the heads turned to the front (+z)." : "It stands on y = 0 with its head turned to the front (+z)."}`,
    tags: [f.kind, f.dutch, f.key.replace("-", " "), f.petal.replace("petal_", ""), ...(f.cluster ? ["bunch", "bos", "cluster"] : [])],
    params,
    materials: natureMats(mats, f.petal, centreMat, "stem_green", "stem_dark", "leaf_flower", "sepal_green"),
    nodes,
  };
}

export const flowerFamily: Family = {
  id: "flower",
  category: "nature",
  archetype: "plant.flower",
  tags: ["flower", "bloem", "plant", "garden", "tuin", "nature", "natuur", "bloom"],
  assets: () => FLOWERS.map(flowerAsset),
};

