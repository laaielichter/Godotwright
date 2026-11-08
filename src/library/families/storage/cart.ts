import { box, cap, cyl, ellipsoid, group, lathe, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, useMats } from "./common.js";

type Finish = { main: string; trim: string; load?: string };
interface Style {
  name: string;
  title: string;
  text: string;
  tags: string[];
  params: ParamDef[];
  finishes: Finish[];
  build: (f: Finish) => SpecNode[];
}

/**
 * A wheel at its hub, turning about x: a tyre of radius `r` (an expression) and width `w`, a rim, spokes and a hub.
 * "pneumatic": a fat rubber tyre on a steel rim; "spoked": an iron-tyred wooden cart wheel; "caster": a small solid wheel.
 */
function wheel(name: string, at: Vec, kind: "pneumatic" | "spoked" | "caster", f: Finish, mirror?: string): SpecNode {
  const ring = (n: string, r0: string, r1: string, w: string, material: string): SpecNode =>
    lathe(n, [[r0, `-${w} / 2`], [r1, `-${w} / 2`], [r1, `${w} / 2`], [r0, `${w} / 2`], [r0, `-${w} / 2`]], { segments: 24, caps: false, rotate: [0, 0, 90], material });
  const parts: SpecNode[] =
    kind === "pneumatic"
      ? [
          lathe("Tyre", [["$r * 0.62", "-$tw / 2"], ["$r * 0.85", "-$tw / 2"], ["$r * 0.97", "-$tw * 0.4"], ["$r", "-$tw * 0.15"], ["$r", "$tw * 0.15"], ["$r * 0.97", "$tw * 0.4"], ["$r * 0.85", "$tw / 2"], ["$r * 0.62", "$tw / 2"], ["$r * 0.62", "-$tw / 2"]], { segments: 24, caps: false, rotate: [0, 0, 90], material: "rubber" }),
          cyl("Rim", "$r * 0.64", "$tw * 0.7", { axis: "x", segments: 24, material: f.trim }),
          cyl("Hub", "$r * 0.2", "$tw * 1.1", { axis: "x", segments: 12, material: "steel", bevel: 0.004 }),
        ]
      : kind === "spoked"
        ? [
            ring("Tyre", "$r - 0.012", "$r", "$tw", "black_steel"),
            ring("Felloe", "$r * 0.85", "$r - 0.01", "$tw * 0.9", f.main),
            box("Spoke_{i}", ["$tw * 0.35", "$r * 0.82", 0.025], { at: [0, "$r * 0.45", 0], repeat: { count: 10, around: "x" }, material: f.main }),
            cyl("Hub", "$r * 0.16", "$tw * 1.6", { axis: "x", segments: 14, material: f.main, bevel: 0.01 }),
            cyl("Cap", "$r * 0.08", "$tw * 1.8", { axis: "x", segments: 10, material: "black_steel" }),
          ]
        : [
            cyl("Tyre", "$r", "$tw", { axis: "x", segments: 20, material: "rubber", bevel: "$tw * 0.25" }),
            cyl("Core", "$r * 0.6", "$tw * 1.06", { axis: "x", segments: 16, material: f.trim }),
            cyl("Hub", "$r * 0.22", "$tw * 1.2", { axis: "x", segments: 10, material: "steel" }),
          ];
  return group(name, parts, { at, ...(mirror ? { mirror } : {}) });
}

/** A builder's wheelbarrow: a sloped tray on two handle rails, one pneumatic wheel at the front and two legs. */
function wheelbarrow(f: Finish): SpecNode[] {
  const sec = (z: string, low: string) => ({
    z,
    points: [["-$W * 0.3 + 0.02", low], ["$W * 0.3 - 0.02", low], ["$W * 0.3 + 0.004", `${low} + 0.02`], ["$W / 2 - 0.004", "$y1 - 0.012"], ["$W / 2 - 0.012", "$y1"], ["-$W / 2 + 0.012", "$y1"], ["-$W / 2 + 0.004", "$y1 - 0.012"], ["-$W * 0.3 - 0.004", `${low} + 0.02`]],
  });
  const inner = (z: string) => ({ z, points: [["-$W * 0.46", "$y1 - 0.004"], ["$W * 0.46", "$y1 - 0.004"], ["$W * 0.46", "$y1 + 0.003"], ["-$W * 0.46", "$y1 + 0.003"]] });
  return [
    group("Wheelbarrow", [
      wheel("Wheel", [0, "$r", "$L / 2 - $r"], "pneumatic", f),
      cyl("Axle", 0.012, 0.16, { axis: "x", at: [0, "$r", "$L / 2 - $r"], segments: 8, material: "steel" }),
      group("Body", [
        loft("Tray", [sec("-$L * 0.24", "$y0"), sec("$L * 0.08", "$y0"), sec("$L * 0.3", "$y1 - 0.1")]),
        loft("Inside", [inner("-$L * 0.23"), inner("$L * 0.28")], { material: f.load ?? "paint_anthracite" }),
        tube("Lip", [["-$W / 2", "$y1", "-$L * 0.24"], ["$W / 2", "$y1", "-$L * 0.24"], ["$W / 2", "$y1", "$L * 0.3"], ["-$W / 2", "$y1", "$L * 0.3"], ["-$W / 2", "$y1", "-$L * 0.24"]], 0.012, { segments: 8 }),
        ...(f.load ? [ellipsoid("Heap", ["$W * 0.42", 0.08, "$L * 0.22"], { at: [0, "$y1", "$L * 0.03"], segments: 16, lumps: 0.15, seed: 7, material: f.load })] : []),
      ]),
      group("Handle_L", [
        tube("Rail", [[0.055, "$r", "$L / 2 - $r"], ["$W * 0.28", "$y0 - 0.02", "$L * 0.12"], ["$W * 0.3", "$y0 - 0.02", "-$L * 0.2"], ["$W * 0.33", 0.52, "-$L / 2 + 0.06"]], 0.016, { segments: 8, material: f.trim }),
        tube("Grip", [["$W * 0.325", 0.5, "-$L / 2 + 0.17"], ["$W * 0.33", 0.522, "-$L / 2 + 0.03"]], 0.02, { segments: 10, material: "rubber" }),
        tube("Stand", [["$W * 0.3", "$y0 - 0.02", "-$L * 0.17"], ["$W * 0.32", 0.03, "-$L * 0.22"]], 0.013, { segments: 8, material: f.trim }),
        box("Foot", [0.04, 0.025, 0.08], { at: ["$W * 0.32", 0.0125, "-$L * 0.22"], material: "rubber" }),
      ], { mirror: "Handle_R" }),
    ], { material: f.main, vars: { L: "$length", W: "$width", r: "$wheel", tw: "$wheel * 0.42", y0: "$wheel * 1.9", y1: "$wheel * 1.9 + 0.26" } }),
  ];
}

/** A two-wheeled wooden handcart: a plank bed with side boards on a pair of spoked wheels, shafts forward and a prop leg. */
function handcart(f: Finish): SpecNode[] {
  return [
    group("Handcart", [
      wheel("Wheel_L", ["$W / 2 + 0.07", "$r", 0], "spoked", f, "Wheel_R"),
      cyl("Axle", 0.025, "$W + 0.22", { axis: "x", at: [0, "$r", 0], segments: 10, material: "black_steel" }),
      group("Body", [
        box("Bed", ["$W", 0.04, "$L * 0.62"], { at: [0, "$r + 0.04", "-$L * 0.06"], bevel: 0.005 }),
        box("Plank_{i}", [0.004, 0.041, "$L * 0.62"], { at: ["-$W / 2 + $W / 5", "$r + 0.04", "-$L * 0.06"], repeat: { count: 4, step: ["$W / 5", 0, 0] }, material: "hole" }),
        box("Bolster", ["$W + 0.04", 0.08, 0.1], { at: [0, "$r + 0.0", 0], bevel: 0.005 }),
        box("Side_L", [0.03, 0.18, "$L * 0.62"], { at: ["$W / 2 - 0.015", "$r + 0.15", "-$L * 0.06"], bevel: 0.005, mirror: "Side_R" }),
        box("Tail", ["$W - 0.06", 0.18, 0.03], { at: [0, "$r + 0.15", "-$L * 0.37 + 0.015"], bevel: 0.005 }),
        box("Stake_L{i}", [0.04, 0.24, 0.04], { at: ["$W / 2 - 0.035", "$r + 0.14", "-$L * 0.33"], repeat: { count: 3, step: [0, 0, "$L * 0.27"] }, material: f.trim, mirror: "Stake_R{i}" }),
      ]),
      group("Handle_L", [
        box("Shaft", [0.05, 0.06, "$L * 0.75"], { at: ["$W / 2 - 0.08", "$r", "$L * 0.125"], bevel: 0.008 }),
      ], { mirror: "Handle_R" }),
      box("Crossbar", ["$W - 0.1", 0.045, 0.045], { at: [0, "$r", "$L / 2 - 0.05"], bevel: 0.008 }),
      box("Prop", [0.05, "$r", 0.05], { at: [0, "$r / 2", "$L * 0.3"], bevel: 0.005, material: f.trim }),
    ], { material: f.main, vars: { L: "$length", W: "$width", r: "$wheel", tw: 0.06 } }),
  ];
}

/** A four-wheeled wagon: a boarded box body on two axles, the front one on a steering plate with a pull tongue and T grip. */
function wagon(f: Finish): SpecNode[] {
  return [
    group("Wagon", [
      wheel("Wheel_FL", ["$W / 2 + 0.03", "$r", "$L * 0.33"], "pneumatic", f, "Wheel_FR"),
      wheel("Wheel_RL", ["$W / 2 + 0.03", "$r", "-$L * 0.33"], "pneumatic", f, "Wheel_RR"),
      cyl("Axle_F", 0.012, "$W + 0.1", { axis: "x", at: [0, "$r", "$L * 0.33"], segments: 8, material: "steel" }),
      cyl("Axle_R", 0.012, "$W + 0.1", { axis: "x", at: [0, "$r", "-$L * 0.33"], segments: 8, material: "steel" }),
      box("Bracket_F", [0.12, "$h0 - $r", 0.08], { at: [0, "($h0 + $r) / 2", "$L * 0.33"], material: "black_steel" }),
      box("Bracket_R", ["$W * 0.8", "$h0 - $r", 0.06], { at: [0, "($h0 + $r) / 2", "-$L * 0.33"], material: "black_steel" }),
      cyl("Turntable", 0.1, 0.02, { at: [0, "$h0 - 0.01", "$L * 0.33"], segments: 16, material: "black_steel" }),
      group("Body", [
        box("Floor", ["$W", 0.03, "$L"], { at: [0, "$h0 + 0.015", 0], bevel: 0.004 }),
        box("Board_L", [0.02, "$sh", "$L"], { at: ["$W / 2 - 0.01", "$h0 + $sh / 2", 0], bevel: 0.004, mirror: "Board_R" }),
        box("Board_F", ["$W - 0.04", "$sh", 0.02], { at: [0, "$h0 + $sh / 2", "$L / 2 - 0.01"], bevel: 0.004 }),
        box("Board_B", ["$W - 0.04", "$sh", 0.02], { at: [0, "$h0 + $sh / 2", "-$L / 2 + 0.01"], bevel: 0.004 }),
        box("Cap_L", [0.04, 0.02, "$L + 0.02"], { at: ["$W / 2 - 0.01", "$h0 + $sh", 0], material: f.trim, bevel: 0.004, mirror: "Cap_R" }),
        box("Slot_L{i}", [0.022, "$sh * 0.3", 0.08], { at: ["$W / 2 - 0.01", "$h0 + $sh * 0.6", "-$L * 0.3"], repeat: { count: 3, step: [0, 0, "$L * 0.3"] }, material: "hole", mirror: "Slot_R{i}" }),
      ]),
      group("Handle", [
        tube("Tongue", [[0, "$r", "$L * 0.33 + 0.04"], [0, "$r + 0.04", "$L / 2 + 0.2"], [0, "$r + 0.25", "$L / 2 + 0.55"]], 0.014, { segments: 8 }),
        cyl("Grip", 0.018, 0.2, { axis: "x", at: [0, "$r + 0.26", "$L / 2 + 0.56"], segments: 10, material: "rubber" }),
      ], { material: "black_steel" }),
    ], { material: f.main, vars: { L: "$length", W: "$width", r: "$wheel", tw: "$wheel * 0.6", h0: "$wheel * 2 + 0.05", sh: 0.2 } }),
  ];
}

/** A platform trolley: a deck with a rubber mat on four swivel casters, and a tubular push handle at the back. */
function trolley(f: Finish): SpecNode[] {
  const caster = (name: string, z: string, mirror: string): SpecNode =>
    group(name, [
      box("Plate", [0.09, 0.008, 0.09], { at: [0, "2 * $r + 0.035", 0] }),
      box("Fork_L", [0.006, "$r + 0.035", "$r * 1.2"], { at: ["$tw / 2 + 0.006", "$r + 0.015", 0] }),
      box("Fork_R", [0.006, "$r + 0.035", "$r * 1.2"], { at: ["-$tw / 2 - 0.006", "$r + 0.015", 0] }),
      box("Crown", ["$tw + 0.02", 0.01, "$r * 1.2"], { at: [0, "2 * $r + 0.028", 0] }),
      wheel("Wheel", [0, "$r", 0], "caster", f),
    ], { at: ["$W / 2 - 0.07", 0, z], material: "galvanised", mirror });
  return [
    group("Trolley", [
      caster("Caster_FL", "$L / 2 - 0.08", "Caster_FR"),
      caster("Caster_RL", "-$L / 2 + 0.08", "Caster_RR"),
      group("Body", [
        box("Deck", ["$W", 0.035, "$L"], { at: [0, "$d + 0.0175", 0], bevel: 0.006 }),
        box("Mat", ["$W - 0.04", 0.008, "$L - 0.04"], { at: [0, "$d + 0.038", 0], material: "rubber" }),
        box("Edge_L", [0.02, 0.04, "$L"], { at: ["$W / 2 - 0.01", "$d + 0.02", 0], material: f.trim, mirror: "Edge_R" }),
        box("Bumper_F", ["$W", 0.04, 0.02], { at: [0, "$d + 0.02", "$L / 2 - 0.01"], material: "rubber" }),
      ]),
      group("Handle", [
        tube("Bar", [["$W / 2 - 0.04", "$d + 0.03", "-$L / 2 + 0.03"], ["$W / 2 - 0.04", "$d + 0.03 + $hh - 0.06", "-$L / 2 + 0.03"], ["$W / 2 - 0.1", "$d + $hh", "-$L / 2 + 0.03"], ["-$W / 2 + 0.1", "$d + $hh", "-$L / 2 + 0.03"], ["-$W / 2 + 0.04", "$d + 0.03 + $hh - 0.06", "-$L / 2 + 0.03"], ["-$W / 2 + 0.04", "$d + 0.03", "-$L / 2 + 0.03"]], 0.014, { segments: 10 }),
        cyl("Grip", 0.02, "$W - 0.24", { axis: "x", at: [0, "$d + $hh", "-$L / 2 + 0.03"], segments: 12, material: "rubber" }),
        box("Socket_L", [0.05, 0.08, 0.05], { at: ["$W / 2 - 0.04", "$d + 0.06", "-$L / 2 + 0.03"], mirror: "Socket_R" }),
      ], { material: f.trim }),
    ], { material: f.main, vars: { L: "$length", W: "$width", r: "$wheel", tw: "$wheel * 0.5", d: "$wheel * 2 + 0.04", hh: 0.85 } }),
  ];
}

const STYLES: Style[] = [
  {
    name: "wheelbarrow", title: "wheelbarrow", text: "a builder's wheelbarrow with a sloped tray on two tubular handle rails, a pneumatic wheel at the front, rubber grips and two legs at the back", tags: ["wheelbarrow", "kruiwagen", "garden", "tuin", "building site", "bouwplaats"], build: wheelbarrow,
    params: [num("length", 1.45, 1.2, 1.7, "Overall length along z in metres."), num("width", 0.65, 0.55, 0.8, "Width of the tray along x in metres."), num("wheel", 0.2, 0.16, 0.24, "Wheel radius in metres.")],
    finishes: [{ main: "paint_green", trim: "black_steel" }, { main: "galvanised", trim: "paint_red", load: "soil" }, { main: "paint_orange", trim: "black_steel", load: "sand" }],
  },
  {
    name: "handcart", title: "wooden handcart", text: "a two-wheeled wooden handcart with a plank bed and side boards on iron-tyred spoked wheels, shafts reaching forward to a crossbar and a prop leg", tags: ["handcart", "handkar", "bolderkar", "cart", "kar", "medieval", "farm"], build: handcart,
    params: [num("length", 2.0, 1.4, 2.6, "Overall length along z in metres."), num("width", 0.9, 0.7, 1.2, "Width of the bed along x in metres."), num("wheel", 0.4, 0.3, 0.5, "Wheel radius in metres.")],
    finishes: [{ main: "oak", trim: "black_steel" }, { main: "weathered_wood", trim: "rust" }, { main: "paint_blue", trim: "black_steel" }],
  },
  {
    name: "wagon", title: "pull wagon", text: "a four-wheeled pull wagon with a boarded box body on two axles, a steering turntable at the front and a pull tongue with a T grip", tags: ["wagon", "bolderwagen", "trekkar", "garden cart", "kids", "kinderen"], build: wagon,
    params: [num("length", 1.0, 0.8, 1.4, "Length of the body along z in metres."), num("width", 0.5, 0.45, 0.7, "Width of the body along x in metres."), num("wheel", 0.12, 0.1, 0.16, "Wheel radius in metres.")],
    finishes: [{ main: "paint_red", trim: "paint_white" }, { main: "pine", trim: "galvanised" }, { main: "paint_green", trim: "paint_yellow" }],
  },
  {
    name: "trolley", title: "platform trolley", text: "a platform trolley with a rubber-matted deck and bumper on four swivel casters, and a tubular push handle at the back", tags: ["platform trolley", "plateauwagen", "trolley", "warehouse", "magazijn", "dolly"], build: trolley,
    params: [num("length", 0.9, 0.8, 1.2, "Length of the deck along z in metres."), num("width", 0.6, 0.5, 0.8, "Width of the deck along x in metres."), num("wheel", 0.07, 0.05, 0.1, "Caster wheel radius in metres.")],
    finishes: [{ main: "paint_blue", trim: "paint_blue" }, { main: "birch", trim: "galvanised" }, { main: "paint_yellow", trim: "black_steel" }],
  },
];

function cart(style: Style, f: Finish): AssetDraft {
  const fin = finishName(f.main);
  return {
    slug: slugify("cart", style.name, fin, ...(f.load ? [f.load] : [])),
    title: cap(`${fin} ${style.title}${f.load ? ` with ${f.load}` : ""}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}${f.load ? `, loaded with ${f.load}` : ""}. It runs along z with its front towards +z.`,
    tags: [...style.tags, ...finishTags(f.main), ...(f.load ? [f.load, f.load === "sand" ? "zand" : "aarde"] : [])],
    params: style.params,
    materials: useMats(f.main, f.trim, f.load, "rubber", "steel", "black_steel", "galvanised", "hole", "paint_anthracite"),
    nodes: style.build(f),
  };
}

export const cartFamily: Family = {
  id: "cart",
  category: "storage",
  archetype: "vehicle.wheeled.cart",
  tags: ["cart", "kar", "wagen", "trolley", "barrow", "wheels", "wielen", "transport"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => cart(s, f))),
};
