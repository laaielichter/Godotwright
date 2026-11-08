/** Shared bits of the street families: a few local finishes and the material picker. */
import { PALETTE, type MaterialDef } from "../../palette.js";

/** Finishes the shared palette lacks. */
export const LOCAL: Record<string, MaterialDef> = {
  /** A dark recess: the inside of a bin, a mail slot. */
  opening_dark: { color: [0.012, 0.012, 0.014], metallic: 0, roughness: 0.95 },
  corten: { color: [0.32, 0.12, 0.04], metallic: 0.35, roughness: 0.85 },
  sign_grey: { color: [0.55, 0.56, 0.57], metallic: 0.6, roughness: 0.5 },
  pillar_red: { color: [0.62, 0.03, 0.02], metallic: 0.15, roughness: 0.35 },
  postal_blue: { color: [0.02, 0.07, 0.3], metallic: 0.15, roughness: 0.4 },
  postal_orange: { color: [0.85, 0.32, 0.02], metallic: 0.1, roughness: 0.45 },
  postal_yellow: { color: [0.9, 0.62, 0.02], metallic: 0.1, roughness: 0.45 },
  amsterdam_brown: { color: [0.16, 0.05, 0.03], metallic: 0.3, roughness: 0.55 },
  fibreglass_white: { color: [0.82, 0.82, 0.8], metallic: 0, roughness: 0.3 },
  water_barrier_red: { color: [0.6, 0.04, 0.03], metallic: 0, roughness: 0.55 },
  water_barrier_white: { color: [0.82, 0.82, 0.8], metallic: 0, roughness: 0.55 },
  glow_warm_glass: { color: [1, 0.92, 0.75, 0.85], metallic: 0, roughness: 0.3, emissive: [1, 0.82, 0.55], alpha: "BLEND" },
  glow_globe: { color: [0.95, 0.95, 0.92, 0.9], metallic: 0, roughness: 0.35, emissive: [0.9, 0.85, 0.75], alpha: "BLEND" },
};

/** The named finishes from the palette or the local table. */
export function useMats(...names: (string | undefined)[]): Record<string, MaterialDef> {
  const out: Record<string, MaterialDef> = {};
  for (const n of names) {
    if (!n) continue;
    const m = LOCAL[n] ?? PALETTE[n];
    if (!m) throw new Error(`street: no material "${n}"`);
    out[n] = m;
  }
  return out;
}

/** A readable name for a finish. */
export const nice = (name: string): string =>
  name.replace(/^(paint|plastic|ceramic|glass|bark|leaf|petal|postal|pillar|water_barrier)_(.+)$/, "$2").replaceAll("_", " ");

/** First letter upper case. */
export const up = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
