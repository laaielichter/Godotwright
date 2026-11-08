import { box, cyl, group, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { f } from "./parts.js";
import { beamAt, keelAt, sheerAt, shellSection, solidSection, type HullShape } from "./hull.js";

type Shape = "skiff" | "pram" | "sloep";

interface RowShape {
  name: string;
  text: string;
  hull: HullShape;
  length: [number, number, number];
  beam: [number, number, number];
  freeboard: [number, number, number];
  /** Thwarts as fractions along the boat; the rowing thwart is the first. */
  thwarts: number[];
  end: number;
}

const SHAPES: Record<Shape, RowShape> = {
  skiff: {
    name: "skiff", text: "a clinker-built skiff with a pointed bow, a small transom, three thwarts and a pair of oars in oarlocks",
    hull: { transom: 0.55, sheerRise: 0.45, stemRise: 1.0, vee: 0.4, round: true, stem: 0.1 }, length: [3.8, 3.4, 4.6], beam: [1.35, 1.2, 1.5], freeboard: [0.38, 0.32, 0.45], thwarts: [0.5, 0.78, 0.18], end: 0.9,
  },
  pram: {
    name: "pram dinghy", text: "a short pram dinghy with a blunt bow transom, two thwarts and a pair of oars in oarlocks",
    hull: { transom: 0.8, sheerRise: 0.3, stemRise: 0.55, vee: 0.2, round: true, stem: 0.52 }, length: [2.7, 2.5, 3.1], beam: [1.25, 1.15, 1.4], freeboard: [0.34, 0.3, 0.4], thwarts: [0.5, 0.15], end: 0.97,
  },
  sloep: {
    name: "double-ended sloep", text: "a long double-ended rowing sloep with a pointed bow and stern, four thwarts and a pair of long oars",
    hull: { transom: 0.32, sheerRise: 0.5, stemRise: 1.0, vee: 0.4, round: true, stem: 0.1 }, length: [4.8, 4.2, 5.4], beam: [1.55, 1.4, 1.75], freeboard: [0.42, 0.36, 0.5], thwarts: [0.55, 0.8, 0.32, 0.12], end: 0.9,
  },
};

const FINISHES: { name: string; nl: string; hull: MaterialDef; inner: MaterialDef; wood: boolean }[] = [
  { name: "varnished wood", nl: "gelakt hout", hull: { color: [0.3, 0.15, 0.06], metallic: 0, roughness: 0.3, texture: "wood" }, inner: { color: [0.36, 0.21, 0.09], metallic: 0, roughness: 0.4, texture: "wood" }, wood: true },
  { name: "white and green", nl: "wit groen", hull: { color: [0.62, 0.62, 0.58], metallic: 0, roughness: 0.35, texture: "painted" }, inner: { color: [0.035, 0.11, 0.06], metallic: 0, roughness: 0.5, texture: "painted" }, wood: false },
];

const zs = (s: number): string => `-$L2 + ${f(2 * s)} * $L2`;
const ysh = (h: HullShape, s: number): string => `${f(sheerAt(h, s))} * $fb`;
const xb = (h: HullShape, s: number, k = 1): string => `${f(beamAt(h, s) * k)} * $B2`;

function rowboat(shape: Shape, fi: number): AssetDraft {
  const S = SHAPES[shape];
  const F = FINISHES[fi]!;
  const h = S.hull;
  const kids: SpecNode[] = [];
  const shellS = [0, 0.03, 0.12, 0.25, 0.4, 0.55, 0.7, 0.8, S.end].filter((s) => s <= S.end);
  const hull: SpecNode[] = [
    loft("Shell", shellS.map((s) => shellSection(h, s, "0.022")), { material: "hull_paint" }),
  ];
  if (S.end < 0.96) hull.push(loft("Stem", [S.end - 0.004, 0.94, 0.98, 1].map((s) => solidSection(h, s)), { material: "hull_paint" }));
  // Planking lines (clinker laps) along the outside, and a gunwale rail.
  const lines = F.wood || shape === "skiff" ? [0.3, 0.55, 0.78] : [0.6];
  lines.forEach((t, i) => {
    const pts: Vec[] = [0.0, 0.1, 0.25, 0.45, 0.65, 0.8, 0.9, 0.97].map((s) => {
      const [kd, kf] = keelAt(h, s);
      const keel = `${f(kd)} * $d + ${f(kf)} * $fb`;
      const x = 0.99 - (1 - t) * 0.15;
      return [`${f(beamAt(h, s) * x)} * $B2 + 0.006`, `${keel} + (${ysh(h, s)} - (${keel})) * ${f(t)}`, zs(s)] as Vec;
    });
    hull.push(tube(`Lap${i + 1}_L`, pts, 0.008, { segments: 5, material: "hull_paint", mirror: `Lap${i + 1}_R` }));
  });
  hull.push(tube("Gunwale_L", [0, 0.08, 0.2, 0.4, 0.6, 0.78, 0.9, 0.97].map((s) => [`${xb(h, s)} - 0.004`, `${ysh(h, s)} + 0.008`, zs(s)] as Vec), 0.022, { segments: 8, material: "trim_wood", mirror: "Gunwale_R" }));
  hull.push(tube("Keel", [0.0, 0.2, 0.45, 0.65, 0.8, 0.9, 0.97, 1.0].map((s) => {
    const [kd, kf] = keelAt(h, s);
    return [0, `${f(kd)} * $d + ${f(kf)} * $fb - 0.01`, zs(s)] as Vec;
  }), 0.02, { segments: 6, material: "trim_wood" }));
  // Inside: a lining colour, ribs and floorboards.
  {
    const [kd, kf] = keelAt(h, 0.47);
    const keel = `${f(kd)} * $d + ${f(kf)} * $fb`;
    hull.push(box("Floorboards", [`${xb(h, 0.47, 1.15)} - 0.04`, 0.02, "$L2 * 0.85"], { at: [0, `${keel} + (${ysh(h, 0.47)} - (${keel})) * 0.12`, "-$L2 * 0.06"], material: "trim_wood" }));
  }
  for (const [i, s] of [0.2, 0.35, 0.5, 0.65, 0.78].entries()) {
    const [kd, kf] = keelAt(h, s);
    const keel = `${f(kd)} * $d + ${f(kf)} * $fb`;
    hull.push(tube(`Rib${i + 1}_L`, [[0.05, `${keel} + 0.03`, zs(s)], [`${xb(h, s, 0.72)}`, `${keel} + (${ysh(h, s)} - (${keel})) * 0.18`, zs(s)], [`${xb(h, s, 0.95)}`, `${ysh(h, s)} - 0.03`, zs(s)]], 0.012, { segments: 4, material: "rib_wood", mirror: `Rib${i + 1}_R` }));
  }
  kids.push(group("Hull", hull));

  // Thwarts across the boat.
  S.thwarts.forEach((s, i) => {
    const y = `${ysh(h, s)} - 0.17`;
    kids.push(group(`Seat_${i + 1}`, [
      box("Plank", [`${xb(h, s, 1.9)} - 0.03`, 0.03, 0.22], { bevel: 0.006 }),
      box("Knee_L", [0.03, 0.14, 0.05], { at: [`${xb(h, s, 0.93)} - 0.02`, 0.07, 0], material: "rib_wood", mirror: "Knee_R" }),
    ], { at: [0, y, zs(s)], material: "seat_wood" }));
  });
  if (shape === "skiff" || shape === "sloep") kids.push(box("SternSheets", [`${xb(h, 0.05, 1.7)}`, 0.03, 0.4], { at: [0, `${ysh(h, 0.05)} - 0.17`, zs(0.07)], bevel: 0.006, material: "seat_wood" }));

  // Oarlocks on the gunwale, aft of the rowing thwart, and the oars pivoting in them (handles inboard).
  const so = S.thwarts[0]! - 0.12;
  const xo = xb(h, so);
  const yo = ysh(h, so);
  kids.push(group("Oarlock_L", [
    box("Pad", [0.06, 0.04, 0.12], { at: [0, 0.01, 0], bevel: 0.008 }),
    tube("Horn", [[0, 0.02, -0.04], [0.0, 0.08, -0.045], [0, 0.1, 0], [0, 0.08, 0.045], [0, 0.02, 0.04]], 0.007, { segments: 6 }),
  ], { at: [xo, yo, zs(so)], material: "brass", mirror: "Oarlock_R" }));
  const out = "$oar - $inb";
  const bw = shape === "pram" ? 0.11 : 0.16;
  kids.push(group("Oar_L", [
    tube("Loom", [["-$inb", 0, 0], [`${out} - 0.5`, 0, 0]], 0.022, { segments: 10, material: "oar_wood" }),
    cyl("Grip", 0.019, 0.14, { axis: "x", at: ["-$inb + 0.07", 0, 0], segments: 10, material: "leather" }),
    cyl("Sleeve", 0.028, 0.16, { axis: "x", at: [0.02, 0, 0], segments: 10, material: "leather" }),
    cyl("Button", 0.036, 0.02, { axis: "x", at: [-0.07, 0, 0], segments: 10, material: "leather" }),
    loft("Blade", [
      { z: `${out} - 0.55`, superellipse: { width: 0.03, height: 0.04, n: 2.2, count: 16 } },
      { z: `${out} - 0.3`, superellipse: { width: bw, height: 0.025, n: 2.6, count: 16 } },
      { z: `${out} - 0.02`, superellipse: { width: bw, height: 0.02, n: 3, count: 16 } },
      { z: `${out}`, superellipse: { width: bw - 0.04, height: 0.016, n: 3, count: 16 } },
    ], { rotate: [0, 90, 0], material: F.wood ? "oar_wood" : "oar_tip" }),
  ], { at: [xo, `${yo} + 0.08`, zs(so)], mirror: "Oar_R" }));
  kids.push(cyl("PainterRing", 0.025, 0.012, { axis: "z", at: [0, `${ysh(h, S.end < 0.96 ? 1 : S.end)} - 0.06`, `${zs(S.end < 0.96 ? 1 : S.end)} + 0.01`], segments: 10, material: "brass" }));

  const dims = SHAPES[shape];
  return {
    slug: slugify("rowing-boat", shape, F.name),
    title: `${F.name.charAt(0).toUpperCase()}${F.name.slice(1)} ${dims.name}`,
    description: `A ${F.name} ${dims.name}: ${dims.text}. The oars pivot at their oarlocks on the gunwale (handles inboard); the boat floats on its waterline at y = 0, bow at +z.`,
    tags: [dims.name, shape, F.name, F.nl, "roeiboot", "rowing", "roeien", "oars", "riemen", shape === "sloep" ? "sloep" : shape === "pram" ? "praam" : "skiff"],
    params: [
      num("length", S.length[0], S.length[1], S.length[2], "Length over all in metres."),
      num("beam", S.beam[0], S.beam[1], S.beam[2], "Widest beam in metres."),
      num("freeboard", S.freeboard[0], S.freeboard[1], S.freeboard[2], "Height of the gunwale above the waterline at the stern, in metres."),
    ],
    materials: {
      hull_paint: F.hull,
      trim_wood: { color: [0.2, 0.1, 0.04], metallic: 0, roughness: 0.4, texture: "wood" },
      rib_wood: { color: [0.3, 0.17, 0.07], metallic: 0, roughness: 0.6, texture: "wood" },
      seat_wood: F.wood ? { color: [0.42, 0.27, 0.12], metallic: 0, roughness: 0.45, texture: "wood" } : { color: [0.035, 0.11, 0.06], metallic: 0, roughness: 0.5, texture: "painted" },
      oar_wood: { color: [0.45, 0.31, 0.15], metallic: 0, roughness: 0.55, texture: "wood" },
      oar_tip: F.wood ? { color: [0.34, 0.022, 0.02], metallic: 0, roughness: 0.4, texture: "painted" } : { color: [0.035, 0.11, 0.06], metallic: 0, roughness: 0.4, texture: "painted" },
      leather: { color: [0.22, 0.11, 0.045], metallic: 0, roughness: 0.6, texture: "leather" },
      ...mats("brass"),
    },
    nodes: [group("RowingBoat", kids, { vars: { L2: "$length / 2", B2: "$beam / 2", fb: "$freeboard", d: "0.1 + $beam * 0.04", oar: `min(2.9, $beam * ${shape === "pram" ? 1.2 : 1.6} + ${shape === "pram" ? 0.1 : 0.15})`, inb: `$beam * ${f(0.42 * beamAt(h, so))}` } })],
  };
}

export const rowingBoat: Family = {
  id: "rowing-boat",
  category: "vehicles",
  archetype: "vessel.boat.rowing-boat",
  tags: ["rowing boat", "rowboat", "roeiboot", "dinghy", "boat", "boot", "oars", "riemen"],
  assets: () => (Object.keys(SHAPES) as Shape[]).flatMap((sh) => [0, 1].map((fi) => rowboat(sh, fi))),
};
