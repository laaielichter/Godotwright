import { box, cap, cyl, group, lathe, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, ring, useMats, wrapLabel } from "./common.js";

type Finish = { main: string; shoulder: string; valve: string; label: string };
interface Style {
  name: string;
  title: string;
  text: string;
  tags: string[];
  params: ParamDef[];
  finishes: Finish[];
  build: (f: Finish) => SpecNode[];
}

/** A brass valve with a handwheel on top, standing at the node origin, outlet towards +z. */
function valve(f: Finish, scale = 1): SpecNode {
  const s = (v: number): number => Math.round(v * scale * 10000) / 10000;
  return group("Valve", [
    cyl("Stem", s(0.019), s(0.05), { anchor: "base", at: [0, -0.01, 0], segments: 12 }),
    box("Block", [s(0.045), s(0.05), s(0.04)], { at: [0, s(0.06), 0], bevel: s(0.006) }),
    tube("Outlet", [[0, s(0.055), s(0.015)], [0, s(0.055), s(0.05)]], s(0.012), { segments: 10 }),
    cyl("Nut", s(0.017), s(0.014), { axis: "z", at: [0, s(0.055), s(0.05)], segments: 6 }),
    cyl("Spindle", s(0.007), s(0.04), { at: [0, s(0.085), 0], anchor: "base", segments: 8 }),
    cyl("Wheel", s(0.034), s(0.012), { at: [0, s(0.118), 0], segments: 20, bevel: s(0.004), material: f.label }),
  ], { at: [0, "$H - 0.004", 0], material: f.valve });
}

/** A tall industrial cylinder: a long shell with a domed shoulder, a foot ring, a neck collar and a valve. */
function industrial(f: Finish): SpecNode[] {
  return [
    group("Cylinder", [
      lathe("Body", [["$R - 0.02", 0.006], ["$R", 0.03], ["$R", "$H - $R * 1.05"], ["$R * 0.95", "$H - $R * 0.7"], ["$R * 0.8", "$H - $R * 0.42"], ["$R * 0.55", "$H - $R * 0.2"], [0.042, "$H - 0.045"], [0.03, "$H - 0.03"]], { segments: 32 }),
      lathe("Shoulder", [["$R + 0.002", "$H - $R * 1.05"], ["$R * 0.96", "$H - $R * 0.68"], ["$R * 0.81", "$H - $R * 0.4"], ["$R * 0.56", "$H - $R * 0.18"], [0.044, "$H - 0.043"], [0.04, "$H - 0.05"], ["$R * 0.5", "$H - $R * 0.25"], ["$R - 0.004", "$H - $R * 1.04"]], { segments: 32, material: f.shoulder }),
      lathe("Foot", [["$R + 0.004", 0], ["$R + 0.008", 0.006], ["$R + 0.008", 0.07], ["$R + 0.004", 0.076], ["$R - 0.004", 0.076], ["$R - 0.004", 0]], { segments: 32, material: "black_steel" }),
      wrapLabel("Label", "$R", 60, "$H - $R * 1.5 - 0.06", "$H - $R * 1.5 + 0.06", f.label),
      cyl("Collar", 0.048, 0.04, { anchor: "base", at: [0, "$H - 0.05", 0], segments: 20, material: "black_steel", bevel: 0.004 }),
      valve(f),
    ], { material: f.main, vars: { H: "$height - 0.13", R: "$radius" } }),
  ];
}

/** A welding-gas cylinder with an open tulip guard of bars round the valve. */
function guarded(f: Finish): SpecNode[] {
  return [
    group("Cylinder", [
      lathe("Body", [["$R - 0.02", 0.006], ["$R", 0.03], ["$R", "$H - $R * 0.9"], ["$R * 0.9", "$H - $R * 0.5"], ["$R * 0.65", "$H - $R * 0.22"], [0.05, "$H - 0.03"], [0.04, "$H - 0.02"]], { segments: 32 }),
      lathe("Band", [["$R - 0.002", "$H * 0.55"], ["$R + 0.003", "$H * 0.55 + 0.004"], ["$R + 0.003", "$H * 0.55 + 0.05"], ["$R - 0.002", "$H * 0.55 + 0.054"]], { segments: 32, material: f.shoulder }),
      lathe("Foot", [["$R + 0.004", 0], ["$R + 0.008", 0.006], ["$R + 0.008", 0.05], ["$R - 0.004", 0.05], ["$R - 0.004", 0]], { segments: 32, material: "black_steel" }),
      group("Collar", [
        cyl("Ring", 0.06, 0.03, { anchor: "base", at: [0, -0.01, 0], segments: 20, bevel: 0.004 }),
        tube("Bar_{i}", [[0.055, 0.01, 0], [0.085, 0.07, 0], [0.085, 0.16, 0]], 0.008, { segments: 8, repeat: { count: 3, around: "y", phase: 90 } }),
        ring("Rim", 0.078, 0.092, 0.155, 0.172, { segments: 24 }),
      ], { at: [0, "$H - 0.02", 0], material: f.shoulder }),
      valve(f, 0.9),
    ], { material: f.main, vars: { H: "$height - 0.17", R: "$radius" } }),
  ];
}

/** A squat propane bottle: rounded ends, a welded seam, a vented foot ring and a guard collar with two hand holes. */
function propane(f: Finish): SpecNode[] {
  return [
    group("PropaneTank", [
      lathe("Body", [["$R * 0.55", 0.05], ["$R * 0.8", 0.065], ["$R * 0.95", 0.1], ["$R", 0.15], ["$R", "$H - $R * 0.6"], ["$R * 0.94", "$H - $R * 0.3"], ["$R * 0.75", "$H - $R * 0.1"], ["$R * 0.4", "$H - 0.005"], [0.03, "$H"]], { segments: 36 }),
      lathe("Seam", [["$R - 0.002", "$H * 0.52 - 0.006"], ["$R + 0.004", "$H * 0.52"], ["$R - 0.002", "$H * 0.52 + 0.006"]], { segments: 36, material: f.shoulder }),
      group("Foot", [
        ring("Ring", "$R * 0.78", "$R * 0.8", 0, 0.085, { segments: 32 }),
        box("Vent_{i}", [0.05, 0.025, 0.006], { at: [0, 0.035, "$R * 0.79"], repeat: { count: 4, around: "y", phase: 0 }, material: "hole" }),
      ], { material: f.shoulder }),
      wrapLabel("Label", "$R", 50, "$H * 0.4 - 0.045", "$H * 0.4 + 0.045", f.label),
      group("Collar", [
        lathe("Guard", [["$R * 0.58", 0], ["$R * 0.62", 0], ["$R * 0.62", "$gh"], ["$R * 0.66", "$gh + 0.008"], ["$R * 0.6", "$gh + 0.012"], ["$R * 0.58", "$gh"], ["$R * 0.58", 0]], { segments: 32, caps: false }),
        box("Grip_L", [0.012, 0.035, 0.09], { at: ["$R * 0.62", "$gh - 0.04", 0], material: "hole", mirror: "Grip_R" }),
      ], { at: [0, "$H - $R * 0.3", 0], material: f.shoulder }),
      valve(f, 0.85),
    ], { material: f.main, vars: { H: "$height - 0.1", R: "$radius" } }),
  ];
}

/** A small camping bottle: a short dome-topped body, a valve and a wire carrying handle on a collar. */
function camping(f: Finish): SpecNode[] {
  return [
    group("CampingBottle", [
      lathe("Body", [["$R - 0.015", 0.004], ["$R", 0.025], ["$R", "$H - $R * 0.55"], ["$R * 0.85", "$H - $R * 0.22"], ["$R * 0.5", "$H - 0.01"], [0.025, "$H"]], { segments: 32 }),
      lathe("Foot", [["$R + 0.002", 0], ["$R + 0.004", 0.03], ["$R - 0.004", 0.03], ["$R - 0.004", 0]], { segments: 32, material: f.shoulder }),
      wrapLabel("Label", "$R", 70, "$H * 0.28", "$H * 0.62", f.label),
      group("Collar", [
        cyl("Ring", 0.04, 0.02, { anchor: "base", segments: 20, bevel: 0.003 }),
        tube("Bail", [[0.04, 0.01, 0], [0.05, 0.06, 0], [0.03, 0.1, 0], [-0.03, 0.1, 0], [-0.05, 0.06, 0], [-0.04, 0.01, 0]], 0.004, { segments: 8 }),
      ], { at: [0, "$H - 0.012", 0], material: "steel" }),
      valve(f, 0.6),
    ], { material: f.main, vars: { H: "$height - 0.07", R: "$radius" } }),
  ];
}

const STYLES: Style[] = [
  {
    name: "industrial", title: "industrial gas cylinder", text: "a tall steel cylinder with a colour-coded shoulder, a foot ring, a neck collar and a brass valve with a handwheel", tags: ["oxygen", "zuurstof", "argon", "nitrogen", "industrial", "gasfles"], build: industrial,
    params: [num("height", 1.45, 1.0, 1.75, "Height to the top of the valve in metres."), num("radius", 0.115, 0.09, 0.14, "Radius of the shell in metres.")],
    finishes: [{ main: "paint_black", shoulder: "paint_white", valve: "brass", label: "paint_white" }, { main: "gas_green", shoulder: "gas_green", valve: "brass", label: "paint_white" }, { main: "paint_grey", shoulder: "gas_maroon", valve: "chrome", label: "paint_yellow" }],
  },
  {
    name: "guarded", title: "welding gas cylinder", text: "a steel cylinder with a painted band and an open tulip guard of bars round its valve", tags: ["acetylene", "acetyleen", "welding", "lassen", "gasfles"], build: guarded,
    params: [num("height", 1.1, 0.8, 1.5, "Height to the top of the guard in metres."), num("radius", 0.11, 0.09, 0.14, "Radius of the shell in metres.")],
    finishes: [{ main: "gas_maroon", shoulder: "black_steel", valve: "brass", label: "paint_white" }, { main: "paint_blue", shoulder: "galvanised", valve: "brass", label: "paint_white" }],
  },
  {
    name: "propane", title: "propane tank", text: "a squat propane bottle with rounded ends, a welded seam, a vented foot ring and a guard collar with two hand holes round the valve", tags: ["propane", "propaan", "lpg", "bbq", "butane", "butaan", "gasfles"], build: propane,
    params: [num("height", 0.62, 0.45, 0.8, "Height to the top of the collar in metres."), num("radius", 0.152, 0.12, 0.19, "Radius of the body in metres."), num("gh", 0.13, 0.1, 0.16, "Height of the guard collar in metres.")],
    finishes: [{ main: "paint_white", shoulder: "paint_white", valve: "brass", label: "paint_red" }, { main: "paint_orange", shoulder: "paint_orange", valve: "brass", label: "paint_white" }, { main: "paint_grey", shoulder: "galvanised", valve: "chrome", label: "paint_yellow" }],
  },
  {
    name: "camping", title: "camping gas bottle", text: "a small dome-topped gas bottle with a foot rim, a label, a valve and a wire carrying handle on its collar", tags: ["camping", "kamperen", "butane", "small", "klein", "gasfles"], build: camping,
    params: [num("height", 0.36, 0.3, 0.45, "Height to the top of the valve in metres."), num("radius", 0.1, 0.08, 0.13, "Radius of the body in metres.")],
    finishes: [{ main: "paint_blue", shoulder: "paint_blue", valve: "brass", label: "paint_white" }, { main: "paint_red", shoulder: "paint_red", valve: "brass", label: "paint_white" }],
  },
];

function cylinder(style: Style, f: Finish): AssetDraft {
  const fin = finishName(f.main);
  return {
    slug: slugify("gas-cylinder", style.name, fin),
    title: cap(`${fin} ${style.title}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}. It stands upright and its label and valve outlet face +z.`,
    tags: [...style.tags, ...finishTags(f.main)],
    params: style.params,
    materials: useMats(f.main, f.shoulder, f.valve, f.label, "black_steel", "steel", "hole"),
    nodes: style.build(f),
  };
}

export const gasCylinderFamily: Family = {
  id: "gas-cylinder",
  category: "storage",
  archetype: "prop.gas-cylinder",
  tags: ["gas cylinder", "gas bottle", "gasfles", "cylinder", "fles", "pressure", "storage"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => cylinder(s, f))),
};

