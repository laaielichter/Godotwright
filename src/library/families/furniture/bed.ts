import { box, combos, cyl, ellipsoid, group, lathe, num, slugify, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { fmats } from "./parts.js";

const STYLES = ["platform", "panel", "upholstered", "iron"] as const;
type Style = (typeof STYLES)[number];
const SIZES = ["single", "double"] as const;
type Size = (typeof SIZES)[number];

/** frame: wood, fabric or metal of the bed; bedding: the duvet. */
interface Finish { frame: string; bedding: string; wood: string }
const FINISHES: Record<Style, Finish[]> = {
  platform: [{ frame: "walnut", bedding: "wool_grey", wood: "walnut" }, { frame: "light_oak", bedding: "fabric_terracotta", wood: "light_oak" }],
  panel: [{ frame: "pine", bedding: "wool_grey", wood: "pine" }, { frame: "cherry", bedding: "velvet_red", wood: "cherry" }],
  upholstered: [{ frame: "velvet_blue", bedding: "fabric_cream", wood: "dark_stain" }, { frame: "wool_charcoal", bedding: "fabric_mustard", wood: "oak" }],
  iron: [{ frame: "cast_iron", bedding: "velvet_green", wood: "pine" }, { frame: "paint_white", bedding: "fabric_teal", wood: "birch" }],
};

/** Mattress, duvet and pillows, lying on a deck whose top is at $dk. */
function bedding(f: Finish, size: Size): SpecNode[] {
  const pillows = size === "double"
    ? [ellipsoid("Pillow_L", ["$W * 0.21", 0.07, 0.19], { at: ["$W / 4", "$mt / 2 + 0.05", "-$L / 2 + 0.26"], segments: 16, material: "fabric_white", mirror: "Pillow_R" })]
    : [ellipsoid("Pillow", ["$W * 0.36", 0.07, 0.19], { at: [0, "$mt / 2 + 0.05", "-$L / 2 + 0.26"], segments: 16, material: "fabric_white" })];
  return [
    box("Mattress", ["$W", "$mt", "$L"], { at: [0, "$dk + $mt / 2", 0], bevel: 0.04, material: "mattress_ticking", children: [
      box("Duvet", ["$W + 0.05", "$mt * 0.55 + 0.05", "$L * 0.7"], { at: [0, "$mt * 0.5 - ($mt * 0.55 + 0.05) / 2 + 0.035", "$L * 0.15 + 0.01"], bevel: 0.03, material: f.bedding, children: [
        box("Fold", ["$W + 0.06", 0.05, 0.22], { at: [0, "($mt * 0.55 + 0.05) / 2 + 0.005", "-$L * 0.35 + 0.1"], bevel: 0.024, material: "fabric_white" }),
      ] }),
      ...pillows,
    ] }),
  ];
}

function platform(f: Finish, size: Size): SpecNode[] {
  return [
    group("Frame", [
      box("Plinth", ["$W - 0.1", 0.09, "$L - 0.1"], { at: [0, 0, 0], anchor: "bottom", material: "paint_anthracite" }),
      box("Base", ["$W + 0.12", "$dk - 0.085", "$L + 0.1"], { at: [0, 0.085, 0.01], anchor: "bottom", bevel: 0.012 }),
      box("Bench", ["$W + 0.12", 0.03, 0.14], { at: [0, "$dk - 0.015", "$L / 2 - 0.02"], bevel: 0.008 }),
    ]),
    box("Headboard", ["$W + 0.5", "$hb - 0.085", 0.06], { at: [0, 0.085, "-$L / 2 - 0.07"], anchor: "bottom", bevel: 0.01, children: [
      box("Panel_{i}", ["($W + 0.46) / 3 - 0.01", "$hb - $dk - 0.08", 0.02], { at: ["-($W + 0.46) / 3", "$dk - 0.05", 0.035], anchor: "bottom", repeat: { count: 3, step: ["($W + 0.46) / 3", 0, 0] }, bevel: 0.006, material: "paint_anthracite" }),
      box("Shelf_L", [0.22, 0.025, 0.3], { at: ["$W / 2 + 0.13", "$dk - 0.07", 0.17], bevel: 0.005, mirror: "Shelf_R" }),
    ] }),
    ...bedding(f, size),
  ];
}

function panel(f: Finish, size: Size): SpecNode[] {
  const post = (name: string, z: string, h: string, mirror: string): SpecNode =>
    box(name, [0.065, h, 0.065], { at: ["$W / 2 + 0.03", 0, z], anchor: "bottom", bevel: 0.008, mirror, children: [
      lathe("Finial", [[0.022, 0], [0.03, 0.01], [0.034, 0.03], [0.02, 0.05], [0.026, 0.065], [0.006, 0.08]], { at: [0, h, 0], segments: 14 }),
    ] });
  const board = (name: string, z: string, top: string): SpecNode =>
    group(name, [
      box("Crest", ["$W + 0.02", 0.08, 0.04], { at: [0, `${top} - 0.06`, 0], bevel: 0.01 }),
      box("Lower", ["$W + 0.02", 0.07, 0.035], { at: [0, "$dk - 0.07", 0], bevel: 0.006 }),
      box("Panel_{i}", ["$W / $np - 0.06", `${top} - $dk - 0.06`, 0.018], { at: ["-$W / 2 + $W / $np / 2", "$dk - 0.04", 0], anchor: "bottom", repeat: { count: "$np", step: ["$W / $np", 0, 0] }, bevel: 0.004 }),
      box("Muntin_{i}", [0.045, `${top} - $dk - 0.05`, 0.03], { at: ["-$W / 2 + $W / $np", "$dk - 0.045", 0], anchor: "bottom", repeat: { count: "$np - 1", step: ["$W / $np", 0, 0] }, bevel: 0.005 }),
    ], { at: [0, 0, z], vars: { np: size === "double" ? 3 : 2 } });
  return [
    group("Frame", [
      box("Side_Rail_L", [0.035, 0.16, "$L + 0.02"], { at: ["$W / 2 + 0.03", "$dk - 0.06", 0], bevel: 0.006, mirror: "Side_Rail_R" }),
      box("Deck", ["$W + 0.03", 0.02, "$L"], { at: [0, "$dk - 0.01", 0], material: "rough_timber" }),
    ]),
    group("Legs", [
      post("Leg_HL", "-$L / 2 - 0.03", "$hb - 0.08", "Leg_HR"),
      post("Leg_FL", "$L / 2 + 0.03", "$fb - 0.08", "Leg_FR"),
    ]),
    board("Headboard", "-$L / 2 - 0.03", "$hb - 0.08"),
    board("Footboard", "$L / 2 + 0.03", "$fb - 0.08"),
    ...bedding(f, size),
  ];
}

function upholstered(f: Finish, size: Size): SpecNode[] {
  const legs = [
    lathe("Leg_FL", [[0.018, 0], [0.022, 0.01], [0.028, 0.105]], { at: ["$W / 2 + 0.02", 0, "$L / 2 - 0.02"], segments: 12, mirror: "Leg_FR", material: f.wood }),
    lathe("Leg_BL", [[0.018, 0], [0.022, 0.01], [0.028, 0.105]], { at: ["$W / 2 + 0.02", 0, "-$L / 2 + 0.06"], segments: 12, mirror: "Leg_BR", material: f.wood }),
    ...(size === "double" ? [lathe("Leg_ML", [[0.018, 0], [0.022, 0.01], [0.028, 0.105]], { at: ["$W / 2 + 0.02", 0, 0], segments: 12, mirror: "Leg_MR", material: f.wood })] : []),
  ];
  return [
    group("Frame", [
      box("Base", ["$W + 0.1", "$dk + 0.05 - 0.1", "$L + 0.06"], { at: [0, 0.1, 0.01], anchor: "bottom", bevel: 0.03 }),
      box("Welt", ["$W + 0.11", 0.012, "$L + 0.07"], { at: [0, "$dk + 0.045", 0.01], bevel: 0.005 }),
    ]),
    group("Legs", legs),
    box("Headboard", ["$W + 0.16", "$hb - 0.1", 0.11], { at: [0, 0.1, "-$L / 2 - 0.07"], anchor: "bottom", bevel: 0.045, children: [
      ellipsoid("Button_{i}", [0.012, 0.012, 0.008], { at: ["-($nb - 1) * 0.16 / 2", "$hb - 0.25", 0.056], repeat: { count: "$nb", step: [0.16, 0, 0] }, segments: 8, children: [] }),
      ellipsoid("Lower_Button_{i}", [0.012, 0.012, 0.008], { at: ["-($nb - 2) * 0.16 / 2", "$hb - 0.4", 0.056], repeat: { count: "$nb - 1", step: [0.16, 0, 0] }, segments: 8 }),
      box("Piping", ["$W + 0.17", 0.016, 0.12], { at: [0, "$hb - 0.105", 0], bevel: 0.008 }),
    ], vars: { nb: "floor(($W + 0.04) / 0.16)" } }),
    ...bedding(f, size),
  ];
}

function iron(f: Finish, size: Size): SpecNode[] {
  const end = (name: string, z: string, top: string): SpecNode =>
    group(name, [
      cyl("Top_Bar", 0.014, "$W + 0.08", { axis: "x", at: [0, `${top} - 0.06`, 0], segments: 12 }),
      cyl("Mid_Bar", 0.011, "$W + 0.08", { axis: "x", at: [0, "$dk + 0.02", 0], segments: 12 }),
      cyl("Spindle_{i}", 0.007, `${top} - 0.06 - $dk - 0.02`, { at: ["-($ns - 1) * 0.12 / 2", `(${top} - 0.06 + $dk + 0.02) / 2`, 0], repeat: { count: "$ns", step: [0.12, 0, 0] }, segments: 8 }),
      lathe("Medallion", [[0.004, -0.004], [0.05, -0.004], [0.05, 0.004], [0.004, 0.004]], { at: [0, `(${top} + $dk) / 2`, 0], rotate: [90, 0, 0], segments: 18, material: "brass" }),
    ], { at: [0, 0, z], vars: { ns: "floor(($W - 0.04) / 0.12)" } });
  const post = (name: string, z: string, h: string, mirror: string): SpecNode =>
    cyl(name, 0.02, h, { at: ["$W / 2 + 0.04", 0, z], anchor: "base", segments: 14, mirror, children: [
      ellipsoid("Finial", [0.032, 0.032, 0.032], { at: [0, `${h} + 0.025`, 0], segments: 14, material: "brass" }),
      cyl("Caster", 0.024, 0.02, { at: [0, 0.01, 0], segments: 12, material: "rubber" }),
    ] });
  return [
    group("Frame", [
      box("Side_Rail_L", [0.04, 0.04, "$L + 0.06"], { at: ["$W / 2 + 0.03", "$dk - 0.02", 0], bevel: 0.003, mirror: "Side_Rail_R" }),
      box("Deck", ["$W + 0.04", 0.02, "$L"], { at: [0, "$dk - 0.01", 0], material: f.wood }),
    ]),
    group("Legs", [
      post("Leg_HL", "-$L / 2 - 0.03", "$hb - 0.06", "Leg_HR"),
      post("Leg_FL", "$L / 2 + 0.03", "$fb - 0.06", "Leg_FR"),
    ]),
    end("Headboard", "-$L / 2 - 0.03", "$hb"),
    end("Footboard", "$L / 2 + 0.03", "$fb"),
    ...bedding(f, size),
  ];
}

const TEXT: Record<Style, string> = {
  platform: "A low modern platform bed: a solid base on a recessed plinth, a wide headboard with inset panels and bedside shelves, and a bench ledge at the foot",
  panel: "A classic wooden panel bed with four square posts and turned finials, a panelled headboard and lower footboard and side rails",
  upholstered: "An upholstered bed with a padded, button-tufted headboard, a fabric-covered base with welted edge and short wooden legs",
  iron: "A cast iron bed with round posts topped by brass balls, spindled head and foot ends with a medallion and side rails",
};

function makeBed(style: Style, size: Size, f: Finish): AssetDraft {
  const single = size === "single";
  const frame = label(f.frame);
  const bedName = label(f.bedding);
  return {
    slug: slugify("bed", style, size, f.frame.replace(/^(paint|velvet|wool)_/, "")),
    title: `${cap(frame)} ${style} ${size} bed`,
    description: `${TEXT[style]}, in ${frame}, made up with a mattress, a ${bedName} duvet and ${single ? "a pillow" : "two pillows"}. The headboard is at -z and the foot faces +z.`,
    tags: [style, size, f.frame.replace(/^(paint|velvet|wool)_/, ""), single ? "eenpersoonsbed" : "tweepersoonsbed", single ? "single bed" : "double bed", "slaapkamer", "bedroom"],
    params: [
      single ? num("width", 0.9, 0.8, 1.0, "Width of the mattress along x in metres.") : num("width", 1.6, 1.4, 1.8, "Width of the mattress along x in metres."),
      num("length", 2.0, 1.9, 2.1, "Length of the mattress along z in metres."),
      num("headboardHeight", style === "platform" ? 0.9 : style === "upholstered" ? 1.15 : 1.1, 0.8, 1.3, "Height of the top of the headboard above the floor."),
      num("mattressThickness", 0.2, 0.14, 0.26, "Thickness of the mattress."),
    ],
    materials: {
      ...fmats(...new Set([f.frame, f.bedding, f.wood, "paint_anthracite", "rough_timber", "brass", "rubber"])),
      mattress_ticking: { color: [0.44, 0.42, 0.38], metallic: 0, roughness: 0.92, texture: "fabric" },
      fabric_white: { color: [0.5, 0.49, 0.46], metallic: 0, roughness: 0.95, texture: "fabric" },
    },
    nodes: [group("Bed", { platform, panel, upholstered, iron }[style](f, size), {
      material: f.frame,
      vars: { W: "$width", L: "$length", hb: "$headboardHeight", mt: "$mattressThickness", dk: style === "platform" ? 0.3 : style === "upholstered" ? 0.35 : 0.4, fb: style === "panel" ? 0.7 : 0.85 },
    })],
  };
}

export const bed: Family = {
  id: "bed",
  category: "furniture",
  archetype: "prop.bed",
  tags: ["bed", "bedden", "slaapkamer", "bedroom", "furniture", "meubel"],
  assets: () =>
    combos({ style: STYLES, k: [0, 1] as const, size: SIZES })
      .filter(({ style, k, size }) => !(style === "iron" && k === 1 && size === "double") && !(style === "platform" && k === 1 && size === "single"))
      .map(({ style, k, size }) => makeBed(style, size, FINISHES[style][k] as Finish)),
};
