import { box, cyl, ellipsoid, group, int, lathe, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { label, mats, type MaterialDef } from "../../palette.js";

/**
 * Fountains: tiered park fountains, drinking fountains, octagonal basins with arching jets, village pump troughs and
 * low plaza pools with floor jets around a sphere. Every one has a Basin with a water surface inside it and at least
 * one Spout; most have a Column. They stand on y = 0 and face +z.
 */
type Style = "tiered" | "drinking" | "octagon" | "trough" | "plaza";

interface Finish {
  key: string;
  stone: string;
  metal: string;
  text: string;
}

const FINISHES: Record<Style, [Finish, Finish]> = {
  tiered: [
    { key: "limestone", stone: "limestone", metal: "bronze", text: "limestone with a bronze spout" },
    { key: "marble", stone: "marble", metal: "brass", text: "white marble with a brass spout" },
  ],
  drinking: [
    { key: "victorian", stone: "paint_forest", metal: "brass", text: "green-painted cast iron with a brass bubbler" },
    { key: "modern", stone: "brushed_steel", metal: "chrome", text: "brushed stainless steel with a chrome bubbler" },
  ],
  octagon: [
    { key: "granite", stone: "granite", metal: "bronze", text: "granite with bronze nozzles" },
    { key: "brick", stone: "brick_yellow", metal: "brass", text: "yellow brick with a sandstone coping and brass nozzles" },
  ],
  trough: [
    { key: "sandstone", stone: "sandstone", metal: "cast_iron", text: "a sandstone trough and a black cast-iron pump" },
    { key: "granite", stone: "granite", metal: "paint_forest", text: "a granite trough and a green-painted pump" },
  ],
  plaza: [
    { key: "granite", stone: "granite", metal: "chrome", text: "a granite rim and a polished steel sphere" },
    { key: "concrete", stone: "concrete", metal: "bronze", text: "a concrete rim and a bronze sphere" },
  ],
};

const WATER: Record<string, MaterialDef> = {
  fountain_water: { color: [0.06, 0.22, 0.27, 0.72], metallic: 0, roughness: 0.04, texture: "water", alpha: "BLEND" },
  fountain_spray: { color: [0.75, 0.88, 0.95, 0.45], metallic: 0, roughness: 0.1, alpha: "BLEND" },
  basin_floor: { color: [0.12, 0.16, 0.16], metallic: 0, roughness: 0.9, texture: "concrete" },
};

/** A round (or, with 8 segments, octagonal) basin wall as a closed ring profile, with a moulded coping. */
const ringWall = (name: string, rin: Num, rout: Num, h: Num, o: { segments?: number; material?: string } = {}): SpecNode =>
  lathe(name, [
    [rin, 0], [rout, 0], [rout, `${h} - 0.07`], [`${rout} + 0.035`, `${h} - 0.05`], [`${rout} + 0.035`, h],
    [`${rin} - 0.02`, h], [`${rin} - 0.02`, `${h} - 0.04`], [rin, `${h} - 0.06`], [rin, 0],
  ], { segments: o.segments ?? 32, caps: false, ...(o.material ? { material: o.material } : {}) });

/** A dish of radius $r and depth $dd with a hollow top and water inside, its bottom at local y = 0. */
const dish = (water: boolean): SpecNode[] => [
  lathe("Dish", [[0.02, 0], ["$r * 0.3", 0], ["$r * 0.8", "$dd * 0.55"], ["$r", "$dd"], ["$r - 0.03", "$dd"], ["$r * 0.3 - 0.02", 0.04], [0.02, 0.04]], { segments: 32 }),
  ...(water ? [cyl("Water", "($r * 0.3 - 0.02) + ($r * 0.7 - 0.01) * 0.78 + 0.006", 0.012, { at: [0, "0.04 + ($dd - 0.04) * 0.78", 0], segments: 32, material: "fountain_water" })] : []),
];

function tiered(f: Finish): SpecNode[] {
  return [
    group("TieredFountain", [
      group("Basin", [
        ringWall("Wall", "$R - 0.22", "$R", 0.5, { segments: 40 }),
        cyl("Floor", "$R - 0.21", 0.06, { anchor: "base", segments: 40, material: "basin_floor" }),
        cyl("Pool", "$R - 0.215", 0.014, { at: [0, 0.4, 0], segments: 40, material: "fountain_water" }),
      ]),
      lathe("Column", [[0.02, 0.05], ["$R * 0.16", 0.05], ["$R * 0.16", 0.2], ["$R * 0.11", 0.3], ["$R * 0.08", 0.5], ["$R * 0.07", "$height * 0.45"], ["$R * 0.06", "$ytop"], ["$R * 0.04", "$ytop + 0.12"], [0.02, "$ytop + 0.12"]], { segments: 24 }),
      group("Bowl_{i}", [group("Tier", dish(true), { vars: { r: "$R * 0.55 * pow(0.62, $i)", dd: "0.12 + $R * 0.1 * pow(0.62, $i)" } })], { at: [0, "$height * 0.52 + $i * $height * 0.2", 0], repeat: { count: "$tiers", step: [0, 0, 0] } }),
      group("Finial", [
        lathe("Knop", [[0.02, 0], ["$R * 0.05", 0.02], ["$R * 0.06", 0.08], ["$R * 0.03", 0.14], [0.02, 0.16]], { segments: 16 }),
        cyl("Spout", 0.022, 0.08, { at: [0, 0.18, 0], segments: 12, material: f.metal }),
        tube("WaterJet", [[0, 0.2, 0], [0, 0.42, 0], [0, 0.5, 0]], [0.012, 0.02, 0.006], { segments: 10, material: "fountain_spray" }),
      ], { at: [0, "$ytop + 0.1", 0] }),
    ], { material: f.stone, vars: { R: "$radius", ytop: "$height * 0.52 + ($tiers - 1) * $height * 0.2" } }),
  ];
}

function drinking(f: Finish, victorian: boolean): SpecNode[] {
  const column: SpecNode = victorian
    ? lathe("Column", [[0.02, 0.06], [0.16, 0.06], [0.16, 0.12], [0.11, 0.18], [0.085, 0.3], [0.075, "$height * 0.6"], [0.1, "$height * 0.72"], [0.12, "$height - 0.12"], [0.02, "$height - 0.12"]], { segments: 20 })
    : box("Column", [0.2, "$height - 0.17", 0.22], { at: [0, 0.055, 0], anchor: "bottom", bevel: 0.015 });
  return [
    group("DrinkingFountain", [
      box("Slab", ["$width + 0.2", 0.06, "$width + 0.2"], { anchor: "bottom", bevel: 0.01, material: "concrete" }),
      box("Grate", [0.2, 0.012, 0.2], { at: [0, 0.055, "$width / 2 - 0.02"], bevel: 0.002, material: "cast_iron" }),
      column,
      group("Basin", [
        ...dish(true),
        cyl("Drain", 0.02, 0.01, { at: [0, 0.042, 0], segments: 10, material: f.metal }),
      ], { at: [0, "$height - 0.13", 0.02], vars: { r: "$width / 2", dd: 0.11 } }),
      group("Spout", [
        cyl("Riser", 0.018, 0.08, { anchor: "base", segments: 12 }),
        tube("Bubbler", [[0, 0.07, 0], [0, 0.1, 0.01], [0, 0.11, 0.04]], 0.014, { segments: 12 }),
        tube("Arc", [[0, 0.115, 0.05], [0, 0.17, 0.1], [0, 0.12, 0.16]], [0.005, 0.006, 0.004], { segments: 8, material: "fountain_spray" }),
      ], { at: [0, "$height - 0.1", -0.02], material: f.metal }),
      cyl("PushButton", 0.025, 0.03, { axis: "z", at: [0, "$height * 0.62", victorian ? 0.085 : 0.12], segments: 14, material: f.metal }),
      group("DogBowl", [
        lathe("Dish", [[0.02, 0], [0.13, 0], [0.15, 0.07], [0.13, 0.07], [0.11, 0.025], [0.02, 0.025]], { segments: 24 }),
        cyl("Water", 0.125, 0.008, { at: [0, 0.05, 0], segments: 24, material: "fountain_water" }),
      ], { at: [0, 0.058, victorian ? 0.24 : 0.25] }),
    ], { material: f.stone }),
  ];
}

function octagon(f: Finish): SpecNode[] {
  return [
    group("OctagonFountain", [
      group("Basin", [
        ringWall("Wall", "$R - 0.3", "$R", "$wallHeight", { segments: 8 }),
        lathe("Coping", [["$R - 0.34", "$wallHeight - 0.01"], ["$R + 0.05", "$wallHeight - 0.01"], ["$R + 0.05", "$wallHeight + 0.06"], ["$R - 0.34", "$wallHeight + 0.06"], ["$R - 0.34", "$wallHeight - 0.01"]], { segments: 8, caps: false, material: f.key === "brick" ? "sandstone" : f.stone }),
        cyl("Floor", "$R - 0.29", 0.06, { anchor: "base", segments: 8, material: "basin_floor" }),
        cyl("Pool", "$R - 0.295", 0.014, { at: [0, "$wallHeight - 0.12", 0], segments: 8, material: "fountain_water" }),
      ]),
      lathe("Column", [[0.02, 0.05], [0.32, 0.05], [0.32, 0.18], [0.22, 0.26], [0.17, 0.4], [0.15, "$wallHeight + 0.5"], [0.22, "$wallHeight + 0.6"], [0.22, "$wallHeight + 0.66"], [0.02, "$wallHeight + 0.66"]], { segments: 20, material: f.key === "brick" ? "sandstone" : f.stone }),
      group("Bowl", dish(true), { at: [0, "$wallHeight + 0.64", 0], vars: { r: 0.55, dd: 0.18 } }),
      cyl("Spout", 0.03, 0.2, { at: [0, "$wallHeight + 0.75", 0], segments: 12, material: f.metal }),
      group("Jet_{i}", [
        cyl("Nozzle", 0.025, 0.07, { at: [0, 0.03, 0], segments: 10, material: f.metal }),
        tube("Arc", [[0, 0.06, 0], [0, 0.35, "-($R - 0.3) * 0.3"], [0, 0.42, "-($R - 0.3) * 0.55"], [0, 0.1, "-($R - 0.3) * 0.82"]], [0.012, 0.016, 0.016, 0.01], { segments: 8, material: "fountain_spray" }),
      ], { at: [0, "$wallHeight + 0.06", "($R - 0.1) * 0.95"], repeat: { count: "$jets", around: "y", phase: 22.5 } }),
    ], { material: f.stone, vars: { R: "$radius" } }),
  ];
}

function trough(f: Finish): SpecNode[] {
  return [
    group("PumpFountain", [
      group("Basin", [
        box("Front", ["$length", 0.6, 0.1], { at: [0, 0, "$width / 2 - 0.05"], anchor: "bottom", bevel: 0.015 }),
        box("Back", ["$length", 0.6, 0.1], { at: [0, 0, "-$width / 2 + 0.05"], anchor: "bottom", bevel: 0.015 }),
        box("End_L", [0.1, 0.6, "$width - 0.16"], { at: ["$length / 2 - 0.05", 0, 0], anchor: "bottom", bevel: 0.015, mirror: "End_R" }),
        box("Bottom", ["$length - 0.16", 0.12, "$width - 0.16"], { anchor: "bottom", bevel: 0.005 }),
        box("Water", ["$length - 0.185", 0.014, "$width - 0.185"], { at: [0, 0.48, 0], material: "fountain_water" }),
      ], { material: f.stone }),
      group("Pump", [
        box("Footing", [0.34, 0.12, 0.3], { anchor: "bottom", bevel: 0.01, material: f.stone }),
        lathe("Column", [[0.02, 0.1], [0.1, 0.1], [0.1, 0.16], [0.075, 0.22], [0.065, "$height - 0.35"], [0.085, "$height - 0.3"], [0.085, "$height - 0.12"], [0.1, "$height - 0.1"], [0.03, "$height - 0.02"], [0.02, "$height - 0.02"]], { segments: 18 }),
        lathe("Cap", [[0.02, "$height - 0.04"], [0.04, "$height - 0.04"], [0.03, "$height + 0.04"], [0.02, "$height + 0.06"]], { segments: 12 }),
        tube("Spout", [[0, "$height - 0.45", 0.05], [0, "$height - 0.45", 0.22], [0, "$height - 0.5", 0.3]], [0.03, 0.025, 0.022], { segments: 12 }),
        tube("Stream", [[0, "$height - 0.52", 0.3], [0, "$height - 0.75", 0.32], [0, 0.47, 0.34]], [0.014, 0.012, 0.016], { segments: 8, material: "fountain_spray" }),
        group("Lever", [
          cyl("Pin", 0.015, 0.2, { axis: "x", segments: 10 }),
          tube("Handle", [[0, 0, 0], [0, 0.05, -0.2], [0, -0.05, -0.45]], 0.016, { segments: 10 }),
          ellipsoid("Grip", [0.025, 0.025, 0.06], { at: [0, -0.06, -0.47], segments: 12 }),
        ], { at: [0, "$height - 0.18", -0.05] }),
      ], { at: [0, 0, "-$width / 2 - 0.12"], material: f.metal }),
    ]),
  ];
}

function plaza(f: Finish): SpecNode[] {
  return [
    group("PlazaFountain", [
      group("Basin", [
        ringWall("Rim", "$R - 0.35", "$R", 0.4, { segments: 48 }),
        cyl("Floor", "$R - 0.34", 0.05, { anchor: "base", segments: 48, material: "basin_floor" }),
        cyl("Pool", "$R - 0.345", 0.014, { at: [0, 0.3, 0], segments: 48, material: "fountain_water" }),
      ]),
      lathe("Column", [[0.02, 0.04], ["$sr * 0.7", 0.04], ["$sr * 0.7", 0.36], ["$sr * 0.5", 0.42], ["$sr * 0.45", 0.48], [0.02, 0.48]], { segments: 24 }),
      ellipsoid("Sphere", ["$sr", "$sr", "$sr"], { at: [0, "0.46 + $sr * 0.96", 0], segments: 32, material: f.metal }),
      group("Spout_{i}", [
        cyl("Nozzle", 0.03, 0.28, { anchor: "base", segments: 10, material: "brushed_steel" }),
        tube("Jet", [[0, 0.3, 0], [0, 0.8, 0], [0, 1.0, 0]], [0.02, 0.025, 0.008], { segments: 8, material: "fountain_spray" }),
      ], { at: [0, 0.04, "($R - 0.35 + $sr) / 2"], repeat: { count: "$jets", around: "y" } }),
    ], { material: f.stone, vars: { R: "$radius", sr: "$sphereRadius" } }),
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
  tiered: {
    name: "tiered fountain",
    text: "A classical tiered fountain: a round basin with a moulded coping and a pool of water, a turned column carrying stacked water-filled bowls and a finial with an upward jet",
    build: tiered,
    params: () => [num("radius", 1.6, 1.1, 2.6, "Outer radius of the ground basin in metres."), num("height", 2.2, 1.6, 3.0, "Height scale of the column: the first bowl sits at about half of it, each next bowl a fifth higher."), int("tiers", 2, 1, 3, "Number of bowls stacked on the column.")],
    tags: ["tiered", "park fountain", "parkfontein", "klassiek", "bowls", "schalen"],
  },
  drinking: {
    name: "drinking fountain",
    text: "A public drinking fountain: a column with a water-filled bowl and a bubbler arcing water, a push button, a dog bowl at its foot and a drain grate on a slab",
    build: (f) => drinking(f, f.key === "victorian"),
    params: () => [num("height", 1.0, 0.85, 1.15, "Height of the bowl rim in metres."), num("width", 0.44, 0.36, 0.56, "Diameter of the bowl.")],
    tags: ["drinking fountain", "drinkfontein", "watertappunt", "kraanwater", "hond"],
  },
  octagon: {
    name: "octagonal fountain",
    text: "An octagonal basin with a coping and a pool, a central column with a bowl and spout, and nozzles on the rim arching jets towards the middle",
    build: octagon,
    params: () => [num("radius", 2.2, 1.4, 3.0, "Outer radius of the octagon in metres."), num("wallHeight", 0.55, 0.4, 0.75, "Height of the basin wall."), int("jets", 8, 4, 12, "Number of arching jets on the rim.")],
    tags: ["octagonal", "achthoekig", "jets", "stralen", "plein"],
  },
  trough: {
    name: "pump trough",
    text: "A village fountain: a long stone trough of water with a cast-iron hand pump behind it, its spout pouring a stream into the trough and a lever handle",
    build: trough,
    params: () => [num("length", 1.6, 1.0, 2.4, "Length of the trough along x, in metres."), num("width", 0.7, 0.55, 0.9, "Width of the trough along z."), num("height", 1.45, 1.2, 1.7, "Height of the pump.")],
    tags: ["trough", "drinkbak", "waterpomp", "pump", "village", "dorp"],
  },
  plaza: {
    name: "plaza fountain",
    text: "A wide, low plaza pool with a moulded rim, a large sphere on a short pedestal and a ring of vertical floor jets around it",
    build: plaza,
    params: () => [num("radius", 2.5, 1.6, 3.0, "Outer radius of the pool in metres."), num("sphereRadius", 0.55, 0.35, 0.8, "Radius of the central sphere."), int("jets", 10, 6, 16, "Number of floor jets.")],
    tags: ["plaza", "plein", "sphere", "bol", "modern", "jets"],
  },
};

function fountain(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  return {
    slug: slugify("fountain", f.key, s.name),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${s.name}`,
    description: `${s.text}, in ${f.text}. It faces +z.`,
    tags: [style, f.key, label(f.stone), "water", ...s.tags],
    params: s.params(),
    materials: { ...mats(...new Set([f.stone, f.metal, "concrete", "cast_iron", "sandstone", "brushed_steel"])), ...WATER },
    nodes: s.build(f),
  };
}

const ORDER: Style[] = ["tiered", "drinking", "octagon", "trough", "plaza"];

export const fountainFamily: Family = {
  id: "fountain",
  category: "props",
  archetype: "prop.fountain",
  tags: ["fountain", "fontein", "water", "basin", "bassin", "spout", "prop"],
  assets: () => ORDER.flatMap((style) => FINISHES[style].map((f) => fountain(style, f))),
};
