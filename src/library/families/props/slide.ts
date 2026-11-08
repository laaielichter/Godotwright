import { box, combos, cyl, group, num, roof, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label, mats } from "../../palette.js";

/**
 * Playground slides: a moulded plastic toddler slide, a steel park slide with a guarded deck and a stainless chute, and
 * a timber play tower with a roof and a coloured chute. The Ladder climbs to the Platform from -z and the Chute runs
 * down towards +z, from an entry at the deck edge, over a straight run at the slope angle, to a flat run-out with its
 * own legs. On y = 0.
 */
type Style = "toddler" | "park" | "tower";

interface Look {
  key: string;
  /** Frame, posts, ladder. */
  frame: string;
  chute: string;
  /** Deck boards or plate. */
  deck: string;
  trim: string;
  text: string;
}

const LOOKS: Record<Style, Look[]> = {
  toddler: [
    { key: "blue", frame: "plastic_blue", chute: "plastic_yellow", deck: "plastic_blue", trim: "plastic_red", text: "blue moulded plastic with a yellow chute and red handles" },
    { key: "green", frame: "plastic_green", chute: "plastic_red", deck: "plastic_green", trim: "plastic_yellow", text: "green moulded plastic with a red chute and yellow handles" },
    { key: "red", frame: "plastic_red", chute: "plastic_blue", deck: "plastic_red", trim: "plastic_white", text: "red moulded plastic with a blue chute and white handles" },
    { key: "grey", frame: "plastic_grey", chute: "plastic_orange", deck: "plastic_grey", trim: "plastic_orange", text: "grey moulded plastic with an orange chute and handles" },
  ],
  park: [
    { key: "stainless", frame: "paint_green", chute: "brushed_steel", deck: "galvanised", trim: "paint_green", text: "green-painted steel posts and rails, a galvanised deck and a stainless steel chute" },
    { key: "red", frame: "paint_red", chute: "brushed_steel", deck: "galvanised", trim: "paint_red", text: "red-painted steel posts and rails, a galvanised deck and a stainless steel chute" },
    { key: "yellow", frame: "paint_anthracite", chute: "plastic_yellow", deck: "galvanised", trim: "paint_anthracite", text: "anthracite steel posts and rails, a galvanised deck and a yellow plastic chute" },
    { key: "blue", frame: "galvanised", chute: "plastic_blue", deck: "galvanised", trim: "paint_blue", text: "galvanised steel posts, blue rails and a blue plastic chute" },
  ],
  tower: [
    { key: "pine", frame: "pine", chute: "plastic_green", deck: "pine", trim: "paint_green", text: "pine posts and planks with a green roof and a green chute" },
    { key: "larch", frame: "light_oak", chute: "plastic_blue", deck: "light_oak", trim: "paint_blue", text: "larch-coloured timber with a blue roof and a blue chute" },
    { key: "weathered", frame: "weathered_wood", chute: "brushed_steel", deck: "weathered_wood", trim: "paint_red", text: "weathered grey timber with a red roof and a stainless chute" },
    { key: "stained", frame: "dark_stain", chute: "plastic_yellow", deck: "dark_stain", trim: "paint_yellow", text: "dark-stained timber with a yellow roof and a yellow chute" },
  ],
};

/** The ladder from the ground at the back up to the back edge of the deck: rails at the angle $b, rungs or treads. */
function ladder(style: Style, l: Look): SpecNode {
  const foot = "-$pd / 2 - $deck * tan($b)";
  const y = "($i + 1) * $sp";
  const z = `${foot} + ${y} * tan($b)`;
  const rail = style === "park" ? cyl("RailLeft", 0.024, "$deck / cos($b) + 0.02", { at: ["$lw / 2", 0, foot], rotate: ["deg($b)", 0, 0], anchor: "base", segments: 12, mirror: "RailRight" })
    : box("RailLeft", [style === "toddler" ? 0.06 : 0.045, "$deck / cos($b) + 0.02", style === "toddler" ? 0.14 : 0.12], { at: ["$lw / 2", 0, foot], rotate: ["deg($b)", 0, 0], anchor: "bottom", bevel: style === "toddler" ? 0.02 : 0.006, mirror: "RailRight" });
  const rungs = style === "park"
    ? cyl("Rung_{i}", 0.016, "$lw", { axis: "x", at: [0, y, z], segments: 10, material: l.deck, repeat: { count: "floor(($deck - 0.12) / $sp)", step: [0, 0, 0] } })
    : box("Step_{i}", ["$lw - 0.02", style === "toddler" ? 0.05 : 0.035, style === "toddler" ? 0.16 : 0.12], { at: [0, y, z], bevel: style === "toddler" ? 0.015 : 0.005, material: l.deck, repeat: { count: "floor(($deck - 0.12) / $sp)", step: [0, 0, 0] } });
  const extra: SpecNode[] = style === "toddler"
    ? [tube("Grip_L", [["$lw / 2", "$deck - 0.05", "-$pd / 2 - 0.1"], ["$lw / 2 + 0.02", "$deck + 0.35", "-$pd / 2 - 0.05"], ["$lw / 2 + 0.02", "$deck + 0.38", "-$pd / 2 + 0.2"], ["$lw / 2", "$deck + 0.02", "-$pd / 2 + 0.25"]], 0.022, { segments: 10, material: l.trim, mirror: "Grip_R" })]
    : [tube("Handrail_L", [["$lw / 2", "$deck - 0.6", `${foot} + ($deck - 0.6) * tan($b) - 0.02`], ["$lw / 2 + 0.01", "$deck + 0.55", "-$pd / 2 - 0.05"], ["$lw / 2 + 0.01", "$deck + 0.55", "-$pd / 2 + 0.02"]], 0.018, { segments: 10, material: l.trim, mirror: "Handrail_R" })];
  return group("Ladder", [rail, rungs, ...extra], { material: l.frame });
}

/** The deck with its posts and guards; the tower adds plank walls and a gable roof. */
function platform(style: Style, l: Look): SpecNode {
  if (style === "toddler") {
    return group("Platform", [
      box("Deck", ["$pw", 0.06, "$pd"], { at: [0, "$deck - 0.03", 0], bevel: 0.02, material: l.deck }),
      box("SidePanel_L", [0.05, "$deck + 0.3", "$pd"], { at: ["$pw / 2 + 0.025", 0, 0], anchor: "bottom", bevel: 0.02, mirror: "SidePanel_R" }),
      box("BackPanel", ["$pw", "$deck * 0.6", 0.04], { at: [0, "$deck * 0.15", "-$pd / 2 + 0.02"], anchor: "bottom", bevel: 0.015 }),
      cyl("Knob_L", 0.035, 0.05, { axis: "x", at: ["$pw / 2 + 0.075", "$deck + 0.18", 0], segments: 12, material: l.trim, mirror: "Knob_R" }),
    ], { material: l.frame });
  }
  const top = style === "tower" ? "$deck + 1.45" : "$deck + 0.8";
  const parts: SpecNode[] = [
    box("Deck", ["$pw + 0.1", 0.04, "$pd + 0.1"], { at: [0, "$deck - 0.02", 0], bevel: 0.005, material: l.deck }),
    style === "park"
      ? cyl("Post_FL", 0.045, top, { at: ["$pw / 2", 0, "$pd / 2"], anchor: "base", segments: 14, repeat: { count: 2, step: [0, 0, "-$pd"] }, mirror: "Post_FR" })
      : box("Post_FL", [0.09, top, 0.09], { at: ["$pw / 2", 0, "$pd / 2"], anchor: "bottom", bevel: 0.008, repeat: { count: 2, step: [0, 0, "-$pd"] }, mirror: "Post_FR" }),
    box("DeckBeam_L", [0.05, 0.14, "$pd"], { at: ["$pw / 2 - 0.07", "$deck - 0.11", 0], bevel: 0.005, mirror: "DeckBeam_R" }),
  ];
  if (style === "park") {
    parts.push(
      cyl("Guard_L{i}", 0.02, "$pd", { axis: "z", at: ["$pw / 2", "$deck + 0.3 + $i * 0.45", 0], segments: 10, material: l.trim, repeat: { count: 2, step: [0, 0, 0] }, mirror: "Guard_R{i}" }),
      cyl("Bar_L{i}", 0.011, 0.45, { at: ["$pw / 2", "$deck + 0.07", "-$pd / 2 + ($i + 1) * $pd / 5"], anchor: "base", segments: 8, material: l.trim, repeat: { count: 4, step: [0, 0, 0] }, mirror: "Bar_R{i}" }),
      cyl("Cap_FL", 0.05, 0.04, { at: ["$pw / 2", top, "$pd / 2"], anchor: "base", segments: 14, material: l.trim, repeat: { count: 2, step: [0, 0, "-$pd"] }, mirror: "Cap_FR" }),
    );
  } else {
    parts.push(
      box("Plank_L{i}", [0.025, 0.12, "$pd - 0.09"], { at: ["$pw / 2", "$deck + 0.1 + $i * 0.16", 0], bevel: 0.004, repeat: { count: 4, step: [0, 0, 0] }, mirror: "Plank_R{i}" }),
      box("Lintel_F", ["$pw + 0.09", 0.14, 0.06], { at: [0, "$deck + 1.4", "$pd / 2"], bevel: 0.006, repeat: { count: 2, step: [0, 0, "-$pd"] } }),
      roof("Roof", { x0: "-$pw / 2 - 0.2", x1: "$pw / 2 + 0.2", z0: "-$pd / 2 - 0.25", z1: "$pd / 2 + 0.25", y: "$deck + 1.45", rise: 0.55 }, { material: l.trim }),
      box("Ridge", ["$pw + 0.46", 0.06, 0.06], { at: [0, "$deck + 1.99", 0], bevel: 0.008 }),
    );
  }
  return group("Platform", parts, { material: l.frame });
}

/** The chute: a flat entry at the deck edge, a straight run down at $a and a flat run-out on legs. */
function chute(style: Style, l: Look): SpecNode {
  const wall = style === "toddler" ? 0.05 : 0.025;
  const sides = (len: string): SpecNode[] => [
    box("Wall_L", [wall, 0.2, len], { at: [`$cw / 2 + ${wall / 2}`, 0.08, `${len} / 2`], bevel: 0.006, mirror: "Wall_R" }),
    cyl("Lip_L", wall * 0.8, len, { axis: "z", at: [`$cw / 2 + ${wall / 2}`, 0.18, `${len} / 2`], segments: 10, mirror: "Lip_R" }),
  ];
  const bed = (len: string): SpecNode => box("Bed", ["$cw + 0.02", 0.03, len], { at: [0, -0.015, `${len} / 2`], bevel: 0.006 });
  return group("Chute", [
    group("Entry", [bed("0.32"), ...sides("0.32"), cyl("Bar", 0.02, "$cw + 0.1", { axis: "x", at: [0, 0.6, 0.02], segments: 10, material: l.frame }), box("BarPost_L", [0.035, 0.6, 0.035], { at: [`$cw / 2 + 0.05`, 0, 0.02], anchor: "bottom", bevel: 0.006, material: l.frame, mirror: "BarPost_R" })], { at: [0, 0, 0] }),
    group("Run", [bed("$run"), ...sides("$run")], { at: [0, 0, 0.3], rotate: ["$slope", 0, 0] }),
    group("Exit", [
      bed("0.55"),
      ...sides("0.55"),
      box("ExitLeg_L", [0.05, "$exitH - 0.03", 0.05], { at: ["$cw / 2 - 0.04", "-$exitH", 0.38], anchor: "bottom", bevel: 0.006, material: l.frame, mirror: "ExitLeg_R" }),
    ], { at: [0, "$exitH - $deck", "0.3 + $run * cos($a) - 0.02"] }),
    box("RunLeg_L", [0.05, "($deck + $exitH) / 2 - 0.05", 0.05], { at: ["$cw / 2 - 0.04", "-$deck", "0.3 + $run * cos($a) / 2"], anchor: "bottom", bevel: 0.006, material: l.frame, mirror: "RunLeg_R" }),
  ], { at: [0, "$deck", "$pd / 2"], material: l.chute });
}

const STYLES: Record<Style, { title: string; text: string; deck: [number, number, number]; pad: number; tags: string[] }> = {
  toddler: { title: "toddler slide", text: "A moulded toddler slide: chunky steps between rounded side panels, a small deck with grab handles, and a wide-walled chute", deck: [0.95, 0.8, 1.3], pad: 0.12, tags: ["toddler", "peuter", "kleuter", "plastic", "garden", "tuin"] },
  park: { title: "park slide", text: "A playground slide on four steel posts: a round-rung ladder with handrails, a guarded deck with bars, and a straight chute with rolled lips", deck: [1.5, 1.2, 2], pad: 0.3, tags: ["park", "playground", "speeltuin", "steel", "stalen"] },
  tower: { title: "play tower slide", text: "A timber play tower: a stepped ladder with handrails, a deck boxed in by planks under a gable roof, and a straight chute with rolled lips", deck: [1.5, 1.2, 2.2], pad: 0.45, tags: ["tower", "speeltoren", "wooden", "houten", "roof", "dak", "garden", "tuin"] },
};

function slide(style: Style, l: Look): AssetDraft {
  const s = STYLES[style];
  const [dd, dmin, dmax] = s.deck;
  return {
    slug: slugify("slide", l.key, style === "tower" ? "tower" : style),
    title: `${l.key.charAt(0).toUpperCase()}${l.key.slice(1)} ${s.title}`,
    description: `${s.text}, in ${l.text}. The ladder climbs from -z and the chute runs down towards +z; it stands on y = 0.`,
    tags: [style, l.key, label(l.chute), ...s.tags],
    params: [
      num("deck", dd, dmin, dmax, "Height of the deck (the top of the chute) above the ground in metres."),
      num("chuteWidth", style === "toddler" ? 0.45 : 0.5, 0.4, 0.65, "Inside width of the chute along x in metres."),
      num("slope", style === "toddler" ? 30 : 34, 26, 40, "Angle of the chute's straight run below horizontal, in degrees."),
    ],
    materials: mats(...new Set([l.frame, l.chute, l.deck, l.trim])),
    nodes: [
      group("Playset", [platform(style, l), ladder(style, l), chute(style, l)], {
        vars: {
          cw: "$chuteWidth",
          pw: `$chuteWidth + ${s.pad}`,
          lw: `$chuteWidth + ${style === "toddler" ? 0.05 : 0}`,
          pd: style === "toddler" ? 0.45 : 0.8,
          b: style === "park" ? "rad(18)" : "rad(25)",
          sp: `($deck - 0.06) / (floor(($deck - 0.12) / ${style === "toddler" ? 0.22 : 0.26}) + 1)`,
          a: "rad($slope)",
          exitH: style === "toddler" ? 0.2 : 0.3,
          run: "($deck - $exitH) / sin($a)",
        },
      }),
    ],
  };
}

export const slideFamily: Family = {
  id: "slide",
  category: "props",
  archetype: "prop.slide",
  tags: ["slide", "slides", "glijbaan", "glijbanen", "chute", "playground", "speeltuin", "play", "spelen", "prop"],
  assets: () => combos({ style: ["toddler", "park", "tower"] as Style[], i: [0, 1, 2, 3] }).map(({ style, i }) => slide(style, LOOKS[style][i]!)),
};
