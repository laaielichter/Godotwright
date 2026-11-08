import { box, cyl, ellipsoid, group, lathe, num, roof, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import type { MaterialDef } from "../../palette.js";
import { sinkByIndex } from "./rocks.js";
import { laid } from "./timber.js";
import { finish } from "./finishes.js";

/**
 * Wells: a round stone well with a gabled roof and a winch, a hexagonal wooden wishing well, a square well head with a
 * cast-iron hand pump, and a four-post well house with a pyramid roof. The Wall is a ring (open at the top) with a dark
 * water disc inside; the Winch node sits on its axle so it can turn about x. On y = 0, facing +z.
 */
type Style = "roofed" | "wishing" | "pump" | "fourpost";

interface Finish {
  key: string;
  /** Moss clumps round the foot of a stone wall. */
  moss?: boolean;
  wall: string;
  wood: string;
  roof: string;
  metal: string;
  text: string;
}

const FINISHES: Record<Style, [Finish, Finish]> = {
  roofed: [
    { key: "granite", moss: true, wall: "granite_block", wood: "wood_oak", roof: "well_tiles", metal: "iron_painted_black", text: "mossy granite blocks, oak posts and a red tiled roof" },
    { key: "sandstone", moss: true, wall: "sandstone_block", wood: "wood_weathered", roof: "well_slate", metal: "iron_rusty", text: "sandstone, weathered timber and a slate roof" },
  ],
  wishing: [
    { key: "weathered", wall: "wood_weathered_planks", wood: "wood_weathered", roof: "well_shingle", metal: "iron_rusty", text: "weathered planks and a shingle roof" },
    { key: "whitewash", wall: "wood_whitewash_planks", wood: "wood_pine", roof: "well_tiles", metal: "iron_painted_black", text: "whitewashed planks, pine posts and a red roof" },
  ],
  pump: [
    { key: "brick", moss: true, wall: "brick_old", wood: "wood_oak", roof: "well_slate", metal: "iron_painted_black", text: "old red brick with a black cast-iron pump" },
    { key: "limestone", moss: true, wall: "limestone_block", wood: "wood_weathered", roof: "well_slate", metal: "iron_painted_green", text: "limestone with a green-painted pump" },
  ],
  fourpost: [
    { key: "fieldstone", moss: true, wall: "fieldstone", wood: "wood_rough", roof: "well_thatch", metal: "iron_rusty", text: "mossy fieldstone, rough timber and a thatched roof" },
    { key: "concrete", wall: "concrete_weathered", wood: "wood_dark", roof: "well_slate", metal: "galvanised_steel", text: "concrete rings, stained timber and a slate roof" },
  ],
};

const LOCAL: Record<string, MaterialDef> = {
  well_tiles: { color: [0.25, 0.07, 0.035], metallic: 0, roughness: 0.8, texture: "roof_tile" },
  well_slate: { color: [0.05, 0.055, 0.065], metallic: 0, roughness: 0.7, texture: "roof_slate" },
  well_shingle: { color: [0.12, 0.085, 0.055], metallic: 0, roughness: 0.92, texture: "roof_slate" },
  well_thatch: { color: [0.3, 0.24, 0.1], metallic: 0, roughness: 1, texture: "grass" },
};

/**
 * Moss on a stone wall (n places round it at radius r, the wall h tall with its coping lip at h - 0.08): at each place
 * two low, irregular cushions spreading along the foot where the damp collects, and a thin tuft tucked into the joint
 * under the coping. Cushions are flat lumpy ellipsoids half sunk into the wall, set down on their own lowest point.
 */
const MOSS = { lumps: 0.3, segments: 14 };
const moss = (f: Finish, r: Num, n: number, h: Num, phase = 0): SpecNode[] =>
  f.moss
    ? [group("Moss_{i}", [
        ellipsoid("Cushion_A", [0.045, 0.026, 0.17], { at: [`${r} - 0.012`, `0.026 * ${sinkByIndex(n, (i) => i * 5 + 2, MOSS.lumps, 0, MOSS.segments, { count: "fixed" })}`, -0.06], segments: MOSS.segments, lumps: MOSS.lumps, seed: "$i * 5 + 2", material: "moss_green" }),
        ellipsoid("Cushion_B", [0.045, 0.026, 0.11], { at: [`${r} - 0.016`, `0.026 * ${sinkByIndex(n, (i) => i * 5 + 4, MOSS.lumps, 0, MOSS.segments, { count: "fixed" })}`, 0.11], segments: MOSS.segments, lumps: MOSS.lumps, seed: "$i * 5 + 4", material: "moss_dark" }),
        ellipsoid("Cushion_C", [0.035, 0.02, 0.07], { at: [`${r} - 0.012`, `0.02 * ${sinkByIndex(n, (i) => i * 3 + 13, MOSS.lumps, 0, MOSS.segments, { count: "fixed" })}`, -0.24], segments: MOSS.segments, lumps: MOSS.lumps, seed: "$i * 3 + 13", material: "moss_dark" }),
        ellipsoid("Tuft", [0.022, 0.012, 0.09], { at: [`${r} + 0.004`, `${h} - 0.088`, 0.02], segments: 10, lumps: 0.3, seed: "$i * 3 + 9", material: "moss_green" }),
      ], { repeat: { count: n, around: "y", phase } })]
    : [];

/** A ring wall with a moulded coping; 4, 6 or many segments. */
const ringWall = (rin: Num, rout: Num, h: Num, segments: number, o: { rotate?: [Num, Num, Num] } = {}): SpecNode =>
  lathe("Wall", [
    [rin, 0], [rout, 0], [rout, `${h} - 0.08`], [`${rout} + 0.04`, `${h} - 0.06`], [`${rout} + 0.04`, h],
    [`${rin} - 0.03`, h], [`${rin} - 0.03`, `${h} - 0.04`], [rin, `${h} - 0.06`], [rin, 0],
  ], { segments, caps: false, ...o });

/** The dark water a little below the rim. */
const water = (r: Num, h: Num, segments: number, o: { rotate?: [Num, Num, Num] } = {}): SpecNode =>
  cyl("Water", `${r} + 0.005`, 0.02, { at: [0, `${h} - 0.35`, 0], segments, material: "well_water_dark", ...o });

/** A wooden bucket, its bottom at local y = 0, with iron bands and a bail handle (bail up when hanging). */
const bucket = (f: Finish, hanging: boolean): SpecNode =>
  group("Bucket", [
    lathe("Pail", [[0.02, 0], [0.11, 0], [0.14, 0.24], [0.125, 0.24], [0.1, 0.03], [0.02, 0.03]], { segments: 16, material: f.wood }),
    lathe("Band_Low", [[0.114, 0.04], [0.122, 0.04], [0.126, 0.07], [0.118, 0.07], [0.114, 0.04]], { segments: 16, caps: false }),
    lathe("Band_High", [[0.13, 0.18], [0.138, 0.18], [0.142, 0.21], [0.134, 0.21], [0.13, 0.18]], { segments: 16, caps: false }),
    tube("Bail", hanging ? [[-0.14, 0.2, 0], [-0.1, 0.33, 0], [0, 0.37, 0], [0.1, 0.33, 0], [0.14, 0.2, 0]] : [[-0.14, 0.2, 0], [-0.15, 0.24, 0.08], [-0.1, 0.25, 0.14], [0.1, 0.25, 0.14], [0.15, 0.24, 0.08], [0.14, 0.2, 0]], 0.005, { segments: 6 }),
  ], { material: f.metal });

/** A winch on its axle (the node origin): drum with rope turns, axle through the posts and a crank on the +x end. */
const winch = (f: Finish, span: Num, armX: Num, y: Num): SpecNode =>
  group("Winch", [
    cyl("Axle", 0.025, span, { axis: "x", segments: 12, material: f.metal }),
    cyl("Drum", 0.075, 0.42, { axis: "x", segments: 16, bevel: 0.01, material: f.wood }),
    cyl("RopeTurns", 0.085, 0.24, { axis: "x", segments: 16, material: "rope_hemp" }),
    box("Arm", [0.03, 0.26, 0.05], { at: [armX, -0.11, 0], bevel: 0.006, material: f.metal }),
    cyl("Handle", 0.016, 0.14, { axis: "x", at: [`${armX} + 0.08`, -0.22, 0], segments: 10, material: f.wood }),
  ], { at: [0, y, 0] });

function roofed(f: Finish): SpecNode[] {
  return [
    group("Well", [
      ringWall("$R - 0.18", "$R", "$wallHeight", 32),
      water("$R - 0.18", "$wallHeight", 32),
      ...moss(f, "$R", 7, "$wallHeight", 20),
      box("Post_L", [0.12, "$roofHeight - $wallHeight + 0.05", 0.12], { at: ["$R - 0.09", "$wallHeight - 0.05", 0], anchor: "bottom", bevel: 0.01, material: f.wood, mirror: "Post_R" }),
      laid("z", box("Brace_L", [0.06, 0.06, "$R * 0.9"], { at: ["$R - 0.09", "$roofHeight - 0.03", 0], bevel: 0.006, material: f.wood, mirror: "Brace_R" })),
      laid("x", box("Ridge", ["2 * $R + 0.1", 0.08, 0.08], { at: [0, "$roofHeight - 0.03", 0], bevel: 0.008, material: f.wood })),
      roof("Roof", { x0: "-$R - 0.25", x1: "$R + 0.25", z0: "-$R * 0.8", z1: "$R * 0.8", y: "$roofHeight", rise: "$R * 0.55", kind: "gable" }, { material: f.roof }),
      winch(f, "2 * $R + 0.1", "$R + 0.03", "$ay"),
      tube("Rope", [[0, "$ay - 0.08", 0.02], [0, "$wallHeight + 0.42", 0.02], [0, "$wallHeight + 0.35", 0]], 0.008, { segments: 6, material: "rope_hemp" }),
      group("Hang", [bucket(f, true)], { at: [0, "$wallHeight - 0.02", 0] }),
    ], { material: f.wall, vars: { R: "$radius", ay: "$wallHeight + ($roofHeight - $wallHeight) * 0.55" } }),
  ];
}

function wishing(f: Finish): SpecNode[] {
  return [
    group("WishingWell", [
      ringWall("$R - 0.1", "$R", "$wallHeight", 6),
      water("$R - 0.1", "$wallHeight", 6),
      cyl("Coin_{i}", 0.012, 0.004, { at: ["($R - 0.3) * cos($i * 2.1)", "$wallHeight - 0.338", "($R - 0.3) * sin($i * 2.1) * 0.8"], segments: 10, material: "gilt", repeat: { count: 7, step: [0, 0, 0] } }),
      box("Post_L", [0.09, "$roofHeight - $wallHeight + 0.06", 0.09], { at: ["$R - 0.06", "$wallHeight - 0.06", 0], anchor: "bottom", bevel: 0.008, material: f.wood, mirror: "Post_R" }),
      laid("x", box("Beam", ["2 * $R - 0.02", 0.08, 0.1], { at: [0, "$roofHeight - 0.02", 0], bevel: 0.008, material: f.wood })),
      roof("Roof", { x0: "-$R * 0.95", x1: "$R * 0.95", z0: "-$R * 0.95", z1: "$R * 0.95", y: "$roofHeight + 0.02", rise: "$R * 0.75", kind: "hip" }, { material: f.roof }),
      ellipsoid("Finial", [0.04, 0.06, 0.04], { at: [0, "$roofHeight + 0.02 + $R * 0.75", 0], segments: 10, material: f.metal }),
      winch(f, "2 * $R + 0.08", "$R + 0.02", "$ay"),
      group("Rest", [bucket(f, false)], { at: ["-$R - 0.13", 0, 0], rotate: [0, 30, 0] }),
      tube("Rope", [[0, "$ay - 0.08", 0.02], [0, "$wallHeight - 0.1", 0.03], [0, "$wallHeight - 0.34", 0.03]], 0.008, { segments: 6, material: "rope_hemp" }),
    ], { material: f.wall, vars: { R: "$radius", ay: "$wallHeight + ($roofHeight - $wallHeight) * 0.6" } }),
  ];
}

function pump(f: Finish): SpecNode[] {
  return [
    group("PumpWell", [
      ringWall("$W * 0.5", "$W * 0.707", "$wallHeight", 4, { rotate: [0, 45, 0] }),
      ...moss(f, "$W * 0.5", 4, "$wallHeight", 90),
      laid("x", box("Cover", ["$W * 0.76", 0.08, "$W * 0.76"], { at: [0, "$wallHeight - 0.06", 0], anchor: "bottom", bevel: 0.01, material: f.wood })),
      laid("z", box("Batten_{i}", [0.06, 0.03, "$W * 0.7"], { at: ["-$W * 0.25 + $i * $W * 0.25", "$wallHeight + 0.015", 0], bevel: 0.006, material: f.wood, repeat: { count: 3, step: [0, 0, 0] } })),
      box("Hatch", ["$W * 0.3", 0.03, "$W * 0.24"], { at: [0, "$wallHeight + 0.01", "$W * 0.2"], bevel: 0.004, material: f.wood }),
      cyl("HatchRing", 0.03, 0.01, { at: [0, "$wallHeight + 0.03", "$W * 0.27"], segments: 12, material: f.metal }),
      group("Pump", [
        box("Flange", [0.24, 0.03, 0.24], { anchor: "bottom", bevel: 0.006 }),
        lathe("Barrel", [[0.02, 0.02], [0.08, 0.02], [0.08, 0.06], [0.06, 0.1], [0.06, "$pumpHeight - 0.25"], [0.085, "$pumpHeight - 0.2"], [0.085, "$pumpHeight - 0.06"], [0.05, "$pumpHeight"], [0.02, "$pumpHeight + 0.02"]], { segments: 16 }),
        tube("Spout", [[0, "$pumpHeight * 0.55", 0.05], [0, "$pumpHeight * 0.55", "$W * 0.5 + 0.12"], [0, "$pumpHeight * 0.5", "$W * 0.5 + 0.24"]], [0.035, 0.028, 0.025], { segments: 12 }),
        group("Lever", [
          cyl("Pin", 0.014, 0.2, { axis: "x", segments: 8 }),
          tube("Handle", [[0, 0, 0], [0, 0.06, -0.25], [0, 0.0, -0.55]], 0.018, { segments: 8 }),
          ellipsoid("Knob", [0.026, 0.026, 0.05], { at: [0, -0.01, -0.57], segments: 10 }),
        ], { at: [0, "$pumpHeight - 0.08", -0.06] }),
      ], { at: [0, "$wallHeight + 0.02", -0.05], material: f.metal }),
      box("Step", [0.5, 0.12, 0.36], { at: [0, 0, "$W * 0.707 * 0.707 + 0.17"], anchor: "bottom", bevel: 0.015 }),
      group("Stand", [bucket(f, false)], { at: [0, 0.118, "$W * 0.707 * 0.707 + 0.17"] }),
    ], { material: f.wall, vars: { W: "$width" } }),
  ];
}

function fourpost(f: Finish): SpecNode[] {
  return [
    group("WellHouse", [
      ringWall("$W * 0.52", "$W * 0.707", "$wallHeight", 4, { rotate: [0, 45, 0] }),
      water("$W * 0.52", "$wallHeight", 4, { rotate: [0, 45, 0] }),
      ...moss(f, "$W * 0.5", 4, "$wallHeight", 90),
      box("Post_FL", [0.11, "$roofHeight - $wallHeight + 0.05", 0.11], { at: ["$a", "$wallHeight - 0.05", "$a"], anchor: "bottom", bevel: 0.01, material: f.wood, mirror: "Post_FR" }),
      box("Post_BL", [0.11, "$roofHeight - $wallHeight + 0.05", 0.11], { at: ["$a", "$wallHeight - 0.05", "-$a"], anchor: "bottom", bevel: 0.01, material: f.wood, mirror: "Post_BR" }),
      laid("z", box("Plate_L", [0.1, 0.1, "2 * $a + 0.12"], { at: ["$a", "$roofHeight - 0.05", 0], bevel: 0.008, material: f.wood, mirror: "Plate_R" })),
      laid("x", box("Plate_F", ["2 * $a + 0.12", 0.1, 0.1], { at: [0, "$roofHeight - 0.05", "$a"], bevel: 0.008, material: f.wood })),
      laid("x", box("Plate_B", ["2 * $a + 0.12", 0.1, 0.1], { at: [0, "$roofHeight - 0.05", "-$a"], bevel: 0.008, material: f.wood })),
      box("Hanger_L", [0.05, "$roofHeight - $ay + 0.05", 0.12], { at: ["$a", "$ay - 0.05", 0], anchor: "bottom", bevel: 0.005, material: f.wood, mirror: "Hanger_R" }),
      tube("KneeBrace_L", [["$a", "$roofHeight - 0.4", "$a - 0.03"], ["$a", "$roofHeight - 0.08", "$a - 0.35"]], 0.03, { segments: 6, material: f.wood, mirror: "KneeBrace_R" }),
      roof("Roof", { x0: "-$a - 0.3", x1: "$a + 0.3", z0: "-$a - 0.3", z1: "$a + 0.3", y: "$roofHeight", rise: "$a * 1.1", kind: "hip" }, { material: f.roof }),
      winch(f, "2 * $a + 0.12", "$a + 0.05", "$ay"),
      tube("Rope", [[0, "$ay - 0.08", 0.02], [0, "$wallHeight + 0.35", 0.02], [0, "$wallHeight + 0.3", 0]], 0.008, { segments: 6, material: "rope_hemp" }),
      group("Hang", [bucket(f, true)], { at: [0, "$wallHeight - 0.07", 0] }),
    ], { material: f.wall, vars: { W: "$width", a: "$width * 0.5 - 0.02", ay: "$wallHeight + ($roofHeight - $wallHeight) * 0.6" } }),
  ];
}

interface StyleDef {
  name: string;
  text: string;
  build: (f: Finish) => SpecNode[];
  params: () => ReturnType<typeof num>[];
  tags: string[];
}

const STYLES: Record<Style, StyleDef> = {
  roofed: {
    name: "roofed well",
    text: "A round well with a moulded coping over dark water, two posts carrying a gabled roof, a winch with a crank and a bucket hanging on its rope",
    build: roofed,
    params: () => [num("radius", 0.65, 0.5, 0.8, "Outer radius of the wall in metres."), num("wallHeight", 0.85, 0.7, 1.0, "Height of the wall."), num("roofHeight", 2.1, 1.9, 2.5, "Height of the eaves of the roof.")],
    tags: ["stone well", "stenen waterput", "medieval", "middeleeuws", "roof", "dak"],
  },
  wishing: {
    name: "wishing well",
    text: "A hexagonal wishing well of planks with coins in the water, a pyramid roof on two posts, a winch and a bucket resting on the rim",
    build: wishing,
    params: () => [num("radius", 0.55, 0.45, 0.7, "Radius of the hexagon in metres."), num("wallHeight", 0.7, 0.55, 0.85, "Height of the wall."), num("roofHeight", 1.65, 1.5, 1.9, "Height of the eaves of the roof.")],
    tags: ["wishing well", "wensput", "garden", "tuin", "coins", "muntjes", "fairy tale", "sprookje"],
  },
  pump: {
    name: "pump well",
    text: "A square well head closed by a planked cover with a hatch, a cast-iron hand pump with a lever handle on top and a bucket on a step under its spout",
    build: pump,
    params: () => [num("width", 1.1, 0.9, 1.4, "Width of the square wall in metres."), num("wallHeight", 0.55, 0.4, 0.7, "Height of the wall."), num("pumpHeight", 1.0, 0.85, 1.25, "Height of the pump above the cover.")],
    tags: ["hand pump", "handpomp", "waterpomp", "farm", "boerderij"],
  },
  fourpost: {
    name: "well house",
    text: "A square well with dark water under a four-post well house with knee braces and a pyramid roof, a winch hung between the side plates and a hanging bucket",
    build: fourpost,
    params: () => [num("width", 1.3, 1.0, 1.6, "Width of the square wall in metres."), num("wallHeight", 0.8, 0.65, 1.0, "Height of the wall."), num("roofHeight", 2.0, 1.8, 2.3, "Height of the eaves of the roof.")],
    tags: ["well house", "puthuisje", "thatched", "rieten dak", "village", "dorp"],
  },
};

function well(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const names = [f.wall, f.wood, f.metal, "gilt", "well_water_dark", "rope_hemp", "moss_green", "moss_dark"];
  return {
    slug: slugify("well", f.key, s.name),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${s.name}`,
    description: `${s.text}, in ${f.text}. It faces +z.`,
    tags: [style, f.key, ...s.tags],
    params: s.params(),
    materials: { ...finish(...new Set(names)), [f.roof]: LOCAL[f.roof]! },
    nodes: s.build(f),
  };
}

const ORDER: Style[] = ["roofed", "wishing", "pump", "fourpost"];

export const wellFamily: Family = {
  id: "well",
  category: "props",
  archetype: "prop.well",
  tags: ["well", "waterput", "put", "bron", "water", "bucket", "emmer", "prop"],
  assets: () => ORDER.flatMap((style) => FINISHES[style].map((f) => well(style, f))),
};
