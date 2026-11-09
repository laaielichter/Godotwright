import { box, cyl, group, int, lathe, loft, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { GRIME, grimeBox, grimeRound, nice, up, useMats } from "./common.js";

type Style = "round" | "wheelie" | "recycling" | "park";

interface Finish {
  body: string;
  trim: string;
  /** recycling bins: what the mouth takes */
  stream?: "glass" | "paper" | "plastic" | "waste";
}

const STYLES: Record<Style, Finish[]> = {
  round: [
    { body: "galvanised", trim: "black_steel" },
    { body: "paint_green", trim: "galvanised" },
    { body: "paint_black", trim: "brass" },
    { body: "corten", trim: "black_steel" },
  ],
  wheelie: [
    { body: "plastic_grey", trim: "plastic_green" },
    { body: "plastic_black", trim: "plastic_black" },
    { body: "plastic_green", trim: "plastic_green" },
    { body: "plastic_blue", trim: "plastic_blue" },
  ],
  recycling: [
    { body: "paint_grey", trim: "paint_green", stream: "glass" },
    { body: "paint_grey", trim: "paint_blue", stream: "paper" },
    { body: "paint_anthracite", trim: "paint_yellow", stream: "plastic" },
    { body: "galvanised", trim: "paint_anthracite", stream: "waste" },
  ],
  park: [
    { body: "oak", trim: "cast_iron" },
    { body: "teak", trim: "black_steel" },
    { body: "weathered_wood", trim: "galvanised" },
    { body: "paint_green", trim: "cast_iron" },
  ],
};

/** A closed square-section hoop around y at radius r from y0, made as a lathe that returns to its start. */
const hoop = (name: string, r: string, y0: string | number, h: number, t: number): SpecNode =>
  lathe(name, [[`${r} - ${t}`, y0], [`${r} + ${t}`, y0], [`${r} + ${t}`, `${y0} + ${h}`], [`${r} - ${t}`, `${y0} + ${h}`], [`${r} - ${t}`, y0]], { segments: 24, caps: false });

function nodes(style: Style, f: Finish): SpecNode[] {
  switch (style) {
    case "round":
      return [
        lathe("Body", [[0.05, 0.03], ["$r - 0.01", 0.03], ["$r", 0.05], ["$r", "$height - 0.04"], ["$r + 0.015", "$height - 0.03"], ["$r + 0.015", "$height"], ["$r - 0.02", "$height"], ["$r - 0.025", "$height - 0.02"], ["$r - 0.025", "$height - 0.14"], [0.05, "$height - 0.14"]], { segments: 24 }),
        cyl("Opening", "$r - 0.026", 0.01, { at: [0, "$height - 0.14", 0], anchor: "base", segments: 24, material: "opening_dark" }),
        lathe("Plinth", [["$r - 0.02", 0], ["$r + 0.01", 0], ["$r + 0.01", 0.035], ["$r - 0.02", 0.04]], { segments: 24, material: f.trim }),
        box("Rib_{i}", [0.012, "$height - 0.14", 0.02], { at: ["$r", "($height - 0.14) / 2 + 0.05", 0], repeat: { count: "$ribs", around: "y", phase: "180 / $ribs" }, bevel: 0.004, material: f.trim }),
        box("Label", ["$r * 0.6", 0.08, 0.008], { at: [0, "$height * 0.62", "$r + 0.006"], bevel: 0.002, material: "paint_white" }),
        box("LabelText_{i}", ["$r * 0.4", 0.012, 0.003], { at: [0, "$height * 0.62 + 0.02", "$r + 0.0105"], repeat: { count: 3, step: [0, -0.02, 0] }, material: "paint_black" }),
        ...grimeRound("Grime", "$r + 0.012", "$r + 0.002", 0.16),
      ];
    case "wheelie": {
      const sec = (z: string, w: string, d: string, cy: string): Record<string, unknown> => ({ z, superellipse: { width: w, height: d, n: 5, count: 32, cy } });
      return [
        loft("Body", [
          sec("0.05", "$width * 0.86", "$depth * 0.8", "$depth * 0.1"),
          sec("0.12", "$width * 0.88", "$depth * 0.83", "$depth * 0.085"),
          sec("$height - 0.12", "$width", "$depth", "0"),
          sec("$height - 0.06", "$width", "$depth", "0"),
        ], { rotate: [-90, 0, 0] }),
        box("Opening", ["$width - 0.06", 0.012, "$depth - 0.06"], { at: [0, "$height - 0.065", 0], material: "opening_dark" }),
        box("Lip", ["$width + 0.02", 0.04, 0.04], { at: [0, "$height - 0.1", "$depth / 2 - 0.01"], bevel: 0.01 }),
        group("Lid", [
          box("Panel", ["$width + 0.03", 0.035, "$depth + 0.04"], { at: [0, 0.0175, "$depth / 2 + 0.02"], bevel: 0.012, material: f.trim }),
          box("Grip", ["$width * 0.5", 0.04, 0.03], { at: [0, 0, "$depth + 0.03"], bevel: 0.01, material: f.trim }),
        ], { at: [0, "$height - 0.065", "-$depth / 2 - 0.02"], rotate: ["-$lidOpen", 0, 0] }),
        cyl("Handle", 0.018, "$width * 0.8", { axis: "x", at: [0, "$height - 0.12", "-$depth / 2 - 0.05"], segments: 12 }),
        box("HandleArm_L", [0.03, 0.06, 0.07], { at: ["$width * 0.4 - 0.02", "$height - 0.12", "-$depth / 2 - 0.02"], bevel: 0.008, mirror: "HandleArm_R" }),
        cyl("Axle", 0.015, "$width + 0.06", { axis: "x", at: [0, 0.1, "-$depth / 2 + 0.01"], segments: 12, material: "steel" }),
        group("Wheel_L", [
          cyl("Tyre", 0.1, 0.05, { axis: "x", segments: 20, bevel: 0.012, material: "rubber" }),
          cyl("Hub", 0.05, 0.056, { axis: "x", segments: 16, material: "plastic_grey" }),
        ], { at: ["$width / 2 + 0.02", 0.1, "-$depth / 2 + 0.01"], mirror: "Wheel_R" }),
        box("Foot", ["$width * 0.6", 0.06, 0.05], { at: [0, 0, "$depth * 0.18"], anchor: "bottom", bevel: 0.01 }),
        box("Number", ["$width * 0.32", 0.07, 0.006], { at: [0, "$height * 0.62", "$depth * 0.47"], rotate: [-1.5, 0, 0], bevel: 0.002, material: "paint_white" }),
        // Road dirt on the lower body: three thin lofts that follow its taper, 3-7 mm proud.
        ...([["Grime_1", 0.34, "grime_light", 0.006], ["Grime_2", 0.25, "grime", 0.01], ["Grime_3", 0.15, "grime_heavy", 0.014]] as const).map(([n, top, material, d]) => {
          const k = `((${top} - 0.12) / ($height - 0.24))`;
          return loft(n, [
            sec("0.051", `$width * 0.86 + ${d}`, `$depth * 0.8 + ${d}`, "$depth * 0.1"),
            sec("0.12", `$width * 0.88 + ${d}`, `$depth * 0.83 + ${d}`, "$depth * 0.085"),
            sec(`${top}`, `$width * (0.88 + 0.12 * ${k}) + ${d}`, `$depth * (0.83 + 0.17 * ${k}) + ${d}`, `$depth * 0.085 * (1 - ${k})`),
          ], { rotate: [-90, 0, 0], material });
        }),
      ];
    }
    case "recycling": {
      const mouth: SpecNode[] = (() => {
        switch (f.stream) {
          case "glass":
            return [cyl("Opening", 0.08, 0.012, { at: [0, 0.064, 0.02], segments: 20, material: "opening_dark" }), lathe("Collar", [[0.08, 0.055], [0.11, 0.055], [0.1, 0.075], [0.08, 0.075], [0.08, 0.055]], { segments: 20, caps: false, material: "rubber" })];
          case "paper":
            return [box("Opening", ["$width * 0.6", 0.012, 0.05], { at: [0, 0.064, 0.02], material: "opening_dark" }), box("Collar", ["$width * 0.6 + 0.04", 0.012, 0.09], { at: [0, 0.058, 0.02], bevel: 0.004, material: "rubber" })];
          case "plastic":
            return [cyl("Opening", 0.12, 0.012, { at: [0, 0.064, 0.02], segments: 24, material: "opening_dark" }), lathe("Collar", [[0.12, 0.055], [0.15, 0.055], [0.14, 0.075], [0.12, 0.075], [0.12, 0.055]], { segments: 24, caps: false, material: "rubber" })];
          default:
            return [box("Opening", ["$width * 0.5", 0.012, "$depth * 0.4"], { at: [0, 0.064, 0.02], material: "opening_dark" }), box("Flap", ["$width * 0.5 + 0.03", 0.01, 0.04], { at: [0, 0.068, "$depth * 0.2 + 0.03"], bevel: 0.003, material: "galvanised" })];
        }
      })();
      return [
        box("Body", ["$width", "$height - 0.12", "$depth"], { at: [0, 0.05, 0], anchor: "bottom", bevel: 0.02 }),
        box("Plinth", ["$width - 0.04", 0.06, "$depth - 0.04"], { anchor: "bottom", bevel: 0.01, material: "rubber" }),
        box("Band", ["$width + 0.006", 0.12, "$depth + 0.006"], { at: [0, "$height * 0.55", 0], bevel: 0.01, material: f.trim }),
        box("Sticker", ["$width * 0.5", "$width * 0.5", 0.006], { at: [0, "$height * 0.35", "$depth / 2 + 0.002"], bevel: 0.002, material: "paint_white" }),
        box("Pictogram", ["$width * 0.3", "$width * 0.3", 0.004], { at: [0, "$height * 0.35", "$depth / 2 + 0.005"], rotate: [0, 0, 45], material: f.trim }),
        ...grimeBox("Grime", "$width", "$depth", 0.22, [0, 0, 0], 0.02),
        group("Lid", [
          box("Top", ["$width + 0.02", 0.06, "$depth + 0.02"], { at: [0, 0.03, "$depth / 2 + 0.01"], bevel: 0.02, material: f.trim }),
          group("Mouth", mouth, { at: [0, 0, "$depth / 2 + 0.01"] }),
        ], { at: [0, "$height - 0.075", "-$depth / 2 - 0.01"] }),
        cyl("Hinge_{i}", 0.012, 0.08, { axis: "x", at: ["-$width / 4", "$height - 0.075", "-$depth / 2 - 0.012"], repeat: { count: 2, step: ["$width / 2", 0, 0] }, segments: 10, material: "steel" }),
      ];
    }
    case "park":
      return [
        group("Body", [
          box("Stave_{i}", ["$r * 2 * pi / $staves - 0.012", "$height - 0.02", 0.028], { at: [0, 0.02, "$r"], anchor: "bottom", bevel: 0.005, repeat: { count: "$staves", around: "y" } }),
          hoop("Hoop_1", "$r + 0.015", 0.12, 0.04, 0.008),
          hoop("Hoop_2", "$r + 0.015", "$height - 0.16", 0.04, 0.008),
          cyl("Floor", "$r - 0.01", 0.03, { at: [0, 0.02, 0], anchor: "base", segments: 24, material: f.trim }),
        ]),
        lathe("Liner", [["$r - 0.03", 0.05], ["$r - 0.03", "$height + 0.01"], ["$r - 0.005", "$height + 0.01"], ["$r - 0.005", "$height + 0.03"], ["$r - 0.045", "$height + 0.03"], ["$r - 0.045", "$height - 0.12"], [0.05, "$height - 0.12"]], { segments: 24, material: "galvanised" }),
        cyl("Opening", "$r - 0.046", 0.01, { at: [0, "$height - 0.12", 0], anchor: "base", segments: 24, material: "opening_dark" }),
        cyl("Foot_{i}", 0.03, 0.02, { at: [0, 0, "$r * 0.7"], anchor: "base", segments: 12, repeat: { count: 3, around: "y", phase: 0 }, material: "rubber" }),
        ...grimeRound("Grime", "$r + 0.016", "$r + 0.016", 0.14, [0, 0.02, 0], 32),
      ];
  }
}

function params(style: Style) {
  switch (style) {
    case "round":
      return [num("height", 0.85, 0.6, 1.1, "Height of the bin in metres."), num("r", 0.24, 0.16, 0.32, "Radius of the drum in metres."), int("ribs", 12, 6, 20, "Number of vertical stiffening ribs.")];
    case "wheelie":
      return [num("height", 1.05, 0.9, 1.15, "Height to the top of the body in metres."), num("width", 0.58, 0.48, 0.7, "Width along x in metres."), num("depth", 0.72, 0.55, 0.78, "Depth along z in metres."), num("lidOpen", 0, 0, 100, "How far the lid is opened, in degrees.")];
    case "recycling":
      return [num("height", 1.05, 0.8, 1.25, "Height to the lid top in metres."), num("width", 0.55, 0.42, 0.7, "Width along x in metres."), num("depth", 0.5, 0.4, 0.65, "Depth along z in metres.")];
    case "park":
      return [num("height", 0.8, 0.6, 1.0, "Height of the stave enclosure in metres."), num("r", 0.25, 0.18, 0.32, "Radius of the enclosure in metres."), int("staves", 16, 12, 24, "Number of wooden staves around the bin.")];
  }
}

const TITLES: Record<Style, string> = { round: "round street bin", wheelie: "wheelie bin", recycling: "recycling bin", park: "slatted park bin" };
const TEXT: Record<Style, string> = {
  round: "a steel drum with vertical ribs, a rolled rim around a dark open mouth, a plinth ring and a label plate",
  wheelie: "a tapered moulded body, a hinged lid with a grip, a rear handle and two rubber wheels on an axle at the back",
  recycling: "a square cabinet with a coloured band and lid hinged at the back, a pictogram plate on the front and a mouth in the lid",
  park: "wooden staves around a galvanised liner held by two steel hoops, with a dark open top",
};

function makeBin(style: Style, f: Finish): AssetDraft {
  const b = nice(f.body), t = nice(f.trim);
  const what = f.stream ? `${f.stream} ` : "";
  return {
    slug: slugify("bin", style, f.stream ?? "", f.body.replace(/^(paint|plastic)_/, ""), f.trim.replace(/^(paint|plastic)_/, "")),
    title: up(`${b} ${what}${TITLES[style]}${f.trim !== f.body ? ` with ${t} trim` : ""}`),
    description: `A ${b} ${what}${TITLES[style]}: ${TEXT[style]}. It faces +z.`,
    tags: [style, b, t, ...(f.stream ? [f.stream, "recycling", "recycle", "afvalscheiding"] : []), ...(style === "wheelie" ? ["kliko", "container", "minicontainer"] : [])],
    params: params(style),
    materials: { ...useMats(f.body, f.trim, "opening_dark", "rubber", "steel", "galvanised", "plastic_grey", "paint_white", "paint_black"), ...GRIME(f.body) },
    nodes: [group("Bin", nodes(style, f), { material: f.body })],
  };
}

export const bin: Family = {
  id: "bin",
  category: "street",
  archetype: "prop.bin",
  tags: ["bin", "litter bin", "trash can", "waste bin", "rubbish bin", "garbage can", "prullenbak", "afvalbak", "vuilnisbak", "afvalcontainer"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].map((f) => makeBin(style, f))),
};
