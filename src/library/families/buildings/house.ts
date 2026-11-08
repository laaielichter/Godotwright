import { box, cyl, group, int, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { bmats, chimney, flatRoof, gableRoof, hingedDoor, hipRoof, windowUnit, type WindowOpts } from "./shared.js";

/** Wall, roof, trim and door finishes; each style takes five of them. */
const FINISHES = [
  { id: "red-brick", wall: "brick_red", roof: "tile_red", trim: "paint_white", door: "paint_navy", text: "red brick", nl: "rode baksteen" },
  { id: "white-render", wall: "render_white", roof: "slate_grey", trim: "paint_anthracite", door: "paint_green", text: "white render", nl: "wit gestuct" },
  { id: "yellow-brick", wall: "brick_yellow", roof: "slate_blue", trim: "paint_cream", door: "paint_burgundy", text: "yellow brick", nl: "gele baksteen" },
  { id: "cream-render", wall: "render_cream", roof: "tile_brown", trim: "paint_white", door: "oak", text: "cream render", nl: "crème pleisterwerk" },
  { id: "brown-brick", wall: "brick_brown", roof: "tile_black", trim: "paint_white", door: "paint_black", text: "brown brick", nl: "bruine baksteen" },
  { id: "pink-render", wall: "render_pink", roof: "tile_orange", trim: "paint_white", door: "paint_teal", text: "pink render", nl: "roze gevel" },
  { id: "blue-boarded", wall: "cladding_blue", roof: "slate_grey", trim: "paint_white", door: "paint_red", text: "blue weatherboard", nl: "blauwe houten gevel" },
  { id: "black-timber", wall: "cladding_black", roof: "tile_black", trim: "paint_white", door: "light_oak", text: "black timber cladding", nl: "zwart hout" },
] as const;
type Finish = (typeof FINISHES)[number];

/** Shape styles: footprint, storeys, roof and the features that make each one read differently. */
const STYLES = {
  terraced: { floors: 2, roof: "gable-x", w: [4.8, 6.5, 5.6], d: [8, 11, 9], rise: [2, 3.2, 2.6], bays: [1, 3, 2], text: "a narrow two-storey terraced house with blank party walls, a ridge parallel to the street, a ground-floor bay window and sash windows", finishes: [0, 2, 4, 1, 5] },
  detached: { floors: 2, roof: "gable-x", w: [8, 12, 9.5], d: [7.5, 10, 8.5], rise: [2.2, 3.6, 2.8], bays: [1, 2, 1], text: "a symmetric two-storey detached house with a gable roof, an end chimney and a little gabled porch over the door", finishes: [0, 3, 1, 4, 7] },
  bungalow: { floors: 1, roof: "hip", w: [10, 15, 12], d: [8, 11, 9], rise: [1.8, 3, 2.3], bays: [1, 3, 2], text: "a wide single-storey bungalow under a low hipped roof, with broad windows and a step at the door", finishes: [3, 0, 5, 1, 2] },
  cottage: { floors: 1, roof: "gable-x", w: [7, 10, 8], d: [5.5, 7, 6], rise: [3.2, 4.5, 3.8], bays: [1, 3, 2], text: "a low cottage under a steep roof with gabled dormers, shuttered windows and a big chimney on the gable end", finishes: [1, 3, 5, 0, 6] },
  townhouse: { floors: 3, roof: "gable-z", w: [5, 7.5, 6], d: [10, 14, 12], rise: [2.5, 4, 3.2], bays: [1, 3, 2], text: "a tall, narrow three-storey townhouse with its gable to the street, tall windows, string courses and a stoop", finishes: [2, 4, 0, 1, 6] },
  modern: { floors: 2, roof: "flat", w: [9, 13, 10.5], d: [8, 11, 9], rise: [0.2, 0.6, 0.35], bays: [1, 3, 2], text: "a modern two-storey house with a flat roof and parapet, wide frameless windows, a cantilevered upper storey over the entrance and timber cladding", finishes: [1, 7, 4, 3, 2] },
  villa: { floors: 2, roof: "hip", w: [10, 14, 12], d: [9, 13, 10], rise: [2.4, 4, 3], bays: [1, 3, 2], text: "a symmetric two-storey villa under a hipped roof, with a columned portico and pediment over the front door and twin chimneys", finishes: [1, 3, 5, 2, 0] },
  farmhouse: { floors: 2, roof: "gable-x", w: [12, 17, 14], d: [7, 9, 8], rise: [2.6, 3.8, 3.2], bays: [2, 4, 3], text: "a long two-storey farmhouse with a full-width veranda on posts along the front and a chimney on the ridge", finishes: [6, 1, 3, 7, 0] },
} as const;
type Style = keyof typeof STYLES;

const GLASS = "window_glass";

function house(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const H = `${s.floors} * $storey`;
  const brick = f.wall.startsWith("brick");
  const sym = style === "detached" || style === "villa" || style === "bungalow" || style === "modern" || style === "farmhouse" || style === "cottage";
  const winBars: WindowOpts["bars"] = style === "modern" ? "none" : style === "terraced" || style === "townhouse" || style === "villa" ? "sash" : style === "cottage" ? "cross" : "mullion";
  const winW = style === "modern" ? "min(2.6, $sp * 0.7)" : style === "bungalow" ? "min(1.8, $sp * 0.6)" : "min(1.2, $sp * 0.55)";
  const winH = style === "townhouse" ? "$storey * 0.58" : style === "modern" ? "$storey * 0.6" : "$storey * 0.48";
  const win = (name: string, extra: Partial<WindowOpts>): SpecNode =>
    windowUnit(name, { w: winW, h: winH, frame: style === "modern" ? "paint_anthracite" : f.trim, glass: GLASS, sill: brick ? "limestone" : f.trim, bars: winBars, lintel: brick ? "limestone" : undefined, shutters: style === "cottage" ? f.door : undefined, ...extra });

  // Columns of windows on the front: symmetric styles have 2 * bays + 1 columns with the door in the middle one,
  // the others have bays + 1 columns with the door in the first.
  const cols = sym ? "2 * $bays + 1" : "$bays + 1";
  const doorX = sym ? "0" : "-$hw + $sp / 2";
  const firstCol = sym ? "-$bays * $sp" : "-$hw + $sp * 1.5";
  const rowY = (floor: string): string => `${floor} * $storey + $storey * 0.56`;

  const windows: SpecNode[] = [];
  // Upper floors on the front: every column.
  if (s.floors > 1) {
    windows.push(group("Upper", [
      win("Window_F{i}", { at: ["-$hw + $sp / 2", rowY("1"), "$hd"], repeat: { count: cols, step: ["$sp", 0, 0] } }),
    ], { repeat: { count: s.floors - 1, step: [0, "$storey", 0] } }));
  }
  // Ground floor on the front, around the door.
  if (style === "terraced") {
    // The ground floor has a canted bay instead of flat windows.
  } else if (sym) {
    windows.push(win("Window_G{i}", { at: [firstCol, rowY("0"), "$hd"], repeat: { count: "$bays", step: ["$sp", 0, 0] }, mirror: "Window_GR{i}" }));
  } else {
    windows.push(win("Window_G{i}", { at: [firstCol, rowY("0"), "$hd"], repeat: { count: "$bays", step: ["$sp", 0, 0] } }));
  }
  // The back: a row per storey.
  windows.push(group("Back", [
    win("Window_B{i}", { at: ["-$hw + $sp / 2", rowY("0"), 0], repeat: { count: cols, step: ["$sp", 0, 0] } }),
  ], { at: [0, 0, "-$hd"], rotate: [0, 180, 0], repeat: { count: s.floors, step: [0, "$storey", 0] } }));
  // The sides (not on a terraced house: those are party walls).
  if (style !== "terraced") {
    windows.push(group("Side_L", [
      win("Window_S{i}", { at: ["-$hd + $ssp / 2", rowY("0"), 0], w: "min(1.0, $ssp * 0.5)", repeat: { count: "$scount", step: ["$ssp", 0, 0] } }),
    ], { at: ["$hw", 0, 0], rotate: [0, 90, 0], repeat: { count: s.floors, step: [0, "$storey", 0] }, mirror: "Side_R" }));
  }

  // Door: a step up from the ground to its sill.
  const doorY = style === "townhouse" ? 0.75 : 0.18;
  const doorKind = style === "modern" ? "flush" : style === "cottage" || style === "farmhouse" ? "plank" : style === "bungalow" ? "glazed" : "panel";
  const doorZ = style === "modern" ? "$hd - 1.6" : "$hd";
  const door = hingedDoor({ x: doorX, y: doorY, z: doorZ, w: style === "villa" ? 1.15 : 0.95, h: style === "townhouse" || style === "villa" ? 2.35 : 2.1, leaf: f.door, frame: style === "modern" ? "paint_anthracite" : f.trim, metal: style === "modern" ? "brushed_steel" : "brass", glass: GLASS, kind: doorKind });
  const steps: SpecNode[] = style === "townhouse"
    ? [box("Stoop_{i}", [1.5, 0.25, "0.3 * (4 - $i)"], { at: [doorX, "0.125 + $i * 0.25", "$hd + 0.15 * (4 - $i)"], repeat: { count: 3, step: [0, 0, 0] }, material: "limestone", bevel: 0.01 }),
      box("StoopTop", [1.5, 0.75, 0.32], { anchor: "bottom", at: [doorX, 0, "$hd + 0.15"], material: "limestone", bevel: 0.01 })]
    : [box("Step", [1.4, doorY, 0.45], { anchor: "bottom", at: [doorX, 0, `${doorZ} + 0.2`], material: style === "modern" ? "concrete" : "limestone", bevel: 0.01 })];

  // Roof.
  let roofNode: SpecNode;
  const roofMat = f.roof;
  if (s.roof === "gable-x") roofNode = gableRoof("Roof", { hw: "$hd", hd: "$hw", y: H, rise: "$rise", roof: roofMat, trim: f.trim, gable: f.wall, along: "x", gutter: "zinc", oh: style === "cottage" ? 0.25 : 0.4, ohg: style === "terraced" ? 0.05 : 0.3, t: style === "cottage" && f.id === "white-render" ? 0.35 : 0.15 });
  else if (s.roof === "gable-z") roofNode = gableRoof("Roof", { hw: "$hw", hd: "$hd", y: H, rise: "$rise", roof: roofMat, trim: f.trim, gable: f.wall, gutter: "zinc", oh: 0.25, ohg: 0.3 });
  else if (s.roof === "hip") roofNode = hipRoof("Roof", { hw: "$hw", hd: "$hd", y: H, rise: "$rise", roof: roofMat, trim: f.trim, gutter: "zinc", oh: 0.5 });
  else roofNode = flatRoof("Roof", { hw: "$hw", hd: "$hd", y: H, deck: "felt_black", edge: "zinc", parapet: "$rise" });

  const extras: SpecNode[] = [];
  const top = `${H} + $rise`;
  // Chimneys.
  if (style === "terraced") extras.push(chimney(["$hw - 0.32", 0], H, `${top} + 0.7`, f.wall.startsWith("brick") ? f.wall : "brick_red", "limestone", "terracotta", 3));
  if (style === "detached" || style === "cottage") extras.push(chimney(["$hw + 0.18", 0], 0.3, `${top} + 0.5`, f.wall.startsWith("brick") ? f.wall : "brick_brown", "limestone", "terracotta", 2));
  if (style === "farmhouse") extras.push(chimney(["$hw * 0.45", 0], H, `${top} + 0.8`, "brick_red", "concrete", "terracotta", 2));
  if (style === "townhouse") extras.push(chimney(["$hw - 0.35", "-$hd * 0.4"], H, `${H} + $rise * 0.4 + 1.2`, f.wall.startsWith("brick") ? f.wall : "brick_red", "limestone", "terracotta", 2));
  if (style === "villa") {
    extras.push(group("Stacks", [
      box("Stack_L", [0.7, `$rise + 1.3`, 0.55], { anchor: "bottom", at: ["-$hw * 0.35", H, 0], mirror: "Stack_R", material: f.wall.startsWith("brick") ? f.wall : "brick_yellow", bevel: 0.01 }),
      box("StackCap_L", [0.82, 0.12, 0.66], { at: ["-$hw * 0.35", `${top} + 1.32`, 0], mirror: "StackCap_R", material: "limestone", bevel: 0.01 }),
    ]));
  }
  // Downpipes from the eaves gutters at the front corners.
  if (s.roof !== "flat") {
    const gz = s.roof === "gable-z" ? "$hd - 0.3" : `$hd + ${s.roof === "hip" ? 0.6 : style === "cottage" ? 0.34 : 0.49}`;
    const gx = s.roof === "gable-z" ? "$hw + 0.34" : "$hw - 0.25";
    const pipeZ = s.roof === "gable-z" ? "$hd - 0.3" : "$hd + 0.06";
    const pipeX = s.roof === "gable-z" ? "$hw + 0.06" : "$hw - 0.25";
    extras.push(group("Downpipe_L", [
      cyl("Pipe", 0.045, `${H} - 0.35`, { anchor: "base", at: [0, 0.08, 0], segments: 10, material: "zinc" }),
      tube("Swan", [[0, `${H} - 0.3`, 0], [`${gx} - (${pipeX})`, `${H} - 0.1`, `${gz} - (${pipeZ})`], [`${gx} - (${pipeX})`, `${H} - 0.02`, `${gz} - (${pipeZ})`]], 0.045, { segments: 10, material: "zinc" }),
      cyl("Shoe", 0.05, 0.14, { axis: "z", at: [0, 0.09, 0.05], segments: 10, material: "zinc" }),
      box("Clip_{i}", [0.12, 0.04, 0.08], { at: [0, 0.8, -0.04], repeat: { count: s.floors * 2, step: [0, `(${H} - 1.4) / ${s.floors * 2}`, 0] }, material: "zinc" }),
    ], { at: [pipeX, 0, pipeZ], mirror: "Downpipe_R" }));
  }
  // Style features.
  if (style === "terraced") {
    extras.push(group("BayWindow", [
      box("BayBase", ["$sp * 2 * 0.8", 0.75, 0.75], { anchor: "bottom", at: [0, 0, 0.36], material: f.wall, bevel: 0.01 }),
      box("BayRoof", ["$sp * 2 * 0.8 + 0.2", 0.18, 0.95], { at: [0, "$storey * 0.95", 0.42], material: "zinc", bevel: 0.02 }),
      box("BayCornice", ["$sp * 2 * 0.8 + 0.1", 0.12, 0.85], { at: [0, "$storey * 0.95 - 0.14", 0.4], material: f.trim, bevel: 0.01 }),
      windowUnit("Window_Bay", { at: [0, "($storey * 0.95 - 0.2 + 0.75) / 2", 0.73], w: "$sp * 2 * 0.8 - 0.25", h: "$storey * 0.95 - 0.95 - 0.25", frame: f.trim, glass: GLASS, sill: "limestone", bars: "cross" }),
      windowUnit("Window_BaySideR", { at: ["$sp * 0.8", "($storey * 0.95 - 0.2 + 0.75) / 2", 0.36], rotate: [0, 90, 0], w: 0.45, h: "$storey * 0.95 - 0.95 - 0.25", frame: f.trim, glass: GLASS, sill: "limestone", bars: "none" }),
      windowUnit("Window_BaySideL", { at: ["-$sp * 0.8", "($storey * 0.95 - 0.2 + 0.75) / 2", 0.36], rotate: [0, -90, 0], w: 0.45, h: "$storey * 0.95 - 0.95 - 0.25", frame: f.trim, glass: GLASS, sill: "limestone", bars: "none" }),
    ], { at: ["-$hw + $sp * 2", 0, "$hd"], vars: { sp: "$sp" } }));
    extras.push(box("Party_L", [0.3, `${H} + 0.25`, "2 * $hd + 0.05"], { anchor: "bottom", at: ["-$hw - 0.05", 0, 0], mirror: "Party_R", material: f.wall.startsWith("brick") ? f.wall : "brick_brown", bevel: 0.01 }));
  }
  if (style === "detached") {
    extras.push(group("Porch", [
      gableRoof("Canopy", { hw: 0.85, hd: 0.55, y: 2.55, rise: 0.6, roof: roofMat, trim: f.trim, gable: f.trim, at: [0, 0, 0.55], oh: 0.12, ohg: 0.08, t: 0.08 }),
      box("Bracket_L", [0.1, 0.5, 0.95], { at: [-0.8, 2.3, 0.5], mirror: "Bracket_R", material: f.trim, bevel: 0.01 }),
      box("Plaque", [0.4, 0.15, 0.03], { at: [0.72, 1.75, 0.02], material: "brass" }),
    ], { at: [0, 0, "$hd"] }));
  }
  if (style === "cottage") {
    extras.push(group("Dormers", [
      group("Dormer_{i}", [
        box("Cheeks", [1.5, 1.35, "$hd * 0.55"], { at: [0, "$top0 + 0.4", "-$hd * 0.275"], material: f.wall, bevel: 0.01 }),
        gableRoof("DormerRoof", { hw: 0.75, hd: "$hd * 0.275", y: "$top0 + 1.08", rise: 0.55, roof: roofMat, trim: f.trim, gable: f.wall, at: [0, 0, "-$hd * 0.275"], oh: 0.12, ohg: 0.12, t: 0.1 }),
        windowUnit("Window_D", { at: [0, "$top0 + 0.55", 0], w: 0.8, h: 0.75, frame: f.trim, glass: GLASS, sill: f.trim, bars: "cross" }),
      ], { at: ["-($bays - 1) * $sp", 0, "$hd - 0.3"], repeat: { count: "$bays", step: ["$sp * 2", 0, 0] } }),
    ], { vars: { top0: H } }));
    extras.push(box("Base", ["2 * $hw + 0.1", 0.5, "2 * $hd + 0.1"], { anchor: "bottom", material: "granite", bevel: 0.02 }));
  }
  if (style === "townhouse") {
    extras.push(box("Course_{i}", ["2 * $hw + 0.08", 0.14, "2 * $hd + 0.08"], { at: [0, "$storey * ($i + 1)", 0], repeat: { count: s.floors - 1, step: [0, 0, 0] }, material: "limestone", bevel: 0.01 }));
    extras.push(group("Railing", [
      cyl("Baluster_L{i}", 0.018, 0.9, { anchor: "base", at: [0.75, 0.25 + 0.0, 0.0], repeat: { count: 3, step: [0, 0.25, 0.3] }, mirror: "Baluster_R{i}", segments: 8, material: "cast_iron" }),
      tube("Handrail_L", [[0.75, 1.15, 0], [0.75, 1.65, 0.6], [0.75, 1.65, 0.85]], 0.025, { mirror: "Handrail_R", segments: 8, material: "cast_iron" }),
    ], { at: [doorX, 0, "$hd + 0.1"] }));
  }
  if (style === "modern") {
    extras.push(box("Cladding", ["2 * $hw * 0.42", `$storey * 0.95`, 0.08], { anchor: "bottom", at: ["$hw * 0.58", "$storey * 1.03", "$hd + 0.02"], material: "cladding_cream" }));
    extras.push(box("Overhang", ["2 * $hw * 0.5", 0.3, 1.8], { at: ["-$hw * 0.5", "$storey", "$hd - 0.85"], material: "render_white", bevel: 0.01 }));
    extras.push(box("Recess", ["2 * $hw * 0.5 - 0.3", "$storey - 0.15", 1.65], { anchor: "bottom", at: ["-$hw * 0.5", 0, "$hd - 0.8"], material: "cladding_black" }));
    extras.push(box("Planter", [1.2, 0.5, 0.5], { anchor: "bottom", at: ["$hw * 0.5", 0, "$hd + 0.35"], material: "concrete_dark", bevel: 0.02 }));
  }
  if (style === "villa") {
    extras.push(group("Portico", [
      cyl("Column_L", 0.16, 2.9, { anchor: "base", at: [-1.2, 0.3, 1.5], mirror: "Column_R", segments: 16, material: "limestone", bevel: 0.02 }),
      box("Pedestal_L", [0.42, 0.3, 0.42], { anchor: "bottom", at: [-1.2, 0, 1.5], mirror: "Pedestal_R", material: "limestone", bevel: 0.01 }),
      box("Entablature", [3.0, 0.35, 1.9], { at: [0, 3.35, 0.85], material: f.trim, bevel: 0.02 }),
      gableRoof("Pediment", { hw: 1.5, hd: 0.95, y: 3.52, rise: 0.75, roof: roofMat, trim: f.trim, gable: f.trim, at: [0, 0, 0.85], oh: 0.1, ohg: 0.05, t: 0.12 }),
      box("Landing", [3.2, 0.3, 2.0], { anchor: "bottom", at: [0, 0, 0.9], material: "limestone", bevel: 0.01 }),
    ], { at: [0, 0, "$hd"] }));
  }
  if (style === "farmhouse") {
    extras.push(group("Veranda", [
      box("Deck", ["2 * $hw - 0.4", 0.18, 2.2], { anchor: "bottom", at: [0, 0, 1.1], material: "weathered_wood", bevel: 0.01 }),
      box("Pillar_{i}", [0.14, 2.6, 0.14], { anchor: "bottom", at: ["-$hw + 0.4", 0.18, 2.05], repeat: { count: "$bays + 2", step: ["(2 * $hw - 0.8) / ($bays + 1)", 0, 0] }, material: f.trim, bevel: 0.01 }),
      box("Beam", ["2 * $hw - 0.3", 0.2, 0.18], { at: [0, 2.85, 2.05], material: f.trim, bevel: 0.01 }),
      box("Lean", ["2 * $hw - 0.2", 0.1, 2.55], { at: [0, 3.1, 1.15], rotate: [10, 0, 0], material: "corrugated", bevel: 0.005 }),
      box("Handrail", ["2 * $hw - 0.8", 0.06, 0.08], { at: [0, 1.05, 2.05], material: f.trim }),
    ], { at: [0, 0, "$hd"] }));
  }

  const nodes: SpecNode[] = [
    group("House", [
      box("Walls", ["2 * $hw", H, "2 * $hd"], { anchor: "bottom", material: f.wall, bevel: 0.02 }),
      box("Plinth", ["2 * $hw + 0.08", 0.45, "2 * $hd + 0.08"], { anchor: "bottom", material: style === "modern" ? "concrete_dark" : "brick_brown", bevel: 0.01 }),
      ...(s.floors > 1 && style !== "townhouse" && style !== "modern" ? [box("Band", ["2 * $hw + 0.06", 0.12, "2 * $hd + 0.06"], { at: [0, "$storey", 0], material: brick ? "limestone" : f.trim, bevel: 0.01 })] : []),
      roofNode,
      group("Windows", windows),
      ...door,
      ...steps,
      ...extras,
    ], {
      vars: {
        hw: "$width / 2",
        hd: "$depth / 2",
        sp: `$width / (${cols})`,
        scount: "max(1, floor($depth / 4))",
        ssp: "$depth / max(1, floor($depth / 4))",
      },
    }),
  ];

  const rise = s.rise;
  return {
    slug: slugify("house", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${style === "modern" ? "modern house" : style === "terraced" ? "terraced house" : style}`,
    description: `A ${f.text} ${style === "modern" || style === "terraced" ? `${style} house` : style}: ${s.text}. The front door faces +z.`,
    tags: [style, f.id.replace("-", " "), f.nl, s.roof === "hip" ? "hipped roof" : s.roof === "flat" ? "flat roof" : "gable roof", s.roof === "hip" ? "schilddak" : s.roof === "flat" ? "plat dak" : "zadeldak", ...(style === "terraced" ? ["rijtjeshuis", "row house"] : style === "detached" ? ["vrijstaand"] : style === "townhouse" ? ["herenhuis", "grachtenpand"] : style === "cottage" ? ["huisje", "dormer"] : style === "farmhouse" ? ["boerderij", "veranda"] : style === "villa" ? ["portico"] : style === "modern" ? ["modern", "nieuwbouw"] : ["gelijkvloers"])],
    params: [
      num("width", s.w[2], s.w[0], s.w[1], "Width of the walls along x, in metres."),
      num("depth", s.d[2], s.d[0], s.d[1], "Depth of the walls along z, in metres."),
      num("storey", style === "townhouse" ? 3.1 : 2.8, 2.6, style === "townhouse" ? 3.4 : 3.1, "Height of one storey in metres."),
      num("rise", rise[2], rise[0], rise[1], s.roof === "flat" ? "Height of the roof parapet in metres." : "Height of the roof ridge above the eaves, in metres."),
      int("bays", s.bays[2], s.bays[0], s.bays[1], sym ? "Window bays on each side of the front door." : "Window bays beside the door column."),
    ],
    materials: {
      ...mats(f.wall.startsWith("brick") ? f.wall : "brick_red", "brick_brown", "limestone", "granite", "terracotta", "concrete", "concrete_dark", "brass", "brushed_steel", "cast_iron", "paint_anthracite", "weathered_wood", f.trim, f.door, "brick_yellow"),
      ...bmats(GLASS, "zinc", "felt_black", "corrugated", "render_white", "cladding_black", "cladding_cream", f.roof, ...(f.wall.startsWith("brick") ? [] : [f.wall])),
    },
    nodes,
  };
}

export const houseFamily: Family = {
  id: "house",
  category: "buildings",
  archetype: "building.house",
  tags: ["house", "home", "huis", "woning", "building", "gebouw", "residential", "woonhuis"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((i) => house(style, FINISHES[i] as Finish))),
};
