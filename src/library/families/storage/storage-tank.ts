import { box, cap, cyl, ellipsoid, group, int, lathe, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, ring, useMats } from "./common.js";

type Finish = { main: string; trim: string; base: string };
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
 * A vertical caged ladder from y0 to y1 with its rails at x = ±0.22 and its back at z = `z` (the face it climbs),
 * the cage hoops bulging towards +z.
 */
function ladder(z: string, y0: string, y1: string, material: string): SpecNode {
  return group("Ladder", [
    box("Rail_L", [0.06, `${y1} - ${y0}`, 0.03], { at: [0.22, `(${y0} + ${y1}) / 2`, `${z} + 0.25`], mirror: "Rail_R" }),
    cyl("Rung_{i}", 0.014, 0.44, { axis: "x", at: [0, `${y0} + 0.3`, `${z} + 0.25`], repeat: { count: `floor((${y1} - ${y0} - 0.3) / 0.3)`, step: [0, 0.3, 0] }, segments: 6 }),
    box("Bracket_{i}", [0.5, 0.05, 0.3], { at: [0, `${y0} + 1.2`, `${z} + 0.12`], repeat: { count: `max(1, floor((${y1} - ${y0} - 1.2) / 3))`, step: [0, 3, 0] } }),
    tube("Hoop_{i}", [[0.25, 0, `${z} + 0.25`], [0.36, 0, `${z} + 0.5`], [0.25, 0, `${z} + 0.85`], [0, 0, `${z} + 0.95`], [-0.25, 0, `${z} + 0.85`], [-0.36, 0, `${z} + 0.5`], [-0.25, 0, `${z} + 0.25`]], 0.02, {
      at: [0, `${y0} + 2.4`, 0], repeat: { count: `max(1, floor((${y1} - ${y0} - 2.4) / 0.9) + 1)`, step: [0, 0.9, 0] }, segments: 6, caps: true,
    }),
    box("Strap_{i}", [0.04, `max(0.3, ${y1} - ${y0} - 2.4)`, 0.01], { at: [-0.34, `${y0} + 2.4 + max(0.3, ${y1} - ${y0} - 2.4) / 2`, `${z} + 0.5`], repeat: { count: 3, step: [0.34, 0, 0] } }),
  ], { material });
}

/** A ring of handrail at radius r on height y: a top rail and posts. */
function railing(name: string, r: string, y: string, posts: number, material: string): SpecNode {
  return group(name, [
    ring("TopRail", `${r} - 0.025`, `${r} + 0.025`, `${y} + 1.0`, `${y} + 1.05`, { segments: 48 }),
    ring("MidRail", `${r} - 0.02`, `${r} + 0.02`, `${y} + 0.5`, `${y} + 0.54`, { segments: 48 }),
    cyl("Post_{i}", 0.025, 1.05, { anchor: "base", at: [r, y, 0], repeat: { count: posts, around: "y" }, segments: 6 }),
  ], { material });
}

/** A welded vertical tank on a concrete ring: plate courses, a cone roof with a vent and handrail, a caged ladder, nozzles and a manway. */
function vertical(f: Finish): SpecNode[] {
  return [
    group("Tank", [
      cyl("Support", "$R + 0.4", 0.3, { anchor: "base", segments: 48, material: f.base }),
      cyl("Shell", "$R", "$height - 0.28", { anchor: "base", at: [0, 0.28, 0], segments: 48 }),
      group("Streaks", [
        box("Run_{i}", [0.16, 1.8, 0.008], { at: [0, "$height - 1.0", "$R + 0.003"], repeat: { count: 7, around: "y", phase: 31 }, material: "rust_streak" }),
        box("Drip_{i}", [0.07, 0.9, 0.008], { at: [0, "($height - 0.28) / $courses + 0.2", "$R + 0.003"], repeat: { count: 5, around: "y", phase: 77 }, material: "rust_streak" }),
      ]),
      lathe("Seam_{i}", [["$R - 0.01", -0.02], ["$R + 0.012", -0.02], ["$R + 0.012", 0.02], ["$R - 0.01", 0.02]], { at: [0, "0.28 + ($height - 0.28) / $courses", 0], repeat: { count: "$courses - 1", step: [0, "($height - 0.28) / $courses", 0] }, segments: 48, material: f.trim }),
      lathe("Roof", [["$R + 0.12", "$height - 0.06"], ["$R + 0.12", "$height + 0.04"], [0.6, "$height + $R * 0.2"], [0.55, "$height + $R * 0.2 + 0.04"]], { segments: 48 }),
      group("Vent", [
        cyl("Pipe", 0.2, 0.5, { anchor: "base", segments: 16 }),
        cyl("Hood", 0.35, 0.18, { anchor: "base", at: [0, 0.45, 0], segments: 16, bevel: 0.04 }),
      ], { at: [0, "$height + $R * 0.2", 0], material: f.trim }),
      railing("Railing", "$R + 0.02", "$height + 0.03", 20, f.trim),
      ladder("$R", "0.3", "$height + 1.0", f.trim),
      group("Nozzle", [
        cyl("Pipe", 0.12, 0.6, { axis: "z", at: [0, 0, 0.3], segments: 16 }),
        cyl("Flange", 0.22, 0.05, { axis: "z", at: [0, 0, 0.6], segments: 16, bevel: 0.01 }),
      ], { at: ["$R * 0.5", 0.8, "$R * 0.866 - 0.1"], material: f.trim }),
      group("Manway", [
        cyl("Neck", 0.35, 0.35, { axis: "x", at: [0.15, 0, 0], segments: 20 }),
        cyl("Cover", 0.45, 0.06, { axis: "x", at: [0.33, 0, 0], segments: 20, bevel: 0.015 }),
        cyl("Bolt_{i}", 0.025, 0.04, { axis: "x", at: [0.37, 0.39, 0], repeat: { count: 12, around: "x" }, segments: 6 }),
      ], { at: ["$R - 0.1", 0.95, 0], material: f.trim }),
    ], { material: f.main, vars: { R: "$diameter / 2" } }),
  ];
}

/** A hopper-bottom silo on legs: ribbed cylinder, a cone hopper with a slide gate, a cone roof with vent and a caged ladder. */
function silo(f: Finish): SpecNode[] {
  return [
    group("Silo", [
      lathe("Shell", [[0.2, "$lh"], [0.25, "$lh + 0.05"], ["$R", "$lh + $R * 1.1"], ["$R", "$top"]], { segments: 40 }),
      lathe("Rib_{i}", [["$R - 0.01", 0], ["$R + 0.025", 0.01], ["$R + 0.025", 0.04], ["$R - 0.01", 0.05]], { at: [0, "$lh + $R * 1.1 + 0.1", 0], repeat: { count: "floor(($top - $lh - $R * 1.1 - 0.2) / 0.3)", step: [0, 0.3, 0] }, segments: 40 }),
      lathe("Roof", [["$R + 0.08", "$top - 0.04"], ["$R + 0.08", "$top + 0.04"], [0.35, "$top + $R * 0.55"], [0.3, "$top + $R * 0.55 + 0.03"]], { segments: 40 }),
      group("Vent", [
        cyl("Pipe", 0.18, 0.4, { anchor: "base", segments: 16 }),
        cyl("Hood", 0.32, 0.12, { anchor: "base", at: [0, 0.35, 0], segments: 16, bevel: 0.03 }),
      ], { at: [0, "$top + $R * 0.55", 0], material: f.trim }),
      box("Leg_{i}", [0.18, "$lh + $R * 1.1 + 0.4", 0.18], { at: ["$R * 0.96", 0, 0], anchor: "bottom", repeat: { count: "$legs", around: "y", phase: 45 }, material: f.trim }),
      ring("Girt", "$R * 0.96 - 0.06", "$R * 0.96 + 0.06", "$lh * 0.45", "$lh * 0.45 + 0.12", { segments: 40, material: f.trim }),
      lathe("Ring", [["$R - 0.02", "$lh + $R * 1.1 - 0.1"], ["$R + 0.1", "$lh + $R * 1.1 - 0.1"], ["$R + 0.1", "$lh + $R * 1.1 + 0.1"], ["$R - 0.02", "$lh + $R * 1.1 + 0.1"]], { segments: 40, material: f.trim }),
      group("Gate", [
        box("Frame", [0.5, 0.18, 0.5], { at: [0, "$lh - 0.05", 0] }),
        box("Slide", [0.3, 0.05, 0.9], { at: [0, "$lh - 0.05", 0.2] }),
        cyl("Spout", 0.12, 0.4, { at: [0, "$lh - 0.34", 0], anchor: "base", segments: 12 }),
      ], { material: f.trim }),
      ladder("$R", "0.05", "$top + $R * 0.2", f.trim),
    ], { material: f.main, vars: { R: "$diameter / 2", lh: "max(1.4, $height * 0.22)", top: "$height - $diameter / 2 * 0.55 - 0.5" } }),
  ];
}

/** A pressure sphere on tubular legs with cross bracing, a curved ladder over the shell and a top platform with a railing. */
function sphere(f: Finish): SpecNode[] {
  const arc = (deg: number): [string, string, string] => {
    const a = (deg * Math.PI) / 180;
    return ["$sx", `$C + ($R + 0.3) * ${Math.sin(a).toFixed(5)}`, `($R + 0.3) * ${Math.cos(a).toFixed(5)}`];
  };
  const rails = [0, 15, 30, 45, 60, 75, 82].map(arc);
  return [
    group("Sphere", [
      ellipsoid("Shell", ["$R", "$R", "$R"], { at: [0, "$C", 0], segments: 40 }),
      lathe("Seam", [["$R - 0.02", "$C - 0.04"], ["$R + 0.02", "$C - 0.04"], ["$R + 0.02", "$C + 0.04"], ["$R - 0.02", "$C + 0.04"]], { segments: 40, material: f.trim }),
      group("Leg_{i}", [
        cyl("Column", 0.22, "$C + 0.3", { anchor: "base", at: ["$R", 0, 0], segments: 12 }),
        cyl("Foot", 0.4, 0.3, { anchor: "base", at: ["$R", 0, 0], segments: 12, material: f.base }),
        tube("Brace_A", [["$R", 0.6, 0], ["$R * cos(2 * pi / $legs)", "$C - 0.8", "-$R * sin(2 * pi / $legs)"]], 0.06, { segments: 6 }),
        tube("Brace_B", [["$R", "$C - 0.8", 0], ["$R * cos(2 * pi / $legs)", 0.6, "-$R * sin(2 * pi / $legs)"]], 0.06, { segments: 6 }),
      ], { repeat: { count: "$legs", around: "y", phase: 22.5 }, material: f.trim }),
      group("Roof", [
        cyl("Deck", 1.4, 0.12, { at: [0, "$C + $R - 0.12", 0], anchor: "base", segments: 24 }),
        cyl("Nozzle", 0.3, 0.4, { at: [0, "$C + $R - 0.1", 0], anchor: "base", segments: 16 }),
        railing("Railing", "1.35", "$C + $R", 12, f.trim),
      ], { material: f.trim }),
      group("Ladder", [
        group("Rails", [
          tube("Rail_L", rails, 0.03, { segments: 6, vars: { sx: 0.22 } }),
          tube("Rail_R", rails, 0.03, { segments: 6, vars: { sx: -0.22 } }),
        ]),
        cyl("Rung_{i}", 0.014, 0.44, { axis: "x", at: [0, "$C + ($R + 0.3) * sin($i * 0.3 / ($R + 0.3))", "($R + 0.3) * cos($i * 0.3 / ($R + 0.3))"], repeat: { count: "floor(1.43 * ($R + 0.3) / 0.3)", step: [0, 0, 0] }, segments: 6 }),
        box("Upright_L", [0.06, "$C", 0.04], { at: [0.22, "$C / 2", "$R + 0.3"], mirror: "Upright_R" }),
        cyl("Step_{i}", 0.014, 0.44, { axis: "x", at: [0, 0.3, "$R + 0.3"], repeat: { count: "floor(($C - 0.4) / 0.3)", step: [0, 0.3, 0] }, segments: 6 }),
      ], { material: f.trim }),
    ], { material: f.main, vars: { R: "$diameter / 2", C: "$diameter / 2 + $clearance" } }),
  ];
}

/** An elevated water tank on braced legs: a cylinder with a rounded bottom and a cone roof, a balcony and a ladder up one leg. */
function tower(f: Finish): SpecNode[] {
  return [
    group("WaterTower", [
      lathe("Shell", [[0.3, "$b - $R * 0.45"], ["$R * 0.6", "$b - $R * 0.36"], ["$R * 0.88", "$b - $R * 0.18"], ["$R", "$b"], ["$R", "$b + $th"]], { segments: 40 }),
      lathe("Roof", [["$R + 0.15", "$b + $th - 0.05"], ["$R + 0.15", "$b + $th + 0.05"], [0.3, "$b + $th + $R * 0.45"], [0.25, "$b + $th + $R * 0.45 + 0.05"]], { segments: 40 }),
      cyl("Finial", 0.12, 0.6, { at: [0, "$b + $th + $R * 0.45", 0], anchor: "base", segments: 10, material: f.trim }),
      cyl("Riser", 0.35, "$b - $R * 0.4", { anchor: "base", segments: 16, material: f.trim }),
      group("Leg_{i}", [
        tube("Column", [["$R * 0.95 + 1.2", 0, 0], ["$R * 0.95", "$b + 0.3", 0]], 0.18, { segments: 10 }),
        cyl("Foot", 0.5, 0.4, { anchor: "base", at: ["$R * 0.95 + 1.2", 0, 0], segments: 10, material: f.base }),
        tube("Brace", [["$R * 0.95 + 1.2 - 1.2 * 0.3", "$b * 0.3", 0], ["($R * 0.95 + 1.2 - 1.2 * 0.62) * cos(2 * pi / $legs)", "$b * 0.62", "-($R * 0.95 + 1.2 - 1.2 * 0.62) * sin(2 * pi / $legs)"]], 0.06, { segments: 6 }),
        tube("Strut", [["$R * 0.95 + 1.2 - 1.2 * 0.62", "$b * 0.62", 0], ["($R * 0.95 + 1.2 - 1.2 * 0.3) * cos(2 * pi / $legs)", "$b * 0.3", "-($R * 0.95 + 1.2 - 1.2 * 0.3) * sin(2 * pi / $legs)"]], 0.06, { segments: 6 }),
      ], { repeat: { count: "$legs", around: "y", phase: 45 }, material: f.trim }),
      lathe("Balcony", [["$R - 0.05", "$b - 0.1"], ["$R + 0.9", "$b - 0.1"], ["$R + 0.9", "$b"], ["$R - 0.05", "$b"]], { segments: 40, material: f.trim }),
      railing("Railing", "$R + 0.85", "$b", 24, f.trim),
      ladder("$R * 0.95 + 0.1", "0.05", "$b", f.trim),
    ], { material: f.main, vars: { R: "$diameter / 2", th: "$diameter * 0.8", b: "$height - $diameter * 0.8 - $diameter / 2 * 0.45" } }),
  ];
}

const STYLES: Style[] = [
  {
    name: "vertical", title: "vertical storage tank", text: "a welded vertical tank on a concrete ring, with plate courses, a cone roof with a vent and handrail, a caged ladder, a nozzle and a bolted manway", tags: ["oil tank", "opslagtank", "water tank", "fuel tank", "tank farm"], build: vertical,
    params: [num("diameter", 8, 4, 15, "Shell diameter in metres."), num("height", 9, 5, 14, "Shell height in metres."), int("courses", 6, 3, 10, "Number of welded plate courses up the shell.")],
    finishes: [{ main: "tank_white", trim: "galvanised", base: "concrete" }, { main: "tank_silver", trim: "steel", base: "concrete" }, { main: "paint_forest", trim: "paint_yellow", base: "concrete_dark" }],
  },
  {
    name: "silo", title: "hopper silo", text: "a ribbed hopper-bottom silo on legs with a cone roof and vent, a slide gate under the hopper and a caged ladder", tags: ["silo", "grain", "graan", "feed", "voer", "hopper", "legs"], build: silo,
    params: [num("diameter", 3.5, 2.5, 5.5, "Diameter of the bin in metres."), num("height", 10, 7, 16, "Overall height in metres."), int("legs", 6, 4, 10, "Number of legs.")],
    finishes: [{ main: "galvanised", trim: "steel", base: "concrete" }, { main: "aluminium", trim: "paint_grey", base: "concrete" }, { main: "paint_white", trim: "paint_red", base: "concrete" }],
  },
  {
    name: "sphere", title: "spherical gas tank", text: "a pressure sphere on tubular legs with cross bracing, a ladder curving up over the shell and a top platform with a railing", tags: ["sphere", "bol", "lpg", "gas holder", "horton sphere", "bolvormig"], build: sphere,
    params: [num("diameter", 10, 6, 16, "Sphere diameter in metres."), num("clearance", 2.5, 1.5, 4, "Height of the sphere's bottom above the ground in metres."), int("legs", 8, 6, 12, "Number of legs.")],
    finishes: [{ main: "tank_white", trim: "steel", base: "concrete" }, { main: "paint_sky", trim: "galvanised", base: "concrete" }, { main: "tank_silver", trim: "paint_grey", base: "concrete" }],
  },
  {
    name: "water-tower", title: "elevated water tank", text: "an elevated water tank on raked braced legs with a rounded bottom, a cone roof, a balcony with a railing and a ladder up to it", tags: ["water tower", "watertoren", "elevated tank", "legs"], build: tower,
    params: [num("height", 20, 14, 30, "Overall height in metres."), num("diameter", 6, 4, 9, "Tank diameter in metres."), int("legs", 4, 3, 6, "Number of legs.")],
    finishes: [{ main: "paint_sky", trim: "steel", base: "concrete" }, { main: "paint_white", trim: "paint_grey", base: "concrete" }, { main: "rust", trim: "rust", base: "concrete_dark" }],
  },
];

function tank(style: Style, f: Finish): AssetDraft {
  const fin = finishName(f.main);
  return {
    slug: slugify("storage-tank", style.name, fin),
    title: cap(`${fin} ${style.title}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}. Its ladder faces +z.`,
    tags: [...style.tags, ...finishTags(f.main)],
    params: style.params,
    materials: useMats(f.main, f.trim, f.base, "rust_streak"),
    nodes: style.build(f),
  };
}

export const storageTankFamily: Family = {
  id: "storage-tank",
  category: "storage",
  archetype: "infrastructure.storage-tank",
  tags: ["storage tank", "tank", "opslagtank", "silo", "industrial", "industrie"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => tank(s, f))),
};
