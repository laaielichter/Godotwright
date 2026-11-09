import { box, cyl, extrude, group, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { bmats, flatRoof, gableRoof, hingedDoor, sheetRib, solid, windowUnit } from "./shared.js";

const STYLES = {
  apex: { text: "an apex garden shed with shiplap walls on bearers, a pitched roof over the door gable, corner trims and a side window", nl: ["tuinschuur", "tuinhuisje"], w: [1.8, 3, 2.2], d: [2, 3.6, 2.6], h: [1.8, 2.2, 2] },
  pent: { text: "a pent shed with a single sloping roof falling to the back, a door and a long high window in the front", nl: ["lessenaarsdak", "berging"], w: [2, 4, 3], d: [1.6, 2.6, 2], h: [1.9, 2.3, 2.1] },
  garage: { text: "a single garage with an up-and-over door, a flat roof with a fascia, a side door and a side window", nl: ["garage", "garagebox"], w: [2.8, 3.6, 3.1], d: [5, 6.5, 5.6], h: [2.3, 2.8, 2.5] },
  cabin: { text: "a log cabin of round notched logs with crossing corners, a deep front overhang, double doors and windows each side", nl: ["blokhut", "houten huisje"], w: [3, 5, 4], d: [3, 4.5, 3.5], h: [2, 2.5, 2.2] },
  workshop: { text: "a corrugated metal workshop with a steel frame, a pitched roof, wide double doors, a side window and a roof vent", nl: ["werkplaats", "loods"], w: [3.5, 6, 4.5], d: [4, 8, 6], h: [2.4, 3.2, 2.8] },
} as const;
type Style = keyof typeof STYLES;

const FINISHES: Record<Style, { id: string; wall: string; roof: string; trim: string; door: string; text: string; nl: string }[]> = {
  apex: [
    { id: "sage", wall: "cladding_green", roof: "felt_black", trim: "paint_cream", door: "cladding_green", text: "sage green", nl: "groen" },
    { id: "natural", wall: "pine", roof: "felt_black", trim: "pine", door: "pine", text: "natural pine", nl: "grenen" },
    { id: "grey", wall: "cladding_grey", roof: "shingle_wood", trim: "paint_white", door: "cladding_grey", text: "grey", nl: "grijs" },
    { id: "red", wall: "cladding_red", roof: "slate_grey", trim: "paint_white", door: "cladding_red", text: "red", nl: "rood" },
    { id: "cream", wall: "cladding_cream", roof: "shingle_green", trim: "paint_forest", door: "cladding_cream", text: "cream", nl: "crème" },
  ],
  pent: [
    { id: "black", wall: "cladding_black", roof: "felt_black", trim: "light_oak", door: "cladding_black", text: "black", nl: "zwart" },
    { id: "pine", wall: "pine", roof: "corrugated", trim: "pine", door: "pine", text: "pine", nl: "grenen" },
    { id: "blue", wall: "cladding_blue", roof: "felt_black", trim: "paint_white", door: "cladding_blue", text: "blue", nl: "blauw" },
    { id: "weathered", wall: "weathered_wood", roof: "corrugated_green", trim: "weathered_wood", door: "weathered_wood", text: "weathered", nl: "verweerd" },
  ],
  garage: [
    { id: "brick", wall: "brick_red", roof: "felt_black", trim: "paint_white", door: "paint_white", text: "red brick", nl: "baksteen" },
    { id: "concrete", wall: "concrete", roof: "felt_black", trim: "paint_grey", door: "galvanised", text: "concrete", nl: "beton" },
    { id: "render", wall: "render_white", roof: "felt_black", trim: "paint_anthracite", door: "paint_anthracite", text: "white rendered", nl: "wit" },
    { id: "yellow-brick", wall: "brick_yellow", roof: "felt_black", trim: "paint_white", door: "paint_green", text: "yellow brick", nl: "gele baksteen" },
  ],
  cabin: [
    { id: "honey", wall: "log", roof: "shingle_green", trim: "log_dark", door: "log_dark", text: "honey log", nl: "honingkleurig" },
    { id: "dark", wall: "log_dark", roof: "shingle_wood", trim: "log", door: "paint_red", text: "dark log", nl: "donker hout" },
    { id: "grey", wall: "weathered_wood", roof: "felt_black", trim: "paint_white", door: "paint_white", text: "silver-grey log", nl: "grijs hout" },
    { id: "red", wall: "cladding_red", roof: "slate_grey", trim: "paint_white", door: "paint_white", text: "Swedish red log", nl: "zweeds rood" },
  ],
  workshop: [
    { id: "galvanised", wall: "corrugated", roof: "corrugated", trim: "paint_grey", door: "corrugated", text: "galvanised", nl: "gegalvaniseerd" },
    { id: "green", wall: "corrugated_green", roof: "roof_steel", trim: "paint_white", door: "corrugated_green", text: "green", nl: "groen" },
    { id: "red", wall: "corrugated_red", roof: "roof_steel", trim: "paint_cream", door: "corrugated_red", text: "rust red", nl: "roestrood" },
  ],
};

const GLASS = "window_glass";

function shed(style: Style, f: (typeof FINISHES)[Style][number]): AssetDraft {
  const s = STYLES[style];
  const kids: SpecNode[] = [];
  const base = style === "apex" || style === "pent" || style === "cabin" ? 0.12 : 0;
  let roofRiseParam: [number, number, number] | undefined;
  // Floor bearers and walls.
  if (base) {
    kids.push(box("Bearer_{i}", [0.07, base, "2 * $hd"], { anchor: "bottom", at: ["-$hw + 0.1", 0, 0], repeat: { count: 3, step: ["$hw - 0.1", 0, 0] }, material: "weathered_wood" }));
  }
  if (style === "cabin") {
    // Round logs: a core box and log courses on all four walls, crossing at the corners.
    kids.push(group("Walls", [
      box("Core", ["2 * $hw - 0.1", "$wallH", "2 * $hd - 0.1"], { anchor: "bottom", at: [0, base, 0], material: f.wall }),
      cyl("LogF_{i}", 0.09, "2 * $hw + 0.35", { axis: "x", at: [0, `${base} + 0.09`, "$hd - 0.06"], repeat: { count: "floor($wallH / 0.17)", step: [0, 0.17, 0] }, segments: 10, material: solid(f.wall) }),
      cyl("LogB_{i}", 0.09, "2 * $hw + 0.35", { axis: "x", at: [0, `${base} + 0.09`, "-$hd + 0.06"], repeat: { count: "floor($wallH / 0.17)", step: [0, 0.17, 0] }, segments: 10, material: solid(f.wall) }),
      cyl("LogL_{i}", 0.09, "2 * $hd + 0.35", { axis: "z", at: ["-$hw + 0.06", `${base} + 0.17`, 0], repeat: { count: "floor($wallH / 0.17)", step: [0, 0.17, 0] }, segments: 10, material: solid(f.wall) }),
      cyl("LogR_{i}", 0.09, "2 * $hd + 0.35", { axis: "z", at: ["$hw - 0.06", `${base} + 0.17`, 0], repeat: { count: "floor($wallH / 0.17)", step: [0, 0.17, 0] }, segments: 10, material: solid(f.wall) }),
    ]));
  } else {
    kids.push(box("Walls", ["2 * $hw", "$wallH", "2 * $hd"], { anchor: "bottom", at: [0, base, 0], material: f.wall, bevel: style === "garage" ? 0.02 : 0.01 }));
  }
  if (style === "apex" || style === "pent") {
    kids.push(box("Corner_FL", [0.06, "$wallH", 0.06], { anchor: "bottom", at: ["-$hw", base, "$hd"], mirror: "Corner_FR", material: solid(f.trim), bevel: 0.005 }));
    kids.push(box("Corner_BL", [0.06, "$wallH", 0.06], { anchor: "bottom", at: ["-$hw", base, "-$hd"], mirror: "Corner_BR", material: solid(f.trim), bevel: 0.005 }));
    kids.push(box("Board_{i}", ["2 * $hw + 0.01", 0.018, "2 * $hd + 0.01"], { at: [0, `${base} + 0.15`, 0], repeat: { count: "floor($wallH / 0.15)", step: [0, 0.15, 0] }, material: f.wall }));
  }
  if (style === "workshop") {
    kids.push(box("Rib_{i}", ["2 * $hw + 0.03", "$wallH", 0.03], { anchor: "bottom", at: [0, 0, "-$hd + 0.2"], repeat: { count: "floor(($depth - 0.2) / 0.4)", step: [0, 0, 0.4] }, material: f.wall }));
    kids.push(box("Column_FL", [0.12, "$wallH", 0.12], { anchor: "bottom", at: ["-$hw - 0.03", 0, "$hd - 0.03"], mirror: "Column_FR", material: "paint_grey", bevel: 0.005 }));
    kids.push(box("Column_BL", [0.12, "$wallH", 0.12], { anchor: "bottom", at: ["-$hw - 0.03", 0, "-$hd + 0.03"], mirror: "Column_BR", material: "paint_grey", bevel: 0.005 }));
    kids.push(box("Apron", [3.4, 0.08, 1.2], { anchor: "bottom", at: [0, 0, "$hd + 0.6"], material: "concrete", bevel: 0.01 }));
  }
  if (style === "garage") {
    kids.push(box("Pier_L", [0.36, "$wallH", 0.36], { anchor: "bottom", at: ["-$hw - 0.04", 0, "$hd - 0.14"], mirror: "Pier_R", material: f.wall, bevel: 0.01 }));
    kids.push(box("Lintel", ["2 * $hw + 0.1", 0.25, 0.3], { at: [0, "$wallH - 0.1", "$hd + 0.03"], material: "concrete", bevel: 0.01 }));
    kids.push(box("Drive", ["2 * $hw", 0.05, 1.5], { anchor: "bottom", at: [0, 0, "$hd + 0.75"], material: "concrete", bevel: 0.01 }));
  }

  // Roofs.
  const top = `${base} + $wallH`;
  if (style === "apex" || style === "workshop") {
    kids.push(gableRoof("Roof", { hw: "$hw", hd: "$hd", y: top, rise: "$rise", roof: f.roof, trim: f.trim, gable: f.wall, oh: 0.12, ohg: 0.12, t: 0.06, gutter: style === "workshop" ? "galvanised" : undefined }));
    roofRiseParam = style === "apex" ? [0.4, 0.8, 0.55] : [0.6, 1.4, 0.9];
  } else if (style === "cabin") {
    kids.push(gableRoof("Roof", { hw: "$hw", hd: "$hd + 0.45", y: top, rise: "$rise", roof: f.roof, trim: f.trim, gable: f.wall, oh: 0.25, ohg: 0.15, t: 0.1, at: [0, 0, 0.45] }));
    kids.push(box("Deck", ["2 * $hw + 0.2", 0.12, 1.0], { anchor: "bottom", at: [0, 0, "$hd + 0.48"], material: f.trim, bevel: 0.01 }));
    kids.push(cyl("PorchPost_L", 0.07, `${top} - 0.06`, { anchor: "base", at: ["-$hw + 0.05", 0.06, "$hd + 0.85"], mirror: "PorchPost_R", segments: 10, material: solid(f.wall) }));
    roofRiseParam = [0.9, 1.6, 1.2];
  } else if (style === "pent") {
    kids.push(group("Roof", [
      extrude("Wedge", [[0, "-$hd"], [0, "$hd"], ["$rise", "$hd"], [0.01, "-$hd"]], "-$hw", "$hw", { at: [0, `${top} - 0.01`, 0], rotate: [0, 0, 90], material: f.wall }),
      box("Sheet", ["2 * $hw + 0.3", 0.05, "hypot(2 * $hd + 0.5, $rise)"], { at: [0, `${top} + $rise / 2 + 0.03`, 0], rotate: ["-deg(atan($rise / (2 * $hd)))", 0, 0], material: f.roof, bevel: 0.005 }),
      ...(sheetRib(f.roof) ? [box("SheetRib_{i}", [0.05, 0.04, "hypot(2 * $hd + 0.5, $rise)"], { at: ["-$hw - 0.15 + 0.165", `${top} + $rise / 2 + 0.03 + 0.04 * cos(atan($rise / (2 * $hd)))`, "-0.04 * sin(atan($rise / (2 * $hd)))"], rotate: ["-deg(atan($rise / (2 * $hd)))", 0, 0], repeat: { count: "floor((2 * $hw + 0.3) / 0.33)", step: [0.33, 0, 0] }, material: f.roof })] : []),
      box("Fascia", ["2 * $hw + 0.32", 0.14, 0.03], { at: [0, `${top} + $rise + 0.06`, "$hd + 0.25"], material: f.trim }),
    ]));
    roofRiseParam = [0.25, 0.6, 0.4];
  } else {
    kids.push(flatRoof("Roof", { hw: "$hw", hd: "$hd", y: top, oh: 0.12, deck: f.roof, edge: f.trim }));
    roofRiseParam = undefined;
  }

  // Doors.
  if (style === "garage") {
    kids.push(group("Door", [
      box("Leaf", [2.3, "$wallH - 0.3", 0.05], { at: [0, "-($wallH - 0.3) / 2", 0.025], material: f.door, bevel: 0.006 }),
      box("Rib_{i}", [2.26, 0.03, 0.02], { at: [0, "-0.25 - $i * ($wallH - 0.6) / 5", 0.06], repeat: { count: 6, step: [0, 0, 0] }, material: f.door }),
      box("Handle", [0.16, 0.05, 0.05], { at: [0, "-($wallH - 0.3) + 0.25", 0.07], material: "brushed_steel", bevel: 0.01 }),
      cyl("Lock", 0.025, 0.03, { axis: "z", at: [0, "-($wallH - 0.3) + 0.35", 0.065], material: "brass", segments: 10 }),
    ], { at: [0, "$wallH - 0.25", "$hd"] }));
    kids.push(...hingedDoor({ x: "-$hd + 1.2", y: 0.02, z: "$hw", w: 0.85, h: 2.0, leaf: f.door, frame: f.trim, metal: "brushed_steel", kind: "flush" }, "SideDoor").map((n, k) => group(k === 0 ? "EastHinge" : "EastTrim", [n], { rotate: [0, 90, 0] })));
  } else if (style === "cabin" || style === "workshop") {
    const leafW = style === "cabin" ? 0.7 : 1.1;
    const leafH = style === "cabin" ? 1.85 : 2.3;
    const z = style === "cabin" ? "$hd + 0.08" : "$hd";
    const [left] = hingedDoor({ x: -leafW / 2, y: base + 0.01, z, w: leafW, h: leafH, leaf: f.door, frame: f.trim, metal: style === "cabin" ? "black_steel" : "galvanised", glass: GLASS, kind: style === "cabin" ? "glazed" : "plank" }, "Door_L", false);
    kids.push({ ...(left as SpecNode), mirror: "Door_R" });
    kids.push(group("Surround", [
      box("Post_L", [0.1, leafH + 0.1, 0.12], { anchor: "bottom", at: [-leafW - 0.05, 0, 0.04], mirror: "Post_R", material: solid(f.trim), bevel: 0.006 }),
      box("Head", [2 * leafW + 0.3, 0.12, 0.14], { at: [0, leafH + 0.1, 0.05], material: solid(f.trim), bevel: 0.006 }),
    ], { at: [0, base, z] }));
  } else {
    const x = style === "pent" ? "-$hw + 0.6" : 0;
    kids.push(...hingedDoor({ x, y: base + 0.01, z: "$hd", w: 0.75, h: "min(1.8, $wallH - 0.15)", leaf: f.door, frame: f.trim, metal: "black_steel", kind: "plank" }));
  }

  // Windows.
  if (style === "apex") kids.push(windowUnit("Window", { at: ["$hw", `${base} + $wallH * 0.62`, "$hd * 0.2"], rotate: [0, 90, 0], w: "min(1.2, $depth * 0.4)", h: 0.5, frame: f.trim, glass: GLASS, sill: f.trim, bars: "cross" }));
  if (style === "pent") kids.push(windowUnit("Window", { at: ["$hw * 0.3", `${base} + $wallH * 0.78`, "$hd"], w: "$hw * 0.9", h: 0.35, frame: f.trim, glass: GLASS, sill: f.trim, bars: "mullion" }));
  if (style === "garage") kids.push(windowUnit("Window", { at: ["-$hw", "$wallH * 0.62", "-$hd * 0.3"], rotate: [0, -90, 0], w: 1.0, h: 0.6, frame: f.trim, glass: GLASS, sill: "concrete", bars: "mullion" }));
  if (style === "cabin") kids.push(windowUnit("Window_L", { at: ["-$hw * 0.6", `${base} + $wallH * 0.55`, "$hd + 0.12"], w: "$hw * 0.4", h: 0.75, frame: f.trim, glass: GLASS, sill: f.trim, bars: "cross", mirror: "Window_R" }));
  if (style === "workshop") {
    kids.push(windowUnit("Window_{i}", { at: ["$hw + 0.02", "$wallH * 0.65", "-$hd + $depth / 3"], rotate: [0, 90, 0], w: 1.2, h: 0.7, frame: f.trim, glass: GLASS, sill: f.trim, bars: "cross", repeat: { count: 2, step: [0, 0, "$depth / 3"] } }));
    kids.push(cyl("Vent", 0.18, 0.5, { anchor: "base", at: [0, "$wallH + $rise - 0.1", "-$hd * 0.4"], material: "galvanised", segments: 14, bevel: 0.02 }));
    kids.push(cyl("VentCap", 0.28, 0.08, { at: [0, "$wallH + $rise + 0.44", "-$hd * 0.4"], material: "galvanised", segments: 14, bevel: 0.02 }));
  }

  const params = [
    num("width", s.w[2], s.w[0], s.w[1], "Width along x in metres."),
    num("depth", s.d[2], s.d[0], s.d[1], "Depth along z in metres."),
    num("wallHeight", s.h[2], s.h[0], s.h[1], "Height of the walls (the eaves) in metres."),
  ];
  if (roofRiseParam) params.push(num("rise", roofRiseParam[2], roofRiseParam[0], roofRiseParam[1], "Height of the roof above the eaves in metres."));
  const names = new Set<string>([f.wall, f.roof, f.trim, f.door, "weathered_wood", "black_steel", "brushed_steel", "brass", "galvanised", "concrete", "paint_grey", GLASS]);
  const palette = [...names].filter((n) => !n.startsWith("cladding") && !["felt_black", "shingle_wood", "shingle_green", "slate_grey", "corrugated", "corrugated_green", "corrugated_red", "roof_steel", "render_white", "log", "log_dark", GLASS].includes(n));
  const own = [...names].filter((n) => !palette.includes(n));
  const title = { apex: "apex garden shed", pent: "pent shed", garage: "garage", cabin: "log cabin", workshop: "workshop" }[style];
  return {
    slug: slugify("shed", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${title}`,
    description: `A ${f.text} ${title}: ${s.text}. The door faces +z.`,
    tags: [style, f.id, f.nl, ...s.nl],
    params,
    materials: { ...mats(...palette), ...bmats(...own) },
    nodes: [group("Shed", kids, { vars: { hw: "$width / 2", hd: "$depth / 2", wallH: "$wallHeight" } })],
  };
}

export const shedFamily: Family = {
  id: "shed",
  category: "buildings",
  archetype: "building.shed",
  tags: ["shed", "schuur", "schuurtje", "outbuilding", "bijgebouw", "garden", "tuin"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => FINISHES[style].map((f) => shed(style, f))),
};
