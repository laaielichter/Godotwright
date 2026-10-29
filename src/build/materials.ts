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
}

const list: Material[] = [
  { name: "plaster", color: [0.78, 0.72, 0.62, 1], metallic: 0, roughness: 0.9 },
  { name: "brick", color: [0.45, 0.17, 0.12, 1], metallic: 0, roughness: 0.85 },
  { name: "concrete", color: [0.5, 0.5, 0.48, 1], metallic: 0, roughness: 0.9 },
  { name: "asphalt", color: [0.04, 0.04, 0.045, 1], metallic: 0, roughness: 0.95 },
  { name: "roof_tile", color: [0.34, 0.1, 0.07, 1], metallic: 0, roughness: 0.75 },
  { name: "roof_slate", color: [0.09, 0.1, 0.12, 1], metallic: 0, roughness: 0.6 },
  { name: "wood", color: [0.32, 0.18, 0.08, 1], metallic: 0, roughness: 0.7 },
  { name: "frame_white", color: [0.85, 0.85, 0.82, 1], metallic: 0, roughness: 0.5 },
  { name: "glass", color: [0.55, 0.7, 0.8, 0.35], metallic: 0, roughness: 0.05, alpha: "BLEND" },
  { name: "metal", color: [0.6, 0.6, 0.62, 1], metallic: 1, roughness: 0.4 },
  { name: "rubber", color: [0.02, 0.02, 0.02, 1], metallic: 0, roughness: 0.9 },
  { name: "paint", color: [0.6, 0.05, 0.05, 1], metallic: 0.2, roughness: 0.35 },
  { name: "bark", color: [0.2, 0.13, 0.08, 1], metallic: 0, roughness: 0.95 },
  { name: "leaf", color: [0.12, 0.3, 0.08, 1], metallic: 0, roughness: 0.8, doubleSided: true },
];

export const MATERIALS: Record<string, Material> = Object.fromEntries(list.map((m) => [m.name, m]));

/** A preset with a different colour, named so that it stays a separate material. */
export function tinted(base: string, name: string, color: [number, number, number]): Material {
  const m = MATERIALS[base];
  if (!m) throw new Error(`unknown material preset: ${base}`);
  return { ...m, name, color: [color[0], color[1], color[2], m.color[3]] };
}
