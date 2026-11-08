import { box, cap, cyl, group, num, slugify, tube, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, useMats } from "./common.js";

type Finish = { main: string; cable: string; trim: string };
interface Style {
  name: string;
  title: string;
  text: string;
  tags: string[];
  params: ParamDef[];
  finishes: Finish[];
  build: (f: Finish) => SpecNode[];
}

/**
 * The outer layer of cable as a helix about x, `turns` turns from the left flange towards the right, at radius
 * `$Rc`, laid with a pitch of twice the cable radius `$cr`. Expressions in $W (width between flanges).
 */
function helix(turns: number): Vec[] {
  const pts: Vec[] = [];
  const per = 14;
  for (let k = 0; k <= turns * per; k++) {
    const a = (k / per) * 2 * Math.PI;
    pts.push([`$W / 2 - $cr - ${(k / per).toFixed(4)} * 2 * $cr`, `$Rc * ${Math.cos(a).toFixed(5)}`, `$Rc * ${Math.sin(a).toFixed(5)}`]);
  }
  return pts;
}

/** A wooden cable drum on its edge: plank flanges with battens and bolts, a wound core and a loose cable end. */
function woodenDrum(f: Finish): SpecNode[] {
  const flange = (name: string, mirror?: string): SpecNode =>
    group(name, [
      cyl("Disc", "$R", 0.05, { axis: "x", segments: 40 }),
      box("Seam_{i}", [0.054, "$R * 1.7", 0.006], { at: [0, 0, "-$R * 0.6"], repeat: { count: 5, step: [0, 0, "$R * 0.3"] }, material: "hole" }),
      box("Batten_F", [0.035, "$R * 1.6", 0.09], { at: [0.035, 0, "$R * 0.42"] }),
      box("Batten_B", [0.035, "$R * 1.6", 0.09], { at: [0.035, 0, "-$R * 0.42"] }),
      cyl("Bolt_{i}", 0.018, 0.08, { axis: "x", at: [0.03, "$R * 0.7", 0], repeat: { count: 8, around: "x", phase: 22.5 }, segments: 6, material: f.trim }),
      cyl("Bore", 0.06, 0.06, { axis: "x", at: [0.004, 0, 0], segments: 16, material: "hole" }),
      cyl("Plate", 0.11, 0.012, { axis: "x", at: [0.03, 0, 0], segments: 16, material: f.trim }),
    ], { at: ["$W / 2 + 0.025", "$R", 0], ...(mirror ? { mirror } : {}) });
  return [
    group("Reel", [
      flange("Flange_L", "Flange_R"),
      group("Core", [
        cyl("Barrel", "$Rc", "$W + 0.01", { axis: "x", segments: 40, material: f.cable }),
        tube("Turns", helix(5), "$cr", { segments: 8, material: f.cable }),
      ], { at: [0, "$R", 0], vars: { Rc: "$R * $fill", cr: 0.016 } }),
      tube("Tail", [["-$W / 4", "$R + $R * $fill", 0], ["-$W / 4", "$R + $R * $fill + 0.02", "$R * 0.3"], ["-$W / 4", "$R * 0.6", "$R + 0.2"], ["-$W / 4 + 0.1", 0.017, "$R + 0.5"], ["-$W / 4 + 0.3", 0.017, "$R + 0.9"]], 0.016, { segments: 8, material: f.cable }),
    ], { material: f.main, vars: { R: "$diameter / 2", W: "$width" } }),
  ];
}

/** A small plywood spool lying flat, its top flange a table, with cable on its core. */
function flatSpool(f: Finish): SpecNode[] {
  return [
    group("Spool", [
      cyl("Flange_Low", "$R", 0.04, { anchor: "base", segments: 36, bevel: 0.006 }),
      group("Core", [
        cyl("Barrel", "$R * $fill", "$height - 0.08", { anchor: "base", segments: 36, material: f.cable }),
        cyl("Hub", "$R * 0.3", "$height - 0.07", { anchor: "base", at: [0, -0.005, 0], segments: 20 }),
      ], { at: [0, 0.04, 0] }),
      group("Flange_Top", [
        cyl("Disc", "$R", 0.04, { anchor: "base", segments: 36, bevel: 0.006 }),
        cyl("Bore", 0.05, 0.004, { at: [0, 0.04, 0], segments: 16, material: "hole" }),
        cyl("Bolt_{i}", 0.014, 0.008, { at: ["$R * 0.25", 0.042, 0], repeat: { count: 4, around: "y", phase: 45 }, segments: 8, material: f.trim }),
        box("Stencil", ["$R * 0.7", 0.003, "$R * 0.2"], { at: [0, 0.04, "$R * 0.55"], material: f.trim }),
      ], { at: [0, "$height - 0.04", 0] }),
    ], { material: f.main, vars: { R: "$diameter / 2" } }),
  ];
}

/** A steel hose reel on an A-frame stand: spoked flanges, a drum with hose wound on it and a crank. */
function hoseReel(f: Finish): SpecNode[] {
  const flange = (name: string): SpecNode =>
    group(name, [
      cyl("Ring", "$R", 0.03, { axis: "x", segments: 36, bevel: 0.006 }),
      cyl("Web", "$R - 0.03", 0.006, { axis: "x", segments: 36, material: "black_steel" }),
      box("Spoke_{i}", [0.02, "$R * 0.95", 0.03], { at: [0.012, "$R * 0.5", 0], repeat: { count: 6, around: "x" } }),
      cyl("Boss", 0.06, 0.06, { axis: "x", at: [0.02, 0, 0], segments: 16 }),
    ], { at: ["$W / 2 + 0.015", 0, 0] });
  return [
    group("HoseReel", [
      group("Stand_L", [
        tube("Leg", [[0, 0.02, "-$R * 0.9"], [0, "$ay", 0], [0, 0.02, "$R * 0.9"]], 0.025, { segments: 8 }),
        box("Shoe_F", [0.06, 0.02, 0.1], { at: [0, 0.01, "$R * 0.9"], material: "rubber" }),
        box("Shoe_B", [0.06, 0.02, 0.1], { at: [0, 0.01, "-$R * 0.9"], material: "rubber" }),
      ], { at: ["$W / 2 + 0.09", 0, 0], material: "black_steel", mirror: "Stand_R" }),
      box("Stretcher", ["$W + 0.2", 0.04, 0.04], { at: [0, 0.03, 0], material: "black_steel" }),
      cyl("Axle", 0.02, "$W + 0.32", { axis: "x", at: [0, "$ay", 0], segments: 10, material: "steel" }),
      group("Spinner", [
        { ...flange("Flange_L"), mirror: "Flange_R" },
        group("Core", [
          cyl("Barrel", "$Rc", "$W", { axis: "x", segments: 32, material: f.cable }),
          tube("Turns", helix(4), "$cr", { segments: 8, material: f.cable }),
        ], { vars: { Rc: "$R * $fill", cr: 0.013 } }),
        tube("Crank", [["-$W / 2 - 0.05", 0, 0], ["-$W / 2 - 0.08", 0, 0], ["-$W / 2 - 0.08", 0, "$R * 0.5"], ["-$W / 2 - 0.2", 0, "$R * 0.5"]], 0.012, { segments: 8, material: "steel" }),
      ], { at: [0, "$ay", 0] }),
      tube("Tail", [["$W / 4", "$ay + $R * $fill", 0], ["$W / 4", "$ay + $R * $fill", "$R * 0.4"], ["$W / 4", "$ay * 0.5", "$R + 0.15"], ["$W / 4", 0.013, "$R + 0.4"], ["$W / 4 - 0.2", 0.013, "$R + 0.7"]], 0.013, { segments: 8, material: f.cable }),
    ], { material: f.main, vars: { R: "$diameter / 2", W: "$width", ay: "$diameter / 2 + 0.08" } }),
  ];
}

const STYLES: Style[] = [
  {
    name: "wooden", title: "wooden cable drum", text: "a wooden cable drum standing on edge, with plank flanges braced by battens and bolts, cable wound on its core and a loose end on the ground in front", tags: ["cable drum", "kabelhaspel", "haspel", "kabelrol", "spool", "construction", "bouwplaats"], build: woodenDrum,
    params: [num("diameter", 1.2, 0.8, 2.0, "Flange diameter in metres."), num("width", 0.7, 0.4, 1.0, "Width between the flanges along x in metres."), num("fill", 0.72, 0.45, 0.88, "Radius of the wound cable as a fraction of the flange radius.")],
    finishes: [{ main: "pine", cable: "cable_black", trim: "galvanised" }, { main: "weathered_wood", cable: "cable_orange", trim: "rust" }, { main: "rough_timber", cable: "copper_wire", trim: "galvanised" }, { main: "birch", cable: "cable_green", trim: "steel" }],
  },
  {
    name: "flat", title: "cable spool lying flat", text: "a small plywood cable spool lying flat on its bottom flange, with cable wound on the core and a stencilled top flange that doubles as a table", tags: ["spool table", "haspeltafel", "spool", "haspel", "kabelrol"], build: flatSpool,
    params: [num("diameter", 0.9, 0.6, 1.3, "Flange diameter in metres."), num("height", 0.6, 0.4, 0.8, "Overall height in metres."), num("fill", 0.7, 0.45, 0.88, "Radius of the wound cable as a fraction of the flange radius.")],
    finishes: [{ main: "pine", cable: "cable_blue", trim: "paint_black" }, { main: "birch", cable: "cable_yellow", trim: "paint_red" }, { main: "whitewash_wood", cable: "rope", trim: "paint_black" }],
  },
  {
    name: "hose", title: "hose reel on a stand", text: "a steel hose reel on an A-frame stand, with spoked flanges, hose wound on the drum, a crank and the hose end trailing forward", tags: ["hose reel", "slanghaspel", "hose", "slang", "garden", "tuin", "fire hose"], build: hoseReel,
    params: [num("diameter", 0.6, 0.4, 0.9, "Flange diameter in metres."), num("width", 0.35, 0.25, 0.6, "Width of the drum along x in metres."), num("fill", 0.7, 0.5, 0.85, "Radius of the wound hose as a fraction of the flange radius.")],
    finishes: [{ main: "paint_red", cable: "cable_green", trim: "steel" }, { main: "galvanised", cable: "cable_yellow", trim: "steel" }, { main: "paint_blue", cable: "cable_black", trim: "steel" }],
  },
];

function reel(style: Style, f: Finish): AssetDraft {
  const fin = finishName(f.main);
  const what = finishName(f.cable);
  return {
    slug: slugify("cable-reel", style.name, fin, what),
    title: cap(`${fin} ${style.title} with ${what === "rope" ? "rope" : `${what} ${style.name === "hose" ? "hose" : "cable"}`}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}. It faces +z.`,
    tags: [...style.tags, ...finishTags(f.main), ...finishTags(f.cable)],
    params: style.params,
    materials: useMats(f.main, f.cable, f.trim, "hole", "black_steel", "steel", "rubber"),
    nodes: style.build(f),
  };
}

export const cableReelFamily: Family = {
  id: "cable-reel",
  category: "storage",
  archetype: "prop.cable-reel",
  tags: ["cable reel", "kabelhaspel", "reel", "haspel", "drum", "spool", "storage"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => reel(s, f))),
};
