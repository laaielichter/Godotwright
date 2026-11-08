import { box, cap, cyl, group, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, stencil, useMats, worn } from "./common.js";

type Finish = { main: string; trim: string; accent: string };
interface Style {
  name: string;
  title: string;
  text: string;
  tags: string[];
  params: ParamDef[];
  finishes: Finish[];
  build: (f: Finish) => SpecNode[];
}

const STEPS = 10;
/** Height of an arched lid at section k of STEPS (0 at the hinge, STEPS at the front): side $ls plus the arch $rise. */
const archY = (k: number, extra = "0"): string => `$ls + $rise * ${Math.sqrt(Math.max(0, 1 - (2 * k / STEPS - 1) ** 2)).toFixed(5)} + ${extra}`;

/** An arched lid (or a band over it) as a loft along z from the hinge (z = 0) to the front (z = $D), from x0 to x1. */
function archLoft(name: string, x0: string, x1: string, extra: string, material?: string): SpecNode {
  const sections = Array.from({ length: STEPS + 1 }, (_, k) => ({
    z: `-${extra} + ($D + 2 * ${extra}) * ${k / STEPS}`,
    points: [[x0, 0], [x1, 0], [x1, archY(k, extra)], [x0, archY(k, extra)]],
  }));
  return loft(name, sections, material ? { material } : {});
}

/** A rope or metal ring handle hanging from two mounts on the side at +x. */
function sideHandle(f: Finish, y: string, material: string): SpecNode {
  return group("Handle_L", [
    box("Mount_F", [0.012, 0.04, 0.03], { at: [0.006, 0, 0.06], material: f.trim, bevel: 0.003 }),
    box("Mount_B", [0.012, 0.04, 0.03], { at: [0.006, 0, -0.06], material: f.trim, bevel: 0.003 }),
    tube("Ring", [[0.02, 0, 0.06], [0.03, -0.04, 0.05], [0.03, -0.06, 0], [0.03, -0.04, -0.05], [0.02, 0, -0.06]], 0.009, { segments: 8, material }),
  ], { at: ["$W / 2", y, 0], mirror: "Handle_R" });
}

/** A treasure chest: a banded box with corner plates and ring handles under an arched, banded lid with a hasp and padlock. */
function treasure(f: Finish): SpecNode[] {
  return [
    group("TreasureChest", [
      group("Body", [
        box("Case", ["$W", "$bh", "$D"], { at: [0, "$bh / 2", 0], bevel: 0.006 }),
        box("Strap_L", [0.05, "$bh + 0.004", "$D + 0.01"], { at: ["$W * 0.3", "$bh / 2", 0], material: f.trim, mirror: "Strap_R" }),
        box("Skirt", ["$W + 0.012", 0.04, "$D + 0.012"], { at: [0, 0.02, 0], material: f.trim }),
        box("Rim", ["$W + 0.012", 0.03, "$D + 0.012"], { at: [0, "$bh - 0.015", 0], material: f.trim }),
        box("Corner_FL", [0.06, "$bh * 0.5", 0.06], { at: ["$W / 2 - 0.022", "$bh * 0.25", "$D / 2 - 0.022"], material: f.trim, bevel: 0.006, mirror: "Corner_FR" }),
        box("Corner_BL", [0.06, "$bh * 0.5", 0.06], { at: ["$W / 2 - 0.022", "$bh * 0.25", "-$D / 2 + 0.022"], material: f.trim, bevel: 0.006, mirror: "Corner_BR" }),
        cyl("Stud_F{i}", 0.008, 0.012, { axis: "z", at: ["-$W / 2 + 0.04", "$bh - 0.015", "$D / 2 + 0.006"], repeat: { count: 8, step: ["($W - 0.08) / 7", 0, 0] }, segments: 8, material: f.accent }),
      ]),
      sideHandle(f, "$bh * 0.7", f.trim),
      group("Lock", [
        box("Plate", [0.1, 0.12, 0.012], { at: [0, 0, 0], material: f.accent, bevel: 0.004 }),
        cyl("Keyhole", 0.01, 0.006, { axis: "z", at: [0, 0.01, 0.007], segments: 10, material: "hole" }),
        group("Padlock", [
          box("Housing", [0.07, 0.06, 0.025], { at: [0, -0.04, 0.03], bevel: 0.008 }),
          tube("Shackle", [[-0.022, -0.015, 0.03], [-0.022, 0.01, 0.03], [0, 0.03, 0.03], [0.022, 0.01, 0.03], [0.022, -0.015, 0.03]], 0.006, { segments: 8 }),
        ], { material: f.accent }),
      ], { at: [0, "$bh - 0.06", "$D / 2 + 0.006"] }),
      group("Lid", [
        archLoft("Dome", "-$W / 2 - 0.006", "$W / 2 + 0.006", "0"),
        archLoft("Band_L", "$W * 0.3 - 0.025", "$W * 0.3 + 0.025", "0.005", f.trim),
        archLoft("Band_R", "-$W * 0.3 - 0.025", "-$W * 0.3 + 0.025", "0.005", f.trim),
        box("Hasp", [0.06, 0.07, 0.012], { at: [0, 0.02, "$D + 0.008"], material: f.trim, bevel: 0.004 }),
      ], { at: [0, "$bh", "-$D / 2"] }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", bh: "$height * 0.58", ls: 0.04, rise: "$height * 0.42 - 0.04" } }),
  ];
}

/** A steel toolbox: a ribbed box with clasp latches and a key lock, under a recessed lid with a folding carry handle. */
function toolbox(f: Finish): SpecNode[] {
  return [
    group("Toolbox", [
      group("Body", [
        box("Case", ["$W", "$bh", "$D"], { at: [0, "$bh / 2", 0], bevel: 0.006 }),
        box("Rib", ["$W + 0.006", 0.014, "$D + 0.006"], { at: [0, "$bh * 0.35", 0], bevel: 0.004 }),
        box("Foot_L", [0.04, 0.008, "$D - 0.02"], { at: ["$W / 2 - 0.04", 0.004, 0], material: "rubber", mirror: "Foot_R" }),
      ]),
      group("Latch_L", [
        box("Base", [0.04, 0.03, 0.012], { at: [0, -0.02, 0], bevel: 0.003 }),
        box("Clasp", [0.03, 0.05, 0.008], { at: [0, 0.005, 0.008], bevel: 0.003 }),
      ], { at: ["$W * 0.32", "$bh", "$D / 2 + 0.004"], material: f.trim, mirror: "Latch_R" }),
      cyl("Lock", 0.012, 0.012, { axis: "z", at: [0, "$bh - 0.03", "$D / 2 + 0.004"], segments: 12, material: f.trim }),
      group("Lid", [
        box("Panel", ["$W + 0.006", "$lt", "$D + 0.006"], { at: [0, "$lt / 2", "$D / 2"], bevel: 0.006 }),
        box("Recess", ["$W - 0.06", 0.004, "$D - 0.06"], { at: [0, "$lt", "$D / 2"], material: f.accent }),
        group("Handle", [
          box("Mount_L", [0.03, 0.016, 0.03], { at: ["$W * 0.25", 0.006, 0], bevel: 0.004, mirror: "Mount_R" }),
          tube("Grip", [["-$W * 0.25", 0.012, 0], ["-$W * 0.25", 0.04, 0], ["-$W * 0.2", 0.06, 0], ["$W * 0.2", 0.06, 0], ["$W * 0.25", 0.04, 0], ["$W * 0.25", 0.012, 0]], 0.009, { segments: 10 }),
          cyl("Sleeve", 0.016, "$W * 0.32", { axis: "x", at: [0, 0.06, 0], segments: 12, material: "rubber" }),
        ], { at: [0, "$lt", "$D / 2"], material: f.trim }),
        cyl("Hinge", 0.007, "$W * 0.9", { axis: "x", at: [0, 0, -0.004], segments: 8, material: f.trim }),
      ], { at: [0, "$bh", "-$D / 2"] }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", lt: "$height * 0.22", bh: "$height * 0.78" } }),
  ];
}

/** A steamer trunk: a slatted, leather-bound case with brass corners, side handles, a centre lock and two latches, under a gently arched lid. */
function trunk(f: Finish): SpecNode[] {
  const corners: SpecNode[] = [];
  for (const [n, z] of [["F", "$D / 2 - 0.025"], ["B", "-$D / 2 + 0.025"]] as const) {
    corners.push(box(`Corner_${n}L`, [0.07, 0.07, 0.07], { at: ["$W / 2 - 0.025", 0.03, z], material: f.accent, bevel: 0.01, mirror: `Corner_${n}R` }));
  }
  return [
    group("Trunk", [
      group("Body", [
        box("Case", ["$W", "$bh", "$D"], { at: [0, "$bh / 2", 0], bevel: 0.006 }),
        box("Slat_F{i}", ["$W + 0.008", 0.05, "$D + 0.008"], { at: [0, 0.06, 0], repeat: { count: 3, step: [0, "($bh - 0.12) / 2", 0] }, material: f.trim, bevel: 0.004 }),
        box("Upright_L", [0.05, "$bh - 0.02", "$D + 0.012"], { at: ["$W / 2 - 0.08", "$bh / 2", 0], material: f.trim, mirror: "Upright_R" }),
        ...corners,
        box("Nail_F{i}", [0.012, 0.012, 0.01], { at: ["-$W / 2 + 0.12", "$bh - 0.02", "$D / 2 + 0.006"], repeat: { count: 9, step: ["($W - 0.24) / 8", 0, 0] }, material: f.accent, bevel: 0.004 }),
      ]),
      group("Handle_L", [
        box("Loop", [0.03, 0.04, 0.2], { at: [0.012, 0, 0], material: "leather_brown", bevel: 0.01 }),
        box("Cap_F", [0.02, 0.05, 0.04], { at: [0.005, 0, 0.11], material: f.accent, bevel: 0.004 }),
        box("Cap_B", [0.02, 0.05, 0.04], { at: [0.005, 0, -0.11], material: f.accent, bevel: 0.004 }),
      ], { at: ["$W / 2", "$bh * 0.65", 0], mirror: "Handle_R" }),
      group("Lock", [
        box("Plate", [0.09, 0.1, 0.012], { bevel: 0.004 }),
        cyl("Keyhole", 0.009, 0.006, { axis: "z", at: [0, -0.01, 0.007], segments: 10, material: "hole" }),
      ], { at: [0, "$bh - 0.04", "$D / 2 + 0.006"], material: f.accent }),
      box("Latch_L", [0.06, 0.07, 0.014], { at: ["$W * 0.3", "$bh - 0.03", "$D / 2 + 0.007"], material: f.accent, bevel: 0.005, mirror: "Latch_R" }),
      group("Lid", [
        archLoft("Shell", "-$W / 2 - 0.004", "$W / 2 + 0.004", "0"),
        archLoft("Strap_L", "$W * 0.3 - 0.03", "$W * 0.3 + 0.03", "0.004", f.trim),
        archLoft("Strap_R", "-$W * 0.3 - 0.03", "-$W * 0.3 + 0.03", "0.004", f.trim),
        box("Edge", ["$W + 0.012", 0.04, "$D + 0.012"], { at: [0, 0.02, "$D / 2"], material: f.trim }),
      ], { at: [0, "$bh", "-$D / 2"] }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", bh: "$height * 0.82", ls: 0.05, rise: "$height * 0.18 - 0.05" } }),
  ];
}

/** A plywood footlocker: steel corner caps and edge trims, rope becket handles, a hasp and two draw latches, a stencilled lid. */
function footlocker(f: Finish): SpecNode[] {
  const caps: SpecNode[] = [];
  for (const [n, y, z] of [["FB", "0.025", "$D / 2 - 0.025"], ["BB", "0.025", "-$D / 2 + 0.025"]] as const) {
    caps.push(box(`Corner_${n}L`, [0.055, 0.055, 0.055], { at: ["$W / 2 - 0.025", y, z], material: f.trim, bevel: 0.008, mirror: `Corner_${n}R` }));
  }
  return [
    group("Footlocker", [
      group("Body", [
        box("Case", ["$W", "$bh", "$D"], { at: [0, "$bh / 2", 0], bevel: 0.004, material: worn(f.main) }),
        box("Edge_FL", [0.03, "$bh", 0.03], { at: ["$W / 2 - 0.012", "$bh / 2", "$D / 2 - 0.012"], material: f.trim, mirror: "Edge_FR" }),
        box("Edge_BL", [0.03, "$bh", 0.03], { at: ["$W / 2 - 0.012", "$bh / 2", "-$D / 2 + 0.012"], material: f.trim, mirror: "Edge_BR" }),
        ...caps,
      ]),
      group("Handle_L", [
        box("Cleat", [0.02, 0.05, 0.16], { at: [0.008, 0.02, 0], bevel: 0.005 }),
        tube("Rope", [[0.02, 0.03, 0.06], [0.04, 0, 0.05], [0.045, -0.03, 0], [0.04, 0, -0.05], [0.02, 0.03, -0.06]], 0.011, { segments: 8, material: "rope" }),
      ], { at: ["$W / 2", "$bh * 0.6", 0], mirror: "Handle_R" }),
      group("Latch_L", [
        box("Base", [0.05, 0.035, 0.01], { at: [0, -0.025, 0], bevel: 0.003 }),
        box("Lever", [0.035, 0.05, 0.01], { at: [0, 0.005, 0.008], bevel: 0.003 }),
      ], { at: ["$W * 0.3", "$bh", "$D / 2 + 0.004"], material: f.trim, mirror: "Latch_R" }),
      group("Lock", [
        box("Hasp", [0.04, 0.08, 0.008], { at: [0, 0, 0], bevel: 0.003 }),
        tube("Staple", [[-0.012, -0.02, 0.004], [-0.012, -0.02, 0.02], [0.012, -0.02, 0.02], [0.012, -0.02, 0.004]], 0.004, { segments: 6 }),
      ], { at: [0, "$bh - 0.01", "$D / 2 + 0.005"], material: f.trim }),
      group("Lid", [
        box("Panel", ["$W", "$lt", "$D"], { at: [0, "$lt / 2", "$D / 2"], bevel: 0.004 }),
        box("Trim_F", ["$W + 0.006", 0.03, 0.01], { at: [0, 0.015, "$D + 0.002"], material: f.trim }),
        box("Cap_L", [0.055, "$lt", 0.055], { at: ["$W / 2 - 0.025", "$lt / 2", "$D - 0.025"], material: f.trim, bevel: 0.008, mirror: "Cap_R" }),
        box("Cap_BL", [0.055, "$lt", 0.055], { at: ["$W / 2 - 0.025", "$lt / 2", 0.025], material: f.trim, bevel: 0.008, mirror: "Cap_BR" }),
        stencil("Stencil", "SUPPLY", "top", [0, "$lt + 0.001", "$D * 0.55"], 0.014, f.accent, 0.003),
      ], { at: [0, "$bh", "-$D / 2"] }),
    ], { material: f.main, vars: { W: "$width", D: "$depth", lt: "$height * 0.2", bh: "$height * 0.8" } }),
  ];
}

const STYLES: Style[] = [
  {
    name: "treasure", title: "treasure chest", text: "a banded wooden chest with corner plates, a row of studs and ring handles, under an arched banded lid with a hasp and a padlock", tags: ["treasure", "schatkist", "pirate", "piraat", "fantasy", "loot"], build: treasure,
    params: [num("width", 0.9, 0.6, 1.2, "Width along x in metres."), num("depth", 0.55, 0.4, 0.7, "Depth along z in metres."), num("height", 0.62, 0.45, 0.8, "Height to the top of the arched lid in metres.")],
    finishes: [{ main: "oak", trim: "black_steel", accent: "brass" }, { main: "walnut", trim: "brass", accent: "gold" }, { main: "mahogany", trim: "gold", accent: "gold" }, { main: "weathered_wood", trim: "rust", accent: "bronze" }],
  },
  {
    name: "toolbox", title: "toolbox", text: "a steel toolbox with a pressed rib, clasp latches and a key lock under a recessed lid with a folding carry handle", tags: ["toolbox", "gereedschapskist", "tools", "gereedschap", "workshop", "werkplaats"], build: toolbox,
    params: [num("width", 0.5, 0.35, 0.7, "Length along x in metres."), num("depth", 0.22, 0.18, 0.3, "Depth along z in metres."), num("height", 0.24, 0.18, 0.32, "Height with the lid closed in metres.")],
    finishes: [{ main: "paint_red", trim: "chrome", accent: "paint_black" }, { main: "paint_blue", trim: "brushed_steel", accent: "paint_black" }, { main: "paint_black", trim: "chrome", accent: "paint_red" }, { main: "paint_yellow", trim: "black_steel", accent: "paint_black" }],
  },
  {
    name: "trunk", title: "steamer trunk", text: "a steamer trunk bound with slats and uprights, brass corners and nails, leather side handles, a centre lock and two latches, under a gently arched strapped lid", tags: ["trunk", "hutkoffer", "steamer trunk", "vintage", "travel", "reis"], build: trunk,
    params: [num("width", 0.9, 0.7, 1.1, "Width along x in metres."), num("depth", 0.5, 0.4, 0.6, "Depth along z in metres."), num("height", 0.6, 0.45, 0.75, "Height with the lid closed in metres.")],
    finishes: [{ main: "leather_brown", trim: "oak", accent: "brass" }, { main: "paint_navy", trim: "light_oak", accent: "brass" }, { main: "leather_black", trim: "walnut", accent: "chrome" }, { main: "canvas_beige", trim: "leather_tan", accent: "bronze" }],
  },
  {
    name: "footlocker", title: "footlocker", text: "a painted plywood footlocker with steel corner caps and edge trims, rope becket handles, a hasp and two draw latches, and a stencil on the lid", tags: ["footlocker", "legerkist", "military", "leger", "army", "kist"], build: footlocker,
    params: [num("width", 0.8, 0.6, 1.0, "Width along x in metres."), num("depth", 0.42, 0.35, 0.55, "Depth along z in metres."), num("height", 0.35, 0.28, 0.45, "Height with the lid closed in metres.")],
    finishes: [{ main: "paint_olive", trim: "black_steel", accent: "paint_white" }, { main: "paint_forest", trim: "steel", accent: "paint_yellow" }, { main: "paint_navy", trim: "brushed_steel", accent: "paint_white" }, { main: "paint_sand", trim: "black_steel", accent: "paint_black" }],
  },
];

function chest(style: Style, f: Finish): AssetDraft {
  const fin = finishName(f.main);
  return {
    slug: slugify("chest", style.name, fin),
    title: cap(`${fin} ${style.title}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}. The lid hinges about x on its back top edge, and the lock faces +z.`,
    tags: [...style.tags, ...finishTags(f.main)],
    params: style.params,
    materials: useMats(f.main, f.trim, f.accent, "hole", "rubber", "rope", "leather_brown", worn(f.main)),
    nodes: style.build(f),
  };
}

export const chestFamily: Family = {
  id: "chest",
  category: "storage",
  archetype: "prop.chest",
  tags: ["chest", "kist", "box", "lid", "deksel", "storage", "opslag"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => chest(s, f))),
};

