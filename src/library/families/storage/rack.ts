import { box, cap, cyl, extrude, group, int, lathe, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, useMats } from "./common.js";

type Finish = { main: string; shelf: string; load: string };
interface Style {
  name: string;
  title: string;
  text: string;
  tags: string[];
  params: ParamDef[];
  finishes: Finish[];
  build: (f: Finish) => SpecNode[];
}

/** One bay of pallet racking: two braced upright frames, pairs of step beams per level, wire decks and cartons. */
function palletRack(f: Finish): SpecNode[] {
  const zig: [string, string, string][] = [];
  for (let k = 0; k <= 6; k++) zig.push(["0", `0.15 + ${k} * ($H - 0.3) / 6`, `${k % 2 === 0 ? "" : "-"}($D / 2 - 0.08)`]);
  return [
    group("PalletRack", [
      box("Upright_FL", [0.09, "$H", 0.07], { at: ["$W / 2 + 0.045", 0, "$D / 2 - 0.035"], anchor: "bottom", mirror: "Upright_FR" }),
      box("Upright_BL", [0.09, "$H", 0.07], { at: ["$W / 2 + 0.045", 0, "-$D / 2 + 0.035"], anchor: "bottom", mirror: "Upright_BR" }),
      box("Perforation_FL", [0.03, "$H - 0.2", 0.004], { at: ["$W / 2 + 0.045", "$H / 2", "$D / 2 + 0.001"], material: "hole", mirror: "Perforation_FR" }),
      box("Foot_FL", [0.14, 0.012, 0.12], { at: ["$W / 2 + 0.045", 0.006, "$D / 2 - 0.035"], material: "galvanised", mirror: "Foot_FR" }),
      box("Foot_BL", [0.14, 0.012, 0.12], { at: ["$W / 2 + 0.045", 0.006, "-$D / 2 + 0.035"], material: "galvanised", mirror: "Foot_BR" }),
      tube("Brace_L", zig, 0.018, { at: ["$W / 2 + 0.045", 0, 0], segments: 6, mirror: "Brace_R" }),
      box("Beam_F{i}", ["$W + 0.04", 0.11, 0.05], { at: [0, "($H - 0.25) / $levels", "$D / 2 - 0.035"], repeat: { count: "$levels", step: [0, "($H - 0.25) / $levels", 0] }, material: f.shelf, bevel: 0.006 }),
      box("Beam_B{i}", ["$W + 0.04", 0.11, 0.05], { at: [0, "($H - 0.25) / $levels", "-$D / 2 + 0.035"], repeat: { count: "$levels", step: [0, "($H - 0.25) / $levels", 0] }, material: f.shelf, bevel: 0.006 }),
      group("Deck_{i}", [
        box("Mesh", ["$W - 0.01", 0.02, "$D - 0.05"], { at: [0, 0.065, 0], material: "galvanised" }),
        box("Channel_{i}", [0.04, 0.04, "$D - 0.05"], { at: ["-$W / 3", 0.035, 0], repeat: { count: 3, step: ["$W / 3", 0, 0] }, material: "galvanised" }),
      ], { at: [0, "($H - 0.25) / $levels", 0], repeat: { count: "$levels - 1", step: [0, "($H - 0.25) / $levels", 0] } }),
      group("Load_{i}", [
        box("Carton_{i}", ["$W * 0.42", "min(0.6, ($H - 0.25) / $levels - 0.25)", "$D * 0.8"], { at: ["-$W * 0.23", "0.075 + min(0.6, ($H - 0.25) / $levels - 0.25) / 2", 0], repeat: { count: 2, step: ["$W * 0.46", 0, 0] }, bevel: 0.01, children: f.load === "cardboard" ? [
          box("Tape", [0.06, 0.004, "$D * 0.8 - 0.01"], { at: [0, "min(0.6, ($H - 0.25) / $levels - 0.25) / 2", 0], material: "tape" }),
          box("Label", [0.14, 0.09, 0.003], { at: ["$W * 0.1", 0, "$D * 0.4"], material: "label_white" }),
        ] : [] }),
      ], { at: [0, "($H - 0.25) / $levels", 0], repeat: { count: "$levels - 1", step: [0, "($H - 0.25) / $levels", 0] }, material: f.load }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", H: "$height" } }),
  ];
}

/** An L-section steel angle post standing at corner (sx, sz). */
function anglePost(name: string, sx: 1 | -1, sz: 1 | -1): SpecNode {
  const x = (d: number): string => `${sx} * ($W / 2 - ${d})`;
  const z = (d: number): string => `${sz} * ($D / 2 - ${d})`;
  return extrude(name, [[x(0), z(0)], [x(0.04), z(0)], [x(0.04), z(0.003)], [x(0.003), z(0.003)], [x(0.003), z(0.04)], [x(0), z(0.04)]], 0.012, "$H");
}

/** Boltless shelving: four angle posts with feet and shelves of boards on edge rails. */
function boltless(f: Finish): SpecNode[] {
  return [
    group("Shelving", [
      anglePost("Upright_FL", 1, 1),
      anglePost("Upright_FR", -1, 1),
      anglePost("Upright_BL", 1, -1),
      anglePost("Upright_BR", -1, -1),
      box("Foot_FL", [0.045, 0.014, 0.045], { at: ["$W / 2 - 0.02", 0.007, "$D / 2 - 0.02"], material: "rubber", mirror: "Foot_FR" }),
      box("Foot_BL", [0.045, 0.014, 0.045], { at: ["$W / 2 - 0.02", 0.007, "-$D / 2 + 0.02"], material: "rubber", mirror: "Foot_BR" }),
      group("Shelf_{i}", [
        box("Board", ["$W - 0.012", 0.016, "$D - 0.012"], { at: [0, 0.008, 0], material: f.shelf, bevel: 0.002 }),
        box("RailF", ["$W - 0.004", 0.04, 0.006], { at: [0, -0.012, "$D / 2 - 0.006"] }),
        box("RailB", ["$W - 0.004", 0.04, 0.006], { at: [0, -0.012, "-$D / 2 + 0.006"] }),
        box("RailL", [0.006, 0.04, "$D - 0.004"], { at: ["$W / 2 - 0.006", -0.012, 0] }),
        box("RailR", [0.006, 0.04, "$D - 0.004"], { at: ["-$W / 2 + 0.006", -0.012, 0] }),
      ], { at: [0, 0.12, 0], repeat: { count: "$shelves", step: [0, "($H - 0.16) / ($shelves - 1)", 0] } }),
      box("Bin_{i}", ["$W * 0.22", 0.16, "$D * 0.75"], { at: ["-$W * 0.3", 0.216, 0], repeat: { count: 2, step: ["$W * 0.32", 0, 0] }, material: f.load, bevel: 0.01 }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", H: "$height" } }),
  ];
}

/** A wooden wine rack: front and back uprights, bottle bars per row, a top and a plinth, filled with bottles. */
function wineRack(f: Finish): SpecNode[] {
  const bottle: [number, number][] = [[0.012, 0], [0.035, 0.004], [0.036, 0.2], [0.03, 0.235], [0.014, 0.265], [0.014, 0.295], [0.016, 0.3], [0.01, 0.31]];
  return [
    group("WineRack", [
      box("Plinth", ["$W + 0.02", 0.05, "$D"], { at: [0, 0.025, 0], bevel: 0.004 }),
      box("Upright_F{i}", [0.02, "$rows * $c + 0.03", 0.03], { at: ["-$W / 2 + 0.01", "0.05 + ($rows * $c + 0.03) / 2", "$D / 2 - 0.015"], repeat: { count: "$cols + 1", step: ["($W - 0.02) / $cols", 0, 0] }, bevel: 0.003 }),
      box("Upright_B{i}", [0.02, "$rows * $c + 0.03", 0.03], { at: ["-$W / 2 + 0.01", "0.05 + ($rows * $c + 0.03) / 2", "-$D / 2 + 0.015"], repeat: { count: "$cols + 1", step: ["($W - 0.02) / $cols", 0, 0] }, bevel: 0.003 }),
      group("Shelf_{i}", [
        box("FrontBar", ["$W", 0.018, 0.022], { at: [0, 0, "$D / 2 - 0.045"], bevel: 0.003 }),
        box("BackBar", ["$W", 0.018, 0.022], { at: [0, 0, "-$D / 2 + 0.045"], bevel: 0.003 }),
      ], { at: [0, 0.06, 0], repeat: { count: "$rows", step: [0, "$c", 0] } }),
      box("Top", ["$W + 0.02", 0.02, "$D"], { at: [0, "0.06 + $rows * $c + 0.02", 0], bevel: 0.004 }),
      group("Row_{i}", [
        lathe("Bottle_{i}", bottle, { at: ["-$W / 2 + 0.01 + ($W - 0.02) / $cols / 2", 0.045, -0.155], rotate: [90, 0, 0], repeat: { count: "$cols", step: ["($W - 0.02) / $cols", 0, 0] }, segments: 12, material: f.load }),
      ], { at: [0, 0.06, 0], repeat: { count: "$rows - 1", step: [0, "$c", 0] } }),
    ], { material: f.main, vars: { c: 0.1, W: "$cols * 0.1 + 0.02", D: "$depth" } }),
  ];
}

/** A one-sided cantilever rack: columns on base legs with tapered arms per level, braced at the back, carrying pipes. */
function cantilever(f: Finish): SpecNode[] {
  return [
    group("CantileverRack", [
      group("Upright_{i}", [
        box("Column", [0.12, "$H", 0.2], { at: [0, 0, 0], anchor: "bottom" }),
        box("Base", [0.12, 0.14, "$D"], { at: [0, 0.07, "$D / 2 - 0.1"], bevel: 0.006 }),
        box("Lip", [0.12, 0.08, 0.04], { at: [0, 0.18, "$D - 0.12"] }),
      ], { at: ["-$W / 2", 0, "-$D / 2 + 0.1"], repeat: { count: 3, step: ["$W / 2", 0, 0] } }),
      group("Level_{i}", [
        box("Beam_{i}", [0.1, 0.12, "$D - 0.15"], { at: ["-$W / 2", 0, "0.075"], repeat: { count: 3, step: ["$W / 2", 0, 0] }, material: f.shelf, bevel: 0.006, children: [box("Stop", [0.1, 0.07, 0.03], { at: [0, 0.09, "$D / 2 - 0.1"] })] }),
        cyl("Pipe_{i}", 0.05, "$W + 0.6", { axis: "x", at: [0, 0.11, "-$D / 2 + 0.35"], repeat: { count: "floor(($D - 0.45) / 0.105)", step: [0, 0, 0.105] }, segments: 14, material: f.load }),
      ], { at: [0, "$H / ($levels + 0.3)", 0], repeat: { count: "$levels", step: [0, "$H / ($levels + 0.3)", 0] } }),
      tube("Brace_L", [["-$W / 2", 0.3, "-$D / 2 + 0.05"], ["0", "$H - 0.3", "-$D / 2 + 0.05"]], 0.025, { segments: 6, mirror: "Brace_R" }),
      tube("Brace_X", [["-$W / 2", "$H - 0.3", "-$D / 2 + 0.05"], ["0", 0.3, "-$D / 2 + 0.05"]], 0.025, { segments: 6, mirror: "Brace_Y" }),
      box("Tie", ["$W", 0.08, 0.06], { at: [0, "$H - 0.1", "-$D / 2 + 0.05"] }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", H: "$height" } }),
  ];
}

const STYLES: Style[] = [
  {
    name: "pallet", title: "pallet rack", text: "one bay of pallet racking: two braced upright frames with base plates, pairs of step beams on each level, wire decks and cartons", tags: ["pallet rack", "palletstelling", "warehouse", "magazijn", "stelling"], build: palletRack,
    params: [num("width", 2.7, 1.8, 2.8, "Clear width of the bay between the frames, along x, in metres."), num("depth", 1.1, 0.8, 1.2, "Frame depth along z in metres."), num("height", 4, 2.5, 6, "Height of the frames in metres."), int("levels", 3, 2, 5, "Number of beam levels.")],
    finishes: [{ main: "paint_blue", shelf: "paint_orange", load: "cardboard" }, { main: "galvanised", shelf: "paint_yellow", load: "cardboard" }, { main: "paint_grey", shelf: "paint_red", load: "plastic_blue" }],
  },
  {
    name: "boltless", title: "boltless shelving unit", text: "a boltless shelving unit of four angle posts with rubber feet and shelves of boards on edge rails, with two bins on the bottom shelf", tags: ["shelving", "schap", "garage", "kelder", "steel shelf", "legbord"], build: boltless,
    params: [num("width", 1.2, 0.8, 1.8, "Width along x in metres."), num("depth", 0.5, 0.35, 0.6, "Depth along z in metres."), num("height", 1.8, 1.2, 2.4, "Height in metres."), int("shelves", 5, 3, 7, "Number of shelves.")],
    finishes: [{ main: "galvanised", shelf: "birch", load: "plastic_blue" }, { main: "paint_black", shelf: "paint_white", load: "plastic_grey" }, { main: "paint_grey", shelf: "pine", load: "plastic_red" }],
  },
  {
    name: "wine", title: "wine rack", text: "a wooden wine rack of front and back uprights, bottle bars on every row, a top board and a plinth, with dark bottles lying neck forward in all rows but the top", tags: ["wine rack", "wijnrek", "bottles", "flessen", "kitchen", "keuken"], build: wineRack,
    params: [int("cols", 6, 3, 7, "Number of bottle columns (0.1 m each) along x."), int("rows", 6, 3, 8, "Number of bottle rows (0.1 m each)."), num("depth", 0.3, 0.26, 0.36, "Depth along z in metres.")],
    finishes: [{ main: "pine", shelf: "pine", load: "glass_green" }, { main: "walnut", shelf: "walnut", load: "glass_dark" }, { main: "paint_black", shelf: "paint_black", load: "glass_amber" }],
  },
  {
    name: "cantilever", title: "cantilever rack", text: "a one-sided cantilever rack of three columns on base legs with tapered arms on each level, cross bracing at the back and a load of pipes", tags: ["cantilever", "uitkragend", "pipe rack", "buizenrek", "lumber", "warehouse"], build: cantilever,
    params: [num("width", 2.6, 1.6, 3.0, "Distance between the outer columns along x in metres."), num("depth", 1.0, 0.8, 1.2, "Length of the base legs along z in metres."), num("height", 3, 2.2, 4.5, "Height of the columns in metres."), int("levels", 3, 2, 4, "Number of arm levels.")],
    finishes: [{ main: "paint_yellow", shelf: "paint_yellow", load: "galvanised" }, { main: "paint_blue", shelf: "paint_blue", load: "copper" }, { main: "paint_red", shelf: "paint_anthracite", load: "steel" }],
  },
];

function rack(style: Style, f: Finish): AssetDraft {
  const fin = finishName(f.main);
  return {
    slug: slugify("rack", style.name, fin),
    title: cap(`${fin} ${style.title}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}. Its open front faces +z.`,
    tags: [...style.tags, ...finishTags(f.main)],
    params: style.params,
    materials: useMats(f.main, f.shelf, f.load, "hole", "galvanised", "rubber", "tape", "label_white"),
    nodes: style.build(f),
  };
}

export const rackFamily: Family = {
  id: "rack",
  category: "storage",
  archetype: "prop.rack",
  tags: ["rack", "shelving", "stelling", "rek", "kast", "storage", "opslag"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => rack(s, f))),
};
