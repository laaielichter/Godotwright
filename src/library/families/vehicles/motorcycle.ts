import { box, cyl, ellipsoid, group, lathe, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { carPaint, f, ringProfile, VMATS } from "./parts.js";

type Style = "cruiser" | "sport" | "scooter" | "dirt";

interface MotoStyle {
  name: string;
  text: string;
  wheel: [number, number, number];
  /** Rear radius as a fraction of the front. */
  kr: number;
  wb: [number, number, number];
  seat: [number, number, number];
  rake: number;
  fork: number;
  /** Tyre cross-section radius, front and rear. */
  tf: number;
  tr: number;
  spokes: "wire" | "cast" | "disc";
  colours: [string, string, MaterialDef][];
}

const P = (r: number, g: number, b: number, m = 0.5): MaterialDef => carPaint(r, g, b, m, 0.22);

const STYLES: Record<Style, MotoStyle> = {
  cruiser: {
    name: "cruiser", text: "a long, low cruiser with a teardrop tank, a V-twin engine, wide pulled-back bars, chrome pipes and wire wheels",
    wheel: [0.33, 0.32, 0.35], kr: 0.98, wb: [1.65, 1.55, 1.75], seat: [0.68, 0.64, 0.74], rake: 32, fork: 0.82, tf: 0.06, tr: 0.085, spokes: "wire",
    colours: [["black", "zwart", P(0.015, 0.015, 0.017)], ["burgundy", "bordeaux", P(0.25, 0.015, 0.03)], ["cream", "crème", P(0.72, 0.62, 0.42, 0.2)]],
  },
  sport: {
    name: "sport bike", text: "a sport bike with a full fairing and screen, clip-on bars, a high tail and cast wheels",
    wheel: [0.3, 0.29, 0.31], kr: 1.02, wb: [1.42, 1.36, 1.48], seat: [0.82, 0.78, 0.86], rake: 24, fork: 0.72, tf: 0.058, tr: 0.09, spokes: "cast",
    colours: [["red", "rood", P(0.55, 0.01, 0.01)], ["blue", "blauw", P(0.02, 0.1, 0.5)], ["lime green", "limoengroen", P(0.25, 0.55, 0.02)]],
  },
  scooter: {
    name: "scooter", text: "a step-through scooter with a leg shield, a flat floorboard, a covered engine under the seat and small disc wheels",
    wheel: [0.23, 0.21, 0.25], kr: 1, wb: [1.32, 1.26, 1.4], seat: [0.78, 0.74, 0.82], rake: 28, fork: 0.62, tf: 0.05, tr: 0.055, spokes: "disc",
    colours: [["mint", "mintgroen", P(0.35, 0.6, 0.45, 0.2)], ["white", "wit", P(0.8, 0.8, 0.78, 0.1)], ["yellow", "geel", P(0.8, 0.5, 0.02, 0.3)]],
  },
  dirt: {
    name: "dirt bike", text: "a tall off-road dirt bike with long-travel suspension, a high front fender, a slim seat, number boards and knobbly tyres",
    wheel: [0.36, 0.35, 0.37], kr: 0.92, wb: [1.48, 1.42, 1.54], seat: [0.95, 0.9, 0.98], rake: 27, fork: 0.98, tf: 0.045, tr: 0.06, spokes: "wire",
    colours: [["orange", "oranje", P(0.85, 0.25, 0.01, 0.1)], ["white", "wit", P(0.82, 0.82, 0.8, 0.05)], ["green", "groen", P(0.08, 0.45, 0.06, 0.1)]],
  },
};

/** A motorcycle wheel at its hub: a round tyre, rim, spokes (wire, cast or a disc), brake disc and hub. */
function motoWheel(name: string, at: Vec, r: string, t: number, st: MotoStyle, front: boolean, knobs: boolean): SpecNode {
  const k: SpecNode[] = [
    lathe("Tyre", ringProfile(`${r} - ${f(t)}`, t, 12), { rotate: [0, 0, -90], segments: 36, caps: false, material: "tyre" }),
    lathe("Rim", [[`${r} - ${f(2 * t + 0.035)}`, 0], [`${r} - ${f(2 * t - 0.006)}`, -t * 0.75], [`${r} - ${f(2 * t - 0.006)}`, t * 0.75], [`${r} - ${f(2 * t + 0.035)}`, 0]], { rotate: [0, 0, -90], segments: 36, caps: false, material: st.spokes === "cast" ? "rim_black" : "chrome" }),
    cyl("Hub", 0.05, t * 2 + 0.03, { axis: "x", segments: 16, material: "aluminium", bevel: 0.006 }),
    cyl("Axle", 0.012, t * 2 + 0.12, { axis: "x", segments: 8, material: "steel" }),
  ];
  const inner = `${r} - ${f(2 * t + 0.03)}`;
  if (st.spokes === "wire") k.push(cyl("Spoke_{i}", 0.0025, `${inner} - 0.05`, { at: [0, `(${inner} - 0.05) / 2 + 0.045`, 0], repeat: { count: 36, around: "x" }, segments: 4, material: "chrome" }));
  else if (st.spokes === "cast") k.push(box("Spoke_{i}", [0.03, `${inner} - 0.05`, 0.035], { at: [0, `(${inner} - 0.05) / 2 + 0.045`, 0], repeat: { count: 5, around: "x" }, bevel: 0.008, material: "rim_black" }));
  else k.push(cyl("Disc", `${inner} + 0.005`, 0.05, { axis: "x", segments: 28, material: "rim_black", bevel: 0.01 }));
  if (front || st.spokes === "cast") k.push(cyl("Rotor", `${inner} * 0.75`, 0.006, { axis: "x", at: [0.055, 0, 0], segments: 28, material: "steel" }));
  if (knobs) k.push(box("Knob_{i}", [t * 1.7, 0.016, 0.022], { at: [0, `${r} - 0.004`, 0], repeat: { count: 44, around: "x" }, material: "tyre" }));
  return group(name, k, { at });
}

function moto(st: Style, ci: number): AssetDraft {
  const S = STYLES[st];
  const [cname, cnl, paint] = S.colours[ci]!;
  const frame: SpecNode[] = [];
  const H: Vec = [0, "$hy", "$hz"];
  // Frame tubes: head stock, backbone to the swingarm pivot, cradle under the engine, rear subframe.
  frame.push(cyl("HeadStock", 0.035, 0.2, { at: [0, "$hy - 0.08", "$hz - 0.03"], rotate: [-S.rake, 0, 0], segments: 14, material: "frame_metal" }));
  if (st !== "scooter") {
    frame.push(tube("Backbone_L", [[0.02, "$hy - 0.03", "$hz - 0.05"], [0.1, "$hy - 0.1", "$hz - 0.4"], [0.1, "$py + 0.12", "$pz + 0.02"]], 0.022, { segments: 10, material: "frame_metal", mirror: "Backbone_R" }));
    frame.push(tube("Cradle_L", [[0.02, "$hy - 0.15", "$hz - 0.06"], [0.08, "$py - 0.12", "$hz - 0.25"], [0.08, "$py - 0.14", "$pz + 0.05"], [0.08, "$py", "$pz"]], 0.018, { segments: 10, material: "frame_metal", mirror: "Cradle_R" }));
    frame.push(tube("Subframe_L", [[0.09, "$py + 0.1", "$pz"], [0.09, "$sh - 0.1", "-$wb * 0.35"], [0.08, "$sh - 0.03", "-$wb / 2 - 0.05"]], 0.013, { segments: 8, material: "frame_metal", mirror: "Subframe_R" }));
    frame.push(tube("Swingarm_L", [[0.1, "$py", "$pz"], [0.11, "$Rr", "-$wb / 2"]], 0.026, { segments: 10, material: st === "cruiser" ? "chrome" : "aluminium", mirror: "Swingarm_R" }));
    frame.push(tube("Shock_L", [[0.11, "$py + ($Rr - $py) * 0.35", "$pz - (-$wb / 2 - $pz) * -0.6"], [0.1, "$sh - 0.12", "-$wb * 0.3"]], 0.022, { segments: 10, material: st === "dirt" ? "spring_yellow" : "chrome", mirror: "Shock_R" }));
    frame.push(cyl("Pivot", 0.025, 0.24, { axis: "x", at: [0, "$py", "$pz"], segments: 12, material: "aluminium" }));
  }
  // Engine.
  if (st === "cruiser") {
    frame.push(box("Crankcase", [0.26, 0.26, 0.42], { at: [0, "$py - 0.02", "$pz + 0.3"], bevel: 0.06, material: "aluminium" }));
    frame.push(group("CylinderFront", [cyl("Barrel", 0.065, 0.28, { segments: 16, material: "engine_black" }), ...[0, 1, 2, 3, 4].map((i) => cyl(`Fin${i + 1}`, 0.085, 0.012, { at: [0, -0.1 + i * 0.05, 0], segments: 16, material: "engine_black" })), cyl("Head", 0.08, 0.07, { at: [0, 0.16, 0], segments: 16, material: "chrome", bevel: 0.015 })], { at: [0, "$py + 0.2", "$pz + 0.45"], rotate: [28, 0, 0] }));
    frame.push(group("CylinderRear", [cyl("Barrel", 0.065, 0.28, { segments: 16, material: "engine_black" }), ...[0, 1, 2, 3, 4].map((i) => cyl(`Fin${i + 1}`, 0.085, 0.012, { at: [0, -0.1 + i * 0.05, 0], segments: 16, material: "engine_black" })), cyl("Head", 0.08, 0.07, { at: [0, 0.16, 0], segments: 16, material: "chrome", bevel: 0.015 })], { at: [0, "$py + 0.2", "$pz + 0.15"], rotate: [-28, 0, 0] }));
    frame.push(tube("Exhaust_U", [[-0.07, "$py + 0.2", "$pz + 0.5"], [-0.15, "$py - 0.05", "$pz + 0.45"], [-0.16, "$Rr - 0.05", "$pz + 0.1"], [-0.17, "$Rr - 0.03", "-$wb / 2 - 0.25"]], 0.035, { segments: 12, material: "chrome" }));
    frame.push(tube("Exhaust_L", [[-0.07, "$py + 0.15", "$pz + 0.12"], [-0.15, "$py + 0.02", "$pz + 0.05"], [-0.17, "$Rr + 0.08", "-$wb / 2 - 0.2"]], 0.032, { segments: 12, material: "chrome" }));
    frame.push(ellipsoid("AirFilter", [0.03, 0.09, 0.09], { at: [0.16, "$py + 0.15", "$pz + 0.3"], segments: 16, material: "chrome" }));
  } else if (st === "sport" || st === "dirt") {
    frame.push(box("Crankcase", [0.32, 0.3, 0.4], { at: [0, "$py - 0.03", "$pz + 0.3"], bevel: 0.05, material: st === "dirt" ? "aluminium" : "engine_black" }));
    frame.push(box("Block", [0.3, 0.3, 0.2], { at: [0, "$py + 0.2", "$pz + 0.42"], rotate: [-20, 0, 0], bevel: 0.04, material: "engine_black" }));
    frame.push(tube("Header", [[0, "$py + 0.2", "$pz + 0.56"], [0, "$py - 0.12", "$pz + 0.6"], [-0.08, "$py - 0.2", "$pz + 0.3"], [-0.12, "$py - 0.1", "$pz - 0.05"]], 0.025, { segments: 10, material: "steel" }));
    frame.push(cyl("Silencer", st === "dirt" ? 0.05 : 0.06, 0.45, { axis: "z", at: [-0.14, st === "dirt" ? "$sh - 0.2" : "$py + 0.05", "-$wb / 2 + 0.08"], rotate: [st === "dirt" ? -12 : -15, 0, 0], segments: 16, material: st === "dirt" ? "aluminium" : "carbon", bevel: 0.015 }));
    frame.push(tube("Link", [[-0.12, "$py - 0.1", "$pz - 0.05"], [-0.14, st === "dirt" ? "$sh - 0.25" : "$py + 0.02", "-$wb / 2 + 0.3"]], 0.025, { segments: 10, material: "steel" }));
    frame.push(box("Radiator", [0.34, 0.3, 0.05], { at: [0, "$hy - 0.38", "$hz - 0.15"], rotate: [-S.rake, 0, 0], bevel: 0.01, material: "engine_black" }));
  }
  // Tank, seat, tail.
  if (st === "scooter") {
    frame.push(loft("RearPanel", [
      { z: "-$wb / 2 - 0.2", superellipse: { width: 0.2, height: 0.18, n: 2.6, count: 24, cy: "$sh - 0.14" } },
      { z: "-$wb / 2 + 0.02", superellipse: { width: 0.34, height: 0.32, n: 2.6, count: 24, cy: "$sh - 0.2" } },
      { z: "-0.12", superellipse: { width: 0.36, height: 0.36, n: 2.6, count: 24, cy: "$sh - 0.23" } },
      { z: "0.06", superellipse: { width: 0.24, height: 0.26, n: 2.6, count: 24, cy: "$sh - 0.24" } },
    ], { material: "paint" }));
    frame.push(loft("Seat", [
      { z: "-$wb / 2 - 0.08", superellipse: { width: 0.24, height: 0.08, n: 3, count: 16, cy: "$sh - 0.04" } },
      { z: "-$wb / 2 + 0.2", superellipse: { width: 0.3, height: 0.11, n: 3, count: 16, cy: "$sh - 0.02" } },
      { z: "0.02", superellipse: { width: 0.28, height: 0.1, n: 3, count: 16, cy: "$sh - 0.03" } },
    ], { material: "leather" }));
    frame.push(box("Grab", [0.3, 0.03, 0.12], { at: [0, "$sh - 0.06", "-$wb / 2 - 0.16"], bevel: 0.01, material: "chrome" }));
    frame.push(box("Floorboard", [0.36, 0.08, "$hz - 0.12"], { at: [0, "$R + 0.08", "$hz / 2 + 0.02"], bevel: 0.02, material: "paint" }));
    frame.push(box("Mat", [0.3, 0.012, "$hz - 0.2"], { at: [0, "$R + 0.125", "$hz / 2 + 0.02"], material: "rubber" }));
    frame.push(loft("Tunnel", [
      { z: "0.05", superellipse: { width: 0.2, height: 0.24, n: 3, count: 16, cy: "$R + 0.2" } },
      { z: "$hz - 0.12", superellipse: { width: 0.2, height: 0.3, n: 3, count: 16, cy: "$R + 0.25" } },
    ], { material: "paint" }));
    frame.push(loft("LegShield", [
      { z: "$hz - 0.16", superellipse: { width: 0.42, height: "$hy - $R - 0.05", n: 3, count: 24, cy: "($hy + $R) / 2" } },
      { z: "$hz - 0.06", superellipse: { width: 0.46, height: "$hy - $R + 0.02", n: 3, count: 24, cy: "($hy + $R) / 2 + 0.02" } },
      { z: "$hz + 0.02", superellipse: { width: 0.36, height: "$hy - $R - 0.1", n: 3, count: 24, cy: "($hy + $R) / 2" } },
    ], { material: "paint" }));
    frame.push(box("EngineCase", [0.16, 0.2, 0.5], { at: [-0.1, "$Rr + 0.05", "-$wb / 2 + 0.22"], bevel: 0.04, material: "aluminium" }));
    frame.push(cyl("Silencer", 0.05, 0.36, { axis: "z", at: [0.14, "$Rr + 0.05", "-$wb / 2 + 0.05"], segments: 14, material: "chrome", bevel: 0.01 }));
    frame.push(box("Bracket", [0.12, 0.05, 0.08], { at: [0.08, "$Rr + 0.05", "-$wb / 2 + 0.2"], material: "aluminium" }));
    frame.push(tube("Shock", [[-0.1, "$Rr + 0.1", "-$wb / 2 + 0.05"], [-0.1, "$sh - 0.4", "-$wb / 2 + 0.1"]], 0.02, { segments: 8, material: "spring_yellow" }));
  } else if (st === "cruiser") {
    frame.push(ellipsoid("Tank", [0.17, 0.13, 0.32], { at: [0, "$hy - 0.03", "$hz - 0.38"], segments: 20, material: "paint" }));
    frame.push(ellipsoid("Seat", [0.19, 0.06, 0.34], { at: [0, "$sh - 0.04", "$hz - 0.95"], segments: 18, material: "leather" }));
    frame.push(ellipsoid("Pillion", [0.14, 0.05, 0.17], { at: [0, "$sh + 0.02", "$hz - 1.33"], segments: 14, material: "leather" }));
    frame.push(ellipsoid("RearFender", [0.13, 0.08, 0.36], { at: [0, "$Rr * 2 - 0.02", "-$wb / 2 + 0.02"], rotate: [8, 0, 0], segments: 18, material: "paint" }));
    frame.push(cyl("Footboard_L", 0.03, 0.3, { axis: "x", at: [0.2, "$py - 0.1", "$pz + 0.6"], segments: 10, material: "rubber", mirror: "Footboard_R" }));
  } else if (st === "sport") {
    frame.push(loft("Tank", [
      { z: "$hz - 0.12", superellipse: { width: 0.28, height: 0.2, n: 2.4, count: 20, cy: "$hy - 0.05" } },
      { z: "$hz - 0.35", superellipse: { width: 0.36, height: 0.24, n: 2.4, count: 20, cy: "$hy - 0.04" } },
      { z: "$hz - 0.62", superellipse: { width: 0.28, height: 0.14, n: 2.4, count: 20, cy: "$sh - 0.01" } },
    ], { material: "paint" }));
    frame.push(loft("Seat", [
      { z: "$hz - 0.6", superellipse: { width: 0.26, height: 0.08, n: 3, count: 16, cy: "$sh - 0.02" } },
      { z: "$hz - 0.88", superellipse: { width: 0.24, height: 0.08, n: 3, count: 16, cy: "$sh - 0.01" } },
    ], { material: "leather" }));
    frame.push(loft("Tail", [
      { z: "$hz - 0.86", superellipse: { width: 0.28, height: 0.22, n: 2.6, count: 20, cy: "$sh - 0.06" } },
      { z: "-$wb / 2 + 0.05", superellipse: { width: 0.2, height: 0.14, n: 2.6, count: 20, cy: "$sh + 0.06" } },
      { z: "-$wb / 2 - 0.22", superellipse: { width: 0.1, height: 0.07, n: 2.6, count: 20, cy: "$sh + 0.1" } },
    ], { material: "paint" }));
    frame.push(loft("Fairing", [
      { z: "$hz - 0.55", superellipse: { width: 0.44, height: 0.42, n: 2.4, count: 24, cy: "$py + 0.08" } },
      { z: "$hz - 0.15", superellipse: { width: 0.5, height: "$hy - $py + 0.25", n: 2.4, count: 24, cy: "($hy + $py) / 2 - 0.02" } },
      { z: "$hz + 0.12", superellipse: { width: 0.36, height: "$hy - $py", n: 2.4, count: 24, cy: "($hy + $py) / 2 + 0.06" } },
      { z: "$hz + 0.25", superellipse: { width: 0.12, height: 0.16, n: 2.4, count: 24, cy: "$hy - 0.12" } },
    ], { material: "paint" }));
    frame.push(box("Screen", [0.3, 0.02, 0.32], { at: [0, "$hy + 0.06", "$hz + 0.05"], rotate: [-30, 0, 0], bevel: 0.008, material: "screen_glass" }));
    frame.push(box("Headlamp_L", [0.1, 0.05, 0.08], { at: [0.08, "$hy - 0.12", "$hz + 0.23"], rotate: [-20, 0, 0], bevel: 0.015, material: "lamp_lens", mirror: "Headlamp_R" }));
    frame.push(box("Peg_L", [0.12, 0.025, 0.025], { at: [0.16, "$py + 0.02", "$pz - 0.05"], material: "aluminium", mirror: "Peg_R" }));
  } else {
    frame.push(loft("Tank", [
      { z: "$hz - 0.08", superellipse: { width: 0.24, height: 0.16, n: 2.4, count: 20, cy: "$hy - 0.08" } },
      { z: "$hz - 0.32", superellipse: { width: 0.3, height: 0.2, n: 2.4, count: 20, cy: "$sh - 0.06" } },
    ], { material: "plastic_white" }));
    frame.push(loft("Shroud_L", [
      { z: "$hz - 0.02", points: [[0.1, "$hy - 0.05"], [0.17, "$hy - 0.12"], [0.17, "$hy - 0.38"], [0.1, "$hy - 0.32"]] },
      { z: "$hz - 0.32", points: [[0.12, "$sh - 0.02"], [0.16, "$sh - 0.06"], [0.16, "$sh - 0.25"], [0.12, "$sh - 0.2"]] },
    ], { material: "paint", mirror: "Shroud_R" }));
    frame.push(loft("Seat", [
      { z: "$hz - 0.3", superellipse: { width: 0.2, height: 0.08, n: 3, count: 16, cy: "$sh - 0.02" } },
      { z: "-$wb / 2 - 0.1", superellipse: { width: 0.18, height: 0.07, n: 3, count: 16, cy: "$sh + 0.03" } },
    ], { material: "leather" }));
    frame.push(loft("RearFender", [
      { z: "-$wb / 2 + 0.25", superellipse: { width: 0.2, height: 0.05, n: 2.5, count: 16, cy: "$sh - 0.06" } },
      { z: "-$wb / 2 - 0.45", superellipse: { width: 0.16, height: 0.03, n: 2.5, count: 16, cy: "$sh + 0.08" } },
    ], { material: "paint" }));
    frame.push(box("NumberPlate_L", [0.01, 0.2, 0.3], { at: [0.13, "$sh - 0.2", "-$wb / 2 + 0.12"], bevel: 0.01, material: "plastic_white", mirror: "NumberPlate_R" }));
    frame.push(box("Peg_L", [0.12, 0.025, 0.04], { at: [0.16, "$py - 0.05", "$pz + 0.02"], material: "steel", mirror: "Peg_R" }));
  }
  if (st === "cruiser" || st === "scooter") frame.push(box("TailLamp", [0.12, 0.05, 0.05], { at: [0, st === "scooter" ? "$sh - 0.2" : "$Rr * 2 + 0.03", st === "scooter" ? "-$wb / 2 - 0.2" : "-$wb / 2 - 0.3"], bevel: 0.015, material: "lamp_red" }));
  else frame.push(box("TailLamp", [0.1, 0.035, 0.04], { at: [0, "$sh + 0.06", st === "sport" ? "-$wb / 2 - 0.2" : "-$wb / 2 - 0.42"], bevel: 0.01, material: "lamp_red" }));
  if (st === "scooter") frame.push(box("Stand", [0.3, "$R + 0.06", 0.04], { at: [0, "($R + 0.06) / 2", 0.2], bevel: 0.006, material: "steel" }));
  else frame.push(cyl("Stand", 0.012, "$py - 0.02", { at: [0.12, "($py - 0.02) / 2 + 0.01", "$pz - 0.02"], rotate: [0, 0, 25], segments: 6, material: "steel" }));

  // Fork: pivots about the tilted steering axis at the top clamp; holds the front wheel, the bars and the lamp.
  const fork: SpecNode[] = [];
  const lx = st === "scooter" ? 0.07 : 0.1;
  fork.push(box("TopClamp", [lx * 2 + 0.07, 0.03, 0.07], { bevel: 0.01, material: "aluminium" }));
  fork.push(box("LowerClamp", [lx * 2 + 0.07, 0.04, 0.07], { at: [0, -0.18, 0], bevel: 0.01, material: "aluminium" }));
  fork.push(cyl("Stanchion_L", 0.022, "$Lf * 0.6", { at: [lx, "-$Lf * 0.3 + 0.02", 0], segments: 12, material: st === "dirt" ? "gold" : "chrome", mirror: "Stanchion_R" }));
  fork.push(cyl("Slider_L", 0.03, "$Lf * 0.45", { at: [lx, "-$Lf * 0.775", 0], segments: 12, material: st === "scooter" ? "paint" : "aluminium", mirror: "Slider_R" }));
  // Front fender over the wheel.
  if (st === "dirt") fork.push(loft("Fender", [
    { z: -0.25, superellipse: { width: 0.17, height: 0.03, n: 2.5, count: 16, cy: -0.21 } },
    { z: 0.05, superellipse: { width: 0.2, height: 0.04, n: 2.5, count: 16, cy: -0.2 } },
    { z: 0.38, superellipse: { width: 0.14, height: 0.025, n: 2.5, count: 16, cy: -0.24 } },
  ], { material: "plastic_white" }));
  else fork.push(tube("Fender", Array.from({ length: 9 }, (_, i) => {
    const a = ((-20 + i * 22) * Math.PI) / 180;
    return [0, `-$Lf + ($R + 0.04) * ${f(Math.sin(a))}`, `($R + 0.04) * ${f(Math.cos(a))}`] as Vec;
  }), [0.055, 0.06, 0.065, 0.065, 0.065, 0.065, 0.065, 0.06, 0.05], { segments: 10, material: st === "cruiser" ? "paint" : "paint" }));
  // Bars and controls (they turn with the fork).
  const bars: SpecNode[] = [];
  if (st === "sport") {
    bars.push(tube("Bar_L", [[lx, -0.17, 0], [0.32, -0.15, -0.08]], 0.012, { segments: 8, material: "aluminium", mirror: "Bar_R" }));
    bars.push(cyl("Grip_L", 0.018, 0.11, { axis: "x", at: [0.3, -0.15, -0.075], rotate: [0, 15, 0], segments: 10, material: "rubber", mirror: "Grip_R" }));
  } else {
    const w = st === "cruiser" ? 0.42 : st === "dirt" ? 0.4 : 0.34;
    const back = st === "cruiser" ? -0.3 : st === "scooter" ? -0.08 : -0.08;
    const up = st === "cruiser" ? 0.2 : st === "scooter" ? 0.12 : 0.12;
    bars.push(tube("Riser", [[0, 0, 0], [0, up * 0.6, 0]], 0.02, { segments: 8, material: "chrome" }));
    bars.push(tube("Bar_L", [[0, up * 0.6, 0], [w * 0.4, up, back * 0.3], [w, up, back]], 0.013, { segments: 10, material: st === "dirt" ? "aluminium" : "chrome", mirror: "Bar_R" }));
    bars.push(cyl("Grip_L", 0.019, 0.12, { axis: "x", at: [w - 0.03, up, back], segments: 10, material: "rubber", mirror: "Grip_R" }));
    bars.push(box("Lever_L", [0.13, 0.012, 0.025], { at: [w - 0.1, up + 0.01, back + 0.05], material: "aluminium", mirror: "Lever_R" }));
  }
  bars.push(box("Clocks", [0.14, 0.06, 0.1], { at: [0, st === "cruiser" ? 0.08 : 0.06, 0.03], rotate: [-20, 0, 0], bevel: 0.02, material: "engine_black" }));
  if (st === "cruiser" || st === "dirt") bars.push(group("Mirror_L", [tube("Stalk", [[0, 0, 0], [0.04, 0.16, 0.02]], 0.007, { segments: 6, material: "chrome" }), ellipsoid("Head", [0.055, 0.04, 0.015], { at: [0.04, 0.18, 0.02], segments: 12, material: "chrome" })], { at: [0.25, 0.1, -0.05], mirror: "Mirror_R" }));
  fork.push(group("Handlebar", bars, { at: [0, 0.02, 0] }));
  if (st === "cruiser" || st === "dirt" || st === "scooter") {
    fork.push(group("Headlamp", [
      cyl("Shell", st === "dirt" ? 0.07 : 0.09, 0.12, { axis: "z", segments: 20, material: st === "dirt" ? "plastic_white" : "chrome", bevel: 0.02 }),
      cyl("Lens", st === "dirt" ? 0.055 : 0.078, 0.02, { axis: "z", at: [0, 0, 0.065], segments: 20, material: "lamp_lens" }),
    ], { at: [0, -0.12, st === "dirt" ? 0.14 : 0.12] }));
  }
  fork.push(motoWheel("WheelFront", [0, "-$Lf", 0], "$R", S.tf, S, true, st === "dirt"));
  const forkNode = group("Fork", fork, { at: H, rotate: [-S.rake, 0, 0] });

  const nodes: SpecNode[] = [group("Motorcycle", [
    group("Frame", frame, { material: "paint" }),
    forkNode,
    motoWheel("WheelRear", [0, "$Rr", "-$wb / 2"], "$Rr", S.tr, S, false, st === "dirt"),
    ...(st === "scooter" ? [] : [group("Chain", [
      cyl("Sprocket", "$Rr * 0.45", 0.01, { axis: "x", at: [-0.12, "$Rr", "-$wb / 2"], segments: 24, material: "steel" }),
      tube("RunTop", [[-0.12, "$Rr + $Rr * 0.45", "-$wb / 2"], [-0.12, "$py + 0.05", "$pz + 0.08"]], 0.006, { segments: 4, material: "steel" }),
      tube("RunBottom", [[-0.12, "$Rr - $Rr * 0.45", "-$wb / 2"], [-0.12, "$py - 0.05", "$pz + 0.08"]], 0.006, { segments: 4, material: "steel" }),
    ])]),
  ], {
    vars: {
      R: "$wheelRadius", Rr: `$wheelRadius * ${f(S.kr)}`, wb: "$wheelbase", sh: "$seatHeight", Lf: S.fork,
      hz: `$wheelbase / 2 - ${f(S.fork)} * ${f(Math.sin((S.rake * Math.PI) / 180))}`, hy: `$wheelRadius + ${f(S.fork)} * ${f(Math.cos((S.rake * Math.PI) / 180))}`,
      pz: "-$wheelbase * 0.12", py: `$wheelRadius * ${f(S.kr)} + ${st === "dirt" ? 0.2 : 0.1}`,
    },
  })];

  return {
    slug: slugify("motorcycle", st === "dirt" ? "dirt-bike" : st === "sport" ? "sport-bike" : st, cname),
    title: `${cname.charAt(0).toUpperCase()}${cname.slice(1)} ${S.name}`,
    description: `A ${cname} ${S.name}: ${S.text}. The fork turns about the raked steering axis at the top clamp and carries the front wheel; both wheels pivot at their hubs. It faces +z.`,
    tags: [S.name, st, cname, cnl, st === "scooter" ? "scooter" : "motor", "motorfiets", st === "dirt" ? "crossmotor" : st === "sport" ? "sportmotor" : st === "cruiser" ? "chopper" : "brommer"],
    params: [
      num("wheelbase", S.wb[0], S.wb[1], S.wb[2], "Distance between the axles in metres."),
      num("wheelRadius", S.wheel[0], S.wheel[1], S.wheel[2], "Front tyre radius in metres."),
      num("seatHeight", S.seat[0], S.seat[1], S.seat[2], "Height of the seat in metres."),
    ],
    materials: {
      paint, carbon: VMATS["carbon"]!, tyre: VMATS["tyre"]!, lamp_lens: VMATS["lamp_lens"]!, lamp_red: VMATS["lamp_red"]!,
      frame_metal: st === "cruiser" ? { color: [0.02, 0.02, 0.022], metallic: 0.6, roughness: 0.35 } : st === "dirt" ? { color: [0.5, 0.52, 0.55], metallic: 0.9, roughness: 0.3 } : { color: [0.1, 0.1, 0.11], metallic: 0.7, roughness: 0.4 },
      engine_black: { color: [0.03, 0.03, 0.032], metallic: 0.6, roughness: 0.45 },
      rim_black: { color: [0.03, 0.03, 0.032], metallic: 0.5, roughness: 0.35 },
      leather: { color: [0.025, 0.022, 0.02], metallic: 0, roughness: 0.55 },
      spring_yellow: { color: [0.8, 0.55, 0.02], metallic: 0.4, roughness: 0.4 },
      screen_glass: { color: [0.2, 0.25, 0.3, 0.45], metallic: 0, roughness: 0.05, alpha: "BLEND" },
      ...mats("aluminium", "steel", "chrome", "gold", "rubber", "plastic_white"),
    },
    nodes,
  };
}

export const motorcycle: Family = {
  id: "motorcycle",
  category: "vehicles",
  archetype: "vehicle.wheeled.motorcycle",
  tags: ["motorcycle", "motorbike", "motor", "motorfiets", "bike", "vehicle", "voertuig"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((st) => [0, 1, 2].map((ci) => moto(st, ci))),
};
