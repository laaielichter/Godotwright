import { ellipsoid, group, int, lathe, loft, num, rng, slugify, tube, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import { mats } from "../../palette.js";
import { n4, natureMats } from "./common.js";

type Leaf = "feather" | "fan";

interface Style {
  name: string;
  dutch: string;
  leaf: Leaf;
  bark: string;
  /** [default, min, max] */
  height: [number, number, number];
  trunk: [number, number, number];
  frond: [number, number, number];
  fronds: [number, number, number];
  /** Lean of the trunk top as a share of the height (coconut only has it as a parameter). */
  lean?: [number, number, number];
  /** Ring bulge of the trunk (0.02 smooth, 0.15 knobbly leaf bases) and number of rings. */
  rings: number;
  ringCount: number;
  /** Feather fronds: width of each leaflet wing and how far the leaflets hang, in frond lengths; droop of the tip. */
  wing?: number;
  hang?: number;
  droop: number;
  /** Fronds tilt above (negative) or below the horizontal, degrees. */
  tilt: number;
  extra: "coconuts" | "dates" | "skirt" | "shaft";
  text: string;
}

const STYLES: Record<string, Style> = {
  coconut: { name: "coconut palm", dutch: "kokospalm", leaf: "feather", bark: "palm_bark", height: [10, 5, 20], trunk: [0.17, 0.12, 0.25], frond: [3.6, 2.4, 6], fronds: [18, 12, 20], lean: [0.14, 0, 0.3], rings: 0.07, ringCount: 24, wing: 0.16, hang: 0.85, droop: 0.42, tilt: -12, extra: "coconuts", text: "a slim, curving trunk ringed with leaf scars and swollen at the foot, a cluster of coconuts under a ring of long arching feather fronds" },
  date: { name: "date palm", dutch: "dadelpalm", leaf: "feather", bark: "palm_bark", height: [8, 4, 16], trunk: [0.28, 0.2, 0.4], frond: [3.2, 2.2, 5], fronds: [16, 12, 18], rings: 0.16, ringCount: 30, wing: 0.14, hang: 0.45, droop: 0.22, tilt: -28, extra: "dates", text: "a thick, straight trunk knobbly with old leaf bases, a dense, stiff crown of two rings of feather fronds and hanging bunches of dates" },
  fan: { name: "fan palm", dutch: "waaierpalm", leaf: "fan", bark: "palm_bark_grey", height: [11, 6, 22], trunk: [0.22, 0.15, 0.32], frond: [3.6, 2.4, 5.5], fronds: [18, 12, 20], rings: 0.04, ringCount: 26, droop: 0.25, tilt: -18, extra: "skirt", text: "a tall, straight grey trunk with a shaggy skirt of dead leaves under a round head of pleated fan leaves on long stalks" },
  royal: { name: "royal palm", dutch: "koningspalm", leaf: "feather", bark: "palm_bark_grey", height: [14, 7, 25], trunk: [0.24, 0.17, 0.32], frond: [4.4, 3, 6.5], fronds: [15, 12, 18], rings: 0.02, ringCount: 18, wing: 0.15, hang: 0.7, droop: 0.32, tilt: -22, extra: "shaft", text: "a smooth, pale grey column of a trunk, swelling a little half way, topped by a glossy green crownshaft and gracefully arching feather fronds" },
};

interface Variant {
  key: string;
  label: string;
  dutch: string;
  frond: string;
  /** Scales default height. */
  scale: number;
  /** Extra tilt (fronds held higher when negative). */
  tilt: number;
  dead: boolean;
}

const VARIANTS: Variant[] = [
  { key: "tropical", label: "tropical", dutch: "tropische", frond: "frond", scale: 1, tilt: 0, dead: false },
  { key: "dry", label: "sun-dried", dutch: "droge", frond: "palm_frond_light", scale: 1.1, tilt: 6, dead: true },
  { key: "young", label: "young", dutch: "jonge", frond: "palm_frond_blue", scale: 0.55, tilt: -12, dead: false },
];

/** A feather frond along +z from its pivot at the crown: a tapering rachis and two wings of hanging leaflets. */
function featherFrond(name: string, st: Style, material: string, tilt: string, count: string | number, phase: number, droopScale = 1): SpecNode {
  const us = [0, 0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.92, 1];
  const d = st.droop * droopScale;
  const y = (u: number): string => `$fl * ${n4(0.22 * u - (0.22 + d) * u * u)}`;
  const rachis = tube("Rachis", us.map((u): Vec => [0, y(u), `$fl * ${n4(u)}`]), us.map((u) => `$fl * ${n4(0.022 - 0.017 * u)}`), { segments: 6, material: "palm_rachis" });
  const wu = us.slice(1);
  const sections = wu.map((u) => {
    const w = (st.wing ?? 0.12) * Math.pow(Math.sin(Math.PI * Math.min(u, 0.97)), 0.6) + 0.012;
    const h = w * (st.hang ?? 0.6);
    return {
      z: `$fl * ${n4(u * 0.97)}`,
      points: [
        [`$fl * ${n4(w)}`, `${y(u)} - $fl * ${n4(h)}`],
        ["0", `${y(u)} + $fl * 0.006`],
        [`-$fl * ${n4(w)}`, `${y(u)} - $fl * ${n4(h)}`],
        ["0", `${y(u)} - $fl * ${n4(h + 0.008)}`],
      ],
    };
  });
  return group(name, [group("Arch", [rachis, loft("Pinnae", sections)], { vars: { fl: "$frondLength * (0.9 + 0.1 * sin($i * 1.3 + 0.4))" } })], {
    material,
    rotate: [tilt, `7 * sin($i * 1.9)`, 0],
    repeat: { count, around: "y", phase },
  });
}

/** A fan frond: a long stalk and a round, pleated, slightly cupped blade. */
function fanFrond(name: string, material: string, tilt: string, count: string | number, phase: number): SpecNode {
  // Pleat ribs fanning out from the stalk end across the round blade.
  const ribs: SpecNode[] = [];
  for (let k = 0; k < 9; k++) {
    const a = ((k - 4) / 4) * 1.25;
    ribs.push(tube(`Rib_${k + 1}`, [[0, "$fl * 0.02", 0], [`$fl * ${n4(Math.sin(a) * 0.47)}`, `$fl * ${n4(0.012 - 0.08 * (1 - Math.cos(a)))}`, `$fl * ${n4(Math.cos(a) * 0.47 - 0.02)}`]], ["$fl * 0.012", "$fl * 0.006"], { segments: 4 }));
  }
  return group(name, [group("Arch", [
    tube("Stalk", [[0, 0, 0], [0, "$fl * 0.04", "$fl * 0.3"], [0, "$fl * 0.03", "$fl * 0.56"]], ["$fl * 0.02", "$fl * 0.016", "$fl * 0.012"], { segments: 6, material: "palm_rachis" }),
    // The fan stands up from the end of its stalk, facing outward, so the head reads as a round ball of fans.
    group("Fan", [ellipsoid("Blade", ["$fl * 0.5", "$fl * 0.025", "$fl * 0.45"], { at: [0, 0, "$fl * 0.46"], segments: 18 }), ...ribs], { at: [0, "$fl * 0.03", "$fl * 0.52"], rotate: ["-40 - 15 * sin($i * 1.3)", 0, 0] }),
  ], { vars: { fl: "$frondLength * (0.92 + 0.08 * sin($i * 1.7))" } })], {
    material,
    rotate: [tilt, `9 * sin($i * 2.3)`, 0],
    repeat: { count, around: "y", phase },
  });
}

function palm(key: string, st: Style, v: Variant, index: number): AssetDraft {
  const r = rng(index * 4241 + 17);
  const phase = Math.round(r() * 30);
  const leanDefault = st.lean ? Math.round(st.lean[0] * (0.7 + r() * 0.6) * 100) / 100 : 0;
  const leanExpr = st.lean ? "$lean" : n4(0.01 + r() * 0.02);
  const sway = n4(r() * 0.4 - 0.2);
  // The ringed trunk: many points, the radius bulging at every ring.
  const N = st.ringCount;
  const path: Vec[] = [];
  const radii: string[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    path.push([`$height * ${leanExpr} * ${n4(t * t)}`, `$height * ${n4(t)}`, `$height * ${sway} * ${n4(t * t * (1 - t))}`]);
    const base = 1 + 0.5 * Math.exp(-t * 18) - 0.15 * t + (key === "royal" ? 0.12 * Math.sin(Math.PI * t) : 0);
    const bulge = k === 0 || k === N ? 1 : k % 2 === 0 ? 1 + st.rings : 1;
    radii.push(`$trunkRadius * ${n4(base * bulge)}`);
  }
  path[1] = ["0", `$height * ${n4(0.5 / N)}`, "0"];
  const trunk = tube("Trunk", path, radii, { segments: 12, material: st.bark });

  const tilt = st.tilt + v.tilt;
  const fronds: SpecNode[] = [];
  const crown: SpecNode[] = [];
  const extraMats: string[] = [];
  const t0 = `${tilt + 18} - 50 * (0.5 + 0.5 * sin($i * 2.4 + ${n4(r() * 3)}))`;
  if (st.leaf === "feather") fronds.push(featherFrond("Frond_{i}", st, v.frond, t0, "$fronds", phase));
  else fronds.push(fanFrond("Frond_{i}", v.frond, t0, "$fronds", phase));
  if (key === "date") fronds.push(featherFrond("FrondUpper_{i}", st, v.frond, `${tilt - 38} + 8 * sin($i * 1.7)`, 8, phase + 22, 0.6));
  else if (st.leaf === "feather") fronds.push(featherFrond("FrondUpper_{i}", st, v.frond, `${tilt - 30} + 8 * sin($i * 1.7)`, 6, phase + 30, 0.7));
  if (v.dead) {
    const dead = st.leaf === "feather" ? featherFrond("FrondDead_{i}", st, "dead_frond", "55 + 10 * sin($i * 2.2)", 4, phase + 45, 0.5) : fanFrond("FrondDead_{i}", "dead_frond", "62 + 8 * sin($i * 2.2)", 4, phase + 45);
    fronds.push(dead);
    extraMats.push("dead_frond");
  }

  let extraText = "";
  switch (st.extra) {
    case "coconuts":
      crown.push(lathe("Shaft", [["$trunkRadius * 1.05", "-$trunkRadius * 1.2"], ["$trunkRadius * 1.3", 0], ["$trunkRadius * 0.9", "$trunkRadius * 1.3"], ["$trunkRadius * 0.2", "$trunkRadius * 2"]], { segments: 12, material: "palm_rachis" }));
      crown.push(ellipsoid("Coconut_{i}", ["$trunkRadius * 0.62", "$trunkRadius * 0.7", "$trunkRadius * 0.62"], { at: ["$trunkRadius * 1.3", "-$trunkRadius * (0.3 + 0.4 * (($i * 3) % 2))", 0], segments: 10, material: "coconut", repeat: { count: 6, around: "y", phase: 15 } }));
      crown.push(group("Branches", [tube("Branch_{i}", [["$trunkRadius * 0.6", "$trunkRadius * 0.3", 0], ["$trunkRadius * 1.2", "$trunkRadius * 0.1", 0], ["$trunkRadius * 1.3", "-$trunkRadius * 0.2", 0]], "$trunkRadius * 0.08", { segments: 5, material: "palm_rachis", repeat: { count: 6, around: "y", phase: 15 } })]));
      extraMats.push("coconut");
      extraText = " Six coconuts hang under the crown.";
      break;
    case "dates":
      crown.push(lathe("Shaft", [["$trunkRadius * 1.1", "-$trunkRadius * 0.8"], ["$trunkRadius * 1.25", 0], ["$trunkRadius * 0.7", "$trunkRadius * 0.9"], ["$trunkRadius * 0.15", "$trunkRadius * 1.4"]], { segments: 12, material: st.bark }));
      crown.push(group("Bunch_{i}", [
        tube("Branch", [["$trunkRadius * 0.8", 0, 0], ["$trunkRadius * 1.6", "-$trunkRadius * 0.4", 0], ["$trunkRadius * 1.9", "-$trunkRadius * 1.6", 0]], "$trunkRadius * 0.06", { segments: 5, material: "palm_rachis" }),
        ellipsoid("Dates", ["$trunkRadius * 0.45", "$trunkRadius * 0.85", "$trunkRadius * 0.4"], { at: ["$trunkRadius * 1.9", "-$trunkRadius * 1.9", 0], segments: 10, lumps: 0.5, seed: 4, material: "date_fruit" }),
      ], { repeat: { count: 4, around: "y", phase: 30 } }));
      extraMats.push("date_fruit");
      extraText = " Four bunches of orange dates hang below the fronds.";
      break;
    case "skirt":
      crown.push(lathe("Skirt", [["$trunkRadius * 1.02", "-$frondLength * 0.9"], ["$trunkRadius * 1.7", "-$frondLength * 0.8"], ["$trunkRadius * 2.6", "-$frondLength * 0.35"], ["$trunkRadius * 2.4", "-$frondLength * 0.05"], ["$trunkRadius * 1.2", "$trunkRadius * 0.6"]], { segments: 14, material: "dead_frond" }));
      crown.push(group("Branches", [tube("Branch_{i}", [["$trunkRadius * 1.5", "-$trunkRadius * 0.2", 0], ["$frondLength * 0.5", "$trunkRadius * 0.5", 0], ["$frondLength * 0.85", "-$frondLength * 0.25", 0]], ["$trunkRadius * 0.12", "$trunkRadius * 0.08", "$trunkRadius * 0.04"], { segments: 5, material: "palm_rachis", repeat: { count: 3, around: "y", phase: 50 } })]));
      extraMats.push("dead_frond");
      extraText = " A skirt of dead leaves hangs under the head, and three long flower stalks arch out between the leaves.";
      break;
    case "shaft":
      crown.push(lathe("Shaft", [["$trunkRadius * 0.95", "-$trunkRadius * 7"], ["$trunkRadius * 1.15", "-$trunkRadius * 5"], ["$trunkRadius * 1.1", "-$trunkRadius * 1.5"], ["$trunkRadius * 0.7", "$trunkRadius * 0.3"], ["$trunkRadius * 0.15", "$trunkRadius * 1"]], { segments: 14, material: "crownshaft" }));
      crown.push(group("Branches", [tube("Branch_{i}", [["$trunkRadius * 0.9", "-$trunkRadius * 7.2", 0], ["$trunkRadius * 2", "-$trunkRadius * 7.8", 0], ["$trunkRadius * 2.6", "-$trunkRadius * 9.5", 0]], ["$trunkRadius * 0.12", "$trunkRadius * 0.09", "$trunkRadius * 0.05"], { segments: 5, material: "palm_rachis", repeat: { count: 4, around: "y", phase: 20 } })]));
      extraMats.push("crownshaft");
      extraText = " A glossy green crownshaft sits on top of the trunk.";
      break;
  }

  const height = Math.round(Math.min(st.height[2], Math.max(st.height[1], st.height[0] * v.scale)) * 100) / 100;
  const nFronds = Math.min(st.fronds[2], Math.max(st.fronds[1], st.fronds[0] + (v.key === "young" ? -2 : v.key === "dry" ? -1 : 0)));
  const frondLength = Math.round(Math.min(st.frond[2], Math.max(st.frond[1], st.frond[0] * (v.key === "young" ? 0.8 : 1))) * 100) / 100;
  const params = [
    num("height", height, st.height[1], st.height[2], "Height of the trunk to the crown in metres."),
    num("trunkRadius", st.trunk[0], st.trunk[1], st.trunk[2], "Trunk radius in metres (the foot is wider)."),
    num("frondLength", frondLength, st.frond[1], st.frond[2], "Length of a frond in metres."),
    int("fronds", nFronds, st.fronds[1], st.fronds[2], "Number of fronds in the main ring."),
  ];
  if (st.lean) params.push(num("lean", leanDefault, st.lean[1], st.lean[2], "How far the crown leans out, as a share of the height (0 is upright)."));
  const top: Vec = [`$height * ${leanExpr}`, "$height", "0"];
  const nodes: SpecNode[] = [
    group("Palm", [
      trunk,
      group("Crown", crown, { at: top }),
      group("Fronds", fronds, { at: [`$height * ${leanExpr}`, "$height + $trunkRadius * 0.9", "0"] }),
    ]),
  ];
  const frondMat = v.frond.replace("palm_frond_", "").replace("frond", "green");
  return {
    slug: slugify("palm", key, v.key),
    title: `${v.label.charAt(0).toUpperCase()}${v.label.slice(1)} ${st.name}`,
    description: `A ${v.label} ${st.name}: ${st.text}.${extraText}${v.dead ? " A few dead brown fronds hang down along the trunk." : ""} Every frond is its own node with its pivot at the crown. It stands on y = 0; the front faces +z.`,
    tags: [key, st.dutch, v.label, v.dutch, frondMat, st.leaf === "fan" ? "washingtonia" : "feather palm"],
    params,
    materials: natureMats(mats, st.bark, v.frond, "palm_rachis", ...extraMats),
    nodes,
  };
}

export const palmFamily: Family = {
  id: "palm",
  category: "nature",
  archetype: "plant.tree.palm",
  tags: ["palm", "palm tree", "palmboom", "tropical", "tropisch", "beach", "strand", "nature", "natuur"],
  assets: () => {
    const out: AssetDraft[] = [];
    let k = 0;
    for (const [key, st] of Object.entries(STYLES)) for (const v of VARIANTS) out.push(palm(key, st, v, k++));
    return out;
  },
};
