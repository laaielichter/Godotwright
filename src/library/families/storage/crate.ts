import { box, cap, cyl, group, int, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { an, finishName, finishTags, frontBack, stencil, useMats, worn } from "./common.js";

/** One crate: its shape style and four finishes. */
type Finish = { main: string; trim: string; accent: string };

interface Style {
  name: string;
  title: string;
  text: string;
  tags: string[];
  finishes: Finish[];
  build: (f: Finish) => { nodes: SpecNode[]; params: ReturnType<typeof num>[] };
}

const W = "$width", D = "$depth", H = "$height";

/** An open slatted crate (fruit or vegetable crate) of planks on four corner posts. */
function slatCrate(f: Finish): { nodes: SpecNode[]; params: ReturnType<typeof num>[] } {
  const nails = (side: "x" | "z"): SpecNode[] =>
    side === "x"
      ? [cyl("Nail_F", 0.0045, 0.006, { axis: "x", at: ["$t / 2", 0, "$D / 2 - $t - $p / 2"], segments: 8, material: f.accent }), cyl("Nail_B", 0.0045, 0.006, { axis: "x", at: ["$t / 2", 0, "-$D / 2 + $t + $p / 2"], segments: 8, material: f.accent })]
      : [cyl("Nail_L", 0.0045, 0.006, { axis: "z", at: ["$W / 2 - $t - $p / 2", 0, "$t / 2"], segments: 8, material: f.accent }), cyl("Nail_R", 0.0045, 0.006, { axis: "z", at: ["-$W / 2 + $t + $p / 2", 0, "$t / 2"], segments: 8, material: f.accent })];
  const nodes = [
    group("SlatCrate", [
      group("Body", [
        box("Bottom_{i}", ["$W - 2 * $t", "$t", "($D - 2 * $t) / 3 - 0.012"], { at: [0, "$t / 2", "-($D - 2 * $t) / 3"], repeat: { count: 3, step: [0, 0, "($D - 2 * $t) / 3"] }, bevel: 0.002 }),
        box("Slat_L{i}", ["$t", "$sh", "$D"], { at: ["$W / 2 - $t / 2", "$sh / 2", 0], repeat: { count: "$slats", step: [0, "($H - $sh) / ($slats - 1)", 0] }, bevel: 0.003, mirror: "Slat_R{i}", children: nails("x") }),
        ...frontBack((s, tag) => [
          box(`Slat_${tag}{i}`, ["$W - 2 * $t + 0.002", "$sh", "$t"], { at: [0, "$sh / 2", `${s} * ($D / 2 - $t / 2)`], repeat: { count: "$slats", step: [0, "($H - $sh) / ($slats - 1)", 0] }, bevel: 0.003, children: nails("z").map((n) => ({ ...n, at: (n["at"] as unknown[]).map((v, k) => (k === 2 ? `${s} * $t / 2` : v)) })) }),
          box(`Grip_${tag}`, [0.11, "min(0.032, $sh * 0.55)", "$t + 0.004"], { at: [0, "$H - $sh / 2", `${s} * ($D / 2 - $t / 2)`], material: "hole" }),
        ]),
        box("Post_FL", ["$p", "$H", "$p"], { at: ["$W / 2 - $t - $p / 2 + 0.001", 0, "$D / 2 - $t - $p / 2 + 0.001"], anchor: "bottom", bevel: 0.003, mirror: "Post_FR" }),
        box("Post_BL", ["$p", "$H", "$p"], { at: ["$W / 2 - $t - $p / 2 + 0.001", 0, "-$D / 2 + $t + $p / 2 - 0.001"], anchor: "bottom", bevel: 0.003, mirror: "Post_BR" }),
      ]),
    ], { material: f.main, vars: { W, D, H, t: 0.016, p: 0.04, sh: `${H} / $slats * 0.62` } }),
  ];
  return {
    nodes,
    params: [
      num("width", 0.6, 0.4, 1.0, "Outer width along x in metres."),
      num("depth", 0.4, 0.3, 0.7, "Outer depth along z in metres."),
      num("height", 0.32, 0.25, 0.6, "Height of the crate in metres."),
      int("slats", 3, 2, 5, "Number of slats on each side."),
    ],
  };
}

/** A closed shipping crate of planks with cleats, diagonal braces, skids and a battened lid. */
function framedCrate(f: Finish): { nodes: SpecNode[]; params: ReturnType<typeof num>[] } {
  // One face of cleats: a frame of four battens and a diagonal brace. `len` is the face length, `axis` its direction.
  const sideX: SpecNode[] = [
    group("Cleats_L", [
      box("CleatTop", ["$ct", "$cw", "$D"], { at: ["$W / 2 - $ct / 2", "$s + $bh - $cw / 2", 0], bevel: 0.004 }),
      box("CleatLow", ["$ct", "$cw", "$D"], { at: ["$W / 2 - $ct / 2", "$s + $cw / 2", 0], bevel: 0.004 }),
      box("CleatF", ["$ct", "$bh - 2 * $cw + 0.004", "$cw"], { at: ["$W / 2 - $ct / 2", "$s + $bh / 2", "$D / 2 - $cw / 2"], bevel: 0.004 }),
      box("CleatB", ["$ct", "$bh - 2 * $cw + 0.004", "$cw"], { at: ["$W / 2 - $ct / 2", "$s + $bh / 2", "-$D / 2 + $cw / 2"], bevel: 0.004 }),
      box("Brace", ["$ct * 0.9", "$cw * 0.9", "hypot($D - 2 * $cw, $bh - 2 * $cw) - $cw * 0.7"], { at: ["$W / 2 - $ct / 2", "$s + $bh / 2", 0], rotate: ["deg(atan2($bh - 2 * $cw, $D - 2 * $cw))", 0, 0], bevel: 0.004 }),
    ], { mirror: "Cleats_R" }),
  ];
  const faceZ = frontBack((s, tag) => [
    group(`Cleats_${tag}`, [
      box("CleatTop", ["$W - 2 * $ct", "$cw", "$ct"], { at: [0, "$s + $bh - $cw / 2", `${s} * ($D / 2 - $ct / 2)`], bevel: 0.004 }),
      box("CleatLow", ["$W - 2 * $ct", "$cw", "$ct"], { at: [0, "$s + $cw / 2", `${s} * ($D / 2 - $ct / 2)`], bevel: 0.004 }),
      box("CleatL", ["$cw", "$bh - 2 * $cw + 0.004", "$ct"], { at: ["$W / 2 - $ct - $cw / 2", "$s + $bh / 2", `${s} * ($D / 2 - $ct / 2)`], bevel: 0.004 }),
      box("CleatR", ["$cw", "$bh - 2 * $cw + 0.004", "$ct"], { at: ["-$W / 2 + $ct + $cw / 2", "$s + $bh / 2", `${s} * ($D / 2 - $ct / 2)`], bevel: 0.004 }),
      box("Brace", ["hypot($W - 2 * $ct - 2 * $cw, $bh - 2 * $cw) - $cw * 0.7", "$cw * 0.9", "$ct * 0.9"], { at: [0, "$s + $bh / 2", `${s} * ($D / 2 - $ct / 2)`], rotate: [0, 0, `${s} * deg(atan2($bh - 2 * $cw, $W - 2 * $ct - 2 * $cw))`], bevel: 0.004 }),
      box("BraceX", ["hypot($W - 2 * $ct - 2 * $cw, $bh - 2 * $cw) - $cw * 0.7", "$cw * 0.9", "$ct * 0.9"], { at: [0, "$s + $bh / 2", `${s} * ($D / 2 - $ct * 0.45)`], rotate: [0, 0, `${-s} * deg(atan2($bh - 2 * $cw, $W - 2 * $ct - 2 * $cw))`], bevel: 0.004 }),
    ]),
    box(`Plank_${tag}{i}`, ["$W - 2 * $ct", "$bh / $nb - 0.006", "$bt"], { at: [0, "$s + $bh / $nb / 2", `${s} * ($D / 2 - $ct - $bt / 2 + 0.002)`], repeat: { count: "$nb", step: [0, "$bh / $nb", 0] } }),
  ]);
  const nodes = [
    group("ShippingCrate", [
      box("Skid_L", [0.08, "$s", "$D"], { at: ["$W / 2 - 0.12", "$s / 2", 0], bevel: 0.006, mirror: "Skid_R" }),
      group("Body", [
        box("Core", ["$W - 2 * $ct - 2 * $bt + 0.004", "$bh", "$D - 2 * $ct - 2 * $bt + 0.004"], { at: [0, "$s + $bh / 2", 0] }),
        box("Plank_L{i}", ["$bt", "$bh / $nb - 0.006", "$D - 2 * $ct"], { at: ["$W / 2 - $ct - $bt / 2 + 0.002", "$s + $bh / $nb / 2", 0], repeat: { count: "$nb", step: [0, "$bh / $nb", 0] }, mirror: "Plank_R{i}" }),
        ...sideX,
        ...faceZ,
      ]),
      group("Lid", [
        box("Panel", ["$W", "$lt * 0.55", "$D"], { at: [0, "$lt * 0.275", 0], bevel: 0.004 }),
        box("Batten_{i}", ["$W - 0.02", "$lt * 0.5", "$cw"], { at: [0, "$lt * 0.7", "-$D / 2 + $cw"], repeat: { count: 3, step: [0, 0, "($D - 2 * $cw) / 2"] }, bevel: 0.004 }),
        stencil("Stencil", "FRAGILE", "top", [0, "$lt * 0.55 + 0.001", "($D - 2 * $cw) / 4"], 0.014, f.accent, 0.003),
        stencil("Lot", "LOT 2417", "top", [0, "$lt * 0.55 + 0.001", "-($D - 2 * $cw) / 4"], 0.01, f.accent, 0.003),
      ], { at: [0, "$s + $bh - 0.002", 0] }),
    ], { material: f.main, vars: { W, D, H, s: 0.09, lt: 0.045, ct: 0.022, cw: 0.085, bt: 0.018, bh: `${H} - 0.09 - 0.045`, nb: "max(2, round(($height - 0.135) / 0.14))" } }),
  ];
  return {
    nodes,
    params: [
      num("width", 1.0, 0.6, 1.5, "Outer width along x in metres."),
      num("depth", 0.7, 0.45, 1.2, "Outer depth along z in metres."),
      num("height", 0.7, 0.45, 1.1, "Height including the skids and the lid, in metres."),
    ],
  };
}

/** A plywood flight-case style box: panels, metal edge trims and ball corners, a lid with latches, side handles. */
function plywoodBox(f: Finish): { nodes: SpecNode[]; params: ReturnType<typeof num>[] } {
  const corner = (name: string, x: string, y: string, z: string, mirror: string): SpecNode =>
    box(name, [0.05, 0.05, 0.05], { at: [x, y, z], bevel: 0.012, material: f.trim, mirror });
  const nodes = [
    group("FlightCase", [
      group("Body", [
        box("Shell", ["$W - 0.006", "$bh", "$D - 0.006"], { at: [0, "$bh / 2", 0] }),
        box("Edge_FL", [0.034, "$bh - 0.04", 0.034], { at: ["$W / 2 - 0.015", "$bh / 2", "$D / 2 - 0.015"], material: f.trim, mirror: "Edge_FR" }),
        box("Edge_BL", [0.034, "$bh - 0.04", 0.034], { at: ["$W / 2 - 0.015", "$bh / 2", "-$D / 2 + 0.015"], material: f.trim, mirror: "Edge_BR" }),
        box("Edge_SL", [0.034, 0.034, "$D - 0.04"], { at: ["$W / 2 - 0.015", 0.015, 0], material: f.trim, mirror: "Edge_SR" }),
        box("Edge_LF", ["$W - 0.04", 0.034, 0.034], { at: [0, 0.015, "$D / 2 - 0.015"], material: f.trim }),
        box("Edge_LB", ["$W - 0.04", 0.034, 0.034], { at: [0, 0.015, "-$D / 2 + 0.015"], material: f.trim }),
        box("Rim_L", [0.03, 0.03, "$D - 0.04"], { at: ["$W / 2 - 0.013", "$bh - 0.015", 0], material: f.trim, mirror: "Rim_R" }),
        box("Rim_F", ["$W - 0.04", 0.03, 0.03], { at: [0, "$bh - 0.015", "$D / 2 - 0.013"], material: f.trim }),
        box("Rim_B", ["$W - 0.04", 0.03, 0.03], { at: [0, "$bh - 0.015", "-$D / 2 + 0.013"], material: f.trim }),
        corner("Corner_FL", "$W / 2 - 0.022", "0.025", "$D / 2 - 0.022", "Corner_FR"),
        corner("Corner_BL", "$W / 2 - 0.022", "0.025", "-$D / 2 + 0.022", "Corner_BR"),
        group("Handle_L", [
          box("Dish", [0.012, 0.09, 0.2], { at: [0, 0, 0], bevel: 0.004 }),
          tube("Grip", [[0.004, 0.03, -0.075], [0.03, 0.025, -0.07], [0.03, 0.025, 0.07], [0.004, 0.03, 0.075]], 0.009, { segments: 8, material: "rubber" }),
        ], { at: ["$W / 2 - 0.001", "$bh * 0.62", 0], material: f.trim, mirror: "Handle_R" }),
        group("Latch_L", [
          box("Plate", [0.07, 0.07, 0.012], { at: [0, 0, 0], bevel: 0.004 }),
          box("Lever", [0.035, 0.05, 0.012], { at: [0, 0.03, 0.008], bevel: 0.004 }),
        ], { at: ["$W * 0.28", "$bh - 0.035", "$D / 2 + 0.003"], material: f.trim, mirror: "Latch_R" }),
      ]),
      group("Lid", [
        box("Panel", ["$W - 0.006", "$lt", "$D - 0.006"], { at: [0, "$lt / 2", 0] }),
        box("Trim_L", [0.034, 0.034, "$D - 0.04"], { at: ["$W / 2 - 0.015", "$lt - 0.015", 0], material: f.trim, mirror: "Trim_R" }),
        box("Trim_F", ["$W - 0.04", 0.034, 0.034], { at: [0, "$lt - 0.015", "$D / 2 - 0.015"], material: f.trim }),
        box("Trim_B", ["$W - 0.04", 0.034, 0.034], { at: [0, "$lt - 0.015", "-$D / 2 + 0.015"], material: f.trim }),
        corner("Cap_FL", "$W / 2 - 0.022", "$lt - 0.022", "$D / 2 - 0.022", "Cap_FR"),
        corner("Cap_BL", "$W / 2 - 0.022", "$lt - 0.022", "-$D / 2 + 0.022", "Cap_BR"),
        box("Keeper_L", [0.05, 0.03, 0.012], { at: ["$W * 0.28", 0.02, "$D / 2 + 0.003"], material: f.trim, bevel: 0.003, mirror: "Keeper_R" }),
      ], { at: [0, "$bh", 0] }),
    ], { material: f.main, vars: { W, D, H, lt: "max(0.07, $height * 0.18)", bh: `${H} - max(0.07, $height * 0.18)` } }),
  ];
  return {
    nodes,
    params: [
      num("width", 0.8, 0.5, 1.2, "Outer width along x in metres."),
      num("depth", 0.55, 0.4, 0.9, "Outer depth along z in metres."),
      num("height", 0.6, 0.35, 0.9, "Height with the lid closed, in metres."),
    ],
  };
}

/** A stackable plastic crate: thin walls with a thick top rim, outer ribs, hand slots and a foot ring. */
function plasticCrate(f: Finish): { nodes: SpecNode[]; params: ReturnType<typeof num>[] } {
  const nodes = [
    group("PlasticCrate", [
      group("Body", [
        box("Floor", ["$W - 0.03", 0.012, "$D - 0.03"], { at: [0, 0.022, 0] }),
        box("Foot_L", [0.014, 0.024, "$D - 0.04"], { at: ["$W / 2 - 0.022", 0.012, 0], bevel: 0.003, mirror: "Foot_R" }),
        box("Foot_F", ["$W - 0.04", 0.024, 0.014], { at: [0, 0.012, "$D / 2 - 0.022"], bevel: 0.003 }),
        box("Foot_B", ["$W - 0.04", 0.024, 0.014], { at: [0, 0.012, "-$D / 2 + 0.022"], bevel: 0.003 }),
        box("Wall_L", [0.008, "$H - 0.05", "$D - 0.024"], { at: ["$W / 2 - 0.016", "0.02 + ($H - 0.05) / 2", 0], mirror: "Wall_R" }),
        box("Wall_F", ["$W - 0.024", "$H - 0.05", 0.008], { at: [0, "0.02 + ($H - 0.05) / 2", "$D / 2 - 0.016"] }),
        box("Wall_B", ["$W - 0.024", "$H - 0.05", 0.008], { at: [0, "0.02 + ($H - 0.05) / 2", "-$D / 2 + 0.016"] }),
        box("Rim_L", [0.018, 0.034, "$D"], { at: ["$W / 2 - 0.009", "$H - 0.017", 0], bevel: 0.004, mirror: "Rim_R" }),
        box("Rim_F", ["$W - 0.03", 0.034, 0.018], { at: [0, "$H - 0.017", "$D / 2 - 0.009"], bevel: 0.004 }),
        box("Rim_B", ["$W - 0.03", 0.034, 0.018], { at: [0, "$H - 0.017", "-$D / 2 + 0.009"], bevel: 0.004 }),
        ...frontBack((s, tag) => [
          box(`Rib_${tag}{i}`, [0.012, "$H - 0.06", 0.01], { at: ["-($W - 0.12) / 2", "0.025 + ($H - 0.06) / 2", `${s} * ($D / 2 - 0.009)`], repeat: { count: "$ribs", step: ["($W - 0.12) / ($ribs - 1)", 0, 0] }, bevel: 0.002 }),
          box(`Band_${tag}`, ["$W - 0.03", 0.014, 0.01], { at: [0, "0.025 + ($H - 0.06) * 0.45", `${s} * ($D / 2 - 0.009)`], bevel: 0.002 }),
        ]),
        box("Post_L{i}", [0.01, "$H - 0.06", 0.012], { at: ["$W / 2 - 0.009", "0.025 + ($H - 0.06) / 2", "-($D - 0.1) / 2"], repeat: { count: 3, step: [0, 0, "($D - 0.1) / 2"] }, bevel: 0.002, mirror: "Post_R{i}" }),
        box("Slot_L", [0.012, 0.028, "min(0.13, $D * 0.35)"], { at: ["$W / 2 - 0.009", "$H - 0.055", 0], material: "hole", mirror: "Slot_R" }),
        box("Label", ["min(0.12, $W * 0.25)", 0.05, 0.004], { at: [0, "$H - 0.07", "$D / 2 - 0.004"], material: f.accent, bevel: 0.001 }),
      ]),
    ], { material: f.main, vars: { W, D, H } }),
  ];
  return {
    nodes,
    params: [
      num("width", 0.6, 0.4, 0.8, "Outer width along x in metres (a euro crate is 0.6)."),
      num("depth", 0.4, 0.3, 0.6, "Outer depth along z in metres."),
      num("height", 0.32, 0.2, 0.45, "Height of the crate in metres."),
      int("ribs", 5, 3, 7, "Vertical ribs on the front and back walls."),
    ],
  };
}

/** Eight [x, y] points of a box section with chamfered corners: bottom chamfer cb, top chamfer ct, inset i. */
function octagon(cb: string, ct: string, y0: string, y1: string, inset: string, low: boolean, high: boolean): [string, string][] {
  const w = `($W / 2 - ${inset})`;
  const b = low ? `(${y0} + ${inset})` : y0, t = high ? `(${y1} - ${inset})` : y1;
  return [
    [`-${w} + ${cb}`, b], [`${w} - ${cb}`, b], [w, `${b} + ${cb}`], [w, `${t} - ${ct}`],
    [`${w} - ${ct}`, t], [`-${w} + ${ct}`, t], [`-${w}`, `${t} - ${ct}`], [`-${w}`, `${b} + ${cb}`],
  ];
}

/** A chamfered box as a loft along z, with its ends chamfered too. */
function chamferedLoft(name: string, cb: string, ct: string, y0: string, y1: string, c: string, low: boolean, high: boolean): SpecNode {
  return loft(name, [
    { z: "-$D / 2", points: octagon(cb, ct, y0, y1, c, low, high) },
    { z: `-$D / 2 + ${c}`, points: octagon(cb, ct, y0, y1, "0", low, high) },
    { z: `$D / 2 - ${c}`, points: octagon(cb, ct, y0, y1, "0", low, high) },
    { z: "$D / 2", points: octagon(cb, ct, y0, y1, c, low, high) },
  ]);
}

/** A sci-fi cargo crate: chamfered body and lid, glowing strips, side panels, grab handles, bumpers and feet. */
function scifiCrate(f: Finish): { nodes: SpecNode[]; params: ReturnType<typeof num>[] } {
  const bumper = (name: string, z: string, ry: number, mirror: string): SpecNode =>
    box(name, ["$c * 1.25", "$bh * 0.7", 0.016], { at: ["$W / 2 - $c / 2 + 0.004", "$f + $bh / 2", z], rotate: [0, ry, 0], material: f.trim, bevel: 0.004, mirror });
  const nodes = [
    group("CargoCrate", [
      box("Foot_FL", [0.1, "$f + 0.01", 0.1], { at: ["$W / 2 - 0.1", 0, "$D / 2 - 0.1"], anchor: "bottom", material: f.trim, bevel: 0.006, mirror: "Foot_FR" }),
      box("Foot_BL", [0.1, "$f + 0.01", 0.1], { at: ["$W / 2 - 0.1", 0, "-$D / 2 + 0.1"], anchor: "bottom", material: f.trim, bevel: 0.006, mirror: "Foot_BR" }),
      group("Body", [
        chamferedLoft("Shell", "$c", "0.012", "$f", "$f + $bh", "$c", true, false),
        box("Panel_L", [0.012, "$bh * 0.55", "$D - 2 * $c - 0.12"], { at: ["$W / 2 + 0.002", "$f + $bh * 0.5", 0], material: f.trim, bevel: 0.004, mirror: "Panel_R" }),
        tube("Grip_L", [["$W / 2 + 0.004", "$f + $bh * 0.82", -0.12], ["$W / 2 + 0.045", "$f + $bh * 0.82", -0.1], ["$W / 2 + 0.045", "$f + $bh * 0.82", 0.1], ["$W / 2 + 0.004", "$f + $bh * 0.82", 0.12]], 0.013, { segments: 10, material: f.trim, mirror: "Grip_R" }),
        box("Strip_F", ["$W * 0.55", 0.022, 0.008], { at: [0, "$f + $bh * 0.35", "$D / 2 - 0.002"], material: f.accent, bevel: 0.002 }),
        box("Strip_B", ["$W * 0.55", 0.022, 0.008], { at: [0, "$f + $bh * 0.35", "-$D / 2 + 0.002"], material: f.accent, bevel: 0.002 }),
        box("Plate_F", ["$W * 0.3", "$bh * 0.18", 0.01], { at: [0, "$f + $bh * 0.62", "$D / 2 - 0.002"], material: f.trim, bevel: 0.003 }),
        box("Status_FL", [0.03, 0.03, 0.012], { at: ["$W * 0.22", "$f + $bh * 0.62", "$D / 2 - 0.002"], material: f.accent, bevel: 0.004, mirror: "Status_FR" }),
        bumper("Corner_FL", "$D / 2 - $c / 2 + 0.004", 45, "Corner_FR"),
        bumper("Corner_BL", "-$D / 2 + $c / 2 - 0.004", 135, "Corner_BR"),
        box("Clasp_L", [0.06, 0.07, 0.03], { at: ["$W * 0.3", "$f + $bh - 0.02", "$D / 2 - 0.004"], material: f.trim, bevel: 0.006, mirror: "Clasp_R" }),
      ]),
      group("Lid", [
        chamferedLoft("Cover", "0.012", "$cl", "0", "$lt", "$cl", false, true),
        box("Ridge", ["$W - 2 * $c - 0.1", 0.02, "$D - 2 * $c - 0.1"], { at: [0, "$lt + 0.006", 0], material: f.trim, bevel: 0.006 }),
      ], { at: [0, "$f + $bh - 0.004", 0] }),
    ], { material: f.main, vars: { W, D, H, c: "min(0.07, $height * 0.12)", f: 0.035, lt: "$height * 0.24", cl: "min(0.07, $height * 0.12, $height * 0.24 * 0.3)", bh: "$height * 0.76 - 0.035" } }),
  ];
  return {
    nodes,
    params: [
      num("width", 1.0, 0.6, 1.4, "Outer width along x in metres."),
      num("depth", 0.75, 0.5, 1.1, "Outer depth along z in metres."),
      num("height", 0.65, 0.45, 1.0, "Height with the lid, in metres."),
    ],
  };
}

/** A steel ammunition-style box: pressed ribs, a gasketed lid with a folding handle, clamp latches and a stencil band. */
function ammoBox(f: Finish): { nodes: SpecNode[]; params: ReturnType<typeof num>[] } {
  const nodes = [
    group("AmmoBox", [
      group("Body", [
        box("Case", ["$W", "$bh", "$D"], { at: [0, "$bh / 2", 0], bevel: 0.008, material: worn(f.main) }),
        box("Frame_{i}", ["$W + 0.006", 0.012, "$D + 0.006"], { at: [0, "$bh * 0.25", 0], repeat: { count: 2, step: [0, "$bh * 0.4", 0] }, bevel: 0.004 }),
        box("Band", ["$W + 0.004", 0.022, "$D + 0.004"], { at: [0, "$bh * 0.45", 0], material: f.accent }),
        stencil("Stencil", "AMMO", "+z", [0, "$bh * 0.72", "$D / 2 + 0.001"], 0.012, f.accent, 0.003),
        stencil("Lot", "LOT 58-1", "+z", [0, "$bh * 0.72 - 0.05", "$D / 2 + 0.001"], 0.006, f.accent, 0.003),
        group("Clamp_L", [
          box("Base", [0.012, 0.07, 0.07], { at: [0, 0, 0], bevel: 0.003 }),
          box("Lever", [0.012, 0.11, 0.045], { at: [0.008, 0.03, 0], rotate: [12, 0, 0], bevel: 0.004 }),
        ], { at: ["$W / 2 + 0.004", "$bh - 0.035", 0], material: f.trim, mirror: "Clamp_R" }),
        cyl("Hinge", 0.012, "$W * 0.8", { axis: "x", at: [0, "$bh", "-$D / 2 - 0.004"], segments: 10, material: f.trim }),
      ]),
      group("Lid", [
        box("Cover", ["$W + 0.01", "$lt", "$D + 0.01"], { at: [0, "$lt / 2", 0], bevel: 0.008 }),
        box("Raised", ["$W * 0.8", 0.012, "$D * 0.7"], { at: [0, "$lt", 0], bevel: 0.005 }),
        box("Gasket", ["$W - 0.004", 0.008, "$D - 0.004"], { at: [0, 0.002, 0], material: "rubber" }),
        tube("Handle", [["-$W * 0.2", "$lt + 0.008", -0.02], ["-$W * 0.2", "$lt + 0.018", 0.02], ["-$W * 0.16", "$lt + 0.018", 0.045], ["$W * 0.16", "$lt + 0.018", 0.045], ["$W * 0.2", "$lt + 0.018", 0.02], ["$W * 0.2", "$lt + 0.008", -0.02]], 0.008, { segments: 8, material: f.trim }),
        box("Mount_L", [0.03, 0.02, 0.03], { at: ["$W * 0.2", "$lt + 0.006", -0.02], material: f.trim, bevel: 0.004, mirror: "Mount_R" }),
      ], { at: [0, "$bh - 0.002", 0] }),
    ], { material: f.main, vars: { W, D, H, lt: "max(0.05, $height * 0.2)", bh: `${H} - max(0.05, $height * 0.2)` } }),
  ];
  return {
    nodes,
    params: [
      num("width", 0.6, 0.35, 0.9, "Length of the box along x in metres."),
      num("depth", 0.3, 0.2, 0.45, "Depth along z in metres."),
      num("height", 0.32, 0.2, 0.45, "Height with the lid, in metres."),
    ],
  };
}

const STYLES: Style[] = [
  {
    name: "slatted", title: "slatted crate", text: "an open crate of nailed slats on four corner posts, with hand holes in the end slats", tags: ["fruit crate", "fruitkist", "slats", "latten", "open"], build: slatCrate,
    finishes: [{ main: "pine", trim: "pine", accent: "steel" }, { main: "weathered_wood", trim: "weathered_wood", accent: "rust" }, { main: "whitewash_wood", trim: "whitewash_wood", accent: "steel" }, { main: "rough_timber", trim: "rough_timber", accent: "black_steel" }],
  },
  {
    name: "shipping", title: "shipping crate", text: "a closed crate of horizontal planks framed by cleats with diagonal braces, on two skids, with a battened lid and a stencil plate", tags: ["shipping crate", "transportkist", "skids", "cleats", "closed"], build: framedCrate,
    finishes: [{ main: "pine", trim: "pine", accent: "paint_black" }, { main: "rough_timber", trim: "rough_timber", accent: "paint_red" }, { main: "light_oak", trim: "light_oak", accent: "paint_black" }, { main: "weathered_wood", trim: "weathered_wood", accent: "paint_white" }],
  },
  {
    name: "flight-case", title: "plywood flight case", text: "a plywood box with metal edge trims, ball corners, recessed side handles and butterfly latches holding a deep lid", tags: ["flight case", "plywood", "multiplex", "road case"], build: plywoodBox,
    finishes: [{ main: "birch", trim: "aluminium", accent: "aluminium" }, { main: "paint_black", trim: "brushed_steel", accent: "brushed_steel" }, { main: "dark_stain", trim: "brass", accent: "brass" }, { main: "paint_grey", trim: "black_steel", accent: "black_steel" }],
  },
  {
    name: "plastic", title: "plastic stacking crate", text: "a stackable plastic crate with thin walls, a thick top rim, outer ribs, hand slots in the ends and a foot ring", tags: ["plastic crate", "plastic krat", "stackable", "stapelbaar", "euro crate"], build: plasticCrate,
    finishes: [{ main: "plastic_blue", trim: "plastic_blue", accent: "plastic_white" }, { main: "plastic_grey", trim: "plastic_grey", accent: "plastic_white" }, { main: "plastic_red", trim: "plastic_red", accent: "plastic_white" }, { main: "plastic_green", trim: "plastic_green", accent: "plastic_yellow" }],
  },
  {
    name: "scifi", title: "sci-fi cargo crate", text: "a chamfered sci-fi cargo crate with a separate lid, glowing strips, armoured side panels, grab handles, corner bumpers and feet", tags: ["sci-fi", "scifi", "cargo", "lading", "futuristic", "game crate"], build: scifiCrate,
    finishes: [{ main: "gunmetal", trim: "black_steel", accent: "led_blue" }, { main: "paint_white", trim: "paint_anthracite", accent: "screen_cyan" }, { main: "paint_orange", trim: "gunmetal", accent: "bulb_amber" }, { main: "paint_olive", trim: "black_steel", accent: "led_green" }],
  },
  {
    name: "ammo", title: "steel ammo box", text: "a long steel ammunition-style box with pressed ribs, a stencil band, clamp latches at the ends and a gasketed lid with a folding carry handle", tags: ["ammo box", "munitiekist", "military", "leger", "steel box"], build: ammoBox,
    finishes: [{ main: "paint_olive", trim: "black_steel", accent: "paint_yellow" }, { main: "paint_forest", trim: "black_steel", accent: "paint_white" }, { main: "paint_sand", trim: "gunmetal", accent: "paint_black" }, { main: "paint_grey", trim: "steel", accent: "paint_yellow" }],
  },
];

function crate(style: Style, f: Finish): AssetDraft {
  const { nodes, params } = style.build(f);
  const fin = finishName(f.main);
  return {
    slug: slugify("crate", style.name, fin),
    title: cap(`${fin} ${style.title}`),
    description: `${cap(an(fin))} ${style.title}: ${style.text}. Its front faces +z.`,
    tags: [...style.tags, ...finishTags(f.main)],
    params,
    materials: useMats(f.main, f.trim, f.accent, "hole", "rubber", worn(f.main)),
    nodes,
  };
}

export const crateFamily: Family = {
  id: "crate",
  category: "storage",
  archetype: "prop.crate",
  tags: ["crate", "box", "kist", "krat", "doos", "storage", "opslag"],
  assets: () => STYLES.flatMap((s) => s.finishes.map((f) => crate(s, f))),
};
