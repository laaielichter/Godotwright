import { box, cyl, group, int, num, slugify, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { BMATS, downpipe, flatRoof } from "./shared.js";

const STYLES = {
  slab: { text: "a long gallery-less slab block with a grid of windows, a balcony with a glass balustrade at every bay of the front, two glazed entrances under canopies and a stair housing on the flat roof", w: [24, 60, 36], d: [10, 13, 11], f: [4, 7, 5], b: [6, 14, 9] },
  tower: { text: "a square residential tower with window bands on all four sides, recessed corner balconies, a glazed entrance hall with a deep canopy and a lift and plant housing on the roof", w: [16, 24, 20], d: [14, 20, 17], f: [8, 16, 12], b: [3, 6, 5] },
  mansion: { text: "a pre-war mansion block with tall sash windows with stone lintels, string courses, a heavy cornice, a columned portal with steps and bay windows up the front", w: [18, 36, 26], d: [12, 16, 14], f: [4, 6, 5], b: [4, 8, 6] },
  gallery: { text: "a gallery block: open access walkways with railings along the front of every floor, front doors and kitchen windows off the galleries, and a glazed stair tower with the entrance at one end", w: [24, 60, 40], d: [10, 12, 11], f: [3, 8, 5], b: [6, 14, 10] },
} as const;
type Style = keyof typeof STYLES;

const FINISHES: Record<Style, { id: string; wall: string; accent: string; frame: string; text: string; nl: string }[]> = {
  slab: [
    { id: "red-brick", wall: "brick_red", accent: "concrete", frame: "aluminium", text: "red brick", nl: "rode baksteen" },
    { id: "concrete", wall: "concrete", accent: "concrete_dark", frame: "paint_anthracite", text: "concrete", nl: "beton" },
    { id: "yellow-brick", wall: "brick_yellow", accent: "concrete", frame: "paint_white", text: "yellow brick", nl: "gele baksteen" },
  ],
  tower: [
    { id: "white", wall: "render_white", accent: "paint_anthracite", frame: "paint_anthracite", text: "white", nl: "wit" },
    { id: "concrete", wall: "concrete_dark", accent: "concrete", frame: "aluminium", text: "dark concrete", nl: "donker beton" },
    { id: "brown-brick", wall: "brick_brown", accent: "concrete", frame: "aluminium", text: "brown brick", nl: "bruine baksteen" },
  ],
  mansion: [
    { id: "red-brick", wall: "brick_red", accent: "limestone", frame: "paint_white", text: "red brick", nl: "rode baksteen" },
    { id: "yellow-brick", wall: "brick_yellow", accent: "limestone", frame: "paint_white", text: "yellow stock brick", nl: "gele baksteen" },
    { id: "stucco", wall: "render_cream", accent: "paint_white", frame: "paint_black", text: "stucco", nl: "pleisterwerk" },
  ],
  gallery: [
    { id: "concrete", wall: "concrete", accent: "paint_orange", frame: "aluminium", text: "concrete and orange", nl: "beton" },
    { id: "brick", wall: "brick_brown", accent: "concrete", frame: "paint_white", text: "brown brick", nl: "bruine baksteen" },
    { id: "blue", wall: "render_blue", accent: "paint_white", frame: "paint_anthracite", text: "blue rendered", nl: "blauw" },
  ],
};

const GLASS = "window_glass";

/**
 * A flat-fronted window (no bevels, to keep the triangle count of a whole facade low): a dark reveal round the opening,
 * a frame (with a mullion), dark reflecting glass and, on the mansion blocks, a stone sill and lintel.
 */
function flatWindow(name: string, w: string, h: string, frame: string, sill: string, o: { at: Vec; repeat?: { count: string | number; step: Vec }; lintel?: string; bars?: boolean; reveal?: boolean }): SpecNode {
  // The parts of a row of windows repeat themselves (one repeat per part, no group per window): far fewer nodes.
  const rep = o.repeat;
  const kids: SpecNode[] = [];
  // The dark reveal round the opening only shows from the front, so the sides and the back leave it out.
  if (o.reveal !== false) kids.push(box("Reveal_{i}", [`${w} + 0.24`, `${h} + 0.2`, 0.02], { at: [0, 0, 0.002], repeat: rep, material: "reveal_dark" }));
  kids.push(
    box("Pane_{i}", [w, h, 0.03], { at: [0, 0, 0.012], repeat: rep, material: GLASS }),
    box("Surround_{i}", [`${w} + 0.12`, `${h} + 0.12`, 0.03], { at: [0, 0, 0.008], repeat: rep, material: frame }),
  );
  // Stone sills on the old mansion blocks; the modern frames have a flush sill (the bottom of the frame).
  if (o.lintel) kids.push(box("Sill_{i}", [`${w} + 0.2`, 0.05, 0.16], { at: [0, `-${h} / 2 - 0.06`, 0.08], repeat: rep, material: sill }));
  if (o.bars) kids.push(box("Mullion_{i}", [0.05, h, 0.05], { at: [0, 0, 0.03], repeat: rep, material: frame }));
  if (o.lintel) kids.push(box("Lintel_{i}", [`${w} + 0.3`, 0.18, 0.05], { at: [0, `${h} / 2 + 0.14`, 0.015], repeat: rep, material: o.lintel }));
  const at = o.at;
  return group(name, kids.map((k) => ({ ...k, at: [`${at[0]} + ${(k.at as Vec)[0]}`, `${at[1]} + ${(k.at as Vec)[1]}`, `${at[2]} + ${(k.at as Vec)[2]}`] as Vec })));
}

function apartment(style: Style, f: (typeof FINISHES)[Style][number]): AssetDraft {
  const s = STYLES[style];
  const kids: SpecNode[] = [];
  const H = "$floors * $st + 0.6";
  kids.push(box("Walls", ["2 * $hw", H, "2 * $hd"], { anchor: "bottom", material: f.wall, bevel: 0.03 }));
  kids.push(box("Plinth", ["2 * $hw + 0.1", 0.6, "2 * $hd + 0.1"], { anchor: "bottom", material: style === "mansion" ? "granite" : "concrete_dark", bevel: 0.02 }));
  const winW = style === "mansion" ? "min(1.3, $sp * 0.5)" : style === "tower" ? "$sp * 0.72" : "min(2.0, $sp * 0.6)";
  const winH = style === "mansion" ? "$st * 0.55" : "$st * 0.5";
  const row = (z: string, cols: string, sp: string, rot: number, at: Vec, skipGround: boolean, name: string): SpecNode =>
    group(name, [
      group("Storey{i}", [
        flatWindow("Row", winW, winH, f.frame, style === "mansion" ? f.accent : "aluminium", { at: [`-(${cols} - 1) * ${sp} / 2`, `$st * 0.55 + 0.6`, z], repeat: { count: cols, step: [sp, 0, 0] }, lintel: style === "mansion" ? f.accent : undefined, bars: style === "mansion", reveal: name === "Front" }),
      ], { at: [0, skipGround ? "$st" : 0, 0], repeat: { count: skipGround ? "$floors - 1" : "$floors", step: [0, "$st", 0] } }),
    ], { at, rotate: [0, rot, 0] });

  const windows: SpecNode[] = [];
  if (style === "tower") {
    windows.push(row("0", "$bays", "$sp", 0, [0, 0, "$hd"], true, "Front"));
    windows.push(row("0", "$bays", "$sp", 180, [0, 0, "-$hd"], false, "Back"));
    windows.push(row("0", "$sbays", "$ssp", 90, ["$hw", 0, 0], false, "Side_L"));
    windows.push(row("0", "$sbays", "$ssp", -90, ["-$hw", 0, 0], false, "Side_R"));
    kids.push(box("Band_{i}", ["2 * $hw + 0.12", 0.25, "2 * $hd + 0.12"], { at: [0, "0.6 + ($i + 1) * $st", 0], repeat: { count: "$floors - 1", step: [0, 0, 0] }, material: f.accent }));
  } else {
    windows.push(row("0", "$bays", "$sp", 0, [0, 0, "$hd"], style !== "gallery", "Front"));
    windows.push(row("0", "$bays", "$sp", 180, [0, 0, "-$hd"], false, "Back"));
    windows.push(row("0", "2", "$hd * 0.6", 90, ["$hw", 0, 0], false, "Gable_L"));
    windows.push(row("0", "2", "$hd * 0.6", -90, ["-$hw", 0, 0], false, "Gable_R"));
  }
  if (style !== "tower" && style !== "gallery") {
    // Ground floor front windows, either side of the entrance bay(s).
    windows.push(flatWindow("Ground", winW, winH, f.frame, "aluminium", { at: ["-($bays - 1) * $sp / 2", "$st * 0.55 + 0.6", "$hd"], repeat: { count: "$bays", step: ["$sp", 0, 0] }, lintel: style === "mansion" ? f.accent : undefined }));
  }
  kids.push(group("Windows", windows));

  // Roof.
  kids.push(flatRoof("Roof", { hw: "$hw", hd: "$hd", y: H, deck: "felt_black", edge: style === "mansion" ? f.accent : "aluminium", parapet: style === "mansion" ? 0.9 : 0.6 }));
  if (style === "mansion") {
    kids.push(box("Cornice", ["2 * $hw + 0.5", 0.35, "2 * $hd + 0.5"], { at: [0, `${H} - 0.2`, 0], material: f.accent, bevel: 0.04 }));
    kids.push(box("Course_{i}", ["2 * $hw + 0.1", 0.18, "2 * $hd + 0.1"], { at: [0, "0.6 + ($i + 1) * $st", 0], repeat: { count: "$floors - 1", step: [0, 0, 0] }, material: f.accent, bevel: 0.02 }));
    kids.push(group("Bays", [
      box("Bay_{i}", [2.6, `${H} - 1.2`, 0.7], { anchor: "bottom", at: ["-$hw * 0.62", 0.6, 0.3], repeat: { count: 2, step: ["$hw * 1.24", 0, 0] }, material: f.wall, bevel: 0.02 }),
      flatWindow("BayGlass", "1.6", "$st * 0.55", f.frame, f.accent, { at: ["-$hw * 0.62", "$st * 0.55 + 0.6", 0.66], repeat: { count: 2, step: ["$hw * 1.24", 0, 0] } }),
      flatWindow("BayUpper", "1.6", "$st * 0.55", f.frame, f.accent, { at: ["-$hw * 0.62", "$st * 1.55 + 0.6", 0.66], repeat: { count: 2, step: ["$hw * 1.24", 0, 0] } }),
    ], { at: [0, 0, "$hd"] }));
  }
  // Rainwater downpipes at the four corners, with brackets.
  kids.push(group("Rainwater", [
    downpipe("Downpipe_FL", "-$hw + 0.3", "$hd + 0.07", H, "zinc", "Downpipe_FR"),
    downpipe("Downpipe_BL", "-$hw + 0.3", "-$hd - 0.07", H, "zinc", "Downpipe_BR"),
  ]));
  // Brick piers between the bays give the long facades of the slab and gallery blocks a rhythm.
  if (style === "slab" || style === "gallery") {
    kids.push(box("Pier_{i}", [0.32, `${H} - 0.6`, 0.08], { anchor: "bottom", at: ["-$hw", 0.6, "$hd + 0.03"], repeat: { count: "$bays + 1", step: ["$sp", 0, 0] }, material: style === "slab" ? (f.wall === "concrete" ? "concrete_dark" : "brick_brown") : f.accent }));
  }
  // Rooftop housing: the stair and lift core.
  kids.push(group("Core", [
    box("StairHouse", [style === "tower" ? 6 : 4, 3, style === "tower" ? 5 : 4], { anchor: "bottom", at: [0, 0, 0], material: style === "mansion" ? f.wall : "concrete", bevel: 0.02 }),
    box("CoreLid", [style === "tower" ? 6.3 : 4.3, 0.2, style === "tower" ? 5.3 : 4.3], { at: [0, 3.05, 0], material: "aluminium" }),
    box("Plant_{i}", [1.4, 1.2, 1.0], { anchor: "bottom", at: [style === "tower" ? 4.5 : 3.5, 0, -1], repeat: { count: 2, step: [0, 0, 1.6] }, material: "galvanised", bevel: 0.02 }),
    cyl("Mast", 0.05, 3, { anchor: "base", at: [-1.5, 3, 1], segments: 8, material: "galvanised" }),
  ], { at: [style === "gallery" ? "-$hw * 0.4" : 0, `${H} + 0.1`, "-$hd * 0.2"] }));

  // Entrances.
  if (style === "slab") {
    kids.push(group("Entrance_{i}", [
      box("Hall", [3, "$st - 0.1", 0.3], { anchor: "bottom", at: [0, 0.05, 0.1], material: GLASS }),
      box("HallFrame", [3.2, 0.15, 0.4], { at: [0, "$st - 0.05", 0.1], material: f.frame }),
      box("Canopy", [4, 0.2, 2], { at: [0, "$st + 0.1", 1], material: f.accent, bevel: 0.02 }),
      box("Doormat", [2, 0.05, 1.4], { anchor: "bottom", at: [0, 0, 1.0], material: "concrete" }),
      box("Bell", [0.25, 0.4, 0.06], { at: [1.8, 1.4, 0.03], material: "brushed_steel" }),
    ], { at: ["-$hw * 0.5", 0, "$hd"], repeat: { count: 2, step: ["$hw", 0, 0] } }));
    kids.push(group("Balcony", [
      group("Level{i}", [
        group("Balcony_{i}", [
          box("Floor", ["$sp * 0.8", 0.2, 1.4], { at: [0, 0, 0.7], material: f.accent, bevel: 0.02 }),
          box("Balustrade", ["$sp * 0.8", 1.0, 0.03], { anchor: "bottom", at: [0, 0.1, 1.38], material: "glass_frosted" }),
          box("Side_L", [0.03, 1.0, 1.4], { anchor: "bottom", at: ["-$sp * 0.4", 0.1, 0.7], material: "glass_frosted" }),
        ], { at: ["-($bays - 1) * $sp / 2", 0, 0], repeat: { count: "$bays", step: ["$sp", 0, 0] } }),
      ], { at: [0, "0.6 + $st", 0], repeat: { count: "$floors - 1", step: [0, "$st", 0] } }),
    ], { at: [0, 0, "$hd"] }));
  } else if (style === "tower") {
    kids.push(group("Entrance", [
      box("Hall", [6, "$st * 1.3", 2], { anchor: "bottom", at: [0, 0, 0.6], material: GLASS }),
      box("HallPost_{i}", [0.15, "$st * 1.3", 0.15], { anchor: "bottom", at: [-3, 0, 1.6], repeat: { count: 5, step: [1.5, 0, 0] }, material: f.frame }),
      box("Canopy", [8, 0.35, 4], { at: [0, "$st * 1.3 + 0.17", 1.6], material: f.accent, bevel: 0.03 }),
      box("Lettering", [3, 0.25, 0.04], { at: [0, "$st * 1.3 + 0.17", 3.62], material: "brushed_steel" }),
    ], { at: [0, 0, "$hd"] }));
    kids.push(group("Balconies", [
      group("Balcony_{i}", [
        box("Slab", [3, 0.2, 3], { material: f.accent, bevel: 0.02 }),
        box("Guard_F", [3, 1.0, 0.04], { anchor: "bottom", at: [0, 0.1, 1.48], material: "glass_frosted" }),
        box("Guard_S", [0.04, 1.0, 3], { anchor: "bottom", at: [1.48, 0.1, 0], material: "glass_frosted" }),
      ], { at: ["$hw - 1.4", "0.6 + $st", "$hd - 1.4"], repeat: { count: "$floors - 1", step: [0, "$st", 0] } }),
    ]));
  } else if (style === "mansion") {
    kids.push(group("Entrance", [
      cyl("Column_L", 0.22, "$st * 1.1", { anchor: "base", at: [-1.4, 0.6, 1.2], mirror: "Column_R", segments: 16, material: f.accent, bevel: 0.02 }),
      box("Pediment", [3.6, 0.6, 1.5], { at: [0, "$st * 1.1 + 0.9", 0.75], material: f.accent, bevel: 0.03 }),
      box("Doors", [1.8, 2.6, 0.12], { anchor: "bottom", at: [0, 0.6, 0.05], material: "paint_black", bevel: 0.01 }),
      box("Fanlight", [1.8, 0.5, 0.06], { at: [0, 3.5, 0.04], material: GLASS }),
      box("Step_{i}", [3.6, 0.2, "1.6 - $i * 0.4"], { anchor: "bottom", at: [0, "$i * 0.2", "0.8 - $i * 0.2 + 0.1"], repeat: { count: 3, step: [0, 0, 0] }, material: f.accent, bevel: 0.01 }),
      cyl("Lamp_L", 0.12, 0.4, { at: [-1.4, "$st * 1.1 + 1.4", 1.2], mirror: "Lamp_R", segments: 10, material: "bulb_warm" }),
    ], { at: [0, 0, "$hd"] }));
  } else {
    kids.push(group("Galleries", [
      group("Gallery{i}", [
        box("Deck", ["2 * $hw", 0.22, 1.6], { at: [0, 0, 0.8], material: "concrete", bevel: 0.02 }),
        box("Upstand", ["2 * $hw", 0.9, 0.12], { anchor: "bottom", at: [0, 0.1, 1.55], material: f.accent, bevel: 0.01 }),
        box("Rail", ["2 * $hw", 0.06, 0.08], { at: [0, 1.05, 1.55], material: "galvanised" }),
        box("Unit_{i}", [0.95, 2.1, 0.06], { anchor: "bottom", at: ["-($bays - 1) * $sp / 2 + $sp * 0.3", 0.1, 0.02], repeat: { count: "$bays", step: ["$sp", 0, 0] }, material: f.accent }),
      ], { at: [0, "0.6 + $st", 0], repeat: { count: "$floors - 1", step: [0, "$st", 0] } }),
      box("Column_{i}", [0.3, "($floors - 1) * $st + 0.6", 0.3], { anchor: "bottom", at: ["-$hw + 0.3", 0, 1.45], repeat: { count: "floor($width / 6) + 1", step: ["(2 * $hw - 0.6) / floor($width / 6)", 0, 0] }, material: "concrete" }),
    ], { at: [0, 0, "$hd"] }));
    kids.push(group("Entrance", [
      box("StairTower", [4, `${H} + 1.2`, 4], { anchor: "bottom", material: f.wall, bevel: 0.03 }),
      box("StairGlass", [2.6, `${H} - 1`, 0.1], { anchor: "bottom", at: [0, 1.2, 2.0], material: GLASS }),
      box("Doorway", [2.2, 2.4, 0.12], { anchor: "bottom", at: [0, 0, 2.0], material: "aluminium" }),
      box("Canopy", [3.4, 0.2, 1.6], { at: [0, 2.8, 2.6], material: f.accent, bevel: 0.02 }),
    ], { at: ["$hw + 2", 0, "$hd - 1.6"] }));
  }

  const names = [f.wall, f.accent, f.frame, "concrete", "concrete_dark", "granite", "aluminium", "galvanised", "brushed_steel", "paint_black", "glass_frosted", "bulb_warm", "felt_black", "brick_brown", "zinc", GLASS];
  const materials: Record<string, MaterialDef> = {};
  for (const n of names) materials[n] = BMATS[n] ?? (mats(n)[n] as MaterialDef);
  const title = { slab: "apartment block", tower: "residential tower", mansion: "mansion block", gallery: "gallery flats" }[style];
  return {
    slug: slugify("apartment", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${title}`,
    description: `A ${f.text} ${title}: ${s.text}. The entrance faces +z.`,
    tags: [style, f.id, f.nl, ...(style === "gallery" ? ["galerijflat", "flat"] : style === "tower" ? ["woontoren", "hoogbouw", "torenflat"] : style === "mansion" ? ["herenhuis", "portiek"] : ["portiekflat", "flat"])],
    params: [
      num("width", s.w[2], s.w[0], s.w[1], "Width of the front along x, in metres."),
      num("depth", s.d[2], s.d[0], s.d[1], "Depth along z in metres."),
      int("floors", s.f[2], s.f[0], s.f[1], "Number of storeys."),
      int("bays", s.b[2], s.b[0], s.b[1], "Window bays across the front."),
      num("storey", 3, 2.8, 3.3, "Height of one storey in metres."),
    ],
    materials,
    nodes: [group("Apartment", kids, { vars: { hw: "$width / 2", hd: "$depth / 2", st: "$storey", sp: "2 * $hw / $bays", sbays: "max(2, floor($depth / 4))", ssp: "2 * $hd / max(2, floor($depth / 4))" } })],
  };
}

export const apartmentFamily: Family = {
  id: "apartment",
  category: "buildings",
  archetype: "building.apartment",
  tags: ["apartment", "flats", "flat", "appartement", "woonblok", "residential", "housing", "woningbouw"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => FINISHES[style].map((f) => apartment(style, f))),
};
