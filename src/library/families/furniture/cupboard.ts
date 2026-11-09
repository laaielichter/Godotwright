import { box, combos, cyl, group, int, num, slugify, cap, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { board, barHandle, fmats, knob, shell, squareLeg } from "./parts.js";

const STYLES = ["wardrobe", "kitchen", "display", "sideboard"] as const;
type Style = (typeof STYLES)[number];

/** body: carcass; door: door fronts; top: worktop or top; metal: handles and hinges. */
interface Finish { body: string; door: string; top: string; metal: string }
const FINISHES: Record<Style, Finish[]> = {
  wardrobe: [
    { body: "oak", door: "oak", top: "oak", metal: "brass" },
    { body: "paint_white", door: "paint_white", top: "paint_white", metal: "brushed_steel" },
    { body: "walnut", door: "walnut", top: "walnut", metal: "black_steel" },
    { body: "pine", door: "pine", top: "pine", metal: "cast_iron" },
  ],
  kitchen: [
    { body: "paint_white", door: "paint_mint", top: "oak", metal: "brass" },
    { body: "paint_white", door: "paint_navy", top: "marble", metal: "brass" },
    { body: "light_oak", door: "light_oak", top: "concrete", metal: "black_steel" },
    { body: "paint_grey", door: "paint_anthracite", top: "granite", metal: "chrome" },
  ],
  display: [
    { body: "mahogany", door: "mahogany", top: "mahogany", metal: "brass" },
    { body: "oak", door: "oak", top: "oak", metal: "brass" },
    { body: "paint_black", door: "paint_black", top: "paint_black", metal: "brass" },
    { body: "walnut", door: "walnut", top: "walnut", metal: "chrome" },
  ],
  sideboard: [
    { body: "teak", door: "teak", top: "teak", metal: "brass" },
    { body: "walnut", door: "walnut", top: "walnut", metal: "brushed_steel" },
    { body: "paint_white", door: "paint_white", top: "light_oak", metal: "brass" },
    { body: "paint_black", door: "dark_stain", top: "dark_stain", metal: "black_steel" },
  ],
};

type DoorKind = "raised" | "shaker" | "glass" | "flat";
type HandleKind = "vbar" | "knob" | "hbar";

/**
 * A door that hangs on a vertical hinge line: the node sits on the hinge (x = the hinge edge, z = the face of the
 * carcass), and the leaf runs from there towards -x, w wide and h high.
 */
function door(name: string, at: [Num, Num, Num], w: string, h: string, kind: DoorKind, handle: HandleKind, f: Finish, mirror?: string): SpecNode {
  const leaf: SpecNode[] = [];
  const fr = 0.06;
  if (kind === "flat") {
    leaf.push(box("Leaf", [`${w} - 0.004`, h, 0.02], { at: [`-(${w}) / 2`, `(${h}) / 2`, 0.01], bevel: 0.004 }));
  } else {
    // A frame of two stiles and two rails, with a panel (or glass) in it.
    leaf.push(
      box("Stile_H", [fr, h, 0.022], { at: [`-${fr / 2} - 0.002`, `(${h}) / 2`, 0.011], bevel: 0.004 }),
      box("Stile_F", [fr, h, 0.022], { at: [`-(${w}) + ${fr / 2} + 0.002`, `(${h}) / 2`, 0.011], bevel: 0.004 }),
      board("Top_Rail", [`${w} - ${2 * fr}`, fr, 0.022], "x", { at: [`-(${w}) / 2`, `${h} - ${fr / 2}`, 0.011], bevel: 0.004 }),
      board("Bottom_Rail", [`${w} - ${2 * fr}`, fr + 0.01, 0.022], "x", { at: [`-(${w}) / 2`, `${(fr + 0.01) / 2}`, 0.011], bevel: 0.004 }),
    );
    if (kind === "glass") {
      leaf.push(
        box("Glass", [`${w} - ${2 * fr} + 0.01`, `${h} - ${2 * fr}`, 0.006], { at: [`-(${w}) / 2`, `(${h}) / 2 + 0.005`, 0.011], material: "glass_cabinet" }),
        box("Muntin", [0.018, `${h} - ${2 * fr} + 0.004`, 0.014], { at: [`-(${w}) / 2`, `(${h}) / 2 + 0.005`, 0.011], bevel: 0.003 }),
      );
    } else {
      leaf.push(box("Panel", [`${w} - ${2 * fr} + 0.008`, `${h} - ${2 * fr} - 0.002`, 0.012], { at: [`-(${w}) / 2`, `(${h}) / 2 + 0.005`, 0.008], bevel: 0.003, children: kind === "raised" ? [
        box("Raise", [`${w} - ${2 * fr} - 0.05`, `${h} - ${2 * fr} - 0.06`, 0.012], { at: [0, 0, 0.006], bevel: 0.008 }),
      ] : [] }));
    }
  }
  if (kind === "glass") {
    // Only the gap lines round the leaf: a dark backing behind the glass would hide the lit interior.
    leaf.push(
      box("Reveal_T", [`${w} + 0.004`, 0.008, 0.004], { at: [`-(${w} + 0.004) / 2`, `${h} + 0.001`, -0.001], material: "reveal" }),
      box("Reveal_B", [`${w} + 0.004`, 0.008, 0.004], { at: [`-(${w} + 0.004) / 2`, "-0.001", -0.001], material: "reveal" }),
      box("Reveal_H", [0.008, `${h} + 0.006`, 0.004], { at: [0.0, `(${h}) / 2`, -0.001], material: "reveal" }),
      box("Reveal_F", [0.008, `${h} + 0.006`, 0.004], { at: [`-(${w})`, `(${h}) / 2`, -0.001], material: "reveal" }),
    );
  } else leaf.push(box("Reveal", [`${w} + 0.004`, `${h} + 0.006`, 0.004], { at: [`-(${w} + 0.004) / 2`, `(${h}) / 2`, -0.001], material: "reveal" }));
  const hx = `-(${w}) + 0.04`;
  if (handle === "vbar") leaf.push(barHandle("Handle", `min(0.3, (${h}) * 0.25)`, [hx, `(${h}) / 2`, 0.022], f.metal, { rotate: [0, 0, 90] }));
  else if (handle === "hbar") leaf.push(barHandle("Handle", 0.12, [`-(${w}) + 0.1`, `${h} - 0.06`, 0.022], f.metal));
  else leaf.push(knob("Handle", [hx, `(${h}) / 2`, 0.02], f.metal));
  leaf.push(
    cyl("Hinge_T", 0.006, 0.05, { at: [0.002, `${h} - 0.1`, 0.004], material: f.metal, segments: 8 }),
    cyl("Hinge_B", 0.006, 0.05, { at: [0.002, 0.1, 0.004], material: f.metal, segments: 8 }),
  );
  return group(name, leaf, { at, material: f.door, ...(mirror ? { mirror } : {}) });
}

/** Sides, top, bottom and back of a carcass standing on y0, its top at y1. */
function carcass(y0: string, y1: string, extra: SpecNode[] = []): SpecNode {
  return group("Body", [
    box("Side_L", ["$s", `${y1} - ${y0}`, "$D"], { at: ["$W / 2 - $s / 2", y0, 0], anchor: "bottom", bevel: 0.004, mirror: "Side_R" }),
    box("Bottom", ["$W - 2 * $s + 0.004", "$s", "$D - 0.01"], { at: [0, `${y0} + $s / 2`, -0.005] }),
    box("Back", ["$W - 2 * $s + 0.004", `${y1} - ${y0}`, 0.008], { at: [0, y0, "-$D / 2 + 0.004"], anchor: "bottom" }),
    ...extra,
  ]);
}

const shelves = (y0: string, step: string, depth = "$D - 0.04", material?: string, children: SpecNode[] = []): SpecNode =>
  box("Shelf_{i}", ["$W - 2 * $s + 0.004", material === "glass_clear" ? 0.008 : "$s", depth], { at: [0, y0, -0.01], repeat: { count: "$n", step: [0, step, 0] }, bevel: 0.002, ...(material ? { material } : {}), children });

function wardrobe(f: Finish): SpecNode[] {
  const dh = "$H - 0.1 - 0.06";
  return [
    carcass("0", "$H - 0.05", [
      board("Cornice", ["$W + 0.04", 0.06, "$D + 0.03"], "x", { at: [0, "$H - 0.03", 0.015], bevel: 0.01, material: f.top }),
      box("Plinth", ["$W + 0.01", 0.1, 0.02], { at: [0, 0, "$D / 2 - 0.005"], anchor: "bottom", bevel: 0.004 }),
    ]),
    shelves("$H - 0.32", "-0.25"),
    cyl("Rod", 0.013, "$W - 2 * $s + 0.004", { axis: "x", at: [0, "$H - 0.39 - ($n - 1) * 0.25", -0.02], material: f.metal, segments: 12 }),
    door("Door_L", ["$W / 2 - 0.002", 0.1, "$D / 2"], "$W / 2 - 0.004", dh, "raised", "vbar", f, "Door_R"),
  ];
}

function kitchen(f: Finish): SpecNode[] {
  const dh = "$H - 0.1 - 0.035 - 0.17";
  return [
    carcass("0.1", "$H - 0.035", [
      box("Plinth", ["$W - 0.004", 0.1, 0.02], { at: [0, 0, "$D / 2 - 0.07"], anchor: "bottom", material: "paint_anthracite" }),
      box("Plinth_Back", ["$W - 0.004", 0.1, 0.02], { at: [0, 0, "-$D / 2 + 0.03"], anchor: "bottom", material: "paint_anthracite" }),
      board("Worktop", ["$W + 0.02", 0.035, "$D + 0.03"], "x", { at: [0, "$H - 0.0175", 0.015], bevel: 0.004, material: f.top }),
      group("Drawer_Front", [
        board("Face", ["$W - 0.006", 0.155, 0.02], "x", { bevel: 0.004 }),
        barHandle("Handle", "min(0.3, $W * 0.35)", [0, 0.02, 0.02], f.metal),
      ], { at: [0, "$H - 0.035 - 0.0825", "$D / 2 + 0.01"], material: f.door }),
    ]),
    shelves("0.1 + $s + ($H - 0.36) / ($n + 1)", "($H - 0.36) / ($n + 1)"),
    door("Door_L", ["$W / 2 - 0.002", 0.1, "$D / 2"], "$W / 2 - 0.004", dh, "shaker", "hbar", f, "Door_R"),
  ];
}

function display(f: Finish): SpecNode[] {
  const lower = "($H - 0.12) * 0.36";
  const upper = `$H - 0.12 - 0.05 - ${lower} - 0.035`;
  return [
    carcass("0.1", "$H - 0.04", [
      board("Crown", ["$W + 0.03", 0.05, "$D + 0.02"], "x", { at: [0, "$H - 0.025", 0.01], bevel: 0.01, material: f.top }),
      board("Waist", ["$W + 0.02", 0.035, "$D + 0.015"], "x", { at: [0, `0.1 + ${lower} + 0.0175`, 0.008], bevel: 0.006, material: f.top }),
      box("Apron", ["$W", 0.05, 0.02], { at: [0, 0.075, "$D / 2 - 0.01"], bevel: 0.004 }),
      squareLeg("Leg_FL", ["$W / 2 - 0.035", 0, "$D / 2 - 0.035"], 0.102, 0.05, 0.034, "Leg_FR"),
      squareLeg("Leg_BL", ["$W / 2 - 0.035", 0, "-$D / 2 + 0.035"], 0.102, 0.05, 0.034, "Leg_BR"),
    ]),
    shelves(`0.1 + ${lower} + 0.035 + (${upper}) / ($n + 1)`, `(${upper}) / ($n + 1)`, "$D - 0.06", "glass_clear", [
      shell("Bowl", [[0.035, 0.004], [0.07, 0.03], [0.08, 0.05]], 0.004, { at: ["-$W * 0.2", 0, -0.02], material: "ceramic_white", segments: 18 }),
      shell("Vase", [[0.03, 0.004], [0.045, 0.06], [0.025, 0.13], [0.03, 0.16]], 0.004, { at: ["$W * 0.22", 0, -0.03], material: "ceramic_blue", segments: 16 }),
    ]),
    box("Lining", ["$W - 2 * $s", upper, 0.004], { at: [0, `0.1 + ${lower} + 0.035 + (${upper}) / 2`, "-$D / 2 + 0.012"], material: "lining_lit" }),
    door("Door_UL", ["$W / 2 - 0.002", `0.1 + ${lower} + 0.035`, "$D / 2"], "$W / 2 - 0.004", upper, "glass", "knob", f, "Door_UR"),
    door("Door_LL", ["$W / 2 - 0.002", 0.1, "$D / 2"], "$W / 2 - 0.004", lower, "raised", "knob", f, "Door_LR"),
  ];
}

function sideboard(f: Finish): SpecNode[] {
  const dh = "$H - 0.2 - 0.03";
  return [
    carcass("0.2", "$H - 0.03", [
      board("Top", ["$W + 0.02", 0.03, "$D + 0.015"], "x", { at: [0, "$H - 0.015", 0.007], bevel: 0.008, material: f.top }),
      squareLeg("Leg_FL", ["$W / 2 - 0.06", 0, "$D / 2 - 0.06"], 0.203, 0.045, 0.024, "Leg_FR", { material: f.top }),
      squareLeg("Leg_BL", ["$W / 2 - 0.06", 0, "-$D / 2 + 0.06"], 0.203, 0.045, 0.024, "Leg_BR", { material: f.top }),
      box("Divider_{i}", ["$s", `${dh} - 0.02`, "$D - 0.02"], { at: ["$W / 2 - ($W / 3) * ($i + 1)", "0.2 + $s", -0.005], anchor: "bottom", repeat: { count: 2, step: [0, 0, 0] } }),
    ]),
    shelves("0.2 + $s + ($H - 0.25) / ($n + 1)", "($H - 0.25) / ($n + 1)"),
    group("Doors", [
      door("Door_{i}", ["$W / 2 - 0.002 - $i * ($W - 0.004) / 3", 0.2, "$D / 2"], "($W - 0.004) / 3 - 0.004", dh, "flat", "vbar", f),
    ]),
  ].map((n) => {
    const doors = n["children"] as SpecNode[] | undefined;
    if (n["name"] === "Doors" && doors?.[0]) doors[0]["repeat"] = { count: 3, step: [0, 0, 0] };
    return n;
  });
}

const TEXT: Record<Style, string> = {
  wardrobe: "A tall two-door wardrobe with raised-panel doors on hinges, long bar handles, a cornice and plinth, a hat shelf and a hanging rail inside",
  kitchen: "A kitchen base cabinet with a worktop, a drawer front with a bar handle above two shaker doors, a recessed plinth and shelves inside",
  display: "A display cabinet (vitrine) on short legs: glazed upper doors over glass shelves with china, and two panelled lower doors",
  sideboard: "A long sideboard on tapered legs with three flat hinged doors and long bar handles, shelves inside",
};

const RANGES: Record<Style, { w: [number, number, number]; h: [number, number, number]; d: [number, number, number]; n: [number, number, number] }> = {
  wardrobe: { w: [1.1, 0.9, 1.4], h: [2.0, 1.8, 2.3], d: [0.6, 0.55, 0.65], n: [1, 1, 2] },
  kitchen: { w: [0.8, 0.6, 1.2], h: [0.9, 0.85, 0.95], d: [0.6, 0.55, 0.65], n: [1, 1, 2] },
  display: { w: [1.0, 0.8, 1.2], h: [1.8, 1.5, 2.1], d: [0.42, 0.36, 0.48], n: [2, 1, 4] },
  sideboard: { w: [1.6, 1.3, 2.0], h: [0.8, 0.72, 0.9], d: [0.45, 0.4, 0.5], n: [1, 1, 2] },
};

function makeCupboard(style: Style, f: Finish): AssetDraft {
  const r = RANGES[style];
  const body = label(f.body);
  const doorName = label(f.door);
  return {
    slug: slugify("cupboard", style, f.door.replace(/^paint_/, ""), ...(f.top !== f.door && f.top !== f.body ? [f.top.replace(/^paint_/, "")] : [])),
    title: `${cap(doorName)} ${style === "display" ? "display cabinet" : style === "kitchen" ? "kitchen cabinet" : style}`,
    description: `${TEXT[style]}, ${f.body === f.door ? `in ${body}` : `with a ${body} carcass and ${doorName} doors`}${style === "kitchen" ? ` under a ${label(f.top)} worktop` : ""}. Each door pivots on its hinge line; the doors face +z.`,
    tags: [style, f.door.replace(/^paint_/, ""), f.body.replace(/^paint_/, ""), "cabinet", "kast", ...(style === "wardrobe" ? ["kledingkast", "kleerkast"] : style === "kitchen" ? ["keukenkast", "onderkast"] : style === "display" ? ["vitrinekast", "vitrine"] : ["dressoir", "buffetkast"])],
    params: [
      num("width", r.w[0], r.w[1], r.w[2], "Width along x in metres."),
      num("height", r.h[0], r.h[1], r.h[2], "Overall height in metres."),
      num("depth", r.d[0], r.d[1], r.d[2], "Depth along z in metres."),
      int("shelves", r.n[0], r.n[1], r.n[2], "Number of shelves inside."),
    ],
    materials: fmats(...new Set([f.body, f.door, f.top, f.metal, "glass_cabinet", "glass_clear", "paint_anthracite", "lining_lit", "ceramic_white", "ceramic_blue", "reveal"])),
    nodes: [group("Cupboard", { wardrobe, kitchen, display, sideboard }[style](f), { material: f.body, vars: { W: "$width", H: "$height", D: "$depth", n: "$shelves", s: 0.018 } })],
  };
}

export const cupboard: Family = {
  id: "cupboard",
  category: "furniture",
  archetype: "prop.cupboard",
  tags: ["cupboard", "cabinet", "kast", "furniture", "meubel", "doors", "deuren"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2, 3] as const }).map(({ style, k }) => makeCupboard(style, FINISHES[style][k] as Finish)),
};
