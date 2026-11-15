import { box, cyl, group, int, num, slugify, tube, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import { nice, up, useMats } from "./common.js";

type Variant =
  | { style: "sheffield"; extra: "plain" | "crossbar" | "rails"; metal: string }
  | { style: "wheel"; metal: string }
  | { style: "spiral"; metal: string; turns: number }
  | { style: "wave"; metal: string; humps: number };

const VARIANTS: Variant[] = [
  { style: "sheffield", extra: "plain", metal: "galvanised" },
  { style: "sheffield", extra: "crossbar", metal: "black_steel" },
  { style: "sheffield", extra: "rails", metal: "paint_green" },
  { style: "wheel", metal: "galvanised" },
  { style: "wheel", metal: "paint_anthracite" },
  { style: "spiral", metal: "galvanised", turns: 5 },
  { style: "spiral", metal: "paint_blue", turns: 7 },
  { style: "wave", metal: "galvanised", humps: 4 },
  { style: "wave", metal: "brushed_steel", humps: 5 },
  { style: "wave", metal: "paint_yellow", humps: 6 },
];

const hoopPath = (h: string, l: string): Vec[] => [
  [0, 0, `-${l} / 2`], [0, `${h} - 0.12`, `-${l} / 2`], [0, `${h} - 0.04`, `-${l} / 2 + 0.03`], [0, h, `-${l} / 2 + 0.12`],
  [0, h, `${l} / 2 - 0.12`], [0, `${h} - 0.04`, `${l} / 2 - 0.03`], [0, `${h} - 0.12`, `${l} / 2`], [0, 0, `${l} / 2`],
];

function nodes(v: Variant): SpecNode[] {
  switch (v.style) {
    case "sheffield":
      return [
        group("Stand_{i}", [
          tube("Hoop", hoopPath("$height", "$length"), 0.024, { segments: 14 }),
          cyl("Foot_F", 0.06, 0.01, { at: [0, 0, "$length / 2"], anchor: "base", segments: 16, bevel: 0.003 }),
          cyl("Foot_B", 0.06, 0.01, { at: [0, 0, "-$length / 2"], anchor: "base", segments: 16, bevel: 0.003 }),
          ...(v.extra === "crossbar" ? [cyl("Bar", 0.016, "$length", { axis: "z", at: [0, "$height * 0.45", 0], segments: 12 })] : []),
        ], { at: ["-($stands - 1) * 0.45", 0, 0], repeat: { count: "$stands", step: [0.9, 0, 0] } }),
        ...(v.extra === "rails"
          ? [box("Base_F", ["($stands - 1) * 0.9 + 0.2", 0.02, 0.08], { at: [0, 0, "$length / 2"], anchor: "bottom", bevel: 0.004 }), box("Base_B", ["($stands - 1) * 0.9 + 0.2", 0.02, 0.08], { at: [0, 0, "-$length / 2"], anchor: "bottom", bevel: 0.004 })]
          : v.extra === "plain"
            ? [box("Base", ["($stands - 1) * 0.9 + 0.5", 0.03, "$length + 0.3"], { anchor: "bottom", bevel: 0.01, material: "concrete" })]
            : [box("Base", ["($stands - 1) * 0.9 + 0.12", 0.012, 0.06], { at: [0, 0, "$length / 2"], anchor: "bottom", bevel: 0.003 })]),
      ];
    case "wheel": {
      const loop: Vec[] = [[0.035, 0.03, -0.22], [0.035, "$height * 0.75", -0.21], [0.035, "$height", -0.12], [0.035, "$height", 0.12], [0.035, "$height * 0.75", 0.21], [0.035, 0.03, 0.22]];
      return [
        group("Holder_{i}", [tube("Loop_A", loop, 0.009, { segments: 10, mirror: "Loop_B" })], { at: ["-($slots - 1) * $spacing / 2", 0, 0], repeat: { count: "$slots", step: ["$spacing", 0, 0] } }),
        box("Base_F", ["($slots - 1) * $spacing + 0.2", 0.03, 0.05], { at: [0, 0, 0.21], anchor: "bottom", bevel: 0.005 }),
        box("Base_B", ["($slots - 1) * $spacing + 0.2", 0.03, 0.05], { at: [0, 0, -0.21], anchor: "bottom", bevel: 0.005 }),
        box("Plate_L", [0.04, 0.03, 0.47], { at: ["($slots - 1) * $spacing / 2 + 0.1", 0, 0], anchor: "bottom", bevel: 0.005, mirror: "Plate_R" }),
      ];
    }
    case "spiral": {
      const n = v.turns * 12;
      const pts: Vec[] = [];
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const a = (2 * Math.PI * j) / 12;
        pts.push([`$length * ${(t - 0.5).toFixed(5)}`, `0.04 + $radius * ${(1 - Math.cos(a)).toFixed(5)}`, `$radius * ${Math.sin(a).toFixed(5)}`]);
      }
      return [
        tube("Rack", pts, 0.025, { segments: 12 }),
        box("Foot_{i}", [0.12, 0.03, 0.12], { at: ["-$length / 2", 0, 0], anchor: "bottom", bevel: 0.006, repeat: { count: v.turns + 1, step: [`$length / ${v.turns}`, 0, 0] } }),
        box("Base", ["$length + 0.12", 0.012, 0.06], { anchor: "bottom", bevel: 0.003 }),
      ];
    }
    case "wave": {
      // Vertical legs joined by half-round tops and troughs of radius $wr: one wave is 4 $wr wide.
      const pts: Vec[] = [[`-$length / 2`, 0.03, 0]];
      const at = (cx: string, cy: string, deg: number): Vec => [`${cx} + $wr * ${Math.cos((deg * Math.PI) / 180).toFixed(5)}`, `${cy} + $wr * ${Math.sin((deg * Math.PI) / 180).toFixed(5)}`, 0];
      for (let k = 0; k < v.humps; k++) {
        const x0 = `(-$length / 2 + ${k} * 4 * $wr)`;
        for (const a of [300, 330, 360]) pts.push(at(x0, "(0.03 + $wr)", a));
        for (const a of [180, 150, 120, 90, 60, 30, 0]) pts.push(at(`(${x0} + 2 * $wr)`, "($height - 0.03 - $wr)", a));
        for (const a of [180, 210, 240]) pts.push(at(`(${x0} + 4 * $wr)`, "(0.03 + $wr)", a));
        pts.push([`${x0} + 4 * $wr`, 0.03, 0]);
      }
      return [
        tube("Rack", pts, 0.03, { segments: 14, vars: { wr: `$length / ${v.humps} / 4` } }),
        cyl("Foot_{i}", 0.07, 0.012, { at: ["-$length / 2", 0, 0], anchor: "base", segments: 16, bevel: 0.004, repeat: { count: v.humps + 1, step: [`$length / ${v.humps}`, 0, 0] } }),
      ];
    }
  }
}

function params(v: Variant) {
  switch (v.style) {
    case "sheffield":
      return [int("stands", 3, 1, 5, "Number of stands in the row (0.9 m apart along x)."), num("height", 0.8, 0.7, 0.9, "Height of each stand in metres."), num("length", 0.75, 0.6, 0.9, "Length of each stand along z in metres.")];
    case "wheel":
      return [int("slots", 6, 3, 10, "Number of wheel slots along x."), num("spacing", 0.4, 0.3, 0.5, "Distance between the slots in metres."), num("height", 0.38, 0.3, 0.45, "Height of the wheel loops in metres.")];
    case "spiral":
      return [num("length", 2.4, 1.5, 4, "Length of the spiral along x in metres."), num("radius", 0.36, 0.28, 0.45, "Radius of the spiral in metres.")];
    case "wave":
      return [num("length", 2.2, 1.5, 3.5, "Length of the rack along x in metres."), num("height", 0.8, 0.65, 0.9, "Height of the waves in metres.")];
  }
}

const TEXT = {
  sheffield: "a row of inverted-U steel tube stands with round foot flanges, each parked along z",
  wheel: "a row of narrow paired wire loops that hold a front wheel, on two ground rails",
  spiral: "a continuous steel tube coiled into a spiral along x, standing on foot plates",
  wave: "one steel tube bent into rounded waves along x, standing on round foot plates",
} as const;

function makeRack(v: Variant): AssetDraft {
  const m = nice(v.metal);
  const variant = v.style === "sheffield" ? v.extra : v.style === "spiral" ? `${v.turns}-turns` : v.style === "wave" ? `${v.humps}-waves` : "";
  const extraText = v.style === "sheffield" && v.extra === "crossbar" ? ", with a low crossbar for small bikes" : v.style === "sheffield" && v.extra === "rails" ? ", joined by ground rails" : "";
  const title = { sheffield: "Sheffield stand bike rack", wheel: "wheel slot bike rack", spiral: "spiral bike rack", wave: "wave bike rack" }[v.style];
  return {
    slug: slugify("bike-rack", v.style, variant, v.metal.replace(/^paint_/, "")),
    title: up(`${m} ${title}${variant && v.style !== "sheffield" ? ` (${variant.replace("-", " ")})` : v.style === "sheffield" && v.extra !== "plain" ? ` with ${v.extra}` : ""}`),
    description: `A ${m} bike rack: ${TEXT[v.style]}${extraText}. The row runs along x; bikes stand along z.`,
    tags: [v.style, m, "fietsenrek", "fietsnietje", "fietsbeugel", "bike parking", "fietsparkeren"],
    params: params(v),
    materials: useMats(v.metal, "concrete"),
    nodes: [group("BikeRack", nodes(v), { material: v.metal })],
  };
}

export const bikeRack: Family = {
  id: "bike-rack",
  category: "street",
  archetype: "infrastructure.bike-rack",
  tags: ["bike rack", "bicycle rack", "bicycle stand", "cycle stand", "fietsenrek", "fietsenstalling", "street furniture"],
  assets: () => VARIANTS.map(makeRack),
};
