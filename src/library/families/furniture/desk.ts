import { box, combos, cyl, group, num, slugify, cap, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { label } from "../../palette.js";
import { board, barHandle, fmats, knob, squareLeg, tubular } from "./parts.js";

const STYLES = ["writing", "pedestal", "standing", "steel"] as const;
type Style = (typeof STYLES)[number];

/** top: the wood of the top; frame: legs or frame; trim: leather inlay or handle metal. */
interface Finish { top: string; frame: string; trim: string }
const FINISHES: Record<Style, Finish[]> = {
  writing: [{ top: "mahogany", frame: "mahogany", trim: "velvet_green" }, { top: "walnut", frame: "walnut", trim: "leather_black" }, { top: "cherry", frame: "cherry", trim: "leather_tan" }],
  pedestal: [{ top: "oak", frame: "oak", trim: "brass" }, { top: "paint_white", frame: "paint_white", trim: "chrome" }, { top: "dark_stain", frame: "dark_stain", trim: "brushed_steel" }],
  standing: [{ top: "birch", frame: "black_steel", trim: "plastic_black" }, { top: "walnut", frame: "paint_white", trim: "plastic_white" }, { top: "bamboo", frame: "aluminium", trim: "plastic_grey" }],
  steel: [{ top: "rough_timber", frame: "black_steel", trim: "black_steel" }, { top: "oak", frame: "gunmetal", trim: "brushed_steel" }, { top: "pine", frame: "paint_anthracite", trim: "black_steel" }],
};

const top = (f: Finish, bevel = 0.008): SpecNode => board("Top", ["$W", "$t", "$D"], "x", { at: [0, "$H - $t / 2", 0], bevel, material: f.top });

function writing(f: Finish): SpecNode[] {
  return [
    top(f),
    box("Inlay", ["$W - 0.16", 0.004, "$D - 0.16"], { at: [0, "$H + 0.001", 0], bevel: 0.0015, material: f.trim }),
    group("Aprons", [
      board("Apron_B", ["2 * $xl", 0.12, 0.022], "x", { at: [0, "$H - $t - 0.06", "-$zl"], bevel: 0.004 }),
      board("Apron_L", [0.022, 0.12, "2 * $zl"], "z", { at: ["$xl", "$H - $t - 0.06", 0], bevel: 0.004, mirror: "Apron_R" }),
      board("Apron_F", ["2 * $xl", 0.12, 0.022], "x", { at: [0, "$H - $t - 0.06", "$zl"], bevel: 0.004 }),
      group("Drawer_{i}", [
        box("Front", ["$dw - 0.012", 0.095, 0.02], { at: [0, 0, 0], bevel: 0.005 }),
        knob("Knob", [0, 0, 0.009], "brass"),
      ], { at: ["-$xl + $dw / 2", "$H - $t - 0.06", "$zl + 0.012"], repeat: { count: 3, step: ["$dw", 0, 0] } }),
    ], { vars: { dw: "2 * $xl / 3" } }),
    group("Legs", [
      squareLeg("Leg_FL", ["$xl", 0, "$zl"], "$H - $t + 0.003", 0.05, 0.03, "Leg_FR"),
      squareLeg("Leg_BL", ["$xl", 0, "-$zl"], "$H - $t + 0.003", 0.05, 0.03, "Leg_BR"),
    ]),
  ];
}

function pedestal(f: Finish): SpecNode[] {
  return [
    top(f),
    box("Pedestal", ["$pw", "$H - $t - 0.002", "$D - 0.04"], { at: ["$W / 2 - $pw / 2 - 0.01", 0, -0.01], anchor: "bottom", bevel: 0.006, children: [
      box("Kick", ["$pw - 0.04", 0.06, 0.02], { at: [0, 0.03, "($D - 0.04) / 2 - 0.02"], material: "paint_anthracite" }),
      group("Drawer_{i}", [
        box("Front", ["$pw - 0.03", "$dh - 0.008", 0.02], { bevel: 0.004 }),
        box("Reveal", ["$pw - 0.022", "$dh", 0.004], { at: [0, 0, -0.012], material: "reveal" }),
        barHandle("Handle", 0.12, [0, "$dh / 2 - 0.04", 0.01], f.trim),
      ], { at: [0, "0.07 + $dh / 2", "($D - 0.04) / 2 + 0.008"], repeat: { count: 3, step: [0, "$dh", 0] } }),
    ], vars: { dh: "($H - $t - 0.075) / 3" } }),
    group("Legs", [
      squareLeg("Leg_FL", ["-$xl", 0, "$zl"], "$H - $t + 0.003", 0.045, 0.045),
      squareLeg("Leg_BL", ["-$xl", 0, "-$zl"], "$H - $t + 0.003", 0.045, 0.045),
    ]),
    box("Modesty_Panel", ["$W - $pw - 0.06", 0.32, 0.018], { at: ["-$pw / 2 + 0.01", "$H - $t - 0.16", "-$zl"], bevel: 0.004 }),
    board("Apron_L", [0.02, 0.08, "2 * $zl"], "z", { at: ["-$xl", "$H - $t - 0.04", 0], bevel: 0.004 }),
  ];
}

function standing(f: Finish): SpecNode[] {
  const leg = group("Leg_L", [
    board("Foot", [0.07, 0.035, "$D - 0.08"], "z", { at: [0, 0.008, 0], anchor: "bottom", bevel: 0.01 }),
    box("Glide_F", [0.05, 0.01, 0.05], { at: [0, 0, "$D / 2 - 0.08"], anchor: "bottom", material: "rubber", bevel: 0.003 }),
    box("Glide_B", [0.05, 0.01, 0.05], { at: [0, 0, "-$D / 2 + 0.08"], anchor: "bottom", material: "rubber", bevel: 0.003 }),
    box("Sleeve", [0.08, 0.5, 0.06], { at: [0, 0.04, 0], anchor: "bottom", bevel: 0.006 }),
    box("Riser", [0.066, "$H - $t - 0.3", 0.048], { at: [0, 0.3, 0], anchor: "bottom", bevel: 0.004 }),
    box("Bracket", [0.05, 0.03, "$D - 0.12"], { at: [0, "$H - $t - 0.015", 0], bevel: 0.004 }),
  ], { at: ["$W / 2 - 0.13", 0, 0], mirror: "Leg_R" });
  return [
    top(f, 0.014),
    group("Legs", [leg], { material: tubular(f.frame) }),
    box("Frame", ["$W - 0.3", 0.05, 0.05], { at: [0, "$H - $t - 0.03", -0.06], bevel: 0.004, material: tubular(f.frame) }),
    box("Controller", [0.12, 0.025, 0.06], { at: ["$W / 2 - 0.35", "$H - $t - 0.012", "$D / 2 - 0.05"], bevel: 0.006, material: f.trim, children: [
      box("Button_{i}", [0.016, 0.006, 0.012], { at: [-0.035, -0.012, 0.01], repeat: { count: 4, step: [0.023, 0, 0] }, bevel: 0.002 }),
      cyl("Display", 0.006, 0.004, { axis: "z", at: [0.04, 0, 0.031], material: "led_blue", segments: 10 }),
    ] }),
    cyl("Grommet", 0.03, "$t + 0.004", { at: ["-$W / 2 + 0.2", "$H - $t / 2", "-$D / 2 + 0.08"], segments: 16, material: f.trim }),
  ];
}

function steel(f: Finish): SpecNode[] {
  const frame = group("Leg_L", [
    box("Post_F", [0.04, "$H - $t", 0.04], { at: [0, 0, "$zl"], anchor: "bottom", bevel: 0.004 }),
    box("Post_B", [0.04, "$H - $t", 0.04], { at: [0, 0, "-$zl"], anchor: "bottom", bevel: 0.004 }),
    board("Foot_Bar", [0.04, 0.04, "2 * $zl"], "z", { at: [0, 0.02, 0], bevel: 0.004 }),
    box("Top_Bar", [0.04, 0.04, "2 * $zl"], { at: [0, "$H - $t - 0.02", 0], bevel: 0.004 }),
    cyl("Bolt_{i}", 0.006, 0.006, { axis: "x", at: [0.022, "$H - $t - 0.02", "-$zl + 0.1"], repeat: { count: 2, step: [0, 0, "2 * $zl - 0.2"] }, segments: 8 }),
  ], { at: ["$xl", 0, 0], mirror: "Leg_R" });
  return [
    group("Top", [
      board("Plank_{i}", ["$W", "$t", "$D / 2 - 0.002"], "x", { at: [0, "$H - $t / 2", "-$D / 4"], repeat: { count: 2, step: [0, 0, "$D / 2"] }, bevel: 0.006 }),
    ], { material: f.top }),
    group("Legs", [frame], { material: tubular(f.frame) }),
    board("Stretcher", ["2 * $xl", 0.04, 0.02], "x", { at: [0, 0.3, "-$zl"], bevel: 0.003, material: f.frame }),
    box("Drawer", ["$W * 0.4", 0.09, "$D - 0.14"], { at: [0, "$H - $t - 0.045", 0], bevel: 0.004, material: f.top, children: [
      barHandle("Handle", 0.14, [0, 0, "($D - 0.14) / 2"], f.trim, { standoff: 0.025 }),
      box("Runner_L", [0.03, 0.02, "$D - 0.14"], { at: ["$W * 0.2 + 0.014", 0.035, 0], material: f.frame, mirror: "Runner_R" }),
    ] }),
  ];
}

const TEXT: Record<Style, string> = {
  writing: "A classic writing desk: a top with a leather inlay, an apron with three small drawers on brass knobs and four tapered legs",
  pedestal: "An office desk with a drawer pedestal of three drawers with bar handles on the right, two legs on the left and a modesty panel at the back",
  standing: "A height-adjustable standing desk: a top with a cable grommet on two telescoping columns with feet, a crossbar and a control panel",
  steel: "An industrial desk: a two-plank top on welded steel box frames with a back stretcher and a slim hanging drawer",
};

function makeDesk(style: Style, f: Finish): AssetDraft {
  const vars = { W: "$width", D: "$depth", H: "$height", t: style === "steel" ? 0.04 : 0.028, xl: "$width / 2 - 0.05", zl: "$depth / 2 - 0.05", pw: "min(0.44, $width * 0.33)" };
  const t = label(f.top);
  const fr = label(f.frame);
  return {
    slug: slugify("desk", style, f.top.replace(/^paint_/, ""), ...(f.frame !== f.top ? [f.frame.replace(/^paint_/, "")] : [])),
    title: `${cap(t)} ${style} desk`,
    description: `${TEXT[style]}, ${f.frame === f.top ? `in ${t}` : `with a ${t} top and a ${fr} frame`}. The user sits at +z (it faces +z) and its width runs along x.`,
    tags: [style, f.top.replace(/^paint_/, ""), f.frame.replace(/^paint_/, ""), "desk", "bureau", "werkplek", ...(style === "standing" ? ["sta-bureau", "zit-sta"] : style === "writing" ? ["schrijftafel", "secretaire"] : [])],
    params: [
      num("width", 1.3, 1.0, 1.6, "Width of the top along x in metres."),
      num("depth", 0.7, 0.58, 0.8, "Depth of the top along z in metres."),
      style === "standing" ? num("height", 0.74, 0.7, 1.2, "Height of the top surface; the columns telescope.") : num("height", 0.75, 0.72, 0.78, "Height of the top surface above the floor."),
    ],
    materials: fmats(...new Set([f.top, f.frame, tubular(f.frame), f.trim, "brass", "rubber", "led_blue", "paint_anthracite", "reveal"])),
    nodes: [group("Desk", { writing, pedestal, standing, steel }[style](f), { material: f.frame, vars })],
  };
}

export const desk: Family = {
  id: "desk",
  category: "furniture",
  archetype: "prop.table",
  tags: ["desk", "office desk", "writing desk", "bureau", "schrijfbureau", "werktafel", "furniture", "meubel"],
  assets: () => combos({ style: STYLES, k: [0, 1, 2] as const }).map(({ style, k }) => makeDesk(style, FINISHES[style][k] as Finish)),
};
