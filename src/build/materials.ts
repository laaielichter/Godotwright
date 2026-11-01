export interface Material {
  name: string;
  /** Linear RGBA. */
  color: [number, number, number, number];
  metallic: number;
  roughness: number;
  /** BLEND for glass; opaque otherwise. */
  alpha?: "BLEND";
  doubleSided?: boolean;
  /** Light the surface gives off, linear RGB (a lamp, a window at night). */
  emissive?: [number, number, number];
  /**
   * A procedural texture pattern (see PATTERNS in textures.ts): the .glb then carries a colour map in this material's
   * colour and a normal map, both seamless. The colour is baked into the colour map.
   */
  texture?: string;
  /** Metres per UV unit of the meshes that use this material, when they differ from the kit's 4 m (a terrain tile uses 8). */
  uvMeters?: number;
}

const list: Material[] = [
  // Building
  { name: "plaster", color: [0.72, 0.66, 0.56, 1], metallic: 0, roughness: 0.92, texture: "plaster" },
  { name: "brick", color: [0.42, 0.15, 0.09, 1], metallic: 0, roughness: 0.88, texture: "brick" },
  { name: "concrete", color: [0.46, 0.45, 0.42, 1], metallic: 0, roughness: 0.9, texture: "concrete" },
  { name: "stone", color: [0.3, 0.28, 0.25, 1], metallic: 0, roughness: 0.85, texture: "stone" },
  { name: "asphalt", color: [0.045, 0.045, 0.05, 1], metallic: 0, roughness: 0.92, texture: "asphalt" },
  { name: "roof_tile", color: [0.36, 0.1, 0.05, 1], metallic: 0, roughness: 0.75, texture: "roof_tile" },
  { name: "roof_slate", color: [0.075, 0.085, 0.1, 1], metallic: 0, roughness: 0.6, texture: "roof_slate" },
  { name: "wood", color: [0.36, 0.2, 0.09, 1], metallic: 0, roughness: 0.7, texture: "wood" },
  { name: "frame_white", color: [0.82, 0.82, 0.79, 1], metallic: 0, roughness: 0.45 },
  { name: "glass", color: [0.55, 0.7, 0.8, 0.35], metallic: 0, roughness: 0.05, alpha: "BLEND" },
  { name: "glass_tinted", color: [0.04, 0.06, 0.07, 0.75], metallic: 0, roughness: 0.04, alpha: "BLEND" },
  // Metal and plastic
  { name: "metal", color: [0.6, 0.6, 0.62, 1], metallic: 1, roughness: 0.4 },
  { name: "steel", color: [0.32, 0.33, 0.35, 1], metallic: 1, roughness: 0.5 },
  { name: "chrome", color: [0.92, 0.92, 0.93, 1], metallic: 1, roughness: 0.08 },
  { name: "aluminium", color: [0.86, 0.87, 0.89, 1], metallic: 1, roughness: 0.32 },
  { name: "brass", color: [0.91, 0.72, 0.38, 1], metallic: 1, roughness: 0.3 },
  { name: "plastic", color: [0.025, 0.025, 0.028, 1], metallic: 0, roughness: 0.5 },
  { name: "plastic_white", color: [0.78, 0.78, 0.76, 1], metallic: 0, roughness: 0.4 },
  { name: "rubber", color: [0.018, 0.018, 0.02, 1], metallic: 0, roughness: 0.88 },
  { name: "paint", color: [0.55, 0.035, 0.03, 1], metallic: 0.3, roughness: 0.28 },
  { name: "canvas", color: [0.8, 0.77, 0.68, 1], metallic: 0, roughness: 0.92, doubleSided: true },
  // Lights: they glow a little, so they read as lights in daylight and at night.
  { name: "light", color: [0.95, 0.93, 0.85, 1], metallic: 0, roughness: 0.1, emissive: [1, 0.92, 0.75] },
  { name: "light_red", color: [0.6, 0.02, 0.015, 1], metallic: 0, roughness: 0.15, emissive: [0.55, 0.02, 0.01] },
  { name: "light_amber", color: [0.9, 0.4, 0.04, 1], metallic: 0, roughness: 0.15, emissive: [0.6, 0.25, 0.02] },
  // Nature
  { name: "bark", color: [0.2, 0.13, 0.08, 1], metallic: 0, roughness: 0.95, texture: "bark" },
  { name: "leaf", color: [0.1, 0.24, 0.05, 1], metallic: 0, roughness: 0.75, doubleSided: true, texture: "leaf" },
  { name: "grass", color: [0.1, 0.22, 0.05, 1], metallic: 0, roughness: 0.95, texture: "grass" },
  { name: "soil", color: [0.17, 0.11, 0.06, 1], metallic: 0, roughness: 1, texture: "ground" },
  { name: "sand", color: [0.62, 0.5, 0.32, 1], metallic: 0, roughness: 0.95, texture: "sand" },
  { name: "water", color: [0.03, 0.14, 0.2, 0.8], metallic: 0, roughness: 0.04, alpha: "BLEND", texture: "water" },
];

export const MATERIALS: Record<string, Material> = Object.fromEntries(list.map((m) => [m.name, m]));

/** A preset with a different colour, named so that it stays a separate material. */
export function tinted(base: string, name: string, color: [number, number, number]): Material {
  const m = MATERIALS[base];
  if (!m) throw new Error(`unknown material preset: ${base}`);
  return { ...m, name, color: [color[0], color[1], color[2], m.color[3]] };
}
