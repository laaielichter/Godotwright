import { box, combos, cyl, ellipsoid, group, lathe, loft, num, slugify, tube, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { board, cushion, fmats, shade } from "./parts.js";

/** The silhouettes, each with its own parts and sizes. */
const STYLES = ["club", "wingback", "lounge", "rocking"] as const;
type Style = (typeof STYLES)[number];

/** Per style: the cover (fabric or leather) and the wood of the legs or frame. */
const FINISHES: Record<Style, { cover: string; wood: string }[]> = {
  club: [{ cover: "leather_brown", wood: "walnut" }, { cover: "velvet_green", wood: "dark_stain" }, { cover: "wool_grey", wood: "light_oak" }],
  wingback: [{ cover: "velvet_red", wood: "mahogany" }, { cover: "fabric_cream", wood: "walnut" }, { cover: "velvet_blue", wood: "cherry" }],
  lounge: [{ cover: "fabric_mustard", wood: "teak" }, { cover: "wool_charcoal", wood: "walnut" }, { cover: "fabric_teal", wood: "light_oak" }],
  rocking: [{ cover: "linen", wood: "oak" }, { cover: "velvet_green", wood: "cherry" }, { cover: "fabric_terracotta", wood: "paint_white" }],
};

const RANGES: Record<Style, { w: [number, number, number]; d: [number, number, number]; sh: [number, number, number]; bh: [number, number, number] }> = {
  club: { w: [0.84, 0.76, 0.92], d: [0.86, 0.78, 0.95], sh: [0.43, 0.4, 0.46], bh: [0.8, 0.72, 0.9] },
  wingback: { w: [0.8, 0.74, 0.88], d: [0.84, 0.78, 0.92], sh: [0.45, 0.42, 0.48], bh: [1.05, 0.98, 1.1] },
  lounge: { w: [0.75, 0.68, 0.85], d: [0.8, 0.72, 0.88], sh: [0.41, 0.38, 0.44], bh: [0.8, 0.72, 0.9] },
  rocking: { w: [0.64, 0.58, 0.7], d: [0.66, 0.6, 0.72], sh: [0.43, 0.4, 0.46], bh: [1.02, 0.95, 1.1] },
};

/** A short tapered bun foot of height $lh. */
const bunFoot = (name: string, at: [string, number, string], mirror: string, wood: string): SpecNode =>
  lathe(name, [[0.02, 0], [0.026, 0.012], [0.03, "$lh * 0.6"], [0.034, "$lh + 0.006"], [0.02, "$lh + 0.012"]], { at, mirror, segments: 14, material: wood });

/** A turned front leg of height $lh. */
const turnedLeg = (name: string, at: [string, number, string], mirror: string, wood: string): SpecNode =>
  lathe(name, [[0.016, 0], [0.02, 0.01], [0.014, 0.05], [0.018, "$lh * 0.45"], [0.024, "$lh * 0.55"], [0.02, "$lh * 0.7"], [0.026, "$lh * 0.85"], [0.026, "$lh + 0.012"]], { at, mirror, segments: 14, material: wood });

/** A tapered mid-century leg of height $lh, splayed a little. */
const taperLeg = (name: string, at: [string, number, string], mirror: string, wood: string, front: boolean): SpecNode =>
  lathe(name, [[0.012, 0], [0.014, 0.01], [0.022, "$lh * 0.92"], [0.024, "$lh + 0.012"]], { at, mirror, rotate: [front ? -3 : 3, 0, 4], segments: 14, material: wood });

/** Upholstered seat cushion and back pillow between the arms (inner width $iw): crowned, piped, optionally buttoned. */
function cushions(cover: string, tufts = 0): SpecNode[] {
  const bh = "$bh - $sh - 0.1";
  return [
    cushion("Seat", "$iw - 0.01", 0.13, "$D - $bt - 0.01", cover, { at: [0, "$sh - 0.065 - 0.01", "$bt / 2 + 0.012"], bevel: 0.045, crown: 0.02 }),
    cushion("Back_Pillow", "$iw - 0.02", 0.15, bh, cover, {
      at: [0, `$sh - 0.02 + (${bh}) / 2 * 0.99`, `-$D / 2 + $bt + 0.05 - (${bh}) / 2 * 0.139`], rotate: [82, 0, 0], bevel: 0.05, crown: 0.024, ...(tufts ? { tufts, pleats: false } : {}),
    }),
  ];
}

function club(f: { cover: string; wood: string }): SpecNode[] {
  return [group("Armchair", [
    box("Body", ["$iw + 0.04", "$sh - 0.12 - $lh", "$D - 0.02"], { at: [0, "$lh", 0], anchor: "bottom", bevel: 0.02 }),
    box("Armrest_L", ["$aw", "$ah - $lh - $aw / 2", "$D"], { at: ["$W / 2 - $aw / 2", "$lh", 0], anchor: "bottom", bevel: 0.04, mirror: "Armrest_R", children: [
      cyl("Roll", "$aw / 2 + 0.012", "$D - 0.004", { axis: "z", at: [0, "$ah - $lh - $aw / 2 - 0.012", 0], segments: 20, bevel: 0.03 }),
    ] }),
    box("Back", ["$W - 0.02", "$bh - $lh - $bt / 2", "$bt"], { at: [0, "$lh", "-$D / 2 + $bt / 2"], anchor: "bottom", bevel: 0.05, children: [
      cyl("Crown", "$bt / 2", "$W - 0.03", { axis: "x", at: [0, "$bh - $lh - $bt / 2 - 0.01", 0], segments: 20, bevel: 0.03 }),
    ] }),
    ...cushions(f.cover),
    box("Plinth", ["$W - 0.03", 0.03, "$D - 0.03"], { at: [0, "$lh - 0.004", 0], anchor: "bottom", bevel: 0.01, material: f.wood }),
    group("Legs", [
      bunFoot("Leg_FL", ["$W / 2 - 0.07", 0, "$D / 2 - 0.07"], "Leg_FR", f.wood),
      bunFoot("Leg_BL", ["$W / 2 - 0.07", 0, "-$D / 2 + 0.07"], "Leg_BR", f.wood),
    ]),
  ], { material: f.cover, vars: { lh: 0.085, aw: 0.17, ah: "$sh + 0.2", bt: 0.2, iw: "$W - 2 * $aw" } })];
}

function wingback(f: { cover: string; wood: string }): SpecNode[] {
  // A wing is a soft slab on the side of the back: rounded sections, tall and thick at the back, lower and thinner at the front.
  const rr = (xa: string, xb: string, y0: string, y1: string, c: number): [string, string][] => [
    [`${xa} + ${c}`, y0], [`${xb} - ${c}`, y0], [xb, `${y0} + ${c}`], [xb, `${y1} - ${c}`], [`${xb} - ${c}`, y1], [`${xa} + ${c}`, y1], [xa, `${y1} - ${c}`], [xa, `${y0} + ${c}`],
  ];
  const wing = (z0: string, z1: string, x: string): SpecNode =>
    loft("Wing_L", [
      { z: z0, points: rr(`${x} - 0.05`, `${x} + 0.035`, "$ah - 0.06", "$bh - 0.07", 0.02) },
      { z: `${z0} + 0.06`, points: rr(`${x} - 0.05`, `${x} + 0.035`, "$ah - 0.06", "$bh - 0.075", 0.024) },
      { z: `(${z0} + ${z1}) / 2`, points: rr(`${x} - 0.045`, `${x} + 0.035`, "$ah - 0.06", "$bh - 0.16", 0.022) },
      { z: `${z1} - 0.05`, points: rr(`${x} - 0.04`, `${x} + 0.032`, "$ah - 0.06", "$ah + 0.2", 0.022) },
      { z: z1, points: rr(`${x} - 0.034`, `${x} + 0.03`, "$ah - 0.06", "$ah + 0.15", 0.018) },
    ], { mirror: "Wing_R" });
  return [group("Armchair", [
    box("Body", ["$W - 0.02", "$sh - 0.12 - $lh", "$D - 0.02"], { at: [0, "$lh", 0], anchor: "bottom", bevel: 0.02 }),
    box("Armrest_L", ["$aw", "$ah - $sh + 0.13 - $aw / 2", "$D - $bt + 0.02"], { at: ["$W / 2 - $aw / 2", "$sh - 0.13", "$bt / 2 - 0.01"], anchor: "bottom", bevel: 0.03, mirror: "Armrest_R", children: [
      cyl("Roll", "$aw / 2 + 0.018", "$D - $bt + 0.02", { axis: "z", at: [0.008, "$ah - $sh + 0.13 - $aw / 2 - 0.018", 0], segments: 20, bevel: 0.03 }),
    ] }),
    box("Back", ["$W - 0.04", "$bh - $sh + 0.13 - 0.06", "$bt"], { at: [0, "$sh - 0.13", "-$D / 2 + $bt / 2"], anchor: "bottom", bevel: 0.05, children: [
      cyl("Crown", 0.065, "$W - 0.1", { axis: "x", at: [0, "$bh - $sh + 0.13 - 0.068", -0.01], segments: 20, bevel: 0.03 }),
    ] }),
    wing("-$D / 2 + $bt - 0.02", "-$D / 2 + $bt + 0.27", "$W / 2 - 0.05"),
    ...cushions(f.cover),
    group("Nailheads", [
      ellipsoid("Nail_{i}", [0.006, 0.006, 0.004], { at: ["-($n - 1) * 0.028 / 2", "$lh + 0.025", "$D / 2 - 0.009"], repeat: { count: "$n", step: [0.028, 0, 0] }, segments: 8 }),
    ], { material: "brass", vars: { n: "floor(($W - 0.08) / 0.028)" } }),
    group("Legs", [
      turnedLeg("Leg_FL", ["$W / 2 - 0.06", 0, "$D / 2 - 0.06"], "Leg_FR", f.wood),
      box("Leg_BL", [0.04, "$lh + 0.012", 0.04], { at: ["$W / 2 - 0.06", 0, "-$D / 2 + 0.06"], anchor: "bottom", bevel: 0.006, rotate: [8, 0, 0], mirror: "Leg_BR", material: f.wood }),
    ]),
  ], { material: f.cover, vars: { lh: 0.17, aw: 0.11, ah: "$sh + 0.2", bt: 0.18, iw: "$W - 2 * $aw" } })];
}

function lounge(f: { cover: string; wood: string }): SpecNode[] {
  return [group("Armchair", [
    box("Apron", ["$W - 0.08", 0.05, "$D - 0.12"], { at: [0, "$sh - 0.135", 0], bevel: 0.008, material: f.wood }),
    cushion("Seat", "$W - 0.2", 0.12, "$D - 0.2", f.cover, { at: [0, "$sh - 0.06 - 0.008", 0.03], bevel: 0.04, crown: 0.022, tufts: 2, pleats: false, seam: true }),
    group("Legs", [
      taperLeg("Leg_FL", ["$W / 2 - 0.07", 0, "$D / 2 - 0.09"], "Leg_FR", f.wood, true),
      taperLeg("Leg_BL", ["$W / 2 - 0.07", 0, "-$D / 2 + 0.09"], "Leg_BR", f.wood, false),
    ]),
    box("Armrest_L", [0.07, 0.026, "$D - 0.06"], { at: ["$W / 2 - 0.045", "$sh + 0.17", 0.02], bevel: 0.01, mirror: "Armrest_R", material: f.wood, children: [
      cyl("Post_F", 0.016, 0.31, { at: [0, -0.155, "$D / 2 - 0.12"], segments: 12 }),
      cyl("Post_B", 0.016, 0.31, { at: [0, -0.155, "-$D / 2 + 0.14"], segments: 12 }),
    ] }),
    group("Back", [
      box("Stile_L", [0.04, "$hb", 0.035], { at: ["$W / 2 - 0.06", 0, 0], anchor: "bottom", bevel: 0.008, mirror: "Stile_R", material: f.wood }),
      board("Crest", ["$W - 0.1", 0.05, 0.03], "x", { at: [0, "$hb - 0.03", 0], bevel: 0.01, material: f.wood }),
      cushion("Back_Pillow", "$W - 0.2", 0.12, "$hb - 0.16", f.cover, { at: [0, "0.09 + ($hb - 0.16) / 2", 0.07], rotate: [90, 0, 0], bevel: 0.045, crown: 0.022, tufts: 3, pleats: false }),
    ], { at: [0, "$sh - 0.12", "-$D / 2 + 0.07"], rotate: [-14, 0, 0], vars: { hb: "($bh - $sh + 0.12) / 0.97" } }),
  ], { material: f.cover, vars: { lh: "$sh - 0.16" } })];
}

function rocking(f: { cover: string; wood: string }): SpecNode[] {
  const pts = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];
  return [group("Armchair", [
    tube("Rocker_L", pts.map((t) => [0, `0.022 + 0.085 * ${t * t}`, `($D / 2 + 0.1) * ${t}`] as [number, string, string]), 0.022, { at: ["$W / 2 - 0.05", 0, 0], segments: 10, mirror: "Rocker_R" }),
    box("Seat", ["$W - 0.04", 0.035, "$D - 0.03"], { at: [0, "$sh - 0.0175 - 0.05", 0], bevel: 0.01, children: [
      cushion("Seat_Pad", "$W - 0.12", 0.06, "$D - 0.1", f.cover, { at: [0, 0.042, 0.01], bevel: 0.026, crown: 0.016, seam: true, material: f.cover }),
    ] }),
    group("Legs", [
      lathe("Leg_FL", [[0.016, 0], [0.019, 0.02], [0.014, "$lf * 0.3"], [0.02, "$lf * 0.5"], [0.015, "$lf * 0.7"], [0.019, "$lf + 0.01"]], { at: ["$W / 2 - 0.05", "$ry - 0.012", "$D / 2 - 0.07"], segments: 12, mirror: "Leg_FR" }),
      lathe("Leg_BL", [[0.016, 0], [0.019, 0.02], [0.014, "$lf * 0.3"], [0.02, "$lf * 0.5"], [0.015, "$lf * 0.7"], [0.019, "$lf + 0.01"]], { at: ["$W / 2 - 0.05", "$ry - 0.012", "-$D / 2 + 0.07"], segments: 12, mirror: "Leg_BR" }),
      cyl("Stretcher_L", 0.011, "$D - 0.14", { axis: "z", at: ["$W / 2 - 0.05", "$ry + 0.12", 0], segments: 10, mirror: "Stretcher_R" }),
    ]),
    box("Armrest_L", [0.06, 0.025, "$D - 0.08"], { at: ["$W / 2 - 0.035", "$sh + 0.19", 0.02], bevel: 0.01, mirror: "Armrest_R", children: [
      lathe("Arm_Post", [[0.014, 0], [0.018, 0.04], [0.012, 0.12], [0.016, 0.2], [0.014, 0.27]], { at: [-0.012, -0.265, "$D / 2 - 0.1"], segments: 12 }),
    ] }),
    group("Back", [
      box("Post_L", [0.035, "$hb", 0.035], { at: ["$W / 2 - 0.06", 0, 0], anchor: "bottom", bevel: 0.008, mirror: "Post_R" }),
      board("Crest", ["$W - 0.08", 0.08, 0.03], "x", { at: [0, "$hb - 0.05", 0], bevel: 0.012 }),
      board("Bottom_Bar", ["$W - 0.1", 0.04, 0.025], "x", { at: [0, 0.07, 0], bevel: 0.006 }),
      cyl("Spindle_{i}", 0.009, "$hb - 0.16", { at: ["-($W - 0.2) / 2", "($hb - 0.16) / 2 + 0.08", 0], repeat: { count: 7, step: ["($W - 0.2) / 6", 0, 0] }, segments: 8 }),
    ], { at: [0, "$sh - 0.08", "-$D / 2 + 0.04"], rotate: [-12, 0, 0], vars: { hb: "($bh - $sh + 0.08) / 0.98" } }),
  ], { material: f.wood, vars: { ry: `0.022 + 0.085 * pow(($D / 2 - 0.07) / ($D / 2 + 0.1), 2)`, lf: "$sh - 0.085 - $ry + 0.012" } })];
}

const TEXT: Record<Style, string> = {
  club: "a deep, low club armchair with thick rolled arms the height of the seat cushion, a rounded back and short bun feet",
  wingback: "a tall wingback armchair with flared wings, scroll arms, a brass nailhead trim and turned front legs",
  lounge: "a mid-century lounge chair: an open wooden frame with flat arms on posts, tapered splayed legs and loose cushions on a raked back",
  rocking: "a wooden rocking armchair with a spindle back, turned legs on curved rockers and a padded seat",
};

function makeArmchair(style: Style, f: { cover: string; wood: string }): AssetDraft {
  const r = RANGES[style];
  const build = { club, wingback, lounge, rocking }[style];
  const nodes = build(f);
  const wrap = [group("Root", nodes, { vars: { W: "$width", D: "$depth", sh: "$seatHeight", bh: "$backHeight" } })];
  const cover = label(f.cover);
  const wood = label(f.wood);
  return {
    slug: slugify("armchair", style, f.cover.replace(/^(fabric|velvet|wool|leather)_/, "$1-"), f.wood.replace(/^paint_/, "")),
    title: `${cap(cover)} ${style} armchair`,
    description: `${cap(TEXT[style])}, in ${cover} with ${wood}. It faces +z.`,
    tags: [style, f.cover.split("_").pop() ?? f.cover, f.wood.replace(/^paint_/, ""), "upholstered", ...(style === "rocking" ? ["schommelstoel", "rocker"] : style === "wingback" ? ["oorfauteuil"] : style === "club" ? ["clubfauteuil"] : ["loungestoel"])],
    params: [
      num("width", r.w[0], r.w[1], r.w[2], "Overall width along x in metres."),
      num("depth", r.d[0], r.d[1], r.d[2], "Overall depth along z in metres."),
      num("seatHeight", r.sh[0], r.sh[1], r.sh[2], "Height of the seat top in metres."),
      num("backHeight", r.bh[0], r.bh[1], r.bh[2], "Height of the top of the back above the floor in metres."),
    ],
    materials: { ...fmats(f.cover, f.wood, ...(style === "wingback" ? ["brass"] : [])), ...shade(f.cover) },
    nodes: wrap,
  };
}

export const armchair: Family = {
  id: "armchair",
  category: "furniture",
  archetype: "prop.chair",
  tags: ["armchair", "easy chair", "lounge chair", "fauteuil", "leunstoel", "stoel", "seat", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2] as const }).map(({ style, k }) => makeArmchair(style, FINISHES[style][k] as { cover: string; wood: string })),
};
