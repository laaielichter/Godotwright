import { box, cap, cyl, group, lathe, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, useMats, worn, wrapLabel } from "./common.js";

type Finish = { main: string; trim: string; accent: string };
interface Style {
  name: string;
  title: string;
  text: string;
  tags: string[];
  finishes: Finish[];
  build: (f: Finish) => { nodes: SpecNode[]; params: ParamDef[] };
}

/** Radius of a bulged cask at height fraction t (0 bottom, 1 top): the bilge $R in the middle, $R * (1 - $bulge) at the ends. */
const bulge = (t: number): string => `$R * (1 - $bulge * ${((2 * t - 1) ** 2).toFixed(4)})`;

/** The side of a bulged wooden cask, with chimes and a recessed head at the top. */
function caskProfile(): [Num, Num][] {
  const pts: [Num, Num][] = [[`${bulge(0)} - 0.012`, 0], [bulge(0), 0.012]];
  for (const t of [0.08, 0.18, 0.3, 0.42, 0.5, 0.58, 0.7, 0.82, 0.92]) pts.push([bulge(t), `$H * ${t}`]);
  pts.push([bulge(1), "$H - 0.012"], [`${bulge(1)} - 0.012`, "$H"], [`${bulge(1)} - 0.026`, "$H"], [`${bulge(1)} - 0.03`, "$H - 0.025"]);
  return pts;
}

/** A thin band around a cask at height fraction t, `w` metres tall. */
const hoop = (name: string, t: number, w: number, material: string): SpecNode =>
  lathe(name, [
    [`${bulge(t)} - 0.004`, `$H * ${t} - ${w / 2}`],
    [`${bulge(t)} + 0.004`, `$H * ${t} - ${w / 2}`],
    [`${bulge(t)} + 0.006`, `$H * ${t} - ${w / 2 - 0.003}`],
    [`${bulge(t)} + 0.006`, `$H * ${t} + ${w / 2 - 0.003}`],
    [`${bulge(t)} + 0.004`, `$H * ${t} + ${w / 2}`],
    [`${bulge(t)} - 0.004`, `$H * ${t} + ${w / 2}`],
  ], { segments: 32, material });

const caskParams = (h: number): ParamDef[] => [
  num("height", h, 0.8, 0.95, "Height of the cask in metres."),
  num("radius", 0.29, 0.26, 0.32, "Radius at the bilge (the widest middle) in metres."),
  num("bulge", 0.12, 0.06, 0.16, "How much narrower the ends are than the bilge, as a fraction."),
];

/** A coopered oak cask: bulged staves, six iron hoops, a recessed head with a bung and a bung on the side. */
function cask(f: Finish): { nodes: SpecNode[]; params: ParamDef[] } {
  const hoops = [0.04, 0.13, 0.32, 0.68, 0.87, 0.96];
  return {
    nodes: [
      group("Cask", [
        lathe("Body", caskProfile(), { segments: 40 }),
        group("Hoops", hoops.map((t, i) => hoop(`Hoop_${i + 1}`, t, i === 0 || i === 5 ? 0.03 : 0.04, f.trim))),
        cyl("Bung", 0.024, 0.03, { axis: "z", at: [0, "$H * 0.5", `${bulge(0.5)} - 0.008`], segments: 14, material: f.accent, bevel: 0.004 }),
        group("Lid", [
          cyl("Head", `${bulge(1)} - 0.028`, 0.016, { at: [0, 0, 0], anchor: "base", segments: 40 }),
          box("Groove_{i}", [`(${bulge(1)} - 0.04) * 1.6`, 0.004, 0.003], { at: [0, 0.016, "-0.12"], repeat: { count: 3, step: [0, 0, 0.12] }, material: "hole" }),
          cyl("Plug", 0.02, 0.012, { at: [`(${bulge(1)}) * 0.45`, 0.016, 0.06], segments: 12, material: f.accent }),
        ], { at: [0, "$H - 0.027", 0] }),
      ], { material: f.main, vars: { H: "$height", R: "$radius - 0.006" } }),
    ],
    params: caskParams(0.9),
  };
}

/** A wooden water butt: a bulged barrel with two wide flat hoops, a plank lid with a grip and a brass tap. */
function waterButt(f: Finish): { nodes: SpecNode[]; params: ParamDef[] } {
  return {
    nodes: [
      group("WaterButt", [
        lathe("Body", caskProfile(), { segments: 40 }),
        hoop("Band_Low", 0.2, 0.07, f.trim),
        hoop("Band_High", 0.8, 0.07, f.trim),
        hoop("Rim_Top", 0.97, 0.025, f.trim),
        group("Tap", [
          cyl("Boss", 0.03, 0.04, { axis: "z", at: [0, 0, 0], segments: 14, bevel: 0.004 }),
          tube("Spout", [[0, 0, 0.015], [0, 0, 0.06], [0, -0.03, 0.075], [0, -0.05, 0.075]], 0.011, { segments: 10 }),
          box("Lever", [0.08, 0.014, 0.012], { at: [0, 0.018, 0.05], bevel: 0.004 }),
        ], { at: [0, "$H * 0.12", `${bulge(0.12)} - 0.004`], material: f.accent }),
        group("Lid", [
          cyl("Board", `${bulge(1)} + 0.004`, 0.024, { anchor: "base", segments: 40, bevel: 0.004 }),
          box("Seam_{i}", [`(${bulge(1)}) * 1.5`, 0.003, 0.004], { at: [0, 0.0245, `-(${bulge(1)}) * 0.5`], repeat: { count: 3, step: [0, 0, `(${bulge(1)}) * 0.5`] }, material: "hole" }),
          box("Cleat_L", [0.05, 0.02, `(${bulge(1)} - 0.03) * 1.5`], { at: [`(${bulge(1)} - 0.03) * 0.5`, 0.032, 0], bevel: 0.004, mirror: "Cleat_R" }),
          tube("Grip", [[-0.07, 0.04, 0], [-0.06, 0.08, 0], [0.06, 0.08, 0], [0.07, 0.04, 0]], 0.012, { segments: 10, material: f.trim }),
        ], { at: [0, "$H - 0.012", 0] }),
      ], { material: f.main, vars: { H: "$height", R: "$radius - 0.006" } }),
    ],
    params: caskParams(0.86),
  };
}

/** A steel drum side: chimes at both ends, two swaged rolling hoops and three pressed beads. Ends recessed by `top`. */
function drumProfile(): [Num, Num][] {
  const pts: [Num, Num][] = [["$R - 0.006", 0], ["$R + 0.002", 0.004], ["$R + 0.004", 0.016], ["$R", 0.03]];
  const bead = (y: string): [Num, Num][] => [["$R", `${y} - 0.008`], ["$R - 0.004", y], ["$R", `${y} + 0.008`]];
  const roll = (y: string): [Num, Num][] => [["$R", `${y} - 0.024`], ["$R + 0.006", `${y} - 0.014`], ["$R + 0.012", y], ["$R + 0.006", `${y} + 0.014`], ["$R", `${y} + 0.024`]];
  pts.push(...bead("$H * 0.1"), ...roll("$H * 0.33"), ...bead("$H * 0.5"), ...roll("$H * 0.67"), ...bead("$H * 0.9"));
  pts.push(["$R", "$H - 0.03"], ["$R + 0.004", "$H - 0.016"], ["$R + 0.002", "$H - 0.004"], ["$R - 0.006", "$H"], ["$R - 0.012", "$H"], ["$R - 0.014", "$H - 0.014"]);
  return pts;
}

const drumParams = (): ParamDef[] => [
  num("height", 0.88, 0.8, 0.95, "Height in metres (a 208 litre drum is about 0.88)."),
  num("radius", 0.286, 0.25, 0.31, "Radius of the shell in metres."),
  num("bungs", 0.6, 0.45, 0.75, "Distance of the bungs from the centre, as a fraction of the radius."),
];

/** A tight-head steel drum: lathe shell with chimes, rolling hoops and beads; the top head holds two bungs. */
function steelDrum(f: Finish): { nodes: SpecNode[]; params: ParamDef[] } {
  return {
    nodes: [
      group("SteelDrum", [
        lathe("Body", drumProfile(), { segments: 40, material: worn(f.main) }),
        wrapLabel("Label", "$R", 32, "$H * 0.4", "$H * 0.6", f.accent),
        box("Run_{i}", [0.03, "$H * 0.28", 0.006], { at: [0, "$H * 0.8", "$R + 0.003"], repeat: { count: 3, around: "y", phase: 110 }, material: "rust_streak" }),
        group("Lid", [
          cyl("Head", "$R - 0.013", 0.006, { anchor: "base", segments: 40 }),
          lathe("Emboss", [["$R * 0.7", 0.004], ["$R * 0.72", 0.009], ["$R * 0.76", 0.009], ["$R * 0.78", 0.004]], { segments: 40 }),
          cyl("Bung_Big", 0.034, 0.016, { at: ["-$R * $bungs", 0.004, 0], anchor: "base", segments: 16, bevel: 0.003, material: f.trim }),
          cyl("Bung_Small", 0.022, 0.016, { at: ["$R * $bungs", 0.004, 0], anchor: "base", segments: 14, bevel: 0.003, material: f.trim }),
        ], { at: [0, "$H - 0.016", 0] }),
      ], { material: f.main, vars: { H: "$height", R: "$radius" } }),
    ],
    params: drumParams(),
  };
}

/** An open-head steel drum: a ribbed shell under a removable lid held by a bolted clamp ring. */
function openDrum(f: Finish): { nodes: SpecNode[]; params: ParamDef[] } {
  const side: [Num, Num][] = [["$R - 0.006", 0], ["$R + 0.002", 0.004], ["$R + 0.004", 0.016], ["$R", 0.03]];
  for (const t of [0.2, 0.4, 0.6, 0.8]) side.push(["$R", `$H * ${t} - 0.012`], ["$R + 0.007", `$H * ${t}`], ["$R", `$H * ${t} + 0.012`]);
  side.push(["$R", "$H - 0.04"], ["$R - 0.01", "$H - 0.035"]);
  return {
    nodes: [
      group("OpenDrum", [
        lathe("Body", side, { segments: 40, material: worn(f.main) }),
        wrapLabel("Stencil", "$R", 44, "$H * 0.44", "$H * 0.56", f.accent),
        box("Run_{i}", [0.03, "$H * 0.25", 0.008], { at: [0, "$H * 0.8", "$R + 0.004"], repeat: { count: 2, around: "y", phase: 130 }, material: "rust_streak" }),
        group("Lid", [
          lathe("Cover", [["$R + 0.004", 0], ["$R + 0.008", 0.01], ["$R + 0.004", 0.022], ["$R - 0.02", 0.024], ["$R * $bungs", 0.03], ["$R * $bungs - 0.01", 0.024]], { segments: 40 }),
          lathe("Clamp", [["$R + 0.004", -0.006], ["$R + 0.014", -0.004], ["$R + 0.018", 0.012], ["$R + 0.014", 0.028], ["$R + 0.004", 0.03]], { segments: 40, material: f.trim }),
          group("Lever", [
            box("Ear_L", [0.012, 0.03, 0.03], { at: [0.03, 0.012, 0], material: f.trim, mirror: "Ear_R" }),
            cyl("Bolt", 0.007, 0.1, { axis: "x", at: [0, 0.012, 0.012], segments: 8, material: f.trim }),
            box("Arm", [0.03, 0.012, 0.11], { at: [0.05, 0.012, 0.0], rotate: [0, 60, 0], material: f.trim, bevel: 0.003 }),
          ], { at: [0, 0, "$R + 0.026"] }),
        ], { at: [0, "$H - 0.03", 0] }),
      ], { material: f.main, vars: { H: "$height", R: "$radius" } }),
    ],
    params: [
      num("height", 0.88, 0.8, 0.95, "Height with the lid on, in metres."),
      num("radius", 0.286, 0.25, 0.31, "Radius of the shell in metres."),
      num("bungs", 0.55, 0.4, 0.7, "Radius of the lid's raised centre panel, as a fraction of the drum radius."),
    ],
  };
}

/** A blow-moulded plastic drum: rounded shoulders, moulded handling rings at top and bottom, two rolling ribs and screw bungs. */
function plasticDrum(f: Finish): { nodes: SpecNode[]; params: ParamDef[] } {
  return {
    nodes: [
      group("PlasticDrum", [
        lathe("Body", [
          ["$R - 0.03", 0], ["$R - 0.008", 0.004], ["$R", 0.03], ["$R", 0.07], ["$R - 0.012", 0.085],
          ["$R - 0.012", "$H * 0.3 - 0.02"], ["$R - 0.002", "$H * 0.3"], ["$R - 0.012", "$H * 0.3 + 0.02"],
          ["$R - 0.012", "$H * 0.7 - 0.02"], ["$R - 0.002", "$H * 0.7"], ["$R - 0.012", "$H * 0.7 + 0.02"],
          ["$R - 0.012", "$H - 0.1"], ["$R", "$H - 0.085"], ["$R", "$H - 0.02"], ["$R - 0.01", "$H"], ["$R - 0.03", "$H"], ["$R - 0.035", "$H - 0.04"], ["$R * 0.5", "$H - 0.03"],
        ], { segments: 40 }),
        cyl("Bung_Small", 0.026, 0.026, { at: ["-$R * $bungs", "$H - 0.04", 0], anchor: "base", segments: 16, bevel: 0.004, material: f.trim }),
        wrapLabel("Label", "$R - 0.012", 34, "$H * 0.38", "$H * 0.62", f.accent),
        group("Lid", [
          cyl("Screw", 0.04, 0.03, { anchor: "base", segments: 20, bevel: 0.005 }),
          box("Rib", [0.012, 0.024, 0.09], { at: [0, 0.03, 0], bevel: 0.003 }),
        ], { at: ["$R * $bungs", "$H - 0.04", 0], material: f.trim }),
      ], { material: f.main, vars: { H: "$height", R: "$radius" } }),
    ],
    params: [
      num("height", 0.9, 0.8, 0.95, "Height in metres (a 220 litre plastic drum is about 0.93)."),
      num("radius", 0.29, 0.26, 0.31, "Radius at the handling rings in metres."),
      num("bungs", 0.55, 0.45, 0.65, "Distance of the screw bungs from the centre, as a fraction of the radius."),
    ],
  };
}

/** An open-top plastic drum: a slightly tapered ribbed body with moulded side grips and a lid held by a clamp ring. */
function openPlasticDrum(f: Finish): { nodes: SpecNode[]; params: ParamDef[] } {
  const side: [Num, Num][] = [["$R * 0.9 - 0.02", 0], ["$R * 0.9", 0.012], ["$R * 0.9", 0.04]];
  for (let k = 1; k <= 5; k++) {
    const t = (k / 6).toFixed(4);
    side.push([`$R * (0.9 + 0.08 * ${t})`, `$H * ${t} - 0.015`], [`$R * (0.9 + 0.08 * ${t}) + 0.008`, `$H * ${t}`], [`$R * (0.9 + 0.08 * ${t})`, `$H * ${t} + 0.015`]);
  }
  side.push(["$R * 0.98", "$H - 0.06"], ["$R", "$H - 0.05"], ["$R", "$H - 0.03"], ["$R - 0.012", "$H - 0.028"]);
  return {
    nodes: [
      group("OpenPlasticDrum", [
        lathe("Body", side, { segments: 40 }),
        box("Grip_L", [0.03, 0.03, 0.16], { at: ["$R - 0.004", "$H - 0.1", 0], bevel: 0.008, mirror: "Grip_R" }),
        group("Lid", [
          cyl("Cover", "$R + 0.004", 0.03, { anchor: "base", segments: 40, bevel: 0.006 }),
          cyl("Panel", "$R * $bungs", 0.012, { at: [0, 0.026, 0], anchor: "base", segments: 32, bevel: 0.004 }),
          lathe("Clamp", [["$R + 0.002", -0.004], ["$R + 0.012", -0.002], ["$R + 0.016", 0.014], ["$R + 0.012", 0.03], ["$R + 0.002", 0.032]], { segments: 40, material: f.trim }),
          box("Lever", [0.05, 0.03, 0.03], { at: [0, 0.014, "$R + 0.025"], material: f.trim, bevel: 0.006 }),
        ], { at: [0, "$H - 0.03", 0] }),
      ], { material: f.main, vars: { H: "$height", R: "$radius" } }),
    ],
    params: [
      num("height", 0.88, 0.8, 0.95, "Height with the lid on, in metres."),
      num("radius", 0.29, 0.26, 0.31, "Radius at the top in metres; the body tapers towards the base."),
      num("bungs", 0.6, 0.45, 0.75, "Radius of the lid's raised centre, as a fraction of the drum radius."),
    ],
  };
}

const STYLES: Style[] = [
  {
    name: "cask", title: "cask", text: "a coopered cask with bulged staves, six iron hoops, a bung on the side and a recessed head", tags: ["cask", "ton", "wine barrel", "wijnvat", "whisky", "houten vat", "staves"], build: cask,
    finishes: [{ main: "oak", trim: "black_steel", accent: "light_oak" }, { main: "dark_stain", trim: "rust", accent: "oak" }, { main: "light_oak", trim: "galvanised", accent: "oak" }],
  },
  {
    name: "water-butt", title: "water butt", text: "a bulged wooden barrel with two wide flat hoops, a plank lid with a grip and a tap near the base", tags: ["water butt", "regenton", "rain barrel", "tap", "kraan"], build: waterButt,
    finishes: [{ main: "teak", trim: "black_steel", accent: "brass" }, { main: "weathered_wood", trim: "rust", accent: "copper" }, { main: "pine", trim: "galvanised", accent: "brass" }],
  },
  {
    name: "steel-drum", title: "steel drum", text: "a 208 litre tight-head steel drum with rolled chimes, two rolling hoops, pressed beads, a label and two bungs in the top head", tags: ["oil drum", "olievat", "steel drum", "stalen vat", "55 gallon"], build: steelDrum,
    finishes: [{ main: "paint_blue", trim: "galvanised", accent: "paint_white" }, { main: "paint_red", trim: "galvanised", accent: "paint_white" }, { main: "paint_black", trim: "galvanised", accent: "paint_yellow" }],
  },
  {
    name: "open-drum", title: "open-head drum", text: "an open-head steel drum with four pressed ribs and a lid held by a clamp ring with a lever bolt", tags: ["open head drum", "spannringvat", "clamp ring", "steel drum"], build: openDrum,
    finishes: [{ main: "paint_yellow", trim: "galvanised", accent: "paint_black" }, { main: "paint_green", trim: "steel", accent: "paint_white" }, { main: "rust", trim: "rust", accent: "paint_grey" }],
  },
  {
    name: "plastic-drum", title: "plastic drum", text: "a blow-moulded plastic drum with rounded shoulders, moulded handling rings, two rolling ribs and screw bungs on top", tags: ["plastic drum", "kunststof vat", "hdpe", "chemical drum"], build: plasticDrum,
    finishes: [{ main: "hdpe_blue", trim: "hdpe_white", accent: "paint_white" }, { main: "hdpe_white", trim: "hdpe_blue", accent: "paint_red" }, { main: "hdpe_black", trim: "hdpe_grey", accent: "paint_yellow" }],
  },
  {
    name: "open-plastic", title: "open-top plastic drum", text: "a slightly tapered ribbed plastic drum with moulded side grips and a lid held by a clamp ring", tags: ["open top drum", "plastic drum", "food drum", "kunststof vat"], build: openPlasticDrum,
    finishes: [{ main: "hdpe_blue", trim: "galvanised", accent: "hdpe_blue" }, { main: "hdpe_white", trim: "hdpe_black", accent: "hdpe_white" }, { main: "plastic_green", trim: "galvanised", accent: "plastic_green" }],
  },
];

function barrel(style: Style, f: Finish): AssetDraft {
  const { nodes, params } = style.build(f);
  const fin = finishName(f.main);
  return {
    slug: slugify("barrel", style.name, fin),
    title: cap(`${fin} ${style.title}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}. It stands upright on y = 0 and its label or tap faces +z.`,
    tags: [...style.tags, ...finishTags(f.main)],
    params,
    materials: useMats(f.main, f.trim, f.accent, "hole", worn(f.main), "rust_streak"),
    nodes,
  };
}

export const barrelFamily: Family = {
  id: "barrel",
  category: "storage",
  archetype: "prop.barrel",
  tags: ["barrel", "drum", "vat", "ton", "storage", "opslag"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => barrel(s, f))),
};
