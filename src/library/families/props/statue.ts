import { box, cyl, ellipsoid, extrude, group, lathe, loft, num, rng, roof, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { finish } from "./finishes.js";

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
  /** Description words: "weathered bronze on a granite plinth". */
  text: string;
  /** Green run-off streaks of patina down the plinth under a copper-alloy figure. */
  streaks?: boolean;
}

const FINISHES: Record<Style, [Finish, Finish]> = {
  bust: [
    { key: "marble", figure: "marble_white", plinth: "marble_dark", accent: "brass_worn", text: "white marble on a black marble column" },
    { key: "bronze", figure: "bronze_weathered", plinth: "granite_carved", accent: "bronze_polished", text: "weathered bronze on a granite column", streaks: true },
  ],
  standing: [
    { key: "bronze", figure: "verdigris", plinth: "granite_block", accent: "bronze_weathered", text: "green-patinated bronze on a granite plinth", streaks: true },
    { key: "limestone", figure: "limestone_carved", plinth: "sandstone_block", accent: "bronze_weathered", text: "weathered limestone on a sandstone plinth" },
  ],
  obelisk: [
    { key: "granite", figure: "granite_block", plinth: "granite_block", accent: "gilt", text: "grey granite blocks with a gilt tip" },
    { key: "sandstone", figure: "sandstone_block", plinth: "limestone_block", accent: "bronze_weathered", text: "sandstone on a limestone base" },
  ],
  knot: [
    { key: "steel", figure: "stainless", plinth: "concrete_cast", accent: "galvanised_steel", text: "brushed stainless steel on a concrete block" },
    { key: "copper", figure: "verdigris", plinth: "granite_dark", accent: "bronze_weathered", text: "green-patinated copper on dark granite", streaks: true },
  ],
  hoop: [
    { key: "corten", figure: "corten", plinth: "concrete_weathered", accent: "bright_chrome", text: "rusted corten steel with a polished sphere on concrete" },
    { key: "chrome", figure: "bright_chrome", plinth: "marble_dark", accent: "gilt", text: "polished chrome with a gilt sphere on black marble" },
  ],
};

/**
 * One run-off drip of patina, hanging from y = 0 down a face at z = 0 (towards +z, 3 mm thick): wide where the water
 * leaves the bronze, wandering and narrowing to a thin tip, with a bulge where a drop hung. Plan in (x, depth down).
 */
function drip(name: string, x: Num, top: Num, z: Num, len: Num, k: number): SpecNode {
  const r = rng(101 + k * 17);
  const w = 0.03 + 0.04 * r();
  const ts = [0, 0.06, 0.16, 0.28, 0.4, 0.52, 0.63, 0.74, 0.84, 0.92, 1];
  // The run wanders more the further it gets; one or two drops hung on the way down and left a bulge.
  let cx = 0;
  const centre = ts.map((t) => (cx += (r() - 0.5) * 0.006 * (0.3 + t)));
  const bulges = new Set([2 + Math.floor(r() * 4), 6 + Math.floor(r() * 3)]);
  const left: [Num, Num][] = [], right: [Num, Num][] = [];
  ts.forEach((t, i) => {
    const taper = Math.pow(1 - t, 0.55) * (bulges.has(i) ? 1.35 : 1);
    const hl = Math.max(0.0012, (w / 2) * taper * (0.8 + 0.4 * r()));
    const hr = Math.max(0.0012, (w / 2) * taper * (0.8 + 0.4 * r()));
    const d = `(${len}) * ${t.toFixed(3)}`;
    left.push([Number((centre[i]! - hl).toFixed(4)), d]);
    right.push([Number((centre[i]! + hr).toFixed(4)), d]);
  });
  return extrude(name, [...left, ...right.reverse()], 0, 0.003, { at: [x, top, z], rotate: [90, 0, 0], material: k % 2 ? "patina_run" : "verdigris" });
}

/** Weathering on a plinth face at z = zf: a dark grime band at the foot and (copper alloys) green run-off drips. */
const weather = (f: Finish, wx: Num, wz: Num, streak?: { w: Num; z: Num; top: Num; len: Num }): SpecNode[] => [
  box("Grime", [`${wx} + 0.004`, 0.07, `${wz} + 0.004`], { anchor: "bottom", material: "wet_stain" }),
  ...(f.streaks && streak
    ? [-0.36, -0.2, -0.05, 0.13, 0.3].map((u, k) => {
        const r = rng(7 + k * 31);
        const lf = 0.55 + 0.45 * r();
        return drip(`Streak_${k + 1}`, `(${streak.w}) * ${(u + (r() - 0.5) * 0.06).toFixed(3)}`, `${streak.top} - ${(0.002 + 0.02 * r()).toFixed(3)}`, `${streak.z} + ${(0.001 + 0.0006 * k).toFixed(4)}`, `(${streak.len}) * ${lf.toFixed(3)}`, k);
      })
    : []),
];

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
        ...weather(f, "$pw * 1.1", "$pw * 1.1"),
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
        ...weather(f, "$pw + 0.24", "$pw + 0.24", { w: "$pw", z: "$pw / 2", top: "$ph - 0.16", len: "($ph - 0.3) * 0.8" }),
      ], { material: f.plinth }),
      group("Figure", [
        box("Foot_L", [S(0.1), S(0.06), S(0.25)], { at: [S(0.1), 0, S(0.04)], anchor: "bottom", bevel: S(0.02), mirror: "Foot_R" }),
        lathe("Leg_L", [[S(0.03), S(0.05)], [S(0.045), S(0.07)], [S(0.06), S(0.25)], [S(0.065), S(0.38)], [S(0.056), S(0.5)], [S(0.085), S(0.7)], [S(0.1), S(0.92)], [S(0.05), S(0.96)]], { at: [S(0.1), 0, 0], segments: 14, mirror: "Leg_R" }),
        ellipsoid("Pelvis", [S(0.19), S(0.12), S(0.12)], { at: [0, S(0.95), 0], segments: 20 }),
        loft("Torso", [0.92, 1.05, 1.2, 1.36, 1.46, 1.52].map((z, k) => ({
          z: S(z),
          superellipse: { width: S([0.34, 0.31, 0.34, 0.42, 0.4, 0.2][k] as number), height: S([0.22, 0.2, 0.24, 0.24, 0.2, 0.12][k] as number), n: 2.4, count: 20 },
        })), { rotate: [-90, 0, 0] }),
        loft("Coat", [0.5, 0.62, 0.8, 0.98, 1.18, 1.36, 1.44].map((z, k) => ({
          z: S(z),
          superellipse: { width: S([0.5, 0.46, 0.4, 0.37, 0.37, 0.43, 0.38][k] as number), height: S([0.34, 0.31, 0.27, 0.25, 0.25, 0.25, 0.2][k] as number), n: 2.2, count: 20 },
        })), { rotate: [-90, 0, 0] }),
        tube("Lapel_L", [[S(0.05), S(1.42), S(0.115)], [S(0.08), S(1.2), S(0.12)], [S(0.02), S(1.0), S(0.12)]], S(0.018), { segments: 8, mirror: "Lapel_R" }),
        ellipsoid("Hair", [S(0.1), S(0.08), S(0.105)], { at: [0, S(1.72), S(-0.01)], segments: 16 }),
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
        ...weather(f, "$pw", "$pw"),
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
        box("Shadow", ["$pw + 0.04", 0.04, "$pw * 0.7 + 0.04"], { anchor: "bottom", bevel: 0.01, material: "granite_dark" }),
        box("Label", [0.3, 0.08, 0.01], { at: [0, "$ph * 0.6", "$pw * 0.35"], bevel: 0.003, material: f.accent }),
        ...weather(f, "$pw", "$pw * 0.7", { w: "$pw * 0.6", z: "$pw * 0.35", top: "$ph", len: "$ph * 0.4" }),
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
        ...(f.key === "corten" ? [box("RustStain", ["$t * 2.2", 0.004, "$t * 1.6"], { at: [0, "$ph", 0], material: "corten" })] : []),
        ...weather(f, "$figureHeight * 0.8", "max(0.6, $t * 4)"),
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
    description: `${s.text}, in ${f.text}, with a dark weathering band at its foot. It faces +z.`,
    tags: [style, f.key, ...f.text.split(" ").filter((w) => w.length > 3), ...s.tags],
    params: s.params(),
    materials: finish(...new Set([f.figure, f.plinth, f.accent, "granite_dark", "wet_stain", "verdigris", "patina_run", "corten"])),
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
