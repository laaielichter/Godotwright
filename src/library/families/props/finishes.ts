import type { MaterialDef } from "../../palette.js";

/**
 * Real-world finishes for the props families, calibrated for Godot's sun (linear albedo, see the palette notes):
 * powder-coated and brushed casings, dark screen glass with glowing content, weathered stone and bronze, still water,
 * charred wood and embers. Names are prefixed per kind so an asset's material list reads well in the Godot inspector.
 */
const powder = (r: number, g: number, b: number, roughness = 0.55, metallic = 0.15): MaterialDef => ({ color: [r, g, b], metallic, roughness, texture: "painted" });
const stone = (r: number, g: number, b: number, texture = "stone", roughness = 0.88): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture });
const wood = (r: number, g: number, b: number, roughness = 0.75): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "wood" });
/** A dark glass screen whose base glows faintly in the content colour. */
const screen = (e: [number, number, number]): MaterialDef => ({ color: [0.012, 0.014, 0.016], metallic: 0, roughness: 0.08, emissive: e });
/** Bright screen content (text, bars, icons) or a lit sign. */
const lit = (e: [number, number, number], c: [number, number, number] = [0.05, 0.05, 0.05]): MaterialDef => ({ color: c, metallic: 0, roughness: 0.3, emissive: e });

export const FINISH: Record<string, MaterialDef> = {
  // Casings: powder coat (slight orange peel), brushed stainless and satin aluminium, anodised dark metal.
  powder_anthracite: powder(0.045, 0.048, 0.052, 0.5, 0.3),
  powder_black: powder(0.032, 0.032, 0.035, 0.45, 0.25),
  powder_lightgrey: powder(0.46, 0.48, 0.46, 0.55, 0.05),
  powder_white: powder(0.62, 0.62, 0.6, 0.45, 0),
  powder_navy: powder(0.018, 0.035, 0.1, 0.5, 0.2),
  powder_red: powder(0.42, 0.03, 0.025, 0.45, 0.1),
  powder_purple: powder(0.1, 0.025, 0.16, 0.45, 0.15),
  powder_yellow: powder(0.65, 0.42, 0.02, 0.5, 0.05),
  powder_green: powder(0.02, 0.075, 0.035, 0.5, 0.15),
  stainless: { color: [0.6, 0.61, 0.62], metallic: 0.8, roughness: 0.36, texture: "brushed" },
  satin_alu: { color: [0.78, 0.79, 0.8], metallic: 0.85, roughness: 0.34, texture: "brushed" },
  gunmetal_satin: { color: [0.34, 0.35, 0.37], metallic: 0.7, roughness: 0.4, texture: "brushed" },
  anodised_dark: { color: [0.07, 0.075, 0.08], metallic: 0.35, roughness: 0.4, texture: "brushed" },
  galvanised_steel: { color: [0.5, 0.52, 0.52], metallic: 0.75, roughness: 0.55, texture: "plastic" },
  bright_chrome: { color: [0.85, 0.85, 0.86], metallic: 1, roughness: 0.1 },
  abs_black: { color: [0.035, 0.035, 0.038], metallic: 0, roughness: 0.5, texture: "plastic" },
  abs_grey: { color: [0.16, 0.165, 0.17], metallic: 0, roughness: 0.5, texture: "plastic" },
  abs_white: { color: [0.6, 0.6, 0.58], metallic: 0, roughness: 0.45, texture: "plastic" },
  abs_red: { color: [0.4, 0.03, 0.025], metallic: 0, roughness: 0.4, texture: "plastic" },
  abs_blue: { color: [0.03, 0.08, 0.26], metallic: 0, roughness: 0.45, texture: "plastic" },
  abs_yellow: { color: [0.6, 0.38, 0.02], metallic: 0, roughness: 0.45, texture: "plastic" },
  rubber_black: { color: [0.03, 0.03, 0.032], metallic: 0, roughness: 0.9 },
  /** The dark line of a panel gap or a recess. */
  gap_dark: { color: [0.013, 0.013, 0.014], metallic: 0, roughness: 0.95 },
  /** Dark screen glass: the screen's base, glowing faintly in its content colour. */
  screen_glass_cyan: screen([0.0, 0.05, 0.065]),
  screen_glass_blue: screen([0.004, 0.018, 0.075]),
  screen_glass_green: screen([0.004, 0.05, 0.012]),
  screen_glass_amber: screen([0.07, 0.03, 0.0]),
  ui_cyan: lit([0.06, 0.42, 0.5]),
  ui_blue: lit([0.1, 0.25, 0.75]),
  ui_green: lit([0.08, 0.55, 0.12]),
  ui_amber: lit([0.75, 0.36, 0.02]),
  ui_white: lit([0.5, 0.52, 0.55]),
  ui_red: lit([0.7, 0.04, 0.02]),
  /** Backlit signs: a lit header, marquee or logo (a diffuser lit from behind, not a lamp). */
  sign_white: lit([0.42, 0.42, 0.4], [0.5, 0.5, 0.48]),
  sign_cyan: lit([0.03, 0.3, 0.36], [0.05, 0.2, 0.24]),
  sign_green: lit([0.04, 0.32, 0.1], [0.05, 0.2, 0.08]),
  sign_blue: lit([0.04, 0.12, 0.42], [0.04, 0.08, 0.24]),
  sign_amber: lit([0.5, 0.22, 0.01], [0.4, 0.2, 0.03]),
  sign_magenta: lit([0.45, 0.04, 0.3], [0.3, 0.04, 0.2]),
  led_on_red: lit([0.9, 0.05, 0.02]),
  led_on_green: lit([0.05, 0.8, 0.12]),
  led_on_blue: lit([0.04, 0.2, 0.95]),
  led_on_amber: lit([0.9, 0.42, 0.02]),
  glass_tint: { color: [0.12, 0.14, 0.15, 0.4], metallic: 0, roughness: 0.06, alpha: "BLEND" },

  // Stone: dressed blocks ("stone") for walls and plinths, carved stone ("concrete": weathered, blotchy) for figures.
  limestone_block: stone(0.36, 0.34, 0.29),
  limestone_carved: stone(0.36, 0.34, 0.29, "concrete", 0.85),
  sandstone_block: stone(0.33, 0.23, 0.12),
  sandstone_carved: stone(0.33, 0.23, 0.12, "concrete", 0.9),
  granite_block: stone(0.19, 0.19, 0.18, "stone", 0.75),
  granite_carved: stone(0.19, 0.19, 0.18, "concrete", 0.7),
  granite_dark: stone(0.075, 0.075, 0.078, "concrete", 0.55),
  fieldstone: stone(0.16, 0.16, 0.13, "stone", 0.95),
  marble_white: { color: [0.5, 0.49, 0.46], metallic: 0, roughness: 0.3, texture: "concrete" },
  marble_dark: { color: [0.03, 0.03, 0.034], metallic: 0, roughness: 0.22, texture: "concrete" },
  concrete_cast: stone(0.3, 0.3, 0.28, "concrete", 0.9),
  concrete_weathered: stone(0.22, 0.22, 0.2, "concrete", 0.95),
  brick_old: { color: [0.18, 0.055, 0.035], metallic: 0, roughness: 0.88, texture: "brick" },
  brick_yellow_old: { color: [0.38, 0.27, 0.13], metallic: 0, roughness: 0.88, texture: "brick" },
  mortar_grey: stone(0.22, 0.21, 0.19, "concrete", 0.95),

  // Metals that have weathered outdoors.
  bronze_weathered: { color: [0.13, 0.15, 0.09], metallic: 0.35, roughness: 0.55, texture: "rust" },
  bronze_polished: { color: [0.55, 0.37, 0.18], metallic: 1, roughness: 0.32 },
  verdigris: { color: [0.11, 0.19, 0.15], metallic: 0.15, roughness: 0.75, texture: "rust" },
  brass_worn: { color: [0.62, 0.48, 0.24], metallic: 1, roughness: 0.38 },
  gilt: { color: [0.75, 0.56, 0.24], metallic: 1, roughness: 0.28 },
  corten: { color: [0.2, 0.075, 0.03], metallic: 0.1, roughness: 0.9, texture: "rust" },
  iron_rusty: { color: [0.13, 0.06, 0.035], metallic: 0.2, roughness: 0.85, texture: "rust" },
  iron_painted_black: powder(0.03, 0.03, 0.033, 0.55, 0.3),
  iron_painted_green: powder(0.02, 0.07, 0.035, 0.5, 0.2),

  // Water.
  pool_water: { color: [0.012, 0.035, 0.04, 0.88], metallic: 0, roughness: 0.03, texture: "water", alpha: "BLEND" },
  well_water_dark: { color: [0.012, 0.018, 0.016], metallic: 0, roughness: 0.04, texture: "water" },
  spray_water: { color: [0.55, 0.62, 0.66, 0.32], metallic: 0, roughness: 0.05, alpha: "BLEND" },
  algae_floor: stone(0.05, 0.065, 0.035, "concrete", 0.9),
  wet_stain: stone(0.07, 0.075, 0.06, "concrete", 0.6),

  // Wood.
  wood_pine: wood(0.45, 0.3, 0.15, 0.7),
  wood_oak: wood(0.3, 0.17, 0.07, 0.72),
  wood_weathered: wood(0.25, 0.22, 0.18, 0.92),
  wood_dark: wood(0.1, 0.06, 0.035, 0.7),
  wood_rough: wood(0.22, 0.14, 0.07, 0.92),
  wood_whitewash: wood(0.45, 0.43, 0.39, 0.88),
  wood_cut: wood(0.48, 0.34, 0.18, 0.85),

  // Loose rocks (weathered, no block joints).
  rock_grey: stone(0.17, 0.17, 0.16, "concrete", 0.85),
  rock_mossy: stone(0.11, 0.12, 0.075, "concrete", 0.95),
  rock_sand: stone(0.3, 0.22, 0.12, "concrete", 0.9),
  rock_dark: stone(0.065, 0.065, 0.068, "concrete", 0.8),
  rock_red: stone(0.22, 0.09, 0.05, "concrete", 0.9),
  rock_slate: stone(0.075, 0.08, 0.088, "concrete", 0.7),

  // Nature and fire.
  moss_green: { color: [0.06, 0.1, 0.02], metallic: 0, roughness: 1, texture: "grass" },
  lichen: { color: [0.2, 0.21, 0.12], metallic: 0, roughness: 1, texture: "grass" },
  bark_pine: { color: [0.16, 0.1, 0.06], metallic: 0, roughness: 0.95, texture: "bark" },
  bark_oak: { color: [0.11, 0.09, 0.07], metallic: 0, roughness: 0.95, texture: "bark" },
  bark_birch_real: { color: [0.36, 0.345, 0.3], metallic: 0, roughness: 0.9, texture: "bark" },
  bark_grey_real: { color: [0.12, 0.115, 0.1], metallic: 0, roughness: 0.95, texture: "bark" },
  charred: { color: [0.028, 0.025, 0.022], metallic: 0, roughness: 0.95, texture: "bark" },
  ash_grey: { color: [0.2, 0.19, 0.18], metallic: 0, roughness: 1, texture: "ground" },
  ash_white: { color: [0.26, 0.255, 0.245], metallic: 0, roughness: 1, texture: "ground" },
  scorched_earth: { color: [0.045, 0.035, 0.028], metallic: 0, roughness: 1, texture: "ground" },
  dirt: { color: [0.09, 0.065, 0.045], metallic: 0, roughness: 1, texture: "ground" },
  ember_glow: { color: [0.06, 0.02, 0.01], metallic: 0, roughness: 0.8, emissive: [0.95, 0.24, 0.02] },
  ember_bed: { color: [0.035, 0.025, 0.02], metallic: 0, roughness: 1, texture: "ground", emissive: [0.28, 0.05, 0.005] },
  ember_tip: { color: [0.05, 0.02, 0.01], metallic: 0, roughness: 0.9, texture: "bark", emissive: [0.7, 0.14, 0.01] },
  flame_outer: { color: [0.5, 0.1, 0.01, 0.45], metallic: 0, roughness: 0.4, emissive: [0.95, 0.2, 0.012], alpha: "BLEND" },
  flame_inner: { color: [0.7, 0.3, 0.05, 0.65], metallic: 0, roughness: 0.4, emissive: [1, 0.46, 0.08], alpha: "BLEND" },
  scorched_wood: { color: [0.06, 0.04, 0.026], metallic: 0, roughness: 0.92, texture: "bark" },
  soot_iron: { color: [0.03, 0.028, 0.027], metallic: 0.2, roughness: 0.8, texture: "rust" },
  rope_hemp: { color: [0.36, 0.28, 0.16], metallic: 0, roughness: 0.95, texture: "fabric" },
};

/** The named finishes, from this file (or, when a name is not here, from the given fallback). */
export function finish(...names: string[]): Record<string, MaterialDef> {
  const out: Record<string, MaterialDef> = {};
  for (const n of names) {
    const m = FINISH[n];
    if (!m) throw new Error(`props finishes: no material "${n}"`);
    out[n] = m;
  }
  return out;
}
