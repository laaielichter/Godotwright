import { box, cyl, ellipsoid, group, int, lathe, num, rng, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { nice, up, useMats } from "./common.js";

type Style = "pot" | "square" | "trough" | "wooden";
type PlantKind = "shrub" | "flowers" | "grass" | "topiary";

const STYLES: Record<Style, { title: string; text: string; finishes: string[] }> = {
  pot: { title: "round planter pot", text: "a round flared pot with a rolled rim and a foot ring", finishes: ["terracotta", "ceramic_blue", "ceramic_celadon", "ceramic_black"] },
  square: { title: "square planter box", text: "a square box with a raised rim, a recessed plinth and corner seams", finishes: ["fibreglass_white", "corten", "paint_anthracite", "galvanised"] },
  trough: { title: "concrete planter trough", text: "a long chamfered concrete trough with thick walls on two plinth blocks", finishes: ["concrete", "concrete_dark", "granite", "limestone"] },
  wooden: { title: "wooden planter", text: "a box of horizontal boards between square corner posts that stand on short feet, with a capping rail", finishes: ["pine", "teak", "weathered_wood", "dark_stain"] },
};

const PLANTS: PlantKind[] = ["shrub", "flowers", "grass", "topiary"];
const BLOOMS = ["petal_red", "petal_yellow", "petal_pink", "petal_purple"];

/** A plant filling a cell of half-sizes hx, hz on soil at y = base, ph tall; mirror-symmetric in x. */
function plant(kind: PlantKind, hx: string, hz: string, ph: string, base: string, seed: number, bloom: string): SpecNode[] {
  switch (kind) {
    case "shrub":
      return [
        ellipsoid("Crown", [`${hx} * 0.75`, `${ph} * 0.5`, `${hz} * 0.75`], { at: [0, `${base} + ${ph} * 0.48`, 0], segments: 18, material: "leaf_dark" }),
        ellipsoid("Shrub_L", [`${hx} * 0.5`, `${ph} * 0.4`, `${hz} * 0.55`], { at: [`${hx} * 0.42`, `${base} + ${ph} * 0.38`, `${hz} * 0.2`], segments: 16, lumps: 0.3, seed, material: "leaf_green", mirror: "Shrub_R" }),
        ellipsoid("Shrub_BL", [`${hx} * 0.45`, `${ph} * 0.35`, `${hz} * 0.45`], { at: [`${hx} * 0.3`, `${base} + ${ph} * 0.35`, `-${hz} * 0.35`], segments: 16, lumps: 0.3, seed: seed + 7, material: "leaf_green", mirror: "Shrub_BR" }),
      ];
    case "flowers": {
      const r = rng(seed);
      const out: SpecNode[] = [ellipsoid("Foliage", [`${hx} * 0.85`, 0.07, `${hz} * 0.85`], { at: [0, `${base} + 0.02`, 0], segments: 16, material: "leaf_green" })];
      for (let k = 0; k < 4; k++) {
        const fx = (0.15 + r() * 0.6).toFixed(3), fz = (-0.7 + r() * 1.4).toFixed(3), fh = (0.6 + r() * 0.4).toFixed(3);
        const x = `${fx} * ${hx}`, z = `${fz} * ${hz}`, top = `${base} + ${fh} * ${ph}`;
        out.push(group(`Flower_L${k + 1}`, [
          tube("Stem", [[x, base, z], [`${x} * 1.08`, top, z]], 0.006, { segments: 6, material: "leaf_green" }),
          ellipsoid("Bloom", [0.045, 0.025, 0.045], { at: [`${x} * 1.08`, top, z], segments: 10, material: bloom }),
          ellipsoid("Heart", [0.015, 0.012, 0.015], { at: [`${x} * 1.08`, `${top} + 0.02`, z], segments: 8, material: "petal_yellow" }),
          ellipsoid("Leaf", [0.05, 0.008, 0.022], { at: [`${x} * 1.04 + 0.03`, `${base} + ${fh} * ${ph} * 0.45`, z], segments: 8, material: "leaf_green" }),
        ], { mirror: `Flower_R${k + 1}` }));
      }
      out.push(group("Flower_C", [
        tube("Stem", [[0, base, 0], [0, `${base} + ${ph}`, 0]], 0.006, { segments: 6, material: "leaf_green" }),
        ellipsoid("Bloom", [0.05, 0.028, 0.05], { at: [0, `${base} + ${ph}`, 0], segments: 10, material: bloom }),
      ]));
      return out;
    }
    case "grass":
      return [
        group("Tuft_{i}", [box("Blade", [0.04, ph, 0.005], { at: [0, `${ph} / 2`, `${hz} * 0.3`], rotate: [22, 0, 0] })], { at: [0, base, 0], repeat: { count: 22, around: "y" }, material: "grass_dry" }),
        group("Inner_{i}", [box("Blade", [0.035, `${ph} * 0.85`, 0.005], { at: [0, `${ph} * 0.425`, `${hz} * 0.1`], rotate: [8, 0, 0] })], { at: [0, base, 0], repeat: { count: 16, around: "y", phase: 11 }, material: "leaf_light" }),
        ellipsoid("Clump", [`${hx} * 0.45`, 0.05, `${hz} * 0.45`], { at: [0, base, 0], segments: 14, material: "grass_dry" }),
      ];
    case "topiary":
      return [
        cyl("Trunk", 0.02, `${ph} * 0.55`, { at: [0, `${base} - 0.01`, 0], anchor: "base", segments: 10, material: "bark_brown" }),
        ellipsoid("Ball", [`min(${hx}, ${hz}) * 0.8`, `min(${hx}, ${hz}) * 0.8`, `min(${hx}, ${hz}) * 0.8`], { at: [0, `${base} + ${ph} * 0.55 + min(${hx}, ${hz}) * 0.6`, 0], segments: 18, material: "leaf_dark" }),
        ellipsoid("Underplant", [`${hx} * 0.8`, 0.05, `${hz} * 0.8`], { at: [0, base, 0], segments: 14, material: "moss" }),
      ];
  }
}

function makePlanter(style: Style, finish: string, idx: number): AssetDraft {
  const kind = PLANTS[(idx + Object.keys(STYLES).indexOf(style)) % 4] as PlantKind;
  const bloom = BLOOMS[idx % 4] as string;
  const seed = 11 + idx * 13;
  let body: SpecNode[];
  let soil: SpecNode;
  let plants: SpecNode;
  let params;
  switch (style) {
    case "pot":
      params = [num("r", 0.3, 0.2, 0.45, "Radius of the pot at its rim in metres."), num("height", 0.5, 0.3, 0.7, "Height of the pot in metres."), num("plantHeight", 0.55, 0.3, 0.9, "Height of the planting above the soil in metres.")];
      body = [
        lathe("Body", [["$r * 0.7", 0.03], ["$r * 0.72", 0.05], ["$r", "$height - 0.06"], ["$r + 0.03", "$height - 0.05"], ["$r + 0.035", "$height - 0.01"], ["$r + 0.01", "$height"], ["$r - 0.025", "$height"], ["$r - 0.03", "$height - 0.05"], [0.05, "$height - 0.05"]], { segments: 24 }),
        lathe("Foot", [["$r * 0.6", 0], ["$r * 0.72", 0], ["$r * 0.73", 0.04], ["$r * 0.6", 0.04]], { segments: 24 }),
      ];
      soil = cyl("Soil", "$r - 0.031", 0.02, { at: [0, "$height - 0.05", 0], anchor: "base", segments: 24, material: "soil" });
      plants = group("Plant", plant(kind, "($r - 0.04)", "($r - 0.04)", "$plantHeight", "$height - 0.035", seed, bloom));
      break;
    case "square":
      params = [num("width", 0.6, 0.4, 1.0, "Width and depth of the box in metres."), num("height", 0.6, 0.4, 0.9, "Height of the box in metres."), num("plantHeight", 0.6, 0.3, 0.9, "Height of the planting above the soil in metres.")];
      body = [group("Body", [
        box("Shell", ["$width", "$height - 0.07", "$width"], { at: [0, 0.04, 0], anchor: "bottom", bevel: 0.012 }),
        box("Plinth", ["$width - 0.06", 0.05, "$width - 0.06"], { anchor: "bottom", bevel: 0.005, material: "rubber" }),
        box("Rim_F", ["$width + 0.03", 0.04, 0.05], { at: [0, "$height - 0.02", "$width / 2 - 0.01"], bevel: 0.008 }),
        box("Rim_B", ["$width + 0.03", 0.04, 0.05], { at: [0, "$height - 0.02", "-$width / 2 + 0.01"], bevel: 0.008 }),
        box("Rim_L", [0.05, 0.04, "$width - 0.04"], { at: ["$width / 2 - 0.01", "$height - 0.02", 0], bevel: 0.008, mirror: "Rim_R" }),
        box("Seam_{i}", [0.012, "$height - 0.12", 0.012], { at: ["$width / 2", "$height / 2", "$width / 2"], repeat: { count: 4, around: "y", phase: 0 }, bevel: 0.003 }),
      ])];
      soil = box("Soil", ["$width - 0.06", 0.02, "$width - 0.06"], { at: [0, "$height - 0.04", 0], material: "soil" });
      plants = group("Plant", plant(kind, "($width / 2 - 0.05)", "($width / 2 - 0.05)", "$plantHeight", "$height - 0.03", seed, bloom));
      break;
    case "trough":
      params = [num("length", 1.6, 1.0, 2.4, "Length of the trough along x in metres."), num("width", 0.55, 0.4, 0.7, "Width of the trough along z in metres."), num("height", 0.45, 0.35, 0.6, "Height of the trough in metres."), int("plants", 3, 2, 5, "Number of plant groups along the trough.")];
      body = [group("Body", [
        box("Tub", ["$length", "$height - 0.1", "$width"], { at: [0, 0.04, 0], anchor: "bottom", bevel: 0.025 }),
        box("Wall_F", ["$length", 0.1, 0.08], { at: [0, "$height - 0.1", "$width / 2 - 0.04"], anchor: "bottom", bevel: 0.02 }),
        box("Wall_B", ["$length", 0.1, 0.08], { at: [0, "$height - 0.1", "-$width / 2 + 0.04"], anchor: "bottom", bevel: 0.02 }),
        box("Wall_L", [0.08, 0.1, "$width - 0.1"], { at: ["$length / 2 - 0.04", "$height - 0.1", 0], anchor: "bottom", bevel: 0.02, mirror: "Wall_R" }),
        box("Block_L", [0.2, 0.05, "$width - 0.1"], { at: ["$length / 2 - 0.25", 0, 0], anchor: "bottom", bevel: 0.01, mirror: "Block_R" }),
      ])];
      soil = box("Soil", ["$length - 0.14", 0.03, "$width - 0.14"], { at: [0, "$height - 0.07", 0], material: "soil" });
      plants = group("Plant", [group("Cell_{i}", plant(kind, "(($length - 0.16) / (2 * $plants))", "($width / 2 - 0.08)", "$plantHeight", "$height - 0.055", seed, bloom), {
        at: ["-($length - 0.16) / 2 + ($length - 0.16) / (2 * $plants)", 0, 0],
        repeat: { count: "$plants", step: ["($length - 0.16) / $plants", 0, 0] },
      })], { vars: { plantHeight: "$height * 0.9" } });
      break;
    case "wooden":
      params = [num("width", 1.0, 0.6, 1.4, "Width of the planter along x in metres."), num("depth", 0.55, 0.4, 0.7, "Depth along z in metres."), num("height", 0.5, 0.35, 0.7, "Height of the planter in metres."), int("boards", 4, 3, 6, "Boards stacked in each side.")];
      body = [group("Body", [
        box("CornerPost_L", [0.07, "$height", 0.07], { at: ["$width / 2 - 0.035", 0, "$depth / 2 - 0.035"], anchor: "bottom", bevel: 0.006, mirror: "CornerPost_R" }),
        box("CornerPost_BL", [0.07, "$height", 0.07], { at: ["$width / 2 - 0.035", 0, "-$depth / 2 + 0.035"], anchor: "bottom", bevel: 0.006, mirror: "CornerPost_BR" }),
        box("Board_F{i}", ["$width - 0.08", "$bh", 0.022], { at: [0, "0.06 + $bh / 2", "$depth / 2 - 0.02"], repeat: { count: "$boards", step: [0, "$bh + 0.004", 0] }, bevel: 0.004 }),
        box("Board_B{i}", ["$width - 0.08", "$bh", 0.022], { at: [0, "0.06 + $bh / 2", "-$depth / 2 + 0.02"], repeat: { count: "$boards", step: [0, "$bh + 0.004", 0] }, bevel: 0.004 }),
        group("Side_L", [box("Board_{i}", [0.022, "$bh", "$depth - 0.08"], { at: [0, "0.06 + $bh / 2", 0], repeat: { count: "$boards", step: [0, "$bh + 0.004", 0] }, bevel: 0.004 })], { at: ["$width / 2 - 0.02", 0, 0], mirror: "Side_R" }),
        box("Liner", ["$width - 0.1", "$height - 0.1", "$depth - 0.1"], { at: [0, 0.06, 0], anchor: "bottom", material: "rubber" }),
        box("Cap_F", ["$width + 0.02", 0.025, 0.09], { at: [0, "$height", "$depth / 2 - 0.035"], bevel: 0.006 }),
        box("Cap_B", ["$width + 0.02", 0.025, 0.09], { at: [0, "$height", "-$depth / 2 + 0.035"], bevel: 0.006 }),
        box("Cap_L", [0.09, 0.025, "$depth - 0.16"], { at: ["$width / 2 - 0.035", "$height", 0], bevel: 0.006, mirror: "Cap_R" }),
      ], { vars: { bh: "($height - 0.07) / $boards - 0.004" } })];
      soil = box("Soil", ["$width - 0.1", 0.03, "$depth - 0.1"], { at: [0, "$height - 0.035", 0], material: "soil" });
      plants = group("Plant", plant(kind, "($width / 2 - 0.07)", "($depth / 2 - 0.07)", "$plantHeight", "$height - 0.02", seed, bloom), { vars: { plantHeight: "$height * 1.1" } });
      break;
  }
  const s = STYLES[style];
  const f = nice(finish);
  const plantText: Record<PlantKind, string> = { shrub: "a rounded leafy shrub", flowers: `${nice(bloom)} flowers on a bed of foliage`, grass: "a fountain of ornamental grass", topiary: "a clipped topiary ball on a short stem" };
  return {
    slug: slugify("planter", style, finish.replace(/^(paint|ceramic)_/, ""), kind),
    title: up(`${f} ${s.title} with ${kind === "flowers" ? `${nice(bloom)} flowers` : kind}`),
    description: `A ${f} ${s.title}: ${s.text}, filled with soil and ${plantText[kind]}. It faces +z.`,
    tags: [style, f, kind, "bloembak", "plantenbak", ...(kind === "flowers" ? ["bloemen", "flowers"] : kind === "shrub" ? ["struik"] : kind === "grass" ? ["siergras"] : ["buxus", "bol"])],
    params,
    materials: useMats(finish, "soil", "rubber", "leaf_dark", "leaf_green", "leaf_light", "grass_dry", "moss", "bark_brown", bloom, "petal_yellow"),
    nodes: [group("Planter", [...body, soil, plants], { material: finish })],
  };
}

export const planter: Family = {
  id: "planter",
  category: "street",
  archetype: "prop.planter",
  tags: ["planter", "plant pot", "flower box", "plantenbak", "bloembak", "pot", "plant", "street furniture", "straatmeubilair"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f, i) => makePlanter(style, f, i))),
};
