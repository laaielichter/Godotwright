import { box, combos, cyl, group, lathe, num, slugify, tube, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label, mats } from "../../palette.js";
import { knob, ring, squareLeg } from "./parts.js";

const STYLES = ["tripod", "square", "drum", "c-frame"] as const;
type Style = (typeof STYLES)[number];

interface Finish { top: string; base: string }
const FINISHES: Record<Style, Finish[]> = {
  tripod: [{ top: "mahogany", base: "mahogany" }, { top: "oak", base: "oak" }, { top: "paint_black", base: "paint_black" }],
  square: [{ top: "walnut", base: "walnut" }, { top: "light_oak", base: "paint_white" }, { top: "teak", base: "teak" }],
  drum: [{ top: "marble", base: "brass" }, { top: "walnut", base: "walnut" }, { top: "terracotta", base: "terracotta" }],
  "c-frame": [{ top: "oak", base: "black_steel" }, { top: "marble_black", base: "brass" }, { top: "glass_clear", base: "chrome" }],
};

/** A round top with a soft edge, surface at $H. */
const roundTop = (f: Finish): SpecNode =>
  lathe("Top", [[0.004, "$H - $t"], ["$R - 0.01", "$H - $t"], ["$R", "$H - $t + 0.008"], ["$R", "$H - 0.005"], ["$R - 0.005", "$H"], [0.004, "$H"]], { segments: 40, material: f.top });

function tripod(f: Finish): SpecNode[] {
  return [
    roundTop(f),
    lathe("Pedestal", [[0.03, 0.12], [0.045, 0.15], [0.03, 0.2], [0.026, "$H * 0.5"], [0.04, "$H * 0.6"], [0.028, "$H * 0.72"], [0.03, "$H - $t - 0.03"], [0.08, "$H - $t - 0.015"], [0.08, "$H - $t + 0.002"], [0.01, "$H - $t + 0.002"]], { segments: 18 }),
    group("Feet", [
      tube("Foot_{i}", [[0.02, 0.17, 0], [0.09, 0.13, 0], ["$R * 0.62", 0.04, 0], ["$R * 0.75", 0.014, 0], ["$R * 0.8", 0.014, 0]], [0.022, 0.02, 0.015, 0.013, 0.013], { segments: 10, repeat: { count: 3, around: "y", phase: 90 } }),
    ]),
  ];
}

function square(f: Finish): SpecNode[] {
  return [
    box("Top", ["$S", "$t", "$S"], { at: [0, "$H - $t / 2", 0], bevel: 0.006, material: f.top }),
    box("Apron_B", ["2 * $xl", 0.12, 0.018], { at: [0, "$H - $t - 0.06", "-$xl"], bevel: 0.003 }),
    box("Apron_L", [0.018, 0.12, "2 * $xl"], { at: ["$xl", "$H - $t - 0.06", 0], bevel: 0.003, mirror: "Apron_R" }),
    group("Drawer", [
      box("Front", ["2 * $xl - 0.03", 0.1, 0.018], { bevel: 0.004, material: f.top }),
      knob("Knob", [0, 0, 0.008], "brass"),
    ], { at: [0, "$H - $t - 0.06", "$xl"] }),
    box("Shelf", ["2 * $xl + 0.01", 0.018, "2 * $xl + 0.01"], { at: [0, 0.12, 0], bevel: 0.004, material: f.top }),
    group("Legs", [
      squareLeg("Leg_FL", ["$xl", 0, "$xl"], "$H - $t + 0.003", 0.035, 0.025, "Leg_FR"),
      squareLeg("Leg_BL", ["$xl", 0, "-$xl"], "$H - $t + 0.003", 0.035, 0.025, "Leg_BR"),
    ]),
  ];
}

function drum(f: Finish): SpecNode[] {
  return [
    roundTop(f),
    lathe("Pedestal", [[0.004, 0.012], ["$R * 0.8", 0.012], ["$R * 0.82", 0.04], ["$R * 0.7", "$H * 0.35"], ["$R * 0.66", "$H * 0.5"], ["$R * 0.7", "$H * 0.65"], ["$R * 0.85", "$H - $t + 0.002"], [0.004, "$H - $t + 0.002"]], { segments: 36, material: f.base }),
    ring("Band", "$R * 0.66", 0.008, "$H * 0.5", { material: "brass", segments: 36 }),
    lathe("Plinth", [[0.004, 0], ["$R * 0.78", 0], ["$R * 0.78", 0.014], [0.004, 0.014]], { segments: 36, material: "rubber" }),
  ];
}

function cframe(f: Finish): SpecNode[] {
  return [
    roundTop(f),
    group("Frame", [
      tube("Leg", [["-$R * 0.95", "$H - $t - 0.012", 0], ["-$R * 0.95", 0.012, 0], ["$R * 0.4", 0.012, 0]], 0.012, { segments: 12, at: [0, 0, 0] }),
      tube("Foot", [["-$R * 0.95", 0.012, "-$R * 0.35"], ["-$R * 0.95", 0.012, "$R * 0.35"]], 0.012, { segments: 12 }),
      tube("Brace", [["-$R * 0.95", "$H - $t - 0.012", "-$R * 0.3"], ["-$R * 0.95", "$H - $t - 0.012", "$R * 0.3"]], 0.01, { segments: 10 }),
      cyl("Plate", 0.08, 0.008, { at: [0, "$H - $t - 0.004", 0], segments: 20 }),
      tube("Arm", [["-$R * 0.95", "$H - $t - 0.012", 0], [0, "$H - $t - 0.012", 0]], 0.01, { segments: 10 }),
    ], { material: f.base, at: ["$R * 0.25", 0, 0] }),
  ];
}

const TEXT: Record<Style, string> = {
  tripod: "A round tripod side table: a turned column on three curved feet under a round top",
  square: "A square end table with a small drawer in its apron, four tapered legs and a lower shelf",
  drum: "A round drum side table: a waisted turned drum body with a ring band under a round top",
  "c-frame": "A C-shaped sofa side table: a round top on a cantilevered bent-tube frame that slides under a sofa",
};

function makeSideTable(style: Style, f: Finish): AssetDraft {
  const round = style !== "square";
  const vars: Record<string, string | number> = round ? { R: "$diameter / 2", H: "$height", t: style === "c-frame" && f.top.startsWith("glass") ? 0.012 : 0.025 } : { S: "$size", H: "$height", t: 0.024, xl: "$size / 2 - 0.035" };
  const top = label(f.top);
  const base = label(f.base);
  return {
    slug: slugify("side-table", style, f.top.replace(/^(paint|glass)_/, ""), ...(f.base !== f.top ? [f.base.replace(/^paint_/, "")] : [])),
    title: `${cap(top)} ${style === "c-frame" ? "C-frame" : style} side table`,
    description: `${TEXT[style]}, ${f.base === f.top ? `in ${top}` : `with a ${top} top and a ${base} base`}. It faces +z.`,
    tags: [style, f.top.replace(/^(paint|glass)_/, ""), f.base.replace(/^paint_/, ""), "end table", "bijzettafel", "wijntafel", ...(round ? ["round", "rond"] : ["square", "vierkant"])],
    params: [
      round ? num("diameter", 0.45, 0.36, 0.6, "Diameter of the round top in metres.") : num("size", 0.48, 0.38, 0.6, "Width and depth of the square top."),
      num("height", style === "c-frame" ? 0.6 : 0.55, 0.45, 0.66, "Height of the top surface above the floor."),
    ],
    materials: mats(...new Set([f.top, f.base, "brass", "rubber"])),
    nodes: [group("SideTable", { tripod, square, drum, "c-frame": cframe }[style](f), { material: f.base, vars })],
  };
}

export const sideTable: Family = {
  id: "side-table",
  category: "furniture",
  archetype: "prop.table",
  tags: ["side table", "end table", "small table", "bijzettafel", "tafeltje", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2] as const }).map(({ style, k }) => makeSideTable(style, FINISHES[style][k] as Finish)),
};
