import { box, cyl, ellipsoid, group, lathe, loft, num, roof, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { label, mats } from "../../palette.js";

/**
 * Statues and monuments: a classical bust on a column, a stylised standing figure on a stepped plinth, an obelisk on
 * stepped blocks, an abstract trefoil knot and a modern hoop sculpture. Every one is a Plinth with a Figure on top,
 * standing on y = 0 and facing +z.
 */
type Style = "bust" | "standing" | "obelisk" | "knot" | "hoop";

interface Finish {
  key: string;
  figure: string;
  plinth: string;
  accent: string;
}

const FINISHES: Record<Style, [Finish, Finish]> = {
  bust: [
    { key: "marble", figure: "marble", plinth: "marble_black", accent: "brass" },
    { key: "bronze", figure: "bronze", plinth: "granite", accent: "bronze" },
  ],
  standing: [
    { key: "bronze", figure: "aged_copper", plinth: "granite", accent: "bronze" },
    { key: "limestone", figure: "limestone", plinth: "sandstone", accent: "bronze" },
  ],
  obelisk: [
    { key: "granite", figure: "granite", plinth: "granite", accent: "gold" },
    { key: "sandstone", figure: "sandstone", plinth: "limestone", accent: "bronze" },
  ],
  knot: [
    { key: "steel", figure: "brushed_steel", plinth: "concrete", accent: "steel" },
    { key: "copper", figure: "aged_copper", plinth: "basalt", accent: "bronze" },
  ],
  hoop: [
    { key: "corten", figure: "rust", plinth: "concrete", accent: "chrome" },
    { key: "chrome", figure: "chrome", plinth: "marble_black", accent: "gold" },
  ],
};

/** A value scaled by the figure's scale $s. */
const S = (v: number): string => `${v} * $s`;

function bust(f: Finish): SpecNode[] {
  return [
    group("Bust", [
      group("Plinth", [
        box("Footing", ["$pw * 1.1", 0.08, "$pw * 1.1"], { anchor: "bottom", bevel: 0.01 }),
        lathe("Column", [[0.02, 0.07], ["$pr", 0.07], ["$pr", 0.13], ["$pr * 0.86", 0.16], ["$pr * 0.86", 0.2], ["$pr * 0.68", 0.25], ["$pr * 0.62", "$ph - 0.2"], ["$pr * 0.7", "$ph - 0.15"], ["$pr * 0.8", "$ph - 0.1"], ["$pr * 0.8", "$ph - 0.07"], [0.02, "$ph - 0.07"]], { segments: 24 }),
        box("Abacus", ["$pw * 0.86", 0.08, "$pw * 0.86"], { at: [0, "$ph - 0.08", 0], anchor: "bottom", bevel: 0.008 }),
        box("Plaque", ["$pr * 0.6", 0.1, 0.01], { at: [0, "$ph * 0.6", "$pr * 0.63"], bevel: 0.003, material: f.accent }),
      ], { material: f.plinth }),
      group("Figure", [
        lathe("Socle", [[0.02, 0], [S(0.085), 0], [S(0.1), S(0.02)], [S(0.06), S(0.08)], [S(0.07), S(0.1)], [0.02, S(0.1)]], { segments: 20 }),
        ellipsoid("Chest", [S(0.27), S(0.15), S(0.12)], { at: [0, S(0.23), 0], segments: 24 }),
        cyl("Neck", S(0.055), S(0.16), { at: [0, S(0.43), S(0.005)], segments: 16 }),
        ellipsoid("Head", [S(0.09), S(0.12), S(0.105)], { at: [0, S(0.56), S(0.01)], segments: 24 }),
        ellipsoid("Hair", [S(0.096), S(0.085), S(0.105)], { at: [0, S(0.6), S(-0.008)], segments: 20 }),
        ellipsoid("Nose", [S(0.014), S(0.032), S(0.02)], { at: [0, S(0.545), S(0.108)], segments: 10 }),
        ellipsoid("Ear_L", [S(0.012), S(0.03), S(0.02)], { at: [S(0.088), S(0.555), 0], segments: 10, mirror: "Ear_R" }),
        ellipsoid("Brow", [S(0.07), S(0.012), S(0.02)], { at: [0, S(0.585), S(0.092)], segments: 12 }),
      ], { at: [0, "$ph", 0], material: f.figure, vars: { s: "$figureHeight / 0.68" } }),
    ], { vars: { ph: "$plinthHeight", pw: "$plinthWidth", pr: "$plinthWidth / 2" } }),
  ];
}

function standing(f: Finish): SpecNode[] {
  return [
    group("Monument", [
      group("Plinth", [
        box("Footing", ["$pw + 0.24", 0.16, "$pw + 0.24"], { anchor: "bottom", bevel: 0.015 }),
        box("Die", ["$pw", "$ph - 0.3", "$pw"], { at: [0, 0.15, 0], anchor: "bottom", bevel: 0.01 }),
        box("Cornice", ["$pw + 0.12", 0.16, "$pw + 0.12"], { at: [0, "$ph - 0.16", 0], anchor: "bottom", bevel: 0.015 }),
        box("Plaque", ["$pw * 0.55", "min(0.3, $ph * 0.25)", 0.012], { at: [0, "$ph * 0.5", "$pw / 2"], bevel: 0.004, material: f.accent }),
      ], { material: f.plinth }),
      group("Figure", [
        box("Foot_L", [S(0.1), S(0.06), S(0.25)], { at: [S(0.1), 0, S(0.04)], anchor: "bottom", bevel: S(0.02), mirror: "Foot_R" }),
        lathe("Leg_L", [[S(0.03), S(0.05)], [S(0.045), S(0.07)], [S(0.06), S(0.25)], [S(0.065), S(0.38)], [S(0.056), S(0.5)], [S(0.085), S(0.7)], [S(0.1), S(0.92)], [S(0.05), S(0.96)]], { at: [S(0.1), 0, 0], segments: 14, mirror: "Leg_R" }),
        ellipsoid("Pelvis", [S(0.19), S(0.12), S(0.12)], { at: [0, S(0.95), 0], segments: 20 }),
        loft("Torso", [0.92, 1.05, 1.2, 1.36, 1.46, 1.52].map((z, k) => ({
          z: S(z),
          superellipse: { width: S([0.34, 0.31, 0.34, 0.42, 0.4, 0.2][k] as number), height: S([0.22, 0.2, 0.24, 0.24, 0.2, 0.12][k] as number), n: 2.4, count: 20 },
        })), { rotate: [-90, 0, 0] }),
        tube("Arm_L", [[S(0.19), S(1.42), 0], [S(0.25), S(1.13), S(0.01)], [S(0.27), S(0.86), S(0.06)]], [S(0.055), S(0.045), S(0.034)], { segments: 12, mirror: "Arm_R" }),
        ellipsoid("Hand_L", [S(0.03), S(0.07), S(0.045)], { at: [S(0.272), S(0.8), S(0.065)], segments: 12, mirror: "Hand_R" }),
        cyl("Neck", S(0.055), S(0.14), { at: [0, S(1.55), 0], segments: 14 }),
        ellipsoid("Head", [S(0.095), S(0.12), S(0.105)], { at: [0, S(1.68), S(0.01)], segments: 20 }),
        ellipsoid("Nose", [S(0.014), S(0.03), S(0.02)], { at: [0, S(1.67), S(0.11)], segments: 10 }),
      ], { at: [0, "$ph", 0], material: f.figure, vars: { s: "$figureHeight / 1.8" } }),
    ], { vars: { ph: "$plinthHeight", pw: "$plinthWidth" } }),
  ];
}

function obelisk(f: Finish): SpecNode[] {
  const sq = (w: string): [string, string][] => [[`-${w} / 2`, `-${w} / 2`], [`${w} / 2`, `-${w} / 2`], [`${w} / 2`, `${w} / 2`], [`-${w} / 2`, `${w} / 2`]];
  return [
    group("Obelisk", [
      group("Plinth", [
        box("Step_1", ["$pw", "$ph * 0.2", "$pw"], { anchor: "bottom", bevel: 0.01 }),
        box("Step_2", ["$pw * 0.8", "$ph * 0.2", "$pw * 0.8"], { at: [0, "$ph * 0.2 - 0.002", 0], anchor: "bottom", bevel: 0.01 }),
        box("Die", ["$pw * 0.62", "$ph * 0.45", "$pw * 0.62"], { at: [0, "$ph * 0.4 - 0.004", 0], anchor: "bottom", bevel: 0.008 }),
        box("Cap", ["$pw * 0.7", "$ph * 0.15", "$pw * 0.7"], { at: [0, "$ph * 0.85 - 0.006", 0], anchor: "bottom", bevel: 0.01 }),
        box("Inscription", ["$pw * 0.4", "$ph * 0.22", 0.01], { at: [0, "$ph * 0.62", "$pw * 0.31"], bevel: 0.003, material: f.accent }),
      ], { material: f.plinth }),
      group("Figure", [
        loft("Shaft", [{ z: 0, points: sq("$b") }, { z: "$figureHeight", points: sq("$b * 0.66") }], { rotate: [-90, 0, 0] }),
        roof("Pyramidion", { x0: "-$b * 0.33", x1: "$b * 0.33", z0: "-$b * 0.33", z1: "$b * 0.33", y: "$figureHeight - 0.002", rise: "$b * 0.55", kind: "hip" }, { material: f.accent }),
        box("Band", ["$b * 1.06", 0.06, "$b * 1.06"], { at: [0, 0, 0], anchor: "bottom", bevel: 0.01 }),
      ], { at: [0, "$ph - 0.008", 0], material: f.figure, vars: { b: "$pw * 0.42" } }),
    ], { vars: { ph: "$plinthHeight", pw: "$plinthWidth" } }),
  ];
}

function knot(f: Finish): SpecNode[] {
  const pts: [Num, Num, Num][] = [];
  const n = 72;
  for (let k = 0; k <= n; k++) {
    const t = Math.PI + (k / n) * Math.PI * 2;
    const x = Math.sin(t) + 2 * Math.sin(2 * t);
    const y = Math.cos(t) - 2 * Math.cos(2 * t);
    const z = -Math.sin(3 * t);
    pts.push([`${x.toFixed(4)} * $k`, `(${y.toFixed(4)} + 3) * $k + $r`, `${(z * 0.8).toFixed(4)} * $k`]);
  }
  return [
    group("Sculpture", [
      group("Plinth", [
        box("Block", ["$pw", "$ph", "$pw * 0.7"], { anchor: "bottom", bevel: 0.02 }),
        box("Shadow", ["$pw + 0.04", 0.04, "$pw * 0.7 + 0.04"], { anchor: "bottom", bevel: 0.01, material: "basalt" }),
        box("Label", [0.3, 0.08, 0.01], { at: [0, "$ph * 0.6", "$pw * 0.35"], bevel: 0.003, material: f.accent }),
      ], { material: f.plinth }),
      group("Figure", [
        cyl("Stub", "$r * 0.7", "$r * 1.6", { anchor: "base", segments: 16, material: f.accent }),
        tube("Knot", pts, "$r", { segments: 16 }),
      ], { at: [0, "$ph - 0.005", 0], material: f.figure, vars: { k: "$figureHeight / 5.2", r: "$figureHeight * 0.075" } }),
    ], { vars: { ph: "$plinthHeight", pw: "$plinthWidth" } }),
  ];
}

function hoop(f: Finish): SpecNode[] {
  const ring: [Num, Num][] = [];
  for (let k = 0; k <= 16; k++) {
    const a = ((k % 16) / 16) * Math.PI * 2;
    ring.push([`$R + $t / 2 * ${Math.cos(a).toFixed(4)}`, `$t / 2 * ${Math.sin(a).toFixed(4)}`]);
  }
  return [
    group("Sculpture", [
      group("Plinth", [
        box("Slab", ["$figureHeight * 0.8", "$ph", "max(0.6, $t * 4)"], { anchor: "bottom", bevel: 0.015 }),
        box("Seat", ["$t * 1.4", 0.03, "$t * 1.4"], { at: [0, "$ph - 0.005", 0], anchor: "bottom", bevel: 0.005, material: f.accent }),
      ], { material: f.plinth }),
      group("Figure", [
        lathe("Hoop", ring, { at: [0, "$figureHeight / 2", 0], rotate: [90, 0, 0], segments: 40, caps: false }),
        ellipsoid("Orb", ["$rs", "$rs", "$rs"], { at: [0, "$t + $rs - 0.01", 0], segments: 24, material: f.accent }),
      ], { at: [0, "$ph + 0.02", 0], material: f.figure, vars: { R: "$figureHeight / 2 - $t / 2", rs: "($figureHeight / 2 - $t) * 0.42" } }),
    ], { vars: { ph: "$plinthHeight", t: "$thickness" } }),
  ];
}

interface StyleDef {
  name: string;
  text: string;
  build: (f: Finish) => SpecNode[];
  params: () => ReturnType<typeof num>[];
  tags: string[];
}

const STYLES: Record<Style, StyleDef> = {
  bust: {
    name: "bust on column",
    text: "A classical portrait bust on a turned column with a square footing, an abacus and a plaque",
    build: bust,
    params: () => [num("plinthHeight", 1.15, 0.9, 1.4, "Height of the column top in metres."), num("plinthWidth", 0.5, 0.4, 0.7, "Width of the footing and column."), num("figureHeight", 0.68, 0.5, 0.9, "Height of the bust.")],
    tags: ["bust", "borstbeeld", "classical", "museum", "column", "zuil"],
  },
  standing: {
    name: "standing figure",
    text: "A stylised standing figure with arms at its sides on a stepped plinth with a cornice and a plaque",
    build: standing,
    params: () => [num("plinthHeight", 1.2, 0.8, 2, "Height of the plinth in metres."), num("plinthWidth", 0.9, 0.7, 1.4, "Width of the plinth die."), num("figureHeight", 1.9, 1.4, 2.6, "Height of the figure.")],
    tags: ["figure", "person", "man", "standbeeld", "monument", "memorial"],
  },
  obelisk: {
    name: "obelisk",
    text: "A tapering square obelisk with a pyramidion tip on a stepped base with an inscription panel",
    build: obelisk,
    params: () => [num("plinthHeight", 1.0, 0.6, 1.4, "Height of the stepped base in metres."), num("plinthWidth", 1.4, 1.0, 2.0, "Width of the bottom step."), num("figureHeight", 3.2, 2.0, 4.4, "Height of the obelisk shaft.")],
    tags: ["obelisk", "naald", "gedenknaald", "memorial", "egypt"],
  },
  knot: {
    name: "abstract knot",
    text: "An abstract sculpture of a smooth trefoil knot standing on a short stub on a rectangular block",
    build: knot,
    params: () => [num("plinthHeight", 0.7, 0.4, 1.0, "Height of the block in metres."), num("plinthWidth", 1.1, 0.9, 1.5, "Width of the block."), num("figureHeight", 1.5, 1.0, 2.2, "Height of the knot.")],
    tags: ["abstract", "modern art", "knot", "knoop", "kunstwerk", "sculpture"],
  },
  hoop: {
    name: "hoop sculpture",
    text: "A modern sculpture of a large upright ring with a sphere resting inside it, on a low slab",
    build: hoop,
    params: () => [num("plinthHeight", 0.3, 0.15, 0.6, "Height of the slab in metres."), num("figureHeight", 1.8, 1.2, 2.8, "Outer diameter of the ring."), num("thickness", 0.16, 0.1, 0.25, "Thickness of the ring.")],
    tags: ["abstract", "ring", "hoop", "sphere", "bol", "modern art", "kunstwerk"],
  },
};

function statue(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  return {
    slug: slugify("statue", f.key, s.name),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${s.name}`,
    description: `${s.text}, in ${label(f.figure)} on ${label(f.plinth)}. It faces +z.`,
    tags: [style, f.key, label(f.figure), label(f.plinth), ...s.tags],
    params: s.params(),
    materials: mats(...new Set([f.figure, f.plinth, f.accent, "basalt"])),
    nodes: s.build(f),
  };
}

const ORDER: Style[] = ["bust", "standing", "obelisk", "knot", "hoop"];

export const statueFamily: Family = {
  id: "statue",
  category: "props",
  archetype: "prop.statue",
  tags: ["statue", "standbeeld", "beeld", "sculpture", "monument", "plinth", "sokkel", "prop"],
  assets: () => ORDER.flatMap((style) => FINISHES[style].map((f) => statue(style, f))),
};
