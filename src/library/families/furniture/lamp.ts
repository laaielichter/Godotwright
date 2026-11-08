import { box, combos, cyl, ellipsoid, group, lathe, num, roof, slugify, tube, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label, mats } from "../../palette.js";
import { ring, shell } from "./parts.js";

const STYLES = ["floor", "table", "desk", "lantern"] as const;
type Style = (typeof STYLES)[number];

/** metal: base or frame; shade: shade material; form: the shade's outline. */
interface Finish { metal: string; shade: string; form: "drum" | "taper" | "dome" | "bell" }
const FINISHES: Record<Style, Finish[]> = {
  floor: [
    { metal: "brass", shade: "linen", form: "drum" },
    { metal: "black_steel", shade: "fabric_cream", form: "taper" },
    { metal: "chrome", shade: "paint_white", form: "dome" },
    { metal: "bronze", shade: "fabric_mustard", form: "bell" },
  ],
  table: [
    { metal: "ceramic_blue", shade: "linen", form: "taper" },
    { metal: "ceramic_celadon", shade: "fabric_cream", form: "drum" },
    { metal: "ceramic_ochre", shade: "linen", form: "bell" },
    { metal: "glass_amber", shade: "fabric_cream", form: "taper" },
  ],
  desk: [
    { metal: "paint_black", shade: "paint_black", form: "dome" },
    { metal: "paint_red", shade: "paint_red", form: "taper" },
    { metal: "paint_white", shade: "paint_white", form: "dome" },
    { metal: "brushed_steel", shade: "brushed_steel", form: "bell" },
  ],
  lantern: [
    { metal: "black_steel", shade: "glass_clear", form: "drum" },
    { metal: "brass", shade: "glass_clear", form: "drum" },
    { metal: "aged_copper", shade: "glass_frosted", form: "drum" },
    { metal: "galvanised", shade: "glass_clear", form: "drum" },
  ],
};

/** A hollow shade from y = $y0 (bottom rim) up $hs high, radius $rs at the bottom; walls 4 mm thick. */
function shade(form: Finish["form"], material: string): SpecNode {
  const p: [string, string][] =
    form === "drum" ? [["$rs", "0"], ["$rs", "$hs"]]
      : form === "taper" ? [["$rs", "0"], ["$rs * 0.82", "$hs * 0.5"], ["$rs * 0.62", "$hs"]]
        : form === "bell" ? [["$rs", "0"], ["$rs * 0.94", "$hs * 0.12"], ["$rs * 0.68", "$hs * 0.45"], ["$rs * 0.52", "$hs * 0.8"], ["$rs * 0.42", "$hs"]]
          : [["$rs", "0"], ["$rs * 0.96", "$hs * 0.25"], ["$rs * 0.82", "$hs * 0.55"], ["$rs * 0.55", "$hs * 0.85"], ["$rs * 0.2", "$hs"]];
  return group("Shade", [
    shell("Shell", p, 0.004, { segments: 32 }),
    ring("Rim", "$rs - 0.002", 0.004, 0, { segments: 32, sides: 6, material: "brass" }),
  ], { at: [0, "$y0", 0], material });
}

/** A warm bulb on its socket, the bulb's centre at $by. */
const bulb = (): SpecNode[] => [
  cyl("Socket", 0.016, 0.045, { at: [0, "$by - 0.05", 0], segments: 14, material: "brass" }),
  lathe("Bulb", [[0.012, 0], [0.014, 0.012], [0.028, 0.035], [0.032, 0.055], [0.024, 0.075], [0.006, 0.084]], { at: [0, "$by - 0.035", 0], segments: 16, material: "bulb_warm" }),
];

function floor(f: Finish): SpecNode[] {
  return [
    lathe("Base", [[0.006, 0], ["$rb", 0], ["$rb + 0.004", 0.006], ["$rb - 0.01", 0.022], ["$rb * 0.5", 0.04], [0.025, 0.05], [0.006, 0.052]], { segments: 32, material: f.metal }),
    cyl("Stem", 0.012, "$by - 0.06", { at: [0, 0.045, 0], anchor: "base", segments: 14, material: f.metal, children: [
      cyl("Switch", 0.018, 0.04, { at: [0, "$by * 0.45", 0], segments: 12, material: "plastic_black" }),
      cyl("Collar", 0.02, 0.025, { at: [0, 0.02, 0], segments: 14 }),
    ] }),
    tube("Harp", [["-$rs * 0.6", "$y0 + $hs * 0.55", 0], [0, "$by - 0.06", 0], ["$rs * 0.6", "$y0 + $hs * 0.55", 0]], 0.004, { segments: 8, material: f.metal }),
    ...bulb(),
    shade(f.form, f.shade),
  ];
}

function table(f: Finish): SpecNode[] {
  return [
    box("Plinth", ["$rv * 2 + 0.03", 0.03, "$rv * 2 + 0.03"], { at: [0, 0, 0], anchor: "bottom", bevel: 0.008, material: "walnut" }),
    lathe("Base", [[0.006, 0.028], ["$rv * 0.6", 0.028], ["$rv * 0.9", "$hv * 0.25"], ["$rv", "$hv * 0.5"], ["$rv * 0.85", "$hv * 0.78"], ["$rv * 0.4", "$hv * 0.93"], ["$rv * 0.35", "$hv"], [0.006, "$hv + 0.002"]], { segments: 28, material: f.metal }),
    cyl("Stem", 0.008, "$by - $hv - 0.05", { at: [0, "$hv - 0.004", 0], anchor: "base", segments: 12, material: "brass", children: [
      cyl("Neck", 0.022, 0.025, { at: [0, 0.01, 0], segments: 14 }),
    ] }),
    tube("Harp", [["-$rs * 0.5", "$y0 + $hs * 0.6", 0], [0, "$by - 0.055", 0], ["$rs * 0.5", "$y0 + $hs * 0.6", 0]], 0.003, { segments: 8, material: "brass" }),
    ...bulb(),
    shade(f.form, f.shade),
    ellipsoid("Finial", [0.012, 0.016, 0.012], { at: [0, "$y0 + $hs * 0.6 + 0.012", 0], segments: 10, material: "brass" }),
  ];
}

function desk(f: Finish): SpecNode[] {
  return [
    lathe("Base", [[0.006, 0], ["$rb", 0], ["$rb", 0.018], ["$rb - 0.012", 0.03], [0.03, 0.036], [0.006, 0.037]], { segments: 28, material: f.metal }),
    ellipsoid("Joint_Base", [0.022, 0.022, 0.022], { at: [0, 0.045, "-$rb * 0.4"], segments: 12, material: "chrome" }),
    tube("Arm_Lower", [[0, 0.045, "-$rb * 0.4"], [0, "0.045 + $al * 0.94", "-$rb * 0.4 - $al * 0.34"]], 0.011, { segments: 10, material: f.metal }),
    tube("Spring", [[0.02, 0.07, "-$rb * 0.4"], [0.02, "0.045 + $al * 0.8", "-$rb * 0.4 - $al * 0.28"]], 0.005, { segments: 6, material: "chrome" }),
    ellipsoid("Joint_Elbow", [0.02, 0.02, 0.02], { at: [0, "0.045 + $al * 0.94", "-$rb * 0.4 - $al * 0.34"], segments: 12, material: "chrome" }),
    tube("Arm_Upper", [[0, "0.045 + $al * 0.94", "-$rb * 0.4 - $al * 0.34"], [0, "0.045 + $al * 1.12", "-$rb * 0.4 - $al * 0.34 + $al * 0.95"]], 0.01, { segments: 10, material: f.metal }),
    group("Head", [
      ellipsoid("Joint_Head", [0.018, 0.018, 0.018], { segments: 12, material: "chrome" }),
      group("Shade", [
        shell("Shell", (f.form === "dome"
          ? [["$rs", "-$hs"], ["$rs * 0.92", "-$hs * 0.7"], ["$rs * 0.6", "-$hs * 0.3"], ["$rs * 0.3", "-0.005"]]
          : f.form === "bell" ? [["$rs", "-$hs"], ["$rs * 0.7", "-$hs * 0.6"], ["$rs * 0.4", "-$hs * 0.25"], ["$rs * 0.32", "-0.005"]]
            : [["$rs", "-$hs"], ["$rs * 0.35", "-0.005"]]) as [string, string][], 0.003, { segments: 28 }),
        cyl("Cap", "$rs * 0.32", 0.03, { at: [0, 0.008, 0], segments: 20 }),
      ], { material: f.shade }),
      lathe("Bulb", [[0.008, -0.004], [0.022, -0.03], [0.02, -0.05], [0.004, -0.056]], { segments: 14, material: "bulb_warm" }),
    ], { at: [0, "0.045 + $al * 1.12", "-$rb * 0.4 + $al * 0.61"], rotate: [-35, 0, 0] }),
  ];
}

function lantern(f: Finish): SpecNode[] {
  const pane = (name: string, rotY: number): SpecNode =>
    box(name, ["$lw - 0.03", "$lh - 0.11", 0.004], { at: [0, "0.035 + ($lh - 0.11) / 2", 0], offset: [0, 0, "$lw / 2 - 0.006"], rotate: [0, rotY, 0], material: f.shade });
  return [
    box("Base", ["$lw + 0.02", 0.035, "$lw + 0.02"], { at: [0, 0, 0], anchor: "bottom", bevel: 0.006, material: f.metal }),
    group("Frame", [
      cyl("Post_{i}", 0.007, "$lh - 0.1", { at: ["$lw / 2 - 0.006", "0.03 + ($lh - 0.1) / 2", "$lw / 2 - 0.006"], repeat: { count: 4, around: "y" }, segments: 8 }),
      box("Band", ["$lw + 0.006", 0.012, "$lw + 0.006"], { at: [0, "$lh * 0.45", 0], bevel: 0.002 }),
    ], { material: f.metal }),
    pane("Glass_F", 0), pane("Glass_L", 90), pane("Glass_B", 180), pane("Glass_R", 270),
    box("Cap", ["$lw + 0.024", 0.025, "$lw + 0.024"], { at: [0, "$lh - 0.07", 0], anchor: "bottom", bevel: 0.005, material: f.metal }),
    roof("Top", { x0: "-$lw / 2 - 0.01", x1: "$lw / 2 + 0.01", z0: "-$lw / 2 - 0.01", z1: "$lw / 2 + 0.01", y: "$lh - 0.046", rise: 0.05, kind: "hip" }, { material: f.metal }),
    cyl("Chimney", 0.014, 0.02, { at: [0, "$lh + 0.01", 0], segments: 12, material: f.metal }),
    ring("Handle", 0.035, 0.005, 0, { at: [0, "$lh + 0.05", 0], rotate: [90, 0, 0], segments: 20, sides: 6, material: f.metal }),
    cyl("Candle", 0.022, "$lh * 0.35", { at: [0, 0.035, 0], anchor: "base", segments: 16, material: "wax" }),
    lathe("Bulb", [[0.004, 0], [0.01, 0.012], [0.008, 0.026], [0.002, 0.04]], { at: [0, "0.035 + $lh * 0.35", 0], segments: 10, material: "flame" }),
  ];
}

const TEXT: Record<Style, string> = {
  floor: "A standing floor lamp: a weighted round base, a slim pole with an inline switch, a harp and a warm bulb under a",
  table: "A table lamp with a turned ceramic or glass base on a small wooden plinth, a brass stem and harp with a finial and a warm bulb under a",
  desk: "An articulated desk lamp: a round base, a sprung lower arm and an upper arm on ball joints, holding a tilted",
  lantern: "A square candle lantern with corner posts, four glass panes, a hipped top with a chimney and a ring handle, holding a candle with a glowing flame in",
};

const PARAMS: Record<Style, () => AssetDraft["params"]> = {
  floor: () => [num("height", 1.6, 1.35, 1.85, "Overall height in metres."), num("shadeDiameter", 0.42, 0.32, 0.52, "Diameter of the shade at its rim."), num("baseDiameter", 0.3, 0.25, 0.36, "Diameter of the round base.")],
  table: () => [num("height", 0.6, 0.45, 0.75, "Overall height in metres."), num("shadeDiameter", 0.34, 0.26, 0.42, "Diameter of the shade at its rim."), num("baseWidth", 0.18, 0.14, 0.24, "Widest diameter of the ceramic base.")],
  desk: () => [num("armLength", 0.36, 0.3, 0.44, "Length of the lower arm in metres."), num("shadeDiameter", 0.15, 0.12, 0.19, "Diameter of the shade at its rim."), num("baseDiameter", 0.17, 0.14, 0.2, "Diameter of the round base.")],
  lantern: () => [num("height", 0.4, 0.28, 0.55, "Height of the lantern body (to the top of the cap) in metres."), num("width", 0.2, 0.15, 0.28, "Width and depth of the square lantern.")],
};

const VARS: Record<Style, Record<string, string>> = {
  floor: { H: "$height", rs: "$shadeDiameter / 2", hs: "$shadeDiameter * 0.72", rb: "$baseDiameter / 2", y0: "$height - $shadeDiameter * 0.72", by: "$height - $shadeDiameter * 0.72 + $shadeDiameter * 0.3" },
  table: { H: "$height", rs: "$shadeDiameter / 2", hs: "$shadeDiameter * 0.68", rv: "$baseWidth / 2", hv: "$height * 0.48", y0: "$height - $shadeDiameter * 0.68", by: "$height - $shadeDiameter * 0.68 + $shadeDiameter * 0.28" },
  desk: { al: "$armLength", rs: "$shadeDiameter / 2", hs: "$shadeDiameter * 0.7", rb: "$baseDiameter / 2" },
  lantern: { lh: "$height", lw: "$width" },
};

function makeLamp(style: Style, f: Finish): AssetDraft {
  const metal = label(f.metal);
  const sh = label(f.shade);
  const what = style === "lantern" ? `${sh} panes` : `${f.form} shade in ${sh}`;
  return {
    slug: slugify("lamp", style, f.metal.replace(/^(paint|ceramic|glass)_/, ""), f.form, ...(style === "lantern" && f.shade !== "glass_clear" ? ["frosted"] : [])),
    title: `${cap(metal)} ${style} ${style === "lantern" ? "" : "lamp"}`.trim(),
    description: `${TEXT[style]} ${what}, with ${metal}. The bulb has an emissive material; add an OmniLight3D in Godot to light the scene. It faces +z.`,
    tags: [style, f.form, f.metal.replace(/^(paint|ceramic|glass)_/, ""), "light", "licht", "lamp", ...(style === "floor" ? ["staande lamp", "vloerlamp"] : style === "table" ? ["tafellamp", "schemerlamp"] : style === "desk" ? ["bureaulamp", "architect lamp"] : ["lantaarn", "lantern", "kaars", "candle"])],
    params: PARAMS[style](),
    materials: {
      ...mats(...new Set([f.metal, f.shade, "brass", "chrome", "bulb_warm", "plastic_black", "walnut", "flame"])),
      wax: { color: [0.85, 0.8, 0.68], metallic: 0, roughness: 0.6 },
    },
    nodes: [group("Lamp", { floor, table, desk, lantern }[style](f), { material: f.metal, vars: VARS[style] })],
  };
}

export const lamp: Family = {
  id: "lamp",
  category: "furniture",
  archetype: "prop.lamp",
  tags: ["lamp", "light", "lighting", "lamp", "verlichting", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2, 3] as const }).map(({ style, k }) => makeLamp(style, FINISHES[style][k] as Finish)),
};
