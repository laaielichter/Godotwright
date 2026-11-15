import { box, cyl, ellipsoid, group, int, lathe, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { GRIME, LOCAL, boardX, grimeBox, grimeRound, nice, up, useMats } from "./common.js";

type Style = "picket" | "post-and-rail" | "mesh" | "railing";

const STYLES: Record<Style, { title: string; text: string; finishes: string[] }> = {
  picket: { title: "picket fence", text: "square posts with pyramid caps, two rails at the back and evenly spaced pickets with pointed tops", finishes: ["paint_white", "paint_cream", "pine"] },
  "post-and-rail": { title: "post and rail fence", text: "round timber posts with chamfered tops and rough sawn rails let into them", finishes: ["rough_timber", "weathered_wood"] },
  mesh: { title: "welded mesh fence", text: "square steel posts with caps holding a welded wire panel with a framed top and bottom", finishes: ["galvanised", "paint_green"] },
  railing: { title: "iron railing", text: "square posts with ball finials, flat top and bottom rails and round bars ending in spear heads", finishes: ["paint_black", "cast_iron", "paint_forest"] },
};

const R2 = Math.SQRT2;

/** Evenly spaced members between the posts, centred, at most $gap apart. */
const spread = (name: string, child: SpecNode[], y: string | number = 0, z: string | number = 0): SpecNode =>
  group(name, child, { at: ["-($cnt - 1) * $step / 2", y, z], repeat: { count: "$cnt", step: ["$step", 0, 0] } });

function nodes(style: Style, mat: string): SpecNode[] {
  switch (style) {
    case "picket":
      return [
        group("Post_L", [
          box("Shaft", [0.08, "$height", 0.08], { anchor: "bottom", bevel: 0.006 }),
          ...grimeBox("Grime", 0.08, 0.08, 0.2, [0, 0, 0], 0.006),
          lathe("Cap", [[0.065 * R2, "$height"], [0.065 * R2, "$height + 0.015"], [0.01, "$height + 0.06"], [0.006, "$height + 0.062"]], { segments: 4, rotate: [0, 45, 0] }),
        ], { at: ["$length / 2 - 0.04", 0, 0], mirror: "Post_R" }),
        boardX("Rail_Top", ["$length - 0.06", 0.07, 0.03], { at: [0, "$height * 0.78", -0.035], bevel: 0.004 }),
        boardX("Rail_Low", ["$length - 0.06", 0.07, 0.03], { at: [0, "$height * 0.22", -0.035], bevel: 0.004 }),
        spread("Picket_{i}", [
          box("Stave", [0.065, "$height - 0.12", 0.02], { at: [0, 0.05, -0.01], anchor: "bottom", bevel: 0.003 }),
          cyl("Tip", 0.0375, 0.02, { axis: "z", segments: 3, at: [0, "$height - 0.07 + 0.0185", -0.01], rotate: [0, 0, 90] }),
        ]),
      ];
    case "post-and-rail":
      return [
        group("Post_L", [
          cyl("Shaft", 0.065, "$height - 0.04", { anchor: "base", segments: 14, bevel: 0.005 }),
          ...grimeRound("Grime", 0.065, 0.065, 0.22, [0, 0, 0], 14),
          lathe("Top", [[0.065, "$height - 0.045"], [0.065, "$height - 0.03"], [0.035, "$height"]], { segments: 14 }),
        ], { at: ["$length / 2 - 0.06", 0, 0], mirror: "Post_R" }),
        boardX("Rail_{i}", ["$length - 0.06", 0.1, 0.045], { at: [0, "$height - 0.18", 0], repeat: { count: "$rails", step: [0, "-($height - 0.35) / max($rails - 1, 1)", 0] }, bevel: 0.008 }),
      ];
    case "mesh":
      return [
        group("Post_L", [
          box("Shaft", [0.06, "$height + 0.05", 0.06], { anchor: "bottom", bevel: 0.004 }),
          ...grimeBox("Grime", 0.06, 0.06, 0.2, [0, 0, 0], 0.004),
          box("Cap", [0.07, 0.015, 0.07], { at: [0, "$height + 0.05", 0], anchor: "bottom", bevel: 0.004, material: "plastic_black" }),
          box("Clip_{i}", [0.03, 0.04, 0.08], { at: [-0.03, 0.3, 0], repeat: { count: 3, step: [0, "($height - 0.5) / 2", 0] }, bevel: 0.004 }),
        ], { at: ["$length / 2 - 0.03", 0, 0], mirror: "Post_R" }),
        cyl("Rail_Top", 0.012, "$length - 0.08", { axis: "x", at: [0, "$height - 0.02", 0], segments: 10 }),
        cyl("Rail_Low", 0.012, "$length - 0.08", { axis: "x", at: [0, 0.08, 0], segments: 10 }),
        spread("Wire_{i}", [box("Strand", [0.005, "$height - 0.1", 0.005], { at: [0, 0.08, 0.008], anchor: "bottom" })]),
        box("Weft_{i}", ["$length - 0.08", 0.005, 0.005], { at: [0, 0.28, -0.006], repeat: { count: "floor(($height - 0.2) / 0.2)", step: [0, 0.2, 0] } }),
      ];
    case "railing":
      return [
        group("Post_L", [
          box("Shaft", [0.07, "$height", 0.07], { anchor: "bottom", bevel: 0.005 }),
          box("Collar", [0.09, 0.03, 0.09], { at: [0, "$height", 0], anchor: "bottom", bevel: 0.006 }),
          ellipsoid("Finial", [0.035, 0.035, 0.035], { at: [0, "$height + 0.055", 0], segments: 14 }),
          box("Plinth", [0.1, 0.06, 0.1], { anchor: "bottom", bevel: 0.008 }),
          ...grimeBox("Grime", 0.1, 0.1, 0.06, [0, 0, 0], 0.008),
        ], { at: ["$length / 2 - 0.035", 0, 0], mirror: "Post_R" }),
        box("Rail_Top", ["$length - 0.06", 0.04, 0.012], { at: [0, "$height - 0.18", 0], bevel: 0.003 }),
        box("Rail_Low", ["$length - 0.06", 0.04, 0.012], { at: [0, 0.12, 0], bevel: 0.003 }),
        spread("Picket_{i}", [
          cyl("Spindle", 0.008, "$height - 0.1", { at: [0, 0.08, 0], anchor: "base", segments: 8 }),
          lathe("Spear", [[0.008, "$height - 0.025"], [0.02, "$height - 0.01"], [0.014, "$height + 0.02"], [0.004, "$height + 0.045"]], { segments: 8 }),
        ]),
      ];
  }
}

function params(style: Style) {
  switch (style) {
    case "picket":
      return [num("length", 2.4, 1.2, 4, "Length of the section along z in metres."), num("height", 1.0, 0.7, 1.3, "Height of the pickets in metres."), num("gap", 0.12, 0.1, 0.18, "Distance between picket centres in metres.")];
    case "post-and-rail":
      return [num("length", 3, 1.5, 4.5, "Length of the section along z in metres."), num("height", 1.1, 0.8, 1.4, "Height of the posts in metres."), int("rails", 3, 2, 4, "Number of rails.")];
    case "mesh":
      return [num("length", 2.5, 1.5, 3, "Length of the panel along z in metres."), num("height", 1.8, 1.0, 2.4, "Height of the panel in metres."), num("gap", 0.05, 0.05, 0.1, "Distance between the vertical wires in metres.")];
    case "railing":
      return [num("length", 2, 1.2, 3, "Length of the section along z in metres."), num("height", 1.2, 0.9, 1.8, "Height of the bars in metres."), num("gap", 0.12, 0.1, 0.16, "Distance between the bars in metres.")];
  }
}

function makeFence(style: Style, mat: string): AssetDraft {
  const s = STYLES[style];
  const m = nice(mat);
  const textured = mat === "paint_white" || mat === "paint_cream";
  const finish = textured ? `${mat}_wood` : mat;
  return {
    slug: slugify("fence", style, mat.replace(/^paint_/, "")),
    title: up(`${m} ${s.title}`),
    description: `A ${m} ${s.title} section: ${s.text}. It runs along z (as the fence archetype expects) with a post at each end, and its face looks towards +x.`,
    tags: [style, m, "hek", "schutting", "omheining", ...(style === "picket" ? ["tuinhek", "paaltjeshek"] : style === "railing" ? ["spijlenhek", "smeedijzer"] : style === "mesh" ? ["gaashek", "bouwhek"] : ["weidehek", "paal"])],
    params: params(style),
    materials: {
      ...useMats(textured ? undefined : mat, "plastic_black"),
      ...(textured ? { [finish]: { ...useMats(mat)[mat]!, metallic: 0, texture: "wood" } } : {}),
      // Old cast iron railings: rust shows through the paint.
      ...(style === "railing" && mat === "cast_iron" ? { cast_iron: LOCAL["iron_worn"]! } : {}),
      ...GRIME(style === "railing" && mat === "cast_iron" ? "iron_worn" : mat),
    },
    nodes: [group("Fence", nodes(style, finish), {
      material: finish,
      rotate: [0, 90, 0],
      vars: style === "post-and-rail" ? {} : { cnt: `max(1, floor(($length - ${style === "mesh" ? 0.12 : 0.2}) / $gap))`, step: "$gap" },
    })],
  };
}

export const fence: Family = {
  id: "fence",
  category: "street",
  archetype: "infrastructure.fence",
  tags: ["fence", "fencing", "railing", "hek", "schutting", "omheining", "afrastering", "boundary"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f) => makeFence(style, f))),
};
