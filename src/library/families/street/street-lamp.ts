import { box, cyl, ellipsoid, group, lathe, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode, type Vec } from "../../kit.js";
import { nice, useMats } from "./common.js";

type Style = "lantern" | "led" | "double" | "globe" | "crook";

const STYLES: Record<Style, { title: string; text: string; finishes: { metal: string; glow: string }[] }> = {
  lantern: {
    title: "Historic lantern street lamp",
    text: "a fluted cast base, a tapered column with a ladder bar and a four-sided glass lantern with a pyramid roof and finial",
    finishes: [
      { metal: "paint_black", glow: "glow_warm_glass" },
      { metal: "paint_forest", glow: "glow_warm_glass" },
      { metal: "cast_iron", glow: "glow_warm_glass" },
      { metal: "paint_navy", glow: "glow_warm_glass" },
    ],
  },
  led: {
    title: "Modern LED street lamp",
    text: "a conical steel pole on a concrete footing with a service door, a rising outreach arm towards +z and a flat LED luminaire with a glowing lens and cooling fins",
    finishes: [
      { metal: "galvanised", glow: "bulb_cool" },
      { metal: "paint_anthracite", glow: "bulb_cool" },
      { metal: "aluminium", glow: "bulb_warm" },
      { metal: "paint_grey", glow: "bulb_warm" },
    ],
  },
  double: {
    title: "Double-arm street lamp",
    text: "a tall conical pole with two curved arms reaching left and right, each carrying a cobra-head luminaire with a glowing bowl",
    finishes: [
      { metal: "galvanised", glow: "bulb_warm" },
      { metal: "paint_anthracite", glow: "bulb_cool" },
      { metal: "steel", glow: "bulb_amber" },
      { metal: "paint_green", glow: "bulb_warm" },
    ],
  },
  globe: {
    title: "Park globe lamp",
    text: "a short slim post on a turned base with collars, topped by a glowing opal globe on a fitter with a small cap",
    finishes: [
      { metal: "paint_black", glow: "glow_globe" },
      { metal: "paint_forest", glow: "glow_globe" },
      { metal: "brushed_steel", glow: "glow_globe" },
      { metal: "bronze", glow: "glow_globe" },
    ],
  },
  crook: {
    title: "Shepherd's crook lamp",
    text: "a turned column whose top bends over in a crook towards +z, with a scroll and a bell-shaped glass lantern hanging from it",
    finishes: [
      { metal: "paint_black", glow: "glow_warm_glass" },
      { metal: "paint_forest", glow: "glow_warm_glass" },
      { metal: "cast_iron", glow: "glow_warm_glass" },
      { metal: "paint_burgundy", glow: "glow_warm_glass" },
    ],
  },
};

const R2 = Math.SQRT2;

/** A turned base and a tapered shaft up to y = top. */
function classicPole(top: Num, extra: SpecNode[] = []): SpecNode {
  return group("Pole", [
    lathe("Base", [[0.2, 0], [0.2, 0.05], [0.17, 0.08], [0.16, 0.3], [0.12, 0.36], [0.12, 0.6], [0.09, 0.7], [0.085, 0.9], [0.07, 0.95]], { segments: 16 }),
    box("Flute", [0.02, 0.22, 0.02], { at: [0.12, 0.48, 0], repeat: { count: 8, around: "y" }, bevel: 0.006 }),
    lathe("Shaft", [[0.062, 0.93], [0.05, `${top} - 0.2`], [0.062, `${top} - 0.16`], [0.062, `${top} - 0.1`], [0.045, top]], { segments: 16 }),
    cyl("Collar", 0.075, 0.04, { at: [0, 0.97, 0], segments: 16, bevel: 0.01 }),
    ...extra,
  ]);
}

/** A conical steel pole on a footing, with a service door at the front. */
function steelPole(extra: SpecNode[]): SpecNode {
  return group("Pole", [
    cyl("Footing", 0.3, 0.05, { anchor: "base", segments: 20, bevel: 0.015, material: "concrete" }),
    lathe("Flange", [[0.17, 0.04], [0.17, 0.065], [0.11, 0.08], [0.1, 0.35]], { segments: 20 }),
    lathe("Shaft", [[0.095, 0.3], [0.06, "$height"], [0.04, "$height + 0.02"]], { segments: 20 }),
    box("Door", [0.08, 0.32, 0.02], { at: [0, 0.75, 0.085], bevel: 0.006 }),
    ...extra,
  ]);
}

function lamp(style: Style, metal: string, glow: string): SpecNode[] {
  switch (style) {
    case "lantern": {
      const b = "$lantern * 0.3", t = "$lantern * 0.5", hg = "$lantern * 1.05";
      const corner = (name: string, sz: 1 | -1, mirror: string): SpecNode =>
        tube(name, [[b, 0.1, sz === 1 ? b : `-${b}`], [t, `0.1 + ${hg}`, sz === 1 ? t : `-${t}`]] as Vec[], 0.012, { segments: 8, mirror });
      return [
        classicPole("$height", [
          cyl("Crossbar", 0.016, 0.56, { axis: "x", at: [0, "$height - 0.42", 0], segments: 10 }),
          ellipsoid("Knob_L", [0.03, 0.03, 0.03], { at: [0.28, "$height - 0.42", 0], segments: 12, mirror: "Knob_R" }),
        ]),
        group("Lamp", [
          lathe("Tray", [[0.035, -0.02], [0.08, 0.04], [`${b} * ${R2} + 0.02`, 0.08], [`${b} * ${R2} + 0.02`, 0.11]], { segments: 4, rotate: [0, 45, 0] }),
          lathe("Glass", [[`${b} * ${R2}`, 0.1], [`${t} * ${R2}`, `0.1 + ${hg}`]], { segments: 4, rotate: [0, 45, 0], material: glow }),
          ellipsoid("Bulb", [0.04, 0.06, 0.04], { at: [0, `0.16 + ${hg} * 0.3`, 0], segments: 12, material: "bulb_warm" }),
          cyl("Socket", 0.025, `${hg} * 0.3`, { at: [0, 0.1, 0], anchor: "base", segments: 10 }),
          corner("Corner_FL", 1, "Corner_FR"),
          corner("Corner_BL", -1, "Corner_BR"),
          lathe("Band", [[`${t} * ${R2} + 0.025`, `0.09 + ${hg}`], [`${t} * ${R2} + 0.025`, `0.13 + ${hg}`]], { segments: 4, rotate: [0, 45, 0] }),
          lathe("Roof", [[`${t} * ${R2} + 0.07`, `0.13 + ${hg}`], [`${t} * ${R2} + 0.07`, `0.15 + ${hg}`], [0.05, `0.15 + ${hg} + $lantern * 0.42`], [0.03, `0.17 + ${hg} + $lantern * 0.42`]], { segments: 4, rotate: [0, 45, 0] }),
          ellipsoid("Finial", [0.035, 0.05, 0.035], { at: [0, `0.2 + ${hg} + $lantern * 0.42`, 0], segments: 12 }),
        ], { at: [0, "$height", 0] }),
      ];
    }
    case "led":
      return [
        steelPole([tube("Arm", [[0, "$height - 0.45", 0], [0, "$height - 0.1", 0.04], [0, "$height + 0.04", 0.25], [0, "$height + 0.12", "$armLength"]], 0.035, { segments: 12 })]),
        group("Lamp", [
          box("Housing", [0.34, 0.07, "$head"], { at: [0, -0.01, "$head / 2 - 0.06"], bevel: 0.025 }),
          box("Lens", [0.27, 0.014, "$head - 0.1"], { at: [0, -0.048, "$head / 2 - 0.04"], bevel: 0.005, material: glow }),
          box("Fin_{i}", [0.26, 0.025, 0.012], { at: [0, 0.03, 0.02], repeat: { count: 6, step: [0, 0, "($head - 0.2) / 5"] }, bevel: 0.003 }),
          cyl("Photocell", 0.03, 0.04, { at: [0, 0.03, "$head - 0.15"], anchor: "base", segments: 12, material: "plastic_white" }),
          cyl("Spigot", 0.045, 0.1, { axis: "z", at: [0, 0, -0.05], segments: 12 }),
        ], { at: [0, "$height + 0.12", "$armLength"] }),
      ];
    case "double":
      return [
        steelPole([
          tube("Arm_L", [[0, "$height - 0.7", 0], [0.04, "$height - 0.3", 0], ["$armLength * 0.45", "$height - 0.02", 0], ["$armLength", "$height + 0.06", 0]], 0.04, { segments: 12, mirror: "Arm_R" }),
          cyl("Tie", 0.02, 0.2, { axis: "x", at: [0, "$height - 0.25", 0], segments: 10 }),
        ]),
        group("Lamp_L", [
          ellipsoid("Hood", ["$head / 2", 0.09, 0.17], { at: ["$head / 2 - 0.06", 0, 0], segments: 20 }),
          ellipsoid("Bowl", ["$head / 2 - 0.05", 0.04, 0.13], { at: ["$head / 2 - 0.04", -0.045, 0], segments: 20, material: glow }),
          cyl("Spigot", 0.045, 0.12, { axis: "x", at: [0, 0, 0], segments: 12 }),
        ], { at: ["$armLength", "$height + 0.06", 0], mirror: "Lamp_R" }),
      ];
    case "globe":
      return [
        group("Pole", [
          lathe("Base", [[0.15, 0], [0.15, 0.04], [0.12, 0.07], [0.1, 0.35], [0.075, 0.4], [0.07, 0.55], [0.05, 0.6]], { segments: 16 }),
          lathe("Shaft", [[0.052, 0.58], [0.045, "$height - 0.1"], [0.06, "$height - 0.05"], [0.04, "$height"]], { segments: 16 }),
          cyl("Collar_1", 0.065, 0.035, { at: [0, 0.62, 0], segments: 16, bevel: 0.01 }),
          cyl("Collar_2", 0.06, 0.03, { at: [0, "$height * 0.6", 0], segments: 16, bevel: 0.01 }),
        ]),
        group("Lamp", [
          lathe("Fitter", [[0.035, -0.01], [0.07, 0.04], [0.1, 0.08], [0.1, 0.11]], { segments: 16 }),
          ellipsoid("Globe", ["$globe / 2", "$globe / 2", "$globe / 2"], { at: [0, "0.1 + $globe * 0.48", 0], segments: 20, material: glow }),
          lathe("Cap", [["$globe * 0.22", "0.1 + $globe * 0.9"], ["$globe * 0.24", "0.1 + $globe * 0.95"], [0.03, "0.1 + $globe + 0.04"], [0.02, "0.1 + $globe + 0.06"]], { segments: 16 }),
          ellipsoid("Finial", [0.022, 0.03, 0.022], { at: [0, "0.1 + $globe + 0.07", 0], segments: 10 }),
        ], { at: [0, "$height", 0] }),
      ];
    case "crook": {
      const pts: Vec[] = [[0, "$height - 0.75", 0]];
      for (const a of [0, 30, 60, 90, 120, 150, 180]) pts.push([0, `$height - 0.3 + $reach / 2 * sin(rad(${a}))`, `$reach / 2 * (1 - cos(rad(${a})))`]);
      pts.push([0, "$height - 0.42", "$reach"]);
      return [
        classicPole("$height - 0.7", [
          tube("Crook", pts, 0.035, { segments: 12 }),
          tube("Scroll", [[0, "$height - 0.55", 0.02], [0, "$height - 0.45", "$reach * 0.25"], [0, "$height - 0.32", "$reach * 0.3"], [0, "$height - 0.27", "$reach * 0.15"], [0, "$height - 0.3", 0.03]], 0.014, { segments: 8 }),
        ]),
        group("Lamp", [
          cyl("Hanger", 0.015, 0.1, { at: [0, -0.1, 0], anchor: "base", segments: 8 }),
          lathe("Bell", [[0.05, -0.32], [0.2, -0.3], [0.21, -0.27], [0.12, -0.18], [0.05, -0.1], [0.03, -0.08]], { segments: 18 }),
          lathe("Glass", [[0.04, -0.72], [0.1, -0.68], [0.15, -0.55], [0.16, -0.4], [0.14, -0.3]], { segments: 18, material: glow }),
          lathe("Ring", [[0.12, -0.33], [0.17, -0.32], [0.17, -0.29], [0.12, -0.28]], { segments: 18 }),
          ellipsoid("Drop", [0.03, 0.05, 0.03], { at: [0, -0.74, 0], segments: 10 }),
        ], { at: [0, "$height - 0.42", "$reach"] }),
      ];
    }
  }
}

function params(style: Style) {
  switch (style) {
    case "lantern":
      return [num("height", 3.6, 3, 5, "Height of the column top in metres."), num("lantern", 0.42, 0.32, 0.56, "Width of the lantern at its top in metres.")];
    case "led":
      return [num("height", 8, 5, 10, "Pole height in metres."), num("armLength", 1.4, 0.6, 2.0, "How far the arm reaches out over the road (+z) in metres."), num("head", 0.62, 0.45, 0.8, "Length of the LED luminaire in metres.")];
    case "double":
      return [num("height", 9, 6, 11, "Pole height in metres."), num("armLength", 1.5, 0.8, 2.2, "Reach of each arm in metres."), num("head", 0.6, 0.45, 0.75, "Length of each cobra-head luminaire in metres.")];
    case "globe":
      return [num("height", 3.5, 3, 4.5, "Height of the post in metres."), num("globe", 0.4, 0.3, 0.5, "Diameter of the globe in metres.")];
    case "crook":
      return [num("height", 4.5, 3.6, 6, "Height of the crook top in metres."), num("reach", 0.7, 0.5, 1.0, "How far the crook reaches out over +z in metres.")];
  }
}

function makeLamp(style: Style, f: { metal: string; glow: string }): AssetDraft {
  const s = STYLES[style];
  const m = nice(f.metal);
  return {
    slug: slugify("street-lamp", style, f.metal.replace(/^paint_/, "")),
    title: `${s.title}, ${m}`,
    description: `A ${m} street lamp with ${s.text}. The light glows; the lamp faces +z.`,
    tags: [style, m, "lantaarn", "lantaarnpaal", "straatverlichting", ...(style === "led" ? ["led"] : []), ...(style === "lantern" || style === "crook" ? ["historic", "historisch", "heritage"] : [])],
    params: params(style),
    materials: useMats(f.metal, f.glow, "bulb_warm", "concrete", "plastic_white"),
    nodes: [group("StreetLamp", lamp(style, f.metal, f.glow), { material: f.metal })],
  };
}

export const streetLamp: Family = {
  id: "street-lamp",
  category: "street",
  archetype: "infrastructure.street-lamp",
  tags: ["street lamp", "street light", "lamp post", "lamppost", "light pole", "lantaarnpaal", "straatlantaarn", "verlichting", "lamp"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f) => makeLamp(style, f))),
};

