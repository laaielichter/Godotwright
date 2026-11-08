import { box, combos, cyl, group, lathe, num, slugify, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label, mats } from "../../palette.js";
import { squareLeg } from "./parts.js";

const STYLES = ["apron", "pedestal", "trestle", "farmhouse", "extending"] as const;
type Style = (typeof STYLES)[number];

interface Finish { top: string; base: string }
const FINISHES: Record<Style, Finish[]> = {
  apron: [{ top: "oak", base: "oak" }, { top: "walnut", base: "walnut" }, { top: "cherry", base: "cherry" }, { top: "birch", base: "paint_white" }],
  pedestal: [{ top: "walnut", base: "walnut" }, { top: "marble", base: "brass" }, { top: "whitewash_wood", base: "paint_cream" }, { top: "mahogany", base: "mahogany" }],
  trestle: [{ top: "rough_timber", base: "rough_timber" }, { top: "oak", base: "black_steel" }, { top: "light_oak", base: "light_oak" }, { top: "dark_stain", base: "dark_stain" }],
  farmhouse: [{ top: "pine", base: "paint_cream" }, { top: "oak", base: "paint_sand" }, { top: "weathered_wood", base: "weathered_wood" }, { top: "teak", base: "teak" }],
  extending: [{ top: "teak", base: "teak" }, { top: "walnut", base: "black_steel" }, { top: "light_oak", base: "light_oak" }, { top: "paint_white", base: "chrome" }],
};

/** Planks of the top along z, across the width ($W), each $t thick, top surface at $H. */
const plankTop = (name: string, length: string): SpecNode =>
  group(name, [
    box("Plank_{i}", ["$pw - 0.002", "$t", length], { at: ["-$W / 2 + $pw / 2", "$H - $t / 2", 0], repeat: { count: "$np", step: ["$pw", 0, 0] }, bevel: 0.006 }),
  ], { vars: { np: "ceil($W / 0.17)", pw: "$W / ceil($W / 0.17)" } });

function apron(f: Finish): SpecNode[] {
  return [
    box("Top", ["$W", "$t", "$L"], { at: [0, "$H - $t / 2", 0], bevel: 0.01, material: f.top, children: [
      box("Moulding", ["$W - 0.03", 0.016, "$L - 0.03"], { at: [0, "-$t / 2 - 0.006", 0], bevel: 0.006 }),
    ] }),
    group("Aprons", [
      box("Apron_F", ["2 * $xl", 0.09, 0.022], { at: [0, "$H - $t - 0.045", "$zl"], bevel: 0.004 }),
      box("Apron_B", ["2 * $xl", 0.09, 0.022], { at: [0, "$H - $t - 0.045", "-$zl"], bevel: 0.004 }),
      box("Apron_L", [0.022, 0.09, "2 * $zl"], { at: ["$xl", "$H - $t - 0.045", 0], bevel: 0.004, mirror: "Apron_R" }),
    ]),
    group("Legs", [
      squareLeg("Leg_FL", ["$xl", 0, "$zl"], "$H - $t + 0.004", 0.06, 0.035, "Leg_FR"),
      squareLeg("Leg_BL", ["$xl", 0, "-$zl"], "$H - $t + 0.004", 0.06, 0.035, "Leg_BR"),
    ]),
  ];
}

function pedestal(f: Finish): SpecNode[] {
  return [
    lathe("Top", [[0.004, "$H - $t"], ["$R - 0.02", "$H - $t"], ["$R", "$H - $t + 0.012"], ["$R", "$H - 0.008"], ["$R - 0.008", "$H"], [0.004, "$H"]], { segments: 48, material: f.top }),
    lathe("Pedestal", [[0.07, 0.06], [0.095, 0.085], [0.07, 0.12], [0.06, 0.2], [0.05, "$H * 0.45"], [0.08, "$H * 0.55"], [0.06, "$H * 0.65"], [0.055, "$H - $t - 0.06"], [0.14, "$H - $t - 0.04"], [0.14, "$H - $t + 0.003"], [0.02, "$H - $t + 0.003"]], { segments: 24, material: f.base }),
    group("Feet", [
      box("Foot_{i}", ["$R * 0.62", 0.065, 0.075], { at: ["$R * 0.31 + 0.03", 0.046, 0], repeat: { count: 4, around: "y", phase: 45 }, bevel: 0.018, children: [
        cyl("Pad", 0.032, 0.018, { at: ["$R * 0.31 - 0.04", -0.037, 0], segments: 12 }),
      ] }),
    ], { material: f.base }),
  ];
}

function trestle(f: Finish): SpecNode[] {
  const end = (name: string, z: string): SpecNode =>
    group(name, [
      box("Foot", ["$W - 0.12", 0.08, 0.1], { at: [0, 0.04, 0], bevel: 0.015 }),
      box("Post", [0.13, "$H - $t - 0.12", 0.08], { at: [0, 0.07, 0], anchor: "bottom", bevel: 0.012 }),
      box("Brace_L", [0.05, 0.05, 0.06], { at: [0.09, "$H - $t - 0.09", 0], rotate: [0, 0, 45], bevel: 0.006, mirror: "Brace_R" }),
      box("Cleat", ["$W - 0.16", 0.07, 0.09], { at: [0, "$H - $t - 0.035", 0], bevel: 0.012 }),
      box("Pad_L", [0.1, 0.012, 0.11], { at: ["$W / 2 - 0.12", 0.006, 0], material: "rubber", mirror: "Pad_R" }),
    ], { at: [0, 0, z] });
  return [
    plankTop("Top", "$L"),
    group("Legs", [end("Leg_F", "$L / 2 - 0.28"), end("Leg_B", "-$L / 2 + 0.28")], { material: f.base }),
    box("Stretcher", [0.07, 0.1, "$L - 0.4"], { at: [0, "$H * 0.32", 0], bevel: 0.01, material: f.base, children: [
      box("Wedge_F", [0.03, 0.12, 0.05], { at: [0, 0, "$L / 2 - 0.215"], bevel: 0.006, material: "dark_stain" }),
      box("Wedge_B", [0.03, 0.12, 0.05], { at: [0, 0, "-$L / 2 + 0.215"], bevel: 0.006, material: "dark_stain" }),
    ] }),
  ];
}

function farmhouse(f: Finish): SpecNode[] {
  const leg = (name: string, z: string, mirror: string): SpecNode =>
    lathe(name, [[0.03, 0], [0.036, 0.012], [0.03, 0.05], [0.04, "$lh * 0.22"], [0.048, "$lh * 0.3"], [0.034, "$lh * 0.42"], [0.042, "$lh * 0.55"], [0.034, "$lh * 0.68"], [0.04, "$lh * 0.74"], [0.045, "$lh * 0.75"], [0.045, "$lh + 0.004"]], { at: ["$xl", 0, z], segments: 16, mirror });
  return [
    plankTop("Top", "$L - 0.18"),
    box("Breadboard_F", ["$W", "$t", 0.09], { at: [0, "$H - $t / 2", "$L / 2 - 0.045"], bevel: 0.008, material: f.top }),
    box("Breadboard_B", ["$W", "$t", 0.09], { at: [0, "$H - $t / 2", "-$L / 2 + 0.045"], bevel: 0.008, material: f.top }),
    group("Aprons", [
      box("Apron_F", ["2 * $xl", 0.12, 0.025], { at: [0, "$H - $t - 0.06", "$zl"], bevel: 0.005 }),
      box("Apron_B", ["2 * $xl", 0.12, 0.025], { at: [0, "$H - $t - 0.06", "-$zl"], bevel: 0.005 }),
      box("Apron_L", [0.025, 0.12, "2 * $zl"], { at: ["$xl", "$H - $t - 0.06", 0], bevel: 0.005, mirror: "Apron_R" }),
      box("Drawer_Front", ["$W * 0.4", 0.08, 0.02], { at: [0, "$H - $t - 0.06", "$zl + 0.016"], bevel: 0.004, children: [
        lathe("Knob", [[0.008, -0.012], [0.008, 0.008], [0.016, 0.014], [0.012, 0.024], [0.004, 0.026]], { at: [0, 0, 0.008], rotate: [90, 0, 0], segments: 12, material: "brass" }),
      ] }),
      box("Stretcher_L", [0.04, 0.06, "2 * $zl"], { at: ["$xl", 0.14, 0], bevel: 0.006, mirror: "Stretcher_R" }),
      box("Stretcher_M", ["2 * $xl", 0.06, 0.04], { at: [0, 0.14, 0], bevel: 0.006 }),
    ], { material: f.base }),
    group("Legs", [leg("Leg_FL", "$zl", "Leg_FR"), leg("Leg_BL", "-$zl", "Leg_BR")], { material: f.base, vars: { lh: "$H - $t" } }),
  ];
}

function extending(f: Finish): SpecNode[] {
  const leg = (name: string, z: string, rx: number, mirror: string): SpecNode =>
    lathe(name, [[0.014, 0], [0.016, 0.01], [0.026, "$lh * 0.9"], [0.028, "$lh + 0.012"]], { at: ["$xl + 0.07", 0.003, z], rotate: [rx, 0, 6], segments: 16, mirror });
  return [
    group("Top", [
      box("Top_F", ["$W", "$t", "($L - $lw) / 2"], { at: [0, "$H - $t / 2", "($L + $lw) / 4"], bevel: 0.012 }),
      box("Top_B", ["$W", "$t", "($L - $lw) / 2"], { at: [0, "$H - $t / 2", "-($L + $lw) / 4"], bevel: 0.012 }),
      box("Leaf", ["$W - 0.004", "$t - 0.002", "$lw - 0.004"], { at: [0, "$H - $t / 2 - 0.001", 0], bevel: 0.004 }),
    ], { material: f.top }),
    group("Aprons", [
      box("Apron_F", ["2 * $xl", 0.08, 0.022], { at: [0, "$H - $t - 0.04", "$zl"], bevel: 0.004 }),
      box("Apron_B", ["2 * $xl", 0.08, 0.022], { at: [0, "$H - $t - 0.04", "-$zl"], bevel: 0.004 }),
      box("Apron_L", [0.022, 0.08, "2 * $zl"], { at: ["$xl", "$H - $t - 0.04", 0], bevel: 0.004, mirror: "Apron_R" }),
      box("Runner_L", [0.03, 0.03, "$L - 0.3"], { at: ["$xl - 0.05", "$H - $t - 0.015", 0], material: "brushed_steel", mirror: "Runner_R" }),
    ], { material: f.top }),
    group("Legs", [leg("Leg_FL", "$zl + 0.06", -5, "Leg_FR"), leg("Leg_BL", "-$zl - 0.06", 5, "Leg_BR")], { material: f.base, vars: { lh: "($H - $t) / cos(rad(7.5))" } }),
  ];
}

const TEXT: Record<Style, string> = {
  apron: "A classic rectangular dining table: a top with a moulded edge on an apron frame and four tapered square legs",
  pedestal: "A round pedestal dining table: a turned central column on four splayed feet under a round top",
  trestle: "A trestle dining table: a plank top on two trestle ends (feet, twin posts and cleats) joined by a long wedged stretcher",
  farmhouse: "A farmhouse dining table: a plank top with breadboard ends, a deep apron with a small drawer, chunky turned legs and an H-stretcher",
  extending: "An extending dining table: a top in two halves with an insert leaf on steel runners, a slim apron and splayed tapered legs",
};

function makeTable(style: Style, f: Finish): AssetDraft {
  const round = style === "pedestal";
  const vars: Record<string, string | number> = round
    ? { R: "$diameter / 2", H: "$height", t: "$thickness" }
    : { L: "$length", W: "$width", H: "$height", t: "$thickness", xl: "$width / 2 - 0.07", zl: "$length / 2 - (" + (style === "trestle" ? "0.28" : "0.08") + ")", lw: "$length * 0.24" };
  const nodes = [group("DiningTable", { apron, pedestal, trestle, farmhouse, extending }[style](f), { material: f.base, vars })];
  const top = label(f.top);
  const base = label(f.base);
  return {
    slug: slugify("dining-table", style, f.top.replace(/^paint_/, ""), ...(f.base !== f.top ? [f.base.replace(/^paint_/, "")] : [])),
    title: `${cap(top)} ${style} dining table`,
    description: `${TEXT[style]}, ${f.base === f.top ? `all in ${top}` : `with a ${top} top and a ${base} base`}. ${round ? "It is round and faces +z." : "Its length runs along z."}`,
    tags: [style, f.top.replace(/^paint_/, ""), f.base.replace(/^paint_/, ""), ...(round ? ["round", "rond"] : ["rectangular", "rechthoekig"]), ...(style === "extending" ? ["uitschuifbaar"] : [])],
    params: [
      ...(round
        ? [num("diameter", 1.1, 0.9, 1.4, "Diameter of the round top in metres.")]
        : [num("length", style === "farmhouse" ? 2 : 1.8, 1.4, 2.6, "Length of the top along z in metres."), num("width", 0.9, 0.8, 1.05, "Width of the top along x in metres.")]),
      num("height", 0.75, 0.72, 0.78, "Height of the top surface above the floor."),
      num("thickness", style === "farmhouse" || style === "trestle" ? 0.05 : 0.032, style === "farmhouse" || style === "trestle" ? 0.04 : 0.025, style === "farmhouse" || style === "trestle" ? 0.07 : 0.045, "Thickness of the top."),
    ],
    materials: mats(...new Set([f.top, f.base, "brass", "rubber", "dark_stain", "brushed_steel"])),
    nodes,
  };
}

export const diningTable: Family = {
  id: "dining-table",
  category: "furniture",
  archetype: "prop.table",
  tags: ["table", "dining table", "kitchen table", "tafel", "eettafel", "keukentafel", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2, 3] as const }).map(({ style, k }) => makeTable(style, FINISHES[style][k] as Finish)),
};
