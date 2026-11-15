import { cyl, ellipsoid, group, int, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats } from "../../palette.js";
import { n4, natureMats } from "./common.js";

/** One ring of blades: count (a number or "$blades"), length and width in shares of $height, lean and curl. */
interface Ring {
  name: string;
  count: string | number;
  len: number;
  width: number;
  /** Lean from upright, degrees. */
  lean: number;
  /** Sideways curl of the tip, in blade lengths. */
  curl: number;
  /** Distance from the centre, as a share of $radius. */
  at: number;
  material: "main" | "light" | "accent";
  phase: number;
}

interface Grass {
  style: "tuft" | "meadow" | "reeds" | "clump";
  key: string;
  title: string;
  dutch: string;
  main: string;
  light: string;
  accent?: string;
  height: [number, number, number];
  radius: [number, number, number];
  blades: [number, number, number];
  rings: Ring[];
  heads?: "seed" | "plume" | "cattail" | "fiddle";
  text: string;
}

const tuftRings = (lean: number, curl: number): Ring[] => [
  { name: "Blade_{i}", count: "$blades", len: 0.95, width: 0.035, lean: lean + 18, curl, at: 0.55, material: "main", phase: 0 },
  { name: "BladeMid_{i}", count: 9, len: 1.0, width: 0.035, lean: lean + 6, curl: curl * 0.7, at: 0.3, material: "light", phase: 17 },
  { name: "BladeCore_{i}", count: 5, len: 0.85, width: 0.04, lean: lean - 4, curl: curl * 0.4, at: 0.1, material: "main", phase: 40 },
];

const GRASSES: Grass[] = [
  { style: "tuft", key: "lawn", title: "Lawn grass tuft", dutch: "graspol", main: "blade_green", light: "blade_light", height: [0.18, 0.08, 0.35], radius: [0.12, 0.06, 0.25], blades: [16, 10, 24], rings: tuftRings(6, 0.15), text: "a dense tuft of short, fresh green grass blades curling outward" },
  { style: "tuft", key: "spring", title: "Fresh grass tuft", dutch: "jong gras", main: "blade_light", light: "blade_green", height: [0.3, 0.12, 0.5], radius: [0.15, 0.08, 0.3], blades: [18, 10, 26], rings: tuftRings(10, 0.25), text: "a soft, light green tuft of longer blades bending over at the tips" },
  { style: "tuft", key: "dry", title: "Dry grass tuft", dutch: "droog gras", main: "blade_dry", light: "blade_green", height: [0.35, 0.15, 0.6], radius: [0.18, 0.08, 0.3], blades: [20, 12, 28], rings: tuftRings(16, 0.35), text: "a straw-coloured tuft of dry, flopping blades with a few green ones left inside" },
  { style: "meadow", key: "green", title: "Meadow grass with seed heads", dutch: "hooiland gras", main: "blade_green", light: "blade_light", accent: "grass_dry", height: [0.7, 0.35, 1.1], radius: [0.2, 0.1, 0.35], blades: [14, 8, 22], heads: "seed", rings: [{ name: "Blade_{i}", count: "$blades", len: 0.6, width: 0.018, lean: 22, curl: 0.25, at: 0.4, material: "main", phase: 0 }, { name: "BladeLight_{i}", count: 8, len: 0.5, width: 0.02, lean: 12, curl: 0.2, at: 0.2, material: "light", phase: 20 }], text: "a meadow clump: arching green blades below tall, thin stalks carrying nodding seed heads" },
  { style: "meadow", key: "hay", title: "Dry meadow grass", dutch: "hooi", main: "blade_dry", light: "grass_dry", accent: "grass_dry", height: [0.8, 0.4, 1.2], radius: [0.22, 0.1, 0.35], blades: [16, 8, 24], heads: "seed", rings: [{ name: "Blade_{i}", count: "$blades", len: 0.55, width: 0.016, lean: 28, curl: 0.3, at: 0.4, material: "main", phase: 0 }, { name: "BladeLight_{i}", count: 8, len: 0.45, width: 0.018, lean: 16, curl: 0.25, at: 0.2, material: "light", phase: 20 }], text: "a late-summer clump of dry, straw-coloured blades and ripe seed heads" },
  { style: "meadow", key: "red", title: "Red fountain grass", dutch: "lampenpoetsersgras", main: "blade_red", light: "blade_green", accent: "plume_cream", height: [0.9, 0.5, 1.2], radius: [0.28, 0.15, 0.45], blades: [20, 12, 28], heads: "plume", rings: [{ name: "Blade_{i}", count: "$blades", len: 0.7, width: 0.014, lean: 35, curl: 0.45, at: 0.3, material: "main", phase: 0 }, { name: "BladeLight_{i}", count: 10, len: 0.65, width: 0.014, lean: 18, curl: 0.3, at: 0.15, material: "main", phase: 18 }], text: "an ornamental fountain grass: a cascade of burgundy blades with fluffy, arching bottlebrush plumes" },
  { style: "reeds", key: "common", title: "Reed clump", dutch: "riet", main: "blade_green", light: "blade_light", accent: "reed_brown", height: [1.0, 0.6, 1.2], radius: [0.2, 0.1, 0.35], blades: [10, 6, 16], heads: "plume", rings: [{ name: "Blade_{i}", count: "$blades", len: 0.85, width: 0.022, lean: 8, curl: 0.12, at: 0.45, material: "main", phase: 0 }, { name: "BladeLight_{i}", count: 6, len: 0.95, width: 0.02, lean: 4, curl: 0.08, at: 0.2, material: "light", phase: 30 }], text: "a clump of tall, stiff reeds with feathery brown plumes on the tallest stems, for a pond edge" },
  { style: "reeds", key: "cattail", title: "Cattails", dutch: "lisdodde", main: "blade_green", light: "blade_light", accent: "reed_brown", height: [1.1, 0.6, 1.2], radius: [0.18, 0.1, 0.3], blades: [9, 6, 14], heads: "cattail", rings: [{ name: "Blade_{i}", count: "$blades", len: 0.95, width: 0.02, lean: 6, curl: 0.1, at: 0.4, material: "main", phase: 0 }, { name: "BladeLight_{i}", count: 5, len: 0.85, width: 0.018, lean: 3, curl: 0.06, at: 0.15, material: "light", phase: 30 }], text: "cattails (bulrushes): tall, flat, upright leaves and stiff stalks with brown velvety sausage-shaped heads" },
  { style: "reeds", key: "rush", title: "Soft rush", dutch: "pitrus", main: "blade_green", light: "blade_light", height: [0.7, 0.4, 1.1], radius: [0.16, 0.08, 0.3], blades: [24, 14, 30], rings: [{ name: "Blade_{i}", count: "$blades", len: 1.0, width: 0.008, lean: 14, curl: 0.06, at: 0.4, material: "main", phase: 0 }, { name: "BladeMid_{i}", count: 14, len: 0.95, width: 0.008, lean: 6, curl: 0.04, at: 0.2, material: "light", phase: 12 }, { name: "BladeCore_{i}", count: 8, len: 0.9, width: 0.008, lean: 2, curl: 0.02, at: 0.05, material: "main", phase: 30 }], text: "a dense, upright fountain of thin, needle-like rush stems" },
  { style: "clump", key: "fern", title: "Fern clump", dutch: "varen", main: "fern_green", light: "blade_light", accent: "fern_green", height: [0.6, 0.3, 1.0], radius: [0.35, 0.2, 0.6], blades: [9, 6, 14], heads: "fiddle", rings: [{ name: "Blade_{i}", count: "$blades", len: 1.1, width: 0.11, lean: 50, curl: 0.3, at: 0.15, material: "main", phase: 0 }, { name: "BladeInner_{i}", count: 4, len: 0.9, width: 0.09, lean: 25, curl: 0.2, at: 0.05, material: "light", phase: 45 }], text: "a fern: broad, arching fronds rising in a shuttlecock from the centre, with young curled fiddleheads" },
  { style: "clump", key: "fescue", title: "Blue fescue", dutch: "blauw schapengras", main: "blade_blue", light: "blade_light", height: [0.28, 0.15, 0.45], radius: [0.16, 0.08, 0.28], blades: [26, 16, 30], rings: [{ name: "Blade_{i}", count: "$blades", len: 0.9, width: 0.012, lean: 38, curl: 0.12, at: 0.15, material: "main", phase: 0 }, { name: "BladeMid_{i}", count: 16, len: 1.0, width: 0.012, lean: 20, curl: 0.08, at: 0.08, material: "main", phase: 11 }, { name: "BladeCore_{i}", count: 8, len: 1.0, width: 0.012, lean: 4, curl: 0.04, at: 0.02, material: "light", phase: 23 }], text: "a round, spiky hedgehog of fine steel-blue blades" },
  { style: "clump", key: "sedge", title: "Sedge clump", dutch: "zegge", main: "blade_light", light: "blade_green", accent: "reed_brown", height: [0.5, 0.25, 0.8], radius: [0.3, 0.15, 0.5], blades: [18, 10, 26], heads: "seed", rings: [{ name: "Blade_{i}", count: "$blades", len: 1.0, width: 0.02, lean: 45, curl: 0.4, at: 0.15, material: "main", phase: 0 }, { name: "BladeMid_{i}", count: 10, len: 0.95, width: 0.022, lean: 25, curl: 0.25, at: 0.08, material: "light", phase: 18 }], text: "an arching sedge clump of long, glossy, fountaining leaves with a few dark seed spikes" },
];

/** One blade along +z (later turned upright): a narrow, V-folded strip that tapers and curls toward +x. */
function blade(ring: Ring, mat: string): SpecNode {
  const us = [0, 0.25, 0.5, 0.75, 1];
  const len = `$height * ${n4(ring.len)}`;
  const sections = us.map((u) => {
    const x = `(${len} * ${n4(ring.curl * u * u)})`;
    const w = `($height * ${n4(ring.width * (1 - 0.85 * u))} + 0.0008)`;
    return {
      z: `${len} * ${n4(u)} * (0.9 + 0.1 * sin($i * 2.7))`,
      points: [
        [`${x} + ${w}`, `${w} * 0.4`],
        [x, `${w} * 0.12`],
        [`${x} - ${w}`, `${w} * 0.4`],
        [x, "0"],
      ],
    };
  });
  return group(ring.name, [loft("Strip", sections, { rotate: [-90, 0, 0] })], {
    material: mat,
    at: [`$radius * ${n4(ring.at)}`, `$height * ${n4(ring.width * 0.9)}`, 0],
    rotate: [0, `13 * sin($i * 1.9)`, `-${ring.lean} - 8 * sin($i * 2.3)`],
    repeat: { count: ring.count, around: "y", phase: ring.phase },
  });
}

function heads(g: Grass): SpecNode[] {
  const accent = g.accent ?? g.main;
  switch (g.heads) {
    case "seed":
      return [group("Stalk_{i}", [
        tube("Culm", [[0, 0, 0], ["$height * 0.05", "$height * 0.6", 0], ["$height * 0.14", "$height", 0]], ["$height * 0.006 + 0.001", "$height * 0.005 + 0.001", "$height * 0.004 + 0.001"], { segments: 5, material: g.main }),
        ellipsoid("Seedhead", ["$height * 0.018 + 0.003", "$height * 0.07", "$height * 0.018 + 0.003"], { at: ["$height * 0.15", "$height * 0.98", 0], rotate: [0, 0, -18], segments: 8, material: accent }),
      ], { at: ["$radius * 0.2", 0, 0], repeat: { count: 5, around: "y", phase: 33 } })];
    case "plume":
      return [group("Stalk_{i}", [
        tube("Culm", [[0, 0, 0], ["$height * 0.04", "$height * 0.6", 0], ["$height * 0.16", "$height * 1.02", 0]], ["$height * 0.006 + 0.001", "$height * 0.005 + 0.001", "$height * 0.004 + 0.001"], { segments: 5, material: g.main }),
        ellipsoid("Plume", ["$height * 0.035 + 0.004", "$height * 0.12", "$height * 0.03 + 0.004"], { at: ["$height * 0.2", "$height * 1.05", 0], rotate: [0, 0, -30], segments: 10, material: accent }),
      ], { at: ["$radius * 0.25", 0, 0], repeat: { count: 4, around: "y", phase: 20 } })];
    case "cattail":
      return [group("Stalk_{i}", [
        tube("Culm", [[0, 0, 0], ["$height * 0.02", "$height * 0.6", 0], ["$height * 0.03", "$height * 1.1", 0]], ["$height * 0.008 + 0.002", "$height * 0.007 + 0.002", "$height * 0.004 + 0.001"], { segments: 6, material: "blade_green" }),
        cyl("Spike", "$height * 0.022 + 0.004", "$height * 0.14", { at: ["$height * 0.026", "$height * 0.92", 0], segments: 10, bevel: "$height * 0.01", material: accent }),
      ], { at: ["$radius * 0.25", 0, 0], repeat: { count: 3, around: "y", phase: 10 } })];
    case "fiddle":
      return [group("Fiddle_{i}", [
        tube("Coil", [[0, 0, 0], [0, "$height * 0.25", 0], ["$height * 0.03", "$height * 0.36", 0]], ["$height * 0.012 + 0.002", "$height * 0.011 + 0.002", "$height * 0.01 + 0.002"], { segments: 6, material: accent }),
        ellipsoid("Curl", ["$height * 0.04 + 0.003", "$height * 0.04 + 0.003", "$height * 0.025 + 0.002"], { at: ["$height * 0.06", "$height * 0.38", 0], segments: 10, material: accent }),
      ], { at: ["$radius * 0.08", 0, 0], repeat: { count: 3, around: "y", phase: 70 } })];
    default:
      return [];
  }
}

function grassAsset(g: Grass): AssetDraft {
  const matFor = (r: Ring): string => (r.material === "main" ? g.main : r.material === "light" ? g.light : g.accent ?? g.main);
  const nodes: SpecNode[] = [group("Grass", [...g.rings.map((r) => blade(r, matFor(r))), ...heads(g)])];
  const extraCounts = g.rings.filter((r) => typeof r.count === "number").reduce((a, r) => a + (r.count as number), 0);
  return {
    slug: slugify("grass", g.style, g.key),
    title: g.title,
    description: `${g.text.charAt(0).toUpperCase()}${g.text.slice(1)}. The outer ring has a set number of blades and ${extraCounts} more stand inside; the blades are thin, V-folded, two-sided strips. It stands on y = 0; the front faces +z.`,
    tags: [g.style, g.key, g.dutch, ...(g.style === "reeds" ? ["reed", "riet", "pond", "vijver"] : []), ...(g.key === "fern" ? ["fern", "varen"] : [])],
    params: [
      num("height", g.height[0], g.height[1], g.height[2], "Height of the tallest blades in metres."),
      num("radius", g.radius[0], g.radius[1], g.radius[2], "Radius of the clump at its foot, in metres."),
      int("blades", g.blades[0], g.blades[1], g.blades[2], "Number of blades in the outer ring."),
    ],
    materials: natureMats(mats, g.main, g.light, ...(g.accent ? [g.accent] : []), ...(g.heads === "cattail" ? ["blade_green"] : [])),
    nodes,
  };
}

export const grassFamily: Family = {
  id: "grass",
  category: "nature",
  archetype: "plant.grass",
  tags: ["grass", "gras", "tuft", "pol", "plant", "ground cover", "bodembedekker", "nature", "natuur"],
  assets: () => GRASSES.map(grassAsset),
};
