import { box, cyl, group, lathe, loft, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { useMats } from "./common.js";

type Kind = "round" | "tri-up" | "tri-down" | "square" | "diamond" | "octagon";

/** Segments and turn (degrees about z) of the cylinder that makes each plate outline. */
const OUTLINE: Record<Kind, { n: number; rot: number; r: string; top: string }> = {
  round: { n: 40, rot: 0, r: "$size / 2", top: "$size / 2" },
  "tri-up": { n: 3, rot: 90, r: "$size / sqrt(3)", top: "$size / sqrt(3)" },
  "tri-down": { n: 3, rot: -90, r: "$size / sqrt(3)", top: "$size / sqrt(3) / 2" },
  square: { n: 4, rot: 45, r: "$size / sqrt(2)", top: "$size / 2" },
  diamond: { n: 4, rot: 0, r: "$size * 0.62", top: "$size * 0.62" },
  octagon: { n: 8, rot: 22.5, r: "$size / 2 / cos(rad(22.5))", top: "$size / 2" },
};

/** Layers in front of the pole: backing, border, face, symbols. */
const Z = { back: 0.003, border: 0.008, face: 0.011, sym: 0.0145 };

const outline = (name: string, kind: Kind, r: string, z: number, t: number, material: string): SpecNode => {
  const o = OUTLINE[kind];
  return cyl(name, r, t, { axis: "z", segments: o.n, at: [0, 0, z], rotate: [0, 0, o.rot], material });
};

/** A flat symbol bar on the face, in plate coordinates scaled by $size. */
const bar = (name: string, w: number, h: number, x: number, y: number, material: string, rot = 0): SpecNode =>
  box(name, [`$size * ${w}`, `$size * ${h}`, 0.003], { at: [`$size * ${x}`, `$size * ${y}`, Z.sym], rotate: [0, 0, rot], material });

/** A small symbol triangle (an arrow head), pointing up before `rot`. */
const head = (name: string, r: number, x: number, y: number, material: string, rot = 0): SpecNode =>
  cyl(name, `$size * ${r}`, 0.003, { axis: "z", segments: 3, at: [`$size * ${x}`, `$size * ${y}`, Z.sym], rotate: [0, 0, 90 + rot], material });

interface Sign {
  id: string;
  title: string;
  text: string;
  kind: Kind;
  border: string;
  face: string;
  /** Border width as a share of $size. */
  bw: number;
  symbols: SpecNode[];
  tags: string[];
}

const SIGNS: Sign[] = [
  { id: "no-entry", title: "No entry sign", text: "a red disc with a white horizontal bar and a thin white rim", kind: "round", border: "paint_white", face: "paint_red", bw: 0.03, symbols: [bar("Bar", 0.62, 0.15, 0, 0, "paint_white")], tags: ["no entry", "verboden in te rijden", "eenrichtingsverkeer"] },
  { id: "closed-to-vehicles", title: "Closed to all vehicles sign", text: "a white disc inside a broad red ring", kind: "round", border: "paint_red", face: "paint_white", bw: 0.11, symbols: [], tags: ["closed", "gesloten", "verboden voor voertuigen"] },
  { id: "no-parking", title: "No parking sign", text: "a blue disc in a red ring, crossed by one red diagonal", kind: "round", border: "paint_red", face: "paint_blue", bw: 0.1, symbols: [bar("Slash", 0.78, 0.1, 0, 0, "paint_red", 45)], tags: ["no parking", "parkeerverbod", "niet parkeren"] },
  { id: "no-stopping", title: "No stopping sign", text: "a blue disc in a red ring, crossed by a red X", kind: "round", border: "paint_red", face: "paint_blue", bw: 0.1, symbols: [bar("Slash_A", 0.78, 0.1, 0, 0, "paint_red", 45), bar("Slash_B", 0.78, 0.1, 0, 0, "paint_red", -45)], tags: ["no stopping", "stopverbod"] },
  { id: "ahead-only", title: "Ahead only sign", text: "a blue disc with a white rim and a white arrow pointing up", kind: "round", border: "paint_white", face: "paint_blue", bw: 0.03, symbols: [bar("Shaft", 0.12, 0.42, 0, -0.1, "paint_white"), head("Arrowhead", 0.17, 0, 0.17, "paint_white")], tags: ["ahead only", "rechtdoor", "gebodsbord"] },
  { id: "keep-right", title: "Keep right sign", text: "a blue disc with a white rim and a white arrow pointing down to the right", kind: "round", border: "paint_white", face: "paint_blue", bw: 0.03, symbols: [bar("Shaft", 0.12, 0.42, -0.05, 0.05, "paint_white", 45), head("Arrowhead", 0.17, 0.12, -0.12, "paint_white", -135)], tags: ["keep right", "rechts aanhouden", "gebodsbord"] },
  { id: "end-of-restrictions", title: "End of restrictions sign", text: "a white disc with a thin black rim crossed by three grey diagonal stripes", kind: "round", border: "paint_black", face: "paint_white", bw: 0.02, symbols: [bar("Stripe_1", 0.72, 0.035, -0.06, -0.06, "paint_grey", 45), bar("Stripe_2", 0.86, 0.035, 0, 0, "paint_grey", 45), bar("Stripe_3", 0.72, 0.035, 0.06, 0.06, "paint_grey", 45)], tags: ["end of restrictions", "einde verbod"] },
  { id: "danger", title: "General danger sign", text: "a white triangle in a red border pointing up, with a black exclamation mark", kind: "tri-up", border: "paint_red", face: "paint_white", bw: 0.08, symbols: [bar("Mark", 0.07, 0.3, 0, 0.04, "paint_black"), cyl("Dot", "$size * 0.045", 0.003, { axis: "z", segments: 16, at: [0, "$size * -0.17", Z.sym], material: "paint_black" })], tags: ["warning", "danger", "gevaar", "waarschuwing", "driehoek"] },
  { id: "give-way", title: "Give way sign", text: "a white triangle in a red border pointing down", kind: "tri-down", border: "paint_red", face: "paint_white", bw: 0.08, symbols: [], tags: ["give way", "yield", "voorrang verlenen", "haaientanden"] },
  { id: "temporary-warning", title: "Temporary warning sign", text: "a yellow triangle in a red border pointing up, with a black exclamation mark", kind: "tri-up", border: "paint_red", face: "paint_yellow", bw: 0.08, symbols: [bar("Mark", 0.07, 0.3, 0, 0.04, "paint_black"), cyl("Dot", "$size * 0.045", 0.003, { axis: "z", segments: 16, at: [0, "$size * -0.17", Z.sym], material: "paint_black" })], tags: ["roadworks", "werk in uitvoering", "tijdelijk", "geel"] },
  { id: "priority-road", title: "Priority road sign", text: "a yellow diamond in a white border with a thin black edge line", kind: "diamond", border: "paint_white", face: "paint_yellow", bw: 0.1, symbols: [], tags: ["priority road", "voorrangsweg", "ruit"] },
  { id: "stop", title: "Stop sign", text: "a red octagon in a white border with a white four-letter legend", kind: "octagon", border: "paint_white", face: "paint_red", bw: 0.035, symbols: [bar("Letter_1", 0.12, 0.24, -0.27, 0, "paint_white"), bar("Letter_2", 0.12, 0.24, -0.09, 0, "paint_white"), bar("Letter_3", 0.12, 0.24, 0.09, 0, "paint_white"), bar("Letter_4", 0.12, 0.24, 0.27, 0, "paint_white")], tags: ["stop", "stopbord", "achthoek"] },
  { id: "parking", title: "Parking sign", text: "a blue square in a white border with a white letter P", kind: "square", border: "paint_white", face: "paint_blue", bw: 0.04, symbols: [bar("Stem", 0.1, 0.56, -0.12, 0, "paint_white"), bar("Bowl_T", 0.3, 0.09, 0, 0.235, "paint_white"), bar("Bowl_M", 0.3, 0.09, 0, 0.0, "paint_white"), bar("Bowl_R", 0.09, 0.32, 0.13, 0.115, "paint_white")], tags: ["parking", "parkeren", "parkeerplaats", "p"] },
  { id: "pedestrian-crossing", title: "Pedestrian crossing sign", text: "a blue square in a white border holding a white triangle with black zebra stripes", kind: "square", border: "paint_white", face: "paint_blue", bw: 0.04, symbols: [head("Triangle", 0.4, 0, 0.03, "paint_white"), box("Zebra_{i}", ["$size * 0.05", "$size * 0.12", 0.003], { at: ["$size * -0.12", "$size * -0.08", Z.sym + 0.002], repeat: { count: 4, step: ["$size * 0.08", 0, 0] }, material: "paint_black" })], tags: ["pedestrian crossing", "zebrapad", "oversteekplaats"] },
  { id: "dead-end", title: "Dead end sign", text: "a blue square in a white border with a white upright closed off by a red bar", kind: "square", border: "paint_white", face: "paint_blue", bw: 0.04, symbols: [bar("Stem", 0.16, 0.5, 0, -0.08, "paint_white"), bar("Cross", 0.46, 0.13, 0, 0.22, "paint_red")], tags: ["dead end", "doodlopende weg", "no through road"] },
];

function pole(top: string, clamps: string[]): SpecNode {
  return group("Pole", [
    cyl("Shaft", 0.03, top, { anchor: "base", segments: 16 }),
    lathe("Cap", [[0.032, `${top} - 0.01`], [0.032, top], [0.02, `${top} + 0.015`], [0.005, `${top} + 0.02`]], { segments: 16, material: "plastic_black" }),
    lathe("Collar", [[0.05, 0], [0.05, 0.03], [0.034, 0.06], [0.031, 0.08]], { segments: 16 }),
    ...clamps.map((y, i) =>
      group(`Clamp_${i + 1}`, [
        cyl("Ring", 0.037, 0.04, { segments: 16, material: "steel" }),
        box("Tab", [0.05, 0.03, 0.05], { at: [0, 0, 0.03], bevel: 0.004, material: "steel" }),
      ], { at: [0, y, 0] })),
  ]);
}

function shapedSign(s: Sign): AssetDraft {
  const o = OUTLINE[s.kind];
  const inset = `${o.r} - $size * ${s.bw} / cos(pi / ${o.n})`;
  const plate = group("Plate", [
    outline("Backing", s.kind, o.r, Z.back, 0.006, "sign_grey"),
    outline("Border", s.kind, `${o.r} - 0.002`, Z.border, 0.004, s.border),
    outline("Face", s.kind, inset, Z.face, 0.004, s.face),
    ...s.symbols,
  ], { at: [0, "$height", 0.052] });
  const half = s.kind === "tri-up" ? `${o.r} * 0.5` : o.top;
  return {
    slug: slugify("traffic-sign", s.id),
    title: s.title,
    description: `A traffic sign on a galvanised pole: ${s.text}, as separate border, face and symbol layers on an aluminium backing. The sign faces +z.`,
    tags: [...s.tags, s.kind.replace("tri-", "triangle-")],
    params: [num("height", 2.2, 1.6, 2.8, "Height of the plate centre above the ground in metres."), num("size", 0.65, 0.4, 0.9, "Width of the plate in metres.")],
    materials: useMats("galvanised", "steel", "plastic_black", "sign_grey", s.border, s.face, "paint_white", "paint_black", "paint_red", "paint_grey"),
    nodes: [group("TrafficSign", [pole(`$height + ${o.top} + 0.02`, [`$height + ${half} * 0.55`, `$height - ${half} * 0.55`]), plate], { material: "galvanised" })],
  };
}

/** An arrow-shaped plate pointing along +x (dir 1) or -x (dir -1), from x0 to the tip. */
function arrowPlate(name: string, dir: 1 | -1, y: string, face: string, border: string): SpecNode {
  const d = (v: string): string => (dir === 1 ? v : `-(${v})`);
  const pts = (x0: string, x1: string, h: string, tipIn: string): [string, string][] => {
    const p: [string, string][] = [[d(x0), `-${h}`], [d(x1), `-${h}`], [d(`${x1} + ${tipIn}`), "0"], [d(x1), h], [d(x0), h]];
    return dir === 1 ? p : p.reverse();
  };
  const slab = (n: string, x0: string, x1: string, h: string, tip: string, z0: number, z1: number, material: string): SpecNode =>
    loft(n, [{ z: z0, points: pts(x0, x1, h, tip) }, { z: z1, points: pts(x0, x1, h, tip) }], { material });
  const bw = 0.025;
  return group(name, [
    slab("Backing", "0.02", "$armLength - $ph", "$ph", "$ph", 0, 0.006, "sign_grey"),
    slab("Border", "0.022", "$armLength - $ph", "$ph - 0.002", "$ph - 0.002", 0.006, 0.01, border),
    slab("Face", `0.02 + ${bw}`, `$armLength - $ph + ${bw} - ${bw} * sqrt(2)`, `$ph - ${bw}`, `$ph - ${bw}`, 0.009, 0.013, face),
    box("Legend_1", ["($armLength - $ph) * 0.62", "$ph * 0.22", 0.003], { at: [d("($armLength - $ph) * 0.45"), "$ph * 0.28", 0.0145], material: border }),
    box("Legend_2", ["($armLength - $ph) * 0.42", "$ph * 0.22", 0.003], { at: [d("($armLength - $ph) * 0.35"), "-$ph * 0.28", 0.0145], material: border }),
    group("Strap", [cyl("Ring", 0.037, 0.06, { segments: 16, material: "steel" }), box("Tab", [0.05, 0.05, 0.06], { at: [d("0.03"), 0, 0], bevel: 0.004, material: "steel" })], { at: [0, 0, -0.0] }),
  ], { at: [0, y, 0] });
}

function directionSign(id: "single" | "double" | "triple", face: string, border: string, colourName: string): AssetDraft {
  const arms: SpecNode[] = id === "single"
    ? [arrowPlate("Plate", 1, "$height", face, border)]
    : id === "double"
      ? [arrowPlate("Plate_1", 1, "$height", face, border), arrowPlate("Plate_2", -1, "$height - 2.4 * $ph", face, border)]
      : [arrowPlate("Plate_1", 1, "$height", face, border), arrowPlate("Plate_2", -1, "$height - 2.4 * $ph", face, border), arrowPlate("Plate_3", 1, "$height - 4.8 * $ph", face, border)];
  const count = { single: "one arrow plate pointing to +x", double: "two arrow plates, the upper pointing to +x and the lower to -x", triple: "three arrow plates pointing alternately to +x and -x" }[id];
  return {
    slug: slugify("traffic-sign", "direction", id, colourName),
    title: `${colourName.charAt(0).toUpperCase()}${colourName.slice(1)} direction sign, ${id === "single" ? "one arm" : id === "double" ? "two arms" : "three arms"}`,
    description: `A fingerpost direction sign on a galvanised pole with ${count}, each a ${colourName} face in a border on an aluminium backing with two legend lines. The faces look along +z.`,
    tags: ["direction", "richting", "wegwijzer", "fingerpost", "handwijzer", "arrow", "pijl", colourName],
    params: [num("height", 2.4, 2.0, 3.0, "Height of the top arm in metres."), num("armLength", 1.0, 0.6, 1.4, "Length of each arrow plate in metres."), num("ph", 0.12, 0.09, 0.16, "Half the height of each arrow plate in metres.")],
    materials: useMats("galvanised", "steel", "plastic_black", "sign_grey", face, border),
    nodes: [group("TrafficSign", [pole("$height + $ph + 0.05", []), ...arms], { material: "galvanised" })],
  };
}

function streetName(): AssetDraft {
  return {
    slug: slugify("traffic-sign", "street-name"),
    title: "Street name sign",
    description: "A wide rectangular street name sign on a galvanised pole: a blue face in a white border on an aluminium backing, with white legend lines and two clamps. It faces +z.",
    tags: ["street name", "straatnaambord", "straatnaam", "rectangle", "blauw"],
    params: [num("height", 2.4, 2.0, 2.8, "Height of the plate centre in metres."), num("width", 0.9, 0.5, 1.4, "Width of the plate along x in metres."), num("plateHeight", 0.22, 0.15, 0.32, "Height of the plate in metres.")],
    materials: useMats("galvanised", "steel", "plastic_black", "sign_grey", "paint_blue", "paint_white"),
    nodes: [group("TrafficSign", [
      pole("$height + $plateHeight / 2 + 0.03", ["$height + $plateHeight * 0.25", "$height - $plateHeight * 0.25"]),
      group("Plate", [
        box("Backing", ["$width", "$plateHeight", 0.006], { at: [0, 0, Z.back], bevel: 0.002, material: "sign_grey" }),
        box("Border", ["$width - 0.004", "$plateHeight - 0.004", 0.004], { at: [0, 0, Z.border], material: "paint_white" }),
        box("Face", ["$width - 0.03", "$plateHeight - 0.03", 0.004], { at: [0, 0, Z.face], material: "paint_blue" }),
        box("Legend_1", ["$width * 0.7", "$plateHeight * 0.32", 0.003], { at: [0, "$plateHeight * 0.08", Z.sym], material: "paint_white" }),
        box("Legend_2", ["$width * 0.3", "$plateHeight * 0.14", 0.003], { at: [0, "-$plateHeight * 0.26", Z.sym], material: "paint_white" }),
      ], { at: [0, "$height", 0.052] }),
    ], { material: "galvanised" })],
  };
}

export const trafficSign: Family = {
  id: "traffic-sign",
  category: "street",
  archetype: "infrastructure.traffic-sign",
  tags: ["traffic sign", "road sign", "sign", "verkeersbord", "bord", "verkeersteken", "street sign"],
  assets: () => [
    ...SIGNS.map(shapedSign),
    directionSign("single", "paint_white", "paint_black", "white"),
    directionSign("double", "paint_blue", "paint_white", "blue"),
    streetName(),
  ],
};
