import { box, cyl, ellipsoid, group, int, lathe, num, rng, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { lumpExtent, n4, natureMats } from "./common.js";

type Style = "round" | "hedge" | "flowering" | "topiary" | "spiky" | "berry";

interface Bush {
  style: Style;
  key: string;
  title: string;
  dutch: string;
  leaf: string;
  /** A second leaf shade for the sunlit top. */
  sun: string;
  /** Flowers, berries or the pot. */
  accent?: string;
  /** [default, min, max] */
  width: [number, number, number];
  height: [number, number, number];
  length?: [number, number, number];
  count?: [number, number, number];
  /** Topiary form. */
  form?: "ball" | "cone" | "tiered" | "standard";
  lumps?: number;
  text: string;
}

const BUSHES: Bush[] = [
  { style: "round", key: "green", title: "Round green shrub", dutch: "ronde struik", leaf: "leaf_green", sun: "leaf_light", width: [1.6, 0.8, 3], height: [1.1, 0.6, 2.2], count: [6, 4, 9], text: "a dome of overlapping lumpy leaf masses in two greens over short woody stems" },
  { style: "round", key: "dark", title: "Dark evergreen shrub", dutch: "groenblijvende struik", leaf: "leaf_dark", sun: "leaf_green", width: [1.4, 0.8, 2.6], height: [1.3, 0.7, 2.4], count: [7, 4, 9], lumps: 0.3, text: "a dense, upright, dark green evergreen mound, slightly taller than wide" },
  { style: "round", key: "purple", title: "Purple-leaf shrub", dutch: "rode struik", leaf: "leaf_purple", sun: "leaf_red", width: [1.5, 0.8, 2.8], height: [1.2, 0.6, 2.2], count: [5, 4, 8], lumps: 0.5, text: "a loose, irregular mound of deep purple foliage, like a smoke bush or purple barberry" },
  { style: "round", key: "variegated", title: "Variegated shrub", dutch: "bonte struik", leaf: "leaf_variegated", sun: "leaf_light", width: [1.2, 0.6, 2.2], height: [0.8, 0.5, 1.6], count: [6, 4, 9], lumps: 0.35, text: "a low, spreading mound of yellow-green variegated leaves" },
  { style: "hedge", key: "privet", title: "Privet hedge", dutch: "ligusterhaag", leaf: "leaf_green", sun: "leaf_light", width: [0.8, 0.5, 1.4], height: [1.6, 0.8, 2.5], length: [3, 1, 6], count: [6, 3, 10], text: "a clipped privet hedge with a flat top and straight sides, softened by leafy bulges, running along z" },
  { style: "hedge", key: "beech", title: "Beech hedge in autumn", dutch: "beukenhaag", leaf: "leaf_autumn", sun: "leaf_red", width: [0.7, 0.5, 1.2], height: [1.8, 1, 2.5], length: [4, 1, 6], count: [7, 3, 10], text: "a tall beech hedge holding its copper-brown autumn leaves, running along z" },
  { style: "hedge", key: "yew", title: "Yew hedge", dutch: "taxushaag", leaf: "leaf_dark", sun: "leaf_box", width: [1, 0.6, 1.6], height: [2, 1, 2.8], length: [3, 1, 6], count: [5, 3, 9], lumps: 0.2, text: "a dense, dark yew hedge, crisply clipped with a slightly domed top, running along z" },
  { style: "hedge", key: "box-border", title: "Low box border", dutch: "buxusrand", leaf: "leaf_box", sun: "leaf_green", width: [0.4, 0.25, 0.7], height: [0.45, 0.25, 0.8], length: [2, 0.6, 5], count: [6, 3, 12], lumps: 0.2, text: "a low, neat boxwood edging for a garden path, running along z" },
  { style: "flowering", key: "hydrangea-blue", title: "Blue hydrangea", dutch: "blauwe hortensia", leaf: "leaf_green", sun: "leaf_light", accent: "flower_blue", width: [1.4, 0.8, 2.2], height: [1.1, 0.6, 1.8], count: [9, 5, 14], text: "a rounded hydrangea bush covered in big, round blue flower heads" },
  { style: "flowering", key: "hydrangea-pink", title: "Pink hydrangea", dutch: "roze hortensia", leaf: "leaf_green", sun: "leaf_light", accent: "flower_pink", width: [1.3, 0.8, 2.2], height: [1.0, 0.6, 1.8], count: [10, 5, 14], text: "a rounded hydrangea bush covered in big, round pink flower heads" },
  { style: "flowering", key: "rhododendron", title: "Rhododendron", dutch: "rododendron", leaf: "leaf_dark", sun: "leaf_green", accent: "flower_purple", width: [2, 1, 3], height: [1.8, 1, 2.8], count: [12, 6, 16], lumps: 0.4, text: "a large, dark rhododendron with trusses of purple flowers all over" },
  { style: "flowering", key: "spiraea", title: "White spiraea", dutch: "spirea", leaf: "leaf_light", sun: "leaf_green", accent: "flower_white", width: [1.6, 0.8, 2.6], height: [1.2, 0.6, 2], count: [14, 6, 16], lumps: 0.5, text: "an arching spiraea bush frothing with small white flower clusters" },
  { style: "topiary", key: "ball", title: "Boxwood ball topiary", dutch: "buxusbol", leaf: "leaf_box", sun: "leaf_box", accent: "terracotta", form: "ball", width: [0.7, 0.4, 1.2], height: [0.95, 0.6, 1.6], count: [12, 8, 16], lumps: 0.06, text: "a clipped boxwood ball in a ribbed terracotta pot" },
  { style: "topiary", key: "cone", title: "Boxwood cone topiary", dutch: "buxuskegel", leaf: "leaf_box", sun: "leaf_box", accent: "terracotta", form: "cone", width: [0.6, 0.4, 1], height: [1.5, 0.8, 2.4], count: [12, 8, 16], text: "a clipped boxwood cone in a terracotta pot" },
  { style: "topiary", key: "tiered", title: "Tiered boxwood topiary", dutch: "buxus etagere", leaf: "leaf_box", sun: "leaf_green", accent: "ceramic_black", form: "tiered", width: [0.7, 0.45, 1.1], height: [1.6, 1, 2.4], count: [12, 8, 16], lumps: 0.06, text: "three clipped boxwood balls, largest at the bottom, stacked on a stem in a black glazed pot" },
  { style: "topiary", key: "standard", title: "Standard ball topiary", dutch: "bolboompje", leaf: "leaf_green", sun: "leaf_light", accent: "ceramic_celadon", form: "standard", width: [0.6, 0.4, 1], height: [1.5, 0.9, 2.2], count: [12, 8, 16], lumps: 0.08, text: "a clipped ball of leaves on a bare, straight stem in a celadon glazed pot" },
  { style: "spiky", key: "lavender", title: "Lavender bush", dutch: "lavendel", leaf: "leaf_silver", sun: "leaf_silver", accent: "flower_purple", width: [0.8, 0.5, 1.2], height: [0.6, 0.4, 0.9], count: [22, 12, 30], text: "a silvery lavender mound with a fountain of slender stalks tipped with purple flower spikes" },
  { style: "spiky", key: "salvia", title: "Blue salvia", dutch: "salie", leaf: "leaf_green", sun: "leaf_light", accent: "flower_blue", width: [0.7, 0.5, 1.1], height: [0.7, 0.5, 1], count: [16, 10, 26], text: "a green clump with upright stalks of deep blue salvia flowers" },
  { style: "spiky", key: "heather", title: "Pink heather", dutch: "heide", leaf: "leaf_dark", sun: "leaf_green", accent: "flower_pink", width: [0.9, 0.5, 1.4], height: [0.5, 0.3, 0.8], count: [26, 14, 30], text: "a low, dense heather cushion with short spikes of pink bells" },
  { style: "spiky", key: "rosemary", title: "Rosemary bush", dutch: "rozemarijn", leaf: "leaf_silver", sun: "leaf_dark", width: [0.9, 0.5, 1.4], height: [0.8, 0.5, 1.2], count: [18, 10, 28], text: "an upright, woody rosemary bush with many narrow, needle-leaved shoots" },
  { style: "berry", key: "holly", title: "Holly bush with berries", dutch: "hulst", leaf: "leaf_dark", sun: "leaf_green", accent: "berry_red", width: [1.4, 0.8, 2.4], height: [1.6, 0.8, 2.6], count: [10, 6, 14], lumps: 0.35, text: "a glossy, dark holly bush studded with clusters of red berries" },
  { style: "berry", key: "blueberry", title: "Blueberry bush", dutch: "bosbes", leaf: "leaf_green", sun: "leaf_light", accent: "flower_blue", width: [1.0, 0.6, 1.6], height: [0.9, 0.5, 1.5], count: [10, 6, 14], text: "a twiggy blueberry bush hung with clusters of dusky blue berries" },
  { style: "berry", key: "currant", title: "Redcurrant bush", dutch: "aalbes", leaf: "leaf_light", sun: "leaf_green", accent: "apple_red", width: [1.1, 0.6, 1.8], height: [1.1, 0.6, 1.6], count: [12, 6, 14], lumps: 0.45, text: "an open redcurrant bush with strings of bright red berries" },
  { style: "berry", key: "snowberry", title: "Snowberry bush", dutch: "sneeuwbes", leaf: "leaf_green", sun: "leaf_dark", accent: "flower_white", width: [1.3, 0.7, 2], height: [1.2, 0.6, 1.8], count: [11, 6, 14], lumps: 0.4, text: "an arching snowberry bush with clusters of white berries" },
];

/** Deepest point below the centre over a run of seeds, so every copy of a ring stays above the ground. */
function maxLow(segments: number, lumps: number, base: number, mult: number, count: number): number {
  let m = 0;
  for (let i = 0; i < count; i++) m = Math.max(m, lumpExtent(segments, lumps, base + i * mult).low);
  return m;
}

/** The leafy dome shared by most styles: a core, a low ring of $count masses and a ring of three on top. */
function dome(b: Bush, r: () => number, ringCount: string, maxCount: number): SpecNode[] {
  const lumps = b.lumps ?? 0.4;
  const s0 = Math.floor(r() * 3000);
  const coreLow = lumpExtent(18, lumps, s0).low;
  const ringLow = maxLow(14, lumps, s0 + 1, 11, maxCount);
  const phase = Math.round(r() * 60);
  return [
    ellipsoid("Core", ["$width * 0.4", "$height * 0.45", "$width * 0.4"], { at: [0, `max($height * 0.5, $height * 0.45 * ${n4(coreLow)} + 0.02)`, 0], segments: 18, lumps, seed: s0 }),
    ellipsoid("Mass_{i}", ["$width * 0.27", "$height * 0.3", "$width * 0.25"], {
      at: [`$width * (0.26 + 0.03 * sin($i * 2.1))`, `max($height * (0.36 + 0.05 * sin($i * 1.7)), $height * 0.3 * ${n4(ringLow)} + 0.03)`, 0],
      segments: 14,
      lumps,
      seed: `$i * 11 + ${s0 + 1}`,
      repeat: { count: ringCount, around: "y", phase },
    }),
    ellipsoid("Top_{i}", ["$width * 0.24", "$height * 0.24", "$width * 0.22"], { at: ["$width * 0.12", "$height * 0.7", 0], segments: 14, lumps, seed: `$i * 7 + ${s0 + 2}`, material: b.sun, repeat: { count: 3, around: "y", phase: phase + 50 } }),
  ];
}

const stems = (bark: string, phase: number): SpecNode =>
  group("Stems", [
    tube("Stem_{i}", [[0, 0, 0], ["$width * 0.05", "$height * 0.2", 0], ["$width * 0.14", "$height * 0.42", "$width * 0.02"]], ["$width * 0.025 + 0.01", "$width * 0.018 + 0.008", "$width * 0.01 + 0.005"], { segments: 7, material: bark, repeat: { count: 4, around: "y", phase } }),
  ]);

/** A ribbed garden pot from the ground to $pot (its height), radius $pr. */
const pot = (material: string): SpecNode =>
  group("Pot", [
    lathe("Body", [["$pr * 0.72", 0], ["$pr * 0.75", 0.02], ["$pr * 0.92", "$pot * 0.85"], ["$pr", "$pot * 0.87"], ["$pr * 1.02", "$pot"], ["$pr * 0.9", "$pot"], ["$pr * 0.88", "$pot * 0.92"]], { segments: 20, material }),
    cyl("Soil", "$pr * 0.88", 0.02, { at: [0, "$pot * 0.91", 0], segments: 20, material: "soil" }),
  ]);

function bushAsset(b: Bush, index: number): AssetDraft {
  const r = rng(index * 6131 + 5);
  const nodes: SpecNode[] = [];
  const m: string[] = [b.leaf, b.sun];
  const countMax = b.count?.[2] ?? 8;
  const phase = Math.round(r() * 90);
  const params = [
    num("width", b.width[0], b.width[1], b.width[2], "Width of the plant across x, in metres."),
    num("height", b.height[0], b.height[1], b.height[2], "Total height in metres."),
  ];
  let countText = "";
  switch (b.style) {
    case "round": {
      nodes.push(group("Foliage", dome(b, r, "$masses", countMax), { material: b.leaf }), stems("bark_brown", phase));
      m.push("bark_brown");
      params.push(int("masses", b.count![0], b.count![1], b.count![2], "Number of leaf masses in the low ring."));
      break;
    }
    case "hedge": {
      const lumps = b.lumps ?? 0.3;
      const s0 = Math.floor(r() * 3000);
      nodes.push(group("Foliage", [
        box("Body", ["$width * 0.9", "$height * 0.84", "$length"], { at: [0, "$height * 0.1", 0], anchor: "bottom", bevel: "min($width, $height) * 0.2" }),
        ellipsoid("Bulge_{i}", ["$width * 0.18", "$height * 0.2", "min($length / $bulges * 0.6, $width * 0.6)"], {
          at: ["$width * 0.37", `$height * (0.5 + 0.18 * sin($i * 2.3 + ${n4(r() * 3)}))`, "-$length / 2 + $length / $bulges * ($i + 0.5)"],
          segments: 12, lumps, seed: `$i * 5 + ${s0}`,
          repeat: { count: "$bulges", step: [0, 0, 0] },
        }),
        ellipsoid("BulgeR_{i}", ["$width * 0.17", "$height * 0.19", "min($length / $bulges * 0.55, $width * 0.6)"], {
          at: ["-$width * 0.36", `$height * (0.48 + 0.18 * sin($i * 1.7 + ${n4(r() * 3)}))`, "-$length / 2 + $length / $bulges * ($i + 0.9) * 0.97"],
          segments: 12, lumps, seed: `$i * 7 + ${s0 + 2}`,
          repeat: { count: "$bulges", step: [0, 0, 0] },
        }),
        ellipsoid("Crest_{i}", ["$width * 0.42", "$height * 0.08", "min($length / $bulges * 0.62, $width * 1.2)"], {
          at: [0, "$height * 0.92", "-$length / 2 + $length / $bulges * ($i + 0.5)"],
          segments: 12, lumps, seed: `$i * 3 + ${s0 + 1}`, material: b.sun,
          repeat: { count: "$bulges", step: [0, 0, 0] },
        }),
      ], { material: b.leaf }), group("Stems", [
        cyl("Stem_{i}", "min($width, $height) * 0.035 + 0.008", "$height * 0.3", { at: ["$width * 0.2 * sin($i * 2.3)", 0, "-$length / 2 + $length / $bulges * ($i + 0.5)"], anchor: "base", segments: 8, repeat: { count: "$bulges", step: [0, 0, 0] } }),
      ], { material: "bark_brown" }));
      m.push("bark_brown");
      params.push(num("length", b.length![0], b.length![1], b.length![2], "Length of the hedge along z, in metres."));
      params.push(int("bulges", b.count![0], b.count![1], b.count![2], "Leafy bulges along each side and on top."));
      break;
    }
    case "flowering": {
      const s0 = Math.floor(r() * 3000);
      nodes.push(group("Foliage", [
        ...dome(b, r, "6", 6),
        ellipsoid("Bloom_{i}", ["$width * 0.075 + 0.03", "$width * 0.065 + 0.025", "$width * 0.075 + 0.03"], {
          at: [`$width * (0.42 + 0.03 * sin($i * 1.3))`, `$height * (0.5 + 0.2 * sin($i * 2.7 + ${n4(r() * 3)}))`, 0],
          segments: 10, lumps: 0.35, seed: `$i * 3 + ${s0}`, material: b.accent!,
          repeat: { count: "$blooms", around: "y", phase: phase + 10 },
        }),
        ellipsoid("BloomTop_{i}", ["$width * 0.07 + 0.03", "$width * 0.06 + 0.025", "$width * 0.07 + 0.03"], {
          at: ["$width * 0.2", "$height * 0.88", 0], segments: 10, lumps: 0.35, seed: `$i * 5 + ${s0 + 1}`, material: b.accent!,
          repeat: { count: 4, around: "y", phase: phase + 40 },
        }),
      ], { material: b.leaf }), stems("bark_brown", phase));
      m.push(b.accent!, "bark_brown");
      params.push(int("blooms", b.count![0], b.count![1], b.count![2], "Number of flower heads around the sides."));
      countText = " Four more flower heads sit on top.";
      break;
    }
    case "topiary": {
      const lumps = b.lumps ?? 0.06;
      const s0 = Math.floor(r() * 3000);
      const pr = "$width * 0.38";
      const potH = "$height * 0.24";
      const foliage: SpecNode[] = [];
      const top = "$height - $pot";
      if (b.form === "ball") {
        const low = lumpExtent(24, lumps, s0).low;
        foliage.push(ellipsoid("Ball", ["$width / 2", `(${top}) / 2 * 0.96`, "$width / 2"], { at: [0, `$pot + (${top}) / 2 * 0.96 * ${n4(low)} - 0.03`, 0], segments: 24, lumps, seed: s0 }));
      } else if (b.form === "cone") {
        foliage.push(lathe("Cone", [["$width * 0.3", "$pot - 0.02"], ["$width / 2", "$pot + ($height - $pot) * 0.08"], ["$width * 0.26", "$pot + ($height - $pot) * 0.55"], ["$width * 0.05", "$height - 0.02"], ["0.015", "$height"]], { segments: 20 }));
        foliage.push(ellipsoid("Fuzz_{i}", ["$width * 0.14", "($height - $pot) * 0.12", "$width * 0.1"], { at: ["$width * (0.36 - 0.25 * ($i % 3) / 2)", "$pot + ($height - $pot) * (0.1 + 0.25 * ($i % 3))", 0], segments: 10, lumps: 0.3, seed: `$i + ${s0}`, repeat: { count: "$tufts", around: "y", phase } }));
      } else if (b.form === "tiered") {
        foliage.push(
          ellipsoid("Ball_1", ["$width / 2", `(${top}) * 0.2`, "$width / 2"], { at: [0, `$pot + (${top}) * 0.2`, 0], segments: 20, lumps, seed: s0 }),
          ellipsoid("Ball_2", ["$width * 0.36", `(${top}) * 0.15`, "$width * 0.36"], { at: [0, `$pot + (${top}) * 0.58`, 0], segments: 20, lumps, seed: s0 + 1 }),
          ellipsoid("Ball_3", ["$width * 0.24", `(${top}) * 0.11`, "$width * 0.24"], { at: [0, `$pot + (${top}) * 0.87`, 0], segments: 18, lumps, seed: s0 + 2 }),
        );
      } else {
        foliage.push(ellipsoid("Ball", ["$width / 2", "$width * 0.46", "$width / 2"], { at: [0, "$height - $width * 0.46", 0], segments: 24, lumps, seed: s0 }));
      }
      if (b.form !== "cone") {
        foliage.push(ellipsoid("Fuzz_{i}", ["$width * 0.1", "$width * 0.08", "$width * 0.1"], { at: ["$width * 0.4", b.form === "standard" ? "$height - $width * 0.46" : b.form === "tiered" ? `$pot + (${top}) * 0.2` : `$pot + (${top}) / 2`, 0], segments: 8, lumps: 0.3, seed: `$i + ${s0}`, material: b.sun, repeat: { count: "$tufts", around: "y", phase } }));
      }
      nodes.push(group("Topiary", [
        pot(b.accent!),
        group("Foliage", foliage, { material: b.leaf }),
        ...(b.form === "ball" || b.form === "cone" ? [lathe("Stem", [["$width * 0.05 + 0.01", "$pot * 0.85"], ["$width * 0.04 + 0.008", "$pot + ($height - $pot) * 0.2"], ["$width * 0.03 + 0.006", "$pot + ($height - $pot) * 0.25"]], { segments: 8, material: "bark_brown" })] : []),
        ...(b.form === "standard" || b.form === "tiered" ? [lathe("Stem", [["$width * 0.04 + 0.01", "$pot * 0.85"], ["$width * 0.03 + 0.008", b.form === "tiered" ? "$height * 0.9" : "$height - $width * 0.4"], ["$width * 0.02 + 0.006", b.form === "tiered" ? "$height * 0.92" : "$height - $width * 0.3"]], { segments: 8, material: "bark_brown" })] : []),
      ], { vars: { pot: potH, pr } }));
      m.push(b.accent!, "soil", "bark_brown");
      params.push(int("tufts", b.count![0], b.count![1], b.count![2], "Number of slightly overgrown tufts that break the clipped outline."));
      break;
    }
    case "spiky": {
      const s0 = Math.floor(r() * 3000);
      const low = lumpExtent(16, 0.35, s0).low;
      const flower = b.accent;
      const spike = (name: string, lean: number, len: number, count: string | number, ph: number): SpecNode =>
        tube(name, [[0, "$height * 0.12", 0], [`$width * ${n4(lean * 0.4)}`, `$height * ${n4(0.12 + len * 0.5)}`, 0], [`$width * ${n4(lean)}`, `$height * ${n4(0.12 + len)}`, 0]], ["$width * 0.012 + 0.003", "$width * 0.009 + 0.003", "$width * 0.006 + 0.002"], {
          segments: 5,
          material: flower ? "stem_green" : b.sun,
          rotate: [`8 * sin($i * 2.3)`, 0, 0],
          repeat: { count, around: "y", phase: ph },
          children: flower ? [ellipsoid("Flower", ["$width * 0.022 + 0.006", "$height * 0.11", "$width * 0.022 + 0.006"], { at: [`$width * ${n4(lean)}`, `$height * ${n4(0.12 + len - 0.06)}`, 0], segments: 8, lumps: 0.3, seed: 3, material: flower })] : [],
        });
      nodes.push(group("Foliage", [
        ellipsoid("Mound", ["$width * 0.42", "$height * 0.25", "$width * 0.42"], { at: [0, `$height * 0.25 * ${n4(low)} + 0.01`, 0], segments: 16, lumps: 0.35, seed: s0 }),
        ellipsoid("Mound_Top", ["$width * 0.3", "$height * 0.2", "$width * 0.3"], { at: [0, "$height * 0.35", 0], segments: 14, lumps: 0.35, seed: s0 + 1, material: b.sun }),
      ], { material: b.leaf }), group("Stems", [
        spike("Stem_{i}", 0.4, b.key === "heather" ? 0.45 : 0.82, "$spikes", phase),
        spike("StemInner_{i}", 0.16, b.key === "heather" ? 0.5 : 0.86, 7, phase + 25),
      ]));
      m.push(...(flower ? [flower, "stem_green"] : []));
      params.push(int("spikes", b.count![0], b.count![1], b.count![2], flower ? "Number of flower stalks in the outer ring." : "Number of shoots in the outer ring."));
      countText = flower ? " Seven more stalks rise from the centre." : "";
      break;
    }
    case "berry": {
      const s0 = Math.floor(r() * 3000);
      const accent = b.accent!;
      nodes.push(group("Foliage", [
        ...dome(b, r, "6", 6),
      ], { material: b.leaf }), stems("bark_dark", phase), group("Berries", [
        group("Cluster_{i}", [
          ellipsoid("Berry_1", ["$br", "$br", "$br"], { segments: 8 }),
          ellipsoid("Berry_2", ["$br * 0.9", "$br * 0.9", "$br * 0.9"], { at: ["$br * 1.4", "-$br * 1.1", "$br * 0.6"], segments: 8 }),
          ellipsoid("Berry_3", ["$br * 0.9", "$br * 0.9", "$br * 0.9"], { at: ["-$br * 1.2", "-$br * 1.3", "-$br * 0.8"], segments: 8 }),
          ellipsoid("Berry_4", ["$br * 0.85", "$br * 0.85", "$br * 0.85"], { at: ["$br * 0.2", "-$br * 2.3", "$br * 0.3"], segments: 8 }),
          ellipsoid("Berry_5", ["$br * 0.8", "$br * 0.8", "$br * 0.8"], { at: ["$br * 1.6", "$br * 0.6", "-$br * 0.9"], segments: 8 }),
        ], { vars: { br: "$width * 0.022 + 0.01" }, at: [`$width * (0.44 + 0.04 * sin($i * 1.9))`, `$height * (0.45 + 0.22 * sin($i * 2.6 + ${n4((s0 % 7) / 2)}))`, 0], repeat: { count: "$clusters", around: "y", phase: phase + 15 } }),
      ], { material: accent }));
      m.push(accent, "bark_dark");
      params.push(int("clusters", b.count![0], b.count![1], b.count![2], "Number of berry clusters around the bush."));
      break;
    }
  }
  if (b.style === "hedge") params.splice(0, 2, num("width", b.width[0], b.width[1], b.width[2], "Thickness of the hedge across x, in metres."), num("height", b.height[0], b.height[1], b.height[2], "Height of the hedge in metres."));
  return {
    slug: slugify("bush", b.key),
    title: b.title,
    description: `${b.text.charAt(0).toUpperCase()}${b.text.slice(1)}.${countText} It stands on y = 0; the front faces +z.`,
    tags: [b.key.replace("-", " "), b.dutch, b.style, ...(b.style === "hedge" ? ["hedge", "haag", "heg"] : []), ...(b.style === "topiary" ? ["topiary", "vormsnoei", "pot", "pot plant", "potplant"] : [])],
    params,
    materials: natureMats(mats, ...m),
    nodes: [group("Shrub", nodes)],
  };
}

export const bushFamily: Family = {
  id: "bush",
  category: "nature",
  archetype: "plant.bush",
  tags: ["bush", "shrub", "struik", "heester", "garden", "tuin", "plant", "nature", "natuur"],
  assets: () => BUSHES.map((b, k) => bushAsset(b, k)),
};
