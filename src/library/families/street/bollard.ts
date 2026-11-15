import { box, cyl, ellipsoid, group, int, lathe, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { GRIME, LOCAL, grimeBox, grimeProfile, grimeRound, nice, up, useMats } from "./common.js";

type Style = "cast-iron" | "steel" | "concrete" | "amsterdam";

interface Finish {
  body: string;
  band: string;
  /** Old iron: the paint has gone and rust breaks through. */
  worn?: boolean;
}

const STYLES: Record<Style, { title: string; text: string; finishes: Finish[] }> = {
  "cast-iron": {
    title: "cast iron cannon bollard",
    text: "a flared cannon-shaped body with a moulded collar, a waist ring and a ball cap",
    finishes: [
      { body: "cast_iron", band: "cast_iron", worn: true },
      { body: "paint_black", band: "gold" },
      { body: "paint_forest", band: "brass" },
      { body: "paint_navy", band: "paint_white" },
    ],
  },
  steel: {
    title: "steel tube bollard",
    text: "a straight steel tube with a domed cap, a base flange with bolts and reflective bands near the top",
    finishes: [
      { body: "galvanised", band: "reflector_white" },
      { body: "brushed_steel", band: "reflector_red" },
      { body: "black_steel", band: "reflector_white" },
      { body: "paint_yellow", band: "paint_black" },
    ],
  },
  concrete: {
    title: "concrete bollard",
    text: "a tapered square concrete post with chamfered edges, a pyramid top and a reflective band",
    finishes: [
      { body: "concrete", band: "reflector_white" },
      { body: "concrete_dark", band: "reflector_amber" },
      { body: "granite", band: "reflector_white" },
      { body: "sandstone", band: "reflector_red" },
    ],
  },
  amsterdam: {
    title: "Amsterdam-style bollard",
    text: "a slim tapered cast post with a rounded top, a neck ring and three St Andrew's crosses on front and back",
    finishes: [
      { body: "amsterdam_brown", band: "amsterdam_brown" },
      { body: "paint_burgundy", band: "paint_burgundy" },
      { body: "cast_iron", band: "cast_iron", worn: true },
      { body: "paint_black", band: "reflector_white" },
    ],
  },
};

const R2 = Math.SQRT2;

function nodes(style: Style, f: Finish): SpecNode[] {
  switch (style) {
    case "cast-iron":
      return [
        lathe("Post", [["$r * 1.35", 0], ["$r * 1.35", 0.04], ["$r * 1.15", 0.07], ["$r * 1.05", 0.14], ["$r * 0.82", "$height - 0.14"], ["$r * 0.9", "$height - 0.12"], ["$r * 0.75", "$height - 0.06"], ["$r * 0.4", "$height - 0.04"]], { segments: 20 }),
        lathe("Band_1", [["$r * 1.05", 0.12], ["$r * 1.12", 0.13], ["$r * 1.12", 0.17], ["$r * 1.02", 0.18]], { segments: 20, material: f.band }),
        lathe("Band_2", [["$r * 0.9", "$height * 0.55"], ["$r * 1.0", "$height * 0.55 + 0.01"], ["$r * 1.0", "$height * 0.55 + 0.03"], ["$r * 0.9", "$height * 0.55 + 0.04"]], { segments: 20, material: f.band }),
        group("Cap", [
          cyl("Neck", "$r * 0.35", 0.04, { at: [0, "$height - 0.06", 0], anchor: "base", segments: 16 }),
          ellipsoid("Ball", ["$r * 0.6", "$r * 0.6", "$r * 0.6"], { at: [0, "$height - 0.02 + $r * 0.5", 0], segments: 16 }),
        ]),
        ...grimeProfile("Grime", [["$r * 1.35", 0.001], ["$r * 1.35", 0.04], ["$r * 1.15", 0.07], ["$r * 1.05", 0.14], ["$r * 1.03", 0.2]], { segments: 20 }),
      ];
    case "steel":
      return [
        cyl("Post", "$r", "$height - 0.03", { anchor: "base", at: [0, 0.01, 0], segments: 24, bevel: 0.004 }),
        cyl("Flange", "$r + 0.05", 0.012, { anchor: "base", segments: 24, bevel: 0.003 }),
        cyl("Bolt_{i}", 0.01, 0.02, { at: [0, 0.01, "$r + 0.03"], anchor: "base", segments: 8, repeat: { count: 4, around: "y", phase: 45 }, material: "steel" }),
        lathe("Cap", [["$r + 0.004", "$height - 0.03"], ["$r + 0.004", "$height - 0.015"], ["$r * 0.7", "$height - 0.002"], [0.01, "$height"]], { segments: 24, material: "steel" }),
        cyl("Band_{i}", "$r + 0.002", 0.05, { at: [0, "$height - 0.16", 0], anchor: "base", segments: 24, repeat: { count: "$bands", step: [0, -0.09, 0] }, material: f.band }),
        ...grimeRound("Grime", "$r", "$r", 0.15, [0, 0.012, 0]),
      ];
    case "concrete": {
      const sq = (r: string): string => `${r} * ${R2}`;
      return [
        lathe("Post", [[sq("$r + 0.01"), 0], [sq("$r + 0.02"), 0.01], [sq("$r"), 0.03], [sq("$r * 0.85"), "$height - 0.1"], [sq("$r * 0.85 + 0.01"), "$height - 0.09"]], { segments: 4, rotate: [0, 45, 0] }),
        lathe("Cap", [[sq("$r * 0.85 + 0.012"), "$height - 0.092"], [sq("$r * 0.85 + 0.012"), "$height - 0.07"], [0.02, "$height - 0.005"], [0.012, "$height"]], { segments: 4, rotate: [0, 45, 0] }),
        lathe("Band", [[sq("$r * 0.85 + 0.022"), "$height - 0.24"], [sq("$r * 0.85 + 0.018"), "$height - 0.18"]], { segments: 4, rotate: [0, 45, 0], material: f.band }),
        box("Plinth", ["$r * 2 + 0.1", 0.03, "$r * 2 + 0.1"], { anchor: "bottom", bevel: 0.01, material: "concrete_dark" }),
        box("Plate", ["$r * 0.8", 0.06, 0.01], { at: [0, "$height * 0.3", "$r * 0.92"], rotate: ["-deg(atan($r * 0.15 / ($height - 0.13)))", 0, 0], bevel: 0.003, material: "steel" }),
        cyl("Anchor", 0.012, 0.012, { at: [0, "$height - 0.002", 0], anchor: "base", segments: 10, material: "steel" }),
        ...grimeProfile("Grime", [[sq("($r + 0.002)"), 0.03], [sq("($r - $r * 0.15 * 0.08 / ($height - 0.13) + 0.002)"), 0.11], [sq("($r - $r * 0.15 * 0.2 / ($height - 0.13) + 0.002)"), 0.23]], { segments: 4, rotate: [0, 45, 0] }),
      ];
    }
    case "amsterdam": {
      // Radius of the post at height y, from its taper.
      const rAt = (y: string): string => `($r * 0.95 - $r * 0.2 * ((${y}) - 0.1) / ($height - 0.26))`;
      const cross = (k: number): SpecNode => {
        const y = `$height * 0.5 + ${k} * $r * 0.75`;
        return group(`Cross_${k + 2}`, [
          box("Bar_A", ["$r * 0.85", "$r * 0.16", 0.012], { rotate: [0, 0, 45], bevel: 0.003 }),
          box("Bar_B", ["$r * 0.85", "$r * 0.16", 0.012], { rotate: [0, 0, -45], bevel: 0.003 }),
        ], { at: [0, y, `${rAt(y)} - 0.002`] });
      };
      const crest = [cross(-1), cross(0), cross(1)];
      return [
        lathe("Post", [["$r * 1.15", 0], ["$r * 1.15", 0.03], ["$r", 0.06], ["$r * 0.95", 0.1], ["$r * 0.75", "$height - 0.16"], ["$r * 0.8", "$height - 0.12"], ["$r * 0.72", "$height - 0.09"]], { segments: 20 }),
        lathe("Band", [["$r * 0.82", "$height - 0.135"], ["$r * 0.88", "$height - 0.13"], ["$r * 0.88", "$height - 0.11"], ["$r * 0.8", "$height - 0.1"]], { segments: 20, material: f.band }),
        lathe("Cap", [["$r * 0.74", "$height - 0.095"], ["$r * 0.78", "$height - 0.07"], ["$r * 0.7", "$height - 0.035"], ["$r * 0.45", "$height - 0.01"], [0.01, "$height"]], { segments: 20 }),
        group("Crest_F", crest),
        group("Crest_B", crest, { rotate: [0, 180, 0] }),
        ...grimeProfile("Grime", [["$r * 1.15", 0.001], ["$r * 1.15", 0.03], ["$r", 0.06], ["$r * 0.95", 0.1], ["$r * 0.94", 0.16]], { segments: 20 }),
      ];
    }
  }
}

function params(style: Style) {
  switch (style) {
    case "cast-iron":
      return [num("height", 0.9, 0.6, 1.1, "Height of the bollard in metres."), num("r", 0.11, 0.08, 0.15, "Radius of the body at its foot in metres.")];
    case "steel":
      return [num("height", 1.0, 0.6, 1.2, "Height of the bollard in metres."), num("r", 0.07, 0.045, 0.12, "Radius of the tube in metres."), int("bands", 2, 1, 3, "Number of reflective bands near the top.")];
    case "concrete":
      return [num("height", 0.8, 0.5, 1.1, "Height of the bollard in metres."), num("r", 0.12, 0.09, 0.2, "Half the width of the post at its foot in metres.")];
    case "amsterdam":
      return [num("height", 0.85, 0.7, 1.05, "Height of the bollard in metres."), num("r", 0.06, 0.05, 0.075, "Radius of the post at its foot in metres.")];
  }
}

function makeBollard(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const b = nice(f.body), band = nice(f.band);
  return {
    slug: slugify("bollard", style, f.body.replace(/^paint_/, ""), f.band !== f.body ? f.band.replace(/^(paint|reflector)_/, "") : ""),
    title: up(`${b} ${s.title}${f.band !== f.body ? ` with ${band} bands` : ""}`),
    description: `A ${b} ${s.title}: ${s.text}${f.band !== f.body ? ` in ${band}` : ""}. It is round or square and faces +z.`,
    tags: [style, b, ...(f.band.startsWith("reflector") ? ["reflective", "reflecterend"] : []), ...(style === "amsterdam" ? ["amsterdammertje", "paaltje", "xxx"] : [])],
    params: params(style),
    materials: { ...useMats(f.body, f.band, "steel", "concrete_dark"), ...(f.worn ? { cast_iron: LOCAL["iron_worn"]! } : {}), ...GRIME(f.worn ? "iron_worn" : f.body) },
    nodes: [group("Bollard", nodes(style, f), { material: f.body })],
  };
}

export const bollard: Family = {
  id: "bollard",
  category: "street",
  archetype: "infrastructure.bollard",
  tags: ["bollard", "post", "traffic post", "paal", "paaltje", "afzetpaal", "verkeerspaal", "street furniture", "straatmeubilair"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f) => makeBollard(style, f))),
};
