import { box, combos, cyl, group, lathe, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { board, fmats } from "./parts.js";

/** The back of the chair, from its rails to its filling. */
const STYLES = {
  ladder: { legs: "turned", text: "a ladder back of three curved rails" },
  spindle: { legs: "turned", text: "a spindle back of five round spindles" },
  panel: { legs: "square", text: "a solid back panel" },
  slats: { legs: "square", text: "a back of three tall flat slats" },
} as const;

/** Frame finish, and the cushion that goes with it (none: a plain wooden seat). */
const FINISHES = [
  { frame: "oak", cushion: undefined },
  { frame: "walnut", cushion: "leather_brown" },
  { frame: "pine", cushion: undefined },
  { frame: "cherry", cushion: "velvet_green" },
  { frame: "paint_black", cushion: "wool_charcoal" },
  { frame: "paint_white", cushion: "linen" },
] as const;

/** A turned leg from the floor up to the seat, as a lathe profile in terms of $h (its height). */
const turnedLeg = (name: string, at: [string, number, string], mirror?: string): SpecNode =>
  lathe(name, [
    [0.014, 0],
    [0.017, 0.012],
    [0.013, 0.06],
    [0.016, "$h * 0.3"],
    [0.019, "$h * 0.32"],
    [0.015, "$h * 0.36"],
    [0.017, "$h * 0.62"],
    [0.02, "$h * 0.66"],
    [0.02, "$h"],
  ], { at, segments: 16, ...(mirror ? { mirror } : {}) });

const squareLeg = (name: string, at: [string, number, string], mirror?: string): SpecNode =>
  box(name, ["$t", "$h", "$t"], { at, anchor: "bottom", bevel: 0.004, ...(mirror ? { mirror } : {}) });

function backFilling(style: keyof typeof STYLES): SpecNode[] {
  switch (style) {
    case "ladder":
      return [board("Slat_{i}", ["2 * $lx", 0.045, 0.016], "x", { at: [0, "$b * 0.3", 0], repeat: { count: 3, step: [0, "$b * 0.19", 0] }, bevel: 0.005 })];
    case "spindle":
      return [cyl("Spindle_{i}", 0.009, "$b - 0.09", { at: ["-$lx * 0.66", "($b - 0.09) / 2 + 0.03", 0], repeat: { count: 5, step: ["$lx * 0.33", 0, 0] }, segments: 10 })];
    case "panel":
      return [box("Panel", ["2 * $lx - 0.01", "$b * 0.55", 0.018], { at: [0, "$b * 0.58", 0], bevel: 0.007 })];
    case "slats":
      return [box("Slat_{i}", ["$lx * 0.36", "$b - 0.1", 0.015], { at: ["-$lx * 0.6", "($b - 0.1) / 2 + 0.03", 0], repeat: { count: 3, step: ["$lx * 0.6", 0, 0] }, bevel: 0.004 })];
  }
}

function chair(style: keyof typeof STYLES, finish: (typeof FINISHES)[number]): AssetDraft {
  const turned = STYLES[style].legs === "turned";
  const leg = turned ? turnedLeg : squareLeg;
  const wood = finish.frame;
  const seatParts: SpecNode[] = [box("Seat", ["$seatWidth", "$st", "$seatDepth"], { at: [0, "$seatHeight - $st / 2", 0], bevel: 0.007 })];
  if (finish.cushion) {
    seatParts.push(box("Cushion", ["$seatWidth - 0.03", 0.05, "$seatDepth - 0.03"], { at: [0, "$seatHeight + 0.02", 0.005], bevel: 0.02, material: finish.cushion }));
  }
  const nodes: SpecNode[] = [
    group("DiningChair", [
      ...seatParts,
      group("Legs", [
        leg("Leg_FL", ["$lx", 0, "$lz"], "Leg_FR"),
        leg("Leg_BL", ["$lx", 0, "-$lz"], "Leg_BR"),
      ], { vars: { h: "$seatHeight - $st + 0.002" } }),
      group("Apron", [
        board("Apron_F", ["2 * $lx", 0.07, 0.02], "x", { at: [0, "$seatHeight - $st - 0.034", "$lz"], bevel: 0.003 }),
        board("Apron_B", ["2 * $lx", 0.07, 0.02], "x", { at: [0, "$seatHeight - $st - 0.034", "-$lz"], bevel: 0.003 }),
        board("Apron_L", [0.02, 0.07, "2 * $lz"], "z", { at: ["$lx", "$seatHeight - $st - 0.034", 0], bevel: 0.003, mirror: "Apron_R" }),
      ]),
      group("Stretchers", [
        cyl("Stretcher_L", 0.011, "2 * $lz", { axis: "z", at: ["$lx", 0.16, 0], segments: 12, mirror: "Stretcher_R" }),
        cyl("Stretcher_F", 0.011, "2 * $lx", { axis: "x", at: [0, 0.11, "$lz"], segments: 12 }),
      ]),
      group("Backrest", [
        box("Upright_L", ["$t * 0.9", "$b", "$t * 0.9"], { at: ["$lx", -0.025, 0], anchor: "bottom", bevel: 0.005, mirror: "Upright_R" }),
        board("BackRail", ["2 * $lx + 0.02", 0.075, 0.024], "x", { at: [0, "$b - 0.045", 0], bevel: 0.008 }),
        ...backFilling(style),
      ], { at: [0, "$seatHeight", "-$lz"], rotate: [-8, 0, 0], vars: { b: "$backHeight" } }),
    ], { material: wood, vars: { t: 0.038, st: 0.03, lx: "$seatWidth / 2 - 0.024", lz: "$seatDepth / 2 - 0.024" } }),
  ];
  const finishName = label(wood);
  return {
    slug: slugify("dining-chair", wood.replace(/^paint_/, ""), style),
    title: `${finishName.charAt(0).toUpperCase()}${finishName.slice(1)} ${style === "slats" ? "slat-back" : `${style}-back`} dining chair`,
    description: `A ${finishName} dining chair with ${turned ? "turned" : "square"} legs, an apron and stretchers, ${STYLES[style].text} on raked uprights${finish.cushion ? ` and a ${label(finish.cushion)} seat cushion` : " and a plain wooden seat"}. It faces +z.`,
    tags: [style, turned ? "turned" : "square", wood.replace(/^paint_/, ""), ...(finish.cushion ? ["cushion", "upholstered"] : [])],
    params: [
      num("seatHeight", 0.46, 0.4, 0.52, "Height of the seat top in metres."),
      num("seatWidth", 0.45, 0.4, 0.56, "Seat width along x."),
      num("seatDepth", 0.44, 0.38, 0.52, "Seat depth along z."),
      num("backHeight", 0.46, 0.3, 0.56, "Height of the back above the seat."),
    ],
    materials: fmats(wood, ...(finish.cushion ? [finish.cushion] : [])),
    nodes,
  };
}

export const diningChair: Family = {
  id: "dining-chair",
  category: "furniture",
  archetype: "prop.chair",
  tags: ["chair", "dining chair", "kitchen chair", "stoel", "eetkamerstoel", "keukenstoel", "seat", "furniture", "meubel"],
  assets: () => combos({ style: Object.keys(STYLES) as (keyof typeof STYLES)[], finish: FINISHES }).map(({ style, finish }) => chair(style, finish)),
};
