import { box, cyl, group, lathe, loft, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode, type Vec } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { carPaint, f, ringProfile, VMATS } from "./parts.js";

type Style = "dutch" | "road" | "mtb" | "city";

interface BikeStyle {
  name: string;
  text: string;
  /** Half the tyre width (its cross-section radius). */
  t: number;
  wheel: [number, number, number];
  frame: [number, number, number];
  wb: [number, number, number];
  fork: number;
  head: number;
  colours: [string, string, MaterialDef][];
}

const P = (r: number, g: number, b: number, m = 0.4): MaterialDef => carPaint(r, g, b, m, 0.3);

const STYLES: Record<Style, BikeStyle> = {
  dutch: {
    name: "Dutch omafiets", text: "an upright Dutch step-through bike with a swooping low frame tube, swept-back bars, full mudguards, a closed chain guard, a rear rack, a skirt guard and a headlamp",
    t: 0.022, wheel: [0.35, 0.34, 0.36], frame: [0.55, 0.5, 0.6], wb: [1.12, 1.08, 1.18], fork: 0.42, head: 0.2,
    colours: [["black", "zwart", P(0.015, 0.015, 0.017)], ["dark green", "donkergroen", P(0.02, 0.1, 0.05)], ["cream", "crème", P(0.72, 0.64, 0.46, 0.1)]],
  },
  road: {
    name: "road bike", text: "a light road racing bike with a diamond frame, drop handlebars, skinny tyres and deep rims",
    t: 0.013, wheel: [0.34, 0.335, 0.345], frame: [0.55, 0.49, 0.6], wb: [0.99, 0.96, 1.03], fork: 0.38, head: 0.15,
    colours: [["red", "rood", P(0.55, 0.02, 0.02, 0.6)], ["white", "wit", P(0.8, 0.8, 0.78, 0.1)], ["blue", "blauw", P(0.02, 0.1, 0.45, 0.6)]],
  },
  mtb: {
    name: "mountain bike", text: "a hardtail mountain bike with a sloping top tube, a suspension fork, a wide flat bar, disc brakes and knobbly tyres",
    t: 0.03, wheel: [0.36, 0.34, 0.37], frame: [0.45, 0.4, 0.5], wb: [1.12, 1.08, 1.18], fork: 0.5, head: 0.12,
    colours: [["orange", "oranje", P(0.85, 0.22, 0.01, 0.5)], ["matte black", "mat zwart", { color: [0.02, 0.02, 0.022], metallic: 0.2, roughness: 0.7 }], ["lime green", "limoengroen", P(0.3, 0.6, 0.02, 0.4)]],
  },
  city: {
    name: "city bike", text: "a gentleman's city bike with a diamond frame, flat bars, mudguards, a rear rack and lights",
    t: 0.02, wheel: [0.35, 0.34, 0.36], frame: [0.56, 0.5, 0.62], wb: [1.08, 1.04, 1.14], fork: 0.41, head: 0.17,
    colours: [["grey", "grijs", P(0.2, 0.21, 0.22, 0.5)], ["navy", "donkerblauw", P(0.015, 0.03, 0.1)], ["burgundy", "bordeaux", P(0.22, 0.02, 0.04)]],
  },
};

/** A bicycle wheel at its hub: tyre and rim as rings, spokes, a hub; knobs or a brake disc for the mountain bike. */
function bikeWheel(name: string, z: Num, st: Style, t: number): SpecNode {
  const k: SpecNode[] = [
    lathe("Tyre", ringProfile(`$R - ${f(t)}`, t, 10), { rotate: [0, 0, -90], segments: 40, caps: false, material: st === "dutch" ? "tyre_cream" : "tyre" }),
    lathe("Rim", st === "road"
      ? [[`$R - ${f(2 * t + 0.045)}`, 0], [`$R - ${f(2 * t - 0.004)}`, -0.011], [`$R - ${f(2 * t - 0.004)}`, 0.011], [`$R - ${f(2 * t + 0.045)}`, 0]]
      : [[`$R - ${f(2 * t + 0.016)}`, 0], [`$R - ${f(2 * t - 0.004)}`, -0.012], [`$R - ${f(2 * t - 0.004)}`, 0.012], [`$R - ${f(2 * t + 0.016)}`, 0]],
    { rotate: [0, 0, -90], segments: 40, caps: false, material: st === "road" ? "carbon" : "aluminium" }),
    cyl("Hub", 0.022, 0.11, { axis: "x", segments: 14, material: "aluminium", bevel: 0.004 }),
    cyl("Spoke_{i}", 0.0018, `$R - ${f(2 * t + 0.03)}`, { at: [0, `($R - ${f(2 * t + 0.03)}) / 2 + 0.012`, 0], repeat: { count: st === "road" ? 20 : 32, around: "x" }, segments: 4, material: "steel" }),
  ];
  if (st === "mtb") {
    k.push(box("Knob_{i}", [2 * t * 0.85, 0.012, 0.018], { at: [0, "$R - 0.003", 0], repeat: { count: 56, around: "x" }, material: "tyre" }));
    k.push(cyl("Rotor", 0.08, 0.004, { axis: "x", at: [0.045, 0, 0], segments: 24, material: "steel" }));
  }
  return group(name, k, { at: [0, "$R", z] });
}

function bike(st: Style, ci: number): AssetDraft {
  const S = STYLES[st];
  const [cname, cnl, paint] = S.colours[ci]!;
  const t = S.t;
  const kids: SpecNode[] = [];
  // Key points of the frame (x = 0 plane).
  const BB: Vec = [0, "$bby", "$bbz"];
  const ST: Vec = [0, "$sty", "$stz"];
  const HT: Vec = [0, "$hty", "$htz"];
  const HB: Vec = [0, "$hby", "$hbz"];
  const RD = (x: number): Vec => [x, "$R", "-$wb / 2"];
  const tubes: SpecNode[] = [];
  const tr = st === "mtb" ? 0.024 : st === "road" ? 0.017 : 0.016;
  if (st === "dutch") {
    // Step-through: a low swooping tube from the head tube down past the bottom bracket, and a second, parallel one.
    tubes.push(tube("LoopTube", [[0, "$hty - 0.04", "$htz - 0.01"], [0, "$bby + 0.3", "$bbz + 0.25"], [0, "$bby + 0.12", "$bbz + 0.03"], [0, "$bby + 0.02", "$bbz"]], tr * 1.3, { segments: 12 }));
    tubes.push(tube("TwinTube", [[0, "$hty - 0.08", "$htz - 0.01"], [0, "$bby + 0.42", "$bbz + 0.15"], [0, "$bby + 0.3", "$stz + 0.04 + ($bbz - $stz) * 0.62"], [0, "$bby + ($sty - $bby) * 0.38", "$bbz + ($stz - $bbz) * 0.38"]], tr, { segments: 12 }));
  } else {
    const sloped = st === "mtb";
    tubes.push(tube("TopTube", [[0, sloped ? "$bby + ($sty - $bby) * 0.82" : "$sty - 0.03", sloped ? "$bbz + ($stz - $bbz) * 0.82" : "$stz + 0.01"], [0, "$hty - 0.03", "$htz - 0.01"]], tr * 0.9, { segments: 12 }));
    tubes.push(tube("DownTube", [[0, "$hby + 0.03", "$hbz - 0.01"], BB], tr * 1.25, { segments: 12 }));
  }
  if (st === "dutch") tubes.push(tube("DownTube", [[0, "$hby + 0.03", "$hbz - 0.01"], [0, "$bby + 0.06", "$bbz + 0.03"]], tr * 1.1, { segments: 12 }));
  tubes.push(tube("SeatTube", [BB, [0, "$sty + 0.02", "$stz - 0.006"]], tr, { segments: 12 }));
  tubes.push(cyl("HeadTube", tr + 0.008, "$hl + 0.02", { at: [0, "($hty + $hby) / 2", "($htz + $hbz) / 2"], rotate: [-18, 0, 0], segments: 14 }));
  tubes.push(cyl("Shell", 0.022, 0.08, { axis: "x", at: BB, segments: 14 }));
  tubes.push(tube("SeatStay_L", [[0.012, "$sty - 0.02", "$stz - 0.01"], RD(0.055)], 0.009, { segments: 8, mirror: "SeatStay_R" }));
  tubes.push(tube("ChainStay_L", [[0.02, "$bby", "$bbz - 0.02"], RD(0.06)], 0.011, { segments: 8, mirror: "ChainStay_R" }));
  tubes.push(box("Dropout_L", [0.008, 0.05, 0.05], { at: RD(0.062), mirror: "Dropout_R" }));
  tubes.push(cyl("RearAxle", 0.006, 0.14, { axis: "x", at: [0, "$R", "-$wb / 2"], segments: 8, material: "steel" }));
  // Seat post and saddle.
  tubes.push(tube("SeatPost", [[0, "$sty - 0.05", "$stz + 0.015"], [0, "$sty + $post", "$stz - $post * 0.3"]], 0.0135, { segments: 10, material: "aluminium" }));
  const saddle = st === "road"
    ? [loft("Saddle", [
      { z: -0.14, superellipse: { width: 0.13, height: 0.04, n: 2.5, count: 16 } },
      { z: -0.06, superellipse: { width: 0.14, height: 0.045, n: 2.5, count: 16 } },
      { z: 0.06, superellipse: { width: 0.05, height: 0.035, n: 2.5, count: 16 } },
      { z: 0.13, superellipse: { width: 0.035, height: 0.025, n: 2.5, count: 16 } },
    ], { material: "saddle" })]
    : [loft("Saddle", [
      { z: -0.12, superellipse: { width: st === "dutch" ? 0.24 : 0.19, height: 0.06, n: 2.5, count: 16 } },
      { z: -0.05, superellipse: { width: st === "dutch" ? 0.25 : 0.2, height: 0.065, n: 2.5, count: 16 } },
      { z: 0.07, superellipse: { width: 0.07, height: 0.05, n: 2.5, count: 16 } },
      { z: 0.14, superellipse: { width: 0.045, height: 0.035, n: 2.5, count: 16 } },
    ], { material: "saddle" })];
  if (st === "dutch") saddle.push(cyl("Spring_L", 0.016, 0.06, { at: [0.06, -0.05, -0.08], segments: 10, material: "chrome", mirror: "Spring_R" }));
  tubes.push(group("Seat", saddle, { at: [0, "$sty + $post + 0.02", "$stz - $post * 0.3"] }));
  // Brakes, mudguards, rack, guards, lights, stand.
  if (st === "dutch" || st === "city") {
    const arc = (r: string, z: string, a0: number, a1: number, n: number): Vec[] => Array.from({ length: n }, (_, i) => {
      const a = ((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180;
      return [0, `$R + ${r} * ${f(Math.sin(a))}`, `${z} + ${r} * ${f(Math.cos(a))}`] as Vec;
    });
    tubes.push(tube("GuardFront", arc(`($R + 0.035)`, "$wb / 2", -10, 150, 12), 0.026, { segments: 8, material: st === "dutch" ? "paint" : "plastic_black" }));
    tubes.push(tube("GuardRear", arc(`($R + 0.035)`, "-$wb / 2", 20, 200, 12), 0.026, { segments: 8, material: st === "dutch" ? "paint" : "plastic_black" }));
    tubes.push(tube("GuardStay_L", [[0.03, "$R", "-$wb / 2"], [0.04, "$R + 0.2", "-$wb / 2 - 0.3"]], 0.004, { segments: 4, material: "steel", mirror: "GuardStay_R" }));
    // Rear rack on stays to the dropouts.
    tubes.push(group("Rack", [
      tube("Rail_L", [[0.07, "$R + 0.4", "$stz - 0.06"], [0.07, "$R + 0.4", "-$wb / 2 - 0.12"]], 0.007, { segments: 6, mirror: "Rail_R" }),
      box("Slat_{i}", [0.15, 0.008, 0.012], { at: [0, "$R + 0.4", "$stz - 0.08"], repeat: { count: 5, step: [0, 0, "(-$wb / 2 - 0.1 - $stz + 0.08) / 4"] } }),
      tube("Strut_L", [[0.07, "$R + 0.4", "-$wb / 2 - 0.05"], [0.06, "$R", "-$wb / 2"]], 0.006, { segments: 6, mirror: "Strut_R" }),
      tube("Brace_L", [[0.07, "$R + 0.4", "$stz - 0.05"], [0.012, "$sty - 0.04", "$stz"]], 0.005, { segments: 6, mirror: "Brace_R" }),
    ], { material: "steel" }));
    tubes.push(box("Reflector", [0.08, 0.04, 0.02], { at: [0, "$R + 0.36", "-$wb / 2 - 0.13"], material: "lamp_red" }));
  }
  if (st === "dutch") {
    tubes.push(loft("ChainGuard", [
      { z: "$bbz + 0.13", superellipse: { width: 0.05, height: 0.25, n: 2.5, count: 16, cx: -0.065, cy: "$bby + 0.01" } },
      { z: "$bbz - 0.02", superellipse: { width: 0.06, height: 0.26, n: 2.5, count: 16, cx: -0.065, cy: "$bby + 0.01" } },
      { z: "-$wb / 2 + 0.08", superellipse: { width: 0.05, height: 0.13, n: 2.5, count: 16, cx: -0.075, cy: "$R + 0.01" } },
      { z: "-$wb / 2 - 0.05", superellipse: { width: 0.04, height: 0.1, n: 2.5, count: 16, cx: -0.075, cy: "$R + 0.01" } },
    ], { material: "plastic_black" }));
    tubes.push(box("SkirtGuard_L", [0.008, 0.22, 0.32], { at: [0.08, "$R + 0.18", "-$wb / 2 + 0.08"], bevel: 0.004, material: "plastic_black", mirror: "SkirtGuard_R" }));
    tubes.push(box("Lock", [0.03, 0.05, 0.14], { at: [0.06, "$R + 0.27", "-$wb / 2 + 0.22"], bevel: 0.006, material: "chrome" }));
  } else {
    // Chain: two runs between the chainring and the sprocket on the right (-x).
    tubes.push(tube("ChainTop", [[-0.05, "$bby + 0.1", "$bbz"], [-0.055, "$R + 0.04", "-$wb / 2"]], 0.004, { segments: 4, material: "steel" }));
    tubes.push(tube("ChainBottom", [[-0.05, "$bby - 0.1", "$bbz"], [-0.055, "$R - 0.04", "-$wb / 2"]], 0.004, { segments: 4, material: "steel" }));
    tubes.push(cyl("Sprocket", 0.045, 0.03, { axis: "x", at: [-0.05, "$R", "-$wb / 2"], segments: 18, material: "steel" }));
    tubes.push(box("Derailleur", [0.02, 0.08, 0.04], { at: [-0.06, "$R - 0.07", "-$wb / 2 + 0.01"], bevel: 0.006, material: "aluminium" }));
  }
  tubes.push(group("Kickstand", [tube("Leg", [[0, 0, 0], [0.12, "-$bby + 0.035", -0.05]], 0.009, { segments: 6 }), box("Foot", [0.03, 0.01, 0.05], { at: [0.12, "-$bby + 0.035", -0.05] })], { at: [0.03, "$bby", "$bbz - 0.06"], material: "aluminium" }));
  kids.push(group("Frame", tubes, { material: "paint" }));

  // Steering: fork, stem and bars turn about the head tube (pivot at the top of the head tube).
  const fork: SpecNode[] = [];
  const legX = st === "mtb" ? 0.055 : 0.045;
  if (st === "mtb") {
    fork.push(cyl("Crown", 0.03, 0.14, { axis: "x", at: [0, "$hby - 0.03", "$hbz"], segments: 12, material: "fork_black", bevel: 0.01 }));
    fork.push(tube("Stanchion_L", [[legX, "$hby - 0.03", "$hbz"], [legX, "$hby - 0.03 - ($hby - $R) * 0.45", "$hbz + ($wb / 2 - $hbz) * 0.45"]], 0.017, { segments: 10, material: "chrome", mirror: "Stanchion_R" }));
    fork.push(tube("Lower_L", [[legX, "$hby - 0.03 - ($hby - $R) * 0.4", "$hbz + ($wb / 2 - $hbz) * 0.4"], [legX, "$R", "$wb / 2"]], 0.023, { segments: 10, material: "fork_black", mirror: "Lower_R" }));
    fork.push(box("Caliper", [0.03, 0.05, 0.07], { at: [0.06, "$R + 0.07", "$wb / 2 - 0.06"], material: "fork_black" }));
  } else {
    fork.push(box("Crown", [0.11, 0.03, 0.04], { at: [0, "$hby - 0.015", "$hbz"], bevel: 0.008 }));
    fork.push(tube("Blade_L", [[legX, "$hby - 0.02", "$hbz"], [legX, "$R + ($hby - $R) * 0.35", "$wb / 2 - 0.01"], [legX - 0.005, "$R", "$wb / 2"]], 0.012, { segments: 10, mirror: "Blade_R" }));
  }
  fork.push(cyl("Steerer", 0.015, "$hl + 0.08", { at: [0, "($hty + $hby) / 2 + 0.02", "($htz + $hbz) / 2"], rotate: [-18, 0, 0], segments: 10, material: "steel" }));
  fork.push(cyl("FrontAxle", 0.006, 0.12, { axis: "x", at: [0, "$R", "$wb / 2"], segments: 8, material: "steel" }));
  const bar: SpecNode[] = [];
  if (st === "road") {
    bar.push(tube("Stem", [[0, 0, 0], [0, 0.03, 0.11]], 0.016, { segments: 10, material: "aluminium" }));
    bar.push(tube("Bar_L", [[0, 0.03, 0.11], [0.2, 0.03, 0.11], [0.21, 0.03, 0.19], [0.21, -0.06, 0.21], [0.21, -0.12, 0.15], [0.21, -0.12, 0.06]], 0.0125, { segments: 10, material: "bar_tape", mirror: "Bar_R" }));
    bar.push(box("Hood_L", [0.025, 0.05, 0.05], { at: [0.21, 0.04, 0.2], bevel: 0.01, material: "plastic_black", mirror: "Hood_R" }));
  } else if (st === "dutch") {
    bar.push(tube("Stem", [[0, 0, 0], [0, 0.17, 0.02]], 0.016, { segments: 10, material: "chrome" }));
    bar.push(tube("Bar_L", [[0, 0.17, 0.02], [0.12, 0.17, 0.06], [0.24, 0.16, -0.02], [0.29, 0.15, -0.16]], 0.011, { segments: 10, material: "chrome", mirror: "Bar_R" }));
    bar.push(cyl("Grip_L", 0.017, 0.11, { axis: "z", at: [0.29, 0.15, -0.17], segments: 10, material: "grip_brown", mirror: "Grip_R" }));
    bar.push(cyl("Bell", 0.025, 0.02, { at: [0.15, 0.19, 0.05], segments: 14, material: "chrome" }));
  } else {
    const w = st === "mtb" ? 0.36 : 0.3;
    bar.push(tube("Stem", [[0, 0, 0], [0, st === "mtb" ? 0.03 : 0.1, st === "mtb" ? 0.07 : 0.06]], 0.016, { segments: 10, material: "aluminium" }));
    const y = st === "mtb" ? 0.03 : 0.1, z = st === "mtb" ? 0.07 : 0.06;
    bar.push(tube("Bar_L", [[0, y, z], [w * 0.5, y + 0.02, z], [w, y + 0.03, z - 0.04]], 0.011, { segments: 10, material: st === "mtb" ? "fork_black" : "aluminium", mirror: "Bar_R" }));
    bar.push(cyl("Grip_L", 0.017, 0.12, { axis: "x", at: [w - 0.05, y + 0.03, z - 0.035], segments: 10, material: "plastic_black", mirror: "Grip_R" }));
    bar.push(box("Lever_L", [0.1, 0.012, 0.02], { at: [w - 0.13, y + 0.02, z + 0.02], rotate: [0, 10, 0], material: "aluminium", mirror: "Lever_R" }));
  }
  if (st === "dutch" || st === "city") {
    bar.push(group("Headlamp", [cyl("Body", 0.04, 0.08, { axis: "z", segments: 16, material: "chrome", bevel: 0.006 }), cyl("Lens", 0.034, 0.012, { axis: "z", at: [0, 0, 0.04], segments: 16, material: "lamp_lens" })], { at: [0, -0.12, 0.08] }));
  }
  fork.push(group("Handlebar", bar, { at: [0, "$hty + 0.02", "$htz - 0.005"] }));
  kids.push(group("Steering", fork, { material: "paint" }));

  kids.push(bikeWheel("WheelFront", "$wb / 2", st, t));
  kids.push(bikeWheel("WheelRear", "-$wb / 2", st, t));

  // Crank: chainring on the right (-x), arms and pedals opposite each other, spinning about x at the bottom bracket.
  const ring = st === "road" ? 0.1 : st === "mtb" ? 0.075 : 0.09;
  kids.push(group("Crank", [
    cyl("Chainring", ring, 0.006, { axis: "x", at: [-0.05, 0, 0], segments: 28, material: "aluminium" }),
    cyl("Spider", 0.035, 0.02, { axis: "x", at: [-0.05, 0, 0], segments: 14, material: "aluminium" }),
    cyl("Spindle", 0.012, 0.15, { axis: "x", segments: 10, material: "steel" }),
    tube("Arm_L", [[0.07, 0, 0], [0.07, -0.1, 0.137]], 0.012, { segments: 8, material: "aluminium" }),
    tube("Arm_R", [[-0.075, 0, 0], [-0.075, 0.1, -0.137]], 0.012, { segments: 8, material: "aluminium" }),
    box("Tread_L", [0.09, 0.02, 0.06], { at: [0.12, -0.1, 0.137], bevel: 0.005, material: "plastic_black" }),
    box("Tread_R", [0.09, 0.02, 0.06], { at: [-0.125, 0.1, -0.137], bevel: 0.005, material: "plastic_black" }),
  ], { at: BB }));

  return {
    slug: slugify("bicycle", st === "dutch" ? "omafiets" : st, cname),
    title: `${cname.charAt(0).toUpperCase()}${cname.slice(1)} ${S.name}`,
    description: `A ${cname} ${S.name}: ${S.text}. The wheels and crank pivot at their hubs; the fork, stem and bars form one steering group. It faces +z.`,
    tags: [S.name, st, cname, cnl, st === "dutch" ? "omafiets" : st === "road" ? "racefiets" : st === "mtb" ? "mountainbike" : "stadsfiets", "fiets", "bike"],
    params: [
      num("wheelRadius", S.wheel[0], S.wheel[1], S.wheel[2], "Outer tyre radius in metres."),
      num("frameSize", S.frame[0], S.frame[1], S.frame[2], "Seat tube length (frame size) in metres."),
      num("wheelbase", S.wb[0], S.wb[1], S.wb[2], "Distance between the hubs in metres."),
      num("saddleHeight", 0.18, 0.1, 0.26, "Seat post extension above the frame in metres."),
    ],
    materials: {
      paint, carbon: VMATS["carbon"]!, tyre: VMATS["tyre"]!, lamp_lens: VMATS["lamp_lens"]!, lamp_red: VMATS["lamp_red"]!,
      tyre_cream: { color: [0.55, 0.45, 0.3], metallic: 0, roughness: 0.85 },
      saddle: st === "dutch" ? { color: [0.25, 0.12, 0.05], metallic: 0, roughness: 0.55 } : { color: [0.02, 0.02, 0.022], metallic: 0, roughness: 0.6 },
      bar_tape: { color: st === "road" && ci === 1 ? [0.8, 0.8, 0.78] : [0.02, 0.02, 0.022], metallic: 0, roughness: 0.8 },
      grip_brown: { color: [0.25, 0.12, 0.05], metallic: 0, roughness: 0.6 },
      fork_black: { color: [0.02, 0.02, 0.022], metallic: 0.3, roughness: 0.45 },
      ...mats("aluminium", "steel", "chrome", "plastic_black"),
    },
    nodes: [group("Bicycle", kids, {
      vars: {
        R: "$wheelRadius", wb: "$wheelbase", post: "$saddleHeight",
        bbz: "-$wheelbase / 2 + 0.44", bby: "$wheelRadius - 0.07",
        stz: "-$wheelbase / 2 + 0.44 - 0.292 * $frameSize", sty: "$wheelRadius - 0.07 + 0.956 * $frameSize",
        hl: S.head,
        hbz: `$wheelbase / 2 - 0.309 * ${f(S.fork)} - 0.04`, hby: `$wheelRadius + 0.951 * ${f(S.fork)}`,
        htz: `$wheelbase / 2 - 0.309 * ${f(S.fork + S.head)} - 0.04`, hty: `$wheelRadius + 0.951 * ${f(S.fork + S.head)}`,
      },
    })],
  };
}

export const bicycle: Family = {
  id: "bicycle",
  category: "vehicles",
  archetype: "vehicle.wheeled.bicycle",
  tags: ["bicycle", "bike", "fiets", "cycle", "rijwiel", "vehicle", "voertuig"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((st) => [0, 1, 2].map((ci) => bike(st, ci))),
};
