import { box, cyl, ellipsoid, group, int, lathe, num, slugify, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { board, cushion, fmats, pillow, shade, tufting } from "./parts.js";

const STYLES = ["modern", "chesterfield", "midcentury", "lawson"] as const;
type Style = (typeof STYLES)[number];

interface Finish { cover: string; wood: string }
const FINISHES: Record<Style, Finish[]> = {
  modern: [{ cover: "fabric_cream", wood: "black_steel" }, { cover: "wool_grey", wood: "oak" }, { cover: "velvet_green", wood: "brass" }, { cover: "fabric_terracotta", wood: "walnut" }],
  chesterfield: [{ cover: "leather_brown", wood: "dark_stain" }, { cover: "leather_black", wood: "dark_stain" }, { cover: "velvet_green", wood: "walnut" }, { cover: "leather_tan", wood: "mahogany" }],
  midcentury: [{ cover: "fabric_mustard", wood: "teak" }, { cover: "fabric_teal", wood: "walnut" }, { cover: "wool_charcoal", wood: "light_oak" }],
  lawson: [{ cover: "linen", wood: "oak" }, { cover: "velvet_red", wood: "walnut" }, { cover: "velvet_blue", wood: "dark_stain" }],
};

/** Seat cushions in a row across the seat: n of them, each $sw wide, top at $sh, from the back depth $bt to the front. */
const seats = (cover: string, bevel = 0.05, tufts = 0): SpecNode =>
  cushion("Seat_{i}", "$sw - 0.008", 0.15, "$D - $bt + 0.01", cover, { at: ["-($n - 1) * $sw / 2", "$sh - 0.075 - 0.012", "$bt / 2 + 0.005"], repeat: { count: "$n", step: ["$sw", 0, 0] }, bevel, crown: 0.02, ...(tufts ? { tufts } : {}) });

/** Loose back cushions leaning on the back, one per seat: plump, crowned on the face, optionally buttoned. */
const backs = (cover: string, buttons: boolean): SpecNode =>
  cushion("Back_{i}", "$sw - 0.02", 0.17, "$bh - $sh - 0.04", cover, {
    at: ["-($n - 1) * $sw / 2", "$sh - 0.01 + ($bh - $sh - 0.04) / 2 * 0.985", "-$D / 2 + $bt + 0.07 - ($bh - $sh - 0.04) / 2 * 0.174"],
    rotate: [80, 0, 0], repeat: { count: "$n", step: ["$sw", 0, 0] }, bevel: 0.06, crown: 0.025, ...(buttons ? { tufts: 2, pleats: false } : {}),
  });

function modern(f: Finish): SpecNode[] {
  return [
    group("Frame", [
      box("Base", ["$W", "$sh - 0.12 - $lh", "$D"], { at: [0, "$lh", 0], anchor: "bottom", bevel: 0.02 }),
      box("Back_Shell", ["$W", "$bh - $lh - 0.1", "$bt"], { at: [0, "$lh", "-$D / 2 + $bt / 2"], anchor: "bottom", bevel: 0.03 }),
    ]),
    box("Arm_L", ["$aw", "$sh + 0.17 - $lh", "$D"], { at: ["$W / 2 - $aw / 2", "$lh", 0], anchor: "bottom", bevel: 0.03, mirror: "Arm_R" }),
    seats(f.cover),
    backs(f.cover, false),
    group("Legs", [
      lathe("Leg_FL", [[0.012, 0], [0.014, 0.01], [0.02, "$lh + 0.01"]], { at: ["$W / 2 - 0.06", 0, "$D / 2 - 0.06"], segments: 12, mirror: "Leg_FR" }),
      lathe("Leg_BL", [[0.012, 0], [0.014, 0.01], [0.02, "$lh + 0.01"]], { at: ["$W / 2 - 0.06", 0, "-$D / 2 + 0.06"], segments: 12, mirror: "Leg_BR" }),
      lathe("Leg_MF", [[0.012, 0], [0.014, 0.01], [0.02, "$lh + 0.01"]], { at: [0, 0, "$D / 2 - 0.06"], segments: 12 }),
      lathe("Leg_MB", [[0.012, 0], [0.014, 0.01], [0.02, "$lh + 0.01"]], { at: [0, 0, "-$D / 2 + 0.06"], segments: 12 }),
    ], { material: f.wood }),
  ];
}

function chesterfield(f: Finish): SpecNode[] {
  return [
    group("Frame", [
      box("Base", ["$W - 0.04", "$sh - 0.12 - $lh", "$D - 0.04"], { at: [0, "$lh", 0], anchor: "bottom", bevel: 0.03 }),
    ]),
    box("Back", ["$W - 0.06", "$bh - $lh - 0.08", "$bt"], { at: [0, "$lh", "-$D / 2 + $bt / 2"], anchor: "bottom", bevel: 0.04, children: [
      cyl("Roll", 0.1, "$W - 0.08", { axis: "x", at: [0, "$bh - $lh - 0.1", -0.01], segments: 20, bevel: 0.03 }),
      tufting("Tufting", f.cover, "$nb", 3, 0.15, "($bh - $sh) * 0.21", { at: [0, "$sh - $lh + ($bh - $sh) * 0.2", "$bt / 2"], vars: { nb: "floor(($W - 2 * $aw - 0.1) / 0.15)" } }),
    ] }),
    box("Arm_L", ["$aw", "$bh - $lh - 0.12", "$D - 0.02"], { at: ["$W / 2 - $aw / 2 - 0.01", "$lh", 0], anchor: "bottom", bevel: 0.03, mirror: "Arm_R", children: [
      cyl("Roll", "$aw / 2 + 0.035", "$D - 0.02", { axis: "z", at: [0.03, "$bh - $lh - 0.12", 0], segments: 20, bevel: 0.04 }),
      ellipsoid("Stud_{i}", [0.012, 0.012, 0.009], { at: [0, "$sh - $lh - 0.06", "($D - 0.02) / 2"], repeat: { count: 3, step: [0, 0.1, 0] }, segments: 8 }),
    ] }),
    seats(f.cover, 0.04),
    group("Feet", [
      lathe("Foot_FL", [[0.03, 0], [0.04, 0.015], [0.045, "$lh * 0.6"], [0.035, "$lh + 0.01"]], { at: ["$W / 2 - 0.08", 0, "$D / 2 - 0.08"], segments: 14, mirror: "Foot_FR" }),
      lathe("Foot_BL", [[0.03, 0], [0.04, 0.015], [0.045, "$lh * 0.6"], [0.035, "$lh + 0.01"]], { at: ["$W / 2 - 0.08", 0, "-$D / 2 + 0.08"], segments: 14, mirror: "Foot_BR" }),
    ], { material: f.wood }),
  ];
}

function midcentury(f: Finish): SpecNode[] {
  const leg = (name: string, x: string, z: string, rx: number, mirror?: string): SpecNode =>
    lathe(name, [[0.012, 0], [0.014, 0.01], [0.024, "$lh * 0.9"], [0.026, "$lh + 0.015"]], { at: [x, 0.002, z], rotate: [rx, 0, mirror ? 6 : 0], segments: 14, ...(mirror ? { mirror } : {}) });
  return [
    group("Frame", [
      box("Base", ["$W", 0.15, "$D - 0.02"], { at: [0, "$lh", 0], anchor: "bottom", bevel: 0.015 }),
      box("Rail", ["$W + 0.01", 0.04, "$D"], { at: [0, "$lh + 0.01", 0], anchor: "bottom", bevel: 0.006, material: f.wood }),
      box("Back_Shell", ["$W - 0.04", "$bh - $lh - 0.12", 0.1], { at: [0, "$lh + 0.1", "-$D / 2 + 0.06"], anchor: "bottom", bevel: 0.02 }),
    ]),
    box("Arm_L", [0.09, "$sh + 0.14 - $lh - 0.1", "$D - 0.06"], { at: ["$W / 2 - 0.045", "$lh + 0.1", 0.01], anchor: "bottom", bevel: 0.02, mirror: "Arm_R", children: [
      board("Arm_Cap", [0.1, 0.022, "$D - 0.04"], "z", { at: [0, "$sh + 0.14 - $lh - 0.1", 0], bevel: 0.008, material: f.wood }),
    ] }),
    seats(f.cover, 0.035),
    backs(f.cover, true),
    group("Legs", [
      leg("Leg_FL", "$W / 2 - 0.08", "$D / 2 - 0.1", -6, "Leg_FR"),
      leg("Leg_BL", "$W / 2 - 0.08", "-$D / 2 + 0.1", 6, "Leg_BR"),
      leg("Leg_MB", "0", "-$D / 2 + 0.1", 6),
    ], { material: f.wood }),
  ];
}

function lawson(f: Finish): SpecNode[] {
  return [
    group("Frame", [
      box("Base", ["$W - 0.02", "$sh - 0.12", "$D - 0.02"], { at: [0, 0.006, 0], anchor: "bottom", bevel: 0.025 }),
      box("Skirt", ["$W", 0.16, "$D"], { at: [0, 0.0, 0], anchor: "bottom", bevel: 0.01 }),
      box("Back_Shell", ["$W - 0.04", "$bh - 0.14", "$bt"], { at: [0, 0.1, "-$D / 2 + $bt / 2"], anchor: "bottom", bevel: 0.04 }),
    ]),
    box("Arm_L", ["$aw", "$sh + 0.1", "$D - 0.02"], { at: ["$W / 2 - $aw / 2 - 0.005", 0.1, 0.005], anchor: "bottom", bevel: 0.03, mirror: "Arm_R", children: [
      cyl("Roll", "$aw / 2 + 0.03", "$D - 0.02", { axis: "z", at: [0.02, "$sh + 0.1", 0], segments: 20, bevel: 0.035 }),
      cyl("Piping", "$aw / 2 + 0.034", 0.012, { axis: "z", at: [0.02, "$sh + 0.1", "($D - 0.02) / 2 - 0.004"], segments: 20 }),
    ] }),
    seats(f.cover, 0.055),
    backs(f.cover, false),
    group("Throw_Pillows", [
      group("Pillow_L", [pillow("Cushion_Fill", "0.42", 0.2, 0.075, "pillow_accent", { at: [0, 0, -0.05], rotate: [90, 0, 0] })], { at: ["$W / 2 - $aw - 0.2", "$sh + 0.17", "-$D / 2 + $bt + 0.2"], rotate: [-15, -20, 8], mirror: "Pillow_R" }),
    ]),
  ];
}

const TEXT: Record<Style, string> = {
  modern: "A modern sofa with low track arms, loose seat and back cushions, and slim legs",
  chesterfield: "A Chesterfield sofa with rolled arms at the height of the deep button-tufted back, studded arm fronts, loose seat cushions and turned bun feet",
  midcentury: "A mid-century sofa on splayed tapered wooden legs, with a wooden rail, slim arms with wooden caps, and buttoned back cushions",
  lawson: "A skirted Lawson sofa with low rolled arms piped at the front, loose back pillows and two throw pillows",
};

const RANGES: Record<Style, { n: [number, number, number]; sw: [number, number, number]; d: [number, number, number]; sh: [number, number, number]; bh: [number, number, number] }> = {
  modern: { n: [3, 2, 4], sw: [0.6, 0.5, 0.64], d: [0.92, 0.82, 1.05], sh: [0.43, 0.4, 0.46], bh: [0.8, 0.72, 0.9] },
  chesterfield: { n: [3, 2, 3], sw: [0.6, 0.52, 0.7], d: [0.9, 0.82, 1.0], sh: [0.45, 0.42, 0.48], bh: [0.76, 0.7, 0.82] },
  midcentury: { n: [3, 2, 3], sw: [0.6, 0.52, 0.68], d: [0.82, 0.76, 0.92], sh: [0.42, 0.4, 0.45], bh: [0.8, 0.74, 0.88] },
  lawson: { n: [3, 2, 3], sw: [0.62, 0.52, 0.72], d: [0.95, 0.85, 1.05], sh: [0.45, 0.42, 0.48], bh: [0.88, 0.8, 0.98] },
};

const ARM: Record<Style, number> = { modern: 0.14, chesterfield: 0.2, midcentury: 0.09, lawson: 0.17 };
const LEG: Record<Style, number> = { modern: 0.12, chesterfield: 0.08, midcentury: 0.18, lawson: 0.1 };
const BACK: Record<Style, number> = { modern: 0.2, chesterfield: 0.22, midcentury: 0.13, lawson: 0.18 };

function makeSofa(style: Style, f: Finish): AssetDraft {
  const r = RANGES[style];
  const cover = label(f.cover);
  return {
    slug: slugify("sofa", style, f.cover.replace(/^(fabric|velvet|wool|leather|canvas)_/, "$1-")),
    title: `${cap(cover)} ${style === "midcentury" ? "mid-century" : style} sofa`,
    description: `${TEXT[style]}, in ${cover} with ${label(f.wood)}. It faces +z; its width runs along x.`,
    tags: [style, f.cover.split("_").pop() ?? f.cover, "couch", "bank", "bankstel", ...(style === "chesterfield" ? ["chesterfield", "capitonné"] : [])],
    params: [
      int("seats", r.n[0], r.n[1], r.n[2], "Number of seat cushions (and places)."),
      num("seatWidth", r.sw[0], r.sw[1], r.sw[2], "Width of each seat cushion in metres."),
      num("depth", r.d[0], r.d[1], r.d[2], "Overall depth along z in metres."),
      num("seatHeight", r.sh[0], r.sh[1], r.sh[2], "Height of the seat top in metres."),
      num("backHeight", r.bh[0], r.bh[1], r.bh[2], "Height of the back above the floor in metres."),
    ],
    materials: { ...fmats(f.cover, f.wood), ...shade(f.cover), pillow_accent: { color: [0.42, 0.33, 0.2], metallic: 0, roughness: 0.94, texture: "fabric" }, pillow_accent_tuft: { color: [0.25, 0.19, 0.11], metallic: 0, roughness: 0.95, texture: "fabric" } },
    nodes: [group("Sofa", { modern, chesterfield, midcentury, lawson }[style](f), {
      material: f.cover,
      vars: { n: "$seats", sw: "$seatWidth", aw: ARM[style], W: `$seats * $seatWidth + 2 * ${ARM[style]}`, D: "$depth", sh: "$seatHeight", bh: "$backHeight", lh: LEG[style], bt: BACK[style] },
    })],
  };
}

export const sofa: Family = {
  id: "sofa",
  category: "furniture",
  archetype: "prop.sofa",
  tags: ["sofa", "couch", "bank", "zitbank", "bankstel", "furniture", "meubel", "seat"],
  assets: () => STYLES.flatMap((style) => FINISHES[style].map((f) => makeSofa(style, f))),
};
