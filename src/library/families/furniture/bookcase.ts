import { box, combos, cyl, group, int, num, slugify, tube, cap, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import { label, mats } from "../../palette.js";
import { BOOK_MATERIALS, books, shell, squareLeg } from "./parts.js";

const STYLES = ["open", "low", "ladder", "etagere"] as const;
type Style = (typeof STYLES)[number];

interface Finish { wood: string; frame: string }
const FINISHES: Record<Style, Finish[]> = {
  open: [{ wood: "oak", frame: "oak" }, { wood: "walnut", frame: "walnut" }, { wood: "paint_white", frame: "paint_white" }, { wood: "cherry", frame: "cherry" }],
  low: [{ wood: "teak", frame: "teak" }, { wood: "light_oak", frame: "light_oak" }, { wood: "paint_black", frame: "walnut" }, { wood: "birch", frame: "birch" }],
  ladder: [{ wood: "bamboo", frame: "bamboo" }, { wood: "walnut", frame: "walnut" }, { wood: "whitewash_wood", frame: "whitewash_wood" }, { wood: "pine", frame: "pine" }],
  etagere: [{ wood: "oak", frame: "black_steel" }, { wood: "walnut", frame: "brass" }, { wood: "glass_clear", frame: "chrome" }, { wood: "rough_timber", frame: "galvanised" }],
};

function open(f: Finish): SpecNode[] {
  return [
    group("Body", [
      box("Side_L", ["$s", "$H - $ct + 0.002", "$D"], { at: ["$W / 2 - $s / 2", 0, 0], anchor: "bottom", bevel: 0.004, mirror: "Side_R" }),
      box("Cornice", ["$W + 0.03", "$ct", "$D + 0.02"], { at: [0, "$H - $ct / 2", 0.01], bevel: 0.008 }),
      box("Moulding", ["$W + 0.012", 0.018, "$D + 0.008"], { at: [0, "$H - $ct - 0.007", 0.004], bevel: 0.006 }),
      box("Plinth", ["$W - 2 * $s + 0.004", "$pl", "$s"], { at: [0, 0, "$D / 2 - $s / 2 - 0.012"], anchor: "bottom", bevel: 0.003 }),
      box("Bottom", ["$W - 2 * $s + 0.004", "$s", "$D - 0.02"], { at: [0, "$pl + $s / 2", 0], bevel: 0.003, children: [books("Books", "$s / 2", "-$sw / 2 + 0.03", 7)], vars: { bh: "$g - $s - 0.03", bd: "$D - 0.06", sw: "$W - 2 * $s" } }),
    ]),
    box("Back", ["$W - 2 * $s + 0.006", "$H - $ct - $pl", 0.008], { at: [0, "$pl", "-$D / 2 + 0.008"], anchor: "bottom" }),
    box("Shelf_{i}", ["$W - 2 * $s + 0.004", "$s", "$D - 0.03"], { at: [0, "$pl + $s / 2 + $g", -0.005], repeat: { count: "$n", step: [0, "$g", 0] }, bevel: 0.003, children: [
      books("Books", "$s / 2"),
    ] }),
  ];
}

function low(f: Finish): SpecNode[] {
  return [
    group("Body", [
      box("Side_L", ["$s", "$H - 0.1 - $ct + 0.002", "$D"], { at: ["$W / 2 - $s / 2", 0.1, 0], anchor: "bottom", bevel: 0.004, mirror: "Side_R" }),
      box("Lid", ["$W + 0.02", "$ct", "$D + 0.01"], { at: [0, "$H - $ct / 2", 0.005], bevel: 0.008 }),
      box("Bottom", ["$W - 0.004", "$s", "$D"], { at: [0, "0.1 + $s / 2", 0], bevel: 0.004 }),
      box("Divider", ["$s", "$H - 0.1 - $ct - $s + 0.004", "$D - 0.02"], { at: [0, "0.1 + $s - 0.002", -0.01], anchor: "bottom", bevel: 0.003 }),
      squareLeg("Leg_FL", ["$W / 2 - 0.05", 0, "$D / 2 - 0.05"], 0.104, 0.04, 0.026, "Leg_FR", { material: f.frame }),
      squareLeg("Leg_BL", ["$W / 2 - 0.05", 0, "-$D / 2 + 0.05"], 0.104, 0.04, 0.026, "Leg_BR", { material: f.frame }),
    ]),
    box("Back", ["$W - 2 * $s + 0.006", "$H - 0.1 - $ct", 0.008], { at: [0, 0.1, "-$D / 2 + 0.006"], anchor: "bottom" }),
    box("Shelf_{i}", ["$W - 2 * $s + 0.004", "$s", "$D - 0.03"], { at: [0, "0.1 + $s / 2 + $g", -0.005], repeat: { count: "$n", step: [0, "$g", 0] }, bevel: 0.003 }),
    group("Book_Row", [books("Books", "0.1 + $s", "-$W / 2 + 0.05", 2)], { vars: { sw: "$W / 2 - 0.05", bh: "$g - $s - 0.03", bd: "$D - 0.06" } }),
    shell("Vase", [[0.05, "$H - 0.001"], [0.075, "$H + 0.08"], [0.04, "$H + 0.2"], [0.045, "$H + 0.24"]], 0.005, { at: ["$W / 2 - 0.15", 0, 0], material: "ceramic_celadon", segments: 20 }),
  ];
}

function ladder(f: Finish): SpecNode[] {
  // Shelf i at height y, its front just past the leaning rail there, its back against the wall (z = -D / 2).
  const y = "(0.25 + $i * $g)";
  const zf = `($D / 2 - 0.02 - ($D - 0.04) * ${y} / $H + 0.035)`;
  return [
    group("Body", [
      box("Rail_L", [0.04, "hypot($H, $D - 0.04)", 0.035], { at: ["$W / 2 - 0.02", 0.003, "$D / 2 - 0.02"], anchor: "bottom", rotate: ["-deg(atan(($D - 0.04) / $H))", 0, 0], bevel: 0.006, mirror: "Rail_R", children: [
        box("Cap", [0.042, 0.012, 0.037], { at: [0, 0.004, 0], material: "rubber", bevel: 0.003 }),
      ] }),
    ]),
    box("Shelf_{i}", ["$W - 0.076", 0.022, `${zf} + $D / 2`], { at: [0, y, `(${zf} - $D / 2) / 2`], repeat: { count: "$n", step: [0, 0, 0] }, bevel: 0.004, children: [
      box("Lip", ["$W - 0.08", 0.045, 0.016], { at: [0, 0.02, `(${zf} + $D / 2) / 2 - 0.008`], bevel: 0.004 }),
    ] }),
  ];
}

function etagere(f: Finish): SpecNode[] {
  const glass = f.wood.startsWith("glass");
  const brace = (name: string, a: Vec, b: Vec): SpecNode => tube(name, [a, b], 0.006, { segments: 8 });
  return [
    group("Body", [
      cyl("Post_{i}", 0.013, "$H", { at: ["-$W / 2 + 0.015", "$H / 2", "-$D / 2 + 0.015"], repeat: { count: 2, step: ["$W - 0.03", 0, 0] }, segments: 12, children: [
        cyl("Front_Post", 0.013, "$H", { at: [0, 0, "$D - 0.03"], segments: 12 }),
        cyl("Foot", 0.016, 0.012, { at: [0, "-$H / 2 + 0.006", 0], material: "rubber", segments: 12 }),
        cyl("Front_Foot", 0.016, 0.012, { at: [0, "-$H / 2 + 0.006", "$D - 0.03"], material: "rubber", segments: 12 }),
      ] }),
      brace("Back_Brace_1", ["-$W / 2 + 0.015", 0.1, "-$D / 2 + 0.015"], ["$W / 2 - 0.015", "$H - 0.1", "-$D / 2 + 0.015"]),
      brace("Back_Brace_2", ["$W / 2 - 0.015", 0.1, "-$D / 2 + 0.015"], ["-$W / 2 + 0.015", "$H - 0.1", "-$D / 2 + 0.015"]),
      brace("Brace_L1", ["$W / 2 - 0.015", 0.1, "-$D / 2 + 0.015"], ["$W / 2 - 0.015", "$H - 0.1", "$D / 2 - 0.015"]),
      brace("Brace_L2", ["$W / 2 - 0.015", 0.1, "$D / 2 - 0.015"], ["$W / 2 - 0.015", "$H - 0.1", "-$D / 2 + 0.015"]),
      brace("Brace_R1", ["-$W / 2 + 0.015", 0.1, "-$D / 2 + 0.015"], ["-$W / 2 + 0.015", "$H - 0.1", "$D / 2 - 0.015"]),
      brace("Brace_R2", ["-$W / 2 + 0.015", 0.1, "$D / 2 - 0.015"], ["-$W / 2 + 0.015", "$H - 0.1", "-$D / 2 + 0.015"]),
    ]),
    box("Shelf_{i}", ["$W + 0.01", glass ? 0.012 : 0.026, "$D + 0.01"], { at: [0, "0.12", 0], repeat: { count: "$n", step: [0, "$g", 0] }, bevel: glass ? 0.003 : 0.005, material: f.wood, children: [
      books("Books", glass ? 0.006 : 0.013, "-$sw / 2 + 0.05"),
    ] }),
  ];
}

const TEXT: Record<Style, string> = {
  open: "A tall open bookcase with a moulded cornice, a recessed plinth, a back panel and evenly spaced shelves filled with rows of books",
  low: "A low, wide bookcase on short tapered legs with a centre divider, a thick top with a vase on it and books on the bottom shelf",
  ladder: "A leaning ladder shelf: two raked rails resting against the wall with shelves that get shallower towards the top, each with a front lip",
  etagere: "An open étagère of thin round posts with cross braces on the back and sides, and shelves holding a few books",
};

const RANGES: Record<Style, { w: [number, number, number]; h: [number, number, number]; d: [number, number, number]; n: [number, number, number] }> = {
  open: { w: [0.9, 0.6, 1.2], h: [1.9, 1.5, 2.3], d: [0.32, 0.26, 0.42], n: [4, 2, 7] },
  low: { w: [1.2, 0.9, 1.4], h: [0.82, 0.7, 1.0], d: [0.35, 0.3, 0.42], n: [1, 1, 2] },
  ladder: { w: [0.6, 0.45, 0.8], h: [1.8, 1.5, 2.0], d: [0.4, 0.34, 0.48], n: [4, 3, 5] },
  etagere: { w: [0.9, 0.6, 1.2], h: [1.6, 1.0, 2.0], d: [0.35, 0.3, 0.45], n: [4, 3, 6] },
};

function makeBookcase(style: Style, f: Finish): AssetDraft {
  const r = RANGES[style];
  const vars: Record<string, string | number> = { W: "$width", H: "$height", D: "$depth", n: "$shelves", s: 0.02, sw: "$width - 0.06", bd: "$depth - 0.06" };
  if (style === "open") Object.assign(vars, { ct: 0.04, pl: 0.08, g: "($height - 0.04 - 0.08 - 0.02) / ($shelves + 1)", bh: "$g - 0.05" });
  if (style === "low") Object.assign(vars, { ct: 0.03, g: "($height - 0.1 - 0.03 - 0.02) / ($shelves + 1)", bh: "$g - 0.05", sw: "$width / 2 - 0.04" });
  if (style === "ladder") Object.assign(vars, { g: "($height - 0.45) / max(1, $shelves - 1)" });
  if (style === "etagere") Object.assign(vars, { g: "($height - 0.135) / max(1, $shelves - 1)", bh: "min(0.26, $g - 0.06)" });
  const nodes = { open, low, ladder, etagere }[style](f);
  const wood = label(f.wood);
  const frame = label(f.frame);
  return {
    slug: slugify("bookcase", style, f.wood.replace(/^(paint|glass)_/, ""), ...(f.frame !== f.wood ? [f.frame.replace(/^paint_/, "")] : [])),
    title: `${cap(wood)} ${style === "etagere" ? "étagère" : style} bookcase`,
    description: `${TEXT[style]}, ${f.frame === f.wood ? `in ${wood}` : `with ${wood} shelves and a ${frame} frame`}. The open front faces +z.`,
    tags: [style, f.wood.replace(/^(paint|glass)_/, ""), f.frame.replace(/^paint_/, ""), "books", "boeken", "shelving", "wandkast", ...(style === "ladder" ? ["ladderkast", "ladder shelf"] : style === "etagere" ? ["etagere", "open kast"] : [])],
    params: [
      num("width", r.w[0], r.w[1], r.w[2], "Width along x in metres."),
      num("height", r.h[0], r.h[1], r.h[2], "Overall height in metres."),
      num("depth", r.d[0], r.d[1], r.d[2], "Depth along z in metres."),
      int("shelves", r.n[0], r.n[1], r.n[2], "Number of shelves."),
    ],
    materials: { ...mats(...new Set([f.wood, f.frame, "rubber", "ceramic_celadon"])), ...BOOK_MATERIALS },
    nodes: [group("Bookcase", nodes, { material: f.frame, vars })],
  };
}

export const bookcase: Family = {
  id: "bookcase",
  category: "furniture",
  archetype: "prop.bookcase",
  tags: ["bookcase", "bookshelf", "shelves", "boekenkast", "boekenrek", "kast", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2, 3] as const }).map(({ style, k }) => makeBookcase(style, FINISHES[style][k] as Finish)),
};
