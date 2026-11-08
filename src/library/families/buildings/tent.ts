import { box, cyl, extrude, group, lathe, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";

const LOCAL: Record<string, MaterialDef> = {
  nylon_orange: { color: [0.85, 0.28, 0.03], metallic: 0, roughness: 0.55 },
  nylon_green: { color: [0.08, 0.3, 0.1], metallic: 0, roughness: 0.55 },
  nylon_blue: { color: [0.04, 0.18, 0.55], metallic: 0, roughness: 0.55 },
  nylon_red: { color: [0.6, 0.05, 0.04], metallic: 0, roughness: 0.55 },
  nylon_grey: { color: [0.3, 0.32, 0.33], metallic: 0, roughness: 0.55 },
  nylon_yellow: { color: [0.85, 0.65, 0.05], metallic: 0, roughness: 0.55 },
  cotton_canvas: { color: [0.72, 0.66, 0.52], metallic: 0, roughness: 0.95 },
  canvas_olive: { color: [0.2, 0.22, 0.1], metallic: 0, roughness: 0.95 },
  canvas_white: { color: [0.86, 0.84, 0.78], metallic: 0, roughness: 0.95 },
  canvas_khaki: { color: [0.45, 0.4, 0.26], metallic: 0, roughness: 0.95 },
  hide: { color: [0.62, 0.48, 0.32], metallic: 0, roughness: 0.95 },
  rope: { color: [0.6, 0.55, 0.42], metallic: 0, roughness: 0.95 },
  painted_ochre: { color: [0.55, 0.22, 0.05], metallic: 0, roughness: 0.95 },
  painted_black: { color: [0.04, 0.035, 0.03], metallic: 0, roughness: 0.95 },
};

const STYLES = {
  dome: { text: "a two-pole dome tent: a rounded flysheet over two crossing shock-corded poles, a domed porch over the front door with a zip, and guy ropes to pegs", l: [2.0, 3.2, 2.4], w: [1.3, 2.2, 1.6], h: [0.9, 1.4, 1.15] },
  ridge: { text: "a classic ridge tent: an A-shaped flysheet on two upright poles and a ridge pole, door flaps tied back at the front gable, a sod cloth along the bottom and guy ropes at every corner", l: [1.8, 3.2, 2.4], w: [1.3, 2.2, 1.7], h: [1.0, 1.8, 1.35] },
  tipi: { text: "a tipi: a tall cone of canvas round a ring of poles that cross and stick out at the top, smoke flaps, a laced front seam, a door flap at the front and pegs round the hem", l: [2.6, 3.4, 3.0], w: [2.6, 3.4, 3.0], h: [2.4, 3.3, 2.9] },
  bell: { text: "a cotton bell tent: low vertical walls and a cone roof on one centre pole, an A-frame door pole, a zipped door in the front and a ring of guy ropes to pegs", l: [2.8, 3.6, 3.2], w: [2.8, 3.6, 3.2], h: [2.4, 3.0, 2.6] },
} as const;
type Style = keyof typeof STYLES;

const FINISHES: Record<Style, { id: string; a: string; b: string; text: string; nl: string }[]> = {
  dome: [
    { id: "orange", a: "nylon_orange", b: "nylon_grey", text: "orange", nl: "oranje" },
    { id: "green", a: "nylon_green", b: "nylon_grey", text: "green", nl: "groen" },
    { id: "blue", a: "nylon_blue", b: "nylon_yellow", text: "blue", nl: "blauw" },
    { id: "red", a: "nylon_red", b: "nylon_grey", text: "red", nl: "rood" },
  ],
  ridge: [
    { id: "canvas", a: "cotton_canvas", b: "canvas_khaki", text: "canvas", nl: "katoen" },
    { id: "olive", a: "canvas_olive", b: "canvas_khaki", text: "olive army", nl: "legergroen" },
    { id: "orange", a: "nylon_orange", b: "nylon_grey", text: "orange nylon", nl: "oranje" },
    { id: "blue", a: "nylon_blue", b: "nylon_grey", text: "blue nylon", nl: "blauw" },
  ],
  tipi: [
    { id: "white", a: "canvas_white", b: "painted_ochre", text: "white canvas", nl: "wit" },
    { id: "hide", a: "hide", b: "painted_black", text: "hide-coloured", nl: "leer" },
    { id: "khaki", a: "canvas_khaki", b: "painted_ochre", text: "khaki", nl: "kaki" },
  ],
  bell: [
    { id: "natural", a: "cotton_canvas", b: "canvas_khaki", text: "natural cotton", nl: "naturel" },
    { id: "white", a: "canvas_white", b: "cotton_canvas", text: "white", nl: "wit" },
    { id: "olive", a: "canvas_olive", b: "canvas_khaki", text: "olive", nl: "olijfgroen" },
  ],
};

/** Points of a half ellipse (an arch standing on y = 0) of half-width a and height b, scaled by k. */
function archPoints(a: string, b: string, k: number, n = 12): [string, string][] {
  const out: [string, string][] = [];
  for (let j = 0; j <= n; j++) {
    const t = Math.PI - (j * Math.PI) / n;
    const c = Math.cos(t), s = Math.sin(t);
    // A slightly squarer arch than an ellipse, like a pole-tensioned fly.
    const cx = Math.sign(c) * Math.pow(Math.abs(c), 0.8), sy = Math.pow(s, 0.7);
    out.push([`${a} * ${(k * cx).toFixed(5)}`, `max(0.002, ${b} * ${(Math.max(0.03, k) * sy).toFixed(5)})`]);
  }
  return out;
}

function peg(name: string, at: [string | number, string | number, string | number], o: { repeat?: { count: number; around?: "y"; phase?: number; step?: [string | number, string | number, string | number] } } = {}): SpecNode {
  return group(name, [
    cyl("Spike", 0.008, 0.12, { anchor: "base", segments: 6, material: "aluminium" }),
    box("Hook", [0.05, 0.012, 0.012], { at: [0.02, 0.115, 0], material: "aluminium" }),
  ], { at, repeat: o.repeat });
}

function tent(style: Style, f: (typeof FINISHES)[Style][number]): AssetDraft {
  const s = STYLES[style];
  const kids: SpecNode[] = [];
  if (style === "dome") {
    const ks = [-1, -0.85, -0.6, -0.3, 0, 0.3, 0.6, 0.85, 1];
    kids.push(group("Canvas", [
      loft("Fly", ks.map((k) => ({ z: `$hl * ${k}`, points: archPoints("$hw", "$h", Math.sqrt(1 - 0.9 * k * k)) })), { material: f.a, rotate: [0, 90, 0] }),
      box("Groundsheet", ["2 * $hl * 0.72", 0.01, "2 * $hw * 0.68"], { at: [0, 0.005, 0], material: f.b }),
    ]));
    kids.push(group("Poles", [
      tube("Pole_A", [-1, -0.7, -0.35, 0, 0.35, 0.7, 1].map((t) => [`$hl * 0.62 * ${t}`, `0.01 + ($h + 0.02) * ${Math.pow(1 - t * t * 0.995, 0.5).toFixed(5)}`, `$hw * 0.92 * ${t}`] as [string, string, string]), 0.008, { mirror: "Pole_B", segments: 6, material: "aluminium" }),
    ]));
    kids.push(group("Entrance", [
      loft("Porch", [0, 0.3, 0.6, 0.85, 1].map((t) => ({ z: `$hw * 0.6 + 0.55 * ${t}`, points: archPoints("0.45", "$h * 0.82", Math.sqrt(1 - 0.92 * t * t)) })), { material: f.a }),
      box("Zip", [0.02, "$h * 0.6", 0.02], { at: [0, "$h * 0.3", "$hw * 0.6 + 0.47"], rotate: [-28, 0, 0], material: f.b }),
    ]));
    kids.push(group("GuyRopes", [
      tube("GuyRope_{i}", [["$hl * 0.8", "$h * 0.55", 0], ["$hl + 0.7", 0.01, 0]], 0.005, { repeat: { count: 2, around: "y" }, segments: 5, material: "rope" }),
      tube("GuyRopeBack", [[0, "$h * 0.5", "-$hw * 0.85"], [0, 0.01, "-$hw - 0.6"]], 0.005, { segments: 5, material: "rope" }),
      peg("Peg_{i}", ["$hl + 0.7", 0, 0], { repeat: { count: 2, around: "y" } }),
      peg("PegBack", [0, 0, "-$hw - 0.6"]),
      peg("PegPorch", [0, 0, "$hw * 0.6 + 0.58"]),
    ]));
  } else if (style === "ridge") {
    kids.push(group("Canvas", [
      extrude("Fly", [["-$hw", 0], ["$hw", 0], [0.03, "$h"], [-0.03, "$h"]], "-$hl", "$hl", { rotate: [-90, 0, 0], material: f.a }),
      box("SodCloth_L", [0.04, 0.12, "2 * $hl"], { at: ["-$hw + 0.04", 0.06, 0], mirror: "SodCloth_R", material: f.b }),
      box("Patch_L", [0.03, 0.18, 0.18], { at: ["-$hw * 0.5", "$h * 0.5", "$hl * 0.5"], rotate: [0, 0, "deg(atan($h / $hw))"], mirror: "Patch_R", material: f.b }),
    ]));
    kids.push(group("Poles", [
      cyl("Upright_F", 0.015, "$h + 0.12", { anchor: "base", at: [0, 0, "$hl + 0.02"], segments: 8, material: "oak" }),
      cyl("Upright_B", 0.015, "$h + 0.12", { anchor: "base", at: [0, 0, "-$hl - 0.02"], segments: 8, material: "oak" }),
      cyl("Ridge", 0.015, "2 * $hl + 0.06", { axis: "z", at: [0, "$h + 0.01", 0], segments: 8, material: "oak" }),
    ]));
    kids.push(group("Entrance", [
      extrude("Flap_L", [[0, 0], ["-$hw * 0.9", 0], [0, "$h * 0.9"]], 0, 0.02, { rotate: [-90, 25, 0], at: [-0.02, 0.01, 0.05], material: f.b }),
      extrude("Flap_R", [[0, 0], ["$hw * 0.9", 0], [0, "$h * 0.9"]], 0, 0.02, { rotate: [-90, -25, 0], at: [0.02, 0.01, 0.05], material: f.b }),
      box("Tie_L", [0.03, 0.03, 0.12], { at: ["-$hw * 0.5", "$h * 0.35", 0.04], mirror: "Tie_R", material: "rope" }),
    ], { at: [0, 0, "$hl"] }));
    kids.push(group("GuyRopes", [
      tube("GuyRope_F", [[0, "$h + 0.1", "$hl + 0.02"], [0, 0.01, "$hl + 0.9"]], 0.005, { segments: 5, material: "rope" }),
      tube("GuyRope_B", [[0, "$h + 0.1", "-$hl - 0.02"], [0, 0.01, "-$hl - 0.9"]], 0.005, { segments: 5, material: "rope" }),
      tube("GuyRope_L{i}", [["-$hw * 0.55", "$h * 0.45", "-$hl * 0.7"], ["-$hw - 0.6", 0.01, "-$hl * 0.7"]], 0.005, { repeat: { count: 3, step: [0, 0, "$hl * 0.7"] }, mirror: "GuyRope_R{i}", segments: 5, material: "rope" }),
      peg("Peg_F", [0, 0, "$hl + 0.9"]),
      peg("Peg_B", [0, 0, "-$hl - 0.9"]),
      peg("Peg_L{i}", ["-$hw - 0.6", 0, "-$hl * 0.7"], { repeat: { count: 3, step: [0, 0, "$hl * 0.7"] } }),
      peg("Peg_R{i}", ["$hw + 0.6", 0, "-$hl * 0.7"], { repeat: { count: 3, step: [0, 0, "$hl * 0.7"] } }),
    ]));
  } else if (style === "tipi") {
    kids.push(group("Canvas", [
      lathe("Cone", [["$r", 0], ["$r * 0.97", 0.08], ["$r * 0.12", "$h * 0.88"], ["$r * 0.06", "$h * 0.9"]], { segments: 24, material: f.a }),
      lathe("Band", [["$r * 0.94", "$h * 0.06"], ["$r * 0.82", "$h * 0.2"], ["$r * 0.8", "$h * 0.21"], ["$r * 0.94", "$h * 0.07"]], { segments: 24, material: f.b }),
      box("SmokeFlap_L", ["$r * 0.35", "$h * 0.3", 0.02], { at: ["-$r * 0.14", "$h * 0.72", "$r * 0.2"], rotate: [-18, 0, 20], mirror: "SmokeFlap_R", material: f.a }),
      box("Lacing_{i}", [0.04, 0.02, 0.02], { at: [0, "$h * 0.35 + $i * $h * 0.08", "$r * (0.97 - 0.85 * (0.35 + $i * 0.08)) + 0.01"], repeat: { count: 6, step: [0, 0, 0] }, material: "rope" }),
    ]));
    kids.push(group("Poles", [
      tube("Pole_{i}", [["$r * 0.95", 0.01, 0], ["-$r * 0.12", "$h * 1.08", 0]], 0.025, { repeat: { count: 10, around: "y", phase: 18 }, segments: 6, material: "rough_timber" }),
    ]));
    kids.push(group("Entrance", [
      box("Flap", [0.75, 1.05, 0.03], { at: [0, 0.6, "$r - 0.6 * $r / $h + 0.03"], rotate: ["-deg(atan($r / $h))", 0, 0], material: f.b }),
      box("Pin_{i}", [0.02, 0.02, 0.08], { at: [0, "1.25 + $i * 0.15", "$r - (1.25 + $i * 0.15) * $r / $h + 0.02"], repeat: { count: 3, step: [0, 0, 0] }, material: "oak" }),
    ]));
    kids.push(group("GuyRopes", [
      peg("Peg_{i}", [0, 0, "$r + 0.06"], { repeat: { count: 12, around: "y", phase: 15 } }),
      tube("Line_{i}", [[0, 0.03, "$r - 0.02"], [0, 0.03, "$r + 0.06"]], 0.006, { repeat: { count: 12, around: "y", phase: 15 }, segments: 5, material: "rope" }),
    ]));
  } else {
    kids.push(group("Canvas", [
      lathe("Walls", [["$r", 0], ["$r", "$wall"], ["$r - 0.02", "$wall + 0.02"], ["0.08", "$h"], ["0.05", "$h + 0.03"]], { segments: 24, material: f.a }),
      lathe("Valance", [["$r + 0.06", "$wall - 0.05"], ["$r + 0.06", "$wall + 0.08"], ["$r - 0.06", "$wall + 0.14"], ["$r - 0.06", "$wall - 0.05"]], { segments: 24, material: f.b }),
      cyl("Vent_{i}", 0.09, 0.05, { axis: "z", at: [0, "$h * 0.62", "($r - 0.02) * (1 - ($h * 0.62 - $wall) / ($h - $wall)) + 0.06"], rotate: [-30, 0, 0], repeat: { count: 3, around: "y", phase: 60 }, segments: 10, material: f.b }),
    ]));
    kids.push(group("Poles", [
      cyl("CentrePole", 0.025, "$h + 0.15", { anchor: "base", segments: 8, material: "galvanised" }),
      cyl("Spike", 0.012, 0.15, { anchor: "base", at: [0, "$h + 0.13", 0], segments: 6, material: "galvanised" }),
      tube("DoorPole_L", [[-0.45, 0.01, "$r + 0.05"], [0, "$wall + 0.55", "$r + 0.02"]], 0.015, { mirror: "DoorPole_R", segments: 6, material: "galvanised" }),
    ]));
    kids.push(group("Entrance", [
      box("Door", [0.9, "$wall + 0.4", 0.02], { anchor: "bottom", at: [0, 0.01, 0.01], material: f.b }),
      box("Zip", [0.025, "$wall + 0.35", 0.01], { anchor: "bottom", at: [0, 0.03, 0.025], material: "aluminium" }),
    ], { at: [0, 0, "$r"] }));
    kids.push(group("GuyRopes", [
      tube("GuyRope_{i}", [[0, "$wall + 0.05", "$r + 0.04"], [0, 0.01, "$r + 0.7"]], 0.006, { repeat: { count: 8, around: "y", phase: 22.5 }, segments: 5, material: "rope" }),
      box("Runner_{i}", [0.03, 0.02, 0.08], { at: [0, "($wall + 0.05) * 0.4", "$r + 0.43"], rotate: ["deg(atan(($wall + 0.05) / 0.66))", 0, 0], repeat: { count: 8, around: "y", phase: 22.5 }, material: "oak" }),
      peg("Peg_{i}", [0, 0, "$r + 0.7"], { repeat: { count: 8, around: "y", phase: 22.5 } }),
      peg("Hem_{i}", [0, 0, "$r + 0.02"], { repeat: { count: 12, around: "y", phase: 15 } }),
    ]));
  }

  const round = style === "tipi" || style === "bell";
  const params = round
    ? [
      num("diameter", s.l[2], s.l[0], s.l[1], "Diameter of the floor in metres."),
      num("height", s.h[2], s.h[0], s.h[1], "Height to the top in metres."),
      ...(style === "bell" ? [num("wallHeight", 0.6, 0.4, 0.8, "Height of the low vertical wall in metres.")] : []),
    ]
    : [
      num("length", s.l[2], s.l[0], s.l[1], style === "dome" ? "Length along x in metres." : "Length along z in metres."),
      num("width", s.w[2], s.w[0], s.w[1], style === "dome" ? "Depth along z in metres." : "Width along x in metres."),
      num("height", s.h[2], s.h[0], s.h[1], "Height of the top in metres."),
    ];
  const vars: Record<string, string> = round ? { r: "$diameter / 2", h: "$height", ...(style === "bell" ? { wall: "$wallHeight" } : {}) } : { hl: "$length / 2", hw: "$width / 2", h: "$height" };
  const names = [f.a, f.b, "rope", "aluminium", "oak", "rough_timber", "galvanised"];
  const materials: Record<string, MaterialDef> = {};
  for (const n of names) materials[n] = LOCAL[n] ?? (mats(n)[n] as MaterialDef);
  const title = { dome: "dome tent", ridge: "ridge tent", tipi: "tipi", bell: "bell tent" }[style];
  return {
    slug: slugify("tent", style, f.id),
    title: `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)} ${title}`,
    description: `A ${f.text} ${title}: ${s.text}. The entrance faces +z.`,
    tags: [style, f.id, f.nl, "camping", "kamperen", ...(style === "dome" ? ["koepeltent", "iglotent"] : style === "ridge" ? ["trekkerstent", "a-frame"] : style === "tipi" ? ["tipi", "wigwam", "indianentent"] : ["klokkentent", "glamping"])],
    params,
    materials,
    nodes: [group("Tent", kids, { vars })],
  };
}

export const tentFamily: Family = {
  id: "tent",
  category: "buildings",
  archetype: "prop.tent",
  tags: ["tent", "tenten", "camping", "kamperen", "shelter"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => FINISHES[style].map((f) => tent(style, f))),
};
