import { ellipsoid, group, int, lathe, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { lumpExtent, n4, natureMats } from "./common.js";

type CapShape = "dome" | "bun" | "bell" | "funnel" | "flat" | "button";

interface Shroom {
  key: string;
  title: string;
  dutch: string;
  cap: string;
  stem: string;
  gill: string;
  shape: CapShape;
  /** Cap height as a share of the cap radius. */
  capH: number;
  /** Stem radius as a share of the cap radius. */
  stemR: number;
  /** [default, min, max] in metres. */
  height: [number, number, number];
  radius: [number, number, number];
  spots?: string;
  skirt?: boolean;
  bulb?: number;
  cluster?: [number, number, number];
  text: string;
}

const SHROOMS: Shroom[] = [
  { key: "fly-agaric", title: "Fly agaric", dutch: "vliegenzwam", cap: "mushroom_red", stem: "stem_white", gill: "gill_cream", shape: "dome", capH: 0.5, stemR: 0.17, height: [0.18, 0.08, 0.3], radius: [0.07, 0.04, 0.12], spots: "spot_white", skirt: true, bulb: 1.6, text: "a fly agaric: a scarlet domed cap flecked with white warts, cream gills, and a white stem with a hanging ring and a bulbous foot" },
  { key: "fly-agaric-young", title: "Young fly agaric", dutch: "jonge vliegenzwam", cap: "mushroom_red", stem: "stem_white", gill: "gill_cream", shape: "button", capH: 0.85, stemR: 0.3, height: [0.09, 0.05, 0.15], radius: [0.045, 0.03, 0.07], spots: "spot_white", bulb: 1.4, text: "a young fly agaric still closed: a round red button covered in white warts on a stout white stem" },
  { key: "porcini", title: "Porcini", dutch: "eekhoorntjesbrood", cap: "mushroom_brown", stem: "stem_tan", gill: "pear_yellow", shape: "bun", capH: 0.6, stemR: 0.38, height: [0.14, 0.07, 0.25], radius: [0.08, 0.04, 0.13], bulb: 1.5, text: "a porcini (cep): a glossy, chestnut-brown bun of a cap over yellowish pores and a fat, club-shaped pale stem" },
  { key: "porcini-pair", title: "Porcini pair", dutch: "twee eekhoorntjesbrood", cap: "mushroom_brown", stem: "stem_tan", gill: "pear_yellow", shape: "bun", capH: 0.62, stemR: 0.4, height: [0.12, 0.07, 0.22], radius: [0.07, 0.04, 0.12], bulb: 1.5, cluster: [2, 2, 4], text: "a few porcini growing together: brown bun caps on fat, pale, club-shaped stems of different sizes" },
  { key: "honey-cluster", title: "Honey fungus cluster", dutch: "honingzwam", cap: "mushroom_yellow", stem: "stem_tan", gill: "gill_cream", shape: "flat", capH: 0.3, stemR: 0.14, height: [0.1, 0.05, 0.18], radius: [0.035, 0.02, 0.06], skirt: true, cluster: [9, 5, 14], text: "a tuft of honey fungus: many slim stems with small rings, carrying flat, honey-coloured caps, all from one spot" },
  { key: "chanterelle", title: "Chanterelle cluster", dutch: "cantharel", cap: "chanterelle", stem: "chanterelle", gill: "chanterelle", shape: "funnel", capH: 0.55, stemR: 0.28, height: [0.07, 0.04, 0.12], radius: [0.035, 0.02, 0.06], cluster: [6, 3, 10], text: "a group of golden chanterelles: wavy funnel-shaped caps flowing down into their stems" },
  { key: "ink-cap", title: "Shaggy ink caps", dutch: "geschubde inktzwam", cap: "ink_cap", stem: "stem_white", gill: "ink_black", shape: "bell", capH: 2.4, stemR: 0.22, height: [0.16, 0.08, 0.25], radius: [0.025, 0.015, 0.04], cluster: [5, 3, 8], text: "a clump of shaggy ink caps: tall, narrow, grey-white bells, their rims turning black, on slim white stems" },
  { key: "parasol", title: "Parasol mushroom", dutch: "grote parasolzwam", cap: "mushroom_cream", stem: "stem_tan", gill: "gill_cream", shape: "flat", capH: 0.22, stemR: 0.07, height: [0.3, 0.15, 0.4], radius: [0.12, 0.06, 0.18], spots: "mushroom_brown", skirt: true, bulb: 1.8, text: "a parasol mushroom: a wide, flat cream cap with brown scales and a central knob, high on a slender stem with a ring" },
  { key: "button-cluster", title: "Button mushrooms", dutch: "champignons", cap: "stem_white", stem: "stem_white", gill: "gill_dark", shape: "button", capH: 0.7, stemR: 0.4, height: [0.05, 0.03, 0.09], radius: [0.03, 0.02, 0.05], cluster: [7, 4, 12], text: "a cluster of plump white button mushrooms on short stems" },
  { key: "giant-red", title: "Giant fantasy toadstool", dutch: "reuzenpaddenstoel", cap: "mushroom_red", stem: "stem_white", gill: "gill_cream", shape: "dome", capH: 0.55, stemR: 0.24, height: [2.6, 1.2, 4.5], radius: [1.3, 0.6, 2], spots: "spot_white", skirt: true, bulb: 1.4, text: "a giant fairy-tale toadstool: a huge red domed cap with white spots on a thick, slightly bent white stem with a frilled ring" },
  { key: "giant-glow-blue", title: "Glowing blue giant mushroom", dutch: "lichtgevende paddenstoel", cap: "mushroom_blue", stem: "mushroom_glow", gill: "mushroom_glow", shape: "bell", capH: 0.9, stemR: 0.18, height: [3, 1.5, 5], radius: [1.2, 0.6, 2], spots: "mushroom_glow", cluster: [3, 2, 5], text: "a fantasy grove of giant bioluminescent mushrooms: tall bell caps in glowing blue with luminous green spots and stems" },
  { key: "giant-purple", title: "Giant purple fantasy mushroom", dutch: "paarse reuzenpaddenstoel", cap: "mushroom_purple", stem: "stem_white", gill: "mushroom_glow", shape: "funnel", capH: 0.45, stemR: 0.2, height: [2.2, 1, 4], radius: [1.1, 0.5, 1.8], bulb: 1.3, text: "a giant purple fantasy mushroom with a glowing, wavy funnel cap and a pale stem flaring at the foot" },
];

/** A cap profile from the stem out under the rim and over the top, in terms of $R (cap radius), $C (cap height), $sr. */
function capProfile(shape: CapShape): [string, string][] {
  const dome = (k: number): [string, string][] => [20, 40, 60, 78].map((a): [string, string] => [`$R * ${n4(Math.cos((a * Math.PI) / 180))}`, `$C * ${n4(Math.pow(Math.sin((a * Math.PI) / 180), k))}`]);
  switch (shape) {
    case "dome":
      return [["$sr * 1.05", "-$C * 0.05"], ["$R * 0.96", "-$C * 0.08"], ["$R", "$C * 0.02"], ...dome(1), ["$R * 0.04", "$C"]];
    case "bun":
      return [["$sr * 1.02", "-$C * 0.1"], ["$R * 0.95", "-$C * 0.05"], ["$R", "$C * 0.1"], ...dome(0.8), ["$R * 0.04", "$C"]];
    case "button":
      return [["$sr * 1.02", "-$C * 0.05"], ["$R * 0.9", "-$C * 0.02"], ["$R", "$C * 0.15"], ...dome(0.9), ["$R * 0.04", "$C"]];
    case "bell":
      return [["$sr * 1.05", "-$C * 0.35"], ["$R * 0.95", "-$C * 0.4"], ["$R", "-$C * 0.3"], ["$R * 0.98", "$C * 0.2"], ["$R * 0.85", "$C * 0.6"], ["$R * 0.55", "$C * 0.88"], ["$R * 0.04", "$C"]];
    case "funnel":
      return [["$sr * 1.02", "-$C * 0.5"], ["$R * 0.6", "$C * 0.35"], ["$R", "$C * 0.85"], ["$R * 0.97", "$C"], ["$R * 0.7", "$C * 0.8"], ["$R * 0.3", "$C * 0.62"], ["$R * 0.04", "$C * 0.58"]];
    case "flat":
      return [["$sr * 1.05", "-$C * 0.1"], ["$R * 0.96", "-$C * 0.05"], ["$R", "$C * 0.1"], ["$R * 0.8", "$C * 0.4"], ["$R * 0.3", "$C * 0.62"], ["$R * 0.15", "$C * 0.9"], ["$R * 0.04", "$C"]];
  }
}

/** One mushroom standing at the origin: stem from the ground to $H, cap on top. Uses $H, $R, $C, $sr. */
function mushroom(s: Shroom): SpecNode[] {
  const bulb = s.bulb ?? 1.1;
  const stem = lathe("Stem", [["$sr * " + n4(bulb * 0.8), 0], ["$sr * " + n4(bulb), "$H * 0.08"], ["$sr * " + n4(Math.max(1, bulb * 0.75)), "$H * 0.2"], ["$sr", "$H * 0.45"], ["$sr * 0.88", "$H * 0.9"], ["$sr * 0.92", "$H + $C * 0.05"]], { segments: 14, material: s.stem });
  const capLift = s.shape === "bell" ? "$H + $C * 0.3" : s.shape === "funnel" ? "$H + $C * 0.45" : "$H";
  const parts: SpecNode[] = [lathe("Cap", capProfile(s.shape), { at: [0, capLift, 0], segments: 20, material: s.cap })];
  if (s.shape !== "funnel") {
    const under = s.shape === "bell" ? "-$C * 0.33" : s.shape === "bun" ? "-$C * 0.06" : "-$C * 0.04";
    parts.push(lathe("Gills", [["$sr * 1.1", `${under} - $C * 0.02`], ["$R * 0.92", `${under} - $C * 0.03`], ["$R * 0.9", `${under} + $C * 0.02`], ["$sr * 1.2", `${under} + $C * 0.03`]], { at: [0, capLift, 0], segments: 20, material: s.gill }));
  }
  if (s.shape !== "funnel" && s.shape !== "button") {
    // Radial gill blades hanging under the cap, so the underside reads as real gills (or pores) from below.
    const under = s.shape === "bell" ? "-$C * 0.33" : s.shape === "bun" ? "-$C * 0.06" : "-$C * 0.04";
    parts.push(ellipsoid("GillRib_{i}", ["$R * 0.36", "$C * 0.08 + 0.002", "$R * 0.012 + 0.0015"], { at: ["$R * 0.56", `${capLift} + ${under} - $C * 0.04`, 0], segments: 6, material: s.gill === "pear_yellow" ? "gill_cream" : "gill_dark", repeat: { count: 30, around: "y", phase: 0 } }));
  }
  if (s.skirt) parts.push(lathe("Skirt", [["$sr * 0.95", "$H * 0.78"], ["$sr * 1.7", "$H * 0.7"], ["$sr * 1.75", "$H * 0.73"], ["$sr * 1.05", "$H * 0.84"]], { segments: 14, material: s.stem }));
  if (s.spots) {
    const ring = (name: string, a: number, count: number, phase: number, size: number): SpecNode => {
      const rad = (a * Math.PI) / 180;
      const y = s.shape === "bell" ? `$C * ${n4(0.2 + 0.6 * Math.sin(rad))}` : `$C * ${n4(Math.sin(rad))}`;
      const x = s.shape === "bell" ? `$R * ${n4(0.98 - 0.35 * Math.sin(rad) * Math.sin(rad))}` : `$R * ${n4(Math.cos(rad))}`;
      return ellipsoid(name, [`$R * ${n4(size)}`, `$R * ${n4(size * 0.4)}`, `$R * ${n4(size)}`], { at: [x, `${capLift} + ${y}`, 0], rotate: [0, 0, -(90 - a) * 0.9], segments: 8, lumps: 0.3, seed: 3, material: s.spots, repeat: { count, around: "y", phase } });
    };
    parts.push(group("Spots", [ring("Spot_{i}", 28, 9, 0, 0.09), ring("SpotHigh_{i}", 55, 6, 20, 0.08), ring("SpotTop_{i}", 76, 3, 40, 0.07)]));
  }
  return [stem, ...parts];
}

function asset(s: Shroom): AssetDraft {
  const vars = { H: "$height", R: "$capRadius", C: `$capRadius * ${n4(s.capH)}`, sr: `$capRadius * ${n4(s.stemR)}` };
  const params = [
    num("height", s.height[0], s.height[1], s.height[2], "Height of the stem to the underside of the cap, in metres."),
    num("capRadius", s.radius[0], s.radius[1], s.radius[2], "Radius of the cap in metres."),
  ];
  let nodes: SpecNode[];
  if (s.cluster) {
    params.push(int("count", s.cluster[0], s.cluster[1], s.cluster[2], "Number of mushrooms around the biggest one."));
    const spread = s.key.startsWith("giant") ? 1.05 : 1.5;
    const low = lumpExtent(16, 0.15, 21).low;
    nodes = [group("Cluster", [
      // The substrate the cluster grows from: a low mound of soil that joins every foot.
      ellipsoid("Mound", [`$capRadius * ${n4(spread + 0.5)}`, "$capRadius * 0.3", `$capRadius * ${n4(spread + 0.4)}`], { at: [0, `$capRadius * ${n4(0.3 * low)}`, 0], segments: 16, lumps: 0.15, seed: 21, material: "soil" }),
      group("Main", mushroom(s), { vars }),
      group("Shroom_{i}", [group("Body", mushroom(s), { vars: { H: "$height * (0.55 + 0.25 * sin($i * 2.3 + 1))", R: "$capRadius * (0.6 + 0.18 * sin($i * 1.7))", C: `$capRadius * (0.6 + 0.18 * sin($i * 1.7)) * ${n4(s.capH)}`, sr: `$capRadius * (0.6 + 0.18 * sin($i * 1.7)) * ${n4(s.stemR)}` } })], {
        at: [`$capRadius * ${n4(spread)}`, `$capRadius * ${n4(s.stemR * (s.bulb ?? 1.1) * 0.3)}`, 0],
        rotate: [0, 0, "-10 - 6 * sin($i * 2.9)"],
        repeat: { count: "$count", around: "y", phase: 25 },
      }),
    ])];
  } else nodes = [group("Mushroom", mushroom(s), { vars })];
  return {
    slug: slugify("mushroom", s.key),
    title: s.title,
    description: `${s.text.charAt(0).toUpperCase()}${s.text.slice(1)}. It stands on y = 0; the front faces +z.`,
    tags: [s.key.replace(/-/g, " "), s.dutch, ...(s.key.startsWith("giant") ? ["fantasy", "giant", "reus", "sprookje"] : ["forest floor", "bosgrond"]), ...(s.cluster ? ["cluster", "groep"] : [])],
    params,
    materials: natureMats(mats, s.cap, s.stem, s.gill, ...(s.spots ? [s.spots] : []), "gill_dark", "gill_cream", ...(s.cluster ? ["soil"] : [])),
    nodes,
  };
}

export const mushroomFamily: Family = {
  id: "mushroom",
  category: "nature",
  archetype: "plant.mushroom",
  tags: ["mushroom", "paddenstoel", "toadstool", "fungus", "zwam", "forest", "bos", "nature", "natuur"],
  assets: () => SHROOMS.map(asset),
};
