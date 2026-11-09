import { box, combos, cyl, group, lathe, num, slugify, tube, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { board, fmats, ring, tubular } from "./parts.js";

const STYLES = ["bar", "kitchen", "milking", "swivel"] as const;
type Style = (typeof STYLES)[number];

interface Finish { frame: string; seat: string; soft: boolean }
const FINISHES: Record<Style, Finish[]> = {
  bar: [
    { frame: "black_steel", seat: "walnut", soft: false },
    { frame: "chrome", seat: "leather_black", soft: true },
    { frame: "brushed_steel", seat: "oak", soft: false },
    { frame: "paint_red", seat: "leather_tan", soft: true },
  ],
  kitchen: [
    { frame: "oak", seat: "oak", soft: false },
    { frame: "paint_black", seat: "light_oak", soft: false },
    { frame: "pine", seat: "pine", soft: false },
    { frame: "paint_white", seat: "walnut", soft: false },
  ],
  milking: [
    { frame: "oak", seat: "oak", soft: false },
    { frame: "pine", seat: "pine", soft: false },
    { frame: "weathered_wood", seat: "weathered_wood", soft: false },
    { frame: "cherry", seat: "walnut", soft: false },
  ],
  swivel: [
    { frame: "chrome", seat: "leather_black", soft: true },
    { frame: "chrome", seat: "velvet_red", soft: true },
    { frame: "black_steel", seat: "leather_tan", soft: true },
    { frame: "brushed_steel", seat: "wool_grey", soft: true },
  ],
};

/** A round seat at the top of the stool: a dished wooden disc or an upholstered cushion on a metal pan. Top at $sh. */
function roundSeat(f: Finish): SpecNode {
  if (f.soft) {
    return lathe("Seat", [["$sr - 0.02", "$sh - 0.075"], ["$sr", "$sh - 0.06"], ["$sr + 0.004", "$sh - 0.03"], ["$sr - 0.02", "$sh - 0.004"], ["$sr * 0.6", "$sh"]], { segments: 24, material: f.seat, children: [
      lathe("Pan", [[0.06, "$sh - 0.09"], ["$sr - 0.03", "$sh - 0.085"], ["$sr - 0.02", "$sh - 0.07"], [0.06, "$sh - 0.07"]], { segments: 24, material: "black_steel" }),
    ] });
  }
  return lathe("Seat", [["$sr - 0.012", "$sh - 0.04"], ["$sr", "$sh - 0.028"], ["$sr", "$sh - 0.01"], ["$sr - 0.015", "$sh"]], { segments: 28, material: f.seat });
}

function bar(f: Finish): SpecNode[] {
  return [
    roundSeat(f),
    lathe("Mount", [[0.08, "$sh - 0.1"], ["$rt + 0.02", "$sh - 0.1"], ["$rt + 0.02", "$sh - 0.06"], [0.08, "$sh - 0.06"]], { segments: 20, material: f.frame }),
    group("Legs", [
      tube("Leg_{i}", [["$rt", "$sh - 0.07", 0], ["$rb", 0.016, 0]], 0.013, { segments: 12, repeat: { count: 4, around: "y", phase: 45 }, children: [
        cyl("Glide", 0.016, 0.016, { at: ["$rb", 0, 0], anchor: "base", material: "rubber", segments: 12 }),
      ] }),
    ], { material: tubular(f.frame) }),
    ring("Footrest_Ring", "$rb + ($rt - $rb) * ($fh - 0.016) / ($sh - 0.086)", 0.011, "$fh", { material: tubular(f.frame), segments: 28 }),
  ];
}

function kitchen(f: Finish): SpecNode[] {
  const leg = (name: string, z: string, rx: number, mirror: string): SpecNode =>
    group(name, [
      lathe("Shaft", [[0.026, 0], [0.034, "$lh * 0.75"], [0.036, "$lh + 0.006"]], { rotate: [0, 45, 0], segments: 4 }),
    ], { at: ["$xl", 0.002, z], rotate: [rx, 0, 4], mirror });
  return [
    box("Seat", ["$sw", 0.035, "$sw"], { at: [0, "$sh - 0.0175", 0], bevel: 0.012, material: f.seat, children: [
      board("Apron_F", ["2 * $ap + 0.03", 0.05, 0.02], "x", { at: [0, -0.04, "$ap"], bevel: 0.004, material: f.frame }),
      board("Apron_B", ["2 * $ap + 0.03", 0.05, 0.02], "x", { at: [0, -0.04, "-$ap"], bevel: 0.004, material: f.frame }),
      board("Apron_L", [0.02, 0.05, "2 * $ap + 0.03"], "z", { at: ["$ap", -0.04, 0], bevel: 0.004, material: f.frame, mirror: "Apron_R" }),
    ] }),
    leg("Leg_FL", "$xl", -4, "Leg_FR"),
    leg("Leg_BL", "-$xl", 4, "Leg_BR"),
    group("Stretchers", [
      board("Stretcher_F", ["2 * ($xl - 0.07 * $hs) + 0.02", 0.025, 0.022], "x", { at: [0, "$hs", "$xl - 0.07 * $hs"], bevel: 0.004 }),
      board("Stretcher_B", ["2 * ($xl - 0.07 * $hs) + 0.02", 0.025, 0.022], "x", { at: [0, "$hs", "-$xl + 0.07 * $hs"], bevel: 0.004 }),
      board("Stretcher_L", [0.022, 0.025, "2 * ($xl - 0.07 * $hs2) + 0.02"], "z", { at: ["$xl - 0.07 * $hs2", "$hs2", 0], bevel: 0.004, mirror: "Stretcher_R" }),
    ], { vars: { hs: "$sh * 0.42", hs2: "$sh * 0.3" } }),
  ];
}

function milking(f: Finish): SpecNode[] {
  return [
    lathe("Seat", [["$sr - 0.008", "$sh - $st"], ["$sr", "$sh - $st + 0.008"], ["$sr", "$sh - 0.008"], ["$sr - 0.01", "$sh"]], { segments: 28, material: f.seat, children: [
      box("Hand_Grip", [0.07, "$st + 0.004", 0.02], { at: [0, "$sh - $st / 2", "-$sr * 0.55"], bevel: 0.006, material: "dark_stain" }),
    ] }),
    group("Legs", [
      group("Leg_{i}", [
        lathe("Shaft", [[0.017, 0], [0.019, 0.03], [0.022, "$ll * 0.6"], [0.018, "$ll - 0.012"], [0.015, "$ll + 0.004"]], { segments: 12 }),
        cyl("Wedge", 0.015, 0.006, { at: [0, "$ll + 0.003", 0], material: "dark_stain", segments: 12 }),
      ], { at: ["$rt + $ll * sin(rad(12))", 0.004, 0], rotate: [0, 0, 12], repeat: { count: 3, around: "y", phase: 90 } }),
    ], { material: f.frame, vars: { ll: "($sh - 0.006) / cos(rad(12))" } }),
  ];
}

function swivel(f: Finish): SpecNode[] {
  return [
    roundSeat(f),
    lathe("Base", [[0.03, 0], ["$sr * 1.05", 0], ["$sr * 1.05 + 0.006", 0.008], ["$sr * 0.9", 0.025], [0.06, 0.05], [0.03, 0.055]], { segments: 32, material: f.frame }),
    group("Column", [
      cyl("Pedestal", 0.03, "$sh * 0.5", { at: [0, 0.04, 0], anchor: "base", segments: 18, material: "black_steel", bevel: 0.004 }),
      cyl("Gas_Lift", 0.018, "$sh * 0.5 - 0.06", { at: [0, "0.03 + $sh * 0.5", 0], anchor: "base", segments: 16, material: "chrome" }),
      cyl("Swivel_Plate", 0.06, 0.02, { at: [0, "$sh - 0.1", 0], segments: 18, material: "black_steel" }),
    ]),
    group("Footrest", [
      ring("Footrest_Ring", "$sr * 0.95", 0.011, "$fh", { segments: 32 }),
      cyl("Spoke_{i}", 0.008, "$sr * 0.95 - 0.02", { axis: "x", at: ["$sr * 0.475 + 0.01", "$fh", 0], repeat: { count: 3, around: "y", phase: 30 }, segments: 8 }),
      cyl("Collar", 0.042, 0.04, { at: [0, "$fh", 0], segments: 16 }),
    ], { material: tubular(f.frame) }),
  ];
}

const TEXT: Record<Style, string> = {
  bar: "A tall bar stool with four splayed tubular legs on rubber glides, a footrest ring and a round seat",
  kitchen: "A kitchen counter stool with a square seat on a small apron, four slightly splayed tapered legs and stretchers on two heights",
  milking: "A low three-legged milking stool: a thick round seat with a hand grip, and three splayed turned legs wedged through the seat",
  swivel: "A swivel stool on a round pedestal base with a gas-lift column, a footrest ring on spokes and an upholstered round seat",
};

const PARAMS: Record<Style, () => AssetDraft["params"]> = {
  bar: () => [num("seatHeight", 0.75, 0.62, 0.82, "Height of the seat top in metres."), num("seatRadius", 0.18, 0.16, 0.21, "Radius of the round seat."), num("footprint", 0.22, 0.19, 0.26, "Distance from the centre to each foot.")],
  kitchen: () => [num("seatHeight", 0.62, 0.5, 0.7, "Height of the seat top in metres."), num("seatWidth", 0.34, 0.3, 0.4, "Width and depth of the square seat.")],
  milking: () => [num("seatHeight", 0.32, 0.25, 0.42, "Height of the seat top in metres."), num("seatRadius", 0.15, 0.13, 0.18, "Radius of the round seat."), num("seatThickness", 0.045, 0.035, 0.06, "Thickness of the seat board.")],
  swivel: () => [num("seatHeight", 0.7, 0.58, 0.8, "Height of the seat top in metres."), num("seatRadius", 0.19, 0.17, 0.22, "Radius of the round seat and of the base.")],
};

const VARS: Record<Style, Record<string, string>> = {
  bar: { sh: "$seatHeight", sr: "$seatRadius", rb: "$footprint", rt: "$seatRadius * 0.55", fh: "$seatHeight * 0.38" },
  kitchen: { sh: "$seatHeight", sw: "$seatWidth", xl: "$seatWidth / 2 - 0.05", lh: "$seatHeight - 0.034", ap: "$seatWidth / 2 - 0.05 - 0.07 * ($seatHeight - 0.06)" },
  milking: { sh: "$seatHeight", sr: "$seatRadius", st: "$seatThickness", rt: "$seatRadius * 0.55" },
  swivel: { sh: "$seatHeight", sr: "$seatRadius", fh: "$seatHeight * 0.42" },
};

function makeStool(style: Style, f: Finish): AssetDraft {
  const nodes = [group("Stool", { bar, kitchen, milking, swivel }[style](f), { material: f.frame, vars: VARS[style] })];
  const frame = label(f.frame);
  const seat = label(f.seat);
  return {
    slug: slugify("stool", style, f.frame.replace(/^paint_/, ""), ...(f.seat !== f.frame ? [f.seat.replace(/^(leather|velvet|wool)_/, "$1-")] : [])),
    title: `${cap(frame)} ${style} stool${f.seat !== f.frame ? ` with ${seat} seat` : ""}`,
    description: `${TEXT[style]}, in ${frame}${f.seat !== f.frame ? ` with a ${seat} seat` : ""}. It has no back and faces +z.`,
    tags: [style, f.frame.replace(/^paint_/, ""), f.seat.split("_").pop() ?? f.seat, ...(style === "bar" ? ["barkruk", "bar stool"] : style === "milking" ? ["melkkrukje", "milking stool"] : style === "swivel" ? ["draaikruk", "swivel"] : ["keukenkruk", "kitchen stool"])],
    params: PARAMS[style](),
    materials: fmats(...new Set([f.frame, tubular(f.frame), f.seat, "rubber", "black_steel", "chrome", "dark_stain"])),
    nodes,
  };
}

export const stool: Family = {
  id: "stool",
  category: "furniture",
  archetype: "prop.stool",
  tags: ["stool", "kruk", "krukje", "taburet", "seat", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2, 3] as const }).map(({ style, k }) => makeStool(style, FINISHES[style][k] as Finish)),
};
