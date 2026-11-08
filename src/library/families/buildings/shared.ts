/**
 * Shared builders for the buildings families: roofs, windows, doors and chimneys as spec nodes. Every size may be an
 * expression ("$width / 2"), so the parts follow the asset's parameters. Local frames: a window or door is built on a
 * wall surface at z = 0 and faces +z; turn its group to put it on another wall.
 */
import { box, cyl, extrude, group, roof, tube, type Family, type Num, type SpecNode, type Vec } from "../../kit.js";
import type { MaterialDef } from "../../palette.js";

/**
 * Building materials the palette does not have (roofing, glazing, render), in real-world linear albedos: Dutch clay
 * tiles and slate are dark, render is off-white (never paper white), brick is a deep red-brown with mortar joints.
 */
export const BMATS: Record<string, MaterialDef> = {
  tile_red: { color: [0.2, 0.052, 0.028], metallic: 0, roughness: 0.72, texture: "roof_tile" },
  tile_brown: { color: [0.085, 0.042, 0.028], metallic: 0, roughness: 0.75, texture: "roof_tile" },
  tile_black: { color: [0.03, 0.03, 0.033], metallic: 0, roughness: 0.42, texture: "roof_tile" },
  tile_orange: { color: [0.24, 0.07, 0.03], metallic: 0, roughness: 0.75, texture: "roof_tile" },
  slate_grey: { color: [0.042, 0.046, 0.052], metallic: 0, roughness: 0.62, texture: "roof_slate" },
  slate_blue: { color: [0.036, 0.043, 0.058], metallic: 0, roughness: 0.58, texture: "roof_slate" },
  shingle_wood: { color: [0.14, 0.1, 0.068], metallic: 0, roughness: 0.9, texture: "roof_slate" },
  shingle_green: { color: [0.032, 0.065, 0.042], metallic: 0, roughness: 0.85, texture: "roof_slate" },
  thatch: { color: [0.2, 0.15, 0.08], metallic: 0, roughness: 1, texture: "grass" },
  felt_black: { color: [0.03, 0.03, 0.032], metallic: 0, roughness: 0.9, texture: "asphalt" },
  zinc: { color: [0.3, 0.31, 0.32], metallic: 0.4, roughness: 0.55, texture: "brushed" },
  zinc_quartz: { color: [0.11, 0.115, 0.12], metallic: 0.3, roughness: 0.5, texture: "brushed" },
  corrugated: { color: [0.27, 0.28, 0.285], metallic: 0.35, roughness: 0.65, texture: "brushed" },
  corrugated_red: { color: [0.19, 0.035, 0.025], metallic: 0.25, roughness: 0.55, texture: "painted" },
  corrugated_green: { color: [0.03, 0.085, 0.045], metallic: 0.25, roughness: 0.55, texture: "painted" },
  window_glass: { color: [0.028, 0.036, 0.046], metallic: 0.4, roughness: 0.04 },
  reveal_dark: { color: [0.045, 0.043, 0.04], metallic: 0, roughness: 0.9, texture: "plaster" },
  render_white: { color: [0.5, 0.49, 0.45], metallic: 0, roughness: 0.92, texture: "plaster" },
  render_cream: { color: [0.52, 0.45, 0.32], metallic: 0, roughness: 0.92, texture: "plaster" },
  render_grey: { color: [0.28, 0.28, 0.27], metallic: 0, roughness: 0.92, texture: "plaster" },
  render_pink: { color: [0.46, 0.27, 0.21], metallic: 0, roughness: 0.92, texture: "plaster" },
  render_blue: { color: [0.22, 0.29, 0.34], metallic: 0, roughness: 0.92, texture: "plaster" },
  cladding_black: { color: [0.03, 0.03, 0.03], metallic: 0, roughness: 0.75, texture: "wood" },
  cladding_red: { color: [0.19, 0.032, 0.022], metallic: 0, roughness: 0.82, texture: "wood" },
  cladding_grey: { color: [0.19, 0.2, 0.2], metallic: 0, roughness: 0.8, texture: "wood" },
  cladding_green: { color: [0.035, 0.09, 0.055], metallic: 0, roughness: 0.8, texture: "wood" },
  cladding_blue: { color: [0.05, 0.1, 0.17], metallic: 0, roughness: 0.8, texture: "wood" },
  cladding_cream: { color: [0.5, 0.45, 0.34], metallic: 0, roughness: 0.8, texture: "wood" },
  log: { color: [0.26, 0.16, 0.075], metallic: 0, roughness: 0.85, texture: "wood" },
  log_dark: { color: [0.13, 0.075, 0.04], metallic: 0, roughness: 0.85, texture: "wood" },
};

/**
 * Palette finishes recalibrated for buildings seen from a distance under a sun: the palette's bricks, stones, pale
 * woods and whites are tuned for furniture-scale props and read pink, chalky or paper white on a facade. The buildings
 * index applies these to every asset of the category (see `tuneBuildings`).
 */
export const BUILDING_OVERRIDES: Record<string, MaterialDef> = {
  brick_red: { color: [0.19, 0.058, 0.034], metallic: 0, roughness: 0.88, texture: "brick" },
  brick_brown: { color: [0.095, 0.045, 0.028], metallic: 0, roughness: 0.88, texture: "brick" },
  brick_yellow: { color: [0.38, 0.28, 0.14], metallic: 0, roughness: 0.88, texture: "brick" },
  limestone: { color: [0.4, 0.385, 0.34], metallic: 0, roughness: 0.85, texture: "stone" },
  sandstone: { color: [0.34, 0.24, 0.13], metallic: 0, roughness: 0.9, texture: "stone" },
  granite: { color: [0.19, 0.185, 0.18], metallic: 0, roughness: 0.8, texture: "stone" },
  slate: { color: [0.06, 0.065, 0.075], metallic: 0, roughness: 0.7, texture: "stone" },
  plaster_white: { color: [0.5, 0.49, 0.45], metallic: 0, roughness: 0.92, texture: "plaster" },
  terracotta: { color: [0.26, 0.08, 0.04], metallic: 0, roughness: 0.85, texture: "plaster" },
  concrete: { color: [0.32, 0.31, 0.29], metallic: 0, roughness: 0.9, texture: "concrete" },
  concrete_dark: { color: [0.16, 0.16, 0.155], metallic: 0, roughness: 0.9, texture: "concrete" },
  paint_white: { color: [0.6, 0.6, 0.57], metallic: 0, roughness: 0.45, texture: "painted" },
  paint_cream: { color: [0.55, 0.49, 0.36], metallic: 0, roughness: 0.5, texture: "painted" },
  paint_orange: { color: [0.45, 0.12, 0.02], metallic: 0, roughness: 0.45, texture: "painted" },
  paint_teal: { color: [0.02, 0.15, 0.15], metallic: 0, roughness: 0.45, texture: "painted" },
  paint_red: { color: [0.36, 0.03, 0.025], metallic: 0, roughness: 0.45, texture: "painted" },
  paint_green: { color: [0.03, 0.12, 0.045], metallic: 0, roughness: 0.45, texture: "painted" },
  pine: { color: [0.42, 0.28, 0.14], metallic: 0, roughness: 0.75, texture: "wood" },
  light_oak: { color: [0.38, 0.25, 0.12], metallic: 0, roughness: 0.7, texture: "wood" },
  oak: { color: [0.28, 0.16, 0.07], metallic: 0, roughness: 0.7, texture: "wood" },
  teak: { color: [0.26, 0.14, 0.06], metallic: 0, roughness: 0.75, texture: "wood" },
  aged_copper: { color: [0.075, 0.17, 0.13], metallic: 0.15, roughness: 0.75, texture: "rust" },
  aluminium: { color: [0.62, 0.63, 0.64], metallic: 0.8, roughness: 0.42, texture: "brushed" },
  galvanised: { color: [0.36, 0.37, 0.38], metallic: 0.4, roughness: 0.6, texture: "brushed" },
  glass_frosted: { color: [0.35, 0.42, 0.45, 0.45], metallic: 0, roughness: 0.15, alpha: "BLEND" },
  glass_clear: { color: [0.3, 0.38, 0.42, 0.3], metallic: 0, roughness: 0.05, alpha: "BLEND" },
  plastic_white: { color: [0.58, 0.58, 0.56], metallic: 0, roughness: 0.5, texture: "plastic" },
};

/** Applies BUILDING_OVERRIDES to the materials of every asset of a family. */
export function tuneBuildings(family: Family): Family {
  return {
    ...family,
    assets: () => family.assets().map((a) => {
      const materials = Object.fromEntries(Object.entries(a.materials).map(([k, m]) => [k, BUILDING_OVERRIDES[k] ?? m]));
      // The shared builders (window reveals, ...) may use building materials the family did not list.
      for (const [, name] of JSON.stringify(a.nodes).matchAll(/"material":"([a-z0-9_]+)"/g)) {
        if (name && !materials[name] && BMATS[name]) materials[name] = BMATS[name];
      }
      return { ...a, materials };
    }),
  };
}

/** Picks materials from BMATS by name. */
export function bmats(...names: string[]): Record<string, MaterialDef> {
  const out: Record<string, MaterialDef> = {};
  for (const n of names) {
    const m = BMATS[n];
    if (!m) throw new Error(`buildings: no material "${n}"`);
    out[n] = m;
  }
  return out;
}

export interface GableOpts {
  /** Half the span across the slopes (to the wall face), half the length along the ridge. */
  hw: Num;
  hd: Num;
  /** Height of the eaves (top of the walls) and of the ridge above it. */
  y: Num;
  rise: Num;
  /** Overhang at the eaves and at the gable ends; slab thickness. */
  oh?: Num;
  ohg?: Num;
  t?: Num;
  roof: string;
  trim: string;
  /** Material of the triangular gable ends; none leaves them out (a lean-to wall closes them). */
  gable?: string;
  /** Ridge along z (default) or along x. */
  along?: "x" | "z";
  gutter?: string;
  at?: Vec;
}

/**
 * A pitched roof with two slabs, a ridge roll, barge boards, fascias, gutters and the two triangular gable ends.
 * Built with the ridge along z; along x turns the whole group (then hw is half the depth, hd half the width).
 */
export function gableRoof(name: string, o: GableOpts): SpecNode {
  const slabX = "-($gw + $go) / 2 - $gt / 2 * sin($gth)";
  const slabY = "$gy + $gr * (1 - ($gw + $go) / (2 * $gw)) + $gt / 2 * cos($gth)";
  const len = "2 * ($gd + $gg)";
  const eave = "$gy - $gr * $go / $gw";
  const kids: SpecNode[] = [
    box("Slope_L", ["$gS", "$gt", len], { at: [slabX, slabY, 0], rotate: [0, 0, "deg($gth)"], mirror: "Slope_R", material: o.roof, bevel: 0.01 }),
    cyl("RidgeRoll", "$gt * 0.95", `${len} + 0.06`, { axis: "z", at: [0, "$gy + $gr + $gt / cos($gth) * 0.62", 0], segments: 12, material: o.roof }),
    box("Barge_FL", ["$gS + 0.04", "$gt + 0.12", 0.05], { at: [`${slabX} + 0.06 * sin($gth)`, `${slabY} - 0.06 * cos($gth)`, "$gd + $gg + 0.02"], rotate: [0, 0, "deg($gth)"], mirror: "Barge_FR", material: o.trim, bevel: 0.008 }),
    box("Barge_BL", ["$gS + 0.04", "$gt + 0.12", 0.05], { at: [`${slabX} + 0.06 * sin($gth)`, `${slabY} - 0.06 * cos($gth)`, "-$gd - $gg - 0.02"], rotate: [0, 0, "deg($gth)"], mirror: "Barge_BR", material: o.trim, bevel: 0.008 }),
    box("Fascia_L", [0.04, "0.12 + $gt * 0.8", len], { at: ["-$gw - $go - 0.02", `${eave} - 0.06 + $gt * 0.4`, 0], mirror: "Fascia_R", material: o.trim, bevel: 0.006 }),
  ];
  if (o.gutter) {
    kids.push(cyl("Gutter_L", 0.06, len, { axis: "z", at: ["-$gw - $go - 0.09", `${eave} - 0.04`, 0], segments: 10, mirror: "Gutter_R", material: o.gutter }));
  }
  if (o.gable) {
    kids.push(extrude("Gable", [["-$gw", -0.03], ["$gw", -0.03], [0, "$gr"]], "-$gd", "$gd", { at: [0, "$gy", 0], rotate: [-90, 0, 0], material: o.gable }));
  }
  return group(name, kids, {
    at: o.at,
    rotate: o.along === "x" ? [0, 90, 0] : undefined,
    vars: { gw: o.hw, gd: o.hd, gy: o.y, gr: o.rise, go: o.oh ?? 0.35, gg: o.ohg ?? 0.3, gt: o.t ?? 0.14, gth: "atan($gr / $gw)", gS: "($gw + $go) / cos($gth)" },
  });
}

/** A hipped roof (four slopes) on walls of half-size hw x hd, with fascia boards and gutters round the eaves. */
export function hipRoof(name: string, o: { hw: Num; hd: Num; y: Num; rise: Num; oh?: Num; roof: string; trim: string; gutter?: string; at?: Vec }): SpecNode {
  const kids: SpecNode[] = [
    roof("Hip", { x0: "-$hw2 - $ho", x1: "$hw2 + $ho", z0: "-$hd2 - $ho", z1: "$hd2 + $ho", y: "$hy", rise: "$hr", kind: "hip" }, { material: o.roof }),
    box("Fascia_L", [0.05, 0.22, "2 * ($hd2 + $ho) + 0.1"], { at: ["-$hw2 - $ho - 0.025", "$hy - 0.08", 0], mirror: "Fascia_R", material: o.trim, bevel: 0.006 }),
    box("Fascia_F", ["2 * ($hw2 + $ho)", 0.22, 0.05], { at: [0, "$hy - 0.08", "$hd2 + $ho + 0.025"], material: o.trim, bevel: 0.006 }),
    box("Fascia_B", ["2 * ($hw2 + $ho)", 0.22, 0.05], { at: [0, "$hy - 0.08", "-$hd2 - $ho - 0.025"], material: o.trim, bevel: 0.006 }),
    box("Soffit", ["2 * ($hw2 + $ho)", 0.04, "2 * ($hd2 + $ho)"], { at: [0, "$hy - 0.17", 0], material: o.trim }),
  ];
  if (o.gutter) {
    kids.push(cyl("Gutter_L", 0.06, "2 * ($hd2 + $ho) + 0.1", { axis: "z", at: ["-$hw2 - $ho - 0.1", "$hy - 0.05", 0], segments: 10, mirror: "Gutter_R", material: o.gutter }));
    kids.push(cyl("Gutter_F", 0.06, "2 * ($hw2 + $ho) + 0.3", { axis: "x", at: [0, "$hy - 0.05", "$hd2 + $ho + 0.1"], segments: 10, material: o.gutter }));
  }
  return group(name, kids, { at: o.at, vars: { hw2: o.hw, hd2: o.hd, hy: o.y, hr: o.rise, ho: o.oh ?? 0.45 } });
}

/** A flat roof: a slab with an upstand parapet or a thin overhanging edge. */
export function flatRoof(name: string, o: { hw: Num; hd: Num; y: Num; oh?: Num; deck: string; edge: string; parapet?: Num }): SpecNode {
  const kids: SpecNode[] = [box("Deck", ["2 * ($fw + $fo)", 0.2, "2 * ($fd + $fo)"], { at: [0, "$fy + 0.1", 0], material: o.deck })];
  if (o.parapet !== undefined) {
    kids.push(
      box("Coping_L", [0.3, "$fp", "2 * ($fd + $fo)"], { at: ["-$fw - $fo + 0.15", "$fy + $fp / 2 + 0.1", 0], mirror: "Coping_R", material: o.edge, bevel: 0.01 }),
      box("Coping_F", ["2 * ($fw + $fo) - 0.6", "$fp", 0.3], { at: [0, "$fy + $fp / 2 + 0.1", "$fd + $fo - 0.15"], material: o.edge, bevel: 0.01 }),
      box("Coping_B", ["2 * ($fw + $fo) - 0.6", "$fp", 0.3], { at: [0, "$fy + $fp / 2 + 0.1", "-$fd - $fo + 0.15"], material: o.edge, bevel: 0.01 }),
    );
  } else {
    kids[0] = box("Deck", ["2 * ($fw + $fo)", 0.22, "2 * ($fd + $fo)"], { at: [0, "$fy + 0.13", 0], material: o.deck });
    kids.push(box("Edge", ["2 * ($fw + $fo) + 0.04", 0.23, "2 * ($fd + $fo) + 0.04"], { at: [0, "$fy + 0.085", 0], material: o.edge, bevel: 0.01 }));
  }
  return group(name, kids, { vars: { fw: o.hw, fd: o.hd, fy: o.y, fo: o.oh ?? 0, fp: o.parapet ?? 0 } });
}

export interface WindowOpts {
  w: Num;
  h: Num;
  frame: string;
  glass: string;
  sill: string;
  /** Glazing bars: none, one mullion, a cross, or a 2x3 sash grid. */
  bars?: "none" | "mullion" | "cross" | "sash";
  shutters?: string;
  lintel?: string;
  /** A small pitched hood or a flat lintel band; default none. */
  at?: Vec;
  rotate?: Vec;
  repeat?: { count: Num; step?: Vec };
  mirror?: string;
}

/** A framed window on a wall surface (z = 0, facing +z), centred on its node: pane, frame, bars, sill and lintel. */
export function windowUnit(name: string, o: WindowOpts): SpecNode {
  const kids: SpecNode[] = [
    box("Reveal", ["$ww + 0.24", "$wh + 0.2", 0.02], { at: [0, 0, 0.006], material: "reveal_dark" }),
    box("Pane", ["$ww", "$wh", 0.04], { at: [0, 0, 0.01], material: o.glass }),
    box("Jamb_L", [0.07, "$wh + 0.02", 0.11], { at: ["-$ww / 2 - 0.03", 0, 0.045], material: o.frame, bevel: 0.006 }),
    box("Jamb_R", [0.07, "$wh + 0.02", 0.11], { at: ["$ww / 2 + 0.03", 0, 0.045], material: o.frame, bevel: 0.006 }),
    box("Head", ["$ww + 0.14", 0.07, 0.11], { at: [0, "$wh / 2 + 0.03", 0.045], material: o.frame, bevel: 0.006 }),
    box("Sill", ["$ww + 0.26", 0.06, 0.2], { at: [0, "-$wh / 2 - 0.03", 0.09], material: o.sill, bevel: 0.008 }),
    box("SillFrame", ["$ww + 0.14", 0.06, 0.11], { at: [0, "-$wh / 2 + 0.01", 0.045], material: o.frame, bevel: 0.006 }),
  ];
  const bars = o.bars ?? "mullion";
  if (bars === "mullion" || bars === "cross") kids.push(box("Mullion", [0.05, "$wh", 0.06], { at: [0, 0, 0.03], material: o.frame }));
  if (bars === "cross") kids.push(box("Transom", ["$ww", 0.05, 0.06], { at: [0, "$wh * 0.18", 0.03], material: o.frame }));
  if (bars === "sash") {
    kids.push(box("MeetingRail", ["$ww", 0.06, 0.07], { at: [0, 0, 0.035], material: o.frame }));
    kids.push(box("Bar_{i}", [0.025, "$wh", 0.05], { at: ["-$ww / 6", 0, 0.025], repeat: { count: 2, step: ["$ww / 3", 0, 0] }, material: o.frame }));
    kids.push(box("Rail_{i}", ["$ww", 0.025, 0.05], { at: [0, "-$wh / 4", 0.025], repeat: { count: 2, step: [0, "$wh / 2", 0] }, material: o.frame }));
  }
  if (o.lintel) kids.push(box("Lintel", ["$ww + 0.34", 0.16, 0.05], { at: [0, "$wh / 2 + 0.14", 0.015], material: o.lintel, bevel: 0.006 }));
  if (o.shutters) {
    for (const [side, sx] of [["L", "-"], ["R", ""]] as const) {
      kids.push(box(`Shutter_${side}`, ["$ww / 2", "$wh + 0.04", 0.04], { at: [`${sx}($ww * 0.75 + 0.09)`, 0, 0.03], material: o.shutters, bevel: 0.006 }));
      kids.push(box(`Louvre_${side}{i}`, ["$ww / 2 - 0.06", 0.025, 0.03], { at: [`${sx}($ww * 0.75 + 0.09)`, "-$wh / 2 + 0.12", 0.055], repeat: { count: 5, step: [0, "($wh - 0.2) / 4", 0] }, material: o.shutters }));
    }
  }
  return group(name, kids, { at: o.at, rotate: o.rotate, repeat: o.repeat, mirror: o.mirror, vars: { ww: o.w, wh: o.h } });
}

export interface DoorOpts {
  /** Centre of the doorway in x, bottom of the leaf, wall surface z. */
  x: Num;
  y: Num;
  z: Num;
  w: Num;
  h: Num;
  leaf: string;
  frame: string;
  metal: string;
  glass?: string;
  /** Raised panels, a glazed top light, or vertical planks with a ledge. */
  kind?: "panel" | "glazed" | "plank" | "flush";
}

/**
 * A hinged door: the node "Door" sits on its hinge line (the left edge, at the wall surface), the leaf runs off it in
 * +x, with panels, a lever handle and a letter plate. Its frame is the separate "Doorway" group, which does not move.
 */
export function hingedDoor(o: DoorOpts, name = "Door", framed = true): SpecNode[] {
  const kind = o.kind ?? "panel";
  const leaf: SpecNode[] = [box("Leaf", ["$dw", "$dh", 0.055], { at: ["$dw / 2", "$dh / 2", 0.0275], material: o.leaf, bevel: 0.006 })];
  if (kind === "panel") {
    leaf.push(box("RaisedPanel_{i}", ["$dw * 0.32", "$dh * 0.36", 0.02], { at: ["$dw * 0.27", "$dh * 0.26", 0.06], repeat: { count: 2, step: ["$dw * 0.46", 0, 0] }, material: o.leaf, bevel: 0.008 }));
    leaf.push(box("UpperPanel_{i}", ["$dw * 0.32", "$dh * 0.3", 0.02], { at: ["$dw * 0.27", "$dh * 0.7", 0.06], repeat: { count: 2, step: ["$dw * 0.46", 0, 0] }, material: o.leaf, bevel: 0.008 }));
  } else if (kind === "glazed") {
    leaf.push(box("Light", ["$dw * 0.6", "$dh * 0.38", 0.02], { at: ["$dw / 2", "$dh * 0.68", 0.06], material: o.glass ?? o.metal }));
    leaf.push(box("LowerPanel", ["$dw * 0.6", "$dh * 0.3", 0.02], { at: ["$dw / 2", "$dh * 0.25", 0.06], material: o.leaf, bevel: 0.008 }));
  } else if (kind === "plank") {
    leaf.push(box("Plank_{i}", [0.012, "$dh - 0.02", 0.012], { at: ["$dw / 5", "$dh / 2", 0.058], repeat: { count: 4, step: ["$dw / 5", 0, 0] }, material: o.frame }));
    leaf.push(box("Ledge_{i}", ["$dw - 0.06", 0.12, 0.03], { at: ["$dw / 2", "$dh * 0.15", 0.07], repeat: { count: 3, step: [0, "$dh * 0.35", 0] }, material: o.leaf, bevel: 0.006 }));
    leaf.push(box("Strap_{i}", ["$dw * 0.55", 0.04, 0.012], { at: ["$dw * 0.275", "$dh * 0.15", 0.09], repeat: { count: 2, step: [0, "$dh * 0.7", 0] }, material: o.metal }));
  } else {
    leaf.push(box("Strip", [0.08, "$dh * 0.7", 0.02], { at: ["$dw * 0.25", "$dh * 0.5", 0.06], material: o.glass ?? o.metal }));
  }
  if (kind !== "plank") {
    leaf.push(box("LetterPlate", [0.3, 0.07, 0.012], { at: ["$dw / 2", "$dh * 0.38", 0.062], material: o.metal, bevel: 0.003 }));
    leaf.push(box("KickPlate", ["$dw - 0.1", 0.16, 0.008], { at: ["$dw / 2", 0.1, 0.059], material: o.metal }));
  }
  leaf.push(
    cyl("Rose", 0.03, 0.02, { axis: "z", at: ["$dw - 0.08", "$dh * 0.47", 0.065], segments: 12, material: o.metal }),
    box("Lever", [0.12, 0.022, 0.022], { at: ["$dw - 0.13", "$dh * 0.47", 0.09], material: o.metal, bevel: 0.006 }),
    cyl("Hinge_{i}", 0.012, 0.1, { at: [0.0, "$dh * 0.12", 0.03], repeat: { count: 3, step: [0, "$dh * 0.38", 0] }, segments: 8, material: o.metal }),
  );
  const nodes: SpecNode[] = [group(name, leaf, { at: [`${o.x} - $dw / 2`, o.y, o.z], vars: { dw: o.w, dh: o.h } })];
  if (framed) {
    nodes.push(group(`${name}way`, [
      box("Casing_L", [0.1, "$dh + 0.1", 0.13], { at: ["-$dw / 2 - 0.05", "$dh / 2 + 0.05", 0.045], mirror: "Casing_R", material: o.frame, bevel: 0.008 }),
      box("Header", ["$dw + 0.3", 0.12, 0.15], { at: [0, "$dh + 0.1", 0.055], material: o.frame, bevel: 0.01 }),
      box("Threshold", ["$dw + 0.1", 0.03, 0.1], { at: [0, -0.012, 0.04], material: o.frame }),
    ], { at: [o.x, o.y, o.z], vars: { dw: o.w, dh: o.h } }));
  }
  return nodes;
}

/** A brick chimney stack with an oversailing course, a cap and pots; from y0 (inside the roof) up to y1. */
export function chimney(at: [Num, Num], y0: Num, y1: Num, brick: string, cap: string, pot: string, pots = 2): SpecNode {
  return group("Chimney", [
    box("Stack", [0.62, "$cy1 - $cy0", 0.5], { at: [0, "($cy1 + $cy0) / 2", 0], material: brick, bevel: 0.01 }),
    box("Corbel", [0.72, 0.1, 0.6], { at: [0, "$cy1 - 0.2", 0], material: brick, bevel: 0.01 }),
    box("Cap", [0.7, 0.06, 0.58], { at: [0, "$cy1 + 0.02", 0], material: cap, bevel: 0.01 }),
    cyl("Pot_{i}", 0.08, 0.32, { anchor: "base", at: [-0.14 * (pots - 1), "$cy1 + 0.04", 0], repeat: { count: pots, step: [0.28, 0, 0] }, segments: 12, material: pot, bevel: 0.01 }),
  ], { at: [at[0], 0, at[1]], vars: { cy0: y0, cy1: y1 } });
}

/** A downpipe from the gutter down a wall corner to the ground, with a shoe. */
export function downpipe(name: string, x: Num, z: Num, top: Num, metal: string, mirror?: string): SpecNode {
  return group(name, [
    cyl("Pipe", 0.04, `${typeof top === "number" ? top : `(${top})`} - 0.1`, { anchor: "base", at: [0, 0.1, 0], segments: 10, material: metal }),
    cyl("Shoe", 0.05, 0.12, { axis: "z", at: [0, 0.08, 0.04], segments: 10, material: metal }),
  ], { at: [x, 0, z], mirror });
}

/**
 * A downpipe on a wall corner (its node at the foot of the pipe, against the wall) that runs up and swan-necks out by
 * `reach` in x to the eaves gutter at height `gutterY`; brackets hold it to the wall. Mirror it for the other side.
 */
export function swanDownpipe(name: string, x: Num, z: Num, gutterY: Num, reach: Num, metal: string, mirror?: string): SpecNode {
  return group(name, [
    cyl("Pipe", 0.045, "$pgy - 0.55", { anchor: "base", at: [0, 0.08, 0], segments: 10, material: metal }),
    tube("Swan", [[0, "$pgy - 0.5", 0], ["$prx * 0.5", "$pgy - 0.32", 0], ["$prx", "$pgy - 0.14", 0], ["$prx", "$pgy - 0.02", 0]], 0.045, { segments: 10, material: metal }),
    cyl("Shoe", 0.05, 0.14, { axis: "z", at: [0, 0.09, 0.05], segments: 10, material: metal }),
    box("Bracket_{i}", [0.1, 0.04, 0.1], { at: ["-$prx / max(0.001, abs($prx)) * 0.02", 1, 0], repeat: { count: 3, step: [0, "($pgy - 1.8) / 2", 0] }, material: metal }),
  ], { at: [x, 0, z], mirror, vars: { pgy: gutterY, prx: reach } });
}

/**
 * A roof slab (a box) lying on the line from (ax, ay) to (bx, by) in the xz-plane section, its underside on that line,
 * running len along z. Mirror it for the other side of a symmetric roof.
 */
export function slab(name: string, a: [Num, Num], b: [Num, Num], t: Num, len: Num, material: string, o: { mirror?: string; z?: Num; ext?: Num } = {}): SpecNode {
  return group(name, [
    box("Sheet", ["hypot($sbx - $sax, $sby - $say) + $sext", "$st", "$slen"], { at: ["($sax + $sbx) / 2 - $st / 2 * sin($sth)", "($say + $sby) / 2 + $st / 2 * cos($sth)", o.z ?? 0], rotate: [0, 0, "deg($sth)"], material, bevel: 0.01 }),
  ], { mirror: o.mirror, vars: { sax: a[0], say: a[1], sbx: b[0], sby: b[1], st: t, slen: len, sext: o.ext ?? 0, sth: "atan2($sby - $say, $sbx - $sax)" } });
}
