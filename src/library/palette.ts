/**
 * Materials for the asset library, as spec "materials" entries (linear RGB). A family picks the finishes it needs:
 * `pick(WOODS, "oak", "walnut")` gives `{ oak: {...}, walnut: {...} }` to merge into an asset's materials.
 */
export interface MaterialDef {
  color: [number, number, number] | [number, number, number, number];
  metallic: number;
  roughness: number;
  texture?: string;
  emissive?: [number, number, number];
  alpha?: "BLEND";
  doubleSided?: boolean;
}

type Table = Record<string, MaterialDef>;

const wood = (r: number, g: number, b: number, roughness = 0.7): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness, texture: "wood" });
const metal = (r: number, g: number, b: number, roughness = 0.4): MaterialDef => ({ color: [r, g, b], metallic: 1, roughness });
const paint = (r: number, g: number, b: number, roughness = 0.45, metallic = 0.1): MaterialDef => ({ color: [r, g, b], metallic, roughness });
const matte = (r: number, g: number, b: number, roughness = 0.9): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness });
const glow = (r: number, g: number, b: number, e: [number, number, number]): MaterialDef => ({ color: [r, g, b], metallic: 0, roughness: 0.2, emissive: e });

export const WOODS: Table = {
  oak: wood(0.42, 0.26, 0.12),
  light_oak: wood(0.58, 0.4, 0.21, 0.65),
  walnut: wood(0.2, 0.11, 0.055, 0.6),
  pine: wood(0.62, 0.43, 0.2, 0.75),
  birch: wood(0.7, 0.56, 0.36, 0.65),
  cherry: wood(0.38, 0.13, 0.06, 0.55),
  mahogany: wood(0.25, 0.07, 0.035, 0.5),
  teak: wood(0.4, 0.22, 0.09, 0.7),
  ebony: wood(0.035, 0.028, 0.024, 0.45),
  weathered_wood: wood(0.3, 0.27, 0.23, 0.92),
  whitewash_wood: wood(0.72, 0.68, 0.6, 0.8),
  dark_stain: wood(0.12, 0.07, 0.04, 0.55),
  rough_timber: wood(0.33, 0.21, 0.11, 0.9),
  bamboo: wood(0.6, 0.47, 0.22, 0.55),
};

export const METALS: Table = {
  steel: metal(0.32, 0.33, 0.35, 0.5),
  brushed_steel: metal(0.55, 0.56, 0.58, 0.32),
  chrome: metal(0.92, 0.92, 0.93, 0.08),
  aluminium: metal(0.86, 0.87, 0.89, 0.32),
  brass: metal(0.91, 0.72, 0.38, 0.3),
  bronze: metal(0.55, 0.36, 0.17, 0.4),
  copper: metal(0.85, 0.48, 0.32, 0.35),
  aged_copper: { color: [0.2, 0.42, 0.36], metallic: 0.4, roughness: 0.7 },
  cast_iron: metal(0.07, 0.07, 0.075, 0.6),
  black_steel: metal(0.04, 0.04, 0.045, 0.45),
  gunmetal: metal(0.16, 0.17, 0.19, 0.38),
  rust: { color: [0.3, 0.11, 0.04], metallic: 0.5, roughness: 0.92 },
  galvanised: metal(0.6, 0.62, 0.63, 0.55),
  gold: metal(1.0, 0.77, 0.34, 0.22),
};

export const PAINTS: Table = {
  paint_red: paint(0.55, 0.035, 0.03),
  paint_blue: paint(0.03, 0.12, 0.42),
  paint_navy: paint(0.015, 0.03, 0.1),
  paint_green: paint(0.04, 0.22, 0.06),
  paint_forest: paint(0.02, 0.08, 0.03),
  paint_yellow: paint(0.8, 0.55, 0.02),
  paint_orange: paint(0.8, 0.22, 0.02),
  paint_white: paint(0.8, 0.8, 0.78, 0.4, 0),
  paint_cream: paint(0.78, 0.7, 0.52, 0.5, 0),
  paint_black: paint(0.02, 0.02, 0.022, 0.4),
  paint_grey: paint(0.22, 0.23, 0.24, 0.5),
  paint_anthracite: paint(0.06, 0.065, 0.07, 0.5),
  paint_teal: paint(0.02, 0.25, 0.25),
  paint_mint: paint(0.35, 0.6, 0.45, 0.5, 0),
  paint_pink: paint(0.75, 0.25, 0.33, 0.5, 0),
  paint_purple: paint(0.2, 0.05, 0.3),
  paint_sky: paint(0.25, 0.48, 0.75, 0.45, 0),
  paint_olive: paint(0.17, 0.18, 0.06, 0.6),
  paint_sand: paint(0.55, 0.45, 0.28, 0.6, 0),
  paint_burgundy: paint(0.22, 0.02, 0.04),
};

export const PLASTICS: Table = {
  plastic_black: { color: [0.025, 0.025, 0.028], metallic: 0, roughness: 0.5 },
  plastic_white: { color: [0.78, 0.78, 0.76], metallic: 0, roughness: 0.4 },
  plastic_grey: { color: [0.25, 0.26, 0.27], metallic: 0, roughness: 0.5 },
  plastic_red: { color: [0.6, 0.04, 0.03], metallic: 0, roughness: 0.4 },
  plastic_blue: { color: [0.03, 0.15, 0.5], metallic: 0, roughness: 0.4 },
  plastic_green: { color: [0.05, 0.35, 0.08], metallic: 0, roughness: 0.45 },
  plastic_yellow: { color: [0.85, 0.6, 0.02], metallic: 0, roughness: 0.4 },
  plastic_orange: { color: [0.9, 0.25, 0.02], metallic: 0, roughness: 0.4 },
  rubber: { color: [0.018, 0.018, 0.02], metallic: 0, roughness: 0.88 },
};

export const FABRICS: Table = {
  linen: matte(0.62, 0.57, 0.48, 0.95),
  canvas_beige: { ...matte(0.7, 0.63, 0.48, 0.95) },
  velvet_green: matte(0.03, 0.15, 0.08, 0.85),
  velvet_red: matte(0.3, 0.02, 0.03, 0.85),
  velvet_blue: matte(0.03, 0.06, 0.22, 0.85),
  wool_grey: matte(0.3, 0.3, 0.3, 0.98),
  wool_charcoal: matte(0.07, 0.07, 0.075, 0.98),
  fabric_mustard: matte(0.6, 0.38, 0.05, 0.92),
  fabric_teal: matte(0.03, 0.2, 0.22, 0.92),
  fabric_cream: matte(0.75, 0.7, 0.6, 0.95),
  fabric_terracotta: matte(0.5, 0.15, 0.07, 0.92),
  leather_brown: { color: [0.18, 0.07, 0.03], metallic: 0, roughness: 0.55 },
  leather_black: { color: [0.02, 0.018, 0.016], metallic: 0, roughness: 0.5 },
  leather_tan: { color: [0.45, 0.22, 0.08], metallic: 0, roughness: 0.55 },
};

export const STONES: Table = {
  granite: { color: [0.3, 0.29, 0.28], metallic: 0, roughness: 0.75, texture: "stone" },
  sandstone: { color: [0.62, 0.48, 0.3], metallic: 0, roughness: 0.9, texture: "stone" },
  limestone: { color: [0.7, 0.67, 0.58], metallic: 0, roughness: 0.85, texture: "stone" },
  slate: { color: [0.12, 0.13, 0.15], metallic: 0, roughness: 0.7, texture: "stone" },
  basalt: { color: [0.08, 0.08, 0.085], metallic: 0, roughness: 0.85, texture: "stone" },
  marble: { color: [0.85, 0.84, 0.8], metallic: 0, roughness: 0.2 },
  marble_black: { color: [0.03, 0.03, 0.035], metallic: 0, roughness: 0.18 },
  concrete: { color: [0.46, 0.45, 0.42], metallic: 0, roughness: 0.9, texture: "concrete" },
  concrete_dark: { color: [0.25, 0.25, 0.24], metallic: 0, roughness: 0.9, texture: "concrete" },
  brick_red: { color: [0.42, 0.15, 0.09], metallic: 0, roughness: 0.88, texture: "brick" },
  brick_yellow: { color: [0.62, 0.48, 0.25], metallic: 0, roughness: 0.88, texture: "brick" },
  brick_brown: { color: [0.22, 0.1, 0.06], metallic: 0, roughness: 0.88, texture: "brick" },
  plaster_white: { color: [0.8, 0.78, 0.72], metallic: 0, roughness: 0.92, texture: "plaster" },
  plaster_ochre: { color: [0.7, 0.5, 0.25], metallic: 0, roughness: 0.92, texture: "plaster" },
  terracotta: { color: [0.5, 0.18, 0.08], metallic: 0, roughness: 0.85 },
  mossy_rock: { color: [0.2, 0.22, 0.14], metallic: 0, roughness: 0.95, texture: "stone" },
  red_rock: { color: [0.4, 0.15, 0.07], metallic: 0, roughness: 0.9, texture: "stone" },
};

export const CERAMICS: Table = {
  ceramic_white: { color: [0.85, 0.85, 0.83], metallic: 0, roughness: 0.12 },
  ceramic_blue: { color: [0.05, 0.15, 0.45], metallic: 0, roughness: 0.12 },
  ceramic_celadon: { color: [0.45, 0.6, 0.48], metallic: 0, roughness: 0.15 },
  ceramic_black: { color: [0.02, 0.02, 0.022], metallic: 0, roughness: 0.1 },
  ceramic_ochre: { color: [0.7, 0.4, 0.08], metallic: 0, roughness: 0.15 },
  ceramic_rust: { color: [0.45, 0.12, 0.05], metallic: 0, roughness: 0.2 },
  glass_clear: { color: [0.6, 0.72, 0.8, 0.25], metallic: 0, roughness: 0.05, alpha: "BLEND" },
  glass_green: { color: [0.08, 0.3, 0.12, 0.6], metallic: 0, roughness: 0.05, alpha: "BLEND" },
  glass_amber: { color: [0.5, 0.25, 0.03, 0.6], metallic: 0, roughness: 0.05, alpha: "BLEND" },
  glass_frosted: { color: [0.85, 0.87, 0.88, 0.7], metallic: 0, roughness: 0.4, alpha: "BLEND" },
  glass_dark: { color: [0.022, 0.03, 0.04], metallic: 0.2, roughness: 0.06 },
};

export const NATURE: Table = {
  bark_brown: { color: [0.2, 0.13, 0.08], metallic: 0, roughness: 0.95, texture: "bark" },
  bark_grey: { color: [0.28, 0.27, 0.24], metallic: 0, roughness: 0.95, texture: "bark" },
  bark_birch: { color: [0.75, 0.73, 0.68], metallic: 0, roughness: 0.85, texture: "bark" },
  bark_red: { color: [0.32, 0.12, 0.06], metallic: 0, roughness: 0.92, texture: "bark" },
  bark_dark: { color: [0.08, 0.06, 0.045], metallic: 0, roughness: 0.95, texture: "bark" },
  leaf_green: { color: [0.1, 0.24, 0.05], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_dark: { color: [0.04, 0.12, 0.03], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_light: { color: [0.25, 0.42, 0.08], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_autumn: { color: [0.6, 0.22, 0.03], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_red: { color: [0.4, 0.04, 0.03], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_yellow: { color: [0.7, 0.5, 0.05], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  leaf_blossom: { color: [0.85, 0.5, 0.6], metallic: 0, roughness: 0.75, texture: "leaf", doubleSided: true },
  needles: { color: [0.03, 0.1, 0.05], metallic: 0, roughness: 0.85, texture: "leaf", doubleSided: true },
  needles_blue: { color: [0.06, 0.13, 0.13], metallic: 0, roughness: 0.85, texture: "leaf", doubleSided: true },
  frond: { color: [0.09, 0.25, 0.05], metallic: 0, roughness: 0.7, doubleSided: true },
  grass_green: { color: [0.1, 0.22, 0.05], metallic: 0, roughness: 0.95, texture: "grass" },
  grass_dry: { color: [0.5, 0.4, 0.18], metallic: 0, roughness: 0.95, texture: "grass" },
  soil: { color: [0.17, 0.11, 0.06], metallic: 0, roughness: 1, texture: "ground" },
  moss: { color: [0.12, 0.2, 0.04], metallic: 0, roughness: 1, texture: "grass" },
  heartwood: { color: [0.62, 0.42, 0.22], metallic: 0, roughness: 0.85, texture: "wood" },
  mushroom_red: { color: [0.6, 0.03, 0.02], metallic: 0, roughness: 0.5 },
  mushroom_brown: { color: [0.3, 0.17, 0.07], metallic: 0, roughness: 0.6 },
  mushroom_cream: { color: [0.82, 0.76, 0.62], metallic: 0, roughness: 0.7 },
  petal_white: { color: [0.9, 0.9, 0.86], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_yellow: { color: [0.9, 0.65, 0.02], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_red: { color: [0.65, 0.02, 0.03], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_pink: { color: [0.85, 0.3, 0.45], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_purple: { color: [0.3, 0.08, 0.5], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_blue: { color: [0.08, 0.2, 0.7], metallic: 0, roughness: 0.6, doubleSided: true },
  petal_orange: { color: [0.9, 0.3, 0.02], metallic: 0, roughness: 0.6, doubleSided: true },
};

export const LIGHTS: Table = {
  bulb_warm: glow(1, 0.9, 0.7, [1, 0.8, 0.5]),
  bulb_cool: glow(0.9, 0.95, 1, [0.8, 0.9, 1]),
  bulb_amber: glow(0.9, 0.45, 0.05, [0.7, 0.3, 0.02]),
  led_red: glow(0.6, 0.02, 0.015, [0.8, 0.02, 0.01]),
  led_green: glow(0.03, 0.6, 0.1, [0.02, 0.8, 0.1]),
  led_blue: glow(0.03, 0.2, 0.8, [0.02, 0.25, 1]),
  screen_cyan: glow(0.02, 0.25, 0.3, [0.05, 0.6, 0.7]),
  screen_green: glow(0.02, 0.2, 0.05, [0.05, 0.7, 0.15]),
  screen_amber: glow(0.25, 0.12, 0.01, [0.8, 0.4, 0.02]),
  screen_blue: glow(0.02, 0.05, 0.25, [0.1, 0.25, 0.9]),
  flame: glow(1, 0.5, 0.05, [1, 0.45, 0.05]),
  reflector_white: { color: [0.9, 0.9, 0.9], metallic: 0.3, roughness: 0.15 },
  reflector_red: { color: [0.7, 0.02, 0.02], metallic: 0.3, roughness: 0.15 },
  reflector_amber: { color: [0.9, 0.4, 0.02], metallic: 0.3, roughness: 0.15 },
};

/** Every finish by name. */
export const PALETTE: Table = { ...WOODS, ...METALS, ...PAINTS, ...PLASTICS, ...FABRICS, ...STONES, ...CERAMICS, ...NATURE, ...LIGHTS };

/** The named finishes, ready to put in an asset's "materials". Throws on a name that does not exist. */
export function mats(...names: string[]): Table {
  const out: Table = {};
  for (const name of names) {
    const m = PALETTE[name];
    if (!m) throw new Error(`library palette: no material "${name}"`);
    out[name] = m;
  }
  return out;
}

/** A readable name for a finish: "light_oak" -> "light oak". */
export const label = (name: string): string => name.replace(/^(paint|plastic|ceramic|glass|velvet|wool|fabric|leather|bark|leaf|petal)_(.+)$/, "$2 $1").replaceAll("_", " ");
