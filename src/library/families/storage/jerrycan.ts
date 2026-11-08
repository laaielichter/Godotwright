import { box, cap, cyl, extrude, group, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, useMats } from "./common.js";

type Finish = { main: string; trim: string };
interface Style {
  name: string;
  title: string;
  text: string;
  tags: string[];
  params: ParamDef[];
  finishes: Finish[];
  build: (f: Finish) => SpecNode[];
}

/** The pressed X and border of a steel jerrycan on the face at z = s * $D / 2. */
function emboss(tag: string, s: 1 | -1): SpecNode {
  const z = `${s} * ($D / 2 + 0.002)`;
  return group(`Emboss_${tag}`, [
    box("Cross_A", ["hypot($W * 0.7, $bh * 0.7)", 0.03, 0.008], { at: [0, "$bh / 2", z], rotate: [0, 0, "deg(atan2($bh * 0.7, $W * 0.7))"], bevel: 0.003 }),
    box("Cross_B", ["hypot($W * 0.7, $bh * 0.7)", 0.03, 0.008], { at: [0, "$bh / 2", z], rotate: [0, 0, "-deg(atan2($bh * 0.7, $W * 0.7))"], bevel: 0.003 }),
    box("Border_T", ["$W * 0.86", 0.02, 0.008], { at: [0, "$bh * 0.93", z], bevel: 0.003 }),
    box("Border_B", ["$W * 0.86", 0.02, 0.008], { at: [0, "$bh * 0.07", z], bevel: 0.003 }),
    box("Border_L", [0.02, "$bh * 0.86", 0.008], { at: ["$W * 0.42", "$bh / 2", z], bevel: 0.003 }),
    box("Border_R", [0.02, "$bh * 0.86", 0.008], { at: ["-$W * 0.42", "$bh / 2", z], bevel: 0.003 }),
  ]);
}

/** A pressed-steel jerrycan: an X embossing on both faces, a weld seam, three handles on top and a cam-lever spout cap. */
function nato(f: Finish): SpecNode[] {
  return [
    group("Jerrycan", [
      group("Body", [
        box("Shell", ["$W", "$bh", "$D"], { at: [0, "$bh / 2", 0], bevel: 0.02 }),
        box("Seam", ["$W + 0.008", "$bh + 0.006", 0.012], { at: [0, "$bh / 2", 0], bevel: 0.004 }),
        emboss("F", 1),
        emboss("B", -1),
      ]),
      tube("Handle_{i}", [[0, "$bh - 0.01", -0.055], [0, "$bh + 0.035", -0.045], [0, "$bh + 0.035", 0.045], [0, "$bh - 0.01", 0.055]], 0.01, { at: ["-$W / 2 + 0.06", 0, 0], repeat: { count: 3, step: [0.045, 0, 0] }, segments: 8, material: f.main }),
      group("Spout", [
        cyl("Neck", 0.026, 0.03, { anchor: "base", segments: 16 }),
        cyl("Cap", 0.032, 0.022, { anchor: "base", at: [0, 0.025, 0], segments: 16, bevel: 0.004 }),
        box("Lever", [0.016, 0.02, 0.08], { at: [0.035, 0.035, -0.01], rotate: [12, 0, 0], bevel: 0.004 }),
        cyl("Pin", 0.006, 0.08, { axis: "x", at: [0, 0.035, -0.03], segments: 8, material: f.trim }),
      ], { at: ["$W / 2 - 0.065", "$bh - 0.012", 0] }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", bh: "$height - 0.035" } }),
  ];
}

/** A plastic fuel can: a shouldered slab body with ribs, a carry loop over the top and a flexible spout. */
function fuelCan(f: Finish): SpecNode[] {
  return [
    group("FuelJerry", [
      group("Body", [
        extrude("Shell", [["-$W / 2", 0], ["$W / 2", 0], ["$W / 2", "$top * 0.84"], ["$W * 0.3", "$top"], ["-$W * 0.38", "$top"], ["-$W / 2", "$top * 0.9"]], "-$D / 2", "$D / 2", { rotate: [-90, 0, 0] }),
        box("Rib_{i}", ["$W - 0.03", 0.012, "$D + 0.008"], { at: [0, "$top * 0.2", 0], repeat: { count: 3, step: [0, "$top * 0.2", 0] }, bevel: 0.004 }),
        box("Foot", ["$W - 0.02", 0.012, "$D - 0.02"], { at: [0, 0.006, 0], material: f.trim }),
      ]),
      group("Handle", [
        tube("Loop", [["-$W * 0.32", "$top - 0.01", 0], ["-$W * 0.3", "$H - 0.015", 0], ["-$W * 0.2", "$H - 0.012", 0], ["$W * 0.12", "$H - 0.012", 0], ["$W * 0.2", "$top - 0.01", 0]], 0.014, { segments: 10 }),
      ]),
      group("Spout", [
        cyl("Collar", 0.03, 0.025, { anchor: "base", at: [0, -0.005, 0], segments: 16, material: f.trim, bevel: 0.004 }),
        tube("Hose", [[0, 0.015, 0], [0.01, 0.06, 0.005], [0.04, 0.1, 0.01], [0.08, 0.12, 0.012]], 0.012, { segments: 10, material: "plastic_black" }),
        cyl("Tip", 0.014, 0.02, { axis: "x", at: [0.088, 0.12, 0.012], segments: 10, material: f.trim }),
      ], { at: ["$W * 0.36", "$top * 0.92", 0] }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", H: "$height", top: "$height * 0.8" } }),
  ];
}

/** A water canister: a low wide rounded body with a folding top handle, a vent cap and a tap at the front base. */
function waterCan(f: Finish): SpecNode[] {
  return [
    group("WaterJerry", [
      group("Body", [
        box("Shell", ["$W", "$bh", "$D"], { at: [0, "$bh / 2", 0], bevel: 0.035 }),
        box("Hollow_L", [0.012, 0.05, "$D * 0.5"], { at: ["$W / 2", "$bh * 0.7", 0], material: "hole", mirror: "Hollow_R" }),
        cyl("Vent", 0.018, 0.02, { at: ["-$W * 0.32", "$bh", "$D * 0.2"], segments: 12, material: f.trim }),
        box("Recess", ["$W * 0.5", "$bh * 0.4", 0.006], { at: [0, "$bh * 0.55", "$D / 2"], material: f.trim, bevel: 0.002 }),
      ]),
      group("Handle", [
        box("Hinge_L", [0.03, 0.02, 0.04], { at: ["$W * 0.3", 0.005, 0], bevel: 0.005, mirror: "Hinge_R" }),
        tube("Bail", [["$W * 0.3", 0.01, 0], ["$W * 0.3", 0.04, 0], ["$W * 0.25", "$H - $bh - 0.012", 0], ["-$W * 0.25", "$H - $bh - 0.012", 0], ["-$W * 0.3", 0.04, 0], ["-$W * 0.3", 0.01, 0]], 0.011, { segments: 10 }),
      ], { at: [0, "$bh", 0], material: f.trim }),
      group("Spout", [
        cyl("Boss", 0.03, 0.03, { axis: "z", at: [0, 0, 0.01], segments: 16, material: f.main }),
        box("Tap", [0.04, 0.06, 0.04], { at: [0, -0.01, 0.04], bevel: 0.008 }),
        box("Lever", [0.016, 0.03, 0.05], { at: [0, 0.03, 0.04], bevel: 0.005 }),
      ], { at: [0, "$bh * 0.18", "$D / 2 - 0.004"], material: f.trim }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", H: "$height", bh: "$height - 0.08" } }),
  ];
}

const STYLES: Style[] = [
  {
    name: "steel", title: "steel jerrycan", text: "a 20 litre pressed-steel jerrycan with an X embossed on both faces, a weld seam round its middle, three handles on top and a cam-lever spout cap", tags: ["jerry can", "jerrycan", "fuel", "brandstof", "benzine", "nato", "military"], build: nato,
    params: [num("width", 0.35, 0.28, 0.4, "Width along x in metres."), num("depth", 0.165, 0.12, 0.2, "Thickness along z in metres."), num("height", 0.47, 0.38, 0.52, "Height to the top of the handles in metres.")],
    finishes: [{ main: "paint_olive", trim: "steel" }, { main: "paint_red", trim: "steel" }, { main: "paint_sand", trim: "steel" }],
  },
  {
    name: "fuel", title: "plastic fuel can", text: "a plastic fuel can with a shouldered body, moulded ribs, a carry loop over the top and a flexible pour spout", tags: ["fuel can", "benzinekan", "petrol", "diesel", "plastic can"], build: fuelCan,
    params: [num("width", 0.32, 0.24, 0.4, "Width along x in metres."), num("depth", 0.17, 0.12, 0.22, "Thickness along z in metres."), num("height", 0.4, 0.3, 0.5, "Height to the top of the handle in metres.")],
    finishes: [{ main: "plastic_red", trim: "plastic_black" }, { main: "plastic_yellow", trim: "plastic_black" }, { main: "plastic_green", trim: "plastic_black" }],
  },
  {
    name: "water", title: "water canister", text: "a low, wide water canister with rounded edges, hand grips, a folding top handle, a vent cap and a tap at the front base", tags: ["water can", "jerrycan water", "waterjerrycan", "camping", "tap", "kraantje"], build: waterCan,
    params: [num("width", 0.4, 0.3, 0.48, "Width along x in metres."), num("depth", 0.24, 0.18, 0.3, "Depth along z in metres."), num("height", 0.36, 0.28, 0.45, "Height to the top of the handle in metres.")],
    finishes: [{ main: "hdpe_blue", trim: "hdpe_white" }, { main: "hdpe_white", trim: "hdpe_blue" }],
  },
];

function can(style: Style, f: Finish): AssetDraft {
  const fin = finishName(f.main);
  return {
    slug: slugify("jerrycan", style.name, fin),
    title: cap(`${fin} ${style.title}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}. Its broad face looks towards +z.`,
    tags: [...style.tags, ...finishTags(f.main)],
    params: style.params,
    materials: useMats(f.main, f.trim, "hole", "plastic_black"),
    nodes: style.build(f),
  };
}

export const jerrycanFamily: Family = {
  id: "jerrycan",
  category: "storage",
  archetype: "prop.jerrycan",
  tags: ["jerrycan", "jerry can", "can", "kan", "jerrycan", "storage", "fuel", "water"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => can(s, f))),
};
