import { box, cyl, ellipsoid, group, loft, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { carPaint, f, VMATS, wheel } from "./parts.js";

type Kind = "city" | "coach" | "school" | "midi" | "decker";

interface BusDef {
  kind: Kind;
  name: string;
  length: [number, number, number];
  height: [number, number, number];
  wheel: number;
  paint: MaterialDef;
  stripe: MaterialDef;
  colour: string;
  nl: string;
  /** Doors on the right (-x) side: z of each door's front edge as a fraction of the half length, and its width. */
  doors: [number, number][];
  /** Axles: z as a fraction of the half length, twin wheels or not. */
  axles: [number, boolean][];
}

const P = (r: number, g: number, b: number): MaterialDef => carPaint(r, g, b, 0.3, 0.3);

const BUSES: BusDef[] = [
  { kind: "city", name: "city bus", length: [12, 10.5, 13.5], height: [3.05, 2.95, 3.3], wheel: 0.5, paint: P(0.8, 0.8, 0.78), stripe: P(0.02, 0.2, 0.55), colour: "white and blue", nl: "wit blauw", doors: [[0.86, 1.2], [0.12, 1.25], [-0.6, 1.2]], axles: [[0.58, false], [-0.48, true]] },
  { kind: "city", name: "city bus", length: [10.8, 10.0, 12.0], height: [3.05, 2.95, 3.3], wheel: 0.5, paint: P(0.8, 0.55, 0.02), stripe: P(0.02, 0.02, 0.022), colour: "yellow", nl: "geel", doors: [[0.85, 1.2], [0.05, 1.25]], axles: [[0.55, false], [-0.5, true]] },
  { kind: "coach", name: "coach", length: [12.8, 12.0, 13.8], height: [3.6, 3.4, 3.8], wheel: 0.52, paint: P(0.8, 0.8, 0.78), stripe: P(0.5, 0.02, 0.02), colour: "white and red", nl: "wit rood", doors: [[0.88, 1.0], [-0.02, 0.9]], axles: [[0.65, false], [-0.44, true], [-0.66, false]] },
  { kind: "coach", name: "coach", length: [12.2, 11.5, 13.2], height: [3.55, 3.4, 3.8], wheel: 0.52, paint: P(0.02, 0.03, 0.08), stripe: P(0.6, 0.62, 0.64), colour: "navy", nl: "donkerblauw", doors: [[0.88, 1.0]], axles: [[0.64, false], [-0.48, true]] },
  { kind: "school", name: "school bus", length: [11.0, 10.0, 12.0], height: [3.2, 3.05, 3.3], wheel: 0.5, paint: P(0.85, 0.55, 0.01), stripe: P(0.02, 0.02, 0.022), colour: "yellow", nl: "geel", doors: [[0.66, 0.85]], axles: [[0.8, false], [-0.5, true]] },
  { kind: "school", name: "school bus", length: [9.0, 8.5, 10.0], height: [3.15, 3.05, 3.3], wheel: 0.48, paint: P(0.85, 0.5, 0.01), stripe: P(0.02, 0.02, 0.022), colour: "orange-yellow", nl: "oranjegeel", doors: [[0.6, 0.85]], axles: [[0.76, false], [-0.48, false]] },
  { kind: "midi", name: "midibus", length: [8.6, 8.0, 9.5], height: [2.95, 2.9, 3.1], wheel: 0.42, paint: P(0.03, 0.25, 0.1), stripe: P(0.8, 0.8, 0.78), colour: "green", nl: "groen", doors: [[0.86, 1.0], [-0.1, 1.0]], axles: [[0.56, false], [-0.5, false]] },
  { kind: "decker", name: "double-decker bus", length: [10.8, 10.0, 11.5], height: [4.1, 3.95, 4.2], wheel: 0.5, paint: P(0.5, 0.02, 0.02), stripe: P(0.75, 0.65, 0.45), colour: "red", nl: "rood", doors: [[0.86, 1.1], [0.0, 1.2]], axles: [[0.58, false], [-0.5, true]] },
];

const EDGE: [number, number][] = [[0, 0.06], [0.015, 0.034], [0.045, 0.012], [0.09, 0.002], [0.15, 0]];

function buildBus(b: BusDef, idx: number): AssetDraft {
  const school = b.kind === "school";
  const N = 10;
  // The side silhouette: front bottom, up the nose, over the roof, down the back, then the arches back to front.
  const upper: [string, string][] = school
    ? [["$L2 - 0.06", "$ys + 0.05"], ["$L2", "0.6"], ["$L2", "1.2"], ["$L2 - 0.12", "1.32"], ["$L2 - 1.3", "1.48"], ["$L2 - 1.45", "1.6"], ["$L2 - 1.6", "$H - 0.2"], ["$L2 - 1.8", "$H"], ["-$L2 + 0.2", "$H"], ["-$L2 + 0.02", "$H - 0.2"], ["-$L2", "0.6"], ["-$L2 + 0.06", "$ys + 0.05"]]
    : b.kind === "coach"
      ? [["$L2 - 0.06", "$ys + 0.05"], ["$L2", "0.6"], ["$L2 + 0.02", "1.3"], ["$L2 - 0.05", "$H - 0.6"], ["$L2 - 0.3", "$H - 0.08"], ["$L2 - 0.55", "$H"], ["-$L2 + 0.3", "$H"], ["-$L2 + 0.05", "$H - 0.25"], ["-$L2", "0.6"], ["-$L2 + 0.06", "$ys + 0.05"]]
      : [["$L2 - 0.06", "$ys + 0.05"], ["$L2", "0.55"], ["$L2", "$H - 0.45"], ["$L2 - 0.1", "$H - 0.08"], ["$L2 - 0.25", "$H"], ["-$L2 + 0.2", "$H"], ["-$L2 + 0.03", "$H - 0.15"], ["-$L2", "0.55"], ["-$L2 + 0.06", "$ys + 0.05"]];
  const arches: string[][] = [...b.axles].sort((p, q) => p[0] - q[0]).map(([z]) => {
    const out: string[] = [];
    for (let k = 0; k <= N; k++) out.push(`${f(z)} * $L2`, `pi + $t0 - ${f(k / N)} * (pi + 2 * $t0)`);
    return out;
  });
  const section = (z: string, d: number) => {
    const pts: [Num, Num][] = upper.map(([pz, py]) => [`(${pz}) * (1 - ${f(1.5 * d)} / $L2)`, `${py} - ${f(d)} * (${py} - $ys) / ($H - $ys)`]);
    for (const a of arches) {
      for (let k = 0; k < a.length; k += 2) pts.push([`${a[k]} + $Ra * cos(${a[k + 1]})`, `$wr + $Ra * sin(${a[k + 1]})`]);
    }
    return { z, points: pts };
  };
  const kids: SpecNode[] = [];
  kids.push(loft("Body", [...EDGE.map(([e, d]) => section(`-$W2 + ${f(e)}`, d)), ...[...EDGE].reverse().map(([e, d]) => section(`$W2 - ${f(e)}`, d))], { material: "body_paint", rotate: [0, -90, 0] }));

  // Glazing: window bands on both sides, windscreen and rear window, with pillars over them.
  const front = school ? "$L2 - 1.75" : b.kind === "coach" ? "$L2 - 0.7" : "$L2 - 0.4";
  const bands: [string, string][] = b.kind === "decker" ? [["1.05", "1.95"], ["2.45", "$H - 0.25"]] : b.kind === "coach" ? [["1.75", "$H - 0.2"]] : school ? [["1.55", "$H - 0.3"]] : [["1.05", "$H - 0.25"]];
  const glass: SpecNode[] = [];
  bands.forEach(([y0, y1], i) => {
    const zb0 = "-$L2 + 0.45";
    const len = `(${front} - (${zb0}))`;
    const n = Math.round(b.length[0] / 1.4);
    glass.push(box(`Side_L${i + 1}`, [0.03, `${y1} - ${y0}`, len], { at: ["$W2 - 0.005", `(${y0} + ${y1}) / 2`, `(${front} + ${zb0}) / 2`], material: "dark_glass", mirror: `Side_R${i + 1}` }));
    glass.push(box(`Pillar_L${i + 1}_{i}`, [0.045, `${y1} - ${y0} + 0.02`, 0.1], { at: ["$W2 + 0.005", `(${y0} + ${y1}) / 2`, `${zb0} + ${len} / ${n}`], repeat: { count: n - 1, step: [0, 0, `${len} / ${n}`] }, material: "body_paint" }));
    glass.push(box(`Pillar_R${i + 1}_{i}`, [0.045, `${y1} - ${y0} + 0.02`, 0.1], { at: ["-$W2 - 0.005", `(${y0} + ${y1}) / 2`, `${zb0} + ${len} / ${n}`], repeat: { count: n - 1, step: [0, 0, `${len} / ${n}`] }, material: "body_paint" }));
  });
  const ws = school
    ? box("Windscreen", ["$W2 * 2 - 0.2", "$H - 1.8", 0.05], { at: [0, "($H + 1.6) / 2 - 0.05", "$L2 - 1.66"], rotate: [-12, 0, 0], material: "dark_glass" })
    : b.kind === "coach"
      ? box("Windscreen", ["$W2 * 2 - 0.16", "$H - 1.5", 0.05], { at: [0, "($H + 1.3) / 2 - 0.1", "$L2 - 0.16"], rotate: [-14, 0, 0], material: "dark_glass" })
      : box("Windscreen", ["$W2 * 2 - 0.16", "$H - 1.3", 0.05], { at: [0, "($H + 0.9) / 2 - 0.12", "$L2 + 0.0"], material: "dark_glass" });
  glass.push(ws);
  glass.push(box("RearWindow", ["$W2 * 2 - 0.3", 0.8, 0.04], { at: [0, "$H - 0.75", "-$L2 + 0.01"], material: "dark_glass" }));
  kids.push(group("Glass", glass));

  // Destination display, livery stripe, rub rails.
  kids.push(box("Destination", ["$W2 * 1.4", 0.24, 0.05], { at: [0, school ? "$H - 0.18" : "$H - 0.22", school ? "$L2 - 1.76" : b.kind === "coach" ? "$L2 - 0.5" : "$L2 - 0.08"], rotate: [b.kind === "coach" ? -40 : school ? -12 : -18, 0, 0], material: "lamp_amber" }));
  kids.push(box("Stripe_L", [0.02, 0.18, "$length - 1.2"], { at: ["$W2 - 0.002", b.kind === "coach" ? "1.45" : school ? "1.2" : "0.85", 0], material: "stripe_paint", mirror: "Stripe_R" }));
  if (b.kind === "decker") kids.push(box("Livery_L", [0.02, 0.3, "$length - 0.4"], { at: ["$W2 - 0.002", "2.2", 0], material: "stripe_paint", mirror: "Livery_R" }));
  if (school) {
    kids.push(box("RubRail_L{i}", [0.03, 0.05, "$length - 2.4"], { at: ["$W2 - 0.002", "0.75", "-1.0"], repeat: { count: 3, step: [0, 0.32, 0] }, material: "stripe_paint", mirror: "RubRail_R" }));
    kids.push(group("Grille", [box("Panel", ["$W2 * 1.0", 0.6, 0.04], { bevel: 0.02, material: "chrome" }), box("Bar_{i}", ["$W2 * 0.95", 0.025, 0.03], { at: [0, -0.24, 0.02], repeat: { count: 7, step: [0, 0.08, 0] }, material: "trim_black" })], { at: [0, "0.95", "$L2 + 0.005"] }));
    kids.push(group("StopArm", [box("Arm", [0.12, 0.06, 0.06], { at: [0.06, 0, 0], material: "trim_black" }), cyl("Sign", 0.22, 0.03, { axis: "x", at: [0.13, 0, 0], segments: 8, material: "stop_red" })], { at: ["$W2", "1.75", "$L2 - 2.3"] }));
  }
  // Lamps, bumpers, mirrors.
  const ly = school ? "1.05" : "0.75";
  kids.push(box("Headlamp_L", [0.36, 0.14, 0.06], { at: ["$W2 - 0.3", ly, "$L2 + 0.01"], bevel: 0.02, material: "lamp_lens", mirror: "Headlamp_R" }));
  kids.push(box("Indicator_L", [0.12, 0.08, 0.06], { at: ["$W2 - 0.08", ly, "$L2 + 0.005"], bevel: 0.015, material: "lamp_amber", mirror: "Indicator_R" }));
  kids.push(box("TailLamp_L", [0.18, 0.7, 0.06], { at: ["$W2 - 0.14", "1.0", "-$L2 - 0.01"], bevel: 0.02, material: "lamp_red", mirror: "TailLamp_R" }));
  kids.push(box("BumperFront", ["$W2 * 2 - 0.04", 0.3, 0.16], { at: [0, "$ys + 0.12", "$L2 - 0.02"], bevel: 0.04, material: "trim_black" }));
  kids.push(box("BumperRear", ["$W2 * 2 - 0.04", 0.3, 0.16], { at: [0, "$ys + 0.12", "-$L2 + 0.02"], bevel: 0.04, material: "trim_black" }));
  kids.push(box("PlateFront", [0.52, 0.11, 0.012], { at: [0, "$ys + 0.12", "$L2 + 0.065"], material: "plate_yellow" }));
  kids.push(box("PlateRear", [0.52, 0.11, 0.012], { at: [0, "$ys + 0.45", "-$L2 - 0.004"], material: "plate_yellow" }));
  const mz = school ? "$L2 - 1.5" : "$L2 - 0.15";
  const my = school ? "1.6" : "$H - 0.6";
  kids.push(group("MirrorArm_L", [
    tube("Arm", [[0, 0, 0], [0.15, 0.05, 0.2], [0.25, -0.05, 0.35]], 0.02, { material: "trim_black", segments: 8 }),
    box("Head", [0.1, 0.36, 0.18], { at: [0.27, -0.2, 0.37], bevel: 0.03, material: "trim_black" }),
  ], { at: ["$W2 - 0.02", my, mz], mirror: "MirrorArm_R" }));
  kids.push(box("Wiper_L", [0.7, 0.02, 0.03], { at: ["$W2 * 0.45", school ? "1.65" : b.kind === "coach" ? "1.55" : "1.1", school ? "$L2 - 1.58" : "$L2 + 0.03"], rotate: [0, 0, 70], material: "trim_black", mirror: "Wiper_R" }));
  if (b.kind === "city" || b.kind === "coach" || b.kind === "midi") {
    kids.push(box("RoofUnit", ["$W2 * 1.3", 0.28, b.kind === "midi" ? 1.6 : 2.6], { at: [0, "$H + 0.12", "-$L2 * 0.25"], bevel: 0.08, material: "roof_grey" }));
    kids.push(box("Hatch_{i}", [0.7, 0.06, 0.7], { at: [0, "$H + 0.01", "$L2 * 0.45"], repeat: { count: 2, step: [0, 0, "-$L2 * 1.3"] }, bevel: 0.02, material: "roof_grey" }));
  }
  if (b.kind === "coach") {
    kids.push(box("LuggageHatch_L{i}", [0.03, 0.7, 1.6], { at: ["$W2 - 0.004", "0.9", "-$L2 * 0.25"], repeat: { count: 2, step: [0, 0, 1.75] }, bevel: 0.015, material: "body_paint", mirror: "LuggageHatch_R" }));
    kids.push(box("Ladder", [0.6, 0.04, 0.04], { at: [0, "$H - 0.5", "-$L2 - 0.01"], material: "chrome" }));
  }

  // Doors on the right (-x): each hinged at its front edge, two glazed leaves.
  const doorTop = school ? "2.35" : b.kind === "coach" ? "$H - 0.45" : "$H - 0.45";
  b.doors.forEach(([zf, w], i) => {
    const h = `${doorTop} - $ys - 0.02`;
    kids.push(group(`Door_${i + 1}`, [
      box("LeafFront", [0.04, h, w / 2 - 0.01], { at: [0.01, `(${h}) / 2`, `-${f(w / 4)}`], bevel: 0.01, material: "door_frame" }),
      box("LeafRear", [0.04, h, w / 2 - 0.01], { at: [0.01, `(${h}) / 2`, `-${f((3 * w) / 4)}`], bevel: 0.01, material: "door_frame" }),
      box("PaneFront", [0.05, `${h} - 0.3`, w / 2 - 0.14], { at: [0.01, `(${h}) / 2 + 0.08`, `-${f(w / 4)}`], material: "dark_glass" }),
      box("PaneRear", [0.05, `${h} - 0.3`, w / 2 - 0.14], { at: [0.01, `(${h}) / 2 + 0.08`, `-${f((3 * w) / 4)}`], material: "dark_glass" }),
      cyl("Grab", 0.015, `${h} - 0.4`, { at: [-0.01, `(${h}) / 2`, -0.06], segments: 8, material: "chrome" }),
    ], { at: ["-$W2 - 0.012", "$ys + 0.02", `${f(zf)} * $L2`] }));
  });
  if (school) {
    kids.push(group(`Door_${b.doors.length + 1}`, [
      box("Leaf", [0.9, "1.75", 0.04], { at: [0.45, 0.875, -0.01], bevel: 0.01, material: "body_paint" }),
      box("Pane", [0.6, 0.7, 0.05], { at: [0.45, 1.3, -0.01], material: "dark_glass" }),
    ], { at: ["-0.45", "0.65", "-$L2 - 0.01"] }));
  }

  // Wheels.
  const wo = { r: "$wr", w: "0.3", style: "truck" as const, rim: "rim_grey", hub: "trim_black", segments: 24, rimFrac: 0.58 };
  const wheels: SpecNode[] = [];
  b.axles.forEach(([z, twin], i) => {
    if (twin) {
      wheels.push(wheel(`Wheel_${i + 1}LO`, ["$W2 - 0.17", "$wr", `${f(z)} * $L2`], wo, { mirror: `Wheel_${i + 1}RO` }));
      wheels.push(wheel(`Wheel_${i + 1}LI`, ["$W2 - 0.51", "$wr", `${f(z)} * $L2`], { ...wo, style: "disc", rim: "trim_black" }, { mirror: `Wheel_${i + 1}RI` }));
    } else wheels.push(wheel(`Wheel_${i + 1}L`, ["$W2 - 0.2", "$wr", `${f(z)} * $L2`], wo, { mirror: `Wheel_${i + 1}R` }));
    wheels.push(box(`Axle_${i + 1}`, ["$W2 * 2 - 0.7", 0.16, 0.16], { at: [0, "$wr", `${f(z)} * $L2`], material: "trim_black" }));
  });
  kids.push(group("Running", wheels));
  // Interior seats seen through the door glass, under the body floor height.
  kids.push(ellipsoid("Exhaust", [0.06, 0.06, 0.1], { at: ["-$W2 + 0.3", "$ys + 0.02", "-$L2 + 0.05"], segments: 10, material: "trim_black" }));

  const nWheels = b.axles.reduce((n, [, t]) => n + (t ? 4 : 2), 0);
  return {
    slug: slugify("bus", b.kind === "decker" ? "double-decker" : b.kind === "midi" ? "midibus" : b.kind, b.colour, b.kind === "city" || b.kind === "coach" || b.kind === "school" ? `${b.doors.length}-door` : "", idx === 5 ? "short" : ""),
    title: `${b.colour.charAt(0).toUpperCase()}${b.colour.slice(1)} ${b.name}`,
    description: `A ${b.colour} ${b.name}, about ${b.length[0]} m long: a lofted body with real wheel arches, ${bands.length > 1 ? "two decks of" : "a band of"} dark windows, ${b.doors.length + (school ? 1 : 0)} hinged door${b.doors.length + (school ? 1 : 0) > 1 ? "s" : ""} and ${nWheels} wheels on ${b.axles.length} axles, each pivoting at its hub. It faces +z.`,
    tags: [b.name, b.kind, b.colour, b.nl, b.kind === "coach" ? "touringcar" : b.kind === "school" ? "schoolbus" : b.kind === "decker" ? "dubbeldekker" : "stadsbus", "openbaar vervoer"],
    params: [
      num("length", b.length[0], b.length[1], b.length[2], "Overall length in metres."),
      num("width", 2.55, 2.45, 2.55, "Body width in metres."),
      num("height", b.height[0], b.height[1], b.height[2], "Roof height in metres."),
      num("wheelRadius", b.wheel, b.wheel - 0.03, b.wheel + 0.03, "Tyre radius in metres."),
    ],
    materials: {
      body_paint: b.paint, stripe_paint: b.stripe,
      door_frame: { color: [0.06, 0.06, 0.065], metallic: 0.6, roughness: 0.4 },
      roof_grey: { color: [0.55, 0.56, 0.57], metallic: 0.3, roughness: 0.5 },
      rim_grey: { color: [0.55, 0.56, 0.57], metallic: 0.6, roughness: 0.4 },
      stop_red: { color: [0.6, 0.02, 0.02], metallic: 0, roughness: 0.4 },
      ...mats("chrome"),
      dark_glass: VMATS["dark_glass"]!, trim_black: VMATS["trim_black"]!, tyre: VMATS["tyre"]!, lamp_lens: VMATS["lamp_lens"]!, lamp_red: VMATS["lamp_red"]!, lamp_amber: VMATS["lamp_amber"]!, plate_yellow: VMATS["plate_yellow"]!,
    },
    nodes: [group("Bus", kids, {
      vars: { L2: "$length / 2", W2: "$width / 2", H: "$height", wr: "$wheelRadius", Ra: "$wheelRadius + 0.06", ys: "$wheelRadius * 0.6", t0: "asin(($wheelRadius - $wheelRadius * 0.6) / ($wheelRadius + 0.06))" },
    })],
  };
}

export const bus: Family = {
  id: "bus",
  category: "vehicles",
  archetype: "vehicle.wheeled.bus",
  tags: ["bus", "autobus", "coach", "public transport", "openbaar vervoer", "vehicle", "voertuig"],
  assets: () => BUSES.map((b, i) => buildBus(b, i)),
};
