import { box, cyl, ellipsoid, group, lathe, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { VMATS } from "./parts.js";

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

const P = (r: number, g: number, b: number, m = 0.1, rough = 0.35): MaterialDef => ({ color: [r, g, b], metallic: m, roughness: rough });

const DRONES: DroneDef[] = [
  { kind: "camera", name: "camera quadcopter", text: "a compact camera quadcopter with a streamlined shell, four arms with motors, two-blade props, landing feet and a gimbal camera under the nose", arms: 4, blades: 2, span: [0.42, 0.34, 0.5], prop: [0.12, 0.1, 0.14], leg: [0.06, 0.045, 0.09], colour: "light grey", nl: "lichtgrijs", shell: P(0.55, 0.56, 0.58), accent: P(0.8, 0.45, 0.02) },
  { kind: "camera", name: "camera quadcopter", text: "a compact camera quadcopter with a streamlined shell, four arms with motors, two-blade props, landing feet and a gimbal camera under the nose", arms: 4, blades: 2, span: [0.5, 0.42, 0.6], prop: [0.14, 0.12, 0.17], leg: [0.12, 0.09, 0.16], colour: "white", nl: "wit", shell: P(0.82, 0.82, 0.8, 0, 0.3), accent: P(0.5, 0.45, 0.1, 0.8) },
  { kind: "racer", name: "FPV racing quad", text: "an FPV racing quad on a bare carbon X frame with three-blade props, a tilted FPV camera, a strapped battery and an antenna", arms: 4, blades: 3, span: [0.22, 0.18, 0.28], prop: [0.064, 0.05, 0.08], leg: [0.02, 0.012, 0.03], colour: "red", nl: "rood", shell: P(0.55, 0.02, 0.02), accent: P(0.85, 0.3, 0.02) },
  { kind: "racer", name: "FPV racing quad", text: "an FPV racing quad on a bare carbon X frame with three-blade props, a tilted FPV camera, a strapped battery and an antenna", arms: 4, blades: 3, span: [0.25, 0.2, 0.3], prop: [0.076, 0.06, 0.09], leg: [0.02, 0.012, 0.03], colour: "lime", nl: "limoengroen", shell: P(0.3, 0.6, 0.02), accent: P(0.02, 0.1, 0.5) },
  { kind: "hexa", name: "hexacopter", text: "a hexacopter with a round domed body, six tube arms with motors, a landing skid and a payload box", arms: 6, blades: 2, span: [0.9, 0.75, 1.05], prop: [0.2, 0.17, 0.24], leg: [0.2, 0.16, 0.26], colour: "black", nl: "zwart", shell: P(0.03, 0.03, 0.035, 0.3), accent: P(0.85, 0.3, 0.02) },
  { kind: "hexa", name: "hexacopter", text: "a hexacopter with a round domed body, six tube arms with motors, a landing skid and a payload box", arms: 6, blades: 2, span: [0.8, 0.7, 0.95], prop: [0.18, 0.15, 0.21], leg: [0.18, 0.14, 0.24], colour: "red", nl: "rood", shell: P(0.55, 0.02, 0.02), accent: P(0.8, 0.8, 0.78) },
  { kind: "octo", name: "heavy-lift octocopter", text: "a heavy-lift octocopter with eight carbon tube arms, big props, tall landing gear, twin batteries and a camera gimbal", arms: 8, blades: 2, span: [1.2, 1.0, 1.35], prop: [0.24, 0.2, 0.27], leg: [0.28, 0.22, 0.34], colour: "carbon", nl: "carbon", shell: P(0.04, 0.04, 0.045, 0.5, 0.3), accent: P(0.8, 0.5, 0.02) },
  { kind: "octo", name: "heavy-lift octocopter", text: "a heavy-lift octocopter with eight carbon tube arms, big props, tall landing gear, twin batteries and a camera gimbal", arms: 8, blades: 2, span: [1.1, 0.95, 1.3], prop: [0.22, 0.19, 0.25], leg: [0.26, 0.2, 0.32], colour: "white", nl: "wit", shell: P(0.82, 0.82, 0.8, 0, 0.3), accent: P(0.02, 0.1, 0.45) },
];

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
      kids.push(group("Gimbal", [
        box("Yoke", [0.04, 0.03, 0.02], { at: [0, -0.012, 0], bevel: 0.004, material: "plastic_dark" }),
        ellipsoid("Camera", [0.022, 0.02, 0.022], { at: [0, -0.035, 0.005], segments: 14, material: "plastic_dark" }),
        cyl("Lens", 0.01, 0.01, { axis: "z", at: [0, -0.035, 0.026], segments: 12, material: "dark_glass" }),
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
        box("Mount", [0.08, 0.04, 0.08], { at: [0, -0.02, 0], bevel: 0.006, material: "plastic_dark" }),
        box("Camera", [0.1, 0.08, 0.12], { at: [0, -0.09, 0.02], bevel: 0.012, material: "plastic_dark" }),
        cyl("Lens", 0.03, 0.05, { axis: "z", at: [0, -0.09, 0.1], segments: 16, material: "dark_glass" }),
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
    box("Blade_{i}", ["$pr", "max(0.002, $pr * 0.025)", "$pr * 0.16"], { at: ["$pr / 2", 0, 0], rotate: [10, 0, 0], repeat: { count: d.blades, around: "y" }, bevel: 0.001, material: "prop" }),
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
      plastic_dark: { color: [0.04, 0.04, 0.045], metallic: 0, roughness: 0.5 },
      motor: { color: [0.08, 0.08, 0.09], metallic: 0.8, roughness: 0.35 },
      prop: d.kind === "racer" ? { color: [0.85, 0.3, 0.02, 0.85], metallic: 0, roughness: 0.3, alpha: "BLEND" } : { color: [0.05, 0.05, 0.055], metallic: 0, roughness: 0.4 },
      pcb_green: { color: [0.02, 0.2, 0.06], metallic: 0.2, roughness: 0.5 },
      led: { color: [0.6, 0.02, 0.02], metallic: 0, roughness: 0.2, emissive: [0.8, 0.02, 0.01] },
      ...mats("aluminium", "rubber"),
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
