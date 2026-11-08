import { box, cyl, group, int, num, roof, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { GRIME, LOCAL, boardX, boardZ, grimeBox, grimeProfile, nice, up, useMats } from "./common.js";

type Style = "glass" | "cantilever" | "wooden" | "canopy";
interface Finish { frame: string; accent: string }

const STYLES: Record<Style, { title: string; text: string; finishes: Finish[] }> = {
  glass: { title: "glass bus shelter", text: "four corner posts, glazed back bays with rails, half-depth glass ends, a flat roof with a coloured fascia and a light strip, and a bench along the back", finishes: [{ frame: "aluminium", accent: "paint_red" }, { frame: "paint_anthracite", accent: "paint_yellow" }] },
  cantilever: { title: "cantilever bus shelter", text: "a row of back posts carrying beams that reach forward under a frosted glass roof, glazed back bays and a long bench", finishes: [{ frame: "paint_green", accent: "paint_white" }, { frame: "black_steel", accent: "paint_blue" }] },
  wooden: { title: "wooden bus shelter", text: "timber corner posts, boarded back and half-depth side walls, a slate gable roof on wall plates and a plank bench", finishes: [{ frame: "oak", accent: "slate" }, { frame: "weathered_wood", accent: "terracotta" }] },
  canopy: { title: "canopy bus stop", text: "two posts holding a mono-pitch canopy with a gutter, a perforated back screen and a perch bench", finishes: [{ frame: "brushed_steel", accent: "paint_yellow" }, { frame: "paint_anthracite", accent: "paint_green" }] },
};

/** The stop sign on its own mast to the right of the shelter, with a timetable case. */
const sign = (): SpecNode =>
  group("Sign", [
    cyl("Mast", 0.04, 2.95, { anchor: "base", segments: 16, material: "galvanised" }),
    cyl("Footing", 0.1, 0.04, { anchor: "base", segments: 16, material: "galvanised" }),
    box("Board", [0.46, 0.46, 0.025], { at: [0, 2.6, 0.05], bevel: 0.006, material: "paint_yellow" }),
    box("Pictogram", [0.3, 0.16, 0.006], { at: [0, 2.62, 0.064], bevel: 0.003, material: "paint_black" }),
    box("RouteBand", [0.46, 0.08, 0.03], { at: [0, 2.32, 0.05], bevel: 0.004, material: "paint_white" }),
    box("Timetable", [0.36, 0.5, 0.06], { at: [0, 1.5, 0.06], bevel: 0.01, material: "galvanised" }),
    box("TimetableGlass", [0.3, 0.42, 0.006], { at: [0, 1.5, 0.092], material: "glass_clear" }),
  ], { at: ["$width / 2 + 0.6", 0, "$depth / 2 - 0.1"] });

const backBays = (z: string, y0: number, top: string): SpecNode[] => [
  box("BackGlass_{i}", ["$width / $bays - 0.09", `${top} - ${y0}`, 0.012], { at: ["-$width / 2 + $width / (2 * $bays)", y0, z], anchor: "bottom", repeat: { count: "$bays", step: ["$width / $bays", 0, 0] }, material: "glass_clear" }),
  box("Mullion_{i}", [0.06, `${top} - ${y0} + 0.04`, 0.06], { at: ["-$width / 2 + $width / $bays", `${y0} - 0.02`, z], anchor: "bottom", repeat: { count: "$bays - 1", step: ["$width / $bays", 0, 0] }, bevel: 0.006 }),
  box("KickRail", ["$width", 0.06, 0.05], { at: [0, y0, z], bevel: 0.006 }),
  box("TopRail", ["$width", 0.06, 0.05], { at: [0, top, z], bevel: 0.006 }),
];

const plankBench = (z: string, len: string, wood: string, legs: string): SpecNode =>
  group("Bench", [
    boardX("Plank", [len, 0.045, 0.34], { at: [0, 0.45, 0], bevel: 0.008, material: wood }),
    box("Bracket_L", [0.04, 0.43, 0.3], { at: [`${len} * 0.4`, 0, -0.01], anchor: "bottom", bevel: 0.005, material: legs, mirror: "Bracket_R" }),
  ], { at: [0, 0, z] });

function nodes(style: Style, f: Finish): SpecNode[] {
  switch (style) {
    case "glass":
      return [
        group("Shelter", [
          box("Post_FL", [0.08, "$height", 0.08], { at: ["$width / 2 - 0.04", 0, "$depth / 2 - 0.04"], anchor: "bottom", bevel: 0.008, mirror: "Post_FR" }),
          box("Post_BL", [0.08, "$height", 0.08], { at: ["$width / 2 - 0.04", 0, "-$depth / 2 + 0.04"], anchor: "bottom", bevel: 0.008, mirror: "Post_BR" }),
          ...grimeBox("Grime_FL", 0.08, 0.08, 0.25, ["$width / 2 - 0.04", 0.03, "$depth / 2 - 0.04"], 0.008),
          ...grimeBox("Grime_FR", 0.08, 0.08, 0.25, ["-$width / 2 + 0.04", 0.03, "$depth / 2 - 0.04"], 0.008),
          ...grimeBox("Grime_BL", 0.08, 0.08, 0.25, ["$width / 2 - 0.04", 0.03, "-$depth / 2 + 0.04"], 0.008),
          ...grimeBox("Grime_BR", 0.08, 0.08, 0.25, ["-$width / 2 + 0.04", 0.03, "-$depth / 2 + 0.04"], 0.008),
          ...backBays("-$depth / 2 + 0.04", 0.15, "$height - 0.3"),
          box("SideGlass_L", [0.012, "$height - 0.45", "$depth * 0.5"], { at: ["$width / 2 - 0.04", 0.15, "-$depth / 2 + $depth * 0.25 + 0.04"], anchor: "bottom", material: "glass_clear", mirror: "SideGlass_R" }),
          box("SideRail_L", [0.05, 0.06, "$depth - 0.08"], { at: ["$width / 2 - 0.04", "$height - 0.3", 0], bevel: 0.006, mirror: "SideRail_R" }),
        ]),
        group("Roof", [
          box("Deck", ["$width + 0.3", 0.12, "$depth + 0.3"], { at: [0, "$height + 0.06", 0], bevel: 0.02 }),
          box("Fascia", ["$width + 0.32", 0.08, 0.02], { at: [0, "$height + 0.06", "$depth / 2 + 0.15"], material: f.accent }),
          box("LightStrip", ["$width * 0.8", 0.012, 0.06], { at: [0, "$height - 0.005", "$depth * 0.15"], material: "bulb_cool" }),
        ]),
        plankBench("-$depth / 2 + 0.24", "$width * 0.6", "light_oak", f.frame),
        sign(),
      ];
    case "cantilever":
      return [
        group("Shelter", [
          box("Post_{i}", [0.1, "$height + 0.08", 0.12], { at: ["-$width / 2 + 0.05", 0, "-$depth / 2 + 0.06"], anchor: "bottom", bevel: 0.01, repeat: { count: "$bays + 1", step: ["($width - 0.1) / $bays", 0, 0] } }),
          box("Beam_{i}", [0.08, 0.1, "$depth + 0.1"], { at: ["-$width / 2 + 0.05", "$height + 0.02", 0.0], rotate: [-4, 0, 0], bevel: 0.01, repeat: { count: "$bays + 1", step: ["($width - 0.1) / $bays", 0, 0] } }),
          ...backBays("-$depth / 2 + 0.06", 0.2, "$height - 0.25"),
        ]),
        group("Roof", [
          box("Glazing", ["$width + 0.2", 0.02, "$depth + 0.2"], { at: [0, "$height + 0.085", 0.0], rotate: [-4, 0, 0], material: "glass_frosted" }),
          box("Edge", ["$width + 0.22", 0.06, 0.04], { at: [0, "$height + 0.085 + ($depth / 2 + 0.1) * 0.07", "$depth / 2 + 0.1"], bevel: 0.01, material: f.accent }),
        ]),
        plankBench("-$depth / 2 + 0.25", "$width * 0.8", "teak", f.frame),
        sign(),
      ];
    case "wooden":
      return [
        group("Shelter", [
          box("Post_FL", [0.12, "$height", 0.12], { at: ["$width / 2 - 0.06", 0, "$depth / 2 - 0.06"], anchor: "bottom", bevel: 0.01, mirror: "Post_FR" }),
          box("Post_BL", [0.12, "$height", 0.12], { at: ["$width / 2 - 0.06", 0, "-$depth / 2 + 0.06"], anchor: "bottom", bevel: 0.01, mirror: "Post_BR" }),
          ...grimeBox("Grime_FL", 0.12, 0.12, 0.25, ["$width / 2 - 0.06", 0.03, "$depth / 2 - 0.06"], 0.008),
          ...grimeBox("Grime_FR", 0.12, 0.12, 0.25, ["-$width / 2 + 0.06", 0.03, "$depth / 2 - 0.06"], 0.008),
          ...grimeBox("Grime_BL", 0.12, 0.12, 0.25, ["$width / 2 - 0.06", 0.03, "-$depth / 2 + 0.06"], 0.008),
          ...grimeBox("Grime_BR", 0.12, 0.12, 0.25, ["-$width / 2 + 0.06", 0.03, "-$depth / 2 + 0.06"], 0.008),
          boardX("Weatherboard_{i}", ["$width - 0.1", 0.15, 0.025], { at: [0, 0.1, "-$depth / 2 + 0.05"], anchor: "bottom", bevel: 0.004, repeat: { count: "$boards", step: [0, 0.155, 0] } }),
          group("Side_L", [boardZ("Weatherboard_{i}", [0.025, 0.15, "$depth * 0.5"], { at: [0, 0.1, "-$depth / 4 + 0.06"], anchor: "bottom", bevel: 0.004, repeat: { count: "$boards", step: [0, 0.155, 0] } })], { at: ["$width / 2 - 0.05", 0, 0], mirror: "Side_R" }),
          boardX("Plate_F", ["$width + 0.1", 0.12, 0.14], { at: [0, "$height", "$depth / 2 - 0.06"], bevel: 0.01 }),
          boardX("Plate_B", ["$width + 0.1", 0.12, 0.14], { at: [0, "$height", "-$depth / 2 + 0.06"], bevel: 0.01 }),
          boardZ("TieBeam_L", [0.1, 0.1, "$depth"], { at: ["$width / 2 - 0.06", "$height", 0], bevel: 0.01, mirror: "TieBeam_R" }),
        ], { vars: { boards: "floor(($height - 0.5) / 0.155)" } }),
        group("Roof", [
          roof("Covering", { x0: "-$width / 2 - 0.25", x1: "$width / 2 + 0.25", z0: "-$depth / 2 - 0.3", z1: "$depth / 2 + 0.3", y: "$height + 0.05", rise: "$depth * 0.4" }, { material: f.accent }),
          boardX("Ridge", ["$width + 0.55", 0.06, 0.08], { at: [0, "$height + 0.05 + $depth * 0.4", 0], bevel: 0.01, material: f.frame }),
        ]),
        plankBench("-$depth / 2 + 0.24", "$width * 0.7", f.frame, f.frame),
        sign(),
      ];
    case "canopy":
      return [
        group("Shelter", [
          cyl("Post_L", 0.06, "$height + 0.03", { at: ["$width * 0.3", 0, "-$depth / 2 + 0.12"], anchor: "base", segments: 16, mirror: "Post_R" }),
          cyl("Base_L", 0.12, 0.03, { at: ["$width * 0.3", 0, "-$depth / 2 + 0.12"], anchor: "base", segments: 16, mirror: "Base_R" }),
          ...grimeProfile("Grime_L", [[0.06, 0.031], [0.06, 0.12], [0.06, 0.3]], { at: ["$width * 0.3", 0, "-$depth / 2 + 0.12"], segments: 16 }),
          ...grimeProfile("Grime_R", [[0.06, 0.031], [0.06, 0.12], [0.06, 0.3]], { at: ["-$width * 0.3", 0, "-$depth / 2 + 0.12"], segments: 16 }),
          box("Screen", ["$width * 0.6 - 0.1", "$height - 0.7", 0.012], { at: [0, 0.35, "-$depth / 2 + 0.12"], anchor: "bottom", material: "galvanised" }),
          box("ScreenFrame", ["$width * 0.6", 0.05, 0.04], { at: [0, "$height - 0.33", "-$depth / 2 + 0.12"], bevel: 0.005 }),
        ]),
        group("Roof", [
          box("Canopy", ["$width", 0.06, "$depth + 0.2"], { at: [0, "$height + 0.06", 0], rotate: [-6, 0, 0], bevel: 0.015, material: f.accent }),
          cyl("Gutter", 0.04, "$width", { axis: "x", at: [0, "$height + 0.06 + ($depth / 2 + 0.1) * 0.105", "$depth / 2 + 0.1"], segments: 14 }),
        ]),
        group("Bench", [
          boardX("Perch", ["$width * 0.6 - 0.1", 0.05, 0.14], { at: [0, 0.75, 0.07], bevel: 0.015, material: "teak" }),
          box("Bracket_L", [0.03, 0.05, 0.12], { at: ["$width * 0.2", 0.72, 0.05], bevel: 0.004, mirror: "Bracket_R" }),
        ], { at: [0, 0, "-$depth / 2 + 0.12"] }),
        sign(),
      ];
  }
}

function params(style: Style) {
  const base = [num("width", 3.6, 2.4, 5, "Width of the shelter along x in metres."), num("depth", 1.5, 1.2, 1.8, "Depth along z in metres."), num("height", 2.5, 2.3, 2.8, "Clear height under the roof in metres.")];
  return style === "glass" || style === "cantilever" ? [...base, int("bays", 3, 2, 4, "Number of glazed bays in the back wall.")] : base;
}

function makeStop(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const fr = nice(f.frame), ac = nice(f.accent);
  return {
    slug: slugify("bus-stop", style, f.frame.replace(/^paint_/, ""), f.accent.replace(/^paint_/, "")),
    title: up(`${fr} ${s.title} with ${ac} ${style === "wooden" ? "roof" : "trim"}`),
    description: `A ${fr} ${s.title}: ${s.text}, with a bus stop sign and timetable on a mast to its right. The open boarding side faces +z.`,
    tags: [style, fr, ac, "bushalte", "abri", "wachthuisje", "shelter", "halte"],
    params: params(style),
    materials: { ...useMats(f.frame, f.accent, "galvanised", "paint_yellow", "paint_black", "paint_white", "glass_clear", "glass_frosted", "bulb_cool", "light_oak", "teak", "concrete"), ...GRIME(f.frame), ...(f.accent === "terracotta" ? { terracotta: { ...LOCAL["terracotta"]!, color: [0.25, 0.075, 0.035] as [number, number, number], texture: "roof_tile" } } : {}) },
    nodes: [group("BusStop", [...nodes(style, f), box("Platform", ["$width + 1.2", 0.03, "$depth + 0.5"], { at: [0.3, 0, 0.05], anchor: "bottom", bevel: 0.01, material: "concrete" })], { material: f.frame })],
  };
}

export const busStop: Family = {
  id: "bus-stop",
  category: "street",
  archetype: "infrastructure.bus-stop",
  tags: ["bus stop", "bus shelter", "shelter", "bushalte", "abri", "wachthuisje", "halte", "street furniture"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f) => makeStop(style, f))),
};
