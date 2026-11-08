import { box, cyl, group, int, lathe, num, roof, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { BMATS } from "./shared.js";

const LOCAL: Record<string, MaterialDef> = {
  flag_red: { color: [0.6, 0.04, 0.03], metallic: 0, roughness: 0.8, doubleSided: true },
  flag_blue: { color: [0.03, 0.1, 0.45], metallic: 0, roughness: 0.8, doubleSided: true },
  flag_yellow: { color: [0.8, 0.55, 0.03], metallic: 0, roughness: 0.8, doubleSided: true },
  flag_green: { color: [0.04, 0.3, 0.08], metallic: 0, roughness: 0.8, doubleSided: true },
};

const STYLES = {
  battlement: { text: "a round stone tower on a battered base with arrow slits, a corbelled parapet with battlements, a small conical turret roof on the roof deck and a flag", h: [10, 22, 15], w: [4, 8, 6] },
  conical: { text: "a round stone tower with arrow slits and a timber hoarding gallery on brackets near the top, under a tall conical roof with a finial", h: [12, 26, 18], w: [4, 8, 5.5] },
  timber: { text: "a timber lookout tower: four raked log legs with cross bracing, a ladder up the front and an open platform with a railing under a pyramid roof on corner posts", h: [8, 14, 10], w: [3, 6, 4] },
  fire: { text: "a steel fire lookout tower: a tall braced lattice of four raked legs, a zig-zag of stair flights, a glazed cab with a gallery round it and an antenna", h: [15, 32, 22], w: [4, 8, 5.5] },
} as const;
type Style = keyof typeof STYLES;

const FINISHES: Record<Style, { id: string; main: string; second: string; roof: string; flag: string; text: string; nl: string }[]> = {
  battlement: [
    { id: "grey-stone", main: "granite", second: "limestone", roof: "slate_grey", flag: "flag_red", text: "grey stone", nl: "grijze steen" },
    { id: "sandstone", main: "sandstone", second: "limestone", roof: "tile_red", flag: "flag_blue", text: "sandstone", nl: "zandsteen" },
    { id: "limestone", main: "limestone", second: "sandstone", roof: "slate_blue", flag: "flag_yellow", text: "limestone", nl: "kalksteen" },
    { id: "brick", main: "brick_red", second: "limestone", roof: "slate_grey", flag: "flag_green", text: "brick", nl: "baksteen" },
  ],
  conical: [
    { id: "grey-stone", main: "granite", second: "rough_timber", roof: "slate_grey", flag: "flag_red", text: "grey stone", nl: "grijze steen" },
    { id: "rendered", main: "render_white", second: "dark_stain", roof: "tile_red", flag: "flag_blue", text: "whitewashed", nl: "witgekalkt" },
    { id: "mossy", main: "mossy_rock", second: "weathered_wood", roof: "shingle_wood", flag: "flag_green", text: "mossy stone", nl: "bemoste steen" },
  ],
  timber: [
    { id: "pine", main: "pine", second: "pine", roof: "shingle_wood", flag: "flag_red", text: "pine", nl: "grenen" },
    { id: "dark", main: "dark_stain", second: "oak", roof: "felt_black", flag: "flag_yellow", text: "dark-stained", nl: "donker hout" },
    { id: "weathered", main: "weathered_wood", second: "rough_timber", roof: "corrugated", flag: "flag_blue", text: "weathered", nl: "verweerd hout" },
    { id: "larch", main: "rough_timber", second: "light_oak", roof: "shingle_green", flag: "flag_green", text: "larch log", nl: "lariks" },
  ],
  fire: [
    { id: "galvanised", main: "galvanised", second: "paint_white", roof: "corrugated_red", flag: "flag_red", text: "galvanised", nl: "gegalvaniseerd" },
    { id: "green", main: "paint_forest", second: "paint_cream", roof: "corrugated_green", flag: "flag_yellow", text: "green", nl: "groen" },
    { id: "red", main: "paint_red", second: "paint_white", roof: "zinc", flag: "flag_blue", text: "red and white", nl: "rood-wit" },
  ],
};

/** A flag on a pole standing at the origin, from y0. */
function flag(y0: string | number, mat: string, poleMat: string): SpecNode {
  return group("Flag", [
    cyl("Pole", 0.04, 3, { anchor: "base", at: [0, y0, 0], segments: 8, material: poleMat }),
    cyl("Truck", 0.07, 0.08, { at: [0, `${y0} + 3.02`, 0], segments: 10, material: "brass" }),
    box("Cloth", [1.3, 0.85, 0.02], { at: [0.68, `${y0} + 2.5`, 0], material: mat }),
  ]);
}

function stoneTower(style: "battlement" | "conical", f: (typeof FINISHES)["battlement"][number]): SpecNode[] {
  const kids: SpecNode[] = [
    group("Shaft", [
      lathe("Drum", [[`$r * 1.18`, 0], [`$r * 1.12`, 1.4], [`$r * 1.02`, 2.0], [`$r`, 2.2], [`$r`, "$top"]], { segments: 24, material: f.main }),
      lathe("Batter", [[`$r * 1.2`, 1.85], [`$r * 1.22`, 2.0], [`$r * 1.16`, 2.1], [`$r * 1.02`, 2.12]], { segments: 24, material: f.second }),
      lathe("Course", [[`$r * 1.04`, "$top * 0.5 - 0.1"], [`$r * 1.04`, "$top * 0.5 + 0.1"]], { segments: 24, material: f.second }),
    ]),
    group("Windows", [
      box("Slit_{i}", [0.14, 0.9, 0.3], { at: [0, "$top * 0.35", "$r - 0.1"], repeat: { count: "$slits", around: "y", phase: 45 }, material: "window_glass" }),
      box("SlitHigh_{i}", [0.14, 0.9, 0.3], { at: [0, "$top * 0.7", "$r - 0.1"], repeat: { count: "$slits", around: "y", phase: 45 + 180 / 6 }, material: "window_glass" }),
      box("SlitFrame_{i}", [0.34, 1.1, 0.2], { at: [0, "$top * 0.35", "$r - 0.08"], repeat: { count: "$slits", around: "y", phase: 45 }, material: f.second }),
    ]),
    group("Door", [
      box("Leaf", [1.1, 2.1, 0.1], { anchor: "bottom", at: [0, 0, 0.05], material: "dark_stain", bevel: 0.01 }),
      box("Stud_{i}", [0.05, 0.05, 0.03], { at: [-0.35, 0.4, 0.11], repeat: { count: 4, step: [0.23, 0.4, 0] }, material: "black_steel" }),
      box("Arch", [1.6, 0.35, 0.25], { at: [0, 2.25, 0.05], material: f.second, bevel: 0.02 }),
      box("Jamb_L", [0.25, 2.1, 0.25], { anchor: "bottom", at: [-0.67, 0, 0.05], mirror: "Jamb_R", material: f.second, bevel: 0.02 }),
      box("Doorstep", [1.8, 0.15, 0.6], { anchor: "bottom", at: [0, 0, 0.2], material: f.second, bevel: 0.01 }),
    ], { at: [0, 0, "$r * 1.12"] }),
  ];
  if (style === "battlement") {
    kids.push(
      group("Corbels", [box("Corbel_{i}", [0.3, 0.5, 0.5], { at: [0, "$top - 0.15", "$r + 0.12"], repeat: { count: 16, around: "y" }, material: f.second })]),
      group("Battlements", [
        lathe("Breastwork", [[`$r - 0.3`, "$top"], [`$r + 0.35`, "$top"], [`$r + 0.35`, "$top + 1.0"], [`$r - 0.3`, "$top + 1.0"]], { segments: 24, material: f.main }),
        box("Merlon_{i}", [0.7, 0.7, 0.62], { at: [0, "$top + 1.33", "$r + 0.03"], repeat: { count: "$merlons", around: "y" }, material: f.main }),
        box("MerlonCap_{i}", [0.78, 0.08, 0.7], { at: [0, "$top + 1.72", "$r + 0.03"], repeat: { count: "$merlons", around: "y" }, material: f.second }),
      ]),
      group("Roof", [
        lathe("Turret", [[1.0, "$top + 0.9"], [1.0, "$top + 2.8"]], { segments: 16, material: f.main }),
        lathe("Cone", [[1.25, "$top + 2.75"], [1.3, "$top + 2.85"], [0.06, "$top + 4.8"], [0.04, "$top + 4.9"]], { segments: 16, material: f.roof }),
      ], { at: ["-$r * 0.35", 0, "-$r * 0.35"] }),
      group("Mast", [flag("$top + 4.75", f.flag, "black_steel")], { at: ["-$r * 0.35", 0, "-$r * 0.35"] }),
    );
  } else {
    kids.push(
      group("Gallery", [
        box("Bracket_{i}", [0.18, 0.9, 1.3], { at: [0, "$top - 0.55", "$r + 0.5"], rotate: [0, 0, 0], repeat: { count: 12, around: "y" }, material: f.second }),
        lathe("Walkway", [[`$r - 0.1`, "$top - 0.1"], [`$r + 1.25`, "$top - 0.1"], [`$r + 1.25`, "$top + 0.1"], [`$r - 0.1`, "$top + 0.1"]], { segments: 24, material: f.second }),
        lathe("Hoarding", [[`$r + 1.0`, "$top + 0.1"], [`$r + 1.2`, "$top + 0.1"], [`$r + 1.2`, "$top + 2.0"], [`$r + 1.0`, "$top + 2.0"]], { segments: 24, material: f.second }),
        box("Shutter_{i}", [0.9, 0.7, 0.08], { at: [0, "$top + 1.2", "$r + 1.24"], repeat: { count: 8, around: "y", phase: 22.5 }, material: "dark_stain" }),
      ]),
      group("Roof", [
        lathe("Cone", [[`$r + 1.6`, "$top + 1.95"], [`$r + 1.65`, "$top + 2.1"], [`$r * 0.4`, "$top + 2 + $r * 1.3"], [0.05, "$top + 2.1 + $r * 2.0"], [0.04, "$top + 2.2 + $r * 2.0"]], { segments: 24, material: f.roof }),
        lathe("Finial", [[0.08, "$top + 2.1 + $r * 2.0"], [0.12, "$top + 2.4 + $r * 2.0"], [0.02, "$top + 2.9 + $r * 2.0"]], { segments: 10, material: "brass" }),
      ]),
      group("Mast", [flag("$top + 2.85 + $r * 2.0", f.flag, "black_steel")]),
    );
  }
  return kids;
}

function lattice(style: "timber" | "fire", f: (typeof FINISHES)["timber"][number]): SpecNode[] {
  const steel = style === "fire";
  const leg = steel ? 0.09 : 0.14;
  // a(y): half the spread of the legs at height y; legs run from a0 at the ground to a1 at the platform.
  const a = (y: string): string => `($a0 + ($a1 - $a0) * (${y}) / $top)`;
  const yi = "$i * $top / $levels";
  const yj = "($i + 1) * $top / $levels";
  const kids: SpecNode[] = [
    group("Shaft", [
      tube("Leg_{i}", [[`$a0`, 0, `$a0`], [`$a1`, "$top + 0.05", `$a1`]], leg, { repeat: { count: 4, around: "y" }, segments: 10, material: f.main }),
      group("Face_{i}", [
        tube("BraceA_{i}", [[`-${a(yi)}`, yi, a(yi)], [a(yj), yj, a(yj)]], leg * 0.5, { repeat: { count: "$levels", step: [0, 0, 0] }, segments: 8, material: f.main }),
        tube("BraceB_{i}", [[a(yi), yi, a(yi)], [`-${a(yj)}`, yj, a(yj)]], leg * 0.5, { repeat: { count: "$levels", step: [0, 0, 0] }, segments: 8, material: f.main }),
        box("Girt_{i}", [`2 * ${a(yj)}`, leg * 1.2, leg * 1.2], { at: [0, yj, a(yj)], repeat: { count: "$levels", step: [0, 0, 0] }, material: f.main }),
      ], { repeat: { count: 4, around: "y" } }),
      box("Footing_{i}", [0.6, 0.3, 0.6], { at: ["$a0", 0.15, "$a0"], repeat: { count: 4, around: "y" }, material: "concrete" }),
    ]),
    group("Gallery", [
      box("Platform", ["2 * $a1 + 1.6", 0.16, "2 * $a1 + 1.6"], { at: [0, "$top + 0.08", 0], material: f.second, bevel: 0.01 }),
      box("Joist_{i}", [0.12, 0.2, "2 * $a1 + 1.6"], { at: ["-$a1", "$top - 0.08", 0], repeat: { count: 3, step: ["$a1", 0, 0] }, material: f.main }),
      group("Rail_{i}", [
        box("Handrail", ["2 * $a1 + 1.6", 0.06, 0.08], { at: [0, "$top + 1.1", "$a1 + 0.76"], material: f.main }),
        box("MidRail", ["2 * $a1 + 1.6", 0.05, 0.05], { at: [0, "$top + 0.6", "$a1 + 0.76"], material: f.main }),
        box("Baluster_{i}", [0.06, 1.0, 0.06], { at: ["-$a1 - 0.76", "$top + 0.62", "$a1 + 0.76"], repeat: { count: 6, step: ["(2 * $a1 + 1.52) / 5", 0, 0] }, material: f.main }),
      ], { repeat: { count: 4, around: "y" } }),
    ]),
  ];
  if (steel) {
    kids.push(
      group("Cab", [
        box("CabWalls", ["2 * $a1", 1.0, "2 * $a1"], { anchor: "bottom", at: [0, "$top + 0.16", 0], material: f.second, bevel: 0.01 }),
        box("Window_{i}", ["2 * $a1 - 0.1", 1.2, 0.06], { at: [0, "$top + 1.75", "$a1 - 0.02"], repeat: { count: 4, around: "y" }, material: "window_glass" }),
        box("Corner_{i}", [0.1, 1.3, 0.1], { anchor: "bottom", at: ["$a1 - 0.03", "$top + 1.1", "$a1 - 0.03"], repeat: { count: 4, around: "y" }, material: f.main }),
        box("Head", ["2 * $a1 + 0.05", 0.2, "2 * $a1 + 0.05"], { at: [0, "$top + 2.45", 0], material: f.second }),
      ]),
      roof("Roof", { x0: "-$a1 - 0.5", x1: "$a1 + 0.5", z0: "-$a1 - 0.5", z1: "$a1 + 0.5", y: "$top + 2.55", rise: 0.9, kind: "hip" }, { material: f.roof }),
      group("Antenna", [cyl("Rod", 0.03, 2.5, { anchor: "base", at: [0, "$top + 3.4", 0], segments: 8, material: "galvanised" })]),
      group("Stairs", [
        tube("Flight_{i}", [["-$a0 * 0.4 * pow(-1, $i)", "$i * $top / $levels", "0"], ["$a0 * 0.4 * pow(-1, $i)", "($i + 1) * $top / $levels", "0"]], 0.05, { repeat: { count: "$levels", step: [0, 0, 0] }, segments: 6, material: "galvanised" }),
        box("Landing_{i}", [0.9, 0.06, 0.9], { at: ["$a0 * 0.4 * pow(-1, $i)", "($i + 1) * $top / $levels", 0], repeat: { count: "$levels - 1", step: [0, 0, 0] }, material: "galvanised" }),
      ]),
      group("Door", [box("Hatch", [0.8, 0.06, 0.8], { at: [0, "$top + 0.2", 0], material: f.main })]),
      group("Mast", [flag("$top + 2.6", f.flag, "galvanised")], { at: ["$a1 + 0.6", 0, "$a1 + 0.6"] }),
    );
  } else {
    kids.push(
      box("Post_{i}", [0.14, 2.3, 0.14], { anchor: "bottom", at: ["$a1 + 0.65", "$top + 0.1", "$a1 + 0.65"], repeat: { count: 4, around: "y" }, material: f.main }),
      roof("Roof", { x0: "-$a1 - 1.25", x1: "$a1 + 1.25", z0: "-$a1 - 1.25", z1: "$a1 + 1.25", y: "$top + 2.35", rise: "$a1 + 0.9", kind: "hip" }, { material: f.roof }),
      box("Eaves", ["2 * $a1 + 2.4", 0.12, "2 * $a1 + 2.4"], { at: [0, "$top + 2.33", 0], material: f.main }),
      group("Ladder", [
        tube("Stile_L", [["-0.25", 0, "$a0 + 0.5"], ["-0.25", "$top + 0.1", "$a1 + 0.1"]], 0.04, { mirror: "Stile_R", segments: 6, material: f.second }),
        box("Rung_{i}", [0.5, 0.04, 0.04], { at: [0, "0.3 + $i * 0.3", "$a0 + 0.5 - ($a0 + 0.4 - $a1) * (0.3 + $i * 0.3) / ($top + 0.1)"], repeat: { count: "floor($top / 0.3)", step: [0, 0, 0] }, material: f.second }),
      ]),
      group("Door", [box("Trapdoor", [0.7, 0.06, 0.7], { at: [0, "$top + 0.19", "$a1 + 0.3"], material: f.main })]),
      group("Mast", [flag("$top + 2.35 + $a1 + 0.7", f.flag, "galvanised")]),
    );
  }
  return kids;
}

function tower(style: Style, f: (typeof FINISHES)[Style][number]): AssetDraft {
  const s = STYLES[style];
  const stone = style === "battlement" || style === "conical";
  const kids = stone ? stoneTower(style, f) : lattice(style, f);
  const vars: Record<string, string> = stone
    ? { r: "$width / 2", top: style === "battlement" ? "$height - 4.9" : "$height - 2.2 - $width" }
    : { a0: "$width / 2", a1: "$width * 0.28", top: "$height" };
  const params = [
    num("height", s.h[2], s.h[0], s.h[1], stone ? (style === "battlement" ? "Height to the tip of the turret roof in metres." : "Height to the tip of the roof in metres.") : "Height of the platform in metres."),
    num("width", s.w[2], s.w[0], s.w[1], stone ? "Diameter of the shaft in metres." : "Spread of the legs at the ground in metres."),
    stone ? int("slits", 4, 3, 6, "Arrow slits on each level.") : int("levels", style === "fire" ? 6 : 3, 2, style === "fire" ? 8 : 5, "Braced levels of the legs."),
  ];
  if (style === "battlement") params.push(int("merlons", 10, 8, 14, "Merlons round the parapet."));
  const names = [f.main, f.second, f.roof, f.flag, "window_glass", "dark_stain", "black_steel", "brass", "galvanised", "concrete"];
  const materials: Record<string, MaterialDef> = {};
  for (const n of names) materials[n] = LOCAL[n] ?? BMATS[n] ?? (mats(n)[n] as MaterialDef);
  const title = { battlement: "battlemented watchtower", conical: "conical-roofed watchtower", timber: "timber lookout tower", fire: "fire lookout tower" }[style];
  return {
    slug: slugify("watchtower", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${title}`,
    description: `A ${f.text} ${title}: ${s.text}. Its door or ladder faces +z.`,
    tags: [style, f.id, f.nl, ...(stone ? ["kasteeltoren", "middeleeuws", "castle tower"] : style === "fire" ? ["brandtoren", "uitkijkpost"] : ["uitkijktoren", "hoogzit"])],
    params,
    materials,
    nodes: [group("Watchtower", kids, { vars })],
  };
}

export const watchtowerFamily: Family = {
  id: "watchtower",
  category: "buildings",
  archetype: "building.watchtower",
  tags: ["watchtower", "wachttoren", "uitkijktoren", "lookout", "tower", "toren"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => FINISHES[style].map((f) => tower(style, f))),
};
