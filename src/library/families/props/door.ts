import { box, cyl, group, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";

/**
 * Doors in their frames: a four-panel door with raised panels, a flush door with a vision strip, a glazed door with
 * glazing bars and a ledged-and-braced plank door. The Frame (jambs, head, stops and a threshold) stands on y = 0;
 * the Leaf has its origin on the hinge line at the -x jamb and opens about y by the `open` angle (towards -z). The
 * door faces +z and its Handle sits on both faces at the edge away from the hinges.
 */
type Style = "panel" | "flush" | "glazed" | "ledged";

interface Finish {
  key: string;
  leaf: string;
  frame: string;
  metal: string;
  text: string;
}

const FINISHES: Record<Style, Finish[]> = {
  panel: [
    { key: "white", leaf: "paint_white", frame: "paint_white", metal: "brushed_steel", text: "white-painted with brushed steel lever handles" },
    { key: "oak", leaf: "oak", frame: "oak", metal: "brass", text: "solid oak with brass lever handles" },
    { key: "green", leaf: "paint_forest", frame: "paint_white", metal: "brass", text: "deep green paint in a white frame, with brass handles" },
    { key: "navy", leaf: "paint_navy", frame: "paint_white", metal: "chrome", text: "navy blue paint in a white frame, with chrome handles" },
  ],
  flush: [
    { key: "white", leaf: "paint_white", frame: "paint_white", metal: "brushed_steel", text: "white lacquer with brushed steel handles" },
    { key: "birch", leaf: "birch", frame: "birch", metal: "brushed_steel", text: "birch veneer with brushed steel handles" },
    { key: "anthracite", leaf: "paint_anthracite", frame: "paint_anthracite", metal: "black_steel", text: "anthracite grey with black handles" },
    { key: "oak", leaf: "light_oak", frame: "paint_white", metal: "black_steel", text: "light oak veneer in a white frame, with black handles" },
  ],
  glazed: [
    { key: "white", leaf: "paint_white", frame: "paint_white", metal: "brass", text: "white-painted with clear glass and brass handles" },
    { key: "oak", leaf: "oak", frame: "oak", metal: "black_steel", text: "oak with clear glass and black handles" },
    { key: "black", leaf: "paint_black", frame: "paint_black", metal: "brushed_steel", text: "black steel-look bars with clear glass and steel handles" },
    { key: "teak", leaf: "teak", frame: "teak", metal: "brass", text: "teak with frosted glass and brass handles" },
  ],
  ledged: [
    { key: "weathered", leaf: "weathered_wood", frame: "weathered_wood", metal: "rust", text: "weathered grey planks with rusty strap hinges and a ring handle" },
    { key: "oak", leaf: "oak", frame: "oak", metal: "cast_iron", text: "oak planks with black iron strap hinges and a ring handle" },
    { key: "red", leaf: "paint_red", frame: "paint_white", metal: "black_steel", text: "red-painted planks in a white frame, with black strap hinges" },
    { key: "pine", leaf: "pine", frame: "pine", metal: "black_steel", text: "pine planks with black strap hinges and a ring handle" },
  ],
};

/** The frame around the opening: jambs, head, door stops and a threshold. */
function frame(f: Finish): SpecNode {
  return group("Frame", [
    box("Jamb_L", [0.07, "$height + 0.07", 0.12], { at: ["-$width / 2 - 0.035", 0, 0], anchor: "bottom", bevel: 0.004, mirror: "Jamb_R" }),
    box("Head", ["$width + 0.14", 0.07, 0.12], { at: [0, "$height + 0.035", 0], bevel: 0.004 }),
    box("Stop_L", [0.015, "$height", 0.035], { at: ["-$width / 2 + 0.0075", 0, -0.0425], anchor: "bottom", bevel: 0.002, mirror: "Stop_R" }),
    box("StopHead", ["$width", 0.015, 0.035], { at: [0, "$height - 0.0075", -0.0425], bevel: 0.002 }),
    box("Architrave_L", [0.07, "$height + 0.07", 0.012], { at: ["-$width / 2 - 0.035", 0, 0.066], anchor: "bottom", bevel: 0.003, mirror: "Architrave_R" }),
    box("ArchitraveHead", ["$width + 0.14", 0.07, 0.012], { at: [0, "$height + 0.035", 0.066], bevel: 0.003 }),
    box("Threshold", ["$width", 0.012, 0.13], { at: [0, 0, 0], anchor: "bottom", bevel: 0.003, material: f.frame === "paint_white" ? "granite" : f.frame }),
  ], { material: f.frame });
}

/** A lever handle with roses on both faces and a key escutcheon. */
function lever(f: Finish): SpecNode {
  return group("Handle", [
    cyl("Rose_F", 0.026, 0.008, { axis: "z", at: [0, 0, 0.024], segments: 16 }),
    cyl("Spindle", 0.006, 0.11, { axis: "z", segments: 8 }),
    box("Lever_F", [0.12, 0.016, 0.018], { at: [-0.05, 0, 0.055], bevel: 0.006 }),
    cyl("Neck_F", 0.009, 0.03, { axis: "z", at: [0, 0, 0.04], segments: 10 }),
    cyl("Rose_B", 0.026, 0.008, { axis: "z", at: [0, 0, -0.024], segments: 16 }),
    box("Lever_B", [0.12, 0.016, 0.018], { at: [-0.05, 0, -0.055], bevel: 0.006 }),
    cyl("Neck_B", 0.009, 0.03, { axis: "z", at: [0, 0, -0.04], segments: 10 }),
    box("Escutcheon_F", [0.024, 0.05, 0.006], { at: [0, -0.1, 0.023], bevel: 0.004 }),
  ], { at: ["$lw - 0.06", "1.03 - $gap", 0], material: f.metal });
}

/** A ring handle with a thumb latch on the front, for the plank door. */
function ring(f: Finish): SpecNode {
  const pts: [number, number, number][] = [];
  for (let k = 0; k <= 12; k++) pts.push([0.045 * Math.sin((k / 12) * 2 * Math.PI), -0.045 + 0.045 * Math.cos((k / 12) * 2 * Math.PI), 0.045]);
  return group("Handle", [
    box("Backplate", [0.06, 0.14, 0.006], { at: [0, 0, 0.03], bevel: 0.003 }),
    tube("Ring", pts, 0.006, { segments: 8, at: [0, -0.01, 0.003] }),
    box("LatchBar", [0.12, 0.014, 0.012], { at: [0.02, 0.1, -0.03], bevel: 0.003 }),
  ], { at: ["$lw - 0.09", "1.0 - $gap", 0], material: f.metal });
}

/** The leaf's body per style, in leaf space: x from 0 (hinge) to $lw, y from 0 to $lh, z across ±0.02. */
function body(style: Style, f: Finish): SpecNode[] {
  if (style === "panel") {
    const panes: SpecNode[] = [];
    for (const face of [1, -1] as const) {
      const s = face > 0 ? "F" : "B";
      panes.push(
        box(`Raised_${s}{i}`, ["($lw - 0.36) / 2", "$lh * 0.32", 0.012], { at: ["0.13 + ($lw - 0.36) / 4 + $i * (($lw - 0.36) / 2 + 0.1)", "$lh * 0.12", face * 0.02], anchor: "bottom", bevel: 0.005, repeat: { count: 2, step: [0, 0, 0] } }),
        box(`RaisedTop_${s}{i}`, ["($lw - 0.36) / 2", "$lh * 0.38", 0.012], { at: ["0.13 + ($lw - 0.36) / 4 + $i * (($lw - 0.36) / 2 + 0.1)", "$lh * 0.52", face * 0.02], anchor: "bottom", bevel: 0.005, repeat: { count: 2, step: [0, 0, 0] } }),
      );
    }
    return [box("Core", ["$lw", "$lh", 0.04], { at: ["$lw / 2", 0, 0], anchor: "bottom", bevel: 0.004 }), ...panes, lever(f)];
  }
  if (style === "flush") {
    return [
      // The core is built around the vision cut-out (x from $lw - 0.27 to $lw - 0.17, y from 0.45 to 0.85 of $lh).
      box("Core", ["$lw - 0.27", "$lh", 0.04], { at: ["($lw - 0.27) / 2", 0, 0], anchor: "bottom", bevel: 0.002 }),
      box("CoreLock", [0.17, "$lh", 0.04], { at: ["$lw - 0.085", 0, 0], anchor: "bottom", bevel: 0.002 }),
      box("CoreLow", [0.1, "$lh * 0.45", 0.04], { at: ["$lw - 0.22", 0, 0], anchor: "bottom" }),
      box("CoreHigh", [0.1, "$lh * 0.15", 0.04], { at: ["$lw - 0.22", "$lh * 0.85", 0], anchor: "bottom" }),
      box("Lipping_L", [0.012, "$lh", 0.041], { at: [0.006, 0, 0], anchor: "bottom", material: f.frame, mirror: "Lipping_R" }),
      box("Vision", [0.1, "$lh * 0.4", 0.008], { at: ["$lw - 0.22", "$lh * 0.45", 0], anchor: "bottom", material: "glass_clear" }),
      box("Bead_T", [0.13, 0.015, 0.046], { at: ["$lw - 0.22", "$lh * 0.85", 0], material: f.metal }),
      box("Bead_B", [0.13, 0.015, 0.046], { at: ["$lw - 0.22", "$lh * 0.45", 0], material: f.metal }),
      box("KickPlate_F", ["$lw - 0.06", 0.2, 0.004], { at: ["$lw / 2", 0.03, 0.021], anchor: "bottom", material: f.metal }),
      lever(f),
    ];
  }
  if (style === "glazed") {
    const glass = f.key === "teak" ? "glass_frosted" : "glass_clear";
    return [
      box("Stile_L", [0.11, "$lh", 0.045], { at: [0.055, 0, 0], anchor: "bottom", bevel: 0.004 }),
      box("Stile_R", [0.11, "$lh", 0.045], { at: ["$lw - 0.055", 0, 0], anchor: "bottom", bevel: 0.004 }),
      box("BottomRail", ["$lw - 0.22", 0.24, 0.045], { at: ["$lw / 2", 0, 0], anchor: "bottom", bevel: 0.004 }),
      box("TopRail", ["$lw - 0.22", 0.11, 0.045], { at: ["$lw / 2", "$lh - 0.11", 0], anchor: "bottom", bevel: 0.004 }),
      box("Glass", ["$lw - 0.22", "$lh - 0.35", 0.008], { at: ["$lw / 2", 0.24, 0], anchor: "bottom", material: glass }),
      box("Bar_V", [0.025, "$lh - 0.35", 0.03], { at: ["$lw / 2", 0.24, 0], anchor: "bottom", bevel: 0.003 }),
      box("Bar_H{i}", ["$lw - 0.22", 0.025, 0.03], { at: ["$lw / 2", "0.24 + ($i + 1) * ($lh - 0.35) / 4", 0], bevel: 0.003, repeat: { count: 3, step: [0, 0, 0] } }),
      lever(f),
    ];
  }
  // Ledged and braced: vertical boards, three ledges and two braces on the back, strap hinges on the front.
  return [
    box("Board_{i}", ["$lw / 6 - 0.004", "$lh", 0.025], { at: ["$lw / 12 + $i * $lw / 6", 0, 0.008], anchor: "bottom", bevel: 0.005, repeat: { count: 6, step: [0, 0, 0] } }),
    box("Ledge_{i}", ["$lw - 0.04", 0.14, 0.03], { at: ["$lw / 2", "0.12 + $i * ($lh - 0.38) / 2", -0.019], anchor: "bottom", bevel: 0.005, repeat: { count: 3, step: [0, 0, 0] } }),
    box("Brace_{i}", [0.1, "hypot(($lh - 0.66) / 2, $lw - 0.2)", 0.028], { at: ["$lw / 2", "0.26 + ($lh - 0.38) / 4 + $i * ($lh - 0.38) / 2", -0.019], rotate: [0, 0, "deg(atan2($lw - 0.2, ($lh - 0.66) / 2))"], bevel: 0.005, repeat: { count: 2, step: [0, 0, 0] } }),
    box("Strap_{i}", ["$lw * 0.7", 0.04, 0.006], { at: ["$lw * 0.35", "0.19 + $i * ($lh - 0.38)", 0.023], bevel: 0.002, material: f.metal, repeat: { count: 2, step: [0, 0, 0] } }),
    ring(f),
  ];
}

const STYLES: Record<Style, { title: string; text: string; tags: string[] }> = {
  panel: { title: "four-panel door", text: "A four-panel door with raised panels on both faces, a lever handle and a key escutcheon", tags: ["panel door", "paneeldeur", "classic", "klassiek", "front door", "voordeur"] },
  flush: { title: "flush door", text: "A flush door with lipped edges, a narrow glazed vision strip with metal beads, a kick plate and a lever handle", tags: ["flush door", "vlakke deur", "modern", "office", "kantoor", "binnendeur"] },
  glazed: { title: "glazed door", text: "A glazed door: stiles, a deep bottom rail and a top rail holding one sheet of glass divided by glazing bars into eight lights", tags: ["glass door", "glazen deur", "french door", "tuindeur", "window", "raam"] },
  ledged: { title: "ledged plank door", text: "A ledged-and-braced door of six vertical boards with ledges and diagonal braces on the back, strap hinges and a ring handle with a thumb latch", tags: ["plank door", "planken deur", "barn door", "stal", "cottage", "rustic", "schuurdeur"] },
};

function door(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const glass = style === "glazed" ? [f.key === "teak" ? "glass_frosted" : "glass_clear"] : style === "flush" ? ["glass_clear"] : [];
  return {
    slug: slugify("door", f.key, style),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${s.title}`,
    description: `${s.text}, ${f.text}, in a frame with stops, architraves and a threshold. The leaf hinges on the -x jamb and opens towards -z by the open angle; it faces +z and stands on y = 0.`,
    tags: [style, f.key, ...s.tags],
    params: [
      num("width", 0.83, 0.73, 0.98, "Width of the opening (the leaf) along x in metres."),
      num("height", 2.015, 1.95, 2.15, "Height of the opening in metres."),
      num("open", 0, 0, 100, "Opening angle of the leaf about its hinges in degrees (towards -z)."),
    ],
    materials: mats(...new Set([f.leaf, f.frame, f.metal, "granite", "brushed_steel", ...glass])),
    nodes: [
      group("Door", [
        frame(f),
        group("Leaf", [
          cyl("Hinge_{i}", 0.008, 0.1, { at: [-0.002, "0.2 + $i * ($lh - 0.45) / 2", 0.02], segments: 10, material: style === "ledged" ? f.metal : "brushed_steel", repeat: { count: 3, step: [0, 0, 0] } }),
          ...body(style, f),
        ], { at: ["-$width / 2 + 0.003", "$gap", 0], rotate: [0, "$open", 0], material: f.leaf }),
      ], { vars: { gap: 0.014, lw: "$width - 0.006", lh: "$height - 0.017" } }),
    ],
  };
}

const ORDER: Style[] = ["panel", "flush", "glazed", "ledged"];

export const doorFamily: Family = {
  id: "door",
  category: "props",
  archetype: "prop.door",
  tags: ["door", "doors", "deur", "deuren", "doorway", "hinged door", "prop"],
  assets: () => ORDER.flatMap((style) => FINISHES[style].map((f) => door(style, f))),
};
