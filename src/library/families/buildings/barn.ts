import { box, cyl, extrude, group, num, roof, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { BMATS, gableRoof, hipRoof, slab, solid, swanDownpipe, thatchHip, windowUnit } from "./shared.js";

const LOCAL: Record<string, MaterialDef> = {
  barn_red: { color: [0.2, 0.034, 0.022], metallic: 0, roughness: 0.85, texture: "wood" },
  barn_tar: { color: [0.025, 0.022, 0.02], metallic: 0, roughness: 0.8, texture: "wood" },
  barn_brown: { color: [0.12, 0.062, 0.032], metallic: 0, roughness: 0.85, texture: "wood" },
  steel_blue: { color: [0.045, 0.09, 0.17], metallic: 0.25, roughness: 0.5, texture: "painted" },
};

const STYLES = {
  gable: { text: "a timber barn with board-and-batten walls on a stone plinth, a steep gable roof with a ridge cupola and weathervane, X-braced double doors and a hayloft hatch in the +z gable", w: [8, 16, 10], l: [12, 30, 18], h: [3.5, 6, 4.5], r: [3, 6, 4] },
  gambrel: { text: "a gambrel-roofed barn with a broken two-pitch roof, a hay hood over the loft hatch, X-braced double doors and a row of windows along each side", w: [9, 16, 11], l: [12, 30, 16], h: [3, 5, 3.6], r: [4, 7, 5] },
  steel: { text: "a modern steel-framed farm shed clad in corrugated sheet, with a low-pitched roof, a big sliding door on a track, a lean-to along one side and a band of rooflights", w: [12, 30, 18], l: [18, 50, 30], h: [5, 8, 6], r: [1.5, 3.5, 2.2] },
  hip: { text: "a Dutch farm barn with low brick walls under a huge hipped roof, wide timber barn doors with a small hood and stable windows along the sides", w: [10, 20, 13], l: [14, 35, 20], h: [2.6, 4, 3], r: [5, 9, 7] },
} as const;
type Style = keyof typeof STYLES;

const FINISHES: Record<Style, { id: string; wall: string; roof: string; trim: string; door: string; text: string; nl: string }[]> = {
  gable: [
    { id: "red", wall: "barn_red", roof: "slate_grey", trim: "paint_white", door: "barn_red", text: "red", nl: "rood" },
    { id: "grey", wall: "weathered_wood", roof: "corrugated", trim: "weathered_wood", door: "weathered_wood", text: "weathered grey", nl: "verweerd" },
    { id: "tarred", wall: "barn_tar", roof: "tile_red", trim: "paint_white", door: "paint_green", text: "black tarred", nl: "zwart geteerd" },
  ],
  gambrel: [
    { id: "red", wall: "barn_red", roof: "shingle_wood", trim: "paint_white", door: "barn_red", text: "red", nl: "rood" },
    { id: "white", wall: "cladding_cream", roof: "slate_grey", trim: "paint_forest", door: "paint_forest", text: "cream", nl: "crème" },
    { id: "brown", wall: "barn_brown", roof: "corrugated_red", trim: "paint_cream", door: "barn_brown", text: "brown", nl: "bruin" },
  ],
  steel: [
    { id: "grey", wall: "corrugated", roof: "roof_steel", trim: "paint_anthracite", door: "paint_anthracite", text: "grey", nl: "grijs" },
    { id: "green", wall: "corrugated_green", roof: "roof_steel", trim: "paint_white", door: "galvanised", text: "green", nl: "groen" },
    { id: "blue", wall: "steel_blue", roof: "roof_steel", trim: "paint_white", door: "galvanised", text: "blue", nl: "blauw" },
  ],
  hip: [
    { id: "thatch", wall: "brick_red", roof: "thatch", trim: "paint_green", door: "paint_green", text: "thatched red brick", nl: "rieten dak" },
    { id: "tiled", wall: "brick_brown", roof: "tile_orange", trim: "paint_white", door: "barn_tar", text: "tiled brown brick", nl: "pannendak" },
    { id: "slate", wall: "brick_yellow", roof: "slate_blue", trim: "paint_cream", door: "barn_red", text: "slated yellow brick", nl: "leien dak" },
  ],
};

/** One leaf of a pair of barn doors, hinged on its outer edge (x = 0) and running in +x. */
function barnLeaf(f: { door: string; trim: string }): SpecNode[] {
  return [
    box("Leaf", ["$bw", "$bh", 0.08], { at: ["$bw / 2", "$bh / 2", 0.04], material: f.door, bevel: 0.01 }),
    box("Rail_{i}", ["$bw", 0.14, 0.04], { at: ["$bw / 2", "0.07 + $i * ($bh - 0.14) / 2", 0.1], repeat: { count: 3, step: [0, 0, 0] }, material: solid(f.trim, LOCAL) }),
    box("Stile_{i}", [0.14, "$bh", 0.04], { at: ["0.07 + $i * ($bw - 0.14)", "$bh / 2", 0.1], repeat: { count: 2, step: [0, 0, 0] }, material: solid(f.trim, LOCAL) }),
    box("Brace_{i}", ["hypot($bw - 0.28, $bh / 2 - 0.28)", 0.12, 0.035], { at: ["$bw / 2", "$bh / 4 + $i * ($bh / 2 - 0.07)", 0.1], rotate: [0, 0, "deg(atan(($bh / 2 - 0.28) / ($bw - 0.28)))"], repeat: { count: 2, step: [0, 0, 0] }, material: solid(f.trim, LOCAL) }),
    box("Strap_{i}", ["$bw * 0.4", 0.06, 0.02], { at: ["$bw * 0.2", "$bh * 0.2 + $i * $bh * 0.6", 0.13], repeat: { count: 2, step: [0, 0, 0] }, material: "black_steel" }),
    box("Handle", [0.04, 0.35, 0.05], { at: ["$bw - 0.25", "$bh * 0.45", 0.14], material: "black_steel", bevel: 0.01 }),
  ];
}

function barn(style: Style, f: (typeof FINISHES)[Style][number]): AssetDraft {
  const s = STYLES[style];
  const kids: SpecNode[] = [];
  const pl = style === "steel" ? 0.6 : 0.45;
  kids.push(box("Plinth", ["2 * $hw + 0.1", pl, "2 * $hl + 0.1"], { anchor: "bottom", material: style === "steel" ? "concrete" : style === "hip" ? "brick_brown" : "granite", bevel: 0.02 }));
  kids.push(box("Walls", ["2 * $hw", "$wh - 0.05", "2 * $hl"], { anchor: "bottom", at: [0, 0.05, 0], material: f.wall, bevel: 0.02 }));
  if (style === "gable" || style === "gambrel") {
    kids.push(box("BattenSide_{i}", ["2 * $hw + 0.06", "$wh - $pl", 0.06], { anchor: "bottom", at: [0, "$pl", "-$hl + 0.3"], repeat: { count: "floor((2 * $hl - 0.3) / 0.6)", step: [0, 0, 0.6] }, material: solid(f.wall, LOCAL) }));
    kids.push(box("Corner_FL", [0.14, "$wh - $pl", 0.14], { anchor: "bottom", at: ["-$hw", "$pl", "$hl"], mirror: "Corner_FR", material: solid(f.trim, LOCAL), bevel: 0.01 }));
    kids.push(box("Corner_BL", [0.14, "$wh - $pl", 0.14], { anchor: "bottom", at: ["-$hw", "$pl", "-$hl"], mirror: "Corner_BR", material: solid(f.trim, LOCAL), bevel: 0.01 }));
  }
  if (style === "steel") {
    kids.push(box("Rib_{i}", ["2 * $hw + 0.04", "$wh - $pl", 0.05], { anchor: "bottom", at: [0, "$pl", "-$hl + 0.25"], repeat: { count: "floor((2 * $hl - 0.25) / 0.5)", step: [0, 0, 0.5] }, material: f.wall }));
    kids.push(box("Column_{i}", [0.25, "$wh", 0.25], { anchor: "bottom", at: ["-$hw - 0.08", 0, "-$hl + 0.1"], repeat: { count: "floor($length / 6) + 1", step: [0, 0, "(2 * $hl - 0.2) / floor($length / 6)"] }, material: "paint_anthracite" }));
  }

  // Roof.
  if (style === "gable") {
    kids.push(gableRoof("Roof", { hw: "$hw", hd: "$hl", y: "$wh", rise: "$rise", roof: f.roof, trim: f.trim, gable: f.wall, oh: 0.5, ohg: 0.45, t: 0.22, gutter: "zinc" }));
    kids.push(group("Cupola", [
      box("Lantern", [1.4, 1.2, 1.4], { anchor: "bottom", at: [0, -0.4, 0], material: f.wall, bevel: 0.02 }),
      box("Louvre_{i}", [1.46, 0.05, 1.46], { at: [0, 0.05 + 0.13 * 0, 0], repeat: { count: 5, step: [0, 0.13, 0] }, material: f.trim }),
      roof("Cap", { x0: -0.95, x1: 0.95, z0: -0.95, z1: 0.95, y: 0.8, rise: 0.9, kind: "hip" }, { material: f.roof }),
      cyl("Vane", 0.025, 1.0, { anchor: "base", at: [0, 1.6, 0], segments: 8, material: "black_steel" }),
      box("Arrow", [0.05, 0.12, 0.9], { at: [0, 2.3, 0], material: "black_steel" }),
      box("Cross_{i}", [0.5, 0.03, 0.03], { at: [0, 2.05, 0], rotate: [0, "$i * 90", 0], repeat: { count: 2, step: [0, 0, 0] }, material: "black_steel" }),
    ], { at: [0, "$wh + $rise", "-$hl * 0.1"] }));
  } else if (style === "gambrel") {
    // Lower slopes steep (to the knee), upper slopes shallow (to the ridge).
    const knee: [string, string] = ["-$hw * 0.62", "$wh + $rise * 0.62"];
    kids.push(group("Roof", [
      slab("Lower_L", ["-$hw - 0.35", "$wh - 0.35 * $rise * 0.62 / ($hw * 0.38)"], knee, 0.18, "2 * $hl + 0.7", f.roof, { mirror: "Lower_R", ext: 0.12 }),
      slab("Upper_L", knee, [0, "$wh + $rise"], 0.18, "2 * $hl + 0.7", f.roof, { mirror: "Upper_R", ext: 0.1 }),
      cyl("RidgeRoll", 0.16, "2 * $hl + 0.76", { axis: "z", at: [0, "$wh + $rise + 0.12", 0], segments: 12, material: f.roof }),
      cyl("KneeRoll_L", 0.1, "2 * $hl + 0.74", { axis: "z", at: ["-$hw * 0.62 - 0.05", "$wh + $rise * 0.62 + 0.12", 0], mirror: "KneeRoll_R", segments: 10, material: f.trim }),
      extrude("Gable", [["-$hw", -0.03], ["$hw", -0.03], ["$hw * 0.62", "$rise * 0.62"], [0, "$rise"], ["-$hw * 0.62", "$rise * 0.62"]], "-$hl", "$hl", { at: [0, "$wh", 0], rotate: [-90, 0, 0], material: f.wall }),
      box("HayHood", [1.8, 0.12, 1.4], { at: [0, "$wh + $rise + 0.05", "$hl + 0.55"], rotate: [8, 0, 0], material: f.roof, bevel: 0.01 }),
      box("HayBeam", [0.2, 0.25, 1.6], { at: [0, "$wh + $rise * 0.86", "$hl + 0.6"], material: f.trim, bevel: 0.01 }),
    ]));
  } else if (style === "steel") {
    kids.push(gableRoof("Roof", { hw: "$hw", hd: "$hl", y: "$wh", rise: "$rise", roof: f.roof, trim: f.trim, gable: f.wall, oh: 0.3, ohg: 0.25, t: 0.12, gutter: "galvanised" }));
    kids.push(box("Rooflight_{i}", [1.2, 0.03, 2.5], { at: ["-$hw * 0.5", "$wh + $rise * 0.5 + 0.14", "-$hl + 3"], rotate: [0, 0, "deg(atan($rise / $hw))"], repeat: { count: "floor(($length - 4) / 6)", step: [0, 0, 6] }, material: "glass_frosted" }));
    kids.push(group("LeanTo", [
      box("LeanWall", [0.15, "$wh * 0.55", "2 * $hl * 0.7"], { anchor: "bottom", at: [-4, 0, 0], material: f.wall }),
      box("LeanSheet", [4.6, 0.08, "2 * $hl * 0.7 + 0.4"], { at: [-2.1, "$wh * 0.55 + $wh * 0.3 * 1.9 / 4 + 0.06", 0], rotate: [0, 0, "deg(atan(($wh * 0.85 - $wh * 0.55) / 4.2))"], material: f.roof }),
      box("LeanRib_{i}", [4.6, 0.04, 0.05], { at: ["-2.1 - 0.056 * sin(atan($wh * 0.3 / 4.2))", "$wh * 0.55 + $wh * 0.3 * 1.9 / 4 + 0.06 + 0.056 * cos(atan($wh * 0.3 / 4.2))", "-$hl * 0.7 - 0.2 + 0.165"], rotate: [0, 0, "deg(atan(($wh * 0.85 - $wh * 0.55) / 4.2))"], repeat: { count: "floor((2 * $hl * 0.7 + 0.4) / 0.33)", step: [0, 0, 0.33] }, material: f.roof }),
      box("LeanPost_{i}", [0.15, "$wh * 0.55", 0.15], { anchor: "bottom", at: [-4, 0, "-$hl * 0.7"], repeat: { count: 3, step: [0, 0, "$hl * 0.7"] }, material: "paint_anthracite" }),
    ], { at: ["-$hw", 0, 0] }));
  } else {
    kids.push(f.roof === "thatch"
      ? thatchHip("Roof", { hw: "$hw", hd: "$hl", y: "$wh", rise: "$rise", oh: 0.7, roof: f.roof })
      : hipRoof("Roof", { hw: "$hw", hd: "$hl", y: "$wh", rise: "$rise", roof: f.roof, trim: f.trim, oh: 0.6, gutter: "zinc" }));
    kids.push(box("Hood", [5.2, 0.14, 1.2], { at: [0, "$wh + 0.6", "$hl + 0.7"], rotate: [12, 0, 0], material: f.roof, bevel: 0.02 }));
  }

  // Downpipes from the eaves gutters at the four corners.
  const gut = style === "gable" ? { y: "$wh - $rise * 0.5 / $hw - 0.04", reach: -0.53, m: "zinc" }
    : style === "steel" ? { y: "$wh - $rise * 0.3 / $hw - 0.04", reach: -0.33, m: "galvanised" }
    : style === "hip" && f.roof !== "thatch" ? { y: "$wh - 0.05", reach: -0.64, m: "zinc" } : undefined;
  if (gut) {
    kids.push(group("Rainwater", [
      swanDownpipe("Downpipe_FL", "-$hw - 0.06", "$hl - 0.3", gut.y, gut.reach, gut.m, "Downpipe_FR"),
      swanDownpipe("Downpipe_BL", "-$hw - 0.06", "-$hl + 0.3", gut.y, gut.reach, gut.m, "Downpipe_BR"),
    ]));
  }
  // Doors in the +z gable end.
  if (style === "steel") {
    kids.push(group("Door", [
      box("Panel", ["$dw", "$dh", 0.1], { anchor: "bottom", at: [0, 0, 0.12], material: f.door, bevel: 0.01 }),
      box("PanelRib_{i}", [0.04, "$dh", 0.04], { anchor: "bottom", at: ["-$dw / 2 + 0.2", 0, 0.19], repeat: { count: "floor(($dw - 0.2) / 0.4)", step: [0.4, 0, 0] }, material: f.door }),
      box("Pull", [0.06, 0.6, 0.08], { at: ["$dw / 2 - 0.25", 1.2, 0.22], material: "brushed_steel" }),
    ], { at: ["-$dw / 4", "$pl", "$hl"] }));
    kids.push(box("Track", ["2 * $dw", 0.14, 0.12], { at: [0, "$pl + $dh + 0.1", "$hl + 0.1"], material: "brushed_steel" }));
  } else {
    kids.push(group("Door_L", barnLeaf(f), { at: ["-$bw", "$pl", "$hl"], mirror: "Door_R" }));
    kids.push(box("DoorHead", ["2 * $bw + 0.4", 0.25, 0.2], { at: [0, "$pl + $bh + 0.12", "$hl + 0.08"], material: solid(f.trim, LOCAL), bevel: 0.01 }));
  }
  if (style === "gable" || style === "gambrel") {
    kids.push(group("Hatch", [
      box("HatchLeaf", [1.4, 1.3, 0.08], { at: [0, 0, 0.04], material: f.door, bevel: 0.01 }),
      box("HatchFrame", [1.6, 0.12, 0.12], { at: [0, 0.71, 0.05], material: solid(f.trim, LOCAL) }),
      box("HatchSill", [1.6, 0.12, 0.12], { at: [0, -0.71, 0.05], material: solid(f.trim, LOCAL) }),
    ], { at: [0, `$wh + ${style === "gambrel" ? "$rise * 0.45" : "$rise * 0.3"}`, "$hl"] }));
  }
  // Side windows.
  const winH = style === "hip" ? 0.6 : 0.8;
  kids.push(group("SideWindows_L", [
    windowUnit("Window_{i}", { at: [0, "$wh * 0.62", "-$hl + $wsp / 2"], rotate: [0, -90, 0], w: style === "steel" ? 2.4 : 1.0, h: winH, frame: f.trim, glass: "window_glass", sill: f.trim, bars: style === "steel" ? "mullion" : "cross", repeat: { count: "$wn", step: [0, 0, "$wsp"] } }),
  ], { at: ["-$hw", 0, 0], mirror: "SideWindows_R" }));
  if (style !== "steel") kids.push(group("Lamp", [
    box("Arm", [0.05, 0.05, 0.4], { at: [0, 0, 0.2], material: "black_steel" }),
    cyl("Shade", 0.18, 0.1, { at: [0, -0.05, 0.4], segments: 12, material: "paint_forest" }),
    cyl("Bulb", 0.06, 0.08, { at: [0, -0.12, 0.4], segments: 10, material: "bulb_warm" }),
  ], { at: [0, "$pl + $bh + 0.45", "$hl"] }));

  const names = [f.wall, f.roof, f.trim, f.door, "granite", "concrete", "brick_brown", "zinc", "galvanised", "black_steel", "brushed_steel", "paint_anthracite", "paint_forest", "bulb_warm", "glass_frosted", "window_glass"];
  const materials: Record<string, MaterialDef> = {};
  for (const n of names) materials[n] = LOCAL[n] ?? BMATS[n] ?? (mats(n)[n] as MaterialDef);
  const title = { gable: "gable barn", gambrel: "gambrel barn", steel: "steel farm shed", hip: "Dutch farm barn" }[style];
  return {
    slug: slugify("barn", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${title}`,
    description: `A ${f.text} ${title}: ${s.text}. The doors face +z.`,
    tags: [style, f.id, f.nl, ...(style === "hip" ? ["boerenschuur", "schuur", "hooiberg"] : style === "steel" ? ["loods", "stal", "werktuigenloods"] : ["schuur", "hooizolder"])],
    params: [
      num("width", s.w[2], s.w[0], s.w[1], "Width along x in metres."),
      num("length", s.l[2], s.l[0], s.l[1], "Length along z in metres."),
      num("wallHeight", s.h[2], s.h[0], s.h[1], "Height of the side walls in metres."),
      num("rise", s.r[2], s.r[0], s.r[1], "Height of the ridge above the walls in metres."),
    ],
    materials,
    nodes: [group("Barn", kids, {
      vars: {
        hw: "$width / 2", hl: "$length / 2", wh: "$wallHeight", pl,
        bw: "min($width * 0.2, 2.2)", bh: "min($wallHeight * 0.85, 3.8) - 0.45",
        dw: "min($width * 0.4, 6)", dh: "$wallHeight - 1.2",
        wn: "max(1, floor(($length - 2) / 4))", wsp: "$length / max(1, floor(($length - 2) / 4))",
      },
    })],
  };
}

export const barnFamily: Family = {
  id: "barn",
  category: "buildings",
  archetype: "building.barn",
  tags: ["barn", "schuur", "farm", "boerderij", "farm building", "stal", "agricultural"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => FINISHES[style].map((f) => barn(style, f))),
};
