import { box, cyl, extrude, group, lathe, num, roof, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { BMATS, gableRoof, slab, swanDownpipe } from "./shared.js";

const LOCAL: Record<string, MaterialDef> = {
  // Grey volcanic tuff blocks, as on Rhineland and Dutch Romanesque churches.
  tuff: { color: [0.115, 0.11, 0.098], metallic: 0, roughness: 0.92, texture: "stone" },
  stained_glass: { color: [0.035, 0.032, 0.055], metallic: 0.3, roughness: 0.08, emissive: [0.018, 0.012, 0.03] },
  clock_face: { color: [0.6, 0.58, 0.52], metallic: 0, roughness: 0.4, texture: "painted" },
  bell_bronze: { color: [0.55, 0.36, 0.17], metallic: 1, roughness: 0.35 },
};

const STYLES = {
  steeple: { text: "a Gothic parish church: a buttressed nave with tall pointed windows under a steep roof, and a west tower at the front with a clock, louvred belfry openings, corner pinnacles and a tall broach spire", l: [22, 40, 28], w: [9, 14, 11], h: [7, 11, 8.5], s: [14, 30, 20] },
  chapel: { text: "a small chapel: a plain nave with round-headed windows, a bellcote with a bell on the front gable, a gabled entrance porch and a cross on the ridge", l: [20, 28, 22], w: [8, 11, 9], h: [5, 7, 5.8], s: [2.5, 4, 3] },
  basilica: { text: "a Romanesque basilica: a tall nave with clerestory windows over lower lean-to aisles, a round apse at the east end, a rose window over the arched portal and a square crossing tower with a pyramid roof", l: [30, 60, 42], w: [10, 16, 13], h: [10, 16, 13], s: [8, 16, 11] },
  modern: { text: "a modern church: a steep A-frame roof falling almost to the ground, a glazed front gable with a tall cross, low side walls and a free-standing slender concrete bell tower beside the entrance", l: [20, 40, 26], w: [12, 20, 15], h: [1.2, 2.5, 1.8], s: [15, 30, 22] },
} as const;
type Style = keyof typeof STYLES;

const FINISHES: Record<Style, { id: string; wall: string; dress: string; roof: string; spire: string; text: string; nl: string }[]> = {
  steeple: [
    { id: "limestone", wall: "limestone", dress: "sandstone", roof: "slate_grey", spire: "slate_blue", text: "limestone", nl: "kalksteen" },
    { id: "brick", wall: "brick_red", dress: "limestone", roof: "tile_red", spire: "aged_copper", text: "red brick", nl: "baksteen" },
  ],
  chapel: [
    { id: "white", wall: "render_white", dress: "granite", roof: "slate_grey", spire: "slate_grey", text: "whitewashed", nl: "witte kapel" },
    { id: "stone", wall: "granite", dress: "limestone", roof: "tile_brown", spire: "tile_brown", text: "granite", nl: "graniet" },
  ],
  basilica: [
    { id: "sandstone", wall: "sandstone", dress: "limestone", roof: "tile_orange", spire: "tile_orange", text: "sandstone", nl: "zandsteen" },
    { id: "tuff", wall: "tuff", dress: "basalt", roof: "slate_blue", spire: "aged_copper", text: "grey tuff", nl: "tufsteen" },
  ],
  modern: [
    { id: "concrete", wall: "concrete", dress: "brushed_steel", roof: "zinc_quartz", spire: "concrete", text: "concrete and zinc", nl: "beton" },
    { id: "brick", wall: "brick_brown", dress: "aged_copper", roof: "aged_copper", spire: "brick_brown", text: "brick and copper", nl: "baksteen en koper" },
  ],
};

const GLASS = "stained_glass";

/** A tall pointed (or round) window on a wall surface facing +z: glass, a pointed head, a stone surround and a sill. */
function lancet(name: string, w: string, h: string, dress: string, round: boolean, o: { at: [string | number, string | number, string | number]; rotate?: [number, number, number]; repeat?: { count: string; step: [number | string, number | string, number | string] }; mirror?: string }): SpecNode {
  return group(name, [
    box("Surround", [`${w} + 0.3`, h, 0.1], { anchor: "bottom", at: [0, 0, 0.02], material: dress }),
    box("Glass", [w, `${h} - 0.1`, 0.1], { anchor: "bottom", at: [0, 0.05, 0.05], material: GLASS }),
    box("Bar", [0.05, `${h} - 0.1`, 0.1], { anchor: "bottom", at: [0, 0.05, 0.08], material: "black_steel" }),
    round
      ? cyl("Head", `${w} / 2 + 0.15`, 0.12, { axis: "z", at: [0, h, 0.03], segments: 16, material: dress })
      : box("Head", [`(${w} + 0.3) * 0.72`, `(${w} + 0.3) * 0.72`, 0.12], { at: [0, h, 0.03], rotate: [0, 0, 45], material: dress }),
    box("Sill", [`${w} + 0.45`, 0.12, 0.25], { at: [0, -0.05, 0.1], material: dress }),
  ], { at: o.at, rotate: o.rotate, repeat: o.repeat, mirror: o.mirror });
}

function church(style: Style, f: (typeof FINISHES)[Style][number]): AssetDraft {
  const s = STYLES[style];
  const kids: SpecNode[] = [];
  const nave: SpecNode[] = [];
  if (style !== "modern") {
    nave.push(box("Walls", ["2 * $hw", "$wh", "2 * $hl"], { anchor: "bottom", material: f.wall, bevel: 0.03 }));
    nave.push(box("Plinth", ["2 * $hw + 0.3", 0.6, "2 * $hl + 0.3"], { anchor: "bottom", material: f.dress, bevel: 0.02 }));
    nave.push(box("Cornice", ["2 * $hw + 0.25", 0.25, "2 * $hl + 0.1"], { at: [0, "$wh - 0.12", 0], material: f.dress, bevel: 0.02 }));
  }
  const winCount = "floor(2 * $hl / 4.5)";
  const winSp = `2 * $hl / ${winCount}`;
  if (style === "steeple") {
    nave.push(box("Buttress_L{i}", [0.7, "$wh * 0.85", 0.6], { anchor: "bottom", at: ["-$hw - 0.3", 0, `-$hl + ${winSp}`], repeat: { count: `${winCount} - 1`, step: [0, 0, winSp] }, mirror: "Buttress_R{i}", material: f.wall, bevel: 0.03 }));
    nave.push(box("Weathering_L{i}", [0.75, 0.3, 0.65], { at: ["-$hw - 0.3", "$wh * 0.85", `-$hl + ${winSp}`], rotate: [0, 0, -30], repeat: { count: `${winCount} - 1`, step: [0, 0, winSp] }, mirror: "Weathering_R{i}", material: f.dress }));
  }
  if (style === "steeple" || style === "chapel") {
    nave.push(lancet("Window_L{i}", style === "chapel" ? "0.9" : "1.2", "$wh * 0.55", f.dress, style === "chapel", { at: ["-$hw", "$wh * 0.22", `-$hl + ${winSp} / 2`], rotate: [0, -90, 0], repeat: { count: winCount, step: [0, 0, winSp] }, mirror: "Window_R{i}" }));
    nave.push(gableRoof("Roof", { hw: "$hw", hd: "$hl", y: "$wh", rise: "$hw * 1.1", roof: f.roof, trim: f.dress, gable: f.wall, oh: 0.4, ohg: 0.3, t: 0.2, gutter: "zinc" }));
    nave.push(group("Rainwater", [
      swanDownpipe("Downpipe_FL", "-$hw - 0.06", "$hl - 0.3", "$wh - 0.48", -0.43, "zinc", "Downpipe_FR"),
      swanDownpipe("Downpipe_BL", "-$hw - 0.06", "-$hl + 0.3", "$wh - 0.48", -0.43, "zinc", "Downpipe_BR"),
    ]));
    nave.push(lancet("EastWindow", "2.2", "$wh * 0.7", f.dress, style === "chapel", { at: [0, "$wh * 0.2", "-$hl"], rotate: [0, 180, 0] }));
  }
  if (style === "basilica") {
    nave.push(lancet("Clerestory_L{i}", "1.0", "$wh * 0.18", f.dress, true, { at: ["-$hw", "$wh * 0.68", `-$hl + ${winSp} / 2`], rotate: [0, -90, 0], repeat: { count: winCount, step: [0, 0, winSp] }, mirror: "Clerestory_R{i}" }));
    nave.push(gableRoof("Roof", { hw: "$hw", hd: "$hl", y: "$wh", rise: "$hw * 0.55", roof: f.roof, trim: f.dress, gable: f.wall, oh: 0.3, ohg: 0.2, t: 0.22 }));
    nave.push(group("Aisle_L", [
      box("AisleWall", ["$hw * 0.6", "$wh * 0.5", "2 * $hl - 1"], { anchor: "bottom", at: ["-$hw * 0.3 + 0.1", 0, 0], material: f.wall, bevel: 0.03 }),
      slab("AisleRoof", ["-$hw * 0.6 - 0.35", "$wh * 0.5 - 0.1"], [0.05, "$wh * 0.62"], 0.18, "2 * $hl - 0.6", f.roof, { ext: 0.05 }),
      lancet("Window_{i}", "0.9", "$wh * 0.22", f.dress, true, { at: ["-$hw * 0.6 + 0.1", "$wh * 0.14", `-$hl + 0.5 + ${winSp} / 2`], rotate: [0, -90, 0], repeat: { count: winCount, step: [0, 0, `(2 * $hl - 1) / ${winCount}`] } }),
    ], { at: ["-$hw", 0, 0], mirror: "Aisle_R" }));
    nave.push(group("Apse", [
      lathe("Drum", [["$hw * 0.75", 0], ["$hw * 0.75", "$wh * 0.6"]], { segments: 24, material: f.wall }),
      lathe("ApseRoof", [["$hw * 0.85", "$wh * 0.6 - 0.05"], ["$hw * 0.85", "$wh * 0.6 + 0.12"], [0.05, "$wh * 0.6 + $hw * 0.5"], [0.04, "$wh * 0.6 + $hw * 0.5 + 0.05"]], { segments: 24, material: f.roof }),
      box("Pilaster_{i}", [0.4, "$wh * 0.6", 0.25], { anchor: "bottom", at: [0, 0, "$hw * 0.75"], repeat: { count: 8, around: "y", phase: 22.5 }, material: f.dress }),
    ], { at: [0, 0, "-$hl"] }));
    nave.push(group("RoseWindow", [
      cyl("Rose", "$hw * 0.3", 0.15, { axis: "z", at: [0, 0, 0.05], segments: 24, material: GLASS }),
      lathe("Tracery", [["$hw * 0.3", -0.1], ["$hw * 0.36", -0.1], ["$hw * 0.36", 0.15], ["$hw * 0.3", 0.15]], { segments: 24, rotate: [90, 0, 0], material: f.dress }),
      box("Spoke_{i}", ["$hw * 0.6", 0.06, 0.05], { at: [0, 0, 0.14], rotate: [0, 0, "$i * 30"], repeat: { count: 6, step: [0, 0, 0] }, material: f.dress }),
    ], { at: [0, "$wh * 0.72", "$hl"] }));
  }
  if (style === "modern") {
    const ridge = "$wh + $hw * 2.2";
    nave.push(box("Walls", ["2 * $hw - 0.6", "$wh", "2 * $hl"], { anchor: "bottom", material: f.wall, bevel: 0.03 }));
    nave.push(extrude("Gable", [["-$hw + 0.3", 0], ["$hw - 0.3", 0], [0, ridge]], "$hl - 0.6", "$hl - 0.3", { rotate: [-90, 0, 0], material: f.wall }));
    nave.push(extrude("GlassFront", [["-$hw + 0.5", 0], ["$hw - 0.5", 0], [0, `${ridge} - 0.6`]], "-$hl + 0.2", "-$hl + 0.35", { rotate: [-90, 0, 0], material: "window_glass" }));
    nave.push(box("Mullion_{i}", [0.08, `${ridge} * 0.8`, 0.12], { anchor: "bottom", at: [0, 0, "$hl - 0.2"], material: f.dress, repeat: { count: 1, step: [0, 0, 0] } }));
    nave.push(box("CrossBar", [2.4, 0.12, 0.14], { at: [0, `${ridge} * 0.62`, "$hl - 0.15"], material: f.dress }));
    nave.push(group("Roof", [
      slab("Slope_L", ["-$hw - 0.6", 0.4], [0, ridge], 0.3, "2 * $hl + 0.6", f.roof, { mirror: "Slope_R", ext: 0.15 }),
      box("RidgeBeam", [0.4, 0.4, "2 * $hl + 0.7"], { at: [0, `${ridge} + 0.2`, 0], material: f.dress }),
    ]));
    nave.push(box("Forecourt", [8, 0.12, 4], { anchor: "bottom", at: [0, 0, "$hl + 2"], material: "concrete" }));
    nave.push(box("Path", ["$hw + 3.6", 0.1, 1.8], { anchor: "bottom", at: ["($hw + 3) / 2", 0, "$hl - 1"], material: "concrete" }));
    nave.push(box("Canopy", [4, 0.25, 2.2], { at: [0, 3, "$hl + 1"], material: f.dress, bevel: 0.02 }));
  }
  kids.push(group("Nave", nave));

  // The portal on the front.
  if (style !== "modern") {
    kids.push(group("Portal", [
      box("Doors", [1.8, 2.8, 0.15], { anchor: "bottom", at: [0, 0.05, 0.08], material: "dark_stain", bevel: 0.01 }),
      box("Arch", [3.0, 0.8, 0.5], { at: [0, 3.2, 0.25], material: f.dress, bevel: 0.03 }),
      box("Jamb_L", [0.6, 2.9, 0.5], { anchor: "bottom", at: [-1.2, 0, 0.25], mirror: "Jamb_R", material: f.dress, bevel: 0.03 }),
      box("Step_{i}", [3.6, 0.15, "1.2 - $i * 0.4"], { anchor: "bottom", at: [0, "$i * 0.15", "0.6 - $i * 0.2 + 0.4"], repeat: { count: 2, step: [0, 0, 0] }, material: f.dress, bevel: 0.01 }),
    ], { at: [0, 0, style === "steeple" ? "$hl + $ts - 0.2" : "$hl"] }));
  }

  // The tower (one per church): west tower with spire, bellcote, crossing tower or free-standing campanile.
  if (style === "steeple") {
    kids.push(group("Steeple", [
      box("Belfry", ["$ts", "$wh * 1.9", "$ts"], { anchor: "bottom", material: f.wall, bevel: 0.03 }),
      box("Stage_{i}", ["$ts + 0.2", 0.25, "$ts + 0.2"], { at: [0, "$wh * (0.6 + $i * 0.6)", 0], repeat: { count: 3, step: [0, 0, 0] }, material: f.dress, bevel: 0.02 }),
      box("Louvre_{i}", ["$ts * 0.35", "$wh * 0.35", 0.2], { at: [0, "$wh * 1.5", "$ts / 2"], repeat: { count: 4, around: "y" }, material: "dark_stain" }),
      cyl("Clock_{i}", "$ts * 0.2", 0.12, { axis: "z", at: [0, "$wh * 1.05", "$ts / 2 + 0.03"], repeat: { count: 4, around: "y" }, segments: 24, material: "clock_face" }),
      box("Hand_{i}", [0.05, "$ts * 0.15", 0.03], { at: [0, "$wh * 1.05 + $ts * 0.06", "$ts / 2 + 0.11"], repeat: { count: 4, around: "y" }, material: "black_steel" }),
      lancet("TowerWindow", "1.0", "$wh * 0.35", f.dress, false, { at: [0, "$wh * 0.45", "$ts / 2"] }),
      box("Pinnacle_{i}", [0.5, 1.8, 0.5], { anchor: "bottom", at: ["$ts / 2 - 0.25", "$wh * 1.9", "$ts / 2 - 0.25"], repeat: { count: 4, around: "y" }, material: f.dress, bevel: 0.03 }),
      roof("Needle", { x0: "-$ts / 2 + 0.3", x1: "$ts / 2 - 0.3", z0: "-$ts / 2 + 0.3", z1: "$ts / 2 - 0.3", y: "$wh * 1.9", rise: "$spire", kind: "hip" }, { material: f.spire }),
      lathe("Finial", [[0.1, "$wh * 1.9 + $spire - 0.3"], [0.15, "$wh * 1.9 + $spire"], [0.04, "$wh * 1.9 + $spire + 0.8"]], { segments: 10, material: "gold" }),
      box("Vane", [0.05, 0.4, 0.9], { at: [0, "$wh * 1.9 + $spire + 0.7", 0], material: "gold" }),
    ], { at: [0, 0, "$hl + $ts / 2 - 0.2"] }));
  } else if (style === "chapel") {
    kids.push(group("Bellcote", [
      box("Pier_L", [0.35, "$spire", 0.5], { anchor: "bottom", at: [-0.55, 0, 0], mirror: "Pier_R", material: f.wall, bevel: 0.02 }),
      box("Lintel", [1.6, 0.35, 0.6], { at: [0, "$spire", 0], material: f.dress, bevel: 0.02 }),
      roof("Cap", { x0: -0.9, x1: 0.9, z0: -0.4, z1: 0.4, y: "$spire + 0.17", rise: 0.5, kind: "gable" }, { material: f.roof }),
      lathe("Bell", [[0.32, "$spire * 0.35"], [0.26, "$spire * 0.4"], [0.16, "$spire * 0.6"], [0.06, "$spire * 0.66"]], { segments: 16, material: "bell_bronze" }),
      cyl("Yoke", 0.04, 0.8, { axis: "x", at: [0, "$spire * 0.67", 0], segments: 8, material: "black_steel" }),
    ], { at: [0, "$wh + $hw * 1.1 - 0.3", "$hl"] }));
    kids.push(group("Porch", [
      box("PorchWall_L", [0.4, 2.8, 2.4], { anchor: "bottom", at: [-1.4, 0, 1.2], mirror: "PorchWall_R", material: f.wall, bevel: 0.02 }),
      gableRoof("PorchRoof", { hw: 1.6, hd: 1.3, y: 2.8, rise: 1.2, roof: f.roof, trim: f.dress, gable: f.wall, at: [0, 0, 1.2], oh: 0.2, ohg: 0.15, t: 0.12 }),
    ], { at: [0, 0, "$hl"] }));
    kids.push(group("Cross", [
      box("Upright", [0.12, 1.4, 0.12], { anchor: "bottom", material: "black_steel" }),
      box("Arm", [0.8, 0.12, 0.12], { at: [0, 1.0, 0], material: "black_steel" }),
    ], { at: [0, "$wh + $hw * 1.1 + 0.2", "-$hl + 0.3"] }));
  } else if (style === "basilica") {
    kids.push(group("Steeple", [
      box("Lantern", ["$hw * 1.5", "$spire", "$hw * 1.5"], { anchor: "bottom", at: [0, "$wh - 1", 0], material: f.wall, bevel: 0.03 }),
      box("Arcade_{i}", ["$hw * 0.25", "$spire * 0.3", 0.2], { at: ["-$hw * 0.35", "$wh + $spire * 0.55", "$hw * 0.75"], repeat: { count: 3, step: ["$hw * 0.35", 0, 0] }, material: "dark_stain" }),
      box("ArcadeBack_{i}", ["$hw * 0.25", "$spire * 0.3", 0.2], { at: ["-$hw * 0.35", "$wh + $spire * 0.55", "-$hw * 0.75"], repeat: { count: 3, step: ["$hw * 0.35", 0, 0] }, material: "dark_stain" }),
      box("Band", ["$hw * 1.5 + 0.2", 0.3, "$hw * 1.5 + 0.2"], { at: [0, "$wh + $spire - 1.1", 0], material: f.dress }),
      roof("Pyramid", { x0: "-$hw * 0.8", x1: "$hw * 0.8", z0: "-$hw * 0.8", z1: "$hw * 0.8", y: "$wh + $spire - 1", rise: "$hw * 0.9", kind: "hip" }, { material: f.spire }),
      lathe("Finial", [[0.12, "$wh + $spire - 1 + $hw * 0.9 - 0.2"], [0.04, "$wh + $spire - 1 + $hw * 0.9 + 1.2"]], { segments: 8, material: "gold" }),
    ], { at: [0, 0, "-$hl * 0.35"] }));
  } else {
    kids.push(group("Steeple", [
      box("Shaft", [1.6, "$spire", 1.6], { anchor: "bottom", material: f.spire, bevel: 0.03 }),
      box("Opening_{i}", [1.0, "$spire * 0.12", 1.7], { at: [0, "$spire * 0.8", 0], rotate: [0, "$i * 90", 0], repeat: { count: 2, step: [0, 0, 0] }, material: "dark_stain" }),
      lathe("Bell", [[0.3, "$spire * 0.76"], [0.22, "$spire * 0.8"], [0.06, "$spire * 0.84"]], { segments: 16, material: "bell_bronze" }),
      box("Upright", [0.15, 3, 0.15], { anchor: "bottom", at: [0, "$spire", 0], material: f.dress }),
      box("Arm", [1.4, 0.15, 0.15], { at: [0, "$spire + 2.1", 0], material: f.dress }),
    ], { at: ["$hw + 3", 0, "$hl - 1"] }));
  }

  const names = [f.wall, f.dress, f.roof, f.spire, GLASS, "zinc", "black_steel", "dark_stain", "gold", "clock_face", "bell_bronze", "concrete", "window_glass"];
  const materials: Record<string, MaterialDef> = {};
  for (const n of names) materials[n] = LOCAL[n] ?? BMATS[n] ?? (mats(n)[n] as MaterialDef);
  const title = { steeple: "parish church with spire", chapel: "chapel", basilica: "Romanesque basilica", modern: "modern church" }[style];
  return {
    slug: slugify("church", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${title}`,
    description: `A ${f.text} ${title}: ${s.text}. The entrance faces +z.`,
    tags: [style, f.id, f.nl, ...(style === "chapel" ? ["kapel"] : style === "basilica" ? ["basiliek", "romaans"] : style === "modern" ? ["moderne kerk", "klokkentoren"] : ["dorpskerk", "kerktoren", "torenspits"])],
    params: [
      num("length", s.l[2], s.l[0], s.l[1], "Length of the nave along z in metres."),
      num("width", s.w[2], s.w[0], s.w[1], "Width of the nave along x in metres."),
      num("wallHeight", s.h[2], s.h[0], s.h[1], style === "modern" ? "Height of the low side walls in metres." : "Height of the nave walls in metres."),
      num("spire", s.s[2], s.s[0], s.s[1], style === "steeple" ? "Height of the spire above the tower in metres." : style === "chapel" ? "Height of the bellcote in metres." : style === "basilica" ? "Height of the crossing tower above the nave walls in metres." : "Height of the bell tower in metres."),
    ],
    materials,
    nodes: [group("Church", kids, { vars: { hw: "$width / 2", hl: "$length / 2", wh: "$wallHeight", ts: "$width * 0.55" } })],
  };
}

export const churchFamily: Family = {
  id: "church",
  category: "buildings",
  archetype: "building.church",
  tags: ["church", "kerk", "chapel", "kapel", "religious", "landmark"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => FINISHES[style].map((f) => church(style, f))),
};
