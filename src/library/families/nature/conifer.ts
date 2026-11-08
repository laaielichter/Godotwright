import { ellipsoid, group, int, lathe, loft, num, rng, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { lumpExtent, n4, natureMats } from "./common.js";

type Kind = "whorled" | "pine" | "column";

interface Conifer {
  species: string;
  variant: string;
  dutch: string;
  kind: Kind;
  bark: string;
  needles: string;
  /** A second needle shade (the dense cone inside the whorls, or the sunlit sprays). */
  inner: string;
  height: [number, number, number];
  crown: [number, number, number];
  trunk: [number, number, number];
  /** Whorls (whorled), clusters (pine) or sprays (column). */
  count: [number, number, number];
  /** Whorled: boughs per whorl, droop of the bough tips (in whorl spacings), upturn, width; crown base share. */
  boughs?: number;
  droop?: number;
  upturn?: number;
  width?: number;
  base?: number;
  /** Whorled: radius of the dense inner cone as a share of the whorl radius (0: none, a larch). */
  core?: number;
  snow?: boolean;
  /** Pine: how flat the crown is (1 umbrella, 0 a loose cone). */
  umbrella?: number;
  /** Column: lumpiness. */
  lumps?: number;
  text: string;
}

const W = (o: Omit<Conifer, "kind">): Conifer => ({ kind: "whorled", ...o });

const CONIFERS: Conifer[] = [
  W({ species: "spruce", variant: "norway", dutch: "fijnspar", bark: "bark_brown", needles: "needles", inner: "leaf_dark", height: [22, 12, 40], crown: [3.6, 2.2, 5.5], trunk: [0.3, 0.16, 0.6], count: [12, 8, 18], boughs: 7, droop: 0.55, upturn: 0.25, width: 0.32, base: 0.1, core: 0.8, text: "a tall Norway spruce: drooping boughs in regular whorls that hang down and turn up at the tips, around a dark cone" }),
  W({ species: "spruce", variant: "blue", dutch: "blauwspar", bark: "bark_grey", needles: "needles_blue", inner: "needles", height: [14, 8, 22], crown: [3, 1.8, 4.5], trunk: [0.22, 0.12, 0.4], count: [11, 7, 15], boughs: 8, droop: 0.3, upturn: 0.1, width: 0.36, base: 0.05, core: 0.85, text: "a Colorado blue spruce: a dense, stiff, steel-blue pyramid reaching almost to the ground" }),
  W({ species: "spruce", variant: "snowy", dutch: "besneeuwde spar", bark: "bark_brown", needles: "needles", inner: "leaf_dark", height: [18, 10, 30], crown: [3.4, 2, 5], trunk: [0.26, 0.14, 0.5], count: [11, 7, 16], boughs: 7, droop: 0.6, upturn: 0.2, width: 0.32, base: 0.08, core: 0.8, snow: true, text: "a winter spruce: drooping whorls with pads of snow lying on every bough" }),
  W({ species: "spruce", variant: "young", dutch: "jonge spar", bark: "bark_brown", needles: "needles_light", inner: "needles", height: [9, 8, 14], crown: [2.2, 1.4, 3.2], trunk: [0.12, 0.07, 0.2], count: [8, 6, 11], boughs: 6, droop: 0.25, upturn: 0.25, width: 0.4, base: 0.06, core: 0.7, text: "a young spruce: few, widely spaced whorls of light green boughs on a slim stem" }),
  W({ species: "fir", variant: "nordmann", dutch: "nordmannspar", bark: "bark_grey", needles: "leaf_dark", inner: "needles", height: [18, 10, 30], crown: [3.4, 2, 5], trunk: [0.28, 0.15, 0.5], count: [13, 8, 18], boughs: 9, droop: 0.12, upturn: 0.05, width: 0.38, base: 0.06, core: 0.85, text: "a Nordmann fir: level, flat boughs in many dense tiers forming a neat, dark cone" }),
  W({ species: "fir", variant: "christmas", dutch: "kerstboom", bark: "bark_brown", needles: "needles", inner: "leaf_dark", height: [4, 3, 6], crown: [1.3, 0.9, 1.9], trunk: [0.06, 0.04, 0.1], count: [7, 6, 10], boughs: 8, droop: 0.1, upturn: 0.08, width: 0.45, base: 0.08, core: 0.9, text: "a Christmas tree: a small, full, symmetric fir with level boughs and a straight leader for the star" }),
  W({ species: "fir", variant: "noble", dutch: "edelspar", bark: "bark_grey", needles: "needles_blue", inner: "leaf_dark", height: [24, 12, 40], crown: [3, 2, 4.5], trunk: [0.32, 0.18, 0.55], count: [14, 9, 18], boughs: 8, droop: 0.08, upturn: 0.15, width: 0.34, base: 0.18, core: 0.75, text: "a noble fir: silver-blue boughs that sweep upward in open tiers above a bare lower trunk" }),
  W({ species: "fir", variant: "snowy", dutch: "besneeuwde zilverspar", bark: "bark_grey", needles: "leaf_dark", inner: "needles", height: [12, 8, 20], crown: [2.8, 1.8, 4], trunk: [0.2, 0.1, 0.35], count: [11, 7, 15], boughs: 9, droop: 0.15, upturn: 0.05, width: 0.38, base: 0.06, core: 0.85, snow: true, text: "a snowy fir: flat tiers each carrying a layer of snow" }),
  { species: "pine", variant: "scots", dutch: "grove den", kind: "pine", bark: "bark_red", needles: "needles", inner: "needles_light", height: [20, 10, 35], crown: [4, 2.5, 6], trunk: [0.3, 0.16, 0.55], count: [7, 5, 10], umbrella: 0.4, text: "a Scots pine: a tall, bare, orange-brown trunk with a slight bend and a loose, irregular crown of flat needle clusters on crooked limbs" },
  { species: "pine", variant: "black", dutch: "zwarte den", kind: "pine", bark: "bark_dark", needles: "leaf_dark", inner: "needles", height: [16, 8, 30], crown: [4.2, 2.5, 6.5], trunk: [0.32, 0.18, 0.6], count: [9, 6, 12], umbrella: 0.15, text: "an Austrian black pine: a dark, dense, broad crown of heavy needle clusters reaching further down the trunk" },
  { species: "pine", variant: "stone", dutch: "parasolden", kind: "pine", bark: "bark_red", needles: "needles", inner: "leaf_green", height: [12, 8, 20], crown: [5.5, 3.5, 8], trunk: [0.35, 0.2, 0.6], count: [8, 6, 11], umbrella: 1, text: "a Mediterranean stone pine: a forked bare trunk under a wide, flat umbrella crown" },
  { species: "pine", variant: "lodgepole", dutch: "draaiden", kind: "pine", bark: "bark_brown", needles: "needles_light", inner: "needles", height: [24, 12, 40], crown: [2.4, 1.6, 3.6], trunk: [0.22, 0.12, 0.4], count: [8, 6, 11], umbrella: 0, text: "a lodgepole pine: a very straight, slender trunk with a short, narrow crown of tufts at the top" },
  { species: "cypress", variant: "italian", dutch: "italiaanse cipres", kind: "column", bark: "bark_brown", needles: "cypress_green", inner: "leaf_dark", height: [16, 8, 30], crown: [0.9, 0.6, 1.6], trunk: [0.2, 0.1, 0.35], count: [7, 5, 10], lumps: 0.22, text: "an Italian cypress: a narrow, dark green flame-shaped column of upright sprays" },
  { species: "cypress", variant: "leyland", dutch: "leylandcipres", kind: "column", bark: "bark_red", needles: "needles_blue", inner: "needles", height: [14, 8, 25], crown: [2.2, 1.4, 3.5], trunk: [0.25, 0.12, 0.4], count: [8, 6, 12], lumps: 0.3, text: "a Leyland cypress: a broad, soft, blue-green column with a pointed top" },
  { species: "cypress", variant: "thuja", dutch: "levensboom", kind: "column", bark: "bark_red", needles: "needles_light", inner: "needles", height: [8, 8, 14], crown: [1.4, 0.9, 2.2], trunk: [0.14, 0.08, 0.25], count: [6, 5, 9], lumps: 0.26, text: "an arborvitae (thuja): a compact, bright green cone of fan-like sprays, the classic hedge conifer" },
  { species: "cypress", variant: "juniper", dutch: "jeneverbes", kind: "column", bark: "bark_grey", needles: "needles_blue", inner: "leaf_dark", height: [9, 8, 14], crown: [1.6, 1, 2.6], trunk: [0.16, 0.08, 0.28], count: [9, 6, 12], lumps: 0.34, text: "a columnar juniper: a ragged, irregular column of grey-blue sprays" },
  W({ species: "larch", variant: "summer", dutch: "lariks zomer", bark: "bark_red", needles: "needles_light", inner: "leaf_light", height: [24, 12, 40], crown: [3.6, 2.2, 5.5], trunk: [0.3, 0.16, 0.5], count: [11, 7, 15], boughs: 6, droop: 0.4, upturn: 0.35, width: 0.3, base: 0.15, core: 0.35, text: "a European larch: an airy, open cone of soft, bright green boughs that dip and then sweep up at the tips" }),
  W({ species: "larch", variant: "autumn", dutch: "lariks herfst", bark: "bark_red", needles: "larch_gold", inner: "leaf_yellow", height: [22, 12, 40], crown: [3.4, 2.2, 5.5], trunk: [0.28, 0.16, 0.5], count: [11, 7, 15], boughs: 6, droop: 0.45, upturn: 0.35, width: 0.3, base: 0.14, core: 0.35, text: "a larch in autumn: open whorls of golden boughs that dip and sweep up at the tips" }),
  W({ species: "larch", variant: "turning", dutch: "verkleurende lariks", bark: "bark_red", needles: "leaf_yellow", inner: "needles_light", height: [18, 12, 35], crown: [3.2, 2, 5], trunk: [0.24, 0.14, 0.45], count: [9, 7, 14], boughs: 7, droop: 0.35, upturn: 0.3, width: 0.32, base: 0.12, core: 0.45, text: "a larch turning in early autumn: yellowing boughs around a still green inner cone" }),
  W({ species: "larch", variant: "japanese", dutch: "japanse lariks", bark: "bark_red", needles: "needles_blue", inner: "needles", height: [20, 12, 35], crown: [4, 2.5, 6], trunk: [0.3, 0.16, 0.5], count: [10, 7, 14], boughs: 7, droop: 0.2, upturn: 0.45, width: 0.3, base: 0.12, core: 0.4, text: "a Japanese larch: wide, blue-green whorls that rise steeply at their tips" }),
];

/** One drooping, upturning bough along +z in terms of $R (its length) and $L (the whorl spacing). */
function bough(c: Conifer): SpecNode {
  const droop = c.droop ?? 0.3, up = c.upturn ?? 0, w = c.width ?? 0.35;
  const us = [0.06, 0.3, 0.55, 0.8, 1.02];
  const sections = us.map((u) => {
    const y = `$D * ${n4(-droop * u * u + up * Math.pow(u, 4))}`;
    const half = `(($R * 0.13 + $D * ${n4(w)}) * ${n4(1 - 0.75 * u)} + 0.02)`;
    return {
      z: `$R * ${n4(u)}`,
      points: [
        [half, `${y} + ${half} * 0.3`],
        ["0", `${y} + ${half} * 0.1 + 0.01`],
        [`-${half}`, `${y} + ${half} * 0.3`],
        ["0", y],
      ],
    };
  });
  const children: SpecNode[] = [];
  if (c.snow) {
    const u = 0.5;
    const y = `$D * ${n4(-droop * u * u + up * Math.pow(u, 4))}`;
    children.push(ellipsoid("Snow", ["($R * 0.13 + $D * " + n4(w) + ") * 0.62", "$D * 0.09 + 0.04", "$R * 0.36"], { at: [0, `${y} + $D * 0.1`, "$R * 0.45"], segments: 10, lumps: 0.3, seed: 5, material: "snow" }));
  }
  return loft("Bough_{i}", sections, { rotate: ["5 * sin($i * 2.1 + $t * 9)", 0, 0], repeat: { count: c.boughs ?? 7, around: "y", phase: 0 }, children });
}

function whorled(c: Conifer, r: () => number): { nodes: SpecNode[]; mats: string[] } {
  const core = (c.core ?? 0.8) * 0.72;
  const tierChildren: SpecNode[] = [bough(c)];
  if (core > 0) {
    tierChildren.push(lathe("Skirt", [
      ["$R * 0.12", "-$L * 0.1"],
      [`$R * ${n4(core)}`, `-$D * ${n4((c.droop ?? 0.3) * 0.45)}`],
      [`$R * ${n4(core * 0.85)}`, "$L * 0.25"],
      [`$R * ${n4(core * 0.35)}`, "$L * 1.1"],
      ["$R * 0.08", "$L * 1.45"],
    ], { segments: 12, material: c.inner }));
  }
  const nodes: SpecNode[] = [
    lathe("Trunk", [["$trunkRadius * 1.4", 0], ["$trunkRadius * 1.05", "$height * 0.04"], ["$trunkRadius * 0.75", "$height * 0.35"], ["$trunkRadius * 0.35", "$height * 0.75"], ["0.02", "$height * 0.97"]], { segments: 12, material: c.bark }),
    group("Branches", [
      tube("Snag_{i}", [["0", "$cb * 0.55", "0"], ["$crownRadius * 0.25", "$cb * 0.5", "0"], ["$crownRadius * 0.4", "$cb * 0.38", "$crownRadius * 0.05"]], ["$trunkRadius * 0.25", "$trunkRadius * 0.14", "$trunkRadius * 0.06"], { segments: 6, material: c.bark, repeat: { count: 3, around: "y", phase: Math.round(r() * 90) } }),
    ]),
    group("Crown", [
      group("Tier_{i}", [group("Whorl", tierChildren, { vars: { t: "$i / max($tiers - 1, 1)", R: "$crownRadius * (1 - $t * 0.86) * (1 - 0.06 * sin($i * 2.7)) + 0.12", L: "$cl / $tiers", D: "min($L, $R * 0.8)" } })], {
        at: [0, "$cb", 0],
        rotate: [0, `$i * ${n4(37 + r() * 10)}`, 0],
        repeat: { count: "$tiers", step: [0, "$cl / $tiers", 0] },
      }),
      lathe("Leader", [["$cl / $tiers * 0.25 + 0.03", "$height - $cl / $tiers * 1.6"], ["$cl / $tiers * 0.12 + 0.02", "$height - $cl / $tiers * 0.7"], ["0.012", "$height"]], { segments: 8, material: c.needles }),
    ], { material: c.needles, vars: { cl: "$height * 0.94 - $cb" } }),
  ];
  return { nodes, mats: c.snow ? ["snow"] : [] };
}

function pine(c: Conifer, r: () => number): { nodes: SpecNode[]; mats: string[] } {
  const u = c.umbrella ?? 0.4;
  const lean = r() * 2 - 1;
  const bend = n4(0.25 + r() * 0.3);
  // Crown band: from yLo to yHi as shares of the height; flatter for an umbrella.
  const yLo = n4(0.55 + 0.25 * u - (c.variant === "black" ? 0.12 : 0));
  const yTop = n4(0.88 + 0.02 * u);
  const s = n4(r() * 5);
  const nodes: SpecNode[] = [
    tube("Trunk", [
      ["0", "0", "0"],
      ["0", "$height * 0.05", "0"],
      [`$trunkRadius * ${n4(lean * 1.5)}`, "$height * 0.35", `$trunkRadius * ${bend}`],
      [`$trunkRadius * ${n4(-lean)}`, `$height * ${yLo}`, `$trunkRadius * ${n4(-0.5 * lean)}`],
      ["0", `$height * ${yTop}`, "0"],
    ], ["$trunkRadius * 1.35", "$trunkRadius * 1.05", "$trunkRadius * 0.85", "$trunkRadius * 0.6", "$trunkRadius * 0.25"], { segments: 12, material: c.bark }),
    group("Branches", [
      tube("Branch_{i}", [
        ["0", `$height * (${yLo} - 0.08 + 0.12 * (0.5 + 0.5 * sin($i * 2.3 + ${s})))`, "0"],
        ["$crownRadius * 0.35", `$height * (${yLo} + 0.02 + 0.05 * sin($i * 1.3))`, "$crownRadius * 0.1"],
        [`$crownRadius * (0.62 + 0.12 * sin($i * 1.7 + ${s}))`, `$height * (${yLo} + (${yTop} - ${yLo}) * (0.45 + 0.35 * sin($i * 2.9 + ${s}) * ${n4(1 - u)}))`, "0"],
      ], ["$trunkRadius * 0.42", "$trunkRadius * 0.28", "$trunkRadius * 0.12"], { segments: 7, material: c.bark, repeat: { count: "$clusters", around: "y", phase: Math.round(r() * 60) } }),
    ]),
    group("Crown", [
      ellipsoid("Cluster_{i}", ["$crownRadius * 0.42", `$crownRadius * ${n4(0.2 - 0.06 * u)} + 0.2`, "$crownRadius * 0.38"], {
        at: [`$crownRadius * (0.62 + 0.12 * sin($i * 1.7 + ${s}))`, `$height * (${yLo} + (${yTop} - ${yLo}) * (0.45 + 0.35 * sin($i * 2.9 + ${s}) * ${n4(1 - u)})) + $crownRadius * 0.08`, "0"],
        segments: 16,
        lumps: 0.45,
        seed: `$i * 17 + ${Math.floor(r() * 900)}`,
        repeat: { count: "$clusters", around: "y", phase: Math.round(r() * 60) },
      }),
      ellipsoid("Top", ["$crownRadius * 0.48", `$crownRadius * ${n4(0.24 - 0.08 * u)} + 0.25`, "$crownRadius * 0.45"], { at: [0, `$height * ${yTop}`, 0], segments: 18, lumps: 0.4, seed: Math.floor(r() * 900), material: c.inner }),
    ], { material: c.needles }),
  ];
  return { nodes, mats: [] };
}

function column(c: Conifer, r: () => number): { nodes: SpecNode[]; mats: string[] } {
  const lumps = c.lumps ?? 0.25;
  const seed = Math.floor(r() * 900);
  const e = lumpExtent(20, lumps, seed);
  // The column spans from 4 % of the height to 96 %: its radii are chosen so its real lowest point sits there.
  const span = n4(0.92 / (e.low + e.high));
  const nodes: SpecNode[] = [
    lathe("Trunk", [["$trunkRadius * 1.3", 0], ["$trunkRadius", "$height * 0.06"], ["$trunkRadius * 0.7", "$height * 0.3"], ["$trunkRadius * 0.3", "$height * 0.6"]], { segments: 10, material: c.bark }),
    group("Branches", [
      tube("Branch_{i}", [["0", "$height * 0.08", "0"], ["$crownRadius * 0.3", "$height * 0.14", "0"], ["$crownRadius * 0.55", "$height * 0.22", "$crownRadius * 0.05"]], ["$trunkRadius * 0.35", "$trunkRadius * 0.22", "$trunkRadius * 0.1"], { segments: 6, repeat: { count: 4, around: "y", phase: Math.round(r() * 80) } }),
    ], { material: c.bark }),
    group("Crown", [
      ellipsoid("Column", ["$crownRadius", `$height * ${span}`, "$crownRadius"], { at: [0, `$height * (0.04 + ${span} * ${n4(e.low)})`, 0], segments: 22, lumps, seed, material: c.inner }),
      ellipsoid("Spray_{i}", ["$crownRadius * 0.5", "min($height * 0.16, $crownRadius * 2.4)", "$crownRadius * 0.45"], {
        at: [`$crownRadius * 0.62`, `$height * (0.4 + 0.22 * sin($i * 2.3 + ${n4(r() * 4)}))`, 0],
        segments: 12,
        lumps: lumps + 0.1,
        seed: `$i * 9 + ${seed + 1}`,
        repeat: { count: "$sprays", around: "y", phase: Math.round(r() * 60) },
      }),
      ellipsoid("Tip", ["$crownRadius * 0.35", "$height * 0.08", "$crownRadius * 0.35"], { at: [0, "$height * 0.9", 0], segments: 12, lumps: 0.2, seed: seed + 2 }),
    ], { material: c.needles }),
  ];
  return { nodes, mats: [] };
}

function conifer(c: Conifer, index: number): AssetDraft {
  const r = rng(index * 7919 + 3);
  const built = c.kind === "whorled" ? whorled(c, r) : c.kind === "pine" ? pine(c, r) : column(c, r);
  const countParam =
    c.kind === "whorled" ? int("tiers", c.count[0], c.count[1], c.count[2], "Number of branch whorls up the stem.")
    : c.kind === "pine" ? int("clusters", c.count[0], c.count[1], c.count[2], "Number of limbs, each ending in a needle cluster.")
    : int("sprays", c.count[0], c.count[1], c.count[2], "Number of upright sprays around the column.");
  const vars: Record<string, string> = c.kind === "whorled" ? { cb: `$height * ${n4(c.base ?? 0.1)} + 0.1` } : {};
  return {
    slug: slugify("conifer", c.species, c.variant),
    title: `${c.variant.charAt(0).toUpperCase()}${c.variant.slice(1)} ${c.species}`,
    description: `${c.text.charAt(0).toUpperCase()}${c.text.slice(1)}. It stands on y = 0; the front faces +z.`,
    tags: [c.species, c.variant, c.dutch, ...(c.snow ? ["snow", "sneeuw", "winter"] : [])],
    params: [
      num("height", c.height[0], c.height[1], c.height[2], "Total height of the tree in metres."),
      num("crownRadius", c.crown[0], c.crown[1], c.crown[2], "Radius of the crown at its widest, in metres."),
      num("trunkRadius", c.trunk[0], c.trunk[1], c.trunk[2], "Trunk radius near the ground in metres."),
      countParam,
    ],
    materials: { ...mats(c.bark), ...natureMats(mats, c.needles, c.inner, ...built.mats) },
    nodes: [group("Conifer", built.nodes, { vars })],
  };
}

export const coniferFamily: Family = {
  id: "conifer",
  category: "nature",
  archetype: "plant.tree.conifer",
  tags: ["conifer", "naaldboom", "evergreen", "tree", "boom", "forest", "bos", "nature", "natuur"],
  assets: () => CONIFERS.map((c, k) => conifer(c, k)),
};
