import { box, combos, cyl, group, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import type { MaterialDef } from "../../palette.js";
import { FINISH } from "./finishes.js";
import { laid } from "./timber.js";

/**
 * Ladders: a straight wooden ladder, an aluminium extension ladder with a fly section, an A-frame step ladder and a
 * fixed steel ladder with a safety cage. The rails stand on y = 0 with the climbing side facing +z; the model's left
 * rail (RailLeft) is on +x.
 */
type Style = "single" | "extension" | "step" | "fixed";

interface Finish {
  key: string;
  rail: string;
  rung: string;
  /** Feet, caps and small parts. */
  trim: string;
  text: string;
}

const FINISHES: Record<Style, Finish[]> = {
  single: [
    { key: "pine", rail: "wood_pine", rung: "wood_oak", trim: "galvanised_steel", text: "pine rails with oak rungs" },
    { key: "weathered", rail: "wood_weathered", rung: "wood_weathered", trim: "iron_rusty", text: "weathered grey timber with rusty tie rods" },
  ],
  extension: [
    { key: "aluminium", rail: "satin_alu", rung: "satin_alu", trim: "rubber_black", text: "satin aluminium rails and ribbed rungs" },
    { key: "fibreglass", rail: "ladder_fibre_orange", rung: "satin_alu", trim: "rubber_black", text: "orange fibreglass rails with aluminium rungs" },
  ],
  step: [
    { key: "aluminium", rail: "satin_alu", rung: "satin_alu", trim: "abs_blue", text: "aluminium with blue plastic caps and feet" },
    { key: "wooden", rail: "wood_pine", rung: "wood_pine", trim: "powder_red", text: "pine with a red-painted top and steel spreaders" },
  ],
  fixed: [
    { key: "galvanised", rail: "galvanised_steel", rung: "galvanised_steel", trim: "galvanised_steel", text: "hot-dip galvanised steel" },
    { key: "yellow", rail: "powder_yellow", rung: "galvanised_steel", trim: "galvanised_steel", text: "safety-yellow powder-coated steel" },
  ],
};

const LOCAL: Record<string, MaterialDef> = {
  ladder_fibre_orange: { color: [0.5, 0.13, 0.02], metallic: 0, roughness: 0.45, texture: "plastic" },
  ...FINISH,
};

function materials(f: Finish): Record<string, MaterialDef> {
  const names = [...new Set([f.rail, f.rung, f.trim, "rubber_black", "galvanised_steel", "rope_hemp"])];
  return Object.fromEntries(names.map((n) => [n, LOCAL[n]!]));
}

/** A straight leaning ladder: rectangular rails, round rungs, tie rods with nuts and capped feet. */
function single(f: Finish): SpecNode[] {
  return [
    group("Ladder", [
      box("RailLeft", ["$rt", "$height", "$rd"], { at: ["$x", 0, 0], anchor: "bottom", bevel: 0.006, mirror: "RailRight" }),
      group("Rungs", [
        cyl("Rung_{i}", 0.017, "$width - $rt + 0.01", { axis: "x", at: [0, "0.24 + $i * $spacing", 0], segments: 14, repeat: { count: "floor(($height - 0.36) / $spacing) + 1", step: [0, 0, 0] }, material: f.rung }),
      ]),
      group("TieRods", [
        cyl("TieRod_{i}", 0.005, "$width + $rt + 0.02", { axis: "x", at: [0, "0.24 + $i * $spacing * (floor(($height - 0.36) / $spacing))", -0.022], segments: 8, repeat: { count: 2, step: [0, 0, 0] } }),
        cyl("Nut_{i}", 0.011, 0.012, { axis: "x", at: ["$x + $rt / 2 + 0.006", "0.24 + $i * $spacing * (floor(($height - 0.36) / $spacing))", -0.022], segments: 6, repeat: { count: 2, step: [0, 0, 0] }, mirror: "NutR_{i}" }),
      ], { material: f.trim }),
      box("Foot_L", ["$rt + 0.008", 0.05, "$rd + 0.008"], { at: ["$x", 0, 0], anchor: "bottom", bevel: 0.004, material: f.trim === "iron_rusty" ? "galvanised_steel" : f.trim, mirror: "Foot_R" }),
    ], { material: f.rail, vars: { rt: 0.034, rd: 0.07, x: "$width / 2" } }),
  ];
}

/** An extension ladder: a base section and a fly section in front of it, with guide brackets, rope and rubber feet. */
function extension(f: Finish): SpecNode[] {
  const section = (name: string, rail: string, y: string, len: string, z: number, w: string): SpecNode =>
    group(name, [
      box(`${rail}Left`, ["$rt", len, "$rd"], { at: [`${w} / 2`, 0, 0], anchor: "bottom", bevel: 0.004, mirror: `${rail}Right` }),
      box(`${rail}Lip_L`, [0.006, len, "$rd + 0.012"], { at: [`${w} / 2 + $rt / 2`, 0, 0], anchor: "bottom", bevel: 0.002, mirror: `${rail}Lip_R` }),
      box(`${name === "BaseSection" ? "" : "Fly"}Rung_{i}`, [`${w} - $rt + 0.008`, 0.03, 0.036], { at: [0, `0.25 + $i * $spacing`, 0], bevel: 0.009, material: f.rung, repeat: { count: `floor((${len} - 0.4) / $spacing) + 1`, step: [0, 0, 0] } }),
      box(`Guide_L`, [0.05, 0.07, 0.12], { at: [`${w} / 2 + 0.012`, `${len} - 0.06`, z < 0.01 ? 0.03 : -0.03], bevel: 0.006, material: "galvanised_steel", mirror: "Guide_R" }),
    ], { at: [0, y, z] });
  return [
    group("ExtensionLadder", [
      section("BaseSection", "Rail", "0", "$height * 0.58", 0, "$width"),
      section("FlySection", "FlyRail", "$height * 0.42", "$height * 0.58", 0.075, "($width - 0.06)"),
      box("Shoe_L", ["$rt + 0.03", 0.06, "$rd + 0.05"], { at: ["$width / 2 + 0.006", 0, 0], anchor: "bottom", bevel: 0.012, material: f.trim, mirror: "Shoe_R" }),
      box("PawlLock_L", [0.04, 0.09, 0.05], { at: ["$width / 2 - 0.04", "$height * 0.42 + 0.3", 0.055], bevel: 0.006, material: "galvanised_steel", mirror: "PawlLock_R" }),
      tube("Rope", [[0, "$height * 0.58 - 0.04", 0.035], [0, "$height * 0.45", 0.04], [0, "$height * 0.42 + 0.2", 0.07]], 0.007, { segments: 8, material: "rope_hemp" }),
    ], { material: f.rail, vars: { rt: 0.026, rd: 0.075 } }),
  ];
}

/** An A-frame step ladder: raked front rails with flat treads, rear legs, a top cap, spreaders and a pail shelf. */
function step(f: Finish): SpecNode[] {
  const y = (): string => "($i + 1) * $sp";
  return [
    group("StepLadder", [
      box("RailLeft", ["$rt", "$height / cos($af) + 0.02", "$rd"], { at: ["$width / 2", 0, "$zf"], rotate: ["-deg($af)", 0, 0], anchor: "bottom", bevel: 0.005, mirror: "RailRight" }),
      box("RearLeg_L", ["$rt", "$height / cos($ar) - 0.02", "$rd * 0.8"], { at: ["$width / 2", 0, "-$zr"], rotate: ["deg($ar)", 0, 0], anchor: "bottom", bevel: 0.005, mirror: "RearLeg_R" }),
      laid("x", box("Step_{i}", ["$width - $rt + 0.006", 0.026, 0.1], { at: [0, y(), `$zf - ${y()} * tan($af) - 0.015`], bevel: 0.006, material: f.rung, repeat: { count: "floor(($height - 0.3) / $sp)", step: [0, 0, 0] } })),
      box("TopCap", ["$width + 0.05", 0.06, 0.24], { at: [0, "$height", -0.01], bevel: 0.012, material: f.trim }),
      laid("x", box("RearBrace", ["$width", 0.03, 0.02], { at: [0, "$height * 0.3", "-$zr + $height * 0.3 * tan($ar)"], bevel: 0.004 })),
      laid("x", box("Shelf", ["$width - 0.06", 0.018, 0.2], { at: [0, "$height * 0.62", "-$zr * 0.38 + 0.04"], bevel: 0.004 })),
      tube("Spreader_L", [["$width / 2 + 0.022", "$height * 0.45", "$zf - $height * 0.45 * tan($af)"], ["$width / 2 + 0.03", "$height * 0.43", 0], ["$width / 2 + 0.022", "$height * 0.45", "-$zr + $height * 0.45 * tan($ar)"]], 0.006, { segments: 8, material: "galvanised_steel", mirror: "Spreader_R" }),
      box("Foot_FL", ["$rt + 0.012", 0.035, "$rd + 0.012"], { at: ["$width / 2", 0, "$zf - 0.004"], anchor: "bottom", bevel: 0.008, material: f.trim === "powder_red" ? "rubber_black" : f.trim, mirror: "Foot_FR" }),
      box("Foot_RL", ["$rt + 0.012", 0.035, "$rd * 0.8 + 0.012"], { at: ["$width / 2", 0, "-$zr + 0.004"], anchor: "bottom", bevel: 0.008, material: f.trim === "powder_red" ? "rubber_black" : f.trim, mirror: "Foot_RR" }),
      // Rivets where each tread meets the rails, two per end, and (aluminium) ribbed treads for grip.
      cyl("Rivet_L{i}", 0.007, 0.008, { axis: "x", at: ["$width / 2 + $rt / 2 + 0.001", y(), `$zf - ${y()} * tan($af) - 0.03`], segments: 8, material: "galvanised_steel", repeat: { count: "floor(($height - 0.3) / $sp)", step: [0, 0, 0] }, mirror: "Rivet_R{i}" }),
      cyl("RivetB_L{i}", 0.007, 0.008, { axis: "x", at: ["$width / 2 + $rt / 2 + 0.001", y(), `$zf - ${y()} * tan($af) + 0.012`], segments: 8, material: "galvanised_steel", repeat: { count: "floor(($height - 0.3) / $sp)", step: [0, 0, 0] }, mirror: "RivetB_R{i}" }),
      ...(f.key === "aluminium"
        ? [group("Grip_{i}", [-0.033, -0.011, 0.011, 0.033].map((dz, k) => box(`Ridge_${k + 1}`, ["$width - $rt - 0.03", 0.005, 0.007], { at: [0, 0.0145, dz], bevel: 0.0015 })), {
            at: [0, y(), `$zf - ${y()} * tan($af) - 0.015`], material: f.rung, repeat: { count: "floor(($height - 0.3) / $sp)", step: [0, 0, 0] },
          })]
        : [box("Strip_{i}", ["$width - $rt - 0.05", 0.003, 0.03], { at: [0, `${y()} + 0.0135`, `$zf - ${y()} * tan($af) - 0.005`], material: "rubber_black", repeat: { count: "floor(($height - 0.3) / $sp)", step: [0, 0, 0] } })]),
    ], { material: f.rail, vars: { rt: 0.03, rd: 0.075, zf: "$depth * 0.55", zr: "$depth * 0.45", af: "atan($depth * 0.55 / $height)", ar: "atan($depth * 0.45 / $height)", sp: "($height - 0.06) / (floor(($height - 0.3) / 0.27) + 1)" } }),
  ];
}

/** A fixed steel ladder: flat-bar rails on wall brackets, round rungs and a safety cage of hoops and vertical bars. */
function fixed(f: Finish): SpecNode[] {
  const hoop: [string, string, string][] = [];
  const steps = 10;
  for (let k = 0; k <= steps; k++) {
    const a = `(-$a0 + ${k} * (pi + 2 * $a0) / ${steps})`;
    hoop.push([`$rc * cos(${a})`, "0", `$zc + $rc * sin(${a})`]);
  }
  const bars = [0.15, 0.32, 0.5, 0.68, 0.85].map((t, k) => {
    const a = `(-$a0 + ${t} * (pi + 2 * $a0))`;
    return box(`CageBar_${k + 1}`, [0.05, "$height - 2.2 + 0.03", 0.008], { at: [`$rc * cos(${a})`, 2.185, `$zc + $rc * sin(${a})`], rotate: [0, `90 - deg(${a})`, 0], anchor: "bottom", bevel: 0.002 });
  });
  return [
    group("FixedLadder", [
      box("RailLeft", ["$rt", "$height", 0.065], { at: ["$width / 2", 0, 0], anchor: "bottom", bevel: 0.003, material: f.rail, mirror: "RailRight" }),
      cyl("Rung_{i}", 0.0125, "$width - $rt + 0.006", { axis: "x", at: [0, "0.3 + $i * $spacing", 0], segments: 12, material: f.rung, repeat: { count: "floor(($height - 0.4) / $spacing) + 1", step: [0, 0, 0] } }),
      // Serrated grips on each rung: raised rings where the feet go.
      group("Knurl_{i}", [-0.12, -0.06, 0, 0.06, 0.12].map((dx, k) => cyl(`Ring_${k + 1}`, 0.0145, 0.008, { axis: "x", at: [`(${dx}) * $width / 0.4`, 0, 0], segments: 12 })), {
        at: [0, "0.3 + $i * $spacing", 0], material: f.rung, repeat: { count: "floor(($height - 0.4) / $spacing) + 1", step: [0, 0, 0] },
      }),
      group("Brackets", [
        box("Bracket_L{i}", [0.012, 0.06, 0.2], { at: ["$width / 2 - 0.004", "0.9 + $i * ($height - 1.2) / max(floor($height / 1.5), 1)", -0.12], bevel: 0.002, repeat: { count: "floor($height / 1.5) + 1", step: [0, 0, 0] }, mirror: "Bracket_R{i}" }),
        box("WallPlate_L{i}", [0.1, 0.14, 0.012], { at: ["$width / 2 - 0.004", "0.9 + $i * ($height - 1.2) / max(floor($height / 1.5), 1)", -0.22], bevel: 0.002, repeat: { count: "floor($height / 1.5) + 1", step: [0, 0, 0] }, mirror: "WallPlate_R{i}" }),
        box("BasePlate_L", [0.12, 0.012, 0.14], { at: ["$width / 2", 0, 0], anchor: "bottom", bevel: 0.002, mirror: "BasePlate_R" }),
        cyl("AnchorBolt_L{i}", 0.011, 0.014, { at: ["$width / 2 + 0.035", 0.012, -0.045], segments: 6, repeat: { count: 2, step: [0, 0, 0.09] }, mirror: "AnchorBolt_R{i}" }),
        cyl("PlateBolt_L{i}", 0.01, 0.012, { axis: "z", at: ["$width / 2 - 0.004", "0.9 + $i * ($height - 1.2) / max(floor($height / 1.5), 1) + 0.04", -0.21], segments: 6, repeat: { count: "floor($height / 1.5) + 1", step: [0, 0, 0] }, mirror: "PlateBolt_R{i}" }),
        cyl("PlateBoltLow_L{i}", 0.01, 0.012, { axis: "z", at: ["$width / 2 - 0.004", "0.9 + $i * ($height - 1.2) / max(floor($height / 1.5), 1) - 0.04", -0.21], segments: 6, repeat: { count: "floor($height / 1.5) + 1", step: [0, 0, 0] }, mirror: "PlateBoltLow_R{i}" }),
      ], { material: f.trim }),
      group("Cage", [
        tube("Hoop_{i}", hoop, 0.012, { at: [0, "2.2 + $i * ($height - 2.24) / max(floor(($height - 2.2) / 0.75), 1)", 0], segments: 8, repeat: { count: "floor(($height - 2.2) / 0.75) + 1", step: [0, 0, 0] } }),
        ...bars,
      ], { material: f.rail, vars: { rc: 0.36, zc: "sqrt(0.36 * 0.36 - $width * $width / 4)", a0: "asin(sqrt(0.36 * 0.36 - $width * $width / 4) / 0.36)" } }),
    ], { vars: { rt: 0.014 } }),
  ];
}

const STYLES: Record<Style, { title: string; text: string; build: (f: Finish) => SpecNode[]; height: [number, number, number] }> = {
  single: { title: "single ladder", text: "A straight leaning ladder with rectangular rails, round rungs about 0.28 m apart, steel tie rods and capped feet", build: single, height: [3, 1.5, 6] },
  extension: { title: "extension ladder", text: "A two-section extension ladder: a fly section running in front of the base section on guide brackets, with pawl locks, a pull rope and rubber shoes", build: extension, height: [4.5, 2.5, 6] },
  step: { title: "step ladder", text: "A free-standing A-frame step ladder with raked front rails and flat treads, rear legs with a brace, steel spreaders, a pail shelf and a top cap", build: step, height: [1.8, 1.5, 3] },
  fixed: { title: "fixed cage ladder", text: "A fixed access ladder of flat-bar rails and round rungs on wall brackets (towards -z), with a safety cage of hoops and vertical bars from 2.2 m up", build: fixed, height: [4, 3, 6] },
};

function makeLadder(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const [hd, hmin, hmax] = s.height;
  const params = [
    num("height", hd, hmin, hmax, "Overall height of the ladder in metres."),
    num("width", style === "fixed" ? 0.46 : 0.42, style === "fixed" ? 0.4 : 0.36, 0.5, "Width over the rails along x, in metres."),
  ];
  if (style === "step") params.push(num("depth", 0.75, 0.55, 1, "Footprint depth from front feet to rear feet along z, in metres."));
  else params.push(num("spacing", 0.28, 0.25, 0.3, "Distance between the rungs in metres."));
  const finish = f.text.split(" ")[0]!;
  return {
    slug: slugify("ladder", f.key, style),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${s.title}`,
    description: `${s.text}, in ${f.text}. Stands on y = 0 with the climbing side facing +z.`,
    tags: [style, f.key, finish, ...(style === "step" ? ["trap", "huishoudtrap", "a-frame"] : style === "extension" ? ["schuifladder", "uitschuifbaar"] : style === "fixed" ? ["kooiladder", "vaste ladder", "industrial"] : ["enkele ladder"])],
    params,
    materials: materials(f),
    nodes: s.build(f),
  };
}

export const ladder: Family = {
  id: "ladder",
  category: "props",
  archetype: "prop.ladder",
  tags: ["ladder", "ladders", "rungs", "sporten", "trap", "climb", "klimmen", "prop"],
  assets: () => combos({ style: ["single", "extension", "step", "fixed"] as Style[], i: [0, 1] }).map(({ style, i }) => makeLadder(style, FINISHES[style][i] as Finish)),
};
