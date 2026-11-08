import { ellipsoid, group, int, num, rng, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { n4, natureMats } from "./common.js";

/** The shape of each species: trunk, fork, crown proportions and what else it carries. */
interface Species {
  name: string;
  dutch: string;
  bark: string;
  /** [default, min, max] in metres. */
  height: [number, number, number];
  crown: [number, number, number];
  trunk: [number, number, number];
  branches: [number, number, number];
  /** Fork height as a share of the height. */
  fork: number;
  /** Crown half-height / crown radius. */
  flat: number;
  /** How far out the limbs reach, as a share of the crown radius. */
  spread: number;
  /** Height of the limb ends in the crown, in crown half-heights from its centre. */
  lift: number;
  /** Radius of a leaf cluster, as a share of the crown radius. */
  cluster: number;
  lumps: number;
  extra: "low" | "tall" | "twin" | "round" | "weep" | "fruit";
  text: string;
}

const SPECIES: Record<string, Species> = {
  oak: { name: "oak", dutch: "eik", bark: "bark_dark", height: [14, 8, 25], crown: [6, 3.5, 10], trunk: [0.45, 0.25, 0.8], branches: [6, 4, 8], fork: 0.28, flat: 0.62, spread: 0.7, lift: -0.05, cluster: 0.42, lumps: 0.45, extra: "low", text: "a short, thick trunk forking low into wide, crooked limbs under a broad, flat-topped crown" },
  beech: { name: "beech", dutch: "beuk", bark: "bark_grey", height: [18, 10, 30], crown: [5, 3, 8], trunk: [0.35, 0.2, 0.6], branches: [5, 4, 7], fork: 0.36, flat: 1.0, spread: 0.52, lift: 0.1, cluster: 0.45, lumps: 0.35, extra: "tall", text: "a smooth grey trunk rising into steep limbs and a tall, oval, dense crown" },
  birch: { name: "birch", dutch: "berk", bark: "bark_birch", height: [13, 7, 22], crown: [2.6, 1.6, 4], trunk: [0.16, 0.09, 0.28], branches: [5, 3, 7], fork: 0.32, flat: 1.45, spread: 0.55, lift: 0.0, cluster: 0.38, lumps: 0.5, extra: "twin", text: "two slender white stems with an airy, narrow crown of small leaf clusters" },
  maple: { name: "maple", dutch: "esdoorn", bark: "bark_brown", height: [12, 7, 20], crown: [4.5, 2.5, 7], trunk: [0.3, 0.18, 0.5], branches: [6, 4, 8], fork: 0.3, flat: 0.88, spread: 0.6, lift: 0.05, cluster: 0.46, lumps: 0.4, extra: "round", text: "a straight trunk under a full, rounded crown of dense leaf clusters" },
  willow: { name: "willow", dutch: "wilg", bark: "bark_grey", height: [10, 6, 16], crown: [5, 3, 8], trunk: [0.4, 0.22, 0.65], branches: [6, 4, 8], fork: 0.32, flat: 0.68, spread: 0.68, lift: 0.0, cluster: 0.4, lumps: 0.4, extra: "weep", text: "a stout, leaning trunk and a domed crown from which long curtains of foliage weep almost to the ground" },
  fruit: { name: "fruit tree", dutch: "fruitboom", bark: "bark_brown", height: [5, 4, 8], crown: [2.6, 1.6, 4], trunk: [0.14, 0.08, 0.24], branches: [5, 3, 7], fork: 0.24, flat: 0.72, spread: 0.68, lift: 0.0, cluster: 0.44, lumps: 0.42, extra: "fruit", text: "a short orchard trunk with an open, low, wide crown" },
};

/** Season and age. Each species gets all five, with its own leaf colours. */
interface Variant {
  key: string;
  label: string;
  dutch: string;
  /** Main and sunlit leaf materials per species (default first). */
  leaves: Partial<Record<string, [string, string]>> & { default: [string, string] };
  /** Scales the default size; the ranges stay. */
  scale: number;
  /** Change to the default branch count. */
  more: number;
  seed: number;
  /** Fruit material for the fruit tree. */
  fruit?: string;
  fruitName?: string;
}

const VARIANTS: Variant[] = [
  { key: "summer", label: "summer", dutch: "zomer", leaves: { default: ["leaf_green", "leaf_light"] }, scale: 1, more: 0, seed: 11, fruit: "apple_red", fruitName: "red apples" },
  { key: "autumn", label: "autumn", dutch: "herfst", leaves: { default: ["leaf_autumn", "leaf_yellow"], maple: ["leaf_red", "leaf_autumn"], birch: ["leaf_yellow", "leaf_light"], beech: ["leaf_autumn", "leaf_red"], willow: ["leaf_yellow", "leaf_light"] }, scale: 1, more: 0, seed: 23, fruit: "pear_yellow", fruitName: "pears" },
  { key: "spring", label: "spring", dutch: "lente", leaves: { default: ["leaf_light", "leaf_green"], fruit: ["leaf_blossom", "leaf_light"] }, scale: 0.95, more: 0, seed: 37 },
  { key: "young", label: "young", dutch: "jonge", leaves: { default: ["leaf_light", "leaf_green"], beech: ["leaf_red", "leaf_autumn"], fruit: ["leaf_green", "leaf_light"] }, scale: 0.65, more: -1, seed: 41, fruit: "apple_green", fruitName: "green apples" },
  { key: "veteran", label: "veteran", dutch: "oude", leaves: { default: ["leaf_dark", "leaf_green"], fruit: ["leaf_dark", "leaf_green"] }, scale: 1.25, more: 1, seed: 59, fruit: "cherry_fruit", fruitName: "cherries" },
];

const clampRange = (v: number, r: [number, number, number]): number => Math.min(r[2], Math.max(r[1], Math.round(v * 100) / 100));

function tree(key: string, sp: Species, v: Variant, index: number): AssetDraft {
  const r = rng(index * 977 + v.seed);
  const j = (): number => r() * 2 - 1;
  const seedBase = Math.floor(r() * 5000);
  const [leaf, sun] = v.leaves[key] ?? v.leaves.default;
  const spread = sp.spread * (0.92 + r() * 0.16);
  const phase = Math.round(r() * 60);
  const s = n4(r() * 6);
  const vet = v.key === "veteran";

  // The trunk: flared at the foot, wandering a little, thinning into the crown centre.
  const trunkPath: [string, string, string][] = [
    ["0", "0", "0"],
    ["0", "$hf * 0.06", "0"],
    [`$tr * ${n4(j() * 0.7)}`, "$hf * 0.45", `$tr * ${n4(j() * 0.7)}`],
    [`$tr * ${n4(j() * 0.9)}`, "$hf", `$tr * ${n4(j() * 0.9)}`],
    [`$tr * ${n4(j() * 0.6)}`, "($hf + $yc) / 2", `$tr * ${n4(j() * 0.6)}`],
    ["0", "$yc + $ry * 0.2", "0"],
  ];
  if (sp.extra === "weep") trunkPath[3] = ["$tr * 1.4", "$hf", "$tr * 0.4"];
  const flares: SpecNode = tube("Flare_{i}", [["$tr * 0.45", "$tr * 1.3", 0], ["$tr * 1.2", "$tr * 0.5", 0], ["$tr * 2", "$tr * 0.2", 0]], ["$tr * 0.55", "$tr * 0.3", "$tr * 0.16"], {
    segments: 8,
    repeat: { count: vet ? 6 : 4, around: "y", phase },
  });
  const trunk = tube("Trunk", trunkPath, ["$tr * 1.45", "$tr * 1.12", "$tr", "$tr * 0.85", "$tr * 0.6", "$tr * 0.3"], { segments: 14, children: [flares] });

  // Limbs: one per crown cluster, each with a side twig; $i varies length, height and lift.
  const wob = (k: number, f: number): string => `sin($i * ${n4(f)} + ${s} + ${k})`;
  const endX = `$cr * ${n4(spread)} * (0.86 + 0.14 * ${wob(1, 1.7)})`;
  const endY = `$yc + $ry * (${n4(sp.lift)} + 0.18 * ${wob(2, 2.1)})`;
  const startY = `$hf + ($yc - $hf) * (0.05 + 0.2 * (0.5 + 0.5 * ${wob(3, 2.4)}))`;
  const limb = tube("Branch_{i}", [
    ["0", startY, "0"],
    [`$cr * ${n4(spread * 0.4)}`, `(${startY}) * 0.4 + (${endY}) * 0.6 - $ry * 0.1`, `$cr * 0.06`],
    [endX, endY, `-$cr * 0.05`],
  ], ["$tr * 0.5", "$tr * 0.32", "$tr * 0.14"], {
    segments: 9,
    repeat: { count: "$branches", around: "y", phase },
    children: [tube("Twig", [[`$cr * ${n4(spread * 0.4)}`, `(${startY}) * 0.4 + (${endY}) * 0.6 - $ry * 0.1`, `$cr * 0.06`], [`$cr * ${n4(spread * 0.62)}`, `$yc + $ry * 0.45`, `$cr * 0.3`]], ["$tr * 0.2", "$tr * 0.08"], { segments: 6 })],
  });
  const branchNodes: SpecNode[] = [limb];

  // The crown: a core, a cluster at each limb end, a sunlit ring above and the species' extras.
  const lump = sp.lumps;
  const crown: SpecNode[] = [
    ellipsoid("Core", ["$cr * 0.62", "$ry * 0.74", "$cr * 0.62"], { at: [0, "$yc", 0], segments: 20, lumps: lump, seed: seedBase }),
    ellipsoid("Cluster_{i}", [`$cr * ${n4(sp.cluster)}`, `$cr * ${n4(sp.cluster * 0.72)} * max(0.8, ${n4(sp.flat)})`, `$cr * ${n4(sp.cluster * 0.9)}`], {
      at: [endX, `${endY} + $ry * 0.12`, `-$cr * 0.05`],
      segments: 18,
      lumps: lump,
      seed: `$i * 13 + ${seedBase + 1}`,
      repeat: { count: "$branches", around: "y", phase },
    }),
    ellipsoid("Top_{i}", [`$cr * ${n4(sp.cluster * 0.85)}`, `$ry * 0.42`, `$cr * ${n4(sp.cluster * 0.8)}`], {
      at: [`$cr * 0.3`, `$yc + $ry * 0.5`, 0],
      segments: 16,
      lumps: lump,
      seed: `$i * 7 + ${seedBase + 2}`,
      material: sun,
      repeat: { count: 3, around: "y", phase: phase + 40 },
    }),
  ];
  const extraMats: string[] = [];
  let extraText = "";
  switch (sp.extra) {
    case "low":
      crown.push(ellipsoid("Under_{i}", [`$cr * 0.42`, `$ry * 0.3`, `$cr * 0.36`], { at: [`$cr * 0.62`, `$yc - $ry * 0.42`, 0], segments: 14, lumps: 0.4, seed: `$i * 5 + ${seedBase + 3}`, repeat: { count: 4, around: "y", phase: phase + 20 } }));
      extraText = " Low, heavy clusters hang under the crown edge.";
      break;
    case "tall":
      crown.push(ellipsoid("Spire", ["$cr * 0.45", "$ry * 0.5", "$cr * 0.42"], { at: [0, "$yc + $ry * 0.62", 0], segments: 16, lumps: 0.35, seed: seedBase + 4, material: sun }));
      break;
    case "twin": {
      const tx = n4(0.35 + r() * 0.15);
      branchNodes.push(tube("Trunk_B", [["$tr * 0.5", 0, "$tr * 0.2"], ["$tr * 1.2", "$hf * 0.5", "$tr * 0.5"], [`$cr * ${tx}`, "$yc * 0.82", "$cr * 0.25"], [`$cr * ${tx} * 1.1`, "$yc + $ry * 0.15", "$cr * 0.3"]], ["$tr * 0.8", "$tr * 0.66", "$tr * 0.42", "$tr * 0.22"], { segments: 10, material: sp.bark }));
      crown.push(ellipsoid("Cluster_Twin", ["$cr * 0.5", "$ry * 0.45", "$cr * 0.46"], { at: [`$cr * ${tx} * 1.1`, "$yc + $ry * 0.12", "$cr * 0.3"], segments: 16, lumps: 0.5, seed: seedBase + 5 }));
      extraText = " A second, leaning stem carries its own leaf cluster.";
      break;
    }
    case "round":
      crown.push(ellipsoid("Fill_{i}", [`$cr * 0.4`, `$ry * 0.38`, `$cr * 0.4`], { at: [`$cr * 0.5`, `$yc - $ry * 0.15`, 0], segments: 14, lumps: 0.35, seed: `$i * 3 + ${seedBase + 6}`, material: sun, repeat: { count: 5, around: "y", phase: phase + 36 } }));
      break;
    case "weep":
      crown.push(tube("Drape_{i}", [
        [`$cr * (0.7 + 0.08 * sin($i * 1.9 + ${s}))`, "$yc + $ry * 0.1", 0],
        [`$cr * (0.88 + 0.08 * sin($i * 1.9 + ${s}))`, "$yc - ($yc - $db) * 0.3", "$cr * 0.04"],
        [`$cr * (0.93 + 0.08 * sin($i * 1.9 + ${s}))`, `$db + ($yc - $db) * 0.12 * (0.5 + 0.5 * sin($i * 2.7))`, "$cr * 0.06"],
      ], ["$cr * 0.14", "$cr * 0.1", "$cr * 0.04"], { segments: 7, material: sun, repeat: { count: 22, around: "y", phase } }));
      extraText = " Twenty-two long drapes of leaves hang from the crown edge.";
      break;
    case "fruit":
      if (v.fruit) {
        crown.push(ellipsoid("Fruit_{i}", ["$cr * 0.035 + 0.02", "$cr * 0.035 + 0.02", "$cr * 0.035 + 0.02"], {
          at: [`$cr * (0.68 + 0.05 * sin($i * 2.3))`, `$yc - $ry * (0.08 - 0.25 * sin($i * 1.7 + ${s}))`, 0],
          segments: 8,
          material: v.fruit,
          repeat: { count: 12, around: "y", phase: phase + 7 },
        }));
        extraMats.push(v.fruit);
        extraText = ` Twelve ${v.fruitName} hang on the outside of the crown.`;
      } else extraText = " The crown is in full blossom.";
      break;
  }

  const height = clampRange(sp.height[0] * v.scale, sp.height);
  const crownR = clampRange(sp.crown[0] * (0.85 + 0.15 * v.scale) * (0.95 + r() * 0.1), sp.crown);
  const trunkR = clampRange(sp.trunk[0] * v.scale, sp.trunk);
  const branches = Math.min(sp.branches[2], Math.max(sp.branches[1], sp.branches[0] + v.more));
  const flat = sp.flat;

  const nodes: SpecNode[] = [
    group("Tree", [trunk, group("Branches", branchNodes), group("Crown", crown, { material: leaf })], {
      material: sp.bark,
      vars: {
        cr: "$crownRadius",
        tr: "$trunkRadius",
        ry: `min($crownRadius * ${n4(flat)}, $height * 0.42)`,
        yc: "$height - $ry",
        hf: `min($height * ${n4(sp.fork)}, $yc - $ry * 0.35)`,
        db: "max($height * 0.14, 0.8)",
      },
    }),
  ];
  const title = `${v.label.charAt(0).toUpperCase()}${v.label.slice(1)} ${sp.name}`;
  return {
    slug: slugify("broadleaf-tree", sp.name, v.key),
    title,
    description: `A ${v.label} ${sp.name}: ${sp.text}, its limbs ending in lumpy ${leaf.replace("leaf_", "")} leaf clusters around a core, with a sunlit ${sun.replace("leaf_", "")} top.${extraText} It stands on y = 0; the front faces +z.`,
    tags: [sp.name, sp.dutch, v.label, v.dutch, leaf.replace("leaf_", ""), ...(sp.extra === "fruit" ? ["apple tree", "appelboom", "orchard", "boomgaard"] : []), ...(v.key === "spring" && sp.extra === "fruit" ? ["blossom", "bloesem"] : [])],
    params: [
      num("height", height, sp.height[1], sp.height[2], "Total height of the tree in metres."),
      num("crownRadius", crownR, sp.crown[1], sp.crown[2], "Radius of the crown in metres."),
      num("trunkRadius", trunkR, sp.trunk[1], sp.trunk[2], "Trunk radius at the fork in metres (the foot flares wider)."),
      int("branches", branches, sp.branches[1], sp.branches[2], "Number of main limbs, each with a leaf cluster."),
    ],
    materials: { ...mats(sp.bark, leaf, sun), ...natureMats(mats, ...extraMats) },
    nodes,
  };
}

export const broadleafTree: Family = {
  id: "broadleaf-tree",
  category: "nature",
  archetype: "plant.tree.broadleaf",
  tags: ["tree", "boom", "broadleaf", "deciduous", "loofboom", "nature", "natuur", "forest", "bos", "park"],
  assets: () => {
    const out: AssetDraft[] = [];
    let k = 0;
    for (const [key, sp] of Object.entries(SPECIES)) for (const v of VARIANTS) out.push(tree(key, sp, v, k++));
    return out;
  },
};

