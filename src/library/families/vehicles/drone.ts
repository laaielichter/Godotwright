import { box, cyl, ellipsoid, group, lathe, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { f, VMATS } from "./parts.js";

type Kind = "camera" | "racer" | "hexa" | "octo";

interface DroneDef {
  kind: Kind;
  name: string;
  text: string;
  arms: number;
  blades: number;
  span: [number, number, number];
  prop: [number, number, number];
  leg: [number, number, number];
  colour: string;
  nl: string;
  shell: MaterialDef;
  accent: MaterialDef;
}

/** Matte moulded plastic (the "plastic" texture); with metallic set, a satin anodised trim instead. */
const P = (r: number, g: number, b: number, m = 0, rough = 0.5): MaterialDef => ({ color: [r, g, b], metallic: m, roughness: m > 0 ? 0.35 : rough, texture: m > 0 ? "brushed" : "plastic" });

const DRONES: DroneDef[] = [
  { kind: "camera", name: "camera quadcopter", text: "a compact camera quadcopter with a streamlined shell, four arms with motors, two-blade props, landing feet and a gimbal camera under the nose", arms: 4, blades: 2, span: [0.42, 0.34, 0.5], prop: [0.12, 0.1, 0.14], leg: [0.06, 0.045, 0.09], colour: "light grey", nl: "lichtgrijs", shell: P(0.34, 0.35, 0.36), accent: P(0.55, 0.15, 0.012) },
  { kind: "camera", name: "camera quadcopter", text: "a compact camera quadcopter with a streamlined shell, four arms with motors, two-blade props, landing feet and a gimbal camera under the nose", arms: 4, blades: 2, span: [0.5, 0.42, 0.6], prop: [0.14, 0.12, 0.17], leg: [0.12, 0.09, 0.16], colour: "white", nl: "wit", shell: P(0.6, 0.6, 0.58, 0, 0.42), accent: P(0.62, 0.52, 0.32, 0.8) },
  { kind: "racer", name: "FPV racing quad", text: "an FPV racing quad on a bare carbon X frame with three-blade props, a tilted FPV camera, a strapped battery and an antenna", arms: 4, blades: 3, span: [0.22, 0.18, 0.28], prop: [0.064, 0.05, 0.08], leg: [0.02, 0.012, 0.03], colour: "red", nl: "rood", shell: P(0.36, 0.022, 0.02), accent: P(0.55, 0.15, 0.012) },
  { kind: "racer", name: "FPV racing quad", text: "an FPV racing quad on a bare carbon X frame with three-blade props, a tilted FPV camera, a strapped battery and an antenna", arms: 4, blades: 3, span: [0.25, 0.2, 0.3], prop: [0.076, 0.06, 0.09], leg: [0.02, 0.012, 0.03], colour: "lime", nl: "limoengroen", shell: P(0.14, 0.36, 0.02), accent: P(0.02, 0.07, 0.25) },
  { kind: "hexa", name: "hexacopter", text: "a hexacopter with a round domed body, six tube arms with motors, a landing skid and a payload box", arms: 6, blades: 2, span: [0.9, 0.75, 1.05], prop: [0.2, 0.17, 0.24], leg: [0.2, 0.16, 0.26], colour: "black", nl: "zwart", shell: P(0.035, 0.035, 0.04), accent: P(0.55, 0.15, 0.012) },
  { kind: "hexa", name: "hexacopter", text: "a hexacopter with a round domed body, six tube arms with motors, a landing skid and a payload box", arms: 6, blades: 2, span: [0.8, 0.7, 0.95], prop: [0.18, 0.15, 0.21], leg: [0.18, 0.14, 0.24], colour: "red", nl: "rood", shell: P(0.36, 0.022, 0.02), accent: P(0.6, 0.6, 0.58) },
  { kind: "octo", name: "heavy-lift octocopter", text: "a heavy-lift octocopter with eight carbon tube arms, big props, tall landing gear, twin batteries and a camera gimbal", arms: 8, blades: 2, span: [1.2, 1.0, 1.35], prop: [0.24, 0.2, 0.27], leg: [0.28, 0.22, 0.34], colour: "carbon", nl: "carbon", shell: { color: [0.035, 0.037, 0.042], metallic: 0, roughness: 0.32, texture: "fabric" }, accent: P(0.6, 0.38, 0.02) },
  { kind: "octo", name: "heavy-lift octocopter", text: "a heavy-lift octocopter with eight carbon tube arms, big props, tall landing gear, twin batteries and a camera gimbal", arms: 8, blades: 2, span: [1.1, 0.95, 1.3], prop: [0.22, 0.19, 0.25], leg: [0.26, 0.2, 0.32], colour: "white", nl: "wit", shell: P(0.6, 0.6, 0.58, 0, 0.42), accent: P(0.02, 0.07, 0.25) },
];

/**
 * A propeller blade as a loft from root to tip (local z, turned to +x): a thin cambered airfoil whose chord widens
 * from the root, peaks at a third of the span and narrows to a rounded tip, with the pitch twisting from steep at the
 * root to flat at the tip. Everything scales with $pr.
 */
function bladeSections(wide: boolean): Record<string, unknown>[] {
  // [span fraction, chord fraction, twist degrees]
  const rows: [number, number, number][] = wide
    ? [[0.14, 0.1, 24], [0.22, 0.2, 22], [0.4, 0.26, 18], [0.6, 0.25, 14], [0.8, 0.21, 11], [0.93, 0.15, 9], [0.985, 0.08, 8], [1.0, 0.03, 8]]
    : [[0.14, 0.07, 26], [0.22, 0.12, 24], [0.36, 0.15, 19], [0.55, 0.14, 14], [0.75, 0.115, 10], [0.9, 0.085, 8], [0.975, 0.05, 7], [1.0, 0.02, 7]];
  const N = 10;
  return rows.map(([r, c, tw]) => {
    const t = (tw * Math.PI) / 180;
    const pts: [string, string][] = [];
    for (let k = 0; k < N; k++) {
      // Around the airfoil: x from the leading edge (+0.5c) to the trailing edge (-0.5c); upper surface cambered.
      const a = (k / N) * Math.PI * 2;
      const x = 0.5 * Math.cos(a);
      const th = Math.sin(a) >= 0 ? 0.11 * Math.sin(a) * (0.75 + 0.5 * Math.cos(a) * 0.5) : 0.035 * Math.sin(a);
      const camber = 0.04 * (1 - 4 * x * x);
      const lx = x * c, ly = (th + camber) * c;
      const rx = lx * Math.cos(t) - ly * Math.sin(t), ry = lx * Math.sin(t) + ly * Math.cos(t);
      pts.push([`${f(rx)} * $pr`, `${f(ry)} * $pr`]);
    }
    return { z: r < 0.15 ? "$mr * 0.3" : `${f(r)} * $pr`, points: pts };
  });
}

function buildDrone(d: DroneDef): AssetDraft {
  const n = d.arms;
  const phase = n === 4 ? 45 : n === 6 ? 30 : 22.5;
  const kids: SpecNode[] = [];
  // Body.
  switch (d.kind) {
    case "camera":
      kids.push(loft("Body", [
        { z: "-$bl * 0.5", superellipse: { width: "$bw * 0.7", height: "$bh * 0.6", n: 2.6, count: 24, cy: "$by" } },
        { z: "-$bl * 0.3", superellipse: { width: "$bw", height: "$bh", n: 2.6, count: 24, cy: "$by" } },
        { z: "$bl * 0.25", superellipse: { width: "$bw", height: "$bh", n: 2.6, count: 24, cy: "$by" } },
        { z: "$bl * 0.5", superellipse: { width: "$bw * 0.6", height: "$bh * 0.55", n: 2.6, count: 24, cy: "$by - $bh * 0.1" } },
      ], { material: "shell" }));
      kids.push(box("Battery", ["$bw * 0.75", "$bh * 0.3", "$bl * 0.55"], { at: [0, "$by + $bh * 0.42", "-$bl * 0.12"], bevel: 0.005, material: "plastic_dark" }));
      kids.push(box("Sensor_L", [0.015, 0.012, 0.005], { at: ["$bw * 0.18", "$by", "$bl * 0.5 - 0.004"], material: "dark_glass", mirror: "Sensor_R" }));
      // A three-axis gimbal on rubber dampers: yaw motor, C-bracket, roll motor, camera with a lens barrel.
      kids.push(group("Gimbal", [
        box("Plate", [0.05, 0.005, 0.042], { at: [0, -0.003, 0], bevel: 0.002, material: "plastic_dark" }),
        cyl("Damper_{i}", 0.0045, 0.012, { at: [-0.016, 0.004, -0.013], repeat: { count: 2, step: [0.032, 0, 0] }, segments: 8, material: "accent" }),
        cyl("DamperFront_{i}", 0.0045, 0.012, { at: [-0.016, 0.004, 0.013], repeat: { count: 2, step: [0.032, 0, 0] }, segments: 8, material: "accent" }),
        cyl("YawMotor", 0.011, 0.014, { at: [0, -0.013, 0], segments: 14, material: "plastic_dark" }),
        tube("Bracket", [[-0.03, -0.02, 0], [-0.03, -0.045, 0], [0.03, -0.045, 0], [0.03, -0.02, 0]], 0.0032, { segments: 6, material: "plastic_dark" }),
        cyl("RollMotor_{i}", 0.0085, 0.008, { axis: "x", at: [-0.03, -0.043, 0], repeat: { count: 2, step: [0.06, 0, 0] }, segments: 12, material: "plastic_dark" }),
        box("Camera", [0.036, 0.03, 0.036], { at: [0, -0.043, 0.003], bevel: 0.007, material: "plastic_dark" }),
        cyl("Barrel", 0.0115, 0.013, { axis: "z", at: [0, -0.043, 0.027], segments: 14, material: "plastic_dark" }),
        cyl("Lens", 0.0085, 0.004, { axis: "z", at: [0, -0.043, 0.035], segments: 14, material: "dark_glass" }),
        cyl("Ring", 0.0105, 0.003, { axis: "z", at: [0, -0.043, 0.0335], segments: 14, material: "aluminium" }),
      ], { at: [0, "$by - $bh * 0.4", "$bl * 0.35"] }));
      break;
    case "racer":
      kids.push(box("Body", ["$bw", 0.004, "$bl"], { at: [0, "$by - 0.012", 0], bevel: 0.001, material: "carbon" }));
      kids.push(box("TopPlate", ["$bw * 0.9", 0.003, "$bl * 0.9"], { at: [0, "$by + 0.02", 0], material: "carbon" }));
      kids.push(cyl("Standoff_{i}", 0.003, 0.032, { at: ["$bw * 0.38", "$by + 0.004", 0], repeat: { count: 4, around: "y", phase: 45 }, segments: 6, material: "aluminium" }));
      kids.push(box("Stack", ["$bw * 0.6", 0.016, "$bl * 0.5"], { at: [0, "$by", 0], material: "pcb_green" }));
      kids.push(box("Battery", [0.035, 0.03, 0.075], { at: [0, "$by + 0.037", -0.005], bevel: 0.004, material: "shell" }));
      kids.push(box("Strap", [0.04, 0.032, 0.012], { at: [0, "$by + 0.037", -0.005], material: "accent" }));
      kids.push(group("FpvCamera", [box("Cage", [0.024, 0.024, 0.02], { bevel: 0.003, material: "plastic_dark" }), cyl("Lens", 0.008, 0.012, { axis: "z", at: [0, 0, 0.014], segments: 12, material: "dark_glass" })], { at: [0, "$by + 0.006", "$bl * 0.45"], rotate: [-25, 0, 0] }));
      kids.push(tube("Antenna", [[0, "$by + 0.02", "-$bl * 0.45"], [0, "$by + 0.05", "-$bl * 0.55"]], 0.002, { segments: 4, material: "plastic_dark" }));
      kids.push(ellipsoid("AntennaTip", [0.006, 0.01, 0.006], { at: [0, "$by + 0.055", "-$bl * 0.56"], segments: 8, material: "accent" }));
      break;
    default: {
      const big = d.kind === "octo";
      kids.push(cyl("Body", "$bw / 2", "$bh * 0.45", { at: [0, "$by", 0], segments: 32, material: "carbon", bevel: 0.004 }));
      kids.push(lathe("Dome", [["$bw / 2 * 0.92", 0], ["$bw / 2 * 0.85", "$bh * 0.3"], ["$bw / 2 * 0.55", "$bh * 0.55"], ["$bw / 2 * 0.1", "$bh * 0.62"]], { at: [0, "$by + $bh * 0.2", 0], segments: 28, material: "shell" }));
      kids.push(cyl("Gps", "$bw * 0.12", 0.02, { at: [0, "$by + $bh * 0.82 + 0.01", 0], segments: 18, material: "accent", bevel: 0.004 }));
      kids.push(box("Battery_{i}", ["$bw * 0.25", "$bh * 0.5", "$bw * 0.7"], { at: ["-$bw * 0.15", "$by - $bh * 0.45", 0], repeat: { count: big ? 2 : 1, step: ["$bw * 0.3", 0, 0] }, bevel: 0.01, material: "plastic_dark" }));
      // Landing gear: two skids on struts.
      kids.push(group("Gear_L", [
        tube("Strut", [["$bw * 0.3", "$by - $bh * 0.2", "$bw * 0.25"], ["$bw * 0.55", 0.015, "$bw * 0.3"]], 0.008, { segments: 8 }),
        tube("StrutAft", [["$bw * 0.3", "$by - $bh * 0.2", "-$bw * 0.25"], ["$bw * 0.55", 0.015, "-$bw * 0.3"]], 0.008, { segments: 8 }),
        tube("Skid", [["$bw * 0.55", 0.012, "-$bw * 0.55"], ["$bw * 0.55", 0.012, "$bw * 0.55"]], 0.012, { segments: 8 }),
      ], { material: "carbon", mirror: "Gear_R" }));
      if (big) kids.push(group("Gimbal", [
        box("Plate", [0.12, 0.008, 0.1], { at: [0, -0.004, 0], bevel: 0.003, material: "plastic_dark" }),
        cyl("Damper_{i}", 0.011, 0.02, { at: [-0.045, -0.014, -0.035], repeat: { count: 2, step: [0.09, 0, 0] }, segments: 10, material: "accent" }),
        cyl("DamperFront_{i}", 0.011, 0.02, { at: [-0.045, -0.014, 0.035], repeat: { count: 2, step: [0.09, 0, 0] }, segments: 10, material: "accent" }),
        cyl("YawMotor", 0.03, 0.03, { at: [0, -0.025, 0], segments: 18, material: "plastic_dark" }),
        tube("Bracket", [[-0.085, -0.035, 0], [-0.085, -0.13, 0], [0.085, -0.13, 0], [0.085, -0.035, 0]], 0.008, { segments: 8, material: "plastic_dark" }),
        cyl("RollMotor_{i}", 0.02, 0.016, { axis: "x", at: [-0.085, -0.1, 0], repeat: { count: 2, step: [0.17, 0, 0] }, segments: 14, material: "plastic_dark" }),
        box("Camera", [0.11, 0.09, 0.12], { at: [0, -0.1, 0.01], bevel: 0.014, material: "plastic_dark" }),
        cyl("Barrel", 0.036, 0.05, { axis: "z", at: [0, -0.1, 0.095], segments: 20, material: "plastic_dark" }),
        cyl("Ring", 0.039, 0.008, { axis: "z", at: [0, -0.1, 0.122], segments: 20, material: "aluminium" }),
        cyl("Lens", 0.03, 0.01, { axis: "z", at: [0, -0.1, 0.13], segments: 20, material: "dark_glass" }),
        box("Led", [0.012, 0.006, 0.004], { at: [0.035, -0.065, 0.071], material: "accent" }),
      ], { at: [0, "$by - $bh * 0.2", "$bw * 0.25"] }));
      else kids.push(box("Payload", ["$bw * 0.5", "$bh * 0.6", "$bw * 0.5"], { at: [0, "$by - $bh * 0.75", 0], bevel: 0.01, material: "accent" }));
      break;
    }
  }

  // Arms, motors and propellers on a ring.
  const tubeArm = d.kind === "hexa" || d.kind === "octo";
  kids.push(tubeArm
    ? cyl("Arm_{i}", "$at", "$R - $bw * 0.3", { axis: "x", at: ["($R + $bw * 0.3) / 2", "$by", 0], repeat: { count: n, around: "y", phase }, segments: 12, material: "carbon" })
    : box("Arm_{i}", ["$R - $bw * 0.25", d.kind === "racer" ? 0.005 : "$bh * 0.3", d.kind === "racer" ? "$R * 0.18" : "$R * 0.12"], { at: ["($R + $bw * 0.25) / 2", d.kind === "racer" ? "$by - 0.012" : "$by", 0], repeat: { count: n, around: "y", phase }, bevel: d.kind === "racer" ? 0.001 : 0.004, material: d.kind === "racer" ? "carbon" : "shell" }));
  kids.push(group("Motor_{i}", [
    cyl("Bell", "$mr", "$mh", { at: [0, "$mh / 2", 0], segments: 18, material: "motor", bevel: 0.002 }),
    cyl("Mount", "$mr * 1.2", "$mh * 0.25", { at: [0, 0, 0], segments: 18, material: "plastic_dark" }),
  ], { at: ["$R", "$by + $ay", 0], repeat: { count: n, around: "y", phase } }));
  if (d.kind === "camera") kids.push(cyl("Foot_{i}", "$mr * 0.35", "$by + $ay", { at: ["$R", "($by + $ay) / 2", 0], repeat: { count: n, around: "y", phase }, segments: 8, material: "plastic_dark" }));
  if (d.kind === "racer") kids.push(cyl("Pad_{i}", 0.006, 0.012, { at: ["$R * 0.5", "$by - 0.02", 0], repeat: { count: n, around: "y", phase }, segments: 8, material: "rubber" }));
  if (d.kind === "octo") kids.push(cyl("Led_{i}", "$mr * 0.5", 0.01, { at: ["$R", "$by + $ay - 0.008", 0], repeat: { count: n, around: "y", phase }, segments: 10, material: "led" }));
  // Each propeller pivots on its motor shaft (spins about y).
  kids.push(group("Propeller_{i}", [
    cyl("Spinner", "$mr * 0.45", 0.012, { at: [0, 0.006, 0], segments: 12, material: "aluminium" }),
    loft("Blade_{i}", bladeSections(d.kind === "racer"), { rotate: [0, 90, 0], repeat: { count: d.blades, around: "y" }, material: "prop" }),
    cyl("Hub", "$mr * 0.5", 0.008, { at: [0, -0.002, 0], segments: 14, material: "prop" }),
  ], { at: ["$R", "$by + $ay + $mh", 0], repeat: { count: n, around: "y", phase } }));

  const bodyW = d.kind === "camera" ? "$span * 0.3" : d.kind === "racer" ? "$span * 0.28" : "$span * 0.24";
  return {
    slug: slugify("drone", d.kind === "camera" ? "camera-quad" : d.kind === "racer" ? "fpv-racer" : d.kind === "hexa" ? "hexacopter" : "octocopter", d.colour),
    title: `${d.colour.charAt(0).toUpperCase()}${d.colour.slice(1)} ${d.name}`,
    description: `A ${d.colour} ${d.name}: ${d.text}. Each propeller is its own node pivoting at its hub; the front (camera) faces +z.`,
    tags: [d.name, d.kind, d.colour, d.nl, `${n} rotors`, d.kind === "racer" ? "fpv" : d.kind === "camera" ? "camera drone" : "multicopter", "drone", "drones"],
    params: [
      num("span", d.span[0], d.span[1], d.span[2], "Motor-to-motor diagonal in metres."),
      num("propRadius", d.prop[0], d.prop[1], d.prop[2], "Propeller radius in metres."),
      num("legHeight", d.leg[0], d.leg[1], d.leg[2], "Ground clearance under the body in metres."),
    ],
    materials: {
      shell: d.shell, accent: d.accent, carbon: VMATS["carbon"]!, dark_glass: VMATS["dark_glass"]!,
      plastic_dark: { color: [0.04, 0.04, 0.045], metallic: 0, roughness: 0.5, texture: "plastic" },
      // Motor bells are anodised aluminium (dark grey, not a black mirror).
      motor: VMATS["alloy_dark"]!,
      prop: d.kind === "racer" ? { color: [0.55, 0.15, 0.012, 0.85], metallic: 0, roughness: 0.3, alpha: "BLEND" } : { color: [0.035, 0.035, 0.04], metallic: 0, roughness: 0.4, texture: "plastic" },
      pcb_green: { color: [0.02, 0.12, 0.045], metallic: 0, roughness: 0.45, texture: "plastic" },
      led: { color: [0.6, 0.02, 0.02], metallic: 0, roughness: 0.2, emissive: [0.8, 0.02, 0.01] },
      aluminium: VMATS["alloy"]!,
      ...mats("rubber"),
    },
    nodes: [group("Drone", kids, {
      vars: {
        R: "$span / 2", pr: "$propRadius", bw: bodyW, bl: d.kind === "camera" ? "$span * 0.5" : "$span * 0.32",
        bh: d.kind === "camera" ? "$span * 0.16" : d.kind === "racer" ? 0.03 : "$span * 0.12",
        by: d.kind === "camera" ? "$legHeight + $span * 0.08" : d.kind === "racer" ? "$legHeight + 0.014" : "$legHeight + $span * 0.06",
        ay: d.kind === "racer" ? -0.008 : d.kind === "camera" ? "$span * 0.02" : "$span * 0.025",
        mr: "$span * 0.045", mh: "$span * 0.05", at: "$span * 0.018",
      },
    })],
  };
}

export const drone: Family = {
  id: "drone",
  category: "vehicles",
  archetype: "aircraft.rotorcraft.drone",
  tags: ["drone", "quadcopter", "multicopter", "uav", "drones", "multirotor"],
  assets: () => DRONES.map(buildDrone),
};
