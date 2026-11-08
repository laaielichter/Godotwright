import { box, cyl, group, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";

/**
 * Playground swings: an A-frame swing set of square timber, of round logs, or of painted steel tube, with one, two or
 * three seats on ropes or chains. A seat is a flat board or a curved rubber belt. Every Seat_<n> node hangs from the
 * crossbeam with its origin on the hinge line at the top, so it swings about x; the frame spreads along z and the
 * seats face +z. On y = 0.
 */
type FrameKey = "timber" | "log" | "green" | "blue";
type SeatKind = "board" | "belt";

interface Frame {
  key: FrameKey;
  title: string;
  /** Legs and beam. */
  wood: string;
  hanger: "rope" | "chain";
  board: string;
  hardware: string;
  shape: "square" | "log" | "tube";
  text: string;
  tags: string[];
}

const FRAMES: Frame[] = [
  { key: "timber", title: "Timber", wood: "pine", hanger: "rope", board: "light_oak", hardware: "galvanised", shape: "square", text: "square pine legs and beam with knee braces, hung on hemp ropes", tags: ["wooden", "houten", "garden", "tuin"] },
  { key: "log", title: "Log", wood: "rough_timber", hanger: "chain", board: "oak", hardware: "galvanised", shape: "log", text: "round peeled-log legs and beam with a log tie, hung on galvanised chains", tags: ["log", "boomstam", "rustic", "park"] },
  { key: "green", title: "Green steel", wood: "paint_green", hanger: "chain", board: "plastic_yellow", hardware: "galvanised", shape: "tube", text: "green-painted steel tube legs and a galvanised beam, hung on chains", tags: ["steel", "stalen", "metal", "playground", "speeltuin"] },
  { key: "blue", title: "Blue steel", wood: "paint_blue", hanger: "chain", board: "plastic_red", hardware: "galvanised", shape: "tube", text: "blue-painted steel tube legs and a galvanised beam, hung on chains", tags: ["steel", "stalen", "metal", "playground", "speeltuin"] },
];

/** Seats and seat kind per configuration. */
const CONFIGS: { seats: number; seat: SeatKind; word: string }[] = [
  { seats: 1, seat: "board", word: "single" },
  { seats: 2, seat: "board", word: "double" },
  { seats: 2, seat: "belt", word: "double" },
  { seats: 3, seat: "belt", word: "triple" },
];

const LOCAL: Record<string, MaterialDef> = {
  swing_rope: { color: [0.55, 0.45, 0.28], metallic: 0, roughness: 0.95 },
};

/** The seat's x position for seat k of n, as an expression of the seat spacing $bay. */
const seatX = (k: number, n: number): string => `${k - (n - 1) / 2} * $bay`;

/** One hanger strand from local y = 0 down to y = -$len: a rope, or a chain of alternating links. */
function strand(name: string, f: Frame): SpecNode {
  if (f.hanger === "rope") return cyl(name, 0.011, "$len", { at: [0.2, "-$len / 2", 0], segments: 8, material: "swing_rope", mirror: name.replace("_L", "_R") });
  return group(name, [
    box("LinkA_{i}", [0.007, 0.05, 0.024], { at: [0, "-0.025 - $i * 0.08", 0], repeat: { count: "floor(($len - 0.05) / 0.08) + 1", step: [0, 0, 0] } }),
    box("LinkB_{i}", [0.024, 0.05, 0.007], { at: [0, "-0.065 - $i * 0.08", 0], repeat: { count: "floor(($len - 0.09) / 0.08) + 1", step: [0, 0, 0] } }),
  ], { at: [0.2, 0, 0], material: f.hardware, mirror: name.replace("_L", "_R") });
}

/** A seat that hangs from the beam: its origin is the hinge at the top, the board at y = -$len. */
function seat(k: number, n: number, f: Frame, kind: SeatKind): SpecNode {
  const board: SpecNode[] =
    kind === "board"
      ? [
          box("Board", [0.46, 0.035, 0.13], { at: [0, "-$len - 0.0175", 0], bevel: 0.008, material: f.board }),
          box("Clamp_L", [0.03, 0.05, 0.03], { at: [0.2, "-$len + 0.01", 0], bevel: 0.004, material: f.hardware, mirror: "Clamp_R" }),
        ]
      : [
          box("BeltMiddle", [0.24, 0.012, 0.13], { at: [0, "-$len - 0.035", 0], bevel: 0.004, material: "rubber" }),
          box("BeltSide_L", [0.13, 0.012, 0.13], { at: [0.165, "-$len - 0.008", 0], rotate: [0, 0, 28], bevel: 0.004, material: "rubber", mirror: "BeltSide_R" }),
          box("Clamp_L", [0.025, 0.06, 0.03], { at: [0.215, "-$len + 0.02", 0], bevel: 0.004, material: f.hardware, mirror: "Clamp_R" }),
        ];
  return group(`Seat_${k + 1}`, [group(`Chain_${k + 1}`, [strand("Strand_L", f)]), ...board], { at: [seatX(k, n), "$height - $beam", 0] });
}

/** The A-frame: two splayed leg pairs, the crossbeam on top, ties and hanger brackets. */
function frame(f: Frame, n: number): SpecNode {
  const legAt = (side: 1 | -1, front: 1 | -1): { at: [string, number, string]; rotate: [string, number, number] } => ({
    at: [`${side} * $wx`, 0, `${front} * $spread`],
    rotate: [`${-front} * deg($a)`, 0, 0],
  });
  const leg = (name: string, side: 1 | -1, front: 1 | -1): SpecNode =>
    f.shape === "square"
      ? box(name, [0.09, "$height / cos($a)", 0.09], { ...legAt(side, front), anchor: "bottom", bevel: 0.008 })
      : cyl(name, f.shape === "log" ? 0.065 : 0.038, "$height / cos($a)", { ...legAt(side, front), anchor: "base", segments: f.shape === "log" ? 12 : 14 });
  const beam =
    f.shape === "square"
      ? box("Beam", ["2 * $wx + 0.3", 0.14, 0.1], { at: [0, "$height - 0.07", 0], bevel: 0.01 })
      : cyl("Beam", f.shape === "log" ? 0.075 : 0.05, "2 * $wx + 0.24", { axis: "x", at: [0, "$height - $beam", 0], segments: 16, material: f.shape === "tube" ? "galvanised" : undefined });
  const ties: SpecNode[] = [];
  // A tie across each A, at a third of the height, and for timber a knee brace from each leg to the beam.
  for (const side of [1, -1] as const) {
    const s = side > 0 ? "L" : "R";
    ties.push(
      f.shape === "square"
        ? box(`Tie_${s}`, [0.045, 0.09, "2 * ($spread - $height * 0.33 * tan($a)) + 0.12"], { at: [`${side} * ($wx + 0.07)`, "$height * 0.33", 0], bevel: 0.006 })
        : cyl(`Tie_${s}`, f.shape === "log" ? 0.045 : 0.025, "2 * ($spread - $height * 0.33 * tan($a)) + 0.1", { axis: "z", at: [`${side} * $wx`, "$height * 0.33", 0], segments: 10 }),
    );
    if (f.shape === "square") {
      ties.push(box(`KneeBrace_${s}`, [0.045, 0.5, 0.07], { at: [`${side} * ($wx - 0.2)`, "$height - 0.3", 0.05], rotate: [0, 0, `${side} * 45`], bevel: 0.006 }));
    } else {
      ties.push(box(`Bracket_${s}`, [0.16, 0.2, 0.14], { at: [`${side} * $wx`, "$height - $beam", 0], bevel: 0.01, material: f.hardware }));
    }
  }
  const hangers: SpecNode[] = [];
  for (let k = 0; k < n; k++) {
    hangers.push(box(`Hanger_${k + 1}L`, [0.04, "$beam * 2 + 0.03", "$beam * 2 + 0.02"], { at: [`${seatX(k, n)} + 0.2`, "$height - $beam", 0], bevel: 0.006, material: f.hardware }));
    hangers.push(box(`Hanger_${k + 1}R`, [0.04, "$beam * 2 + 0.03", "$beam * 2 + 0.02"], { at: [`${seatX(k, n)} - 0.2`, "$height - $beam", 0], bevel: 0.006, material: f.hardware }));
  }
  const anchors = [1, -1].flatMap((side) =>
    [1, -1].map((front) => box(`Anchor_${side > 0 ? "L" : "R"}${front > 0 ? "F" : "B"}`, [0.16, 0.03, 0.16], { at: [`${side} * $wx`, 0, `${front} * $spread`], anchor: "bottom", bevel: 0.006, material: f.shape === "tube" ? "galvanised" : "concrete" })),
  );
  return group("Frame", [leg("Leg_LF", 1, 1), leg("Leg_LB", 1, -1), leg("Leg_RF", -1, 1), leg("Leg_RB", -1, -1), beam, ...ties, ...hangers, ...anchors], { material: f.wood });
}

function swing(f: Frame, c: (typeof CONFIGS)[number]): AssetDraft {
  const seatText = c.seat === "board" ? (f.board.startsWith("plastic") ? "moulded plastic board" : "wooden board") : "curved rubber belt";
  const names = [f.wood, f.board, f.hardware, "galvanised", "rubber", "concrete"];
  return {
    slug: slugify("swing", f.key, c.word, c.seat),
    title: `${f.title} ${c.word} swing with ${c.seat === "board" ? "board" : "belt"} seat${c.seats > 1 ? "s" : ""}`,
    description: `A playground A-frame swing set of ${f.text}, with ${c.seats === 1 ? "one" : c.seats === 2 ? "two" : "three"} ${seatText} seat${c.seats > 1 ? "s" : ""}. Each Seat node hangs from the beam with its pivot on the hinge at the top (swings about x); the legs spread along z and the seats face +z.`,
    tags: [f.key, c.word, c.seat, f.hanger, ...f.tags, ...(c.seat === "belt" ? ["belt seat", "rubberen zitje"] : ["plank", "zitplank"])],
    params: [
      num("height", 2.4, 2.2, 3, "Height of the top of the crossbeam above the ground in metres."),
      num("bay", 1.1, 0.9, 1.3, "Distance between neighbouring seats along x in metres (also sets the frame width)."),
      num("seatHeight", 0.42, 0.35, 0.5, "Height of the seat above the ground in metres."),
    ],
    materials: { ...mats(...new Set(names)), ...(f.hanger === "rope" ? LOCAL : {}) },
    nodes: [
      group("Swing", [frame(f, c.seats), ...Array.from({ length: c.seats }, (_, k) => seat(k, c.seats, f, c.seat))], {
        vars: {
          beam: f.shape === "square" ? 0.07 : f.shape === "log" ? 0.075 : 0.05,
          wx: `${c.seats} * $bay / 2 + 0.15`,
          spread: "$height * 0.36",
          a: "atan($height * 0.36 / $height)",
          len: "$height - $beam - $seatHeight",
        },
      }),
    ],
  };
}

export const swingFamily: Family = {
  id: "swing",
  category: "props",
  archetype: "prop.swing",
  tags: ["swing", "swings", "schommel", "schommels", "swing set", "playground", "speeltuin", "play", "spelen", "prop"],
  assets: () => FRAMES.flatMap((f) => CONFIGS.map((c) => swing(f, c))),
};
