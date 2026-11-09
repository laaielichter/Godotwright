import { box, combos, cyl, ellipsoid, group, lathe, loft, num, slugify, tube, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { board, fmats, pillow, shade, tufting } from "./parts.js";

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

const r4 = (v: number): number => Math.round(v * 10000) / 10000;

/**
 * The draped section of the duvet (or of its turned-back top), across x, in mattress-local coordinates: it lies on the
 * mattress top ($mt / 2) and hangs `hang` down both sides with a soft rounded edge. `lift` raises it off the mattress (a
 * layer on top of the duvet), `t` is its thickness and `s` (0-1) thins it toward a rounded end.
 */
function drape(lift: number, t: number, s: number, hang: string): (string | number)[][] {
  const ri = 0.04 + lift;
  const xi = `$W / 2 + 0.006 + ${lift}`;
  const cx = `$W / 2 + 0.006 - 0.04`;
  const cy = `$mt / 2 + 0.002 - 0.04`;
  const yb = `$mt / 2 - (${hang}) * ${r4(0.6 + 0.4 * s)}`;
  const th = r4(t * s);
  const arc = (R: number, from: number, to: number, side: number): (string | number)[][] =>
    Array.from({ length: 5 }, (_, k) => {
      const a = ((from + ((to - from) * k) / 4) * Math.PI) / 180;
      return [`${side > 0 ? "" : "-"}(${cx} + ${r4(R * Math.cos(a))})`, `${cy} + ${r4(R * Math.sin(a))}`];
    });
  const dome = r4(0.012 * s);
  return [
    [`${xi} + ${th}`, `${yb} + 0.012`],
    ...arc(ri + th, 0, 90, 1),
    [0, `${cy} + ${r4(ri + th + dome)}`],
    ...arc(ri + th, 90, 0, -1),
    [`-(${xi} + ${th})`, `${yb} + 0.012`],
    [`-(${xi} + ${r4(th / 2)})`, `${yb}`],
    [`-(${xi})`, `${yb} + 0.012`],
    ...arc(ri, 0, 90, -1),
    ...arc(ri, 90, 0, 1),
    [`${xi}`, `${yb} + 0.012`],
    [`${xi} + ${r4(th / 2)}`, `${yb}`],
  ];
}

/** Mattress, duvet and pillows, lying on a deck whose top is at $dk. */
function bedding(f: Finish, size: Size): SpecNode[] {
  const T = 0.034;
  const hang = "$mt * 0.62";
  const zh = "-$L / 2 + 0.44";
  const zf = "$L / 2 + 0.025";
  const sec = (z: string, lift: number, t: number, s: number, h = hang) => ({ z, points: drape(lift, t, s, h) });
  const quilt = `${f.bedding}_tuft`;
  const pillows = size === "double"
    ? [pillow("Pillow_L", "$W * 0.43", 0.21, 0.07, "fabric_white", { at: ["$W / 4 + 0.005", "$mt / 2 - 0.012", "-$L / 2 + 0.25"], rotate: [9, 0, 0], mirror: "Pillow_R" })]
    : [pillow("Pillow", "$W * 0.74", 0.21, 0.07, "fabric_white", { at: [0, "$mt / 2 - 0.012", "-$L / 2 + 0.25"], rotate: [9, 0, 0] })];
  // A quilting line over the duvet from side to side, following its rounded edge and the dome of its top.
  const yTop = `$mt / 2 + 0.002 + ${T}`;
  const R = 0.04 + T + 0.0008;
  const arcPts = (side: number): [string, string, number][] => Array.from({ length: 5 }, (_, k) => {
    const a = ((side < 0 ? 180 - 90 * (k / 4) : 90 - 90 * (k / 4)) * Math.PI) / 180;
    return [`${side} * ($W / 2 - 0.034) + ${r4(R * Math.cos(a))}`, `$mt / 2 - 0.038 + ${r4(R * Math.sin(a))}`, 0];
  });
  const across: [string | number, string | number, number][] = [
    [`-($W / 2 + 0.006 + ${r4(T + 0.0008)})`, `$mt / 2 - (${hang}) + 0.05`, 0],
    ...arcPts(-1),
    [0, `${yTop} + 0.0128`, 0],
    ...arcPts(1),
    [`$W / 2 + 0.006 + ${r4(T + 0.0008)}`, `$mt / 2 - (${hang}) + 0.05`, 0],
  ];
  return [
    box("Mattress", ["$W", "$mt", "$L"], { at: [0, "$dk + $mt / 2", 0], bevel: 0.04, material: "mattress_ticking", children: [
      loft("Duvet", [
        sec(`${zh} - 0.002`, 0, T, 0.35),
        sec(`${zh} + 0.012`, 0, T, 0.85),
        sec(`${zh} + 0.03`, 0, T, 1),
        sec(`${zf} - 0.035`, 0, T, 1),
        sec(`${zf} - 0.012`, 0, T, 0.8),
        sec(`${zf}`, 0, T, 0.35),
      ], { material: f.bedding, children: [
        tube("Quilting_{i}", across, 0.0032, { at: [0, 0, `${zh} + 0.5`], repeat: { count: "floor(($L - 1) / 0.26) + 1", step: [0, 0, 0.26] }, segments: 6, material: quilt }),
        ...[-1, 1].map((sx) => tube(sx < 0 ? "Quilting_Long_R" : "Quilting_Long_L", [[`${sx} * $W / 6`, `${yTop} + 0.0088`, `${zh} + 0.34`], [`${sx} * $W / 6`, `${yTop} + 0.0088`, `${zf} - 0.05`]], 0.0032, { segments: 6, material: quilt })),
      ] }),
      loft("Fold", [
        sec(`${zh} - 0.018`, T - 0.004, T, 0.3, "$mt * 0.5"),
        sec(`${zh} - 0.004`, T - 0.004, T, 0.85, "$mt * 0.5"),
        sec(`${zh} + 0.02`, T - 0.004, T, 1, "$mt * 0.5"),
        sec(`${zh} + 0.24`, T - 0.004, T, 1, "$mt * 0.5"),
        sec(`${zh} + 0.27`, T - 0.004, T, 0.6, "$mt * 0.5"),
        sec(`${zh} + 0.28`, T - 0.004, T, 0.3, "$mt * 0.5"),
      ], { material: "fabric_white" }),
      ...pillows,
    ] }),
  ];
}

function platform(f: Finish, size: Size): SpecNode[] {
  return [
    group("Frame", [
      box("Plinth", ["$W - 0.1", 0.09, "$L - 0.1"], { at: [0, 0, 0], anchor: "bottom", material: "paint_anthracite" }),
      box("Base", ["$W + 0.12", "$dk - 0.085", "$L + 0.1"], { at: [0, 0.085, 0.01], anchor: "bottom", bevel: 0.012 }),
      board("Bench", ["$W + 0.12", 0.03, 0.14], "x", { at: [0, "$dk - 0.015", "$L / 2 - 0.02"], bevel: 0.008 }),
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
  const endBoard = (name: string, z: string, top: string): SpecNode =>
    group(name, [
      board("Crest", ["$W + 0.02", 0.08, 0.04], "x", { at: [0, `${top} - 0.06`, 0], bevel: 0.01 }),
      board("Lower", ["$W + 0.02", 0.07, 0.035], "x", { at: [0, "$dk - 0.07", 0], bevel: 0.006 }),
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
    endBoard("Headboard", "-$L / 2 - 0.03", "$hb - 0.08"),
    endBoard("Footboard", "$L / 2 + 0.03", "$fb - 0.08"),
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
      tufting("Tufting", f.frame, "$nb", 3, 0.16, 0.12, { at: [0, "$hb - 0.47", 0.055] }),
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
      fabric_white_tuft: { color: [0.3, 0.29, 0.27], metallic: 0, roughness: 0.95, texture: "fabric" },
      ...shade(f.bedding, 0.66),
      ...(style === "upholstered" ? shade(f.frame) : {}),
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
