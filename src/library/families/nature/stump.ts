import { cyl, ellipsoid, group, int, lathe, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { natureMats } from "./common.js";

type Style = "cut" | "broken" | "log" | "hollow" | "pile";

interface Stump {
  style: Style;
  key: string;
  title: string;
  dutch: string;
  bark: string;
  heart: string;
  moss: boolean;
  text: string;
}

const STUMPS: Stump[] = [
  { style: "cut", key: "oak", title: "Oak tree stump", dutch: "eiken boomstronk", bark: "bark_dark", heart: "heartwood", moss: false, text: "a freshly sawn oak stump flaring into thick surface roots, the flat top showing growth rings round a darker heart" },
  { style: "cut", key: "birch", title: "Birch tree stump", dutch: "berken boomstronk", bark: "bark_birch", heart: "sapwood", moss: false, text: "a slim birch stump in white bark with a pale, ringed cut face and a few thin roots" },
  { style: "cut", key: "pine", title: "Pine tree stump", dutch: "dennen boomstronk", bark: "bark_red", heart: "heartwood", moss: false, text: "a pine stump in red-brown bark with a resinous, ringed cut face and spreading roots" },
  { style: "cut", key: "mossy", title: "Mossy tree stump", dutch: "bemoste boomstronk", bark: "bark_brown", heart: "rotten_wood", moss: true, text: "an old, weathered stump with dark, rotting rings, moss creeping over the top and the roots" },
  { style: "broken", key: "oak", title: "Broken oak stump", dutch: "afgebroken boomstronk", bark: "bark_dark", heart: "heartwood", moss: false, text: "a tall stump snapped off by a storm, its top a crown of jagged splinters around pale wood" },
  { style: "broken", key: "dead", title: "Dead grey snag", dutch: "dode stronk", bark: "bark_grey", heart: "weathered_wood", moss: true, text: "a weathered grey snag of a dead tree with splintered top, moss on its foot and shelf fungi on the side" },
  { style: "log", key: "oak", title: "Fallen oak log", dutch: "omgevallen eikenstam", bark: "bark_dark", heart: "heartwood", moss: false, text: "a fallen oak log lying along z with sawn, ringed ends and a few broken branch stubs" },
  { style: "log", key: "birch", title: "Fallen birch log", dutch: "berkenstam", bark: "bark_birch", heart: "sapwood", moss: false, text: "a white birch log lying along z with pale cut ends and two branch stubs" },
  { style: "log", key: "mossy", title: "Mossy fallen log", dutch: "bemoste stam", bark: "bark_brown", heart: "rotten_wood", moss: true, text: "an old log lying along z, half covered in moss, with soft, rotting ends" },
  { style: "hollow", key: "oak", title: "Hollow log", dutch: "holle boomstam", bark: "bark_dark", heart: "heartwood", moss: false, text: "a hollow log lying along z: a thick ring of wood open at both ends, big enough for an animal to hide in" },
  { style: "hollow", key: "rotten", title: "Rotten hollow log", dutch: "rotte holle stam", bark: "bark_brown", heart: "rotten_wood", moss: false, text: "a rotten hollow log lying along z, its thin shell dark and soft, with shelf fungi on top" },
  { style: "hollow", key: "mossy", title: "Mossy hollow log", dutch: "bemoste holle stam", bark: "bark_grey", heart: "rotten_wood", moss: true, text: "a moss-covered hollow log lying along z, open at both ends" },
  { style: "pile", key: "pine", title: "Pine log pile", dutch: "stapel dennenstammen", bark: "bark_red", heart: "heartwood", moss: false, text: "a stacked pile of six sawn pine logs, three on the ground, two on them and one on top, all lying along z with ringed ends" },
  { style: "pile", key: "birch", title: "Birch log pile", dutch: "stapel berkenhout", bark: "bark_birch", heart: "sapwood", moss: false, text: "a stacked pile of six white birch logs lying along z, the cut ends showing pale rings" },
];

/** Growth rings on a cut face of radius $fr, facing +y, from y = 0 up: alternating light and dark discs, a little higher toward the heart. */
const rings = (heart: string): SpecNode[] => [
  cyl("Face", "$fr * 0.96", 0.012, { at: [0, -0.006, 0], segments: 24, material: "sapwood" }),
  cyl("Line_{i}", "$fr * (0.89 - 0.8 * $i / $rings)", 0.004, { at: [0, "0.0012 + 0.0015 * $i", 0], segments: 24, material: "rotten_wood", repeat: { count: "$rings", step: [0, 0, 0] } }),
  cyl("Ring_{i}", "$fr * (0.86 - 0.8 * $i / $rings)", 0.004, { at: [0, "0.002 + 0.0015 * $i", 0], segments: 24, material: heart, repeat: { count: "$rings", step: [0, 0, 0] } }),
  cyl("Pith", "$fr * 0.05 + 0.004", 0.004, { at: [0, "0.004 + 0.0015 * $rings", 0], segments: 10, material: "rotten_wood" }),
];

/** A log of radius $r and length $len along z, its axis at the local origin, with ringed ends. */
function logBody(name: string, s: Stump, extra: SpecNode[] = []): SpecNode {
  return group(name, [
    cyl("Bark", "$r", "$len", { axis: "z", segments: 20, bevel: "$r * 0.08", material: s.bark }),
    group("EndFront", rings(s.heart), { at: [0, 0, "$len / 2 - 0.004"], rotate: [90, 0, 0], vars: { fr: "$r * 0.95" } }),
    group("EndBack", rings(s.heart), { at: [0, 0, "-$len / 2 + 0.004"], rotate: [-90, 0, 0], vars: { fr: "$r * 0.95" } }),
    ...extra,
  ]);
}

function stumpAsset(s: Stump): AssetDraft {
  const mossMat = s.moss ? ["moss"] : [];
  const fungus = s.key === "dead" || s.key === "rotten";
  let nodes: SpecNode[];
  let params;
  switch (s.style) {
    case "cut":
    case "broken": {
      const tall = s.style === "broken";
      const roots = tube("Root_{i}", [["$r * 0.55", "$h * 0.3", 0], ["$r * 1.25", "$h * 0.12 + $r * 0.12", "$r * 0.08"], ["$r * 2", "$r * 0.1", "$r * 0.05"], ["$r * 2.6", "$r * 0.05", "-$r * 0.05"]], ["$r * 0.36", "$r * 0.24", "$r * 0.1", "$r * 0.045"], {
        segments: 8,
        rotate: [0, "11 * sin($i * 2.3)", 0],
        repeat: { count: "$roots", around: "y", phase: 15 },
      });
      const body = lathe("Wood", [["$r * 1.32", 0], ["$r * 1.12", "$h * 0.12"], ["$r * 1.02", "$h * 0.4"], ["$r", tall ? "$h * 0.75" : "$h"], ...(tall ? [["$r * 0.97", "$h * 0.8"] as [string, string]] : [])], { segments: 20, material: s.bark });
      const top: SpecNode[] = tall
        ? [
            group("Break", [
              ellipsoid("Core", ["$r * 0.85", "$h * 0.1", "$r * 0.85"], { at: [0, "$h * 0.8", 0], segments: 14, lumps: 0.3, seed: 7, material: s.heart }),
              lathe("Splinter_{i}", [["$r * 0.24", "$h * 0.74"], ["$r * 0.18", "$h * (0.86 + 0.08 * sin($i * 2.7))"], ["$r * 0.04", "$h * (0.94 + 0.06 * sin($i * 1.9))"], ["$r * 0.01", "$h * (0.98 + 0.02 * sin($i * 1.9))"]], { at: ["$r * 0.72", 0, 0], segments: 5, material: s.heart, repeat: { count: 7, around: "y", phase: 10 } }),
            ]),
          ]
        : [group("Cut", rings(s.heart), { at: [0, "$h", 0], vars: { fr: "$r" } })];
      const extras: SpecNode[] = [];
      if (s.moss) extras.push(ellipsoid("Moss", ["$r * 1.15", "$r * 0.2", "$r * 1.05"], { at: ["$r * 0.4", "$r * 0.26", "$r * 0.3"], segments: 14, lumps: 0.3, seed: 11, material: "moss" }));
      if (s.moss && !tall) extras.push(ellipsoid("MossTop", ["$r * 0.55", "$r * 0.08", "$r * 0.45"], { at: ["$r * 0.3", "$h + 0.01", "-$r * 0.2"], segments: 12, lumps: 0.3, seed: 12, material: "moss" }));
      if (fungus) extras.push(ellipsoid("Fungus_{i}", ["$r * 0.3", "$r * 0.07", "$r * 0.22"], { at: ["$r * 0.98", "$h * (0.35 + 0.12 * $i)", "$r * 0.1 * $i"], rotate: [0, "$i * 25", -8], segments: 12, material: "fungus_shelf", repeat: { count: 3, step: [0, 0, 0] } }));
      nodes = [group("Stump", [body, ...top, group("Roots", [roots], { material: s.bark }), ...extras], { vars: { r: "$radius", h: "$height" } })];
      params = [
        num("radius", s.key === "birch" ? 0.18 : tall ? 0.35 : 0.3, 0.1, 0.6, "Radius of the trunk at the cut, in metres."),
        num("height", tall ? 1.1 : 0.4, tall ? 0.6 : 0.2, tall ? 1.5 : 0.8, "Height of the stump in metres."),
        int("roots", 5, 3, 7, "Number of surface roots."),
        int("rings", s.key === "mossy" ? 5 : 8, 4, 12, "Number of visible growth rings on the top."),
      ];
      if (tall) params.pop();
      break;
    }
    case "log": {
      const stubs = [
        tube("Stub_1", [[0, "$r * 0.6", "$len * 0.15"], ["$r * 0.3", "$r * 1.3", "$len * 0.2"]], ["$r * 0.25", "$r * 0.18"], { segments: 8 }),
        tube("Stub_2", [["-$r * 0.5", "$r * 0.3", "-$len * 0.2"], ["-$r * 1.35", "$r * 0.6", "-$len * 0.26"]], ["$r * 0.22", "$r * 0.15"], { segments: 8 }),
        tube("Stub_3", [["$r * 0.6", "-$r * 0.1", "-$len * 0.32"], ["$r * 1.3", "$r * 0.1", "-$len * 0.36"]], ["$r * 0.2", "$r * 0.13"], { segments: 8 }),
      ];
      const extra: SpecNode[] = [group("Stubs", stubs, { material: s.bark })];
      if (s.moss) extra.push(ellipsoid("Moss_{i}", ["$r * 0.85", "$r * 0.35", "min($len * 0.12, $r * 1.4)"], { at: ["$r * 0.15 * sin($i * 2.1)", "$r * 0.72", "-$len * 0.36 + $len * 0.18 * $i"], segments: 14, lumps: 0.2, seed: "$i * 3 + 2", material: "moss", repeat: { count: 5, step: [0, 0, 0] } }));
      nodes = [group("Log", [logBody("Wood", s, extra)], { at: [0, "$r", 0], vars: { r: "$radius", len: "$length" } })];
      params = [
        num("radius", s.key === "birch" ? 0.18 : 0.3, 0.12, 0.6, "Radius of the log in metres."),
        num("length", s.key === "birch" ? 2.5 : 3.5, 1, 7, "Length of the log along z, in metres."),
        int("rings", 7, 4, 12, "Growth rings on each cut end."),
      ];
      break;
    }
    case "hollow": {
      const shell = s.key === "rotten" ? 0.18 : 0.3;
      const extra: SpecNode[] = [];
      if (s.moss) extra.push(ellipsoid("Moss_{i}", ["$r * 0.9", "$r * 0.3", "min($len * 0.14, $r * 1.2)"], { at: ["$r * 0.1 * sin($i * 1.7)", "$r * 0.8", "-$len * 0.3 + $len * 0.2 * $i"], segments: 14, lumps: 0.2, seed: "$i * 5 + 5", material: "moss", repeat: { count: 4, step: [0, 0, 0] } }));
      if (fungus) extra.push(ellipsoid("Fungus_{i}", ["$r * 0.25", "$r * 0.06", "$r * 0.2"], { at: ["$r * 0.95", "$r * 0.1", "-$len * 0.2 + $len * 0.15 * $i"], rotate: [0, 0, -10], segments: 12, material: "fungus_shelf", repeat: { count: 3, step: [0, 0, 0] } }));
      const ri = `$r * ${1 - shell}`;
      nodes = [group("Log", [
        group("Wood", [
          // A ring of wood: the profile runs round the cross-section of the wall and closes on itself.
          lathe("Shell", [[`($r + ${ri}) / 2`, "-$len / 2"], ["$r * 0.97", "-$len / 2 + 0.005"], ["$r", "-$len / 2 + $r * 0.05"], ["$r", "$len / 2 - $r * 0.05"], ["$r * 0.97", "$len / 2 - 0.005"], [`($r + ${ri}) / 2`, "$len / 2"], [ri, "$len / 2 - 0.01"], [ri, "-$len / 2 + 0.01"], [`($r + ${ri}) / 2`, "-$len / 2"]], { segments: 20, caps: false, rotate: [90, 0, 0], material: s.bark }),
          lathe("Inner", [[`${ri} * 1.01`, "-$len / 2 + 0.012"], [`${ri} * 1.01`, "$len / 2 - 0.012"], [`${ri} * 1.05`, "$len / 2 - 0.006"], [`${ri} * 1.05`, "-$len / 2 + 0.006"], [`${ri} * 1.01`, "-$len / 2 + 0.012"]], { segments: 20, caps: false, rotate: [90, 0, 0], material: s.heart }),
          ...extra,
        ]),
      ], { at: [0, "$r", 0], vars: { r: "$radius", len: "$length" } })];
      params = [
        num("radius", 0.4, 0.2, 0.75, "Outer radius of the log in metres."),
        num("length", 2.5, 1, 5, "Length of the log along z, in metres."),
      ];
      break;
    }
    case "pile": {
      const at: [string, string][] = [["-$r * 2.02", "$r"], ["0", "$r"], ["$r * 2.02", "$r"], ["-$r * 1.01", "$r * 2.72"], ["$r * 1.01", "$r * 2.72"], ["0", "$r * 4.44"]];
      nodes = [group("Pile", at.map(([x, y], k) => group(`Log_${k + 1}`, [logBody("Wood", s)], { at: [x, y, `$len * ${[0.02, -0.03, 0.04, -0.02, 0.03, 0][k]}`], rotate: [0, 0, k * 47] })), { vars: { r: "$radius", len: "$length" } })];
      params = [
        num("radius", s.key === "birch" ? 0.1 : 0.14, 0.06, 0.25, "Radius of each log in metres."),
        num("length", s.key === "birch" ? 0.9 : 1.2, 0.4, 2.5, "Length of the logs along z, in metres."),
        int("rings", 6, 3, 10, "Growth rings on each cut end."),
      ];
      break;
    }
  }
  return {
    slug: slugify("stump", s.style, s.key),
    title: s.title,
    description: `${s.text.charAt(0).toUpperCase()}${s.text.slice(1)}. It rests on y = 0; the front faces +z.`,
    tags: [s.style, s.key, s.dutch, ...(s.style === "log" || s.style === "hollow" ? ["log", "fallen log", "boomstam"] : []), ...(s.style === "pile" ? ["firewood", "brandhout", "houtstapel"] : []), ...(s.moss ? ["moss", "mos"] : [])],
    params,
    materials: natureMats(mats, s.bark, s.heart, "sapwood", "rotten_wood", ...mossMat, ...(fungus ? ["fungus_shelf"] : [])),
    nodes,
  };
}

export const stumpFamily: Family = {
  id: "stump",
  category: "nature",
  archetype: "plant.stump",
  tags: ["stump", "stronk", "log", "boomstam", "wood", "hout", "forest", "bos", "nature", "natuur"],
  assets: () => STUMPS.map(stumpAsset),
};
