import { box, cyl, ellipsoid, group, loft, num, slugify, tube, type AssetDraft, type Family, type SpecNode, type Vec } from "../../kit.js";
import type { MaterialDef } from "../../palette.js";
import { f, VMATS } from "./parts.js";
import { beamAt, keelAt, sheerAt, shellSection, solidSection, type HullShape } from "./hull.js";

type Kind = "runabout" | "cruiser" | "fishing" | "console" | "dinghy" | "rib";

interface BoatDef {
  kind: Kind;
  name: string;
  text: string;
  length: [number, number, number];
  beam: [number, number, number];
  freeboard: [number, number, number];
  hull: HullShape;
  /** Where the open cockpit ends and the solid foredeck starts (0 = transom, 1 = stem). */
  deck: number;
  colour: string;
  nl: string;
  paint: MaterialDef;
  accent: MaterialDef;
}

/** Polyester gelcoat: a glossy non-metal; a metallic flake gelcoat gets a little metallic and the "painted" texture. */
const P = (r: number, g: number, b: number, m = 0): MaterialDef => ({ color: [r, g, b], metallic: m, roughness: m > 0 ? 0.25 : 0.2, ...(m > 0 ? { texture: "painted" } : {}) });
const WHITE = P(0.64, 0.64, 0.61);

const BOATS: BoatDef[] = [
  { kind: "runabout", name: "bowrider runabout", text: "a sporty open runabout with a wrap-around windscreen, two helm seats, a rear bench and an outboard", length: [5.6, 4.8, 6.4], beam: [2.25, 2.0, 2.45], freeboard: [0.75, 0.65, 0.85], hull: { transom: 0.92, sheerRise: 0.35, stemRise: 1.0, vee: 1 }, deck: 0.66, colour: "white and red", nl: "wit rood", paint: WHITE, accent: P(0.34, 0.022, 0.02) },
  { kind: "runabout", name: "bowrider runabout", text: "a sporty open runabout with a wrap-around windscreen, two helm seats, a rear bench and an outboard", length: [5.2, 4.6, 6.0], beam: [2.15, 1.95, 2.35], freeboard: [0.72, 0.62, 0.82], hull: { transom: 0.9, sheerRise: 0.35, stemRise: 1.0, vee: 1 }, deck: 0.66, colour: "navy", nl: "donkerblauw", paint: P(0.016, 0.028, 0.08, 0.3), accent: WHITE },
  { kind: "cruiser", name: "sports cruiser", text: "a speedboat with a cuddy cabin under a raised foredeck with portholes, a raked windscreen, a sun pad, a swim platform and a stern drive", length: [7.6, 6.6, 8.6], beam: [2.55, 2.4, 2.8], freeboard: [0.95, 0.85, 1.05], hull: { transom: 0.94, sheerRise: 0.3, stemRise: 0.9, vee: 1 }, deck: 0.52, colour: "white", nl: "wit", paint: WHITE, accent: P(0.022, 0.022, 0.024) },
  { kind: "cruiser", name: "sports cruiser", text: "a speedboat with a cuddy cabin under a raised foredeck with portholes, a raked windscreen, a sun pad, a swim platform and a stern drive", length: [8.2, 7.2, 9.2], beam: [2.7, 2.5, 2.9], freeboard: [1.0, 0.9, 1.1], hull: { transom: 0.94, sheerRise: 0.3, stemRise: 0.9, vee: 1 }, deck: 0.52, colour: "silver", nl: "zilver", paint: P(0.38, 0.39, 0.4, 0.35), accent: P(0.02, 0.06, 0.2) },
  { kind: "fishing", name: "fishing boat", text: "a workboat with a wheelhouse forward, an open aft deck with rod holders, a mast with lights and a guard rail", length: [7.0, 6.2, 8.4], beam: [2.6, 2.4, 2.9], freeboard: [0.95, 0.85, 1.1], hull: { transom: 0.86, sheerRise: 0.45, stemRise: 1.0, vee: 0.6 }, deck: 0.62, colour: "blue", nl: "blauw", paint: P(0.03, 0.09, 0.25), accent: WHITE },
  { kind: "fishing", name: "fishing boat", text: "a workboat with a wheelhouse forward, an open aft deck with rod holders, a mast with lights and a guard rail", length: [6.4, 5.8, 7.4], beam: [2.4, 2.2, 2.7], freeboard: [0.9, 0.8, 1.05], hull: { transom: 0.86, sheerRise: 0.45, stemRise: 1.0, vee: 0.6 }, deck: 0.62, colour: "green", nl: "groen", paint: P(0.025, 0.1, 0.045), accent: P(0.6, 0.38, 0.02) },
  { kind: "console", name: "centre-console boat", text: "a centre-console fishing boat with a T-top over the helm, a leaning-post seat, a bow seat and a big outboard", length: [6.2, 5.4, 7.2], beam: [2.4, 2.2, 2.6], freeboard: [0.8, 0.7, 0.9], hull: { transom: 0.9, sheerRise: 0.4, stemRise: 1.0, vee: 1 }, deck: 0.78, colour: "sand", nl: "zandkleur", paint: P(0.45, 0.4, 0.3), accent: P(0.022, 0.022, 0.024) },
  { kind: "console", name: "centre-console boat", text: "a centre-console fishing boat with a T-top over the helm, a leaning-post seat, a bow seat and a big outboard", length: [6.8, 6.0, 7.6], beam: [2.5, 2.3, 2.7], freeboard: [0.85, 0.75, 0.95], hull: { transom: 0.9, sheerRise: 0.4, stemRise: 1.0, vee: 1 }, deck: 0.78, colour: "grey", nl: "grijs", paint: P(0.2, 0.21, 0.22), accent: P(0.02, 0.14, 0.15) },
  { kind: "dinghy", name: "aluminium dinghy", text: "a small open aluminium dinghy with two thwart seats, a rubbing strake and a small outboard", length: [3.4, 3.0, 4.0], beam: [1.45, 1.35, 1.6], freeboard: [0.45, 0.4, 0.52], hull: { transom: 0.82, sheerRise: 0.3, stemRise: 0.8, vee: 0.3, stem: 0.3 }, deck: 0.88, colour: "aluminium", nl: "aluminium", paint: { color: [0.62, 0.63, 0.64], metallic: 0.85, roughness: 0.5, texture: "brushed" }, accent: P(0.02, 0.08, 0.035) },
  { kind: "rib", name: "rigid inflatable boat", text: "a RIB with grey inflatable tubes round a deep-V hull, a small console with a seat and an outboard", length: [4.8, 4.0, 5.6], beam: [2.05, 1.9, 2.25], freeboard: [0.5, 0.45, 0.6], hull: { transom: 0.8, sheerRise: 0.25, stemRise: 1.0, vee: 1, stem: 0.12 }, deck: 0.82, colour: "grey and orange", nl: "grijs oranje", paint: P(0.035, 0.035, 0.04), accent: P(0.55, 0.15, 0.012) },
];

const zs = (s: number): string => `-$L2 + ${f(2 * s)} * $L2`;
const ysh = (h: HullShape, s: number): string => `${f(sheerAt(h, s))} * $fb`;
const xb = (h: HullShape, s: number, k = 1): string => `${f(beamAt(h, s) * k)} * $B2`;

/** An outboard motor hung on the transom (the node sits on the transom top). */
function outboard(scale: number, cowl: string): SpecNode {
  const k = (v: number): number => Math.round(v * scale * 1000) / 1000;
  return group("Engine", [
    box("Bracket", [k(0.18), k(0.22), k(0.12)], { at: [0, k(-0.06), k(0.0)], bevel: 0.01, material: "engine_black" }),
    loft("Cowling", [
      { z: k(-0.12), superellipse: { width: k(0.3), height: k(0.32), n: 2.6, count: 20, cy: k(0.2) } },
      { z: k(-0.35), superellipse: { width: k(0.36), height: k(0.42), n: 2.6, count: 20, cy: k(0.24) } },
      { z: k(-0.58), superellipse: { width: k(0.3), height: k(0.36), n: 2.6, count: 20, cy: k(0.22) } },
      { z: k(-0.66), superellipse: { width: k(0.2), height: k(0.24), n: 2.6, count: 20, cy: k(0.2) } },
    ], { material: cowl }),
    box("Midsection", [k(0.14), "$d + $fb * 0.8", k(0.22)], { at: [0, "-($d + $fb * 0.8) / 2 + 0.02", k(-0.32)], bevel: 0.02, material: "engine_black" }),
    ellipsoid("Gearcase", [k(0.07), k(0.08), k(0.28)], { at: [0, "-$d * 0.85", k(-0.3)], segments: 16, material: "engine_black" }),
    box("Skeg", [k(0.02), k(0.18), k(0.12)], { at: [0, `-$d * 0.85 - ${f(k(0.1))}`, k(-0.35)], material: "engine_black" }),
    box("Plate", [k(0.3), k(0.015), k(0.32)], { at: [0, `-$d * 0.85 + ${f(k(0.14))}`, k(-0.3)], material: "engine_black" }),
    group("Propeller", [
      ellipsoid("Boss", [k(0.04), k(0.04), k(0.06)], { segments: 12, material: "steel" }),
      box("Blade_{i}", [k(0.012), k(0.13), k(0.05)], { at: [0, k(0.07), 0], rotate: [0, 25, 0], repeat: { count: 3, around: "z" }, material: "steel" }),
    ], { at: [0, "-$d * 0.85", k(-0.6)] }),
    box("Tiller", [k(0.05), k(0.05), k(0.45)], { at: [0, k(0.15), k(0.15)], material: "engine_black" }),
  ], { at: [0, "$ytr", "-$L2 + 0.02"] });
}

/** A bucket seat facing +z: cushion and back. */
const bucket = (name: string, at: Vec, mirror?: string): SpecNode => group(name, [
  box("Base", [0.4, 0.35, 0.4], { at: [0, 0.175, 0], bevel: 0.03, material: "accent" }),
  box("Cushion", [0.5, 0.12, 0.48], { at: [0, 0.4, 0], bevel: 0.05, material: "upholstery" }),
  box("Back", [0.5, 0.5, 0.12], { at: [0, 0.68, -0.22], rotate: [-10, 0, 0], bevel: 0.05, material: "upholstery" }),
], { at, ...(mirror ? { mirror } : {}) });

function buildBoat(b: BoatDef): AssetDraft {
  const h = b.hull;
  const kids: SpecNode[] = [];
  const th = b.kind === "dinghy" ? "0.025" : "0.05";
  const shell = [0, 0.02, 0.15, 0.32, 0.5, b.deck].filter((s, i, a) => s <= b.deck && a.indexOf(s) === i).map((s) => shellSection(h, s, th));
  const bowS = [b.deck - 0.004, ...[0.7, 0.8, 0.88, 0.94, 0.98, 1].filter((s) => s > b.deck + 0.01)];
  const hullKids: SpecNode[] = [
    loft("Shell", shell, { material: "hull_paint" }),
    loft("Foredeck", bowS.map((s) => solidSection(h, s)), { material: "hull_paint" }),
  ];
  // A white deck skin on the foredeck.
  if (b.kind !== "dinghy" && b.kind !== "rib") {
    hullKids.push(loft("DeckSkin", bowS.filter((s) => s <= 0.95).map((s) => ({ z: `-$L2 + ${f(2 * s)} * $L2`, superellipse: { width: `${f(beamAt(h, s) * 1.9)} * $B2`, height: 0.03, n: 4, count: 16, cy: `${f(sheerAt(h, s))} * $fb + 0.006` } })), { material: "deck_white" }));
  }
  // Rub rail along the sheer, both sides.
  const rail: Vec[] = [0.0, 0.15, 0.35, 0.55, 0.72, 0.85, 0.93, 0.98].map((s) => [`${xb(h, s)} + 0.01`, `${ysh(h, s)} - 0.03`, zs(s)] as Vec);
  hullKids.push(tube("RubRail_L", rail, 0.028, { segments: 8, material: b.kind === "dinghy" ? "accent" : "rub_black", mirror: "RubRail_R" }));
  // A coloured stripe below the sheer.
  if (b.kind !== "dinghy" && b.kind !== "rib") hullKids.push(tube("Stripe_L", [0.02, 0.2, 0.4, 0.6, 0.75, 0.86].map((s) => [`${xb(h, s)} - 0.005`, `${ysh(h, s)} * 0.55`, zs(s)] as Vec), 0.03, { segments: 6, material: "accent", mirror: "Stripe_R" }));
  kids.push(group("Hull", hullKids));

  // Cockpit sole.
  const [kd, kf] = keelAt(h, 0.3);
  const sole = `${f(kd * 0.55)} * $d + ${f(0.12 + kf)} * $fb`;
  const soleLen = `${f(2 * Math.min(b.deck, 0.6))} * $L2 - 0.2`;
  kids.push(box("Sole", [`${xb(h, 0.3, 1.5)} - 0.1`, 0.04, soleLen], { at: [0, sole, `-$L2 + (${soleLen}) / 2 + 0.1`], material: b.kind === "dinghy" ? "hull_paint" : "teak" }));

  const deckZ = zs(b.deck);
  const deckY = ysh(h, b.deck);
  switch (b.kind) {
    case "runabout":
    case "cruiser": {
      const cr = b.kind === "cruiser";
      // Windscreen across the front of the cockpit.
      const wy = `${deckY} - 0.02`;
      const ww = xb(h, b.deck, 0.92);
      kids.push(group("Windscreen", [
        box("Centre", [`${ww} * 0.9`, cr ? 0.45 : 0.36, 0.02], { at: [0, cr ? 0.2 : 0.16, 0], rotate: [-35, 0, 0], material: "screen_glass" }),
        box("Side_L", [0.02, cr ? 0.4 : 0.32, `${ww} * 0.55`], { at: [`${ww} * 0.95`, cr ? 0.18 : 0.14, `-${ww} * 0.4`], rotate: [0, 0, -12], material: "screen_glass", mirror: "Side_R" }),
        tube("Frame", [[`-${ww} * 0.95`, 0.0, `-${ww} * 0.6`], [`-${ww} * 0.9`, cr ? 0.37 : 0.3, `-${ww} * 0.2`], [`-${ww} * 0.45`, cr ? 0.37 : 0.3, -0.12], [`${ww} * 0.45`, cr ? 0.37 : 0.3, -0.12], [`${ww} * 0.9`, cr ? 0.37 : 0.3, `-${ww} * 0.2`], [`${ww} * 0.95`, 0.0, `-${ww} * 0.6`]], 0.014, { segments: 6, material: "steel" }),
      ], { at: [0, wy, `${deckZ} - 0.05`] }));
      kids.push(group("Helm", [
        box("Dash", [0.7, 0.55, 0.45], { at: [0, 0.27, 0], bevel: 0.04, material: "deck_white" }),
        box("Panel", [0.6, 0.18, 0.04], { at: [0, 0.5, -0.2], rotate: [-30, 0, 0], material: "rub_black" }),
        cyl("Wheel", 0.17, 0.03, { at: [0, 0.48, -0.3], rotate: [60, 0, 0], segments: 18, material: "rub_black" }),
      ], { at: [`${xb(h, b.deck - 0.08)} * 0.5`, sole, `${deckZ} - 0.25`] }));
      kids.push(bucket("Seat_Helm", [`${xb(h, b.deck - 0.12)} * 0.5`, sole, `${deckZ} - 1.0`]));
      kids.push(bucket("Seat_Mate", [`-${xb(h, b.deck - 0.12)} * 0.5`, sole, `${deckZ} - 1.0`]));
      kids.push(group("Seat_Bench", [
        box("Base", [`${xb(h, 0.08, 1.6)}`, 0.38, 0.5], { at: [0, 0.19, 0], bevel: 0.03, material: "deck_white" }),
        box("Cushion", [`${xb(h, 0.08, 1.55)}`, 0.12, 0.5], { at: [0, 0.43, 0], bevel: 0.05, material: "upholstery" }),
        box("Back", [`${xb(h, 0.08, 1.55)}`, 0.4, 0.12], { at: [0, 0.65, -0.24], rotate: [-12, 0, 0], bevel: 0.05, material: "upholstery" }),
      ], { at: [0, sole, "-$L2 + 0.45"] }));
      if (cr) {
        // Cuddy cabin top on the foredeck with portholes, a sun pad and a stern drive.
        kids.push(loft("Cabin", [0.0, 0.25, 0.6].map((u) => {
          const s = b.deck + (0.86 - b.deck) * u;
          const w = beamAt(h, s) * 0.78;
          return { z: zs(s), superellipse: { width: `${f(w * 2)} * $B2`, height: 0.5 - u * 0.25, n: 3, count: 24, cy: `${ysh(h, s)} - 0.02` } };
        }), { material: "deck_white" }));
        kids.push(cyl("Porthole_L{i}", 0.06, 0.04, { axis: "x", at: [xb(h, b.deck + 0.06, 0.74), `${ysh(h, b.deck + 0.06)} + 0.08`, zs(b.deck + 0.06)], repeat: { count: 3, step: [0, 0, "0.32"] }, segments: 14, material: "dark_glass", mirror: "Porthole_R" }));
        kids.push(box("SunPad", [`${xb(h, 0.05, 1.5)}`, 0.12, 0.9], { at: [0, `${ysh(h, 0.05)} - 0.02`, "-$L2 + 0.55"], bevel: 0.05, material: "upholstery" }));
        kids.push(group("Engine", [
          box("Housing", [0.36, 0.3, 0.4], { at: [0, 0.0, -0.2], bevel: 0.05, material: "engine_black" }),
          box("Leg", [0.12, "$d + 0.25", 0.25], { at: [0, "-($d + 0.25) / 2", -0.3], bevel: 0.03, material: "engine_black" }),
          group("Propeller", [ellipsoid("Boss", [0.05, 0.05, 0.08], { segments: 12, material: "steel" }), box("Blade_{i}", [0.012, 0.17, 0.06], { at: [0, 0.09, 0], rotate: [0, 25, 0], repeat: { count: 3, around: "z" }, material: "steel" })], { at: [0, "-$d * 0.85", -0.5] }),
        ], { at: [0, "$fb * 0.25", "-$L2 + 0.02"] }));
        kids.push(box("SwimPlatform", [`${xb(h, 0, 1.8)}`, 0.06, 0.5], { at: [0, 0.15, "-$L2 - 0.22"], bevel: 0.015, material: "teak" }));
        kids.push(box("Hanger_{i}", [0.06, 0.12, 0.5], { at: [`-${xb(h, 0, 0.6)}`, 0.1, "-$L2 - 0.22"], repeat: { count: 2, step: [`${xb(h, 0, 1.2)}`, 0, 0] }, material: "steel" }));
      } else {
        kids.push(outboard(1.15, "cowl_white"));
        kids.push(box("Cushion_Bow", [`${xb(h, b.deck + 0.08, 1.2)}`, 0.06, 0.6], { at: [0, `${ysh(h, b.deck + 0.08)} + 0.01`, zs(b.deck + 0.08)], bevel: 0.02, material: "upholstery" }));
      }
      // Bow rail with stanchions.
      kids.push(tube("BowRail_L", [0.8, 0.88, 0.95, 0.99].map((s) => [`${xb(h, s, 0.85)}`, `${ysh(h, s)} + 0.3`, zs(s)] as Vec), 0.014, { segments: 6, material: "steel", mirror: "BowRail_R" }));
      kids.push(cyl("Stanchion_L{i}", 0.012, 0.32, { at: [xb(h, 0.8, 0.85), `${ysh(h, 0.8)} + 0.14`, zs(0.8)], repeat: { count: 2, step: [`${xb(h, 0.92, 0.85)} - ${xb(h, 0.8, 0.85)}`, `${ysh(h, 0.92)} - ${ysh(h, 0.8)}`, `${zs(0.92)} - (${zs(0.8)})`] }, segments: 6, material: "steel", mirror: "Stanchion_R" }));
      break;
    }
    case "fishing": {
      const s0 = 0.48, s1 = 0.74;
      const w = `${xb(h, 0.6, 0.86)}`;
      const z0 = zs(s0), z1 = zs(s1);
      const y0 = `${sole}`;
      kids.push(group("Wheelhouse", [
        box("Walls", [`${w} * 2`, "1.95", `${z1} - (${z0})`], { at: [0, 0.975, `(${z1} - (${z0})) / 2`], bevel: 0.03, material: "deck_white" }),
        box("Roof", [`${w} * 2 + 0.16`, 0.08, `${z1} - (${z0}) + 0.3`], { at: [0, 1.99, `(${z1} - (${z0})) / 2 - 0.1`], bevel: 0.03, material: "deck_white" }),
        box("FrontWindow", [`${w} * 2 - 0.2`, 0.55, 0.04], { at: [0, 1.55, `${z1} - (${z0}) + 0.01`], material: "dark_glass" }),
        box("SideWindow_L", [0.04, 0.5, `(${z1} - (${z0})) * 0.7`], { at: [`${w} + 0.01`, 1.55, `(${z1} - (${z0})) * 0.5`], material: "dark_glass", mirror: "SideWindow_R" }),
        box("RearDoor", [0.65, 1.6, 0.04], { at: [`${w} * 0.4`, 0.82, -0.01], bevel: 0.01, material: "accent" }),
        box("RearWindow", [0.5, 0.45, 0.04], { at: [`-${w} * 0.45`, 1.55, -0.01], material: "dark_glass" }),
        group("Mast", [
          cyl("Pole", 0.04, 1.4, { at: [0, 0.7, 0], segments: 10, material: "steel" }),
          box("Spreader", [0.8, 0.05, 0.05], { at: [0, 1.0, 0], material: "steel" }),
          box("Radar", [0.7, 0.07, 0.15], { at: [0, 1.42, 0], bevel: 0.02, material: "deck_white" }),
          cyl("Anchorlight", 0.04, 0.1, { at: [0, 1.5, 0], segments: 10, material: "lamp_lens" }),
        ], { at: [0, 2.03, `(${z1} - (${z0})) * 0.4`] }),
        bucket("Seat_Skipper", [`${w} * 0.45`, 0.0, `(${z1} - (${z0})) * 0.55`]),
        box("NavLight_L", [0.06, 0.1, 0.14], { at: [`${w} + 0.08`, 1.92, `${z1} - (${z0}) - 0.15`], material: "lamp_red" }),
        box("NavLight_R", [0.06, 0.1, 0.14], { at: [`-${w} - 0.08`, 1.92, `${z1} - (${z0}) - 0.15`], material: "lamp_green" }),
      ], { at: [0, y0, z0] }));
      kids.push(tube("GuardRail_L", [0.03, 0.2, 0.45].map((s) => [`${xb(h, s)} - 0.06`, `${ysh(h, s)} + 0.45`, zs(s)] as Vec), 0.02, { segments: 6, material: "steel", mirror: "GuardRail_R" }));
      kids.push(cyl("Post_L{i}", 0.018, 0.48, { at: [`${xb(h, 0.1)} - 0.06`, `${ysh(h, 0.1)} + 0.22`, zs(0.1)], repeat: { count: 3, step: [0, 0, `$L2 * 0.25`] }, segments: 6, material: "steel", mirror: "Post_R" }));
      kids.push(cyl("RodHolder_{i}", 0.025, 0.3, { at: [`-${xb(h, 0.08)} + 0.12`, `${ysh(h, 0.08)} + 0.05`, zs(0.08)], rotate: [-20, 0, 0], repeat: { count: 3, step: [`${xb(h, 0.08)} - 0.12`, 0, 0] }, segments: 8, material: "steel" }));
      kids.push(box("FishBox", [0.9, 0.5, 0.6], { at: [0, `${sole} + 0.25`, "-$L2 + 0.9"], bevel: 0.04, material: "deck_white" }));
      kids.push(outboard(1.2, "cowl_black"));
      kids.push(box("Anchor", [0.08, 0.25, 0.35], { at: [0, `${ysh(h, 0.97)} - 0.05`, zs(0.97)], material: "steel" }));
      break;
    }
    case "console": {
      kids.push(group("Console", [
        box("Housing", [0.8, 1.0, 0.75], { at: [0, 0.5, 0], bevel: 0.05, material: "deck_white" }),
        box("Screen", [0.7, 0.4, 0.02], { at: [0, 1.15, 0.28], rotate: [-25, 0, 0], material: "screen_glass" }),
        box("Display", [0.35, 0.22, 0.04], { at: [0, 0.9, -0.33], rotate: [-25, 0, 0], material: "dark_glass" }),
        cyl("Wheel", 0.16, 0.03, { at: [0, 0.82, -0.42], rotate: [60, 0, 0], segments: 18, material: "rub_black" }),
        group("TTop", [
          tube("Leg_L", [[0.36, 0.95, 0.2], [0.42, 2.15, 0.1]], 0.025, { segments: 8, material: "steel", mirror: "Leg_R" }),
          tube("LegAft_L", [[0.36, 0.95, -0.25], [0.42, 2.15, -0.6]], 0.025, { segments: 8, material: "steel", mirror: "LegAft_R" }),
          box("Canopy", [1.5, 0.08, 1.4], { at: [0, 2.18, -0.25], bevel: 0.03, material: "accent" }),
        ]),
      ], { at: [0, sole, zs(0.5)] }));
      kids.push(group("Seat_LeaningPost", [
        box("Base", [0.75, 0.6, 0.45], { at: [0, 0.3, 0], bevel: 0.04, material: "deck_white" }),
        box("Pad", [0.75, 0.16, 0.38], { at: [0, 0.72, 0], bevel: 0.06, material: "upholstery" }),
        box("Back", [0.75, 0.3, 0.1], { at: [0, 0.95, -0.2], bevel: 0.04, material: "upholstery" }),
      ], { at: [0, sole, zs(0.33)] }));
      kids.push(box("Seat_Bow", [`${xb(h, 0.85, 1.2)}`, 0.14, 0.5], { at: [0, `${ysh(h, b.deck)} + 0.05`, zs(0.86)], bevel: 0.05, material: "upholstery" }));
      kids.push(outboard(1.3, "cowl_black"));
      kids.push(tube("BowRail_L", [0.82, 0.9, 0.96, 0.995].map((s) => [`${xb(h, s, 0.85)}`, `${ysh(h, s)} + 0.32`, zs(s)] as Vec), 0.014, { segments: 6, material: "steel", mirror: "BowRail_R" }));
      kids.push(cyl("Stanchion_L", 0.012, 0.34, { at: [xb(h, 0.82, 0.85), `${ysh(h, 0.82)} + 0.15`, zs(0.82)], segments: 6, material: "steel", mirror: "Stanchion_R" }));
      break;
    }
    case "dinghy": {
      kids.push(box("Seat_Mid", [`${xb(h, 0.5, 2)} - 0.04`, 0.035, 0.24], { at: [0, `${ysh(h, 0.5)} - 0.2`, zs(0.5)], bevel: 0.008, material: "accent" }));
      kids.push(box("Seat_Aft", [`${xb(h, 0.12, 2)} - 0.04`, 0.035, 0.24], { at: [0, `${ysh(h, 0.12)} - 0.2`, zs(0.12)], bevel: 0.008, material: "accent" }));
      kids.push(box("Rib_{i}", [`${xb(h, 0.3, 1.8)}`, 0.03, 0.04], { at: [0, `${sole} + 0.03`, zs(0.2)], repeat: { count: 4, step: [0, 0, "$L2 * 0.25"] }, material: "hull_paint" }));
      kids.push(outboard(0.6, "cowl_black"));
      break;
    }
    case "rib": {
      // Inflatable tubes round the gunwale, from the stern on one side, round the bow, back to the other.
      const path: Vec[] = [];
      for (const s of [-0.03, 0.15, 0.4, 0.62, 0.78]) path.push([`${xb(h, Math.max(s, 0))} + 0.06`, `${ysh(h, Math.max(s, 0))} + 0.02`, zs(s)]);
      // Round the bow on a half circle, so the tube never folds on itself.
      const rr = `(${xb(h, 0.86)} + 0.06)`;
      for (const a of [0, 30, 60, 90]) {
        const r = (a * Math.PI) / 180;
        path.push([a === 90 ? 0 : `${rr} * ${f(Math.cos(r))}`, `${ysh(h, 0.86)} + ${f(0.02 + 0.06 * Math.sin(r))}`, `${zs(0.86)} + ${rr} * ${f(0.85 * Math.sin(r))}`]);
      }
      const full = [...path, ...[...path].reverse().slice(1).map(([x, y, z]) => [x === 0 ? 0 : `-(${x})`, y, z] as Vec)];
      kids.push(tube("Tubes", full, 0.23, { segments: 16, material: "tube_grey" }));
      kids.push(tube("Strake_L", path.slice(0, 6).map(([x, y, z]) => [`${x} + 0.2`, `${y} - 0.05`, z] as Vec), 0.03, { segments: 6, material: "accent", mirror: "Strake_R" }));
      kids.push(group("Console", [
        box("Housing", [0.6, 0.8, 0.55], { at: [0, 0.4, 0], bevel: 0.05, material: "accent" }),
        box("Screen", [0.5, 0.3, 0.02], { at: [0, 0.95, 0.2], rotate: [-25, 0, 0], material: "screen_glass" }),
        cyl("Wheel", 0.14, 0.03, { at: [0, 0.75, -0.3], rotate: [60, 0, 0], segments: 16, material: "rub_black" }),
      ], { at: [0, sole, zs(0.5)] }));
      kids.push(group("Seat_Jockey", [box("Base", [0.4, 0.5, 0.5], { at: [0, 0.25, 0], bevel: 0.04, material: "rub_black" }), box("Pad", [0.45, 0.16, 0.7], { at: [0, 0.58, 0], bevel: 0.06, material: "upholstery" })], { at: [0, sole, zs(0.3)] }));
      kids.push(outboard(1.0, "cowl_black"));
      break;
    }
  }
  kids.push(cyl("Cleat_L", 0.02, 0.18, { axis: "z", at: [`${xb(h, 0.06)} - 0.08`, `${ysh(h, 0.06)} + 0.02`, zs(0.06)], segments: 8, material: "steel", mirror: "Cleat_R" }));

  const transomTop = ysh(h, 0);
  const kindTag: Record<Kind, string[]> = { runabout: ["speedboat", "speedboot", "bowrider"], cruiser: ["speedboat", "speedboot", "cabin cruiser", "kajuitboot"], fishing: ["fishing boat", "vissersboot", "wheelhouse", "stuurhut"], console: ["center console", "visboot", "sportvisboot"], dinghy: ["dinghy", "bijboot", "aluminium boat"], rib: ["rib", "rubberboot", "inflatable"] };
  return {
    slug: slugify("boat", b.kind === "console" ? "center-console" : b.kind, b.colour),
    title: `${b.colour.charAt(0).toUpperCase()}${b.colour.slice(1)} ${b.name}`,
    description: `A ${b.colour} ${b.name}, about ${b.length[0]} m long: ${b.text}. The hull is an open shell with a solid foredeck; it floats on its waterline at y = 0 with the keel below it, bow at +z.`,
    tags: [b.name, b.kind, b.colour, b.nl, "boot", "motorboot", ...kindTag[b.kind]],
    params: [
      num("length", b.length[0], b.length[1], b.length[2], "Length over all in metres."),
      num("beam", b.beam[0], b.beam[1], b.beam[2], "Widest beam of the hull in metres."),
      num("freeboard", b.freeboard[0], b.freeboard[1], b.freeboard[2], "Height of the sheer above the waterline at the transom, in metres."),
    ],
    materials: {
      // Gelcoat hull, a non-skid moulded deck, marine vinyl, teak and stainless fittings.
      hull_paint: b.paint, accent: b.accent, deck_white: { color: [0.58, 0.58, 0.55], metallic: 0, roughness: 0.6, texture: "plastic" },
      teak: { color: [0.3, 0.17, 0.07], metallic: 0, roughness: 0.75, texture: "wood" },
      upholstery: { color: [0.58, 0.56, 0.5], metallic: 0, roughness: 0.5, texture: "leather" },
      rub_black: VMATS["trim_black"]!, dark_glass: VMATS["dark_glass"]!, lamp_lens: VMATS["lamp_lens"]!, lamp_red: VMATS["lamp_red"]!,
      lamp_green: { color: [0.02, 0.5, 0.1], metallic: 0.1, roughness: 0.1, emissive: [0.01, 0.5, 0.08] },
      screen_glass: { color: [0.3, 0.38, 0.42, 0.35], metallic: 0, roughness: 0.04, alpha: "BLEND", doubleSided: true },
      engine_black: { color: [0.035, 0.035, 0.038], metallic: 0.25, roughness: 0.45, texture: "painted" },
      cowl_white: { color: [0.62, 0.62, 0.6], metallic: 0.2, roughness: 0.25, texture: "painted" },
      cowl_black: { color: [0.025, 0.025, 0.028], metallic: 0.3, roughness: 0.25, texture: "painted" },
      tube_grey: { color: [0.16, 0.17, 0.18], metallic: 0, roughness: 0.7, texture: "fabric" },
      steel: VMATS["stainless"]!,
    },
    nodes: [group("Boat", kids, { vars: { L2: "$length / 2", B2: "$beam / 2", fb: "$freeboard", d: "0.1 + $beam * 0.1", ytr: transomTop } })],
  };
}

export const boat: Family = {
  id: "boat",
  category: "vehicles",
  archetype: "vessel.boat",
  tags: ["boat", "boot", "motorboat", "motorboot", "vessel", "vaartuig", "watercraft"],
  assets: () => BOATS.map((b) => buildBoat(b)),
};
