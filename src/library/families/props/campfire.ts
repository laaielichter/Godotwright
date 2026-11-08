import { box, cyl, ellipsoid, group, int, lathe, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { finish } from "./finishes.js";

/**
 * Campfires: a teepee in a stone ring, a log-cabin stack, a fire basket (brazier), a star fire under a cooking tripod
 * and a lean-to against a back log. Each comes burning (embers, flame tongues and a particle origin) or burnt out
 * (grey ash, charred ends). Logs are separate nodes (Log_*), so a fire can burn down by hiding them. On y = 0, facing +z.
 */
type Style = "teepee" | "cabin" | "brazier" | "star" | "leanto";

interface Finish {
  lit: boolean;
  bark: string;
  stone: string;
}

const FINISHES: Record<Style, [Finish, Finish]> = {
  teepee: [{ lit: true, bark: "bark_brown", stone: "granite" }, { lit: false, bark: "bark_birch", stone: "mossy_rock" }],
  cabin: [{ lit: true, bark: "bark_grey", stone: "sandstone" }, { lit: false, bark: "bark_brown", stone: "granite" }],
  brazier: [{ lit: true, bark: "bark_brown", stone: "granite" }, { lit: false, bark: "bark_birch", stone: "granite" }],
  star: [{ lit: true, bark: "bark_dark", stone: "basalt" }, { lit: false, bark: "bark_grey", stone: "granite" }],
  leanto: [{ lit: true, bark: "bark_red", stone: "red_rock" }, { lit: false, bark: "bark_brown", stone: "slate" }],
};

/** The real finishes behind the finish keys (the keys stay in the slugs). */
const BARK: Record<string, string> = { bark_brown: "bark_pine", bark_birch: "bark_birch_real", bark_grey: "bark_grey_real", bark_dark: "bark_oak", bark_red: "bark_pine" };
const ROCK: Record<string, string> = { granite: "rock_grey", mossy_rock: "rock_mossy", sandstone: "rock_sand", basalt: "rock_dark", red_rock: "rock_red", slate: "rock_slate" };

/**
 * A log of length L and radius r along local x: bark, a pale cut at +x and a glowing (lit) or charred tip at -x.
 * The node sits at the log's centre.
 */
const log = (name: string, L: Num, r: Num, f: Finish, o: { at?: [Num, Num, Num]; rotate?: [Num, Num, Num]; repeat?: { count: Num; around?: "y"; phase?: Num; step?: [Num, Num, Num] } } = {}): SpecNode =>
  group(name, [
    cyl("Bark", r, L, { axis: "x", segments: 10, material: BARK[f.bark] }),
    cyl("Cut", `${r} * 0.88`, 0.01, { axis: "x", at: [`${L} / 2 + 0.002`, 0, 0], segments: 10, material: "wood_cut" }),
    cyl("Singe", `${r} * 1.01`, `${L} * ${f.lit ? 0.36 : 0.5}`, { axis: "x", at: [`-${L} / 2 + ${L} * ${f.lit ? 0.18 : 0.25}`, 0, 0], segments: 10, material: "scorched_wood" }),
    cyl("Char", `${r} * 1.025`, `${L} * ${f.lit ? 0.22 : 0.32}`, { axis: "x", at: [`-${L} / 2 + ${L} * ${f.lit ? 0.11 : 0.16}`, 0, 0], segments: 10, material: "charred" }),
    ellipsoid("Tip", [`${r} * 0.7`, `${r} * 0.96`, `${r} * 0.96`], { at: [`-${L} / 2`, 0, 0], segments: 10, material: f.lit ? "ember_tip" : "charred" }),
  ], o);

/** A glowing bed of embers (lit) or a grey ash mound of radius rb, strewn with glowing coals or pale cinders. */
const bed = (f: Finish, rb: Num, y: Num = 0): SpecNode =>
  group(f.lit ? "GlowBed" : "ColdBed", [
    lathe(f.lit ? "Embers" : "Ash", [[0.02, `${y} + 0.05`], [`${rb} * 0.4`, `${y} + 0.045`], [`${rb} * 0.75`, `${y} + 0.025`], [rb, `${y} + 0.004`], [0.02, `${y} + 0.002`]], { segments: 24, material: f.lit ? "ember_bed" : "ash_grey" }),
    ellipsoid("Chunk_{i}", [`${rb} * 0.09`, `${rb} * 0.05`, `${rb} * 0.07`], { at: [`${rb} * (0.25 + 0.5 * abs(sin($i * 1.7))) * cos($i * 2.4)`, `${y} + 0.05 - 0.04 * (0.25 + 0.5 * abs(sin($i * 1.7)))`, `${rb} * (0.25 + 0.5 * abs(sin($i * 1.7))) * sin($i * 2.4)`], segments: 8, lumps: 0.4, seed: "$i * 3 + 2", material: f.lit ? "ember_glow" : "ash_white", repeat: { count: 9, step: [0, 0, 0] } }),
    ellipsoid("Cinder_{i}", [`${rb} * 0.07`, `${rb} * 0.04`, `${rb} * 0.05`], { at: [`${rb} * (0.35 + 0.4 * abs(cos($i * 1.3))) * cos($i * 2.4 + 1.2)`, `${y} + 0.045 - 0.04 * (0.35 + 0.4 * abs(cos($i * 1.3)))`, `${rb} * (0.35 + 0.4 * abs(cos($i * 1.3))) * sin($i * 2.4 + 1.2)`], segments: 8, lumps: 0.4, seed: "$i * 7 + 5", material: "charred", repeat: { count: 6, step: [0, 0, 0] } }),
  ]);

/** Trampled dirt round the fire with a scorched circle in the middle. */
const hearth = (r0: Num, r1: Num): SpecNode[] => [
  lathe("Hearth", [[0.02, 0.008], [r0, 0.006], [r1, 0.001], [0.02, 0.001]], { segments: 24, material: "dirt" }),
  lathe("Scorch", [[0.02, 0.011], [`${r0} * 0.85`, 0.009], [`${r0} * 1.05`, 0.0055], [0.02, 0.0055]], { segments: 24, material: "scorched_earth" }),
];

/** Flame tongues of height h around the centre, with a particle origin; nothing when the fire is out. */
const flame = (f: Finish, h: Num, spread: Num, y: Num = 0): SpecNode[] =>
  f.lit
    ? [group("Flame", [
      tube("Tongue_{i}", [[`${spread} * 0.7`, 0, 0], [`${spread} * 0.95`, `${h} * (0.55 + 0.45 * pow(sin($i * 2.3 + 0.7), 2)) * 0.25`, 0.02], [`${spread} * 0.45`, `${h} * (0.55 + 0.45 * pow(sin($i * 2.3 + 0.7), 2)) * 0.6`, -0.02], [`${spread} * 0.15`, `${h} * (0.55 + 0.45 * pow(sin($i * 2.3 + 0.7), 2))`, 0.03]], [`${spread} * 0.45 + 0.01`, `${spread} * 0.35 + 0.008`, `${spread} * 0.16 + 0.004`, 0.003], { segments: 8, repeat: { count: 7, around: "y", phase: 15 }, material: "flame_outer" }),
      tube("Core", [[0, 0, 0], [0.01, `${h} * 0.3`, 0], [-0.01, `${h} * 0.55`, 0.01], [0, `${h} * 0.7`, 0]], [`${spread} * 0.6 + 0.01`, `${spread} * 0.45 + 0.008`, `${spread} * 0.2 + 0.004`, 0.003], { segments: 10, material: "flame_inner" }),
      group("ParticleOrigin", [], { at: [0, 0.05, 0] }),
    ], { at: [0, y, 0] })]
    : [];

/** A ring of n lumpy stones of size rs at radius R. */
const stones = (f: Finish, n: Num, R: Num, rs: Num): SpecNode =>
  group("Stones", [
    ellipsoid("Stone_{i}", [`${rs} * 1.1`, `${rs} * 0.7`, `${rs} * 0.85`], { at: [R, `${rs} * 0.6`, 0], segments: 10, lumps: 0.3, seed: "$i * 7 + 3", repeat: { count: n, around: "y" } }),
  ], { material: ROCK[f.stone] });

function teepee(f: Finish): SpecNode[] {
  return [
    group("Campfire", [
      ...hearth("$rb", "$rb + 0.25"),
      bed(f, "$rb * 0.8"),
      group("Logs", [
        log("Log_{i}", "$L", "$lr", f, { at: ["($rb + 0.05) / 2", "$lr + $dy / 2", 0], rotate: [0, 0, "deg(atan2(-$dy, $rb - 0.05))"], repeat: { count: "$logs", around: "y", phase: 10 } }),
      ]),
      ...flame(f, "$dy * 0.7", "$rb * 0.25", 0.03),
      stones(f, "$stones", "$rb + 0.2", "min(0.11, pi * ($rb + 0.2) / $stones * 0.55)"),
    ], { vars: { L: "$logLength", lr: "$logLength * 0.06", rb: "$logLength * 0.42", dy: "sqrt($logLength * $logLength - ($logLength * 0.42 - 0.05) * ($logLength * 0.42 - 0.05))" } }),
  ];
}

function cabin(f: Finish): SpecNode[] {
  return [
    group("Campfire", [
      ...hearth("$L * 0.55", "$L * 0.75"),
      bed(f, "$L * 0.42"),
      group("Layer_{i}", [
        log("Log_N", "$L", "$lr", f, { at: [0, 0, "-$L * 0.35"], rotate: [0, 180, 0] }),
        log("Log_S", "$L", "$lr", f, { at: [0, 0, "$L * 0.35"] }),
      ], { at: [0, "$lr + $i * $lr * 1.7", 0], rotate: [0, "$i * 90", 0], repeat: { count: "$layers", step: [0, 0, 0] } }),
      group("Kindling", [
        cyl("Stick_{i}", 0.012, "$L * 0.45", { at: ["$L * 0.08", "$L * 0.2", 0], rotate: [0, 0, 18], segments: 6, material: f.lit ? "charred" : BARK[f.bark], repeat: { count: 6, around: "y" } }),
      ]),
      ...flame(f, "$L * 0.75", "$L * 0.12", 0.03),
      group("Stones", [
        box("Stone_{i}", ["$L * 0.22", 0.05, "$L * 0.16"], { at: ["$L * 0.65", 0.02, 0], rotate: [0, 0, 4], bevel: 0.015, repeat: { count: 8, around: "y", phase: 22.5 } }),
      ], { material: ROCK[f.stone] }),
    ], { vars: { L: "$logLength", lr: "$logLength * 0.065" } }),
  ];
}

function brazier(f: Finish): SpecNode[] {
  const hoop = (name: string, r: Num, y: Num): SpecNode =>
    lathe(name, [[`${r} - 0.012`, `${y} - 0.012`], [`${r} + 0.012`, `${y} - 0.012`], [`${r} + 0.012`, `${y} + 0.012`], [`${r} - 0.012`, `${y} + 0.012`], [`${r} - 0.012`, `${y} - 0.012`]], { segments: 28, caps: false });
  return [
    group("Brazier", [
      group("Basket", [
        lathe("Pan", [[0.02, "$y0 - 0.01"], ["$R * 0.5", "$y0 - 0.01"], ["$R * 0.55", "$y0 + 0.03"], [0.02, "$y0 + 0.03"]], { segments: 24 }),
        tube("Bar_{i}", [["$R * 0.5", "$y0", 0], ["$R * 0.78", "$y0 + ($height - $y0) * 0.5", 0], ["$R", "$height", 0]], 0.011, { segments: 6, repeat: { count: 16, around: "y" } }),
        hoop("HoopTop", "$R", "$height"),
        hoop("HoopMid", "$R * 0.78", "$y0 + ($height - $y0) * 0.5"),
        tube("Leg_{i}", [["$R * 0.5", "$y0", 0], ["$R * 0.7", "$y0 * 0.4", 0], ["$R * 0.8", 0.015, 0]], 0.016, { segments: 8, repeat: { count: 3, around: "y", phase: 90 } }),
        cyl("Foot_{i}", 0.03, 0.015, { at: ["$R * 0.8", 0, 0], anchor: "base", segments: 10, repeat: { count: 3, around: "y", phase: 90 } }),
        tube("Handle_L", [["$R + 0.005", "$height - 0.06", -0.06], ["$R + 0.07", "$height - 0.02", -0.04], ["$R + 0.07", "$height - 0.02", 0.04], ["$R + 0.005", "$height - 0.06", 0.06]], 0.01, { segments: 6, mirror: "Handle_R" }),
      ], { material: "soot_iron" }),
      bed(f, "$R * 0.6", "$y0 + 0.02"),
      group("Logs", [
        log("Log_{i}", "$R * 1.5", "$R * 0.11", f, { at: [0, "$y0 + 0.08 + $i * $R * 0.06", 0], rotate: [0, "$i * 180 / $logs + 10", 8], repeat: { count: "$logs", step: [0, 0, 0] } }),
      ]),
      ...flame(f, "$R * 1.2", "$R * 0.25", "$y0 + 0.1"),
    ], { vars: { R: "$radius", y0: "$height * 0.35" } }),
  ];
}

function star(f: Finish): SpecNode[] {
  return [
    group("Campfire", [
      ...hearth("$L * 0.4", "$L * 1.15"),
      bed(f, "$L * 0.35"),
      group("Logs", [
        log("Log_{i}", "$L", "$lr", f, { at: ["0.06 + $L / 2", "$lr", 0], repeat: { count: "$logs", around: "y", phase: 15 } }),
      ]),
      ...flame(f, "$L * 0.55", "$L * 0.1", 0.03),
      group("Tripod", [
        tube("Pole_{i}", [["$tr", 0, 0], ["$tr * 0.5", "$th * 0.5", 0], [0.02, "$th", 0], [-0.04, "$th + 0.08", 0]], 0.022, { segments: 8, repeat: { count: 3, around: "y", phase: 30 } }),
        tube("Chain", [[0, "$th", 0], [0, "$th - ($th - $L * 0.75) * 0.5", 0], [0, "$L * 0.75 + 0.27", 0]], 0.006, { segments: 6, material: "soot_iron" }),
        group("Pot", [
          lathe("Kettle", [[0.02, 0], [0.11, 0.005], [0.15, 0.06], [0.15, 0.16], [0.13, 0.2], [0.02, 0.2]], { segments: 20, material: "soot_iron" }),
          tube("Bail", [[-0.14, 0.17, 0], [-0.1, 0.26, 0], [0, 0.29, 0], [0.1, 0.26, 0], [0.14, 0.17, 0]], 0.005, { segments: 6, material: "soot_iron" }),
        ], { at: [0, "$L * 0.75", 0] }),
      ], { material: BARK[f.bark] }),
    ], { vars: { L: "$logLength", lr: "$logLength * 0.07", tr: "$logLength * 1.05", th: "$logLength * 1.25" } }),
  ];
}

function leanto(f: Finish): SpecNode[] {
  return [
    group("Campfire", [
      ...hearth("$L * 0.5", "$L * 0.8"),
      bed(f, "$L * 0.4"),
      group("Logs", [
        log("Log_Back", "$L * 1.2", "$L * 0.1", f, { at: [0, "$L * 0.1", "-$L * 0.3"], rotate: [0, 180, 0] }),
        log("Log_{i}", "$L * 0.75", "$lr", f, { at: ["-$L * 0.4 + $i * $L * 0.8 / max($logs - 1, 1)", "$lr + $L * 0.097", "$L * 0.11"], rotate: [0, -75, -90], repeat: { count: "$logs", step: [0, 0, 0] } }),
      ]),
      ...flame(f, "$L * 0.6", "$L * 0.12", 0.03),
      stones(f, "$stones", "$L * 0.7", "min(0.12, pi * $L * 0.7 / $stones * 0.5)"),
    ], { vars: { L: "$logLength", lr: "$logLength * 0.05" } }),
  ];
}

interface StyleDef {
  name: string;
  text: string;
  build: (f: Finish) => SpecNode[];
  params: () => ReturnType<typeof num>[];
  tags: string[];
}

const STYLES: Record<Style, StyleDef> = {
  teepee: {
    name: "teepee campfire",
    text: "logs leaning together in a teepee over a bed of {bed}, inside a ring of lumpy stones on a patch of scorched earth",
    build: teepee,
    params: () => [int("logs", 6, 4, 10, "Number of logs in the cone."), num("logLength", 0.8, 0.6, 1.1, "Length of a log in metres."), int("stones", 12, 8, 16, "Number of stones in the ring.")],
    tags: ["teepee", "kegelvuur", "stone ring", "stenen kring"],
  },
  cabin: {
    name: "log cabin fire",
    text: "logs stacked crosswise in a log-cabin square around a cone of kindling, over a bed of {bed} with flat stones around it",
    build: cabin,
    params: () => [int("layers", 3, 2, 5, "Number of crossed layers (two logs each)."), num("logLength", 0.7, 0.5, 1.0, "Length of a log in metres.")],
    tags: ["log cabin", "blokhut", "stacked", "gestapeld"],
  },
  brazier: {
    name: "fire basket",
    text: "a steel fire basket (brazier) of bars and hoops on three legs, with logs laid in it over a bed of {bed}",
    build: brazier,
    params: () => [num("radius", 0.36, 0.28, 0.45, "Radius of the basket rim in metres."), num("height", 0.75, 0.6, 0.9, "Height of the rim."), int("logs", 4, 3, 6, "Number of logs in the basket.")],
    tags: ["brazier", "vuurkorf", "fire basket", "terras", "garden"],
  },
  star: {
    name: "star fire with tripod",
    text: "a star fire of logs lying like spokes with their ends together over a bed of {bed}, under a cooking tripod with a hanging cast-iron pot",
    build: star,
    params: () => [int("logs", 5, 3, 8, "Number of logs in the star."), num("logLength", 0.7, 0.5, 0.9, "Length of a log in metres.")],
    tags: ["star fire", "sterrenvuur", "tripod", "driepoot", "cooking", "koken", "pot", "ketel"],
  },
  leanto: {
    name: "lean-to fire",
    text: "a lean-to fire: a thick back log with smaller logs leaning against it over a bed of {bed}, inside a ring of stones",
    build: leanto,
    params: () => [int("logs", 4, 3, 7, "Number of logs leaning on the back log."), num("logLength", 0.8, 0.6, 1.1, "Length of the back log in metres (the leaning logs are shorter)."), int("stones", 10, 6, 14, "Number of stones in the ring.")],
    tags: ["lean-to", "afdak", "back log", "reflector"],
  },
};

function campfire(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const state = f.lit ? "burning" : "burnt-out";
  const wood = f.bark.replace("bark_", "");
  return {
    slug: slugify("campfire", state, wood, s.name),
    title: `${f.lit ? "Burning" : "Burnt-out"} ${s.name}`,
    description: `A ${f.lit ? "burning" : "burnt-out"} campfire: ${s.text.replace("{bed}", f.lit ? "glowing embers, with translucent flame tongues and a particle origin" : "grey ash, the log ends charred")}. ${f.lit ? "Logs" : "Cold logs"} with ${wood} bark; it faces +z.`,
    tags: [style, state, wood, ...(f.lit ? ["lit", "brandend", "flames", "vlammen"] : ["cold", "uitgebrand", "ash", "as"]), ...s.tags],
    params: s.params(),
    materials: finish(...new Set([BARK[f.bark]!, ROCK[f.stone]!, "wood_cut", "charred", "scorched_wood", "dirt", "scorched_earth", "soot_iron", "ember_glow", "ember_bed", "ember_tip", "ash_grey", "ash_white", "flame_outer", "flame_inner"])),
    nodes: s.build(f),
  };
}

const ORDER: Style[] = ["teepee", "cabin", "brazier", "star", "leanto"];

export const campfireFamily: Family = {
  id: "campfire",
  category: "props",
  archetype: "prop.campfire",
  tags: ["campfire", "kampvuur", "fire", "vuur", "logs", "blokken", "brandhout", "prop"],
  assets: () => ORDER.flatMap((style) => FINISHES[style].map((f) => campfire(style, f))),
};
