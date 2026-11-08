import { box, cap, cyl, extrude, group, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { dark, finishName, finishTags, grimy, stencil, useMats } from "./common.js";

type Kind = "20ft" | "40ft" | "high-cube" | "open-side" | "reefer";

interface Shape {
  kind: Kind;
  title: string;
  text: string;
  length: number;
  height: number;
  pitch: number;
  /** Depth of the corrugations: deep trapezoids on a dry box, shallow ribs on a reefer. */
  depth: number;
  tags: string[];
  colours: string[];
}

const SHAPES: Shape[] = [
  { kind: "20ft", title: "20 ft shipping container", text: "a 20 ft ISO dry container", length: 6.058, height: 2.591, pitch: 0.278, depth: 0.036, tags: ["20ft", "20 voet", "teu"], colours: ["container_red", "container_blue", "container_green", "container_orange"] },
  { kind: "40ft", title: "40 ft shipping container", text: "a 40 ft ISO dry container", length: 12.192, height: 2.591, pitch: 0.278, depth: 0.036, tags: ["40ft", "40 voet", "feu"], colours: ["container_grey", "container_teal", "container_yellow"] },
  { kind: "high-cube", title: "40 ft high cube container", text: "a 40 ft high cube container, a foot taller than standard", length: 12.192, height: 2.896, pitch: 0.278, depth: 0.036, tags: ["high cube", "hc", "40ft", "hoog"], colours: ["container_blue", "container_red", "container_white"] },
  { kind: "open-side", title: "20 ft open side container", text: "a 20 ft open side container whose whole right side opens on bi-folding leaves, here swung open to show the timber floor inside", length: 6.058, height: 2.591, pitch: 0.278, depth: 0.036, tags: ["open side", "zijopening", "side door", "20ft"], colours: ["container_green", "container_orange", "container_grey"] },
  { kind: "reefer", title: "40 ft reefer container", text: "a 40 ft refrigerated container with smooth ribbed walls and a refrigeration unit with a fan, grille and control panel in its front wall", length: 12.192, height: 2.896, pitch: 0.1, depth: 0.012, tags: ["reefer", "koelcontainer", "refrigerated", "gekoeld"], colours: ["container_white", "tank_silver", "container_grey"] },
];

/** The trapezoid corrugations of one side wall at x = $sx * ($W / 2 - 0.047). */
function sideHats(name: string, sx: 1 | -1, ink: string): SpecNode {
  const x = (d: string): string => `${sx} * ($W / 2 - 0.047 + ${d})`;
  return group(name, [
    extrude("Hat_{i}", [[x("0"), "-$pitch * 0.37"], [x("0"), "$pitch * 0.37"], [x("$hd"), "$pitch * 0.13"], [x("$hd"), "-$pitch * 0.13"]], 0.17, "$H - 0.066", {
      at: [0, 0, "($za + $zb) / 2 - ($nc - 1) / 2 * $pitch"], repeat: { count: "$nc", step: [0, 0, "$pitch"] },
    }),
    ...STREAKS.map(([t, h, w], k) =>
      box(`Streak_${k + 1}`, [0.004, `${h}`, w], { at: [x("$hd + 0.001"), `$H - 0.075 - ${h} / 2`, `$L * ${t}`], material: "rust_streak" })),
    box("Code", [0.004, 0.11, 0.9], { at: [x("$hd + 0.001"), "$H - 0.36", "$zr + 0.95"], material: ink }),
    box("Size", [0.004, 0.08, 0.4], { at: [x("$hd + 0.001"), "$H - 0.52", "$zr + 0.7"], material: ink }),
    box("Dirt", [0.004, 0.22, "$L - 0.66"], { at: [x("$hd + 0.001"), 0.28, 0.07], material: "grime_film" }),
  ], { vars: { za: "$zr + 0.31", zb: "$zf - 0.17", nc: "floor(($L - 0.48) / $pitch)" } });
}

/** Rust run-offs under the top rail: [position along z as a fraction of the length, length down the wall, width]. */
const STREAKS: [number, number, number][] = [[-0.41, 0.55, 0.05], [-0.27, 0.9, 0.035], [-0.09, 0.4, 0.06], [0.12, 0.75, 0.04], [0.3, 0.5, 0.03], [0.42, 1.1, 0.05]];

/** The carrier's name stencilled along a side wall, read from outside. */
function sideText(sx: 1 | -1, word: string, ink: string): SpecNode {
  return stencil(sx > 0 ? "Lettering_L" : "Lettering_R", word, sx > 0 ? "+x" : "-x", [`${sx} * ($W / 2 - 0.047 + $hd + 0.001)`, "$H * 0.52", "$L * 0.04"], 0.1, ink);
}

/** Stencilled owner code and size/type code on the right door leaf, and a CSC plate on the left. */
function doorMarks(ink: string): SpecNode[] {
  const z = "$zr + 0.0595";
  return [
    group("Marks", [
      box("Code", [0.4, 0.07, 0.004], { at: [0.47, "$H - 0.42", z], material: ink }),
      box("Check", [0.06, 0.07, 0.004], { at: [0.74, "$H - 0.42", z], material: ink }),
      box("Type", [0.24, 0.055, 0.004], { at: [0.39, "$H - 0.52", z], material: ink }),
      box("MaxGross", [0.3, 0.035, 0.004], { at: [0.42, "$H * 0.42", z], material: ink }),
      box("Tare", [0.26, 0.035, 0.004], { at: [0.4, "$H * 0.42 - 0.06", z], material: ink }),
      box("CscPlate", [0.22, 0.13, 0.006], { at: [-0.47, "$H * 0.5", z], material: "galvanised", bevel: 0.002 }),
    ]),
  ];
}

/** A corner casting with its three oval apertures. */
function casting(name: string, y: string, z: string, top: boolean, front: boolean, mirror: string, cast: string): SpecNode {
  return group(name, [
    box("Block", [0.162, 0.118, 0.178], { bevel: 0.006, material: cast }),
    cyl("HoleSide", 0.032, 0.006, { axis: "x", at: [0.08, 0, 0], segments: 12, material: "hole" }),
    cyl("HoleEnd", 0.03, 0.006, { axis: "z", at: [0, 0, front ? 0.088 : -0.088], segments: 12, material: "hole" }),
    cyl("HoleTop", 0.03, 0.006, { at: [0, top ? 0.058 : -0.058, 0], segments: 12, material: "hole" }),
  ], { at: ["$W / 2 - 0.0816", y, z], mirror });
}

/** One rear door leaf, hinged at its outer edge, with corrugated panels, locking bars, cams, guides, handles and hinges. */
function doorLeaf(): SpecNode {
  return group("Door_L", [
    group("Leaf", [
      box("Top", ["$dw", 0.11, 0.05], { at: ["-0.05 - $dw / 2", "$dh / 2 - 0.055", 0.04] }),
      box("Bottom", ["$dw", 0.13, 0.05], { at: ["-0.05 - $dw / 2", "-$dh / 2 + 0.065", 0.04] }),
      box("Outer", [0.07, "$dh", 0.05], { at: [-0.085, 0, 0.04] }),
      box("Inner", [0.07, "$dh", 0.05], { at: ["-$dw - 0.015", 0, 0.04] }),
      box("Panel", ["$dw - 0.13", "$dh - 0.23", 0.02], { at: ["-0.05 - $dw / 2", 0.01, 0.045] }),
      extrude("Hat_{i}", [[-0.095, 0.036], [0.095, 0.036], [0.0325, 0.016], [-0.0325, 0.016]], 0.12, "$dw - 0.03", { rotate: [0, 0, 90], at: [0, "-2 * ($dh - 0.23) / 5 + 0.01", 0], repeat: { count: 5, step: [0, "($dh - 0.23) / 5", 0] } }),
    ]),
    box("Seal", [0.014, "$dh", 0.04], { at: ["-$dw - 0.053", 0, 0.045], material: "rubber" }),
    group("Bar_{i}", [
      cyl("Rod", 0.0165, "$dh + 0.1", { segments: 10 }),
      box("CamTop", [0.05, 0.05, 0.045], { at: [0, "$dh / 2 + 0.05", 0.004] }),
      box("CamLow", [0.05, 0.05, 0.045], { at: [0, "-$dh / 2 - 0.05", 0.004] }),
      box("GuideTop", [0.075, 0.035, 0.06], { at: [0, "$dh / 2 - 0.1", -0.005] }),
      box("GuideMid", [0.075, 0.035, 0.06], { at: [0, "$dh * 0.12", -0.005] }),
      box("GuideLow", [0.075, 0.035, 0.06], { at: [0, "-$dh / 2 + 0.1", -0.005] }),
      cyl("Hub", 0.026, 0.07, { segments: 12, at: [0, "1.05 - $H / 2", 0] }),
      tube("Handle", [[0.015, "1.05 - $H / 2", -0.012], [0.07, "1.05 - $H / 2", -0.022], [0.3, "1.05 - $H / 2", -0.022], [0.33, "1.05 - $H / 2", -0.012]], 0.011, { segments: 8 }),
      box("Catch", [0.04, 0.07, 0.045], { at: [0.35, "1.05 - $H / 2", 0.012] }),
    ], { at: [-0.42, 0, -0.007], repeat: { count: 2, step: ["-($dw - 0.55)", 0, 0] }, material: "galvanised" }),
    group("Hinge_{i}", [
      box("Blade", [0.13, 0.07, 0.016], { at: [-0.06, 0, 0.006] }),
      cyl("Knuckle", 0.022, 0.1, { segments: 12 }),
    ], { at: [0, "-$dh * 0.42", 0], repeat: { count: 4, step: [0, "$dh * 0.28", 0] } }),
  ], { at: ["$W / 2 - 0.03", "$H / 2", "$zr + 0.045"], vars: { dw: "$W / 2 - 0.084", dh: "$H - 0.26" }, mirror: "Door_R" });
}

function frame(shape: Shape, colour: string): SpecNode[] {
  const open = shape.kind === "open-side";
  const rail = (name: string, size: [string | number, string | number, string | number], at: [string | number, string | number, string | number], mirror?: string): SpecNode =>
    box(name, size, { at, ...(mirror && !open ? { mirror } : {}) });
  return [
    group("Frame", [
      box("PostFront_L", [0.15, "$H - 0.236", 0.15], { at: ["$W / 2 - 0.078", "$H / 2", "$zf - 0.078"], mirror: "PostFront_R" }),
      box("PostRear_L", [0.07, "$H - 0.236", 0.24], { at: ["$W / 2 - 0.038", "$H / 2", "$zr + 0.18"], mirror: "PostRear_R" }),
      rail("TopRail_L", [open ? 0.12 : 0.07, open ? 0.1 : 0.06, "$L - 0.356"], [open ? "$W / 2 - 0.064" : "$W / 2 - 0.044", open ? "$H - 0.056" : "$H - 0.036", 0], "TopRail_R"),
      { ...rail("BottomRail_L", [open ? 0.1 : 0.05, 0.158, "$L - 0.356"], [open ? "$W / 2 - 0.054" : "$W / 2 - 0.028", 0.0915, 0], "BottomRail_R"), material: grimy(colour) },
      ...(open
        ? [box("TopRail_R", [0.07, 0.06, "$L - 0.356"], { at: ["-$W / 2 + 0.044", "$H - 0.036", 0] }), box("BottomRail_R", [0.05, 0.158, "$L - 0.356"], { at: ["-$W / 2 + 0.028", 0.0915, 0], material: grimy(colour) })]
        : []),
      box("FrontHeader", ["$W - 0.324", 0.1, 0.06], { at: [0, "$H - 0.056", "$zf - 0.033"] }),
      box("FrontSill", ["$W - 0.324", 0.15, 0.06], { at: [0, 0.0875, "$zf - 0.033"], material: grimy(colour) }),
      box("RearHeader", ["$W - 0.324", 0.2, 0.15], { at: [0, "$H - 0.105", "$zr + 0.185"] }),
      box("RearSill", ["$W - 0.324", 0.19, 0.15], { at: [0, 0.1075, "$zr + 0.185"], material: grimy(colour) }),
      casting("Casting_FTL", "$H - 0.0596", "$zf - 0.0896", true, true, "Casting_FTR", dark(colour)),
      casting("Casting_FBL", "0.0596", "$zf - 0.0896", false, true, "Casting_FBR", dark(colour)),
      casting("Casting_RTL", "$H - 0.0596", "$zr + 0.0896", true, false, "Casting_RTR", dark(colour)),
      casting("Casting_RBL", "0.0596", "$zr + 0.0896", false, false, "Casting_RBR", dark(colour)),
      ...(shape.length < 7
        ? [group("Pocket_L{i}", [
            box("Lip", [0.012, 0.15, 0.4]),
            box("Mouth", [0.006, 0.115, 0.36], { at: [0.004, 0, 0], material: "hole" }),
          ], { at: [open ? "$W / 2 + 0.002" : "$W / 2 - 0.009", 0.09, -1.025], repeat: { count: 2, step: [0, 0, 2.05] }, mirror: "Pocket_R{i}" })]
        : []),
      group("Keeper_L{i}", [
        box("Top", [0.09, 0.075, 0.07], { at: [0, "$H - 0.105", 0] }),
        box("Low", [0.09, 0.075, 0.07], { at: [0, 0.1075, 0] }),
      ], { at: ["$W / 2 - 0.45", 0, "$zr + 0.075"], repeat: { count: 2, step: ["-($W / 2 - 0.084 - 0.55)", 0, 0] }, mirror: "Keeper_R{i}", material: "galvanised" }),
    ]),
  ];
}

/** The front end: corrugated wall, or a refrigeration unit on a reefer. */
function frontEnd(shape: Shape): SpecNode[] {
  if (shape.kind !== "reefer") {
    return [group("Wall_F", [
      extrude("Hat_{i}", [[-0.1025, "$zf - 0.052"], [0.1025, "$zf - 0.052"], [0.035, "$zf - 0.018"], [-0.035, "$zf - 0.018"]], 0.16, "$H - 0.105", { at: ["-3 * 0.278", 0, 0], repeat: { count: 7, step: [0.278, 0, 0] } }),
    ])];
  }
  return [group("Unit", [
    box("Panel", ["$W - 0.3", "$H - 0.24", 0.05], { at: [0, "$H / 2", "$zf - 0.03"], material: "paint_grey" }),
    box("Grille_{i}", [0.9, 0.025, 0.03], { at: [-0.45, 0.45, "$zf - 0.002"], repeat: { count: 12, step: [0, 0.055, 0] }, material: "black_steel" }),
    cyl("FanRing", 0.36, 0.05, { axis: "z", at: [0.5, "$H * 0.62", "$zf - 0.01"], segments: 28, material: "black_steel" }),
    cyl("FanHole", 0.32, 0.01, { axis: "z", at: [0.5, "$H * 0.62", "$zf + 0.012"], segments: 28, material: "hole" }),
    box("Guard_{i}", [0.66, 0.012, 0.012], { at: [0.5, "$H * 0.62 - 0.24", "$zf + 0.018"], repeat: { count: 5, step: [0, 0.12, 0] }, material: "galvanised" }),
    box("Control", [0.42, 0.36, 0.1], { at: [-0.5, "$H * 0.66", "$zf"], material: "paint_white", bevel: 0.01 }),
    box("Display", [0.16, 0.08, 0.01], { at: [-0.5, "$H * 0.66 + 0.06", "$zf + 0.05"], material: "screen_green" }),
    box("Hatch_{i}", [0.3, 0.3, 0.02], { at: [-0.65, 0.35, "$zf"], repeat: { count: 2, step: [0.35, 0, 0] }, material: "paint_white", bevel: 0.006 }),
    cyl("Plug", 0.04, 0.12, { axis: "z", at: [0.95, 0.35, "$zf"], segments: 12, material: "paint_orange" }),
  ])];
}

/** The insides that show through an open side, and the leaves swung open on their hinges at both ends. */
function openSide(): SpecNode[] {
  const leaf = (name: string, z: string, ry: number, dir: 1 | -1): SpecNode =>
    group(name, [
      box("Panel", [0.04, "$H - 0.36", "$lw"], { at: [0, "($H - 0.36) / 2", `${-dir} * $lw / 2`] }),
      box("Fold", [0.04, "$H - 0.36", "$lw"], { at: [0.05, "($H - 0.36) / 2", `${-dir} * $lw / 2`] }),
      box("Rib_{i}", [0.03, "$H - 0.42", 0.06], { at: [-0.03, "($H - 0.36) / 2", `${-dir} * 0.15`], repeat: { count: 4, step: [0, 0, `${-dir} * ($lw - 0.3) / 3`] } }),
      cyl("Knuckle_{i}", 0.025, 0.12, { at: [0, 0.3, 0], repeat: { count: 3, step: [0, "($H - 0.96) / 2", 0] }, segments: 10, material: "galvanised" }),
    ], { at: ["$W / 2 + 0.03", 0.18, z], rotate: [0, ry, 0], vars: { lw: "($L - 0.6) / 4" } });
  return [
    leaf("Shutter_F", "$zf - 0.16", -90, 1),
    leaf("Shutter_B", "$zr + 0.31", 90, -1),
  ];
}

function body(shape: Shape, colour: string): SpecNode {
  if (shape.kind !== "open-side") return box("Body", ["$W - 0.09", "$H - 0.042", "$L - 0.16"], { at: [0, "0.012 + ($H - 0.042) / 2", "($zf - 0.05 + $zr + 0.11) / 2"], material: dark(colour) });
  return group("Body", [
    box("Floor", ["$W - 0.06", 0.03, "$L - 0.3"], { at: [0, 0.17, 0], material: "dark_stain" }),
    box("Ceiling", ["$W - 0.09", 0.03, "$L - 0.3"], { at: [0, "$H - 0.07", 0], material: dark(colour) }),
    box("Lining", [0.03, "$H - 0.2", "$L - 0.3"], { at: ["-$W / 2 + 0.06", "$H / 2", 0], material: dark(colour) }),
    box("FrontLining", ["$W - 0.09", "$H - 0.2", 0.03], { at: [0, "$H / 2", "$zf - 0.07"] }),
    box("RearLining", ["$W - 0.09", "$H - 0.2", 0.03], { at: [0, "$H / 2", "$zr + 0.2"] }),
    box("Crossmember", [0.05, 0.1, "$L - 0.4"], { at: [0, 0.1, 0], material: "black_steel" }),
  ]);
}

function container(shape: Shape, colour: string): AssetDraft {
  const fin = finishName(colour);
  const ink = colour === "container_white" || colour === "tank_silver" || colour === "container_yellow" ? "paint_anthracite" : "label_white";
  const word = ["NORDCARGO", "SEALINE", "TRANSOCEAN", "ATLANTIC"][(colour.length + shape.kind.length) % 4] as string;
  const nodes: SpecNode[] = [
    group("Container", [
      body(shape, colour),
      ...(shape.kind === "open-side" ? [sideHats("Wall_R", -1, ink)] : [{ ...sideHats("Wall_L", 1, ink), mirror: "Wall_R" }]),
      ...frontEnd(shape),
      group("Roof", [
        extrude("Bow_{i}", [[0, -0.09], [0, 0.09], [0.018, 0.05], [0.018, -0.05]], "-$W / 2 + 0.08", "$W / 2 - 0.08", { rotate: [0, 0, 90], at: [0, "$H - 0.031", "-($nr - 1) / 2 * 0.3 + 0.03"], repeat: { count: "$nr", step: [0, 0, 0.3] } }),
      ], { vars: { nr: "floor(($L - 0.5) / 0.3)" } }),
      ...frame(shape, colour),
      ...doorMarks(ink),
      ...(shape.kind === "open-side" ? [] : [sideText(1, word, ink)]),
      sideText(-1, word, ink),
      ...(shape.kind === "open-side" ? openSide() : []),
      doorLeaf(),
    ], { material: colour, vars: { W: 2.438, H: "$height", L: "$length", zf: "$length / 2", zr: "-$length / 2", pitch: "$pitch", hd: shape.depth } }),
  ];
  return {
    slug: slugify("shipping-container", shape.kind, fin),
    title: cap(`${fin} ${shape.title}`),
    description: `${cap(fin)} ${shape.text}: corrugated steel walls and roof, corner posts and castings with apertures, and double doors at the back (-z) with locking bars, cams and handles. Its closed front end faces +z.`,
    tags: [...shape.tags, ...finishTags(colour)],
    params: [
      num("length", shape.length, shape.length < 7 ? 6.0 : 9.0, shape.length < 7 ? 9.2 : 12.2, "Outer length along z in metres (6.058 is 20 ft, 12.192 is 40 ft)."),
      num("height", shape.height, 2.59, 2.9, "Outer height in metres (2.591 standard, 2.896 high cube)."),
      num("pitch", shape.pitch, shape.pitch * 0.85, shape.pitch * 1.15, "Spacing of the wall corrugations in metres."),
    ] satisfies ParamDef[],
    materials: useMats(colour, dark(colour), grimy(colour), ink, "rust_streak", "grime_film", "galvanised", "rubber", "hole", "black_steel", ...(shape.kind === "reefer" ? ["paint_grey", "paint_white", "screen_green", "paint_orange"] : []), ...(shape.kind === "open-side" ? ["dark_stain"] : [])),
    nodes,
  };
}

export const shippingContainerFamily: Family = {
  id: "shipping-container",
  category: "storage",
  archetype: "prop.shipping-container",
  tags: ["shipping container", "container", "zeecontainer", "iso container", "cargo", "intermodal", "haven", "port"],
  assets: () => SHAPES.flatMap((s) => s.colours.map((c) => container(s, c))),
};
