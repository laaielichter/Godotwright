import { box, combos, cyl, group, lathe, num, slugify, tube, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { board, fmats, squareLeg } from "./parts.js";

const STYLES = ["shelf", "tripod", "sled", "hairpin"] as const;
type Style = (typeof STYLES)[number];

interface Finish { top: string; base: string }
const FINISHES: Record<Style, Finish[]> = {
  shelf: [{ top: "oak", base: "oak" }, { top: "walnut", base: "walnut" }, { top: "whitewash_wood", base: "paint_white" }],
  tripod: [{ top: "teak", base: "teak" }, { top: "marble", base: "walnut" }, { top: "paint_black", base: "light_oak" }],
  sled: [{ top: "glass_clear", base: "chrome" }, { top: "glass_frosted", base: "black_steel" }, { top: "marble_black", base: "brass" }],
  hairpin: [{ top: "rough_timber", base: "black_steel" }, { top: "light_oak", base: "black_steel" }, { top: "dark_stain", base: "copper" }],
};

function shelf(f: Finish): SpecNode[] {
  return [
    box("Top", ["$W", "$t", "$D"], { at: [0, "$H - $t / 2", 0], bevel: 0.008, material: f.top }),
    group("Aprons", [
      board("Apron_F", ["2 * $xl", 0.06, 0.02], "x", { at: [0, "$H - $t - 0.03", "$zl"], bevel: 0.004 }),
      board("Apron_B", ["2 * $xl", 0.06, 0.02], "x", { at: [0, "$H - $t - 0.03", "-$zl"], bevel: 0.004 }),
      board("Apron_L", [0.02, 0.06, "2 * $zl"], "z", { at: ["$xl", "$H - $t - 0.03", 0], bevel: 0.004, mirror: "Apron_R" }),
    ]),
    box("Shelf", ["2 * $xl + 0.02", 0.022, "2 * $zl + 0.02"], { at: [0, 0.11, 0], bevel: 0.005, material: f.top, children: [
      box("Magazine_{i}", [0.22, 0.008, 0.29], { at: ["-$xl * 0.4", 0.015, 0], repeat: { count: 3, step: [0.01, 0.008, 0.006] }, material: "paper" }),
    ] }),
    group("Legs", [
      squareLeg("Leg_FL", ["$xl", 0, "$zl"], "$H - $t + 0.003", 0.05, 0.035, "Leg_FR"),
      squareLeg("Leg_BL", ["$xl", 0, "-$zl"], "$H - $t + 0.003", 0.05, 0.035, "Leg_BR"),
    ]),
  ];
}

function tripod(f: Finish): SpecNode[] {
  return [
    lathe("Top", [["$R - 0.015", "$H - $t"], ["$R", "$H - $t + 0.01"], ["$R", "$H - 0.006"], ["$R - 0.006", "$H"]], { segments: 48, material: f.top }),
    lathe("Hub", [[0.004, "$H - $t - 0.05"], [0.1, "$H - $t - 0.05"], [0.11, "$H - $t - 0.03"], ["$R * 0.5", "$H - $t + 0.002"], [0.004, "$H - $t + 0.002"]], { segments: 24 }),
    group("Legs", [
      lathe("Leg_{i}", [[0.012, 0], [0.014, 0.01], [0.024, "$ll * 0.85"], [0.026, "$ll + 0.01"]], { at: ["0.08 + $ll * sin(rad(14))", 0.003, 0], rotate: [0, 0, 14], segments: 14, repeat: { count: 3, around: "y", phase: 90 } }),
    ], { vars: { ll: "($H - $t - 0.035) / cos(rad(14))" } }),
  ];
}

function sled(f: Finish): SpecNode[] {
  const glass = f.top.startsWith("glass");
  const runner = (name: string, mirror: string): SpecNode =>
    group(name, [
      tube("Bow", [[0, 0.012, "-$zl"], [0, "$H - $t - 0.012", "-$zl"], [0, "$H - $t - 0.012", "$zl"], [0, 0.012, "$zl"]], 0.012, { segments: 12 }),
      cyl("Skid", 0.012, "2 * $zl + 0.024", { axis: "z", at: [0, 0.012, 0], segments: 12 }),
    ], { at: ["$xl", 0, 0], mirror });
  return [
    box("Top", ["$W", "$t", "$D"], { at: [0, "$H - $t / 2", 0], bevel: glass ? 0.004 : 0.008, material: f.top }),
    group("Legs", [runner("Leg_L", "Leg_R")], { material: f.base }),
    group("Frame", [
      cyl("Rail_F", 0.01, "2 * $xl", { axis: "x", at: [0, "$H - $t - 0.012", "$zl"], segments: 10 }),
      cyl("Rail_B", 0.01, "2 * $xl", { axis: "x", at: [0, "$H - $t - 0.012", "-$zl"], segments: 10 }),
      cyl("Low_Rail", 0.01, "2 * $xl", { axis: "x", at: [0, 0.012, 0], segments: 10 }),
      ...(glass ? [cyl("Bumper_{i}", 0.012, 0.004, { at: ["-$xl", "$H - $t - 0.002", "-$zl"], repeat: { count: 2, step: ["2 * $xl", 0, 0] }, material: "glass_clear", segments: 10 })] : []),
    ], { material: f.base }),
  ];
}

function hairpin(f: Finish): SpecNode[] {
  const pin = (name: string, x: string, z: string, mirror: string): SpecNode =>
    group(name, [
      tube("Rod", [[-0.07, "$H - $t - 0.01", 0], [-0.008, 0.02, 0], [0, 0.007, 0], [0.008, 0.02, 0], [0.07, "$H - $t - 0.01", 0]], 0.0065, { segments: 8 }),
      box("Plate", [0.16, 0.008, 0.07], { at: [0, "$H - $t - 0.004", 0], bevel: 0.002 }),
    ], { at: [x, 0, z], rotate: [0, 30, 0], mirror });
  return [
    group("Top", [
      box("Plank_{i}", ["$W", "$t", "$D / 3 - 0.002"], { at: [0, "$H - $t / 2", "-$D / 3"], repeat: { count: 3, step: [0, 0, "$D / 3"] }, bevel: 0.007 }),
    ], { material: f.top }),
    group("Legs", [pin("Leg_FL", "$W / 2 - 0.12", "$D / 2 - 0.09", "Leg_FR"), pin("Leg_BL", "$W / 2 - 0.12", "-$D / 2 + 0.09", "Leg_BR")], { material: f.base }),
  ];
}

const TEXT: Record<Style, string> = {
  shelf: "A rectangular coffee table with a slim apron, four tapered square legs and a lower shelf holding a few magazines",
  tripod: "A round mid-century coffee table: a round top on a turned hub with three splayed tapered legs",
  sled: "A low coffee table with a slab top on two sled frames of bent tube joined by rails",
  hairpin: "An industrial coffee table: a top of three thick planks on four steel hairpin legs",
};

function makeCoffeeTable(style: Style, f: Finish): AssetDraft {
  const round = style === "tripod";
  const vars: Record<string, string | number> = round ? { R: "$diameter / 2", H: "$height", t: "$thickness" } : { W: "$width", D: "$depth", H: "$height", t: "$thickness", xl: "$width / 2 - 0.05", zl: "$depth / 2 - 0.05" };
  const top = label(f.top);
  const base = label(f.base);
  const thick: [number, number, number] = style === "hairpin" ? [0.05, 0.04, 0.07] : style === "sled" ? [0.015, 0.01, 0.025] : [0.03, 0.022, 0.045];
  return {
    slug: slugify("coffee-table", style, f.top.replace(/^(paint|glass)_/, ""), ...(f.base !== f.top ? [f.base.replace(/^paint_/, "")] : [])),
    title: `${cap(top)} ${style} coffee table`,
    description: `${TEXT[style]}, ${f.base === f.top ? `all in ${top}` : `with a ${top} top and a ${base} base`}. ${round ? "It is round" : "Its long side runs along x"} and it faces +z.`,
    tags: [style, f.top.replace(/^(paint|glass)_/, ""), f.base.replace(/^paint_/, ""), "low table", "salontafel", "lage tafel", ...(round ? ["round", "rond"] : [])],
    params: [
      ...(round ? [num("diameter", 0.9, 0.7, 1.1, "Diameter of the round top in metres.")] : [num("width", 1.15, 0.9, 1.4, "Length of the top along x in metres."), num("depth", 0.6, 0.5, 0.75, "Depth of the top along z in metres.")]),
      num("height", 0.42, 0.36, 0.48, "Height of the top surface above the floor."),
      num("thickness", thick[0], thick[1], thick[2], "Thickness of the top."),
    ],
    materials: { ...fmats(...new Set([f.top, f.base, "glass_clear"])), paper: { color: [0.6, 0.58, 0.53], metallic: 0, roughness: 0.6, texture: "plaster" } },
    nodes: [group("CoffeeTable", { shelf, tripod, sled, hairpin }[style](f), { material: f.base, vars })],
  };
}

export const coffeeTable: Family = {
  id: "coffee-table",
  category: "furniture",
  archetype: "prop.table",
  tags: ["coffee table", "low table", "table", "salontafel", "bijzettafel", "tafel", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2] as const }).map(({ style, k }) => makeCoffeeTable(style, FINISHES[style][k] as Finish)),
};
