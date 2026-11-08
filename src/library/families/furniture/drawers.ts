import { box, combos, group, int, lathe, num, slugify, cap, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { barHandle, cupPull, fmats, knob, labelHolder, squareLeg } from "./parts.js";

const STYLES = ["dresser", "nightstand", "filing", "tallboy"] as const;
type Style = (typeof STYLES)[number];

interface Finish { body: string; front: string; metal: string }
const FINISHES: Record<Style, Finish[]> = {
  dresser: [{ body: "oak", front: "oak", metal: "brass" }, { body: "paint_white", front: "paint_white", metal: "brass" }, { body: "walnut", front: "walnut", metal: "bronze" }, { body: "paint_mint", front: "paint_mint", metal: "ceramic_white" }],
  nightstand: [{ body: "walnut", front: "walnut", metal: "brass" }, { body: "light_oak", front: "paint_white", metal: "brushed_steel" }, { body: "teak", front: "teak", metal: "black_steel" }, { body: "paint_navy", front: "paint_navy", metal: "brass" }],
  filing: [{ body: "paint_grey", front: "paint_grey", metal: "brushed_steel" }, { body: "paint_anthracite", front: "paint_anthracite", metal: "chrome" }, { body: "paint_olive", front: "paint_olive", metal: "aluminium" }, { body: "oak", front: "oak", metal: "brass" }],
  tallboy: [{ body: "mahogany", front: "mahogany", metal: "brass" }, { body: "pine", front: "pine", metal: "cast_iron" }, { body: "cherry", front: "cherry", metal: "brass" }, { body: "dark_stain", front: "dark_stain", metal: "bronze" }],
};

/**
 * One drawer: its node sits at the centre of the drawer (front plus tray), so it can slide out along +z. `fw` and `fh`
 * are the front's width and height; the handles hang on the front face.
 */
function drawer(name: string, at: [Num, Num, Num], fw: string, fh: string, handles: SpecNode[], f: Finish, o: { mirror?: string; repeat?: { count: Num; step: [Num, Num, Num] }; proud?: number; field?: boolean } = {}): SpecNode {
  // The parts span from the back of the tray (-D/2 + 0.027) to the front face (D/2 - 0.015) plus the handles; the
  // node moves to the middle of that, and the parts move back by the same amount, so nothing moves in the world.
  const c = Math.round(((0.012 + (o.proud ?? 0.03)) / 2) * 10000) / 10000;
  const { proud: _p, field, ...rest } = o;
  return group(name, [
    group("Parts", [
      box("Front", [`${fw} - 0.007`, `${fh} - 0.007`, 0.02], { at: [0, 0, "$fz"], bevel: 0.005, material: f.front, children: field ? [
        box("Field", [`${fw} - 0.07`, `${fh} - 0.06`, 0.006], { at: [0, 0, 0.011], bevel: 0.004 }),
      ] : [] }),
      box("Reveal", [fw, fh, 0.004], { at: [0, 0, "$fz - 0.012"], material: "reveal" }),
      box("Tray", [`${fw} - 0.05`, `${fh} - 0.04`, "$D - 0.06"], { at: [0, -0.008, "$fz - ($D - 0.06) / 2 - 0.008"] }),
      ...handles,
    ], { at: [0, 0, -c] }),
  ], { at: [at[0], at[1], `${at[2]} + ${c}`], ...rest });
}

/** Front plane of the carcass is z = D/2; a drawer's centre is halfway between its front face and its back. */
const DRAWER_VARS = { fz: "($D - 0.03) / 2 - 0.01", zc: "0.015" };

function dresser(f: Finish): SpecNode[] {
  const k = (name: string, x: Num): SpecNode => knob(name, [x, 0, "$fz + 0.01"], f.metal, 1.1);
  return [
    group("Body", [
      box("Side_L", ["$s", "$H - 0.1 - 0.03", "$D"], { at: ["$W / 2 - $s / 2", 0.1, 0], anchor: "bottom", bevel: 0.004, mirror: "Side_R" }),
      box("Top", ["$W + 0.03", 0.03, "$D + 0.02"], { at: [0, "$H - 0.015", 0.01], bevel: 0.01 }),
      box("Bottom", ["$W", "$s", "$D"], { at: [0, "0.1 + $s / 2", 0] }),
      box("Back", ["$W - 0.02", "$H - 0.13", 0.008], { at: [0, 0.1, "-$D / 2 + 0.004"], anchor: "bottom" }),
      box("Plinth", ["$W + 0.01", 0.06, "$D + 0.006"], { at: [0, 0.07, 0.003], bevel: 0.006 }),
      box("Foot_FL", [0.07, 0.075, 0.07], { at: ["$W / 2 - 0.03", 0, "$D / 2 - 0.03"], anchor: "bottom", bevel: 0.012, mirror: "Foot_FR" }),
      box("Foot_BL", [0.07, 0.075, 0.07], { at: ["$W / 2 - 0.03", 0, "-$D / 2 + 0.03"], anchor: "bottom", bevel: 0.012, mirror: "Foot_BR" }),
    ]),
    drawer("Drawer_{i}", [0, "0.1 + $s + $rh / 2", "$zc"], "$W - 2 * $s", "$rh", [k("Knob_L", "-$W / 4"), k("Knob_R", "$W / 4")], f, { proud: 0.033, field: true, repeat: { count: "$r - 1", step: [0, "$rh", 0] } }),
    drawer("Drawer_TL", ["$W / 4 - $s / 4", "0.1 + $s + $rh * ($r - 0.5)", "$zc"], "$W / 2 - $s", "$rh", [k("Knob", 0)], f, { mirror: "Drawer_TR", proud: 0.033, field: true }),
  ];
}

function nightstand(f: Finish): SpecNode[] {
  return [
    group("Body", [
      box("Side_L", ["$s", "$H - 0.2", "$D"], { at: ["$W / 2 - $s / 2", 0.18, 0], anchor: "bottom", bevel: 0.004, mirror: "Side_R" }),
      box("Top", ["$W + 0.01", 0.022, "$D + 0.01"], { at: [0, "$H - 0.011", 0.005], bevel: 0.006 }),
      box("Bottom", ["$W", 0.022, "$D"], { at: [0, 0.191, 0], bevel: 0.004 }),
      box("Back", ["$W - 0.02", "$H - 0.2", 0.008], { at: [0, 0.18, "-$D / 2 + 0.004"], anchor: "bottom" }),
      box("Shelf", ["$W - 2 * $s + 0.004", "$s", "$D - 0.03"], { at: [0, "$H - 0.022 - $r * $rh - $s / 2", -0.01] }),
      squareLeg("Leg_FL", ["$W / 2 - 0.03", 0, "$D / 2 - 0.03"], 0.185, 0.034, 0.022, "Leg_FR"),
      squareLeg("Leg_BL", ["$W / 2 - 0.03", 0, "-$D / 2 + 0.03"], 0.185, 0.034, 0.022, "Leg_BR"),
    ]),
    drawer("Drawer_{i}", [0, "$H - 0.022 - $rh / 2", "$zc"], "$W - 2 * $s", "$rh", [knob("Knob", [0, 0, "$fz + 0.01"], f.metal)], f, { repeat: { count: "$r", step: [0, "-$rh", 0] } }),
  ];
}

function filing(f: Finish): SpecNode[] {
  return [
    group("Body", [
      box("Shell", ["$W", "$H - 0.06", "$D - 0.02"], { at: [0, 0.06, -0.01], anchor: "bottom", bevel: 0.008 }),
      box("Kick", ["$W - 0.04", 0.062, "$D - 0.06"], { at: [0, 0, -0.01], anchor: "bottom", material: "paint_anthracite" }),
      box("Lock", [0.022, 0.022, 0.012], { at: ["$W / 2 - 0.05", "$H - 0.022", "$D / 2 - 0.016"], material: f.metal, bevel: 0.004 }),
    ]),
    drawer("Drawer_{i}", [0, "0.07 + $rh / 2", "$zc"], "$W - 0.02", "$rh", [
      barHandle("Handle", "$W * 0.4", [0, "$rh * 0.18", "$fz + 0.008"], f.metal, { standoff: 0.025 }),
      labelHolder("Label", [0, "$rh * 0.32", "$fz + 0.012"], f.metal),
    ], f, { repeat: { count: "$r", step: [0, "$rh", 0] } }),
  ];
}

function tallboy(f: Finish): SpecNode[] {
  const foot = (name: string, z: string, mirror: string): SpecNode =>
    lathe(name, [[0.022, 0], [0.032, 0.012], [0.04, 0.045], [0.032, 0.075], [0.036, 0.085]], { at: ["$W / 2 - 0.05", 0, z], segments: 16, mirror });
  const pulls = [cupPull("Pull_L", ["-$W / 4", 0.005, "$fz + 0.014"], f.metal), cupPull("Pull_R", ["$W / 4", 0.005, "$fz + 0.014"], f.metal)];
  return [
    group("Body", [
      box("Side_L", ["$s", "$H - 0.08 - 0.05", "$D"], { at: ["$W / 2 - $s / 2", 0.08, 0], anchor: "bottom", bevel: 0.004, mirror: "Side_R" }),
      box("Cornice", ["$W + 0.04", 0.05, "$D + 0.025"], { at: [0, "$H - 0.025", 0.012], bevel: 0.01 }),
      box("Bead", ["$W + 0.014", 0.015, "$D + 0.01"], { at: [0, "$H - 0.055", 0.005], bevel: 0.006 }),
      box("Base_Moulding", ["$W + 0.02", 0.045, "$D + 0.012"], { at: [0, 0.1, 0.006], bevel: 0.008 }),
      box("Back", ["$W - 0.02", "$H - 0.13", 0.008], { at: [0, 0.08, "-$D / 2 + 0.004"], anchor: "bottom" }),
      foot("Foot_FL", "$D / 2 - 0.05", "Foot_FR"),
      foot("Foot_BL", "-$D / 2 + 0.05", "Foot_BR"),
    ]),
    drawer("Drawer_{i}", [0, "0.125 + $rh / 2", "$zc"], "$W - 2 * $s", "$rh", pulls, f, { proud: 0.036, field: true, repeat: { count: "$r", step: [0, "$rh", 0] } }),
  ];
}

const TEXT: Record<Style, string> = {
  dresser: "A low dresser: rows of wide drawers with two knobs each under two half-width top drawers, a plinth on bracket feet and an overhanging top",
  nightstand: "A bedside nightstand on tapered legs with drawers at the top and an open shelf below",
  filing: "A metal filing cabinet with full-extension drawers, each with a label holder and a bar handle, a lock at the top and a recessed kick base",
  tallboy: "A tall chest of drawers (tallboy) with a cornice, a stack of drawers with pairs of cup pulls and turned bun feet",
};

const RANGES: Record<Style, { w: [number, number, number]; h: [number, number, number]; d: [number, number, number]; r: [number, number, number]; base: string }> = {
  dresser: { w: [1.1, 0.9, 1.4], h: [0.85, 0.72, 1.0], d: [0.5, 0.45, 0.55], r: [4, 3, 5], base: "($H - 0.13 - 0.018) / $r" },
  nightstand: { w: [0.48, 0.4, 0.56], h: [0.58, 0.5, 0.66], d: [0.4, 0.34, 0.45], r: [1, 1, 2], base: "min(0.15, ($H - 0.3) / $r)" },
  filing: { w: [0.46, 0.4, 0.52], h: [1.02, 0.7, 1.35], d: [0.62, 0.55, 0.7], r: [3, 2, 4], base: "($H - 0.11) / $r" },
  tallboy: { w: [0.8, 0.6, 0.95], h: [1.3, 1.1, 1.55], d: [0.46, 0.42, 0.52], r: [5, 4, 6], base: "($H - 0.125 - 0.06) / $r" },
};

function makeDrawers(style: Style, f: Finish): AssetDraft {
  const r = RANGES[style];
  const body = label(f.body);
  const front = label(f.front);
  const word = { dresser: "dresser", nightstand: "nightstand", filing: "filing cabinet", tallboy: "tallboy chest" }[style];
  return {
    slug: slugify("drawers", style, f.front.replace(/^paint_/, ""), ...(f.front !== f.body ? [f.body.replace(/^paint_/, "")] : [])),
    title: `${cap(front)} ${word}`,
    description: `${TEXT[style]}, ${f.body === f.front ? `in ${body}` : `with a ${body} carcass and ${front} drawer fronts`} and ${label(f.metal)} hardware. Each drawer slides out along +z; the front faces +z.`,
    tags: [style, f.front.replace(/^paint_/, ""), f.body.replace(/^paint_/, ""), "drawers", "laden", ...(style === "dresser" ? ["commode", "ladekast"] : style === "nightstand" ? ["nachtkastje", "bedside table"] : style === "filing" ? ["archiefkast", "kantoor"] : ["ladenkast", "chest of drawers"])],
    params: [
      num("width", r.w[0], r.w[1], r.w[2], "Width along x in metres."),
      num("height", r.h[0], r.h[1], r.h[2], "Overall height in metres."),
      num("depth", r.d[0], r.d[1], r.d[2], "Depth along z in metres."),
      int("rows", r.r[0], r.r[1], r.r[2], "Number of drawer rows."),
    ],
    materials: fmats(...new Set([f.body, f.front, f.metal, "paint_anthracite", "plastic_white", "reveal"])),
    nodes: [group("Drawers", { dresser, nightstand, filing, tallboy }[style](f), { material: f.body, vars: { W: "$width", H: "$height", D: "$depth", r: "$rows", s: 0.018, rh: r.base, ...DRAWER_VARS } })],
  };
}

export const drawers: Family = {
  id: "drawers",
  category: "furniture",
  archetype: "prop.drawers",
  tags: ["chest of drawers", "drawers", "ladekast", "commode", "kast", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2, 3] as const }).map(({ style, k }) => makeDrawers(style, FINISHES[style][k] as Finish)),
};
