import { box, cyl, group, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { GRIME, LOCAL, nice, up, useMats } from "./common.js";

type Style = "jersey" | "water" | "crowd" | "works";
interface Finish { main: string; second: string }

const STYLES: Record<Style, { title: string; text: string; finishes: Finish[] }> = {
  jersey: { title: "jersey barrier", text: "a precast concrete safety-shape block with chamfered ends, a drainage slot under it, steel connecting loops at the ends and reflectors on top", finishes: [{ main: "concrete", second: "reflector_amber" }, { main: "concrete_dark", second: "reflector_white" }] },
  water: { title: "water-filled barrier", text: "a hollow plastic safety-shape barrier with a filler cap, forklift slots and interlocking lugs at both ends", finishes: [{ main: "water_barrier_red", second: "water_barrier_white" }, { main: "water_barrier_white", second: "water_barrier_red" }] },
  crowd: { title: "crowd control barrier", text: "a steel tube frame with closely spaced vertical bars, standing on two flat feet, with a hook and eye at the ends", finishes: [{ main: "galvanised", second: "galvanised" }, { main: "paint_blue", second: "galvanised" }] },
  works: { title: "roadworks barrier", text: "two striped warning boards on a pair of A-frame trestles with rubber feet", finishes: [{ main: "paint_white", second: "paint_red" }, { main: "paint_yellow", second: "paint_black" }] },
};

/** The safety-shape profile across z (as loft points), ht tall and about 0.6 m wide at the foot. */
const jerseyProfile = (ht: string, k = 1): [string, string | number][] => [
  [`-0.3 * ${k}`, 0], [`0.3 * ${k}`, 0], [`0.3 * ${k}`, 0.075], [`0.2 * ${k}`, 0.33], [`0.09 * ${k}`, ht], [`-0.09 * ${k}`, ht], [`-0.2 * ${k}`, 0.33], [`-0.3 * ${k}`, 0.075],
];

function nodes(style: Style, f: Finish): SpecNode[] {
  switch (style) {
    case "jersey": {
      const sec = (z: string, k: number, ht: string) => ({ z, points: jerseyProfile(ht, k) });
      /** The safety shape up to y = top (above the 0.075 kerb, below 0.33), pushed out by d. */
      const gsec = (z: string, k: number, d: number, top: number) => {
        const x = (0.3 - 0.1 * (top - 0.075) / 0.255) * k + d;
        return { z, points: [[-0.3 * k - d, 0.001], [0.3 * k + d, 0.001], [0.3 * k + d, 0.075], [x, top], [-x, top], [-0.3 * k - d, 0.075]] };
      };
      return [
        loft("Body", [sec("-$width / 2", 0.95, "$height - 0.02"), sec("-$width / 2 + 0.03", 1, "$height"), sec("$width / 2 - 0.03", 1, "$height"), sec("$width / 2", 0.95, "$height - 0.02")], { rotate: [0, 90, 0] }),
        box("Slot", [0.4, 0.06, 0.64], { at: [0, 0.035, 0], bevel: 0.01, material: "opening_dark" }),
        group("Loop_L", [tube("Bar", [[0, "$height - 0.25", 0.05], [0.06, "$height - 0.25", 0.05], [0.06, "$height - 0.25", -0.05], [0, "$height - 0.25", -0.05]], 0.012, { segments: 8 })], { at: ["$width / 2 - 0.01", 0, 0], material: "rust", mirror: "Loop_R" }),
        box("Reflector_{i}", [0.08, 0.02, 0.06], { at: ["-$width / 2 + 0.4", "$height", 0], repeat: { count: 2, step: ["$width - 0.8", 0, 0] }, bevel: 0.005, material: f.second }),
        // Road spray and tyre scuffs along the foot: three opaque films that follow the safety shape.
        loft("Grime_0", [gsec("-$width / 2 - 0.001", 0.95, 0.0015, 0.31), gsec("-$width / 2 + 0.03", 1, 0.0015, 0.31), gsec("$width / 2 - 0.03", 1, 0.0015, 0.31), gsec("$width / 2 + 0.001", 0.95, 0.0015, 0.31)], { rotate: [0, 90, 0], material: "grime_light" }),
        loft("Grime_1", [gsec("-$width / 2 - 0.002", 0.95, 0.003, 0.26), gsec("-$width / 2 + 0.03", 1, 0.003, 0.26), gsec("$width / 2 - 0.03", 1, 0.003, 0.26), gsec("$width / 2 + 0.002", 0.95, 0.003, 0.26)], { rotate: [0, 90, 0], material: "grime" }),
        loft("Grime_2", [gsec("-$width / 2 - 0.003", 0.95, 0.0045, 0.14), gsec("-$width / 2 + 0.03", 1, 0.0045, 0.14), gsec("$width / 2 - 0.03", 1, 0.0045, 0.14), gsec("$width / 2 + 0.003", 0.95, 0.0045, 0.14)], { rotate: [0, 90, 0], material: "grime_heavy" }),
      ];
    }
    case "water": {
      const prof: [string | number, string | number][] = [[-0.26, 0], [0.26, 0], [0.26, 0.1], [0.15, 0.26], [0.12, "$height - 0.06"], [0.07, "$height"], [-0.07, "$height"], [-0.12, "$height - 0.06"], [-0.15, 0.26], [-0.26, 0.1]];
      /** The foot of the profile up to y = top, pushed out by d. */
      const gprof = (d: number, top: number): [number, number][] => {
        if (top <= 0.1) return [[-0.26 - d, 0.001], [0.26 + d, 0.001], [0.26 + d, top], [-0.26 - d, top]];
        const x = 0.26 - 0.11 * (top - 0.1) / 0.16 + d;
        return [[-0.26 - d, 0.001], [0.26 + d, 0.001], [0.26 + d, 0.1], [x, top], [-x, top], [-0.26 - d, 0.1]];
      };
      return [
        loft("Body", [{ z: "-$width / 2", points: prof }, { z: "$width / 2", points: prof }], { rotate: [0, 90, 0] }),
        cyl("FillCap", 0.06, 0.03, { at: [0, "$height", 0], segments: 18, bevel: 0.008, material: f.second }),
        box("ForkSlot_{i}", [0.25, 0.07, 0.53], { at: ["-$width / 4", 0.05, 0], repeat: { count: 2, step: ["$width / 2", 0, 0] }, bevel: 0.01, material: "opening_dark" }),
        cyl("Lug_L", 0.05, 0.16, { at: ["$width / 2 + 0.02", "$height * 0.75", 0], segments: 16, bevel: 0.01, material: f.second, mirror: "Lug_R" }),
        cyl("LugLow_L", 0.05, 0.16, { at: ["$width / 2 + 0.02", 0.18, 0], segments: 16, bevel: 0.01, material: f.second, mirror: "LugLow_R" }),
        loft("Grime_0", [{ z: "-$width / 2 - 0.002", points: gprof(0.0015, 0.26) }, { z: "$width / 2 + 0.002", points: gprof(0.0015, 0.26) }], { rotate: [0, 90, 0], material: "grime_light" }),
        loft("Grime_1", [{ z: "-$width / 2 - 0.003", points: gprof(0.003, 0.22) }, { z: "$width / 2 + 0.003", points: gprof(0.003, 0.22) }], { rotate: [0, 90, 0], material: "grime" }),
        loft("Grime_2", [{ z: "-$width / 2 - 0.004", points: gprof(0.0045, 0.09) }, { z: "$width / 2 + 0.004", points: gprof(0.0045, 0.09) }], { rotate: [0, 90, 0], material: "grime_heavy" }),
      ];
    }
    case "crowd":
      return [
        group("Frame", [
          tube("Rail", [["-$width / 2", 0.12, 0], ["-$width / 2", "$height - 0.04", 0], ["-$width / 2 + 0.04", "$height", 0], ["$width / 2 - 0.04", "$height", 0], ["$width / 2", "$height - 0.04", 0], ["$width / 2", 0.12, 0]], 0.02, { segments: 12 }),
          cyl("BottomRail", 0.016, "$width", { axis: "x", at: [0, 0.2, 0], segments: 12 }),
          cyl("Bar_{i}", 0.009, "$height - 0.2", { at: ["-$width / 2 + 0.11", 0.2, 0], anchor: "base", segments: 8, repeat: { count: "floor(($width - 0.22) / 0.11) + 1", step: ["($width - 0.22) / floor(($width - 0.22) / 0.11)", 0, 0] } }),
          cyl("Hook_L", 0.02, 0.1, { axis: "x", at: ["$width / 2 + 0.05", "$height * 0.7", 0], segments: 10, mirror: "Hook_R" }),
        ]),
        box("Foot_L", [0.05, 0.02, 0.7], { at: ["$width / 2 - 0.15", 0, 0], anchor: "bottom", bevel: 0.005, material: f.second, mirror: "Foot_R" }),
        tube("Strut_L", [["$width / 2 - 0.15", 0.02, 0], ["$width / 2 - 0.15", 0.13, 0], ["$width / 2 - 0.02", 0.13, 0]], 0.015, { segments: 8, material: f.second, mirror: "Strut_R" }),
      ];
    case "works": {
      const board = (name: string, y: string): SpecNode =>
        group(name, [
          box("Plank", ["$width", 0.2, 0.025], { at: [0, 0, 0.04], bevel: 0.005 }),
          box("Stripe_{i}", [0.2, 0.2, 0.004], { at: ["-(floor($width / 0.5) - 1) * 0.25", 0, 0.054], rotate: [0, 0, 0], repeat: { count: "floor($width / 0.5)", step: [0.5, 0, 0] }, material: f.second }),
        ], { at: [0, y, 0] });
      return [
        group("Body", [board("Board_Top", "$height - 0.1"), board("Board_Low", "$height * 0.45")]),
        group("Foot_L", [
          tube("Trestle", [[0, 0.05, -0.35], [0, "$height + 0.02", 0], [0, 0.05, 0.35]], 0.02, { segments: 10, material: "galvanised" }),
          box("Pad_F", [0.08, 0.05, 0.12], { at: [0, 0, 0.35], anchor: "bottom", bevel: 0.01, material: "rubber" }),
          box("Pad_B", [0.08, 0.05, 0.12], { at: [0, 0, -0.35], anchor: "bottom", bevel: 0.01, material: "rubber" }),
          cyl("Brace", 0.012, 0.5, { axis: "z", at: [0, 0.3, 0], segments: 8, material: "galvanised" }),
        ], { at: ["$width / 2 - 0.2", 0, 0], mirror: "Foot_R" }),
      ];
    }
  }
}

function params(style: Style) {
  switch (style) {
    case "jersey":
      return [num("width", 3, 2, 4, "Length of the block along x in metres."), num("height", 0.81, 0.6, 1.07, "Height of the block in metres.")];
    case "water":
      return [num("width", 1.8, 1, 2, "Length of the barrier along x in metres."), num("height", 0.8, 0.6, 1.0, "Height of the barrier in metres.")];
    case "crowd":
      return [num("width", 2.2, 1.5, 2.5, "Length of the barrier along x in metres."), num("height", 1.1, 1.0, 1.25, "Height of the barrier in metres.")];
    case "works":
      return [num("width", 2.5, 1.5, 3.5, "Length of the boards along x in metres."), num("height", 1.0, 0.8, 1.2, "Height of the top board in metres.")];
  }
}

function makeBarrier(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const a = nice(f.main), b = nice(f.second);
  return {
    slug: slugify("road-barrier", style, f.main.replace(/^(paint|water_barrier)_/, ""), style === "crowd" && f.main === f.second ? "" : f.second.replace(/^(paint|water_barrier|reflector)_/, "")),
    title: up(`${a} ${s.title}${style === "works" ? ` with ${b} stripes` : ""}`),
    description: `A ${a} ${s.title}: ${s.text}. It runs along x and faces +z.`,
    tags: [style, a, b, "wegafzetting", "afzethek", "barrier", "hek", ...(style === "jersey" ? ["new jersey", "betonblok", "geleideblok"] : []), ...(style === "crowd" ? ["dranghek", "nadar"] : []), ...(style === "water" ? ["waterbarrier"] : [])],
    params: params(style),
    materials: {
      ...useMats(f.main, f.second, "opening_dark", "rust", "galvanised", "rubber"),
      // Roadworks boards carry retroreflective sheeting, not paint.
      ...(style === "works" ? { [f.main]: LOCAL[f.main.replace("paint_", "sheet_")]!, [f.second]: LOCAL[f.second.replace("paint_", "sheet_")]! } : {}),
      ...(style === "jersey" || style === "water" ? GRIME(f.main) : {}),
    },
    nodes: [group("RoadBarrier", nodes(style, f), { material: f.main })],
  };
}

export const roadBarrier: Family = {
  id: "road-barrier",
  category: "street",
  archetype: "infrastructure.road-barrier",
  tags: ["road barrier", "barrier", "barricade", "wegafzetting", "afzetting", "hek", "roadworks", "wegwerkzaamheden"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f) => makeBarrier(style, f))),
};
