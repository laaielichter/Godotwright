import { box, cyl, group, int, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { nice, up, useMats } from "./common.js";

type Style = "victorian" | "concrete" | "modern" | "rustic" | "tubular";

const STYLES: Record<Style, { text: string; finishes: { wood: string; metal: string }[] }> = {
  victorian: {
    text: "curved cast iron side frames with scrolled armrests, a slatted seat and a raked three-board back",
    finishes: [
      { wood: "teak", metal: "cast_iron" },
      { wood: "oak", metal: "paint_forest" },
      { wood: "paint_green", metal: "paint_black" },
      { wood: "weathered_wood", metal: "bronze" },
    ],
  },
  concrete: {
    text: "three chamfered concrete blocks carrying a backless seat of hardwood boards on steel bearers",
    finishes: [
      { wood: "light_oak", metal: "concrete" },
      { wood: "teak", metal: "concrete_dark" },
      { wood: "pine", metal: "granite" },
      { wood: "walnut", metal: "limestone" },
    ],
  },
  modern: {
    text: "flat-bar steel frames with foot plates, raked back posts, flat armrests, a slatted seat and a two-board back",
    finishes: [
      { wood: "light_oak", metal: "brushed_steel" },
      { wood: "teak", metal: "paint_anthracite" },
      { wood: "bamboo", metal: "galvanised" },
      { wood: "dark_stain", metal: "black_steel" },
    ],
  },
  rustic: {
    text: "a thick pegged plank seat on two sawn log stumps, backless",
    finishes: [
      { wood: "rough_timber", metal: "bark_brown" },
      { wood: "weathered_wood", metal: "bark_grey" },
      { wood: "oak", metal: "bark_dark" },
      { wood: "pine", metal: "bark_red" },
    ],
  },
  tubular: {
    text: "three bent round-tube frames with a front stretcher, rubber glides, a slatted seat and a three-board back",
    finishes: [
      { wood: "pine", metal: "paint_green" },
      { wood: "oak", metal: "paint_blue" },
      { wood: "plastic_grey", metal: "galvanised" },
      { wood: "teak", metal: "chrome" },
    ],
  },
};

const DEPTH = 0.44;

/** The seat boards, front to back, with bolt heads over the supports. */
function slatSeat(boltX: string): SpecNode {
  return group("Seat", [
    box("Board_{i}", ["$length", 0.035, "$bw"], { at: [0, 0, `${DEPTH / 2} - $bw / 2`], anchor: "bottom", bevel: 0.006, repeat: { count: "$boards", step: [0, 0, "-($bw + 0.012)"] } }),
    group("Fix_{i}", [cyl("Bolt_L", 0.008, 0.008, { at: [boltX, 0.035, 0], segments: 8, material: "steel", mirror: "Bolt_R" })], {
      at: [0, 0, `${DEPTH / 2} - $bw / 2`],
      repeat: { count: "$boards", step: [0, 0, "-($bw + 0.012)"] },
    }),
  ], { at: [0, "$seatHeight - 0.035", 0], vars: { bw: `(${DEPTH} - ($boards - 1) * 0.012) / $boards` } });
}

/** Back boards in a group whose y axis follows the back posts. */
const backBoards = (count: number, from: string, z: number): SpecNode[] => [
  box("Board_{i}", ["$length", "$bh", 0.024], { at: [0, `${from} + $bh / 2`, z], bevel: 0.006, repeat: { count, step: [0, "$bh + 0.02", 0] } }),
];

function nodes(style: Style, metal: string): SpecNode[] {
  switch (style) {
    case "victorian": {
      const side = (name: string, mirror?: string): SpecNode =>
        group(name, [
          tube("Frame", [[0, 0.02, 0.24], [0, "$seatHeight * 0.45", 0.23], [0, "$seatHeight - 0.05", 0.2], [0, "$seatHeight - 0.045", 0.1], [0, "$seatHeight - 0.045", -0.15], [0, "$seatHeight - 0.06", -0.2], [0, "$seatHeight * 0.45", -0.25], [0, 0.02, -0.28]], 0.022, { segments: 10 }),
          tube("Upright", [[0, "$seatHeight - 0.06", -0.2], [0, "$seatHeight + 0.15", -0.25], [0, "$seatHeight + $backHeight", -0.3]], 0.02, { segments: 10 }),
          cyl("Stretcher", 0.014, 0.5, { axis: "z", at: [0, 0.14, -0.02], segments: 10 }),
          cyl("Rosette", 0.055, 0.03, { axis: "x", at: [0, "$seatHeight * 0.5", -0.01], bevel: 0.01, segments: 16 }),
          tube("Scroll", [[0, "$seatHeight * 0.5 + 0.04", 0.03], [0, "$seatHeight * 0.5 + 0.1", 0.1], [0, "$seatHeight - 0.05", 0.04], [0, "$seatHeight - 0.05", -0.06], [0, "$seatHeight * 0.5 + 0.1", -0.13], [0, "$seatHeight * 0.5 + 0.04", -0.05]], 0.012, { segments: 8 }),
          box("Paw_F", [0.06, 0.03, 0.08], { at: [0, 0, 0.25], anchor: "bottom", bevel: 0.01 }),
          box("Paw_B", [0.06, 0.03, 0.08], { at: [0, 0, -0.29], anchor: "bottom", bevel: 0.01 }),
        ], { at: ["$sx", 0, 0], ...(mirror ? { mirror } : {}) });
      return [
        side("Support_L", "Support_R"),
        group("Arm_L", [
          tube("Rest", [[0, "$seatHeight + 0.2", -0.25], [0, "$seatHeight + 0.23", -0.05], [0, "$seatHeight + 0.21", 0.17], [0, "$seatHeight + 0.12", 0.25], [0, "$seatHeight - 0.05", 0.21]], 0.02, { segments: 10 }),
          cyl("Knob", 0.03, 0.05, { axis: "x", at: [0, "$seatHeight + 0.17", 0.23], bevel: 0.01, segments: 12 }),
        ], { at: ["$sx", 0, 0], mirror: "Arm_R" }),
        slatSeat("$sx"),
        group("Back", backBoards(3, "0.09", 0.03), {
          at: [0, "$seatHeight - 0.06", -0.2],
          rotate: ["-deg(atan(0.1 / ($backHeight + 0.06)))", 0, 0],
          vars: { bh: "($backHeight - 0.14) / 3 - 0.0134" },
          material: undefined,
        }),
      ];
    }
    case "concrete":
      return [
        box("Support_L", [0.16, "$seatHeight - 0.047", 0.5], { at: ["$sx", 0, 0], anchor: "bottom", bevel: 0.015, material: metal, mirror: "Support_R" }),
        box("Support_M", [0.16, "$seatHeight - 0.047", 0.5], { at: [0, 0, 0], anchor: "bottom", bevel: 0.015, material: metal }),
        group("Bearers", [
          box("SeatBearer_L", [0.08, 0.014, 0.46], { at: ["$sx", "$seatHeight - 0.048", 0], anchor: "bottom", bevel: 0.002, mirror: "SeatBearer_R" }),
          box("SeatBearer_M", [0.08, 0.014, 0.46], { at: [0, "$seatHeight - 0.048", 0], anchor: "bottom", bevel: 0.002 }),
        ], { material: "galvanised" }),
        slatSeat("$sx"),
      ];
    case "modern": {
      const frame = (name: string, arm: boolean, mirror?: string, x: string | number = "$sx"): SpecNode =>
        group(name, [
          box("FrontPost", [0.02, "$seatHeight - 0.045", 0.06], { at: [0, 0, 0.17], anchor: "bottom", bevel: 0.003 }),
          box("RearPost", [0.02, "$seatHeight + $backHeight", 0.06], { at: [0, 0, -0.1], anchor: "bottom", rotate: [-12, 0, 0], bevel: 0.003 }),
          box("Bearer", [0.02, 0.05, 0.45], { at: [0, "$seatHeight - 0.06", -0.005], bevel: 0.003 }),
          box("FootPlate_F", [0.08, 0.01, 0.12], { at: [0, 0, 0.17], anchor: "bottom", bevel: 0.002 }),
          box("FootPlate_B", [0.08, 0.01, 0.12], { at: [0, 0, -0.1], anchor: "bottom", bevel: 0.002 }),

        ], { at: [x, 0, 0], ...(mirror ? { mirror } : {}) });
      return [
        frame("Support_L", true, "Support_R"),
        frame("Support_M", false, undefined, 0),
        group("Arm_L", [
          box("Stem", [0.02, 0.27, 0.04], { at: [0, "$seatHeight - 0.06", 0.15], anchor: "bottom", bevel: 0.003 }),
          box("Pad", [0.06, 0.03, 0.46], { at: [0, "$seatHeight + 0.215", -0.02], bevel: 0.008 }),
        ], { at: ["$sx", 0, 0], mirror: "Arm_R" }),
        slatSeat("$sx"),
        group("Back", backBoards(2, "$seatHeight + 0.06", 0.034), { at: [0, 0, -0.1], rotate: [-12, 0, 0], vars: { bh: "($backHeight - 0.08) / 2" } }),
      ];
    }
    case "rustic":
      return [
        group("Seat", [
          box("Plank", ["$length", "$thick", 0.38], { at: [0, "$seatHeight - $thick", 0], anchor: "bottom", bevel: 0.02 }),
          cyl("Peg_L", 0.018, 0.012, { at: ["$sx", "$seatHeight", 0.08], segments: 10, material: "dark_stain", mirror: "Peg_R" }),
          cyl("Peg_L2", 0.018, 0.012, { at: ["$sx", "$seatHeight", -0.08], segments: 10, material: "dark_stain", mirror: "Peg_R2" }),
        ]),
        group("Support_L", [
          cyl("Stump", "$stump", "$seatHeight - $thick + 0.005", { anchor: "base", segments: 18, bevel: 0.01, material: metal }),
          cyl("Root", "$stump + 0.025", 0.06, { anchor: "base", segments: 18, bevel: 0.02, material: metal }),
        ], { at: ["$sx", 0, 0], mirror: "Support_R" }),
      ];
    case "tubular": {
      const u = (name: string, x: string | number, mirror?: string): SpecNode =>
        group(name, [
          tube("Hoop", [[0, 0.02, 0.2], [0, "$seatHeight - 0.09", 0.2], [0, "$seatHeight - 0.055", 0.17], [0, "$seatHeight - 0.055", -0.15], [0, "$seatHeight - 0.09", -0.2], [0, 0.02, -0.2]], 0.02, { segments: 12 }),
          tube("BackBar", [[0, "$seatHeight - 0.07", -0.19], [0, "$seatHeight + $backHeight", -0.29]], 0.018, { segments: 12 }),
          cyl("Glide_F", 0.024, 0.02, { at: [0, 0, 0.2], anchor: "base", segments: 12, material: "rubber" }),
          cyl("Glide_B", 0.024, 0.02, { at: [0, 0, -0.2], anchor: "base", segments: 12, material: "rubber" }),
        ], { at: [x, 0, 0], ...(mirror ? { mirror } : {}) });
      return [
        u("Support_L", "$sx", "Support_R"),
        u("Support_M", 0),
        cyl("Stretcher", 0.016, "2 * $sx", { axis: "x", at: [0, 0.16, 0.2], segments: 12 }),
        slatSeat("$sx"),
        group("Back", backBoards(3, "0.06", 0.03), {
          at: [0, "$seatHeight - 0.07", -0.19],
          rotate: ["-deg(atan(0.1 / ($backHeight + 0.07)))", 0, 0],
          vars: { bh: "($backHeight - 0.1) / 3 - 0.0134" },
        }),
      ];
    }
  }
}

function bench(style: Style, f: { wood: string; metal: string }): AssetDraft {
  const s = STYLES[style];
  const rustic = style === "rustic";
  const params = [
    num("length", 1.8, 1.3, 2.3, "Seat length along x in metres."),
    num("seatHeight", 0.45, 0.4, 0.5, "Height of the seat top in metres."),
    ...(rustic
      ? [num("thick", 0.08, 0.06, 0.11, "Thickness of the plank seat in metres."), num("stump", 0.16, 0.12, 0.2, "Radius of the log stumps in metres.")]
      : [int("boards", 5, 4, 7, "Number of seat boards from front to back.")]),
    ...(style === "concrete" || rustic ? [] : [num("backHeight", 0.42, 0.32, 0.52, "Height of the back above the seat in metres.")]),
  ];
  const sx = style === "concrete" ? "$length / 2 - 0.22" : rustic ? "$length / 2 - 0.3" : "$length / 2 - 0.13";
  const woodName = nice(f.wood), metalName = nice(f.metal);
  const title: Record<Style, string> = {
    victorian: "Victorian park bench",
    concrete: "Concrete block bench",
    modern: "Modern steel park bench",
    rustic: "Rustic log bench",
    tubular: "Tubular steel park bench",
  };
  return {
    slug: slugify("park-bench", style, f.wood.replace(/^(paint|plastic)_/, ""), f.metal.replace(/^(paint|bark)_/, "")),
    title: `${title[style]}, ${woodName} and ${metalName}`,
    description: `A ${woodName} park bench with ${s.text}${rustic ? "" : `, in ${metalName}`}. The seat runs along x and the bench faces +z.`,
    tags: [style, woodName, metalName, ...(style === "concrete" || rustic ? ["backless", "zonder rugleuning"] : ["backrest", "rugleuning"]), "parkbank", "zitbank"],
    params,
    materials: useMats(f.wood, f.metal, "steel", "galvanised", "rubber", "dark_stain"),
    nodes: [group("ParkBench", nodes(style, f.metal), { material: rustic ? f.wood : f.metal, vars: { sx } })].map((g) => fixWood(g, f.wood, style)),
  };
}

/** Seat and back boards take the wood finish; frames keep the metal one. */
function fixWood(root: SpecNode, wood: string, style: Style): SpecNode {
  const children = (root["children"] as SpecNode[]).map((c) => (c["name"] === "Seat" || c["name"] === "Back" ? { ...c, material: wood } : c));
  return style === "rustic" ? root : { ...root, children };
}

export const parkBench: Family = {
  id: "park-bench",
  category: "street",
  archetype: "prop.bench",
  tags: ["bench", "park bench", "street furniture", "bank", "parkbank", "bankje", "straatmeubilair", "seat"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f) => bench(style, f))),
};
