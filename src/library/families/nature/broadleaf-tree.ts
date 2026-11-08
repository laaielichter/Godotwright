import { ellipsoid, group, int, num, rng, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { n4, natureMats } from "./common.js";

/** The shape of each species: trunk, fork, limbs and crown silhouette. */
interface Species {
  name: string;
  dutch: string;
  bark: string;
  /** [default, min, max] in metres; the trunk radius is about 1/30 of the height. */
  height: [number, number, number];
  crown: [number, number, number];
  trunk: [number, number, number];
  limbs: [number, number, number];
  /** Fork height as a share of the height. */
  fork: number;
  /** Crown half-height / crown radius. */
  flat: number;
  /** Reach of the limbs as a share of the crown radius, and how much it varies from limb to limb. */
  spread: number;
  vary: number;
  /** Height of the limb ends, in crown half-heights from the crown centre. */
  lift: number;
  /** Leaf cluster radius as a share of the crown radius, and its height / width. */
  cluster: number;
  squash: number;
  lumps: number;
  extra: "low" | "dome" | "airy" | "round" | "weep" | "fruit";
  text: string;
}

const SPECIES: Record<string, Species> = {
  oak: { name: "oak", dutch: "eik", bark: "bark_dark", height: [14, 8, 25], crown: [6.5, 3.5, 10], trunk: [0.48, 0.28, 0.85], limbs: [5, 3, 6], fork: 0.3, flat: 0.6, spread: 0.82, vary: 0.3, lift: -0.15, cluster: 0.36, squash: 0.68, lumps: 0.45, extra: "low", text: "a short, thick, flared trunk forking low into wide, crooked limbs that carry an irregular, broad, flat-topped crown of leaf clusters" },
  beech: { name: "beech", dutch: "beuk", bark: "bark_grey", height: [18, 10, 30], crown: [7, 3.5, 10], trunk: [0.6, 0.3, 0.9], limbs: [5, 4, 6], fork: 0.36, flat: 0.85, spread: 0.66, vary: 0.15, lift: 0.0, cluster: 0.38, squash: 0.8, lumps: 0.35, extra: "dome", text: "a smooth grey, flared trunk splitting into steep limbs under a tall, dense dome of leaf clusters" },
  birch: { name: "birch", dutch: "berk", bark: "bark_birch", height: [13, 7, 22], crown: [2.8, 1.6, 4], trunk: [0.25, 0.12, 0.4], limbs: [4, 3, 5], fork: 0.38, flat: 1.5, spread: 0.55, vary: 0.2, lift: 0.0, cluster: 0.36, squash: 0.95, lumps: 0.5, extra: "airy", text: "a slender white stem running right up through a narrow, airy crown of small leaf clusters on thin, rising limbs, with a second leaning stem" },
  maple: { name: "maple", dutch: "esdoorn", bark: "bark_brown", height: [12, 7, 20], crown: [4.8, 2.5, 7], trunk: [0.4, 0.22, 0.7], limbs: [5, 4, 6], fork: 0.32, flat: 0.85, spread: 0.66, vary: 0.12, lift: -0.05, cluster: 0.44, squash: 0.78, lumps: 0.4, extra: "round", text: "a straight, flared trunk forking into evenly spread limbs under a full, rounded crown" },
  willow: { name: "willow", dutch: "wilg", bark: "bark_grey", height: [10, 6, 16], crown: [5, 3, 8], trunk: [0.45, 0.25, 0.8], limbs: [5, 4, 6], fork: 0.32, flat: 0.62, spread: 0.72, vary: 0.15, lift: 0.0, cluster: 0.38, squash: 0.7, lumps: 0.4, extra: "weep", text: "a stout, leaning trunk with arching limbs and a domed crown from which long curtains of foliage weep almost to the ground" },
  fruit: { name: "fruit tree", dutch: "fruitboom", bark: "bark_brown", height: [5, 4, 8], crown: [2.6, 1.6, 4], trunk: [0.15, 0.08, 0.28], limbs: [4, 3, 5], fork: 0.26, flat: 0.72, spread: 0.75, vary: 0.2, lift: -0.05, cluster: 0.42, squash: 0.75, lumps: 0.42, extra: "fruit", text: "a short orchard trunk opening into a low goblet of limbs with a wide, open crown" },
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

/** The shaded tone under each leaf colour, and the light tip tone over each sunlit colour. */
const SHADE: Record<string, string> = { leaf_green: "leaf_shade", leaf_light: "leaf_dark", leaf_dark: "leaf_shade", leaf_autumn: "leaf_autumn_dark", leaf_red: "leaf_red_dark", leaf_yellow: "leaf_autumn", leaf_blossom: "leaf_green" };
const TIP: Record<string, string> = { leaf_light: "leaf_tip", leaf_green: "leaf_light", leaf_dark: "leaf_green", leaf_yellow: "leaf_yellow", leaf_autumn: "leaf_yellow", leaf_red: "leaf_autumn", leaf_blossom: "leaf_blossom" };

/**
 * Leaf masses round a cluster centred on (x, y, z), in terms of $c: two big lobes sunk deep into the cluster, a few
 * middle ones and many small, ragged tufts pushed out past its outline, every one of them sized differently per limb
 * (through `v`, the limb number or a fixed number), so the crown reads as foliage of all sizes instead of even
 * "popcorn". Light on the upper, outer side and dark underneath.
 */
function tufts(prefix: string, x: string, y: string, z: string, seed: string, tones: { up: string; out: string; low: string }, scale = 1, v = "$i"): SpecNode[] {
  const k = n4(scale);
  const spots: [number, number, number, number, number][] = [
    // [dx, dy, dz, size, tone 0 up / 1 out / 2 low] in cluster radii: big lobes deep inside, small tufts far out.
    [0.38, 0.32, 0.18, 0.62, 1],
    [-0.3, 0.46, -0.22, 0.54, 0],
    [0.12, 0.74, 0.5, 0.36, 0],
    [0.72, -0.05, -0.55, 0.34, 1],
    [-0.62, 0.1, 0.42, 0.3, 1],
    [0.8, 0.34, 0.32, 0.22, 0],
    [0.26, 0.8, -0.32, 0.2, 0],
    [-0.42, 0.6, 0.55, 0.18, 0],
    [0.12, -0.36, 0.72, 0.24, 2],
    [-0.8, -0.1, -0.28, 0.2, 2],
    [0.62, 0.6, -0.18, 0.16, 0],
  ];
  return spots.map(([dx, dy, dz, size, tone], n) => {
    // Each copy grows between 55 % and 130 % of its size, with its own rhythm per spot.
    const f = `(${n4(size * scale)} * (0.55 + 0.75 * (0.5 + 0.5 * sin(${v} * ${n4(1.9 + n * 0.83)} + ${n4(n * 2.17)}))))`;
    return ellipsoid(`${prefix}_${n + 1}`, [`$c * ${f}`, `$c * ${f} * ${n4(0.78 + 0.04 * (n % 3))}`, `$c * ${f} * 0.9`], {
      at: [`${x} + $c * ${n4(dx)} * ${k}`, `${y} + $c * ${n4(dy)} * ${k}`, `${z} + $c * ${n4(dz)} * ${k}`],
      segments: size > 0.3 ? 14 : 10,
      lumps: size > 0.3 ? 0.5 : 0.6,
      seed: `${seed} + ${n * 31 + 3}`,
      material: tone === 0 ? tones.up : tone === 1 ? tones.out : tones.low,
    });
  });
}

const clampRange = (v: number, r: [number, number, number]): number => Math.min(r[2], Math.max(r[1], Math.round(v * 100) / 100));

function tree(key: string, sp: Species, v: Variant, index: number): AssetDraft {
  const r = rng(index * 977 + v.seed);
  const j = (): number => r() * 2 - 1;
  const seedBase = Math.floor(r() * 5000);
  const [leaf, sun] = v.leaves[key] ?? v.leaves.default;
  // Four tones per crown: shaded inside and underside, the main mass, sunlit tops and the light new growth at the tips.
  const shade = SHADE[leaf] ?? "leaf_shade";
  const tip = TIP[sun] ?? sun;
  const phase = Math.round(r() * 60);
  const s = n4(r() * 6);
  const vet = v.key === "veteran";
  const lumps = sp.lumps;

  // The trunk: a flared foot (about 1/30 of the height), a real taper to the fork, then a thinner leader into the crown.
  const trunkPath: [string, string, string][] = [
    ["0", "0", "0"],
    ["0", "$tr * 1.2", "0"],
    [`$tr * ${n4(j() * 0.5)}`, "$hf * 0.5", `$tr * ${n4(j() * 0.5)}`],
    [`$tr * ${n4(j() * 0.7)}`, "$hf", `$tr * ${n4(j() * 0.7)}`],
    [`$tr * ${n4(j() * 0.6)}`, "($hf + $yc) / 2", `$tr * ${n4(j() * 0.6)}`],
    ["0", "$top", "0"],
  ];
  if (sp.extra === "weep") trunkPath[3] = ["$tr * 1.2", "$hf", "$tr * 0.4"];
  const flares = tube("Flare_{i}", [["$tr * 0.4", "$tr * 1.4", 0], ["$tr * 1.15", "$tr * 0.55", 0], ["$tr * 2.1", "$tr * 0.2", 0]], ["$tr * 0.5", "$tr * 0.3", "$tr * 0.17"], {
    segments: 8,
    rotate: [0, "15 * sin($i * 2.1)", 0],
    repeat: { count: vet ? 7 : 5, around: "y", phase },
  });
  const trunk = tube("Trunk", trunkPath, ["$tr * 1.15", "$tr", "$tr * 0.88", "$tr * 0.75", "$tr * 0.42", "$tr * 0.14"], { segments: 14, children: [flares] });

  // One main limb with its leaves; copies turn round the trunk and vary in reach and height with $i.
  const armChildren: SpecNode[] = [
    tube("Branch", [
      ["0", "$ys", "0"],
      ["$L * 0.3", "$ys + ($ye - $ys) * 0.45", "$L * 0.06"],
      ["$L * 0.68", "$ys + ($ye - $ys) * 0.82", "-$L * 0.05"],
      ["$L", "$ye", "0"],
    ], ["$tr * 0.56", "$tr * 0.42", "$tr * 0.27", "$tr * 0.12"], { segments: 10 }),
    tube("Twig", [["$L * 0.68", "$ys + ($ye - $ys) * 0.82", "-$L * 0.05"], ["$L * 0.62", "$ye + $ry * 0.28", "$L * 0.32"]], ["$tr * 0.16", "$tr * 0.07"], { segments: 6 }),
    tube("TwigLow", [["$L * 0.45", "$ys + ($ye - $ys) * 0.6", "0"], ["$L * 0.75", "$ys + ($ye - $ys) * 0.7", "-$L * 0.3"]], ["$tr * 0.14", "$tr * 0.06"], { segments: 6 }),
    ellipsoid("Leaves", ["$c * $m", "$c * $m * $sq", "$c * $m * 0.9"], { at: ["$L", "$ye + $c * 0.2", 0], segments: 18, lumps, seed: `$i * 13 + ${seedBase + 1}`, material: leaf }),
    ellipsoid("LeavesMid", ["$c * 0.72 * (1.5 - $m * 0.6)", "$c * 0.72 * (1.5 - $m * 0.6) * $sq", "$c * 0.7 * (1.5 - $m * 0.6)"], { at: ["$L * 0.62", "$ye + $ry * 0.3", "$L * 0.32"], segments: 16, lumps, seed: `$i * 7 + ${seedBase + 2}`, material: sun }),
    ellipsoid("LeavesSide", ["$c * 0.62", "$c * 0.6 * $sq", "$c * 0.6"], { at: ["$L * 0.8", "$ys + ($ye - $ys) * 0.75", "-$L * 0.32"], segments: 14, lumps, seed: `$i * 5 + ${seedBase + 3}`, material: shade }),
    ellipsoid("LeavesUnder", ["$c * 0.8", "$c * 0.42 * $sq", "$c * 0.72"], { at: ["$L * 0.9", "$ye - $c * 0.22", 0], segments: 14, lumps: lumps + 0.1, seed: `$i * 3 + ${seedBase + 9}`, material: shade }),
    ...tufts("LeavesTuft", "$L", "$ye + $c * 0.2", "0", `$i * 17 + ${seedBase + 11}`, { up: tip, out: sun, low: shade }),
    ...tufts("LeavesMidTuft", "$L * 0.62", "$ye + $ry * 0.3", "$L * 0.32", `$i * 19 + ${seedBase + 12}`, { up: tip, out: leaf, low: shade }, 0.7, "($i + 2.6)").filter((_, n) => n % 2 === 0),
  ];
  const extraMats: string[] = [];
  let extraText = "";
  if (sp.extra === "low") {
    armChildren.push(ellipsoid("LeavesLow", ["$c * 0.7", "$c * 0.5 * $sq", "$c * 0.6"], { at: ["$L * 1.05", "$ye - $ry * 0.22", "$L * 0.15"], segments: 14, lumps, seed: `$i * 3 + ${seedBase + 4}`, material: leaf }));
    extraText = " Heavy outer clusters hang low at the limb ends.";
  }
  if (sp.extra === "weep") {
    for (const [k, dz] of [[1, -0.3], [2, 0], [3, 0.3]] as const) {
      // A curtain of hanging leaf clumps, narrowing toward its ragged lower end.
      const bottom = `($db + ($ye - $db) * ${n4(0.05 + 0.08 * k)})`;
      [0.12, 0.36, 0.6, 0.84].forEach((t, n) => {
        armChildren.push(ellipsoid(`Drape_${k}_${n + 1}`, [`$c * ${n4(0.34 - 0.13 * t)}`, `min(($ye - ${bottom}) * 0.16, $c * 1.1)`, `$c * ${n4(0.3 - 0.12 * t)}`], {
          at: [`$L * ${n4(0.95 + 0.19 * t)}`, `$ye - ($ye - ${bottom}) * ${n4(t)}`, `$L * ${n4(dz * (1 + 0.15 * t))}`],
          segments: 10, lumps: 0.35, seed: `$i * 23 + ${k * 7 + n}`, material: n % 2 ? leaf : sun,
        }));
      });
    }
    extraText = " Three long curtains of leaves hang from every limb end.";
  }
  if (sp.extra === "fruit" && v.fruit) {
    for (const [k, dx, dz] of [[1, 0.2, 0.4], [2, -0.3, 0.5], [3, 0.5, -0.3], [4, -0.1, -0.6]] as const) {
      armChildren.push(ellipsoid(`Fruit_${k}`, ["$cr * 0.035 + 0.03", "$cr * 0.035 + 0.03", "$cr * 0.035 + 0.03"], { at: [`$L + $c * ${dx}`, "$ye - $c * 0.38", `$c * ${dz}`], segments: 8, material: v.fruit }));
    }
    extraMats.push(v.fruit);
    extraText = ` ${v.fruitName ? v.fruitName.charAt(0).toUpperCase() + v.fruitName.slice(1) : "Fruit"} hang under the leaf clusters.`;
  } else if (sp.extra === "fruit") extraText = " The crown is in full blossom.";

  const limbs = group("Limb_{i}", [group("Arm", armChildren, {
    vars: {
      k: `0.5 + 0.5 * sin($i * 2.4 + ${s})`,
      // The size of this limb's main mass: a few big masses, more small ones.
      m: `0.62 + 0.6 * pow(0.5 + 0.5 * sin($i * 3.7 + ${s} * 1.3), 2)`,
      L: `$cr * ${n4(sp.spread)} * (${n4(1 - sp.vary)} + ${n4(sp.vary)} * $k)`,
      ye: `$yc + $ry * (${n4(sp.lift)} + 0.25 * ($k - 0.5) + 0.2 * sin($i * 4.1 + ${s}))`,
      ys: `$hf - $tr * 0.4 + ($yc - $hf) * 0.1 * (1 - $k)`,
    },
  })], { rotate: [0, `22 * sin($i * 1.7 + ${s})`, 0], repeat: { count: "$branches", around: "y", phase } });

  // The top of the crown, closing the silhouette above the limbs (the lower crown stays open, so the limbs show).
  const crown: SpecNode[] = [
    ellipsoid("Leaves_Top", ["$c * 1.05", "$c * $sq", "$c"], { at: [0, "$height - $c * $sq * 0.95", 0], segments: 18, lumps, seed: seedBase + 5, material: sun }),
    ...tufts("Leaves_TopTuft", "0", "$height - $c * $sq * 0.95", "0", String(seedBase + 13), { up: tip, out: sun, low: leaf }, 1.1, n4(1 + (seedBase % 7))),
    ellipsoid("Leaves_Fill_{i}", ["$c * (0.5 + 0.25 * sin($i * 2.9))", "$c * (0.5 + 0.25 * sin($i * 2.9)) * $sq", "$c * 0.55"], { at: [`$cr * ${n4(sp.spread * 0.36)}`, "$yc + $ry * (0.2 + 0.2 * sin($i * 1.3))", 0], segments: 16, lumps, seed: `$i * 11 + ${seedBase + 6}`, material: shade, repeat: { count: 3, around: "y", phase: phase + 60 } }),
  ];
  const branchNodes: SpecNode[] = [limbs];
  if (sp.extra === "airy") {
    crown.push(ellipsoid("Leaves_Leader_{i}", ["$c * 0.7", "$c * 0.8 * $sq", "$c * 0.65"], { at: ["$tr * 1.2", "$yc + $ry * (0.15 + 0.4 * $i)", 0], segments: 14, lumps, seed: `$i * 3 + ${seedBase + 7}`, repeat: { count: 2, around: "y", phase: phase + 90 } }));
    const tx = n4(0.35 + r() * 0.1);
    branchNodes.push(tube("Trunk_B", [["$tr * 0.5", 0, "$tr * 0.2"], ["$tr * 1.4", "$hf * 0.5", "$tr * 0.6"], [`$cr * ${tx}`, "$yc * 0.85", "$cr * 0.3"], [`$cr * ${tx} * 1.15`, "$yc + $ry * 0.1", "$cr * 0.36"]], ["$tr * 0.62", "$tr * 0.5", "$tr * 0.3", "$tr * 0.12"], { segments: 10, material: sp.bark }));
    crown.push(ellipsoid("Leaves_Twin", ["$c * 0.85", "$c * $sq", "$c * 0.8"], { at: [`$cr * ${tx} * 1.15`, "$yc + $ry * 0.15", "$cr * 0.36"], segments: 16, lumps, seed: seedBase + 8 }));
    extraText = " A second, leaning stem carries its own leaf cluster.";
  }
  if (sp.extra === "weep") {
    [0.15, 0.42, 0.7].forEach((t, n) => {
      crown.push(ellipsoid(`Drape_Top_${n + 1}_{i}`, [`$c * ${n4(0.34 - 0.12 * t)}`, "min(($yc - $db) * 0.2, $c * 1.1)", `$c * ${n4(0.3 - 0.1 * t)}`], {
        at: [`$cr * ${n4(0.5 + 0.16 * t)}`, `$yc + $ry * 0.2 - ($yc + $ry * 0.2 - $db) * ${n4(t)}`, `$cr * ${n4(0.08 * t)}`],
        segments: 10, lumps: 0.35, seed: `$i * 29 + ${n + 3}`, material: n % 2 ? shade : leaf, repeat: { count: 6, around: "y", phase: phase + 30 },
      }));
    });
  }

  const height = clampRange(sp.height[0] * v.scale, sp.height);
  const crownR = clampRange(sp.crown[0] * (0.85 + 0.15 * v.scale) * (0.95 + r() * 0.1), sp.crown);
  const trunkR = clampRange(sp.trunk[0] * v.scale, sp.trunk);
  const branches = Math.min(sp.limbs[2], Math.max(sp.limbs[1], sp.limbs[0] + v.more));

  const nodes: SpecNode[] = [
    group("Tree", [trunk, group("Branches", branchNodes), group("Crown", crown, { material: leaf })], {
      material: sp.bark,
      vars: {
        cr: "$crownRadius",
        tr: "$trunkRadius",
        ry: `min($crownRadius * ${n4(sp.flat)}, $height * 0.4)`,
        yc: "$height - $ry * 0.95",
        hf: `min($height * ${n4(sp.fork)}, $yc - $ry * 0.55)`,
        c: `$crownRadius * ${n4(sp.cluster)}`,
        sq: n4(sp.squash),
        top: "$height - $crownRadius * " + n4(sp.cluster * sp.squash * 0.9),
        db: "max($height * 0.14, 0.8)",
      },
    }),
  ];
  return {
    slug: slugify("broadleaf-tree", sp.name, v.key),
    title: `${v.label.charAt(0).toUpperCase()}${v.label.slice(1)} ${sp.name}`,
    description: `A ${v.label} ${sp.name}: ${sp.text}. Each main limb ends in lumpy ${leaf.replace("leaf_", "")} leaf clusters with sunlit ${sun.replace("leaf_", "")} ones above.${extraText} It stands on y = 0; the front faces +z.`,
    tags: [sp.name, sp.dutch, v.label, v.dutch, leaf.replace("leaf_", ""), ...(sp.extra === "fruit" ? ["apple tree", "appelboom", "orchard", "boomgaard"] : []), ...(v.key === "spring" && sp.extra === "fruit" ? ["blossom", "bloesem"] : [])],
    params: [
      num("height", height, sp.height[1], sp.height[2], "Total height of the tree in metres."),
      num("crownRadius", crownR, sp.crown[1], sp.crown[2], "Radius of the crown in metres."),
      num("trunkRadius", trunkR, sp.trunk[1], sp.trunk[2], "Trunk radius just above the root flare, in metres."),
      int("branches", branches, sp.limbs[1], sp.limbs[2], "Number of main limbs, each ending in leaf clusters."),
    ],
    materials: natureMats(mats, sp.bark, leaf, sun, shade, tip, ...extraMats),
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

