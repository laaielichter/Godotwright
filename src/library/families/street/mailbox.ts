import { box, cyl, group, lathe, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { GRIME, boardZ, grimeBox, grimeProfile, nice, up, useMats } from "./common.js";

type Style = "pillar" | "collection" | "residential" | "parcel" | "post-mounted";

const STYLES: Record<Style, { title: string; text: string; finishes: string[] }> = {
  pillar: { title: "pillar box", text: "a round cast body on a black plinth with a domed cap, a hooded letter slot under the crown and a hinged front door with a plaque and keyhole", finishes: ["pillar_red", "paint_forest"] },
  collection: { title: "collection mailbox", text: "a box body with a rounded top on four short legs, a pull-down letter flap at the top front and a hinged service door with a lock", finishes: ["postal_blue", "paint_olive"] },
  residential: { title: "rural mailbox on a post", text: "a tunnel-shaped box on a timber post with a bracket, a front door hinged at the bottom with a slot and a knob, and a red flag on the side", finishes: ["paint_black", "galvanised"] },
  parcel: { title: "parcel locker box", text: "a tall cabinet on a plinth under a canopy, with a letter slot, a glowing screen and keypad and a large hinged door", finishes: ["paint_anthracite", "postal_yellow"] },
  "post-mounted": { title: "post-mounted letter box", text: "a box with a rounded top on a steel post, with a flapped letter slot, a horn badge and a hinged emptying door", finishes: ["postal_orange", "postal_yellow"] },
};

/** A door whose node sits on its left hinge line; the panel and its hardware are moved right of it. */
const door = (at: [string | number, string | number, string | number], w: string, h: string, extra: SpecNode[] = []): SpecNode =>
  group("Door", [
    box("Panel", [w, h, 0.016], { at: [`(${w}) / 2`, `(${h}) / 2`, 0], bevel: 0.004 }),
    cyl("Keyhole", 0.014, 0.012, { axis: "z", at: [`(${w}) / 2`, `(${h}) * 0.78`, 0.01], segments: 12, material: "brass" }),
    ...extra,
  ], { at });

function nodes(style: Style, body: string): SpecNode[] {
  switch (style) {
    case "pillar":
      return [
        group("Body", [
          lathe("Shaft", [["$r + 0.03", 0.08], ["$r + 0.03", 0.14], ["$r", 0.17], ["$r", "$height - 0.25"], ["$r + 0.03", "$height - 0.22"], ["$r + 0.03", "$height - 0.17"]], { segments: 28 }),
          lathe("Crown", [["$r + 0.05", "$height - 0.18"], ["$r + 0.05", "$height - 0.14"], ["$r * 0.92", "$height - 0.08"], ["$r * 0.5", "$height - 0.02"], [0.03, "$height"]], { segments: 28 }),
          cyl("Plinth", "$r + 0.045", 0.1, { anchor: "base", segments: 28, bevel: 0.01, material: "paint_black" }),
          box("Hood", ["$r * 1.05", 0.03, 0.07], { at: [0, "$height - 0.33", "$r - 0.005"], bevel: 0.008 }),
        ]),
        box("Slot", ["$r * 0.9", 0.035, 0.04], { at: [0, "$height - 0.37", "$r - 0.01"], material: "opening_dark" }),
        door(["-$r * 0.45", "$height * 0.25", "$r - 0.003"], "$r * 0.9", "$height * 0.3", [box("Plaque", ["$r * 0.5", 0.07, 0.006], { at: ["$r * 0.45", "$height * 0.12", 0.01], bevel: 0.002, material: "paint_white" })]),
        ...grimeProfile("Grime", [["$r + 0.03", 0.1], ["$r + 0.03", 0.14], ["$r", 0.17], ["$r", 0.3]], { segments: 28 }),
      ];
    case "collection":
      return [
        group("Body", [
          box("Shell", ["$width", "$height - 0.17 - $width / 2", 0.48], { at: [0, 0.16, 0], anchor: "bottom", bevel: 0.012 }),
          cyl("Top", "$width / 2", 0.48, { axis: "z", at: [0, "$height - $width / 2", 0], segments: 28, bevel: 0.012 }),
          box("Leg_FL", [0.05, 0.17, 0.05], { at: ["$width / 2 - 0.04", 0, 0.2], anchor: "bottom", bevel: 0.006, mirror: "Leg_FR" }),
          box("Leg_BL", [0.05, 0.17, 0.05], { at: ["$width / 2 - 0.04", 0, -0.2], anchor: "bottom", bevel: 0.006, mirror: "Leg_BR" }),
          box("Decal", ["$width * 0.35", "$width * 0.35", 0.006], { at: [0, "$height * 0.5", 0.242], bevel: 0.002, material: "paint_white" }),
        ]),
        group("Slot", [
          box("Mouth", ["$width * 0.6", 0.05, 0.02], { at: [0, 0, 0], material: "opening_dark" }),
          box("Flap", ["$width * 0.66", 0.09, 0.02], { at: [0, 0.06, 0.012], rotate: [-15, 0, 0], bevel: 0.006 }),
          box("Pull", ["$width * 0.3", 0.02, 0.03], { at: [0, 0.02, 0.03], bevel: 0.006, material: "steel" }),
        ], { at: [0, "$height - $width / 2 - 0.1", 0.24] }),
        door(["-$width / 2 + 0.04", 0.24, 0.245], "$width - 0.08", "$height * 0.35"),
        ...grimeBox("Grime_FL", 0.05, 0.05, 0.12, ["$width / 2 - 0.04", 0, 0.2], 0.006),
        ...grimeBox("Grime_FR", 0.05, 0.05, 0.12, ["-$width / 2 + 0.04", 0, 0.2], 0.006),
        ...grimeBox("Grime_BL", 0.05, 0.05, 0.12, ["$width / 2 - 0.04", 0, -0.2], 0.006),
        ...grimeBox("Grime_BR", 0.05, 0.05, 0.12, ["-$width / 2 + 0.04", 0, -0.2], 0.006),
      ];
    case "residential":
      return [
        group("Post", [
          box("Upright", [0.09, "$height - $width * 1.1", 0.09], { anchor: "bottom", bevel: 0.008, material: "weathered_wood" }),
          boardZ("Bracket", ["$width + 0.04", 0.04, "$length * 0.7"], { at: [0, "$height - $width * 1.1", 0], anchor: "bottom", bevel: 0.006, material: "weathered_wood" }),
          box("Brace", [0.05, 0.3, 0.05], { at: [0, "$height - $width * 1.1 - 0.12", "-0.1"], rotate: [-35, 0, 0], bevel: 0.006, material: "weathered_wood" }),
        ]),
        group("Body", [
          box("Shell", ["$width", "$width * 0.6", "$length"], { at: [0, "$base", 0], anchor: "bottom", bevel: 0.006 }),
          cyl("Roof", "$width / 2", "$length", { axis: "z", at: [0, "$base + $width * 0.6", 0], segments: 24 }),
          box("Ridge_{i}", ["$width + 0.004", 0.012, 0.012], { at: [0, "$base + 0.04", "-$length / 2 + 0.05"], repeat: { count: 4, step: [0, 0, "($length - 0.1) / 3"] } }),
        ], { vars: { base: "$height - $width * 1.1 + 0.04" } }),
        group("Door", [
          box("Panel", ["$width + 0.01", "$width * 0.6", 0.012], { at: [0, "$width * 0.3", 0.006], bevel: 0.003 }),
          cyl("Arch", "$width / 2 + 0.005", 0.012, { axis: "z", at: [0, "$width * 0.6", 0.006], segments: 24 }),
          box("Slot", ["$width * 0.5", 0.018, 0.006], { at: [0, "$width * 0.45", 0.014], material: "opening_dark" }),
          cyl("Knob", 0.014, 0.03, { axis: "z", at: [0, "$width * 0.8", 0.025], segments: 12, material: "brass" }),
        ], { at: [0, "$height - $width * 1.1 + 0.04", "$length / 2"] }),
        group("Flag", [
          box("Arm", [0.012, 0.03, 0.22], { at: [0, 0, 0], bevel: 0.003 }),
          box("Banner", [0.008, 0.08, 0.1], { at: [0, 0.04, 0.12], bevel: 0.002 }),
        ], { at: ["$width / 2 + 0.006", "$height - $width * 1.1 + 0.04 + $width * 0.45", 0], material: "paint_red" }),
        ...grimeBox("Grime", 0.09, 0.09, 0.3, [0, 0, 0], 0.008),
      ];
    case "parcel":
      return [
        group("Body", [
          box("Plinth", ["$width - 0.04", 0.08, 0.46], { anchor: "bottom", bevel: 0.008, material: "paint_black" }),
          box("Cabinet", ["$width", "$height - 0.12", 0.5], { at: [0, 0.07, 0], anchor: "bottom", bevel: 0.015 }),
          box("Canopy", ["$width + 0.06", 0.05, 0.58], { at: [0, "$height - 0.05", 0.03], anchor: "bottom", bevel: 0.01 }),
          box("Bezel", ["$width * 0.4 + 0.03", 0.19, 0.012], { at: [0, "$height - 0.32", 0.251], bevel: 0.004, material: "paint_black" }),
          box("Screen", ["$width * 0.4", 0.16, 0.01], { at: [0, "$height - 0.32", 0.257], bevel: 0.003, material: "screen_cyan" }),
          box("ScreenLine_{i}", ["$width * 0.28", 0.012, 0.004], { at: [0, "$height - 0.28", 0.263], repeat: { count: 4, step: [0, -0.027, 0] }, material: "paint_white" }),
          box("Keypad", ["$width * 0.25", 0.1, 0.02], { at: [0, "$height - 0.47", 0.255], bevel: 0.004, material: "paint_black" }),
          box("Key_{i}", [0.022, 0.016, 0.006], { at: ["-$width * 0.25 / 2 + 0.03", "$height - 0.45", 0.267], repeat: { count: 3, step: [0.04, 0, 0] }, material: "paint_white" }),
        ]),
        group("Slot", [
          box("Mouth", ["$width * 0.55", 0.03, 0.02], { material: "opening_dark" }),
          box("Lip", ["$width * 0.6", 0.015, 0.03], { at: [0, 0.025, 0.006], bevel: 0.004, material: "brushed_steel" }),
        ], { at: [0, "$height - 0.15", 0.25] }),
        door(["-$width / 2 + 0.03", 0.14, 0.255], "$width - 0.06", "$height - 0.75", [box("Handle", [0.03, 0.18, 0.03], { at: ["$width / 2 - 0.03", "($height - 0.75) / 2", 0.02], bevel: 0.008, material: "brushed_steel" })]),
        ...grimeBox("Grime", "$width", 0.5, 0.18, [0, 0.07, 0], 0.015),
      ];
    case "post-mounted":
      return [
        group("Post", [
          cyl("Pipe", 0.04, "$height - 0.5", { anchor: "base", segments: 16, material: "galvanised" }),
          cyl("Collar", 0.06, 0.04, { at: [0, 0.02, 0], segments: 16, material: "galvanised" }),
        ]),
        group("Body", [
          box("Shell", ["$width", 0.38, 0.32], { at: [0, "$height - 0.56", 0], anchor: "bottom", bevel: 0.012 }),
          cyl("Hood", 0.16, "$width", { axis: "x", at: [0, "$height - 0.18", 0], segments: 24, bevel: 0.01 }),
          cyl("Badge", 0.06, 0.008, { axis: "z", at: [0, "$height - 0.28", 0.161], segments: 20, material: "paint_black" }),
        ]),
        group("Slot", [
          box("Mouth", ["$width * 0.6", 0.03, 0.02], { material: "opening_dark" }),
          box("Flap", ["$width * 0.66", 0.05, 0.015], { at: [0, 0.035, 0.012], rotate: [-20, 0, 0], bevel: 0.004 }),
        ], { at: [0, "$height - 0.13", 0.13] }),
        door(["-$width / 2 + 0.03", "$height - 0.54", 0.163], "$width - 0.06", "0.2"),
        ...grimeProfile("Grime", [[0.06, 0.001], [0.06, 0.04], [0.04, 0.045], [0.04, 0.3]], { segments: 16 }),
      ];
  }
}

function params(style: Style) {
  switch (style) {
    case "pillar":
      return [num("height", 1.4, 1.2, 1.5, "Height of the pillar box in metres."), num("r", 0.25, 0.2, 0.3, "Radius of the body in metres.")];
    case "collection":
      return [num("height", 1.3, 1.1, 1.45, "Height of the box in metres."), num("width", 0.5, 0.42, 0.58, "Width along x in metres.")];
    case "residential":
      return [num("height", 1.2, 1.0, 1.35, "Height of the mailbox top above the ground in metres."), num("width", 0.2, 0.16, 0.26, "Width of the box in metres."), num("length", 0.48, 0.4, 0.58, "Length of the box along z in metres.")];
    case "parcel":
      return [num("height", 1.4, 1.2, 1.5, "Height of the cabinet in metres."), num("width", 0.5, 0.4, 0.6, "Width along x in metres.")];
    case "post-mounted":
      return [num("height", 1.3, 1.1, 1.45, "Height of the box top above the ground in metres."), num("width", 0.4, 0.3, 0.5, "Width of the box along x in metres.")];
  }
}

function makeMailbox(style: Style, body: string): AssetDraft {
  const s = STYLES[style];
  const b = nice(body);
  return {
    slug: slugify("mailbox", style, body.replace(/^(paint|pillar|postal)_/, "")),
    title: up(`${b} ${s.title}`),
    description: `A ${b} ${s.title}: ${s.text}. It faces +z.`,
    tags: [style, b, "brievenbus", "postbus", "post box", "letter box", ...(style === "parcel" ? ["pakketbus", "parcel"] : [])],
    params: params(style),
    materials: { ...useMats(body, "opening_dark", "brass", "steel", "paint_white", "paint_black", "paint_red", "weathered_wood", "galvanised", "brushed_steel", "screen_cyan"), ...GRIME(style === "residential" ? "weathered_wood" : style === "post-mounted" ? "galvanised" : body) },
    nodes: [group("Mailbox", nodes(style, body), { material: body })],
  };
}

export const mailbox: Family = {
  id: "mailbox",
  category: "street",
  archetype: "prop.mailbox",
  tags: ["mailbox", "post box", "letter box", "postbox", "brievenbus", "postbus", "street furniture", "straatmeubilair"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f) => makeMailbox(style, f))),
};
