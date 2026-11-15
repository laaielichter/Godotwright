import { box, cap, extrude, group, int, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import type { ParamDef } from "../../../build/params.js";
import { an, finishName, finishTags, laid, useMats } from "./common.js";

type Finish = { main: string; trim: string };
type Load = "none" | "cartons" | "sacks" | "wrapped";

/** The base of a pallet: its nodes and the height of its deck top (an expression). */
interface Base {
  nodes: SpecNode[];
  top: string;
  name: string;
  title: string;
  text: string;
  extra: ParamDef;
}

/** A EUR block pallet: three bottom boards, nine blocks, three chord boards and a deck of top boards along z. */
function eur(f: Finish): Base {
  const xs = ["-$W / 2 + 0.0725", "0", "$W / 2 - 0.0725"];
  const zs = ["-$L / 2 + 0.0725", "0", "$L / 2 - 0.0725"];
  const blocks: SpecNode[] = [];
  xs.forEach((x, i) => zs.forEach((z, k) => blocks.push(box(`Block_${i * 3 + k + 1}`, [0.145, 0.08, k === 1 ? 0.145 : 0.1], { at: [x, 0.021, z], anchor: "bottom", bevel: 0.004 }))));
  return {
    name: "eur", title: "EUR block pallet", text: "a block pallet of five top boards on three chord boards, nine blocks and three bottom boards, with open fork entries on all four sides",
    top: "0.144",
    extra: int("boards", 5, 3, 7, "Number of top deck boards."),
    nodes: [
      group("Base", [
        laid("z", box("Bottom_{i}", ["0.145", 0.022, "$L"], { at: ["-$W / 2 + 0.0725", 0.011, 0], repeat: { count: 3, step: ["$W / 2 - 0.0725", 0, 0] }, bevel: 0.003 })),
        ...blocks,
        box("Mark_{i}", [0.06, 0.035, 0.003], { at: ["-$W / 2 + 0.0725", 0.06, "$L / 2"], repeat: { count: 3, step: ["$W / 2 - 0.0725", 0, 0] }, material: "hole" }),
        laid("x", box("Chord_{i}", ["$W", 0.022, 0.145], { at: [0, 0.111, "-$L / 2 + 0.0725"], repeat: { count: 3, step: [0, 0, "$L / 2 - 0.0725"] }, bevel: 0.003 })),
      ]),
      group("Deck", [
        laid("z", box("Board_{i}", ["($W - 0.29) / ($boards - 2) - 0.035", 0.022, "$L"], { at: ["-$W / 2 + 0.145 + ($W - 0.29) / ($boards - 2) / 2", 0.133, 0], repeat: { count: "$boards - 2", step: ["($W - 0.29) / ($boards - 2)", 0, 0] }, bevel: 0.003 })),
        laid("z", box("Edge_L", [0.145, 0.022, "$L"], { at: ["$W / 2 - 0.0725", 0.133, 0], bevel: 0.003, mirror: "Edge_R" })),
      ]),
    ].map((n) => ({ ...n, material: f.main })),
  };
}

/** A GMA style stringer pallet: three notched stringers along z, deck boards across x on top and bottom. */
function gma(f: Finish): Base {
  // The side profile of a stringer as [height, z], extruded across x after a quarter turn about z.
  const c = "($L / 4 + 0.03)", w = 0.115, n = 0.038, h = 0.089;
  const profile: [string | number, string | number][] = [
    [0, "-$L / 2"], [0, `-${c} - ${w}`], [n, `-${c} - ${w} + 0.02`], [n, `-${c} + ${w} - 0.02`], [0, `-${c} + ${w}`],
    [0, `${c} - ${w}`], [n, `${c} - ${w} + 0.02`], [n, `${c} + ${w} - 0.02`], [0, `${c} + ${w}`], [0, "$L / 2"], [h, "$L / 2"], [h, "-$L / 2"],
  ];
  const stringer = (name: string, x: string): SpecNode => extrude(name, profile, -0.019, 0.019, { at: [x, 0.016, 0], rotate: [0, 0, 90] });
  return {
    name: "stringer", title: "stringer pallet", text: "a stringer pallet of three notched stringers along its length, deck boards across the top and five bottom boards, so forks enter from all sides",
    top: "0.121",
    extra: int("boards", 7, 5, 9, "Number of top deck boards."),
    nodes: [
      group("Base", [
        stringer("Stringer_L", "$W / 2 - 0.02"),
        stringer("Stringer_M", "0"),
        stringer("Stringer_R", "-$W / 2 + 0.02"),
        laid("x", box("Bottom_{i}", ["$W", 0.016, 0.09], { at: [0, 0.008, "-$L / 2 + 0.045"], repeat: { count: 5, step: [0, 0, "($L - 0.09) / 4"] }, bevel: 0.003 })),
      ]),
      group("Deck", [
        laid("x", box("Board_{i}", ["$W", 0.016, "min(0.14, ($L - 0.03 * ($boards - 1)) / $boards)"], { at: [0, 0.113, "-$L / 2 + min(0.14, ($L - 0.03 * ($boards - 1)) / $boards) / 2"], repeat: { count: "$boards", step: [0, 0, "($L - min(0.14, ($L - 0.03 * ($boards - 1)) / $boards)) / ($boards - 1)"] }, bevel: 0.003 })),
      ]),
    ].map((nd) => ({ ...nd, material: f.main })),
  };
}

/** A moulded plastic pallet: a ribbed deck on nine feet joined by three runners. */
function plastic(f: Finish): Base {
  const xs = ["-$W / 2 + 0.08", "0", "$W / 2 - 0.08"];
  const zs = ["-$L / 2 + 0.08", "0", "$L / 2 - 0.08"];
  const feet: SpecNode[] = [];
  xs.forEach((x, i) => zs.forEach((z, k) => feet.push(box(`Block_${i * 3 + k + 1}`, [0.16, 0.11, 0.16], { at: [x, 0.02, z], anchor: "bottom", bevel: 0.012 }))));
  return {
    name: "plastic", title: "plastic pallet", text: "a moulded plastic pallet with a ribbed deck and a raised rim on nine feet joined by three runners",
    top: "0.15",
    extra: int("ribs", 8, 5, 12, "Number of ribs across the deck."),
    nodes: [
      group("Base", [
        box("Skid_{i}", [0.16, 0.026, "$L"], { at: ["-$W / 2 + 0.08", 0.013, 0], repeat: { count: 3, step: ["$W / 2 - 0.08", 0, 0] }, bevel: 0.006 }),
        ...feet,
      ]),
      group("Deck", [
        box("Plate", ["$W", 0.025, "$L"], { at: [0, 0.1375, 0], bevel: 0.008 }),
        box("Rim_L", [0.03, 0.012, "$L"], { at: ["$W / 2 - 0.015", 0.15, 0], bevel: 0.004, mirror: "Rim_R" }),
        box("Rib_{i}", ["$W - 0.06", 0.008, 0.012], { at: [0, 0.15, "-($L - 0.12) / 2"], repeat: { count: "$ribs", step: [0, 0, "($L - 0.12) / ($ribs - 1)"] }, bevel: 0.002 }),
        box("Spine", [0.012, 0.008, "$L - 0.06"], { at: [0, 0.15, 0], bevel: 0.002 }),
      ]),
    ].map((nd) => ({ ...nd, material: f.main })),
  };
}

/** What stands on the deck: rows of cartons, a stack of sacks, or cartons in shrink wrap. */
function load(kind: Load, top: string, f: Finish): SpecNode[] {
  const cartons = (wrap: boolean): SpecNode[] => [
    group("Load", [
      group("Layer_{i}", [
        group("Row_{i}", [
          box("Carton_{i}", ["$W / 3 - 0.012", 0.24, "$L / 4 - 0.012"], { at: ["-$W / 3", 0.12, 0], repeat: { count: 3, step: ["$W / 3", 0, 0] }, bevel: 0.006, material: "cardboard", children: [
          box("Tape", [0.05, 0.004, "$L / 4 - 0.02"], { at: [0, 0.12, 0], material: "tape" }),
          box("Label", ["min(0.1, $W / 3 - 0.06)", 0.07, 0.003], { at: [0, 0.03, "$L / 8 - 0.0065"], material: "label_white" }),
        ] }),
        ], { at: [0, 0, "-$L * 3 / 8"], repeat: { count: 4, step: [0, 0, "$L / 4"] } }),
      ], { at: [0, `${top} - 0.002`, 0], repeat: { count: "$layers", step: [0, 0.242, 0] } }),
      ...(wrap
        ? [group("Wrap", [
            // Stretch film wound in overlapping bands: Godot shadows a see-through film like a solid, so leave gaps.
            box("Band_{i}", ["$W + 0.01", 0.16, "$L + 0.01"], { at: [0, `${top} + 0.03`, 0], anchor: "bottom", repeat: { count: "$layers + 1", step: [0, "($layers * 0.242 - 0.2) / $layers", 0] } }),
          ], { material: "shrink_wrap" })]
        : [box("Strap_{i}", ["$W + 0.008", "$layers * 0.242 + 0.008", 0.016], { at: [0, `${top} - 0.004`, "-$L / 4"], anchor: "bottom", repeat: { count: 2, step: [0, 0, "$L / 2"] }, material: f.trim })]),
    ]),
  ];
  switch (kind) {
    case "none":
      return [];
    case "cartons":
      return cartons(false);
    case "wrapped":
      return cartons(true);
    case "sacks":
      return [
        group("Load", [
          group("Layer_{i}", [
            group("Row_{i}", [
              box("Sack_{i}", ["$W / 2 - 0.02", 0.14, "$L / 3 - 0.02"], { at: ["-$W / 4", 0.068, 0], repeat: { count: 2, step: ["$W / 2", 0, 0] }, bevel: 0.055, material: f.trim }),
            ], { at: [0, 0, "-$L / 3"], repeat: { count: 3, step: [0, 0, "$L / 3"] } }),
          ], { at: [0, top, 0], repeat: { count: "$layers", step: [0, 0.135, 0] } }),
        ]),
      ];
  }
}

const VARIANTS: { base: (f: Finish) => Base; load: Load; finishes: Finish[] }[] = [
  { base: eur, load: "none", finishes: [{ main: "pine", trim: "steel" }, { main: "weathered_wood", trim: "steel" }] },
  { base: eur, load: "cartons", finishes: [{ main: "light_oak", trim: "plastic_black" }, { main: "pine", trim: "plastic_blue" }] },
  { base: gma, load: "none", finishes: [{ main: "rough_timber", trim: "steel" }, { main: "birch", trim: "steel" }] },
  { base: gma, load: "sacks", finishes: [{ main: "rough_timber", trim: "rope" }, { main: "weathered_wood", trim: "canvas_beige" }] },
  { base: plastic, load: "none", finishes: [{ main: "hdpe_blue", trim: "steel" }, { main: "hdpe_black", trim: "steel" }] },
  { base: plastic, load: "wrapped", finishes: [{ main: "hdpe_grey", trim: "steel" }, { main: "plastic_red", trim: "steel" }] },
];

const LOAD_TEXT: Record<Load, string> = {
  none: "",
  cartons: ", loaded with layers of taped cartons held by two straps",
  sacks: ", loaded with layers of filled sacks",
  wrapped: ", loaded with layers of cartons in clear shrink wrap",
};

function pallet(v: (typeof VARIANTS)[number], f: Finish): AssetDraft {
  const b = v.base(f);
  const fin = finishName(f.main);
  const loaded = v.load !== "none";
  const lw = b.name === "eur" ? [1.2, 1.0, 1.3, 0.8, 0.8, 1.2] : b.name === "stringer" ? [1.22, 1.0, 1.3, 1.02, 0.8, 1.2] : [1.2, 1.0, 1.3, 1.0, 0.8, 1.2];
  const params: ParamDef[] = [
    num("length", lw[0] as number, lw[1] as number, lw[2] as number, "Length of the pallet along z in metres."),
    num("width", lw[3] as number, lw[4] as number, lw[5] as number, "Width of the pallet along x in metres."),
    ...(loaded ? [int("layers", v.load === "sacks" ? 4 : 3, 1, v.load === "sacks" ? 6 : 4, "Number of layers in the load.")] : []),
    b.extra,
  ];
  return {
    slug: slugify("pallet", b.name, ...(loaded ? [v.load] : []), fin),
    title: cap(`${fin} ${b.title}${loaded ? ` with ${v.load === "wrapped" ? "wrapped cartons" : v.load}` : ""}`),
    description: `${cap(an(fin))} ${b.title}: ${b.text}${LOAD_TEXT[v.load]}. Its length runs along z.`,
    tags: [...finishTags(f.main), ...(loaded ? ["loaded", "beladen", v.load === "sacks" ? "zakken" : "dozen"] : []), b.name],
    params,
    materials: useMats(f.main, f.trim, "hole", ...(loaded ? ["cardboard", "tape", "label_white", "shrink_wrap"] : [])),
    nodes: [group("Pallet", [...b.nodes, ...load(v.load, b.top, f)], { vars: { W: "$width", L: "$length" } })],
  };
}

export const palletFamily: Family = {
  id: "pallet",
  category: "storage",
  archetype: "prop.pallet",
  tags: ["pallet", "pallets", "europallet", "skid", "forklift", "heftruck", "storage", "opslag"],
  assets: () => VARIANTS.flatMap((v) => v.finishes.map((f) => pallet(v, f))),
};
