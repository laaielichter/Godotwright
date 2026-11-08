import { box, cyl, extrude, group, int, lathe, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { BMATS, sheetRib, solid } from "./shared.js";

const STYLES = {
  hexagonal: { text: "a hexagonal timber gazebo: six posts on a raised deck, railings with balusters on five sides and an open entrance at the front, curved brackets and a faceted roof with a finial", n: 6, r: [1.4, 2.4, 1.8], h: [2.2, 2.8, 2.4] },
  bandstand: { text: "an octagonal Victorian bandstand: slender cast columns on a raised stone plinth with steps at the front, a frieze of brackets, an iron railing and a faceted roof with a small lantern", n: 8, r: [2.5, 4.5, 3.4], h: [2.6, 3.4, 3] },
  pergola: { text: "a rectangular pergola of square posts carrying twin beams and a row of notched rafters, with slats across the top and a paved floor", n: 0, r: [2.5, 4.5, 3.2], h: [2.3, 2.8, 2.5] },
  carport: { text: "a carport: posts on a concrete slab carrying a flat roof sheet on purlins with a fascia, a gutter and a downpipe, open on all sides", n: 0, r: [2.8, 3.6, 3.1], h: [2.2, 2.7, 2.4] },
} as const;
type Style = keyof typeof STYLES;

const FINISHES: Record<Style, { id: string; frame: string; roof: string; floor: string; trim: string; text: string; nl: string }[]> = {
  hexagonal: [
    { id: "white", frame: "paint_white", roof: "shingle_green", floor: "pine", trim: "paint_white", text: "white", nl: "wit" },
    { id: "cedar", frame: "teak", roof: "shingle_wood", floor: "teak", trim: "teak", text: "cedar", nl: "ceder" },
    { id: "green", frame: "paint_forest", roof: "slate_grey", floor: "weathered_wood", trim: "paint_cream", text: "green", nl: "groen" },
    { id: "thatched", frame: "rough_timber", roof: "thatch", floor: "rough_timber", trim: "rough_timber", text: "thatched", nl: "riet" },
  ],
  bandstand: [
    { id: "green", frame: "paint_forest", roof: "zinc", floor: "limestone", trim: "paint_cream", text: "green and cream", nl: "groen" },
    { id: "red", frame: "paint_burgundy", roof: "slate_grey", floor: "sandstone", trim: "paint_white", text: "burgundy", nl: "bordeaux" },
    { id: "white", frame: "paint_white", roof: "aged_copper", floor: "granite", trim: "gold", text: "white and gold", nl: "wit-goud" },
  ],
  pergola: [
    { id: "oak", frame: "oak", roof: "oak", floor: "sandstone", trim: "oak", text: "oak", nl: "eiken" },
    { id: "grey", frame: "paint_grey", roof: "paint_grey", floor: "concrete", trim: "paint_grey", text: "grey painted", nl: "grijs" },
    { id: "pine", frame: "pine", roof: "pine", floor: "limestone", trim: "pine", text: "pine", nl: "grenen" },
    { id: "black-steel", frame: "black_steel", roof: "light_oak", floor: "granite", trim: "black_steel", text: "black steel and oak", nl: "zwart staal" },
  ],
  carport: [
    { id: "timber", frame: "light_oak", roof: "corrugated", floor: "concrete", trim: "light_oak", text: "timber", nl: "hout" },
    { id: "steel", frame: "paint_anthracite", roof: "felt_black", floor: "concrete", trim: "paint_anthracite", text: "anthracite steel", nl: "antraciet" },
    { id: "white", frame: "paint_white", roof: "glass_frosted", floor: "concrete", trim: "paint_white", text: "white with a polycarbonate roof", nl: "wit" },
  ],
};

/** A faceted pyramid roof of n triangular panels round y, eaves at $ey, overhanging apothem $ra, rising $rr. */
function facetRoof(n: number, mat: string, t: number): SpecNode {
  return group("Facet_{i}", [
    extrude("Panel", [["-$ra * tan(pi / $fn)", 0], ["$ra * tan(pi / $fn)", 0], [0, "-$ra / cos($phi)"]], 0, t, { material: mat }),
  ], { at: [0, "$ey", "$ra"], rotate: ["deg($phi)", 0, 0], repeat: { count: n, around: "y" }, vars: { fn: n } });
}

function polygonPlan(n: number, r: string): [string, string][] {
  return Array.from({ length: n }, (_, k): [string, string] => {
    const a = 90 + 180 / n + (k * 360) / n;
    return [`${r} * ${Math.cos((a * Math.PI) / 180).toFixed(6)}`, `${r} * ${Math.sin((a * Math.PI) / 180).toFixed(6)}`];
  });
}

function polygonal(style: "hexagonal" | "bandstand", f: (typeof FINISHES)["hexagonal"][number]): SpecNode[] {
  const n = STYLES[style].n;
  const band = style === "bandstand";
  const fy = band ? 0.9 : 0.25;
  const kids: SpecNode[] = [];
  // The floor: a polygon whose corners are at the posts ($R), slightly larger.
  kids.push(extrude("Floor", polygonPlan(n, "($R + 0.2)"), 0, fy, { material: f.floor }));
  if (band) {
    kids.push(extrude("FloorEdge", polygonPlan(n, "($R + 0.3)"), fy - 0.12, fy, { material: f.trim }));
    kids.push(box("Step_{i}", [1.8, "0.3 * ($i + 1)", 0.4], { anchor: "bottom", at: [0, 0, "$R * cos(pi / 8) + 0.2 + 0.4 * (2 - $i) + 0.2"], repeat: { count: 3, step: [0, 0, 0] }, material: f.floor, bevel: 0.01 }));
  } else {
    kids.push(box("Joist_{i}", [0.1, 0.12, "2 * $R"], { at: [0, 0.06, 0], rotate: [0, "$i * 60", 0], repeat: { count: 3, step: [0, 0, 0] }, material: solid(f.frame) }));
    kids.push(box("Step", [1.0, 0.12, 0.35], { anchor: "bottom", at: [0, 0, "$R * cos(pi / 6) + 0.35"], material: f.floor, bevel: 0.01 }));
  }
  const post: SpecNode = band
    ? cyl("Column_{i}", 0.07, "$h", { anchor: "base", at: [0, fy, "$R"], repeat: { count: n, around: "y", phase: 180 / n }, segments: 12, material: f.frame })
    : box("Post_{i}", [0.13, "$h", 0.13], { anchor: "bottom", at: [0, fy, "$R"], repeat: { count: n, around: "y", phase: 180 / n }, material: solid(f.frame), bevel: 0.01 });
  kids.push(post);
  kids.push(box("Plinth_{i}", [0.22, 0.25, 0.22], { anchor: "bottom", at: [0, fy, "$R"], repeat: { count: n, around: "y", phase: 180 / n }, material: solid(f.trim), bevel: 0.01 }));
  kids.push(box("Capital_{i}", [0.22, 0.12, 0.22], { at: [0, `${fy} + $h - 0.06`, "$R"], repeat: { count: n, around: "y", phase: 180 / n }, material: solid(f.trim), bevel: 0.01 }));
  // Ring beam on the post tops, brackets and railings between the posts (not at the front).
  kids.push(box("Plate_{i}", ["2 * $R * sin(pi / $nn) + 0.1", 0.18, 0.14], { at: [0, `${fy} + $h + 0.09`, "$R * cos(pi / $nn)"], repeat: { count: n, around: "y" }, material: solid(f.trim), bevel: 0.01 }));
  kids.push(group("Bracket_{i}", [
    box("Arm_L", [0.5, 0.06, 0.06], { at: ["-$R * sin(pi / $nn) + 0.25", `${fy} + $h - 0.15`, 0], rotate: [0, 0, 35], material: solid(f.trim) }),
    box("Arm_R", [0.5, 0.06, 0.06], { at: ["$R * sin(pi / $nn) - 0.25", `${fy} + $h - 0.15`, 0], rotate: [0, 0, -35], material: solid(f.trim) }),
  ], { at: [0, 0, "$R * cos(pi / $nn)"], repeat: { count: n, around: "y" } }));
  kids.push(group("Railing_{i}", [
    box("TopRail", ["2 * $R * sin(pi / $nn) - 0.1", 0.07, 0.08], { at: [0, `${fy} + 0.9`, 0], material: solid(f.trim) }),
    box("BottomRail", ["2 * $R * sin(pi / $nn) - 0.1", 0.06, 0.06], { at: [0, `${fy} + 0.12`, 0], material: solid(f.trim) }),
    box("Baluster_{i}", [0.04, 0.78, 0.04], { at: ["-$R * sin(pi / $nn) + 0.15", `${fy} + 0.51`, 0], repeat: { count: "floor(2 * $R * sin(pi / $nn) / 0.14)", step: [0.14, 0, 0] }, material: band ? "cast_iron" : solid(f.trim) }),
  ], { at: [0, 0, "$R * cos(pi / $nn)"], repeat: { count: n - 1, around: "y", phase: 360 / n } }));
  // Roof.
  kids.push(group("Roof", [
    facetRoof(n, f.roof, band ? 0.08 : 0.1),
    // Thatch: stepped courses of combed reed over the facets, a thick rounded roll round the eaves.
    ...(f.roof === "thatch" ? [
      ...[1, 2, 3].map((k) => group(`Course_${k}`, [facetRoof(n, f.roof, 0.1)], { vars: { ey: `$ey + ${k} * $ra * 0.17 * tan($phi) + ${k * 0.08}`, ra: `$ra * (1 - ${k} * 0.17)` } })),
      cyl("EaveRoll_{i}", 0.13, `2 * $ra * tan(pi / ${n}) + 0.2`, { axis: "x", at: [0, "$ey + 0.02", "$ra - 0.06"], repeat: { count: n, around: "y" }, segments: 12, material: f.roof }),
    ] : []),
    lathe("Finial", [[0.12, "$ey + $rr - 0.2"], [0.14, "$ey + $rr + 0.05"], [0.08, "$ey + $rr + 0.25"], [0.1, "$ey + $rr + 0.4"], [0.02, "$ey + $rr + 0.7"]], { segments: 12, material: band ? f.trim : "brass" }),
    ...(band ? [
      lathe("Lantern", [[0.6, "$ey + $rr * 0.55"], [0.6, "$ey + $rr * 0.85"], [0.75, "$ey + $rr * 0.85"], [0.75, "$ey + $rr * 0.9"]], { segments: n, material: f.frame }),
      extrude("Fascia", polygonPlan(n, "($R + 0.35)"), `${fy} + $h + 0.15`, `${fy} + $h + 0.4`, { material: f.trim }),
    ] : [extrude("Fascia", polygonPlan(n, "($R + 0.25)"), `${fy} + $h + 0.12`, `${fy} + $h + 0.32`, { material: f.trim })]),
  ], { vars: { ey: `${fy} + $h + 0.2`, ra: `$R * cos(pi / $nn) + ${band ? 0.6 : 0.5}`, rr: "$rise", phi: "atan($rise / $ra)" } }));
  if (band) kids.push(cyl("Lamp", 0.1, 0.3, { at: [0, `${fy} + $h - 0.1`, 0], segments: 10, material: "bulb_warm" }));
  if (band) kids.push(cyl("LampRod", 0.015, 1.2, { anchor: "base", at: [0, `${fy} + $h + 0.05`, 0], segments: 6, material: "cast_iron" }));
  return kids;
}

function rectangular(style: "pergola" | "carport", f: (typeof FINISHES)["pergola"][number]): SpecNode[] {
  const pergola = style === "pergola";
  const kids: SpecNode[] = [
    box("Floor", ["2 * $hw + 0.4", 0.1, "2 * $hl + 0.4"], { anchor: "bottom", material: f.floor, bevel: 0.01 }),
    group("Posts", [
      box("Post_L{i}", [0.14, "$h", 0.14], { anchor: "bottom", at: ["-$hw", 0.1, "-$hl"], repeat: { count: "$spans + 1", step: [0, 0, "2 * $hl / $spans"] }, mirror: "Post_R{i}", material: solid(f.frame), bevel: pergola ? 0.01 : 0.004 }),
      box("Shoe_L{i}", [0.2, 0.15, 0.2], { anchor: "bottom", at: ["-$hw", 0.1, "-$hl"], repeat: { count: "$spans + 1", step: [0, 0, "2 * $hl / $spans"] }, mirror: "Shoe_R{i}", material: "galvanised" }),
    ]),
  ];
  if (pergola) {
    kids.push(group("Roof", [
      box("Beam_L", [0.07, 0.24, "2 * $hl + 0.8"], { at: ["-$hw - 0.07", "$h + 0.1 - 0.12", 0], mirror: "Beam_R", material: solid(f.roof), bevel: 0.006 }),
      box("BeamIn_L", [0.07, 0.24, "2 * $hl + 0.8"], { at: ["-$hw + 0.07", "$h + 0.1 - 0.12", 0], mirror: "BeamIn_R", material: solid(f.roof), bevel: 0.006 }),
      box("Rafter_{i}", ["2 * $hw + 0.9", 0.2, 0.06], { at: [0, "$h + 0.1 + 0.08", "-$hl - 0.3"], repeat: { count: "floor((2 * $hl + 0.6) / 0.5) + 1", step: [0, 0, "(2 * $hl + 0.6) / floor((2 * $hl + 0.6) / 0.5)"] }, material: solid(f.roof), bevel: 0.005 }),
      box("Slat_{i}", [0.04, 0.04, "2 * $hl + 0.7"], { at: ["-$hw + 0.15", "$h + 0.1 + 0.19", 0], repeat: { count: "floor(2 * $hw / 0.3)", step: [0.3, 0, 0] }, material: solid(f.roof) }),
      box("Knee_L{i}", [0.06, 0.5, 0.06], { at: ["-$hw", "$h - 0.2", "-$hl + 0.25"], rotate: [-45, 0, 0], repeat: { count: "$spans + 1", step: [0, 0, "(2 * $hl - 0.5) / $spans"] }, mirror: "Knee_R{i}", material: solid(f.frame) }),
    ]));
    kids.push(box("Planter_L", [0.5, 0.5, 0.5], { anchor: "bottom", at: ["-$hw - 0.4", 0.1, "$hl"], mirror: "Planter_R", material: "terracotta", bevel: 0.03 }));
  } else {
    kids.push(group("Roof", [
      box("Beam_L", [0.1, 0.25, "2 * $hl + 0.4"], { at: ["-$hw", "$h + 0.2", 0], mirror: "Beam_R", material: solid(f.frame), bevel: 0.006 }),
      box("Purlin_{i}", ["2 * $hw + 0.4", 0.15, 0.08], { at: [0, "$h + 0.39", "-$hl - 0.1"], repeat: { count: "floor(2 * $hl / 1.2) + 1", step: [0, 0, "(2 * $hl + 0.2) / floor(2 * $hl / 1.2)"] }, material: solid(f.frame) }),
      box("Sheet", ["2 * $hw + 0.6", 0.04, "2 * $hl + 0.6"], { at: [0, "$h + 0.48", 0], material: f.roof }),
      ...(sheetRib(f.roof) ? [box("SheetRib_{i}", [0.05, 0.04, "2 * $hl + 0.6"], { at: ["-$hw - 0.3 + 0.165", "$h + 0.52", 0], repeat: { count: "floor((2 * $hw + 0.6) / 0.33)", step: [0.33, 0, 0] }, material: f.roof })] : []),
      box("Fascia_F", ["2 * $hw + 0.64", 0.22, 0.04], { at: [0, "$h + 0.47", "$hl + 0.32"], material: f.trim }),
      box("Fascia_B", ["2 * $hw + 0.64", 0.22, 0.04], { at: [0, "$h + 0.47", "-$hl - 0.32"], material: f.trim }),
      box("Fascia_L", [0.04, 0.22, "2 * $hl + 0.64"], { at: ["-$hw - 0.32", "$h + 0.47", 0], mirror: "Fascia_R", material: f.trim }),
      cyl("Gutter", 0.06, "2 * $hl + 0.6", { axis: "z", at: ["$hw + 0.4", "$h + 0.4", 0], segments: 10, material: "zinc" }),
      cyl("Downpipe", 0.04, "$h + 0.3", { anchor: "base", at: ["$hw + 0.4", 0.1, "-$hl + 0.05"], segments: 8, material: "zinc" }),
    ]));
    kids.push(box("Kerb", [0.15, 0.12, 1.2], { anchor: "bottom", at: [0, 0.1, "-$hl + 0.4"], material: "concrete", rotate: [0, 90, 0] }));
  }
  return kids;
}

function gazebo(style: Style, f: (typeof FINISHES)[Style][number]): AssetDraft {
  const s = STYLES[style];
  const poly = style === "hexagonal" || style === "bandstand";
  const kids = poly ? polygonal(style, f) : rectangular(style, f);
  const params = poly
    ? [
      num("radius", s.r[2], s.r[0], s.r[1], "Distance from the centre to each post in metres."),
      num("height", s.h[2], s.h[0], s.h[1], "Clear height of the posts in metres."),
      num("rise", style === "bandstand" ? 2 : 1.5, style === "bandstand" ? 1.5 : 1.1, style === "bandstand" ? 2.6 : 2, "Height of the roof above the eaves in metres."),
    ]
    : [
      num("width", s.r[2], s.r[0], s.r[1], "Width between the posts along x in metres."),
      num("length", style === "carport" ? 5.2 : 3.6, style === "carport" ? 4.8 : 2.5, style === "carport" ? 6.5 : 5, "Length along z in metres."),
      num("height", s.h[2], s.h[0], s.h[1], "Clear height of the posts in metres."),
      int("spans", 1, 1, 2, "Bays between posts along each side."),
    ];
  const names = [f.frame, f.roof, f.floor, f.trim, "brass", "cast_iron", "bulb_warm", "galvanised", "zinc", "concrete", "terracotta"];
  const materials: Record<string, MaterialDef> = {};
  for (const n of names) materials[n] = BMATS[n] ?? (mats(n)[n] as MaterialDef);
  const title = { hexagonal: "hexagonal gazebo", bandstand: "octagonal bandstand", pergola: "pergola", carport: "carport" }[style];
  return {
    slug: slugify("gazebo", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${title}`,
    description: `A ${f.text} ${title}: ${s.text}. Its front faces +z.`,
    tags: [style, f.id, f.nl, ...(style === "bandstand" ? ["muziektent", "kiosk"] : style === "pergola" ? ["pergola", "overkapping"] : style === "carport" ? ["carport", "autoafdak"] : ["prieel", "tuinhuis", "paviljoen"])],
    params,
    materials,
    nodes: [group("Gazebo", kids, { vars: poly ? { R: "$radius", h: "$height", nn: s.n } : { hw: "$width / 2", hl: "$length / 2", h: "$height" } })],
  };
}

export const gazeboFamily: Family = {
  id: "gazebo",
  category: "buildings",
  archetype: "building.gazebo",
  tags: ["gazebo", "prieel", "pavilion", "paviljoen", "garden", "tuin", "shelter"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => FINISHES[style].map((f) => gazebo(style, f))),
};
