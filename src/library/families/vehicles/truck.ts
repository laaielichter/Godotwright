import { box, cyl, group, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { carPaint, f, VMATS, wheel, WHEEL_MATS } from "./parts.js";

type Cargo = "box" | "flatbed" | "tipper" | "tanker";
type CabKind = "cabover" | "bonnet";

interface TruckDef {
  cargo: Cargo;
  cab: CabKind;
  /** Axle layout: rear axles with twin wheels, and front steering axles. */
  rear: 1 | 2;
  front: 1 | 2;
  length: [number, number, number];
  cargoH: [number, number, number];
  cab_: MaterialDef;
  cabName: string;
  nl: string;
  body: string;
  bodyName: string;
  roofSpoiler?: boolean;
}

const C = (r: number, g: number, b: number, m = 0.2): MaterialDef => carPaint(r, g, b, m, 0.3);

const TRUCKS: TruckDef[] = [
  { cargo: "box", cab: "cabover", rear: 1, front: 1, length: [8.2, 7.2, 9.4], cargoH: [2.45, 2.1, 2.65], cab_: C(0.62, 0.62, 0.6), cabName: "white", nl: "wit", body: "box_white", bodyName: "white box", roofSpoiler: true },
  { cargo: "box", cab: "cabover", rear: 1, front: 1, length: [7.4, 6.6, 8.6], cargoH: [2.3, 2.0, 2.6], cab_: C(0.34, 0.022, 0.02), cabName: "red", nl: "rood", body: "box_blue", bodyName: "blue box" },
  { cargo: "box", cab: "cabover", rear: 2, front: 1, length: [10.0, 9.0, 11.5], cargoH: [2.55, 2.2, 2.7], cab_: C(0.022, 0.06, 0.2, 0.3), cabName: "blue", nl: "blauw", body: "box_white", bodyName: "white box", roofSpoiler: true },
  { cargo: "box", cab: "bonnet", rear: 2, front: 1, length: [10.5, 9.5, 11.8], cargoH: [2.5, 2.2, 2.65], cab_: C(0.02, 0.02, 0.022, 0.3), cabName: "black", nl: "zwart", body: "box_grey", bodyName: "aluminium box" },
  { cargo: "flatbed", cab: "cabover", rear: 1, front: 1, length: [8.0, 7.0, 9.2], cargoH: [1.0, 0.5, 1.4], cab_: C(0.6, 0.38, 0.02), cabName: "yellow", nl: "geel", body: "deck_wood", bodyName: "timber deck" },
  { cargo: "flatbed", cab: "cabover", rear: 2, front: 1, length: [10.0, 9.0, 11.5], cargoH: [1.2, 0.6, 1.6], cab_: C(0.02, 0.09, 0.04), cabName: "green", nl: "groen", body: "deck_steel", bodyName: "steel deck" },
  { cargo: "flatbed", cab: "bonnet", rear: 2, front: 1, length: [10.2, 9.4, 11.6], cargoH: [1.1, 0.6, 1.5], cab_: C(0.3, 0.02, 0.018), cabName: "red", nl: "rood", body: "deck_wood", bodyName: "timber deck" },
  { cargo: "tipper", cab: "cabover", rear: 1, front: 1, length: [7.0, 6.4, 7.8], cargoH: [1.0, 0.8, 1.3], cab_: C(0.55, 0.14, 0.012), cabName: "orange", nl: "oranje", body: "tip_grey", bodyName: "grey tipper body" },
  { cargo: "tipper", cab: "cabover", rear: 2, front: 1, length: [8.6, 7.8, 9.4], cargoH: [1.1, 0.9, 1.4], cab_: C(0.62, 0.62, 0.6), cabName: "white", nl: "wit", body: "tip_orange", bodyName: "orange tipper body" },
  { cargo: "tipper", cab: "cabover", rear: 2, front: 2, length: [9.6, 8.8, 10.4], cargoH: [1.3, 1.0, 1.6], cab_: C(0.6, 0.4, 0.02), cabName: "yellow", nl: "geel", body: "tip_yellow", bodyName: "yellow eight-wheel tipper body" },
  { cargo: "tipper", cab: "bonnet", rear: 2, front: 1, length: [9.0, 8.2, 9.8], cargoH: [1.1, 0.9, 1.4], cab_: C(0.025, 0.08, 0.24, 0.3), cabName: "blue", nl: "blauw", body: "tip_grey", bodyName: "grey tipper body" },
  { cargo: "tanker", cab: "cabover", rear: 1, front: 1, length: [8.0, 7.2, 9.0], cargoH: [1.9, 1.6, 2.1], cab_: C(0.62, 0.62, 0.6), cabName: "white", nl: "wit", body: "tank_steel", bodyName: "stainless tank" },
  { cargo: "tanker", cab: "cabover", rear: 2, front: 1, length: [10.0, 9.0, 11.2], cargoH: [2.0, 1.7, 2.2], cab_: C(0.3, 0.02, 0.018), cabName: "red", nl: "rood", body: "tank_white", bodyName: "white tank" },
  { cargo: "tanker", cab: "bonnet", rear: 2, front: 1, length: [10.4, 9.6, 11.6], cargoH: [1.95, 1.7, 2.15], cab_: C(0.42, 0.43, 0.44, 0.35), cabName: "silver", nl: "zilver", body: "tank_steel", bodyName: "stainless tank" },
];

const BODY_MATS: Record<string, MaterialDef> = {
  box_white: { color: [0.6, 0.6, 0.58], metallic: 0.1, roughness: 0.4, texture: "painted" },
  box_blue: { color: [0.025, 0.07, 0.22], metallic: 0.15, roughness: 0.38, texture: "painted" },
  box_grey: { color: [0.7, 0.71, 0.72], metallic: 0.85, roughness: 0.38, texture: "brushed" },
  deck_wood: { color: [0.24, 0.15, 0.07], metallic: 0, roughness: 0.85, texture: "wood" },
  deck_steel: { color: [0.22, 0.23, 0.24], metallic: 0.3, roughness: 0.6, texture: "painted" },
  tip_grey: { color: [0.2, 0.21, 0.22], metallic: 0.3, roughness: 0.6, texture: "painted" },
  tip_orange: { color: [0.5, 0.13, 0.012], metallic: 0.15, roughness: 0.5, texture: "painted" },
  tip_yellow: { color: [0.58, 0.37, 0.02], metallic: 0.15, roughness: 0.5, texture: "painted" },
  tank_steel: { color: [0.66, 0.67, 0.68], metallic: 1, roughness: 0.22, texture: "brushed" },
  tank_white: { color: [0.6, 0.6, 0.58], metallic: 0.1, roughness: 0.3, texture: "painted" },
};

const CARGO_TEXT: Record<Cargo, string> = {
  box: "a closed box body with ribbed sides and rear doors",
  flatbed: "a flatbed with drop sides, stake posts and a strapped pallet load",
  tipper: "an open tipper body hinged at the rear with a hydraulic ram",
  tanker: "a rounded tank with a top walkway, ladder and valves",
};

/** A rounded-rectangle section of the cab, its sides $cw / 2 - dw out, from $cy0 + yb to $cy0 + yt, corner radius r, the top crowned. */
function cabSec(z: string, dw: number, yb: number, yt: number, r: number, crown = 0): { z: string; points: [string, string][] } {
  const pts: [string, string][] = [];
  const xc = (sg: number, d: number) => `${sg < 0 ? "-" : ""}($cw / 2 - ${f(dw + d)})`;
  const y = (v: number) => `$cy0 + ${f(v)}`;
  const arc = (sx: number, sy: number, a0: number) => {
    for (let k = 0; k < 4; k++) {
      const a = ((a0 + k * 30) * Math.PI) / 180;
      const cx = r - r * Math.abs(Math.cos(a));
      pts.push([xc(sx, cx), y(sy > 0 ? yt - r + r * Math.sin(a) : yb + r + r * Math.sin(a))]);
    }
  };
  arc(1, -1, -90);
  arc(1, 1, 0);
  pts.push(["0", y(yt + crown)]);
  // Upper left quarter, then lower left.
  for (let k = 0; k < 4; k++) { const a = ((90 + k * 30) * Math.PI) / 180; pts.push([xc(-1, r + r * Math.cos(a)), y(yt - r + r * Math.sin(a))]); }
  for (let k = 0; k < 4; k++) { const a = ((180 + k * 30) * Math.PI) / 180; pts.push([xc(-1, r + r * Math.cos(a)), y(yb + r + r * Math.sin(a))]); }
  pts.push(["0", y(yb)]);
  return { z, points: pts };
}

function cabNodes(t: TruckDef): SpecNode[] {
  const k: SpecNode[] = [];
  const H = t.cab === "bonnet" ? 2.0 : 2.15;
  // The cab: radiused all round, the roof rounding into a raked, curved windscreen, a vertical grille face below it.
  k.push(loft("Shell", [
    cabSec("$cz0", 0.03, 0.03, H - 0.03, 0.12),
    cabSec("$cz0 + 0.05", 0, 0, H, 0.17),
    cabSec("$cz1 - 0.5", 0, 0, H, 0.17),
    cabSec("$cz1 - 0.38", 0, 0, H - 0.025, 0.17, 0.01),
    cabSec("$cz1 - 0.31", 0.005, 0, H - 0.1, 0.17, 0.03),
    cabSec("$cz1 - 0.18", 0.01, 0, H * 0.78, 0.16, 0.05),
    cabSec("$cz1 - 0.06", 0.02, 0, H * 0.45, 0.15, 0.06),
    cabSec("$cz1 - 0.02", 0.05, 0.01, H * 0.42, 0.13, 0.05),
    cabSec("$cz1", 0.1, 0.04, H * 0.38, 0.1, 0.04),
  ], { material: "cab_paint" }));
  // Curved windscreen glass on the raked face: a lens-shaped band that follows the crowned top of the sections.
  const ws = ([z, dw, yt, r, crown, out]: [string, number, number, number, number, number]) => {
    const xc = `($cw / 2 - ${f(dw + r)})`;
    const w = `(${xc} - 0.06)`;
    const yAt = (u: number, off: number) => `$cy0 + ${f(yt)} + ${f(crown)} * (1 - ${f(Math.abs(u))} * ${w} / ${xc}) + ${f(off + 0.012 * (1 - u * u))}`;
    const P = (u: number, off: number): [string, string] => [`${f(u)} * ${w}`, yAt(u, off)];
    return { z, points: [P(1, out * 0.1), P(0.96, out), P(0.5, out), P(0, out), P(-0.5, out), P(-0.96, out), P(-1, out * 0.1), P(-0.96, -out * 0.8), P(-0.5, -out * 0.8), P(0, -out * 0.8), P(0.5, -out * 0.8), P(0.96, -out * 0.8)] };
  };
  k.push(loft("Windscreen", [ws(["$cz1 - 0.3", 0.005, H - 0.11, 0.17, 0.03, 0.03]), ws(["$cz1 - 0.18", 0.01, H * 0.78, 0.16, 0.05, 0.06]), ws(["$cz1 - 0.075", 0.02, H * 0.47, 0.15, 0.06, 0.06])], { material: "dark_glass" }));
  k.push(box("Wiper_{i}", [0.7, 0.025, 0.03], { at: ["-$cw * 0.22", `$cy0 + ${f(H * 0.5)}`, "$cz1 - 0.05"], repeat: { count: 2, step: ["$cw * 0.44", 0, 0] }, rotate: [-14, 0, 8], material: "trim_black" }));
  k.push(box("SideWindow_L", [0.05, "$chh * 0.3", 0.66], { at: ["$cw / 2 - 0.01", "$cy0 + $chh * 0.67", "$cz1 - 0.72"], bevel: 0.02, material: "dark_glass", mirror: "SideWindow_R" }));
  k.push(box("DoorLine_L", [0.03, "$chh * 0.62", 0.02], { at: ["$cw / 2", "$cy0 + $chh * 0.42", "$cz1 - 1.15"], material: "trim_black", mirror: "DoorLine_R" }));
  k.push(box("Handle_L", [0.04, 0.04, 0.22], { at: ["$cw / 2 + 0.005", "$cy0 + $chh * 0.5", "$cz1 - 1.0"], bevel: 0.01, material: "chrome", mirror: "Handle_R" }));
  if (t.cab === "cabover") {
    k.push(group("Grille", [
      box("Frame", ["$cw * 0.66", "$chh * 0.27", 0.05], { bevel: 0.025, material: "cab_paint" }),
      box("Panel", ["$cw * 0.6", "$chh * 0.22", 0.05], { at: [0, 0, 0.012], bevel: 0.015, material: "trim_black" }),
      box("Slat_{i}", ["$cw * 0.57", 0.022, 0.03], { at: [0, "-$chh * 0.085", 0.03], repeat: { count: 5, step: [0, "$chh * 0.042", 0] }, material: "chrome" }),
      box("Badge", [0.22, 0.06, 0.02], { at: [0, "$chh * 0.115", 0.03], bevel: 0.008, material: "chrome" }),
    ], { at: [0, "$cy0 + $chh * 0.22", "$cz1 - 0.012"] }));
    k.push(box("Visor", ["$cw - 0.36", 0.035, 0.24], { at: [0, "$cy0 + $chh - 0.09", "$cz1 - 0.26"], rotate: [10, 0, 0], bevel: 0.015, material: "cab_paint" }));
    k.push(box("Step_L", [0.12, 0.05, 0.45], { at: ["$cw / 2 - 0.04", "$cy0 - 0.25", "$cz1 - 1.0"], material: "aluminium", mirror: "Step_R" }));
    k.push(box("StepPlate_L", [0.06, 0.4, 0.5], { at: ["$cw / 2 - 0.08", "$cy0 - 0.1", "$cz1 - 1.0"], material: "trim_black", mirror: "StepPlate_R" }));
  }
  k.push(group("Mirror_L", [
    // Two arms out from the door frame to a main mirror, a wide-angle mirror under it.
    tube("ArmUpper", [[-0.02, 0.42, -0.02], [0.14, 0.46, 0.04], [0.26, 0.42, 0.06]], 0.016, { material: "trim_black", segments: 8 }),
    tube("ArmLower", [[-0.02, 0, -0.02], [0.14, 0.02, 0.04], [0.26, 0.06, 0.06]], 0.016, { material: "trim_black", segments: 8 }),
    box("Housing", [0.08, 0.36, 0.2], { at: [0.29, 0.25, 0.07], bevel: 0.03, material: "trim_black" }),
    box("Glass", [0.06, 0.32, 0.012], { at: [0.29, 0.25, -0.03], bevel: 0.004, material: "mirror_face" }),
    box("WideAngle", [0.08, 0.16, 0.16], { at: [0.29, -0.03, 0.07], bevel: 0.03, material: "trim_black" }),
    box("WideGlass", [0.06, 0.13, 0.012], { at: [0.29, -0.03, -0.012], bevel: 0.004, material: "mirror_face" }),
  ], { at: ["$cw / 2 - 0.02", "$cy0 + $chh * 0.45", "$cz1 - 0.42"], mirror: "Mirror_R" }));
  if (t.roofSpoiler) {
    k.push(group("RoofSpoiler", [
      box("Deflector", ["$cw - 0.24", 0.05, 1.05], { at: [0, 0.25, -0.45], rotate: [28, 0, 0], bevel: 0.02 }),
      box("Cheek_L", [0.04, 0.5, 0.8], { at: ["$cw / 2 - 0.14", 0.25, -0.6], bevel: 0.01, mirror: "Cheek_R" }),
    ], { at: [0, "$cy0 + $chh - 0.02", "$cz1 - 0.5"], material: "cab_paint" }));
  } else {
    k.push(box("Beacon_L", [0.12, 0.08, 0.12], { at: ["$cw / 2 - 0.35", "$cy0 + $chh + 0.0", "$cz1 - 0.4"], bevel: 0.03, material: "lamp_amber", mirror: "Beacon_R" }));
  }
  return k;
}

function buildTruck(t: TruckDef): AssetDraft {
  const nodes: SpecNode[] = [];
  const kids: SpecNode[] = [];
  const bonnet = t.cab === "bonnet";
  const tw = 0.3;
  // Cab.
  const cab = cabNodes(t);
  if (bonnet) {
    // Engine hood ahead of the cab, with a big grille and lamps on the fenders.
    cab.push(loft("Bonnet", [
      { z: "$cz1 - 0.05", superellipse: { width: "$cw - 0.3", height: 1.0, n: 4, count: 24, cy: "$cy0 + 0.35" } },
      { z: "$L2 - 0.3", superellipse: { width: "$cw - 0.5", height: 0.95, n: 4, count: 24, cy: "$cy0 + 0.3" } },
      { z: "$L2 - 0.12", superellipse: { width: "$cw - 0.62", height: 0.85, n: 4, count: 24, cy: "$cy0 + 0.28" } },
    ], { material: "cab_paint" }));
    cab.push(group("Grille", [
      box("Panel", ["$cw - 0.66", 0.8, 0.06], { bevel: 0.02, material: "chrome" }),
      box("Bar_{i}", ["$cw - 0.72", 0.03, 0.04], { at: [0, -0.32, 0.03], repeat: { count: 9, step: [0, 0.08, 0] }, material: "trim_black" }),
    ], { at: [0, "$cy0 + 0.3", "$L2 - 0.1"] }));
    cab.push(loft("Fender_L", [
      { z: "$zf - $wr - 0.25", superellipse: { width: 0.5, height: 0.14, n: 3, count: 16, cx: "$cw / 2 - 0.27", cy: "2 * $wr + 0.03" } },
      { z: "$zf", superellipse: { width: 0.5, height: 0.2, n: 3, count: 16, cx: "$cw / 2 - 0.27", cy: "2 * $wr + 0.12" } },
      { z: "$L2 - 0.25", superellipse: { width: 0.5, height: 0.14, n: 3, count: 16, cx: "$cw / 2 - 0.27", cy: "2 * $wr - 0.05" } },
    ], { material: "cab_paint", mirror: "Fender_R" }));
    cab.push(cyl("Lamp_L", 0.11, 0.08, { axis: "z", at: ["$cw / 2 - 0.4", "$cy0 + 0.4", "$L2 - 0.1"], segments: 18, material: "lamp_lens", mirror: "Lamp_R" }));
    cab.push(cyl("Stack_L", 0.08, 1.9, { at: ["$cw / 2 - 0.1", "$cy0 + $chh - 0.35", "$cz0 + 0.04"], segments: 14, material: "chrome", mirror: "Stack_R" }));
  } else {
    // Light clusters: a dark housing with two round projectors, an amber indicator and a daytime strip.
    cab.push(group("Lamp_L", [
      box("Housing", [0.42, 0.17, 0.08], { bevel: 0.03, material: "trim_black" }),
      cyl("Lens_{i}", 0.05, 0.03, { axis: "z", at: [-0.12, 0.01, 0.035], repeat: { count: 2, step: [0.12, 0, 0] }, segments: 16, material: "lamp_lens" }),
      box("Indicator", [0.09, 0.09, 0.03], { at: [0.15, 0.01, 0.035], bevel: 0.01, material: "lamp_amber" }),
      box("Drl", [0.36, 0.018, 0.02], { at: [0, -0.06, 0.04], material: "lamp_lens" }),
    ], { at: ["$cw / 2 - 0.34", "$cy0 + 0.12", "$cz1 - 0.02"], mirror: "Lamp_R" }));
  }
  kids.push(group("Cab", cab));
  kids.push(box("Bumper", ["$cw - 0.04", 0.32, 0.22], { at: [0, "$cy0 - 0.12", "$L2 - 0.1"], bevel: 0.04, material: bonnet ? "chrome" : "trim_black" }));
  kids.push(box("PlateFront", [0.52, 0.11, 0.012], { at: [0, "$cy0 - 0.15", "$L2 + 0.016"], material: "plate_yellow" }));

  // Chassis: two rails, cross members, fuel tank, battery box, under-run bar, rear lights.
  const ch: SpecNode[] = [
    box("Rail_L", [0.1, 0.3, "$length - 0.3"], { at: [0.45, "$ry - 0.15", 0.05], bevel: 0.01, material: "chassis_black", mirror: "Rail_R" }),
    box("Cross_{i}", [0.82, 0.18, 0.12], { at: [0, "$ry - 0.15", "-$L2 + 0.4"], repeat: { count: 4, step: [0, 0, "($length - 1.2) / 3"] }, material: "chassis_black" }),
    group("FuelTank", [
      cyl("Drum", 0.3, 1.1, { axis: "z", segments: 20, material: "aluminium", bevel: 0.03 }),
      box("Strap_{i}", [0.62, 0.62, 0.04], { at: [0, 0, -0.35], repeat: { count: 2, step: [0, 0, 0.7] }, material: "chassis_black" }),
      tube("Bracket", [[-0.2, 0, 0], [-0.38, 0, 0]], 0.04, { material: "chassis_black", segments: 6 }),
    ], { at: [0.88, "$ry - 0.45", "$zf - $wr - 0.95"] }),
    box("Battery", [0.5, 0.45, 0.6], { at: [-0.78, "$ry - 0.4", "$zf - $wr - 0.85"], bevel: 0.02, material: "chassis_black" }),
    box("Underrun", ["$width - 0.15", 0.12, 0.12], { at: [0, "$ry - 0.55", "-$L2 + 0.2"], bevel: 0.02, material: "chassis_black" }),
    box("UnderrunPost_L", [0.08, 0.5, 0.08], { at: [0.45, "$ry - 0.3", "-$L2 + 0.2"], material: "chassis_black", mirror: "UnderrunPost_R" }),
    group("RearLamp_L", [
      box("Housing", [0.4, 0.16, 0.06], { bevel: 0.02, material: "trim_black" }),
      box("Brake", [0.13, 0.12, 0.03], { at: [-0.13, 0, -0.025], bevel: 0.01, material: "lamp_red" }),
      box("Indicator", [0.1, 0.12, 0.03], { at: [0, 0, -0.025], bevel: 0.01, material: "lamp_amber" }),
      box("Reverse", [0.1, 0.12, 0.03], { at: [0.13, 0, -0.025], bevel: 0.01, material: "lamp_lens" }),
    ], { at: ["$width / 2 - 0.3", "$ry - 0.47", "-$L2 + 0.13"], mirror: "RearLamp_R" }),
    // Conspicuity tape on the under-run bar.
    box("UnderrunTapeRed_{i}", [0.18, 0.07, 0.01], { at: ["-$width / 2 + 0.3", "$ry - 0.55", "-$L2 + 0.14"], repeat: { count: 5, step: ["($width - 0.6) / 4.5", 0, 0] }, material: "tape_red" }),
    box("UnderrunTapeWhite_{i}", [0.18, 0.07, 0.01], { at: ["-$width / 2 + 0.3 + ($width - 0.6) / 9", "$ry - 0.55", "-$L2 + 0.14"], repeat: { count: 4, step: ["($width - 0.6) / 4.5", 0, 0] }, material: "tape_white" }),
    box("PlateRear", [0.52, 0.11, 0.012], { at: [0, "$ry - 0.47", "-$L2 + 0.13"], material: "plate_yellow" }),
  ];
  // Mudguards over the rear axles.
  ch.push(box("Guard_L", [0.68, 0.05, `${t.rear === 2 ? "2.7 + " : ""}2 * $wr + 0.25`], { at: ["$width / 2 - 0.34", "2 * $wr + 0.1", "$zr"], bevel: 0.015, material: "trim_black", mirror: "Guard_R" }));
  ch.push(box("GuardArm_L", [0.62, 0.06, 0.06], { at: ["$width / 2 - 0.42", "2 * $wr + 0.06", "$zr"], material: "chassis_black", mirror: "GuardArm_R" }));
  ch.push(tube("GuardStay_L", [["0.5", "$ry - 0.2", "$zr"], ["$width / 2 - 0.7", "2 * $wr + 0.08", "$zr"]], 0.025, { material: "chassis_black", segments: 6, mirror: "GuardStay_R" }));
  ch.push(box("SideGuard_L", [0.04, 0.32, "max(0.5, $zf - $zr - 2 * $wr - 1.0 - ($zf - $wr - 0.4 - $cz0))"], { at: ["$width / 2 - 0.05", "$ry - 0.35", "($cz0 - 0.15 + $zr + $wr + 0.4 + 0.65) / 2"], bevel: 0.01, material: "aluminium", mirror: "SideGuard_R" }));
  ch.push(box("SideMount_{i}", ["$width - 0.1", 0.06, 0.06], { at: [0, "$ry - 0.35", "$zr + $wr + 0.8"], repeat: { count: 2, step: [0, 0, 0.8] }, material: "chassis_black" }));
  // Mud flaps behind the front wheels and behind the last rear axle: a black plate with a reflective strip.
  const flap = (name: string, x: string, w: number, z: string, mirror: string): SpecNode => group(name, [
    box("Plate", [w, 0.46, 0.022], { bevel: 0.008, material: "trim_black" }),
    box("Strip", [w * 0.78, 0.05, 0.026], { at: [0, -0.15, 0], material: "tape_white" }),
    box("Bar", [w + 0.02, 0.04, 0.05], { at: [0, 0.22, 0.02], material: "chassis_black" }),
  ], { at: [x, "$wr * 0.85", z], rotate: [4, 0, 0], mirror });
  ch.push(flap("MudFlap_F_L", "$width / 2 - 0.2", 0.42, "$zf - $wr - 0.09", "MudFlap_F_R"));
  ch.push(flap("MudFlap_R_L", "$width / 2 - 0.32", 0.52, t.rear === 2 ? "$zr - 0.68 - $wr - 0.09" : "$zr - $wr - 0.09", "MudFlap_R_R"));
  // Exhaust: a silencer on the chassis with a tail pipe turning out to the side (bonneted trucks have stacks instead).
  if (!bonnet) {
    ch.push(group("Silencer", [
      cyl("Drum", 0.17, 0.8, { axis: "z", segments: 18, material: "stainless_dull", bevel: 0.02 }),
      cyl("Clamp_{i}", 0.178, 0.05, { axis: "z", at: [0, 0, -0.28], repeat: { count: 2, step: [0, 0, 0.56] }, segments: 18, material: "chassis_black" }),
      tube("Tail", [[0, 0, -0.4], [0, 0, -0.55], [-0.12, 0, -0.7], [-0.4, 0, -0.78]], 0.045, { material: "stainless_dull", segments: 10 }),
    ], { at: ["-0.78", "$ry - 0.5", "$zf - $wr - 1.65"] }));
    ch.push(cyl("AirTank_{i}", 0.12, 0.72, { axis: "x", at: [0, "$ry - 0.38", "$zr + $wr + 1.5"], repeat: { count: 2, step: [0, 0, 0.45] }, segments: 14, material: "aluminium", bevel: 0.015 }));
  }
  kids.push(group("Chassis", ch));

  // Cargo.
  const cargo: SpecNode[] = [];
  const cz0 = "$cz0 - 0.12"; // front of the load area
  const blen = `(${cz0} + $L2 - 0.05)`;
  const bz = `(${cz0} - $L2 + 0.05) / 2`;
  switch (t.cargo) {
    case "box": {
      cargo.push(box("Floor", ["$width - 0.06", 0.18, blen], { at: [0, "$ry + 0.09", bz], material: "chassis_black" }));
      cargo.push(box("Shell", ["$width - 0.04", "$cargoHeight", blen], { at: [0, "$ry + 0.18 + $cargoHeight / 2", bz], bevel: 0.03, material: "body_paint" }));
      cargo.push(box("Rib_L{i}", [0.04, "$cargoHeight - 0.08", 0.06], { at: ["$width / 2 - 0.01", "$ry + 0.18 + $cargoHeight / 2", `${cz0} - 0.3`], repeat: { count: 7, step: [0, 0, `-(${blen} - 0.6) / 6`] }, material: "aluminium" }));
      cargo.push(box("Rib_R{i}", [0.04, "$cargoHeight - 0.08", 0.06], { at: ["-$width / 2 + 0.01", "$ry + 0.18 + $cargoHeight / 2", `${cz0} - 0.3`], repeat: { count: 7, step: [0, 0, `-(${blen} - 0.6) / 6`] }, material: "aluminium" }));
      cargo.push(box("TopRail_L", [0.06, 0.08, blen], { at: ["$width / 2 - 0.02", "$ry + 0.18 + $cargoHeight - 0.04", bz], material: "aluminium", mirror: "TopRail_R" }));
      cargo.push(group("RearDoor_L", [
        box("Leaf", ["$width / 2 - 0.08", "$cargoHeight - 0.12", 0.04], { at: ["-($width / 2 - 0.08) / 2", 0, 0], bevel: 0.01, material: "body_paint" }),
        cyl("Bar", 0.02, "$cargoHeight - 0.2", { at: ["-($width / 2 - 0.08) * 0.6", 0, 0.03], segments: 8, material: "aluminium" }),
        box("Hinge_{i}", [0.08, 0.06, 0.05], { at: [0, "-($cargoHeight - 0.3) / 2", 0.01], repeat: { count: 3, step: [0, "($cargoHeight - 0.3) / 2", 0] }, material: "aluminium" }),
      ], { at: ["$width / 2 - 0.05", "$ry + 0.18 + $cargoHeight / 2", "-$L2 + 0.03"], mirror: "RearDoor_R" }));
      cargo.push(box("Marker_L", [0.04, 0.08, 0.08], { at: ["$width / 2 - 0.01", "$ry + 0.18 + $cargoHeight - 0.15", "-$L2 + 0.4"], material: "lamp_amber", mirror: "Marker_R" }));
      // A bottom rail, rivet rows along both rails, the door seal and handles, and tape on the doors.
      cargo.push(box("BottomRail_L", [0.05, 0.1, blen], { at: ["$width / 2 - 0.015", "$ry + 0.18 + 0.07", bz], material: "aluminium", mirror: "BottomRail_R" }));
      cargo.push(cyl("RivetTop_L{i}", 0.012, 0.012, { axis: "x", at: ["$width / 2 + 0.012", "$ry + 0.18 + $cargoHeight - 0.04", `${cz0} - 0.25`], repeat: { count: 42, step: [0, 0, `-(${blen} - 0.5) / 41`] }, segments: 6, material: "rivet", mirror: "RivetTop_R" }));
      cargo.push(cyl("RivetBottom_L{i}", 0.012, 0.012, { axis: "x", at: ["$width / 2 + 0.012", "$ry + 0.18 + 0.07", `${cz0} - 0.25`], repeat: { count: 42, step: [0, 0, `-(${blen} - 0.5) / 41`] }, segments: 6, material: "rivet", mirror: "RivetBottom_R" }));
      cargo.push(box("DoorSeal", [0.03, "$cargoHeight - 0.12", 0.03], { at: [0, "$ry + 0.18 + $cargoHeight / 2", "-$L2"], material: "trim_black" }));
      cargo.push(box("DoorHandle_L", [0.06, 0.16, 0.035], { at: ["0.12", "$ry + 0.18 + $cargoHeight * 0.45", "-$L2"], bevel: 0.01, material: "aluminium", mirror: "DoorHandle_R" }));
      cargo.push(box("DoorTapeRed_{i}", [0.18, 0.08, 0.012], { at: ["-$width / 2 + 0.2", "$ry + 0.18 + 0.28", "-$L2 + 0.0055"], repeat: { count: 6, step: ["($width - 0.4) / 5.5", 0, 0] }, material: "tape_red" }));
      cargo.push(box("DoorTapeWhite_{i}", [0.18, 0.08, 0.012], { at: ["-$width / 2 + 0.2 + ($width - 0.4) / 11", "$ry + 0.18 + 0.28", "-$L2 + 0.0055"], repeat: { count: 5, step: ["($width - 0.4) / 5.5", 0, 0] }, material: "tape_white" }));
      break;
    }
    case "flatbed": {
      cargo.push(box("Deck", ["$width - 0.04", 0.12, blen], { at: [0, "$ry + 0.06", bz], bevel: 0.01, material: "body_paint" }));
      cargo.push(box("Board_L", [0.04, 0.45, blen], { at: ["$width / 2 - 0.02", "$ry + 0.12 + 0.22", bz], bevel: 0.01, material: "aluminium", mirror: "Board_R" }));
      cargo.push(box("Tailboard", ["$width - 0.04", 0.45, 0.04], { at: [0, "$ry + 0.12 + 0.22", "-$L2 + 0.07"], bevel: 0.01, material: "aluminium" }));
      cargo.push(box("Headboard", ["$width - 0.04", 1.3, 0.08], { at: [0, "$ry + 0.12 + 0.65", `${cz0} - 0.04`], bevel: 0.015, material: "chassis_black" }));
      cargo.push(box("HeadboardBar_{i}", [0.04, 1.2, 0.03], { at: ["-$width / 2 + 0.25", "$ry + 0.12 + 0.65", `${cz0} - 0.09`], repeat: { count: 9, step: ["($width - 0.5) / 8", 0, 0] }, material: "aluminium" }));
      cargo.push(box("Stake_L{i}", [0.06, 0.6, 0.06], { at: ["$width / 2 - 0.02", "$ry + 0.12 + 0.3", `${cz0} - 0.6`], repeat: { count: 4, step: [0, 0, `-(${blen} - 1.0) / 3`] }, material: "chassis_black" }));
      cargo.push(box("Stake_R{i}", [0.06, 0.6, 0.06], { at: ["-$width / 2 + 0.02", "$ry + 0.12 + 0.3", `${cz0} - 0.6`], repeat: { count: 4, step: [0, 0, `-(${blen} - 1.0) / 3`] }, material: "chassis_black" }));
      // A load of wrapped pallets, as high as $cargoHeight.
      cargo.push(group("Load", [
        box("Pallet_{i}", [1.0, 0.14, 1.15], { at: [-0.55, 0.07, 0], repeat: { count: 2, step: [1.1, 0, 0] }, bevel: 0.01, material: "deck_wood" }),
        box("Goods_{i}", [0.98, "$cargoHeight - 0.14", 1.12], { at: [-0.55, "0.14 + ($cargoHeight - 0.14) / 2", 0], repeat: { count: 2, step: [1.1, 0, 0] }, bevel: 0.03, material: "wrap" }),
        box("Strap_{i}", ["$width - 0.02", 0.02, 0.05], { at: [0, "$cargoHeight + 0.008", -0.3], repeat: { count: 2, step: [0, 0, 0.6] }, material: "strap" }),
      ], { at: [0, "$ry + 0.12", `${cz0} - 1.0`] }));
      cargo.push(group("Load2", [
        box("Pallet_{i}", [1.0, 0.14, 1.15], { at: [-0.55, 0.07, 0], repeat: { count: 2, step: [1.1, 0, 0] }, bevel: 0.01, material: "deck_wood" }),
        box("Goods_{i}", [0.98, "($cargoHeight - 0.14) * 0.7", 1.12], { at: [-0.55, "0.14 + ($cargoHeight - 0.14) * 0.35", 0], repeat: { count: 2, step: [1.1, 0, 0] }, bevel: 0.03, material: "wrap" }),
      ], { at: [0, "$ry + 0.12", `${cz0} - 2.35`] }));
      break;
    }
    case "tipper": {
      // The body tips about its rear hinge.
      const tl = blen;
      const th = "$cargoHeight";
      cargo.push(box("Subframe_L", [0.12, 0.16, tl], { at: [0.45, "$ry + 0.08", bz], material: "chassis_black", mirror: "Subframe_R" }));
      cargo.push(group("TipBody", [
        box("Floor", ["$width - 0.1", 0.1, tl], { at: [0, 0.05, `${tl} / 2 - 0.05`], bevel: 0.01 }),
        box("Side_L", [0.08, th, tl], { at: ["$width / 2 - 0.06", `${th} / 2 + 0.05`, `${tl} / 2 - 0.05`], rotate: [0, 0, -4], bevel: 0.02, mirror: "Side_R" }),
        box("Front", ["$width - 0.06", `${th} + 0.3`, 0.1], { at: [0, `(${th} + 0.3) / 2 + 0.05`, `${tl} - 0.1`], bevel: 0.02 }),
        box("Canopy", ["$width - 0.06", 0.06, 0.5], { at: [0, `${th} + 0.36`, `${tl} - 0.3`], bevel: 0.015 }),
        box("Tailgate", ["$width - 0.14", `${th} - 0.04`, 0.08], { at: [0, `${th} / 2 + 0.05`, 0.0], bevel: 0.015 }),
        box("Rib_L{i}", [0.06, th, 0.08], { at: ["$width / 2 - 0.0", `${th} / 2 + 0.05`, 0.4], repeat: { count: 5, step: [0, 0, `(${tl} - 0.8) / 4`] }, mirror: "Rib_R" }),
        box("TopEdge_L", [0.1, 0.08, tl], { at: ["$width / 2 - 0.04", `${th} + 0.03`, `${tl} / 2 - 0.05`], mirror: "TopEdge_R" }),
        box("Spoil", ["$width - 0.3", `${th} * 0.45`, `${tl} * 0.55`], { at: [0, `${th} * 0.225 + 0.1`, `${tl} * 0.55`], bevel: 0.12, material: "spoil" }),
      ], { at: [0, "$ry + 0.16", "-$L2 + 0.1"], material: "body_paint" }));
      cargo.push(cyl("Ram", 0.09, 0.9, { at: [0, "$ry + 0.55", `${cz0} - 0.35`], rotate: [-12, 0, 0], segments: 16, material: "chrome" }));
      cargo.push(cyl("RamSleeve", 0.12, 0.55, { at: [0, "$ry + 0.3", `${cz0} - 0.3`], rotate: [-12, 0, 0], segments: 16, material: "chassis_black" }));
      cargo.push(cyl("Hinge", 0.06, 0.9, { axis: "x", at: [0, "$ry + 0.16", "-$L2 + 0.1"], segments: 12, material: "chassis_black" }));
      break;
    }
    case "tanker": {
      const R = "$cargoHeight / 2";
      const sec = (z: string, k: number) => ({ z, superellipse: { width: `($width - 0.1) * ${f(k)}`, height: `$cargoHeight * ${f(k)}`, n: 2.6, count: 32, cy: `$ry + 0.22 + ${R}` } });
      cargo.push(box("Cradle_{i}", ["$width - 0.4", 0.3, 0.2], { at: [0, "$ry + 0.12", `${cz0} - 0.4`], repeat: { count: 3, step: [0, 0, `-(${blen} - 0.8) / 2`] }, material: "chassis_black" }));
      cargo.push(loft("Tank", [
        sec(`-$L2 + 0.12`, 0.86), sec(`-$L2 + 0.2`, 0.97), sec(`-$L2 + 0.32`, 1), sec(`${cz0} - 0.22`, 1), sec(`${cz0} - 0.1`, 0.97), sec(cz0, 0.86),
      ], { material: "body_paint" }));
      // Stiffening rings round the tank, slightly proud, with a row of bolts along each.
      const ringAt = (z: string) => [sec(`${z} + 0.04`, 1), sec(`${z} + 0.035`, 1.025), sec(`${z} - 0.035`, 1.025), sec(`${z} - 0.04`, 1)].map((q) => ({ ...q, z: q.z }));
      cargo.push(loft("Ring_{i}", ringAt("0"), { at: [0, 0, `${cz0} - 0.5`], repeat: { count: 4, step: [0, 0, `-(${blen} - 1.0) / 3`] }, material: "ring_paint" }));
      cargo.push(cyl("RingBolt_{i}", 0.014, 0.012, { axis: "x", at: [`($width - 0.1) / 2 * 1.025`, `$ry + 0.22 + ${R}`, `${cz0} - 0.5`], repeat: { count: 4, step: [0, 0, `-(${blen} - 1.0) / 3`] }, segments: 6, material: "rivet", mirror: "RingBoltR_{i}" }));
      cargo.push(box("Walkway", [0.5, 0.05, `${blen} - 0.8`], { at: [0, `$ry + 0.22 + $cargoHeight + 0.01`, bz], material: "aluminium" }));
      cargo.push(cyl("Hatch_{i}", 0.25, 0.12, { at: [0, `$ry + 0.22 + $cargoHeight + 0.04`, `${cz0} - 0.8`], repeat: { count: 3, step: [0, 0, `-(${blen} - 1.6) / 2`] }, segments: 20, material: "aluminium", bevel: 0.02 }));
      cargo.push(tube("Handrail_L", [["0.3", `$ry + 0.22 + $cargoHeight`, `${cz0} - 0.5`], ["0.3", `$ry + 0.22 + $cargoHeight + 0.35`, `${cz0} - 0.6`], ["0.3", `$ry + 0.22 + $cargoHeight + 0.35`, `-$L2 + 0.6`], ["0.3", `$ry + 0.22 + $cargoHeight`, `-$L2 + 0.5`]], 0.02, { material: "aluminium", segments: 8, mirror: "Handrail_R" }));
      cargo.push(group("Ladder", [
        box("Stile_L", [0.04, `$cargoHeight + 0.3`, 0.04], { at: [0.2, 0, 0], mirror: "Stile_R" }),
        box("Rung_{i}", [0.4, 0.03, 0.03], { at: [0, `-($cargoHeight + 0.3) / 2 + 0.15`, 0], repeat: { count: 6, step: [0, `($cargoHeight) / 5`, 0] } }),
      ], { at: [0, `$ry + 0.22 + ($cargoHeight - 0.3) / 2 + 0.15`, "-$L2 + 0.08"], material: "aluminium" }));
      cargo.push(box("ValveBox_L", [0.3, 0.4, 1.2], { at: ["$width / 2 - 0.2", "$ry - 0.2", "$zr + $wr + 1.2"], bevel: 0.02, material: "aluminium", mirror: "ValveBox_R" }));
      cargo.push(tube("Outlet", [[0, "$ry + 0.25", "-$L2 + 0.25"], [0, "$ry - 0.1", "-$L2 + 0.25"], [0.3, "$ry - 0.1", "-$L2 + 0.25"]], 0.06, { material: "aluminium", segments: 10 }));
      break;
    }
  }
  kids.push(group("Cargo", cargo));

  // Wheels: front steering axle(s) with singles, rear axle(s) with twin wheels.
  const wo = { r: "$wr", w: f(tw), style: "truck" as const, rim: t.cab === "bonnet" ? "alloy" : "rim_grey", hub: t.cab === "bonnet" ? "chrome" : "chassis_black", segments: 24, rimFrac: 0.58 };
  const wheels: SpecNode[] = [wheel("Wheel_F1L", ["$width / 2 - 0.2", "$wr", "$zf"], wo, { mirror: "Wheel_F1R" })];
  if (t.front === 2) wheels.push(wheel("Wheel_F2L", ["$width / 2 - 0.2", "$wr", "$zf - 1.9"], wo, { mirror: "Wheel_F2R" }));
  const rearZ = t.rear === 2 ? ["$zr + 0.68", "$zr - 0.68"] : ["$zr"];
  rearZ.forEach((z, i) => {
    wheels.push(wheel(`Wheel_R${i + 1}LO`, [`$width / 2 - ${f(tw / 2 + 0.01)}`, "$wr", z], wo, { mirror: `Wheel_R${i + 1}RO` }));
    wheels.push(wheel(`Wheel_R${i + 1}LI`, [`$width / 2 - ${f(tw * 1.5 + 0.04)}`, "$wr", z], { ...wo, style: "disc", rim: "chassis_black" }, { mirror: `Wheel_R${i + 1}RI` }));
  });
  rearZ.forEach((z, i) => wheels.push(box(`Axle_R${i + 1}`, ["$width - 0.5", 0.16, 0.16], { at: [0, "$wr", z], material: "chassis_black" })));
  wheels.push(box("Axle_F1", ["$width - 0.5", 0.14, 0.14], { at: [0, "$wr", "$zf"], material: "chassis_black" }));
  if (t.front === 2) wheels.push(box("Axle_F2", ["$width - 0.5", 0.14, 0.14], { at: [0, "$wr", "$zf - 1.9"], material: "chassis_black" }));
  wheels.push(box("Spring_L", [0.12, 0.12, 1.4], { at: [0.45, "$wr + 0.12", "$zr"], material: "chassis_black", mirror: "Spring_R" }));
  kids.push(group("Running", wheels));

  const cabLen = bonnet ? 1.9 : 2.25;
  nodes.push(group("Truck", kids, {
    vars: {
      L2: "$length / 2", wr: "$wheelRadius", ry: "$wheelRadius + 0.6",
      cw: "$width - 0.06", cy0: "$wheelRadius + 0.72", chh: bonnet ? 2.0 : 2.15,
      cz1: bonnet ? "$length / 2 - 1.75" : "$length / 2", cz0: bonnet ? `$length / 2 - ${f(1.75 + cabLen)}` : `$length / 2 - ${f(cabLen)}`,
      zf: bonnet ? "$length / 2 - 1.15" : "$length / 2 - 1.3",
      zr: `-$length / 2 + $length * ${t.rear === 2 ? 0.28 : 0.25}`,
    },
  }));

  const axles = t.front + t.rear;
  const wheelsN = t.front * 2 + t.rear * 4;
  const kind = t.cargo === "box" ? "box truck" : t.cargo === "flatbed" ? "flatbed truck" : t.cargo === "tipper" ? "tipper truck" : "tanker truck";
  return {
    slug: slugify("truck", t.cargo, `${axles}-axle`, t.cab === "bonnet" ? "bonneted" : "", t.cabName),
    title: `${t.cabName.charAt(0).toUpperCase()}${t.cabName.slice(1)} ${axles}-axle ${kind}`,
    description: `A ${t.cabName} ${t.cab === "cabover" ? "cab-over" : "bonneted"} ${kind} on ${axles} axles (${wheelsN} wheels, twin tyres at the rear) with ${CARGO_TEXT[t.cargo]} (${t.bodyName}), every wheel pivoting at its hub. It faces +z.`,
    tags: [kind, t.cargo, t.cab, t.cabName, t.nl, `${axles} axles`, t.cargo === "box" ? "bakwagen" : t.cargo === "tipper" ? "kipper" : t.cargo === "tanker" ? "tankwagen" : "open laadbak"],
    params: [
      num("length", t.length[0], t.length[1], t.length[2], "Overall length in metres."),
      num("width", 2.5, 2.4, 2.55, "Width of the cab and body in metres."),
      num("cargoHeight", t.cargoH[0], t.cargoH[1], t.cargoH[2], t.cargo === "tanker" ? "Height (diameter) of the tank in metres." : t.cargo === "flatbed" ? "Height of the pallet load in metres." : "Height of the cargo body in metres."),
      num("wheelRadius", 0.5, 0.47, 0.54, "Tyre radius in metres."),
    ],
    materials: {
      cab_paint: t.cab_, body_paint: BODY_MATS[t.body]!, deck_wood: BODY_MATS["deck_wood"]!,
      ...WHEEL_MATS(),
      rim_grey: { color: [0.5, 0.51, 0.52], metallic: 0.4, roughness: 0.45, texture: "painted" },
      ring_paint: { color: [0.08, 0.085, 0.09], metallic: 0.3, roughness: 0.45, texture: "painted" },
      tape_red: { color: [0.36, 0.02, 0.015], metallic: 0, roughness: 0.3 },
      tape_white: { color: [0.62, 0.62, 0.58], metallic: 0, roughness: 0.3 },
      rivet: { color: [0.55, 0.56, 0.57], metallic: 1, roughness: 0.35 },
      stainless_dull: { color: [0.5, 0.5, 0.5], metallic: 1, roughness: 0.4, texture: "brushed" },
      wrap: { color: [0.42, 0.44, 0.46], metallic: 0, roughness: 0.25, texture: "plastic" },
      strap: { color: [0.5, 0.2, 0.012], metallic: 0, roughness: 0.75, texture: "fabric" },
      spoil: { color: [0.2, 0.15, 0.1], metallic: 0, roughness: 1, texture: "ground" },
      ...mats("chrome", "aluminium"),
      dark_glass: VMATS["dark_glass"]!, trim_black: VMATS["trim_black"]!, tyre: VMATS["tyre"]!, lamp_lens: VMATS["lamp_lens"]!, lamp_red: VMATS["lamp_red"]!, lamp_amber: VMATS["lamp_amber"]!, plate_yellow: VMATS["plate_yellow"]!,
      mirror_face: { color: [0.62, 0.64, 0.66], metallic: 1, roughness: 0.06 },
    },
    nodes,
  };
}

export const truck: Family = {
  id: "truck",
  category: "vehicles",
  archetype: "vehicle.wheeled.truck",
  tags: ["truck", "lorry", "vrachtwagen", "vrachtauto", "goods vehicle", "vehicle", "voertuig"],
  assets: () => TRUCKS.map((t) => buildTruck(t)),
};
