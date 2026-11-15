import { box, cyl, ellipsoid, group, num, roof, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { BMATS, solid } from "./shared.js";

const LOCAL: Record<string, MaterialDef> = {
  stripe_white: { color: [0.54, 0.53, 0.49], metallic: 0, roughness: 0.92, texture: "fabric" },
  stripe_red: { color: [0.36, 0.03, 0.028], metallic: 0, roughness: 0.92, texture: "fabric" },
  stripe_green: { color: [0.03, 0.14, 0.06], metallic: 0, roughness: 0.92, texture: "fabric" },
  stripe_blue: { color: [0.03, 0.07, 0.22], metallic: 0, roughness: 0.92, texture: "fabric" },
  stripe_yellow: { color: [0.56, 0.38, 0.03], metallic: 0, roughness: 0.92, texture: "fabric" },
  stripe_orange: { color: [0.5, 0.15, 0.02], metallic: 0, roughness: 0.92, texture: "fabric" },
  tarp_white: { color: [0.5, 0.5, 0.48], metallic: 0, roughness: 0.6, texture: "plastic" },
  tarp_blue: { color: [0.03, 0.08, 0.22], metallic: 0, roughness: 0.6, texture: "plastic" },
  tarp_green: { color: [0.03, 0.12, 0.06], metallic: 0, roughness: 0.6, texture: "plastic" },
  tarp_red: { color: [0.32, 0.03, 0.03], metallic: 0, roughness: 0.6, texture: "plastic" },
  apple_red: { color: [0.36, 0.03, 0.03], metallic: 0, roughness: 0.4 },
  orange_fruit: { color: [0.6, 0.2, 0.02], metallic: 0, roughness: 0.6 },
  lemon: { color: [0.62, 0.48, 0.04], metallic: 0, roughness: 0.55 },
  lime: { color: [0.16, 0.32, 0.04], metallic: 0, roughness: 0.55 },
  menu_board: { color: [0.025, 0.03, 0.03], metallic: 0, roughness: 0.9 },
  plywood_top: { color: [0.42, 0.31, 0.18], metallic: 0, roughness: 0.75, texture: "wood" },
};

const STYLES = {
  awning: { text: "a striped canvas market stall: four slender poles, a sloping striped awning with a scalloped valance, a trestle counter with a cloth and crates of fruit", w: [2, 4, 3], d: [1.2, 2.2, 1.6], h: [2.1, 2.6, 2.3] },
  wooden: { text: "a wooden market stall: a timber counter with a shelf below, four square posts carrying a little shingled gable roof and a hanging sign board", w: [1.8, 3.5, 2.4], d: [1.0, 1.8, 1.3], h: [2.0, 2.4, 2.2] },
  kiosk: { text: "a food kiosk: a closed cabin with a lift-up serving hatch and a stainless counter, a flat roof with a deep overhang on two front posts, a menu board and a lamp", w: [2.2, 4, 2.8], d: [1.8, 2.8, 2.2], h: [2.4, 2.9, 2.6] },
  tarp: { text: "a Dutch steel market stall: a galvanised tube frame on six legs, a tilted tarpaulin roof with a front flap and a long table with a skirt and crates", w: [3, 5.5, 4], d: [1.5, 2.4, 2], h: [2.2, 2.6, 2.4] },
} as const;
type Style = keyof typeof STYLES;

const FINISHES: Record<Style, { id: string; a: string; b: string; wood: string; produce: string; text: string; nl: string }[]> = {
  awning: [
    { id: "red", a: "stripe_red", b: "stripe_white", wood: "pine", produce: "apple_red", text: "red and white", nl: "rood-wit" },
    { id: "green", a: "stripe_green", b: "stripe_white", wood: "oak", produce: "lime", text: "green and white", nl: "groen-wit" },
    { id: "blue", a: "stripe_blue", b: "stripe_white", wood: "weathered_wood", produce: "orange_fruit", text: "blue and white", nl: "blauw-wit" },
    { id: "yellow", a: "stripe_yellow", b: "stripe_white", wood: "light_oak", produce: "lemon", text: "yellow and white", nl: "geel-wit" },
  ],
  wooden: [
    { id: "pine", a: "shingle_wood", b: "paint_cream", wood: "pine", produce: "apple_red", text: "pine", nl: "grenen" },
    { id: "dark", a: "slate_grey", b: "paint_white", wood: "dark_stain", produce: "orange_fruit", text: "dark-stained", nl: "donker hout" },
    { id: "green", a: "shingle_green", b: "paint_forest", wood: "weathered_wood", produce: "lime", text: "weathered", nl: "verweerd" },
    { id: "red", a: "tile_red", b: "paint_red", wood: "light_oak", produce: "lemon", text: "red-roofed", nl: "rood dak" },
  ],
  kiosk: [
    { id: "white", a: "paint_white", b: "stripe_red", wood: "brushed_steel", produce: "apple_red", text: "white", nl: "wit" },
    { id: "teal", a: "paint_teal", b: "stripe_white", wood: "brushed_steel", produce: "lemon", text: "teal", nl: "petrol" },
    { id: "black", a: "paint_black", b: "stripe_yellow", wood: "light_oak", produce: "orange_fruit", text: "black", nl: "zwart" },
    { id: "wood", a: "oak", b: "stripe_green", wood: "brushed_steel", produce: "lime", text: "timber-clad", nl: "hout" },
  ],
  tarp: [
    { id: "white", a: "tarp_white", b: "stripe_white", wood: "plastic_white", produce: "apple_red", text: "white tarpaulin", nl: "wit zeil" },
    { id: "blue", a: "tarp_blue", b: "stripe_white", wood: "plastic_blue", produce: "orange_fruit", text: "blue tarpaulin", nl: "blauw zeil" },
    { id: "green", a: "tarp_green", b: "stripe_white", wood: "plastic_green", produce: "lime", text: "green tarpaulin", nl: "groen zeil" },
    { id: "red", a: "tarp_red", b: "stripe_white", wood: "plastic_red", produce: "lemon", text: "red tarpaulin", nl: "rood zeil" },
  ],
};

/** A crate of fruit sitting on y = 0 of its node. */
function crate(name: string, wood: string, fruit: string, o: { at: [string | number, string | number, string | number]; repeat?: { count: string | number; step: [string | number, string | number, string | number] } }): SpecNode {
  return group(name, [
    box("Box", [0.5, 0.18, 0.36], { anchor: "bottom", material: wood, bevel: 0.006 }),
    group("Fruit_{i}", [
      ellipsoid("Piece_{i}", [0.045, 0.042, 0.045], { at: [-0.18, 0, 0], repeat: { count: 5, step: [0.09, 0, 0] }, segments: 8, material: fruit }),
    ], { at: [0, 0.2, -0.12], repeat: { count: 3, step: [0, 0, 0.12] } }),
  ], { at: o.at, repeat: o.repeat });
}

function stall(style: Style, f: (typeof FINISHES)[Style][number]): AssetDraft {
  const s = STYLES[style];
  const kids: SpecNode[] = [];
  if (style === "awning") {
    kids.push(
      cyl("Post_{i}", 0.025, "$h", { anchor: "base", at: ["-$hw", 0, "-$hd"], repeat: { count: 2, step: ["2 * $hw", 0, 0] }, segments: 10, material: "black_steel" }),
      cyl("PostFront_{i}", 0.025, "$h - 0.2", { anchor: "base", at: ["-$hw", 0, "$hd"], repeat: { count: 2, step: ["2 * $hw", 0, 0] }, segments: 10, material: "black_steel" }),
      group("Awning", [
        box("StripeA_{i}", ["$sw", 0.02, "hypot(2 * $hd + 0.5, 0.25)"], { at: ["-$hw - 0.15 + $sw / 2", 0, 0], repeat: { count: "$ns", step: ["2 * $sw", 0, 0] }, material: f.a }),
        box("StripeB_{i}", ["$sw", 0.02, "hypot(2 * $hd + 0.5, 0.25)"], { at: ["-$hw - 0.15 + 1.5 * $sw", 0, 0], repeat: { count: "$ns", step: ["2 * $sw", 0, 0] }, material: f.b }),
        box("Valance", ["2 * $hw + 0.3", 0.22, 0.015], { at: [0, -0.11, "hypot(2 * $hd + 0.5, 0.25) / 2"], material: f.a }),
        cyl("Scallop_{i}", 0.08, 0.016, { axis: "z", at: ["-$hw - 0.07", -0.22, "hypot(2 * $hd + 0.5, 0.25) / 2"], repeat: { count: "floor((2 * $hw + 0.14) / 0.16)", step: [0.16, 0, 0] }, segments: 10, material: f.b }),
      ], { at: [0, "$h - 0.12", 0.25], rotate: ["deg(atan(0.25 / (2 * $hd + 0.5)))", 0, 0] }),
      box("Counter", ["2 * $hw - 0.1", 0.04, "$hd"], { at: [0, 0.82, "$hd * 0.45"], material: f.wood, bevel: 0.005 }),
      box("Cloth", ["2 * $hw - 0.08", 0.4, 0.01], { at: [0, 0.64, "$hd * 0.95 + 0.01"], material: f.b }),
      box("Trestle_L", [0.04, 0.8, "$hd * 0.8"], { anchor: "bottom", at: ["-$hw + 0.25", 0, "$hd * 0.45"], mirror: "Trestle_R", material: solid(f.wood, LOCAL) }),
      crate("Crate_{i}", f.wood, f.produce, { at: ["-$hw + 0.4", 0.84, "$hd * 0.45"], repeat: { count: "floor((2 * $hw - 0.4) / 0.6)", step: [0.6, 0, 0] } }),
    );
  } else if (style === "wooden") {
    kids.push(
      box("Post_{i}", [0.09, "$h", 0.09], { anchor: "bottom", at: ["-$hw", 0, "-$hd"], repeat: { count: 2, step: ["2 * $hw", 0, 0] }, material: solid(f.wood, LOCAL), bevel: 0.006 }),
      box("PostFront_{i}", [0.09, "$h", 0.09], { anchor: "bottom", at: ["-$hw", 0, "$hd"], repeat: { count: 2, step: ["2 * $hw", 0, 0] }, material: solid(f.wood, LOCAL), bevel: 0.006 }),
      box("Counter", ["2 * $hw + 0.1", 0.05, "$hd + 0.2"], { at: [0, 0.9, "$hd * 0.5"], material: f.wood, bevel: 0.008 }),
      box("CounterFront", ["2 * $hw", 0.85, 0.03], { anchor: "bottom", at: [0, 0, "$hd + 0.05"], material: f.wood }),
      box("Plank_{i}", [0.02, 0.85, 0.02], { anchor: "bottom", at: ["-$hw + 0.15", 0, "$hd + 0.07"], repeat: { count: "floor((2 * $hw - 0.1) / 0.15)", step: [0.15, 0, 0] }, material: solid(f.wood, LOCAL) }),
      box("Shelf", ["2 * $hw", 0.03, "2 * $hd"], { at: [0, 0.3, 0], material: f.wood }),
      box("Lintel", ["2 * $hw + 0.1", 0.12, 0.1], { at: [0, "$h - 0.06", "$hd"], material: solid(f.wood, LOCAL) }),
      box("LintelBack", ["2 * $hw + 0.1", 0.12, 0.1], { at: [0, "$h - 0.06", "-$hd"], material: solid(f.wood, LOCAL) }),
      roof("Roof", { x0: "-$hw - 0.25", x1: "$hw + 0.25", z0: "-$hd - 0.25", z1: "$hd + 0.25", y: "$h", rise: "$hd * 0.7", kind: "gable" }, { material: f.a }),
      group("Sign", [
        box("Board", ["$hw", 0.3, 0.03], { at: [0, -0.35, 0], material: f.b, bevel: 0.006 }),
        cyl("Chain_L", 0.008, 0.2, { at: ["-$hw * 0.4", -0.12, 0], mirror: "Chain_R", segments: 6, material: "black_steel" }),
      ], { at: [0, "$h - 0.02", "$hd + 0.06"] }),
      crate("Crate_{i}", f.wood, f.produce, { at: ["-$hw + 0.35", 0.925, "$hd * 0.5"], repeat: { count: "floor((2 * $hw - 0.3) / 0.6)", step: [0.6, 0, 0] } }),
    );
  } else if (style === "kiosk") {
    kids.push(
      box("Cabin", ["2 * $hw", "$h - 0.1", "2 * $hd - 0.8"], { anchor: "bottom", at: [0, 0, -0.4], material: f.a, bevel: 0.02 }),
      box("Counter", ["2 * $hw * 0.8", 0.05, 0.5], { at: [0, 1.0, "$hd - 0.6"], material: f.wood, bevel: 0.006 }),
      box("Hatch", ["2 * $hw * 0.8", 0.9, 0.05], { at: [0, "1.15 + 0.45 + 0.75", "$hd - 0.55"], rotate: [-70, 0, 0], material: f.a, bevel: 0.01 }),
      box("Opening", ["2 * $hw * 0.8", 1.0, 0.02], { at: [0, 1.55, "$hd - 0.8"], material: "menu_board" }),
      box("Strut_L", [0.03, 0.03, 0.6], { at: ["-$hw * 0.7", 1.9, "$hd - 0.55"], rotate: [-30, 0, 0], mirror: "Strut_R", material: "brushed_steel" }),
      box("Post_{i}", [0.08, "$h - 0.1", 0.08], { anchor: "bottom", at: ["-$hw + 0.05", 0, "$hd - 0.05"], repeat: { count: 2, step: ["2 * $hw - 0.1", 0, 0] }, material: "brushed_steel" }),
      box("Roof", ["2 * $hw + 0.3", 0.16, "2 * $hd + 0.2"], { at: [0, "$h - 0.02", 0.05], material: f.a, bevel: 0.02 }),
      box("Valance", ["2 * $hw + 0.32", 0.25, 0.02], { at: [0, "$h - 0.18", "$hd + 0.16"], material: f.b }),
      box("Menu", [0.7, 0.9, 0.04], { at: ["$hw + 0.02", 1.6, 0], rotate: [0, 90, 0], material: "menu_board", bevel: 0.006 }),
      group("Lamp", [
        cyl("Shade", 0.12, 0.08, { segments: 12, material: "black_steel" }),
        cyl("Bulb", 0.05, 0.06, { at: [0, -0.06, 0], segments: 10, material: "bulb_warm" }),
        cyl("Flex", 0.008, 0.25, { at: [0, 0.16, 0], segments: 6, material: "black_steel" }),
      ], { at: [0, "$h - 0.37", "$hd - 0.25"] }),
      crate("Crate_{i}", "light_oak", f.produce, { at: ["-$hw * 0.6", 1.025, "$hd - 0.6"], repeat: { count: 2, step: ["$hw * 1.2 - 0.5", 0, 0] } }),
      box("Step", ["2 * $hw - 0.4", 0.12, 0.4], { anchor: "bottom", at: [0, 0, "-$hd - 0.15"], material: "concrete" }),
    );
  } else {
    kids.push(
      group("Legs", [
        cyl("Post_{i}", 0.024, "$h", { anchor: "base", at: ["-$hw", 0, "-$hd"], repeat: { count: 3, step: ["$hw", 0, 0] }, segments: 10, material: "galvanised" }),
        cyl("PostFront_{i}", 0.024, "$h + 0.3", { anchor: "base", at: ["-$hw", 0, "$hd"], repeat: { count: 3, step: ["$hw", 0, 0] }, segments: 10, material: "galvanised" }),
        cyl("Brace_L", 0.02, "2 * $hd", { axis: "z", at: ["-$hw", 0.25, 0], mirror: "Brace_R", segments: 8, material: "galvanised" }),
        cyl("Brace_M", 0.02, "2 * $hd", { axis: "z", at: [0, 0.25, 0], segments: 8, material: "galvanised" }),
      ]),
      group("Canopy", [
        box("Sheet", ["2 * $hw + 0.4", 0.02, "hypot(2 * $hd + 0.6, 0.3)"], { material: f.a }),
        box("Flap", ["2 * $hw + 0.4", 0.35, 0.02], { at: [0, -0.17, "hypot(2 * $hd + 0.6, 0.3) / 2"], material: f.a }),
        cyl("Rail_{i}", 0.02, "2 * $hw", { axis: "x", at: [0, -0.03, "-hypot(2 * $hd + 0.6, 0.3) / 2 + 0.3"], repeat: { count: 3, step: [0, 0, "hypot(2 * $hd + 0.6, 0.3) / 2 - 0.3"] }, segments: 8, material: "galvanised" }),
      ], { at: [0, "$h + 0.14", 0.05], rotate: ["-deg(atan(0.3 / (2 * $hd + 0.6)))", 0, 0] }),
      box("Table", ["2 * $hw - 0.1", 0.04, "$hd * 1.1"], { at: [0, 0.82, "$hd * 0.4"], material: "plywood_top" }),
      box("Skirt", ["2 * $hw - 0.1", 0.75, 0.01], { anchor: "bottom", at: [0, 0.05, "$hd * 0.95 + 0.01"], material: f.a }),
      box("TableLeg_{i}", [0.04, 0.8, "$hd"], { anchor: "bottom", at: ["-$hw + 0.3", 0, "$hd * 0.4"], repeat: { count: 2, step: ["2 * $hw - 0.6", 0, 0] }, material: "galvanised" }),
      crate("Crate_{i}", f.wood, f.produce, { at: ["-$hw + 0.4", 0.84, "$hd * 0.4"], repeat: { count: "floor((2 * $hw - 0.4) / 0.6)", step: [0.6, 0, 0] } }),
    );
  }
  const names = [f.a, f.b, f.wood, f.produce, "black_steel", "brushed_steel", "galvanised", "menu_board", "bulb_warm", "light_oak", "concrete", "plywood_top"];
  const materials: Record<string, MaterialDef> = {};
  for (const n of names) materials[n] = LOCAL[n] ?? BMATS[n] ?? (mats(n)[n] as MaterialDef);
  const title = { awning: "striped market stall", wooden: "wooden market stall", kiosk: "food kiosk", tarp: "steel market stall" }[style];
  return {
    slug: slugify("market-stall", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${title}`,
    description: `A ${f.text} ${title}: ${s.text}. The serving side faces +z.`,
    tags: [style, f.id, f.nl, ...(style === "kiosk" ? ["kiosk", "snackkraam", "foodtruck"] : ["marktkraam", "groente", "fruit", "markt"])],
    params: [
      num("width", s.w[2], s.w[0], s.w[1], "Width of the stall along x in metres."),
      num("depth", s.d[2], s.d[0], s.d[1], "Depth along z in metres."),
      num("height", s.h[2], s.h[0], s.h[1], "Height of the roof or awning edge in metres."),
    ],
    materials,
    nodes: [group("MarketStall", kids, { vars: { hw: "$width / 2", hd: "$depth / 2", h: "$height", ns: "ceil((2 * $hw + 0.3) / 0.5)", sw: "(2 * $hw + 0.3) / (2 * $ns)" } })],
  };
}

export const marketStallFamily: Family = {
  id: "market-stall",
  category: "buildings",
  archetype: "prop.market-stall",
  tags: ["market stall", "marktkraam", "kraam", "stall", "market", "markt", "booth"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => FINISHES[style].map((f) => stall(style, f))),
};
