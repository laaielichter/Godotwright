import { box, cyl, ellipsoid, group, lathe, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { GRIME, grimeProfile, nice, up, useMats } from "./common.js";

type Style = "american" | "column" | "post" | "standpipe";
interface Finish { body: string; cap: string }

const STYLES: Record<Style, { title: string; text: string; finishes: Finish[] }> = {
  american: {
    title: "American fire hydrant",
    text: "a squat barrel on a bolted flange, two hose outlets left and right and a large pumper outlet at the front, all with hexagonal caps, under a domed bonnet with a pentagon nut",
    finishes: [{ body: "paint_red", cap: "paint_red" }, { body: "paint_yellow", cap: "chrome" }, { body: "paint_red", cap: "paint_white" }],
  },
  column: {
    title: "European pillar hydrant",
    text: "a tall slender column on a flared foot with two outlets angled down to the sides, a reflective band and a domed top with an operating nut",
    finishes: [{ body: "paint_red", cap: "paint_red" }, { body: "pillar_red", cap: "brushed_steel" }, { body: "paint_yellow", cap: "paint_black" }],
  },
  post: {
    title: "slim post hydrant",
    text: "a slim post with one capped outlet to the front, a moulded waist and a rounded cap with a square nut",
    finishes: [{ body: "paint_red", cap: "galvanised" }, { body: "paint_green", cap: "paint_green" }],
  },
  standpipe: {
    title: "four-way hydrant",
    text: "a short wide barrel with four capped outlets around it, a heavy flange and a flat bonnet with an operating nut",
    finishes: [{ body: "paint_yellow", cap: "paint_red" }, { body: "galvanised", cap: "paint_red" }],
  },
};

/** A hose outlet pointing along +x from its root: a nozzle and a hexagonal cap. */
const outlet = (name: string, r: string, len: string | number, o: { at: [string | number, string | number, string | number]; rotate?: [number, number, number]; mirror?: string; repeat?: { count: number; around: "y"; phase?: number } }, cap: string): SpecNode =>
  group(name, [
    cyl("Nozzle", r, len, { axis: "x", at: [`${len} / 2`, 0, 0], segments: 16, bevel: 0.004 }),
    cyl("Plug", `${r} * 1.2`, 0.035, { axis: "x", at: [`${len} + 0.012`, 0, 0], segments: 6, bevel: 0.004, material: cap }),
    cyl("Lug", `${r} * 0.35`, 0.02, { axis: "x", at: [`${len} + 0.035`, 0, 0], segments: 6, material: cap }),
  ], o);

function nodes(style: Style, f: Finish): SpecNode[] {
  switch (style) {
    case "american":
      return [
        lathe("Barrel", [["$r + 0.07", 0], ["$r + 0.07", 0.035], ["$r + 0.03", 0.05], ["$r", 0.09], ["$r", "$height - 0.2"], ["$r + 0.03", "$height - 0.19"], ["$r + 0.03", "$height - 0.155"], ["$r", "$height - 0.15"]], { segments: 24 }),
        cyl("Bolt_{i}", 0.012, 0.02, { at: ["$r + 0.05", 0.035, 0], anchor: "base", segments: 6, repeat: { count: 8, around: "y", phase: 22.5 }, material: "rust" }),
        ...grimeProfile("Grime", [["$r + 0.07", 0.001], ["$r + 0.07", 0.035], ["$r + 0.03", 0.05], ["$r", 0.09], ["$r", 0.22]]),
        outlet("Outlet_L", "$out", 0.08, { at: ["$r - 0.01", "$height * 0.58", 0], mirror: "Outlet_R" }, f.cap),
        outlet("Outlet_F", "$out * 1.5", 0.08, { at: [0, "$height * 0.48", "$r - 0.01"], rotate: [0, -90, 0] }, f.cap),
        group("Cap", [
          lathe("Bonnet", [["$r + 0.025", "$height - 0.16"], ["$r + 0.025", "$height - 0.13"], ["$r * 0.8", "$height - 0.07"], [0.045, "$height - 0.04"]], { segments: 24 }),
          cyl("Nut", 0.03, 0.045, { at: [0, "$height - 0.045", 0], anchor: "base", segments: 5, bevel: 0.003, rotate: [0, 90, 0], material: "steel" }),
        ], { material: f.cap }),
      ];
    case "column":
      return [
        lathe("Barrel", [["$r * 2", 0], ["$r * 2", 0.03], ["$r * 1.5", 0.07], ["$r * 1.1", 0.2], ["$r", 0.3], ["$r", "$height * 0.55"], ["$r * 1.25", "$height * 0.6"], ["$r * 1.25", "$height * 0.75"], ["$r", "$height * 0.8"], ["$r", "$height - 0.08"]], { segments: 24 }),
        cyl("Band", "$r + 0.003", 0.06, { at: [0, "$height * 0.86", 0], segments: 24, material: "reflector_white" }),
        ...grimeProfile("Grime", [["$r * 2", 0.001], ["$r * 2", 0.03], ["$r * 1.5", 0.07], ["$r * 1.1", 0.2], ["$r", 0.3]]),
        outlet("Outlet_L", "$out", 0.09, { at: ["$r * 1.15", "$height * 0.66", 0], rotate: [0, 0, -30], mirror: "Outlet_R" }, f.cap),
        group("Cap", [
          lathe("Dome", [["$r + 0.015", "$height - 0.09"], ["$r + 0.015", "$height - 0.07"], ["$r * 0.75", "$height - 0.03"], [0.03, "$height - 0.02"]], { segments: 24 }),
          cyl("Nut", 0.022, 0.03, { at: [0, "$height - 0.03", 0], anchor: "base", segments: 5, bevel: 0.003, rotate: [0, 90, 0], material: "steel" }),
        ], { material: f.cap }),
      ];
    case "post":
      return [
        lathe("Barrel", [["$r * 1.6", 0], ["$r * 1.6", 0.025], ["$r * 1.1", 0.06], ["$r", 0.1], ["$r", "$height * 0.45"], ["$r * 1.2", "$height * 0.48"], ["$r * 1.2", "$height * 0.52"], ["$r", "$height * 0.55"], ["$r", "$height - 0.06"]], { segments: 20 }),
        outlet("Outlet_F", "$out", 0.07, { at: [0, "$height * 0.7", "$r - 0.01"], rotate: [0, -90, 0] }, f.cap),
        ...grimeProfile("Grime", [["$r * 1.6", 0.001], ["$r * 1.6", 0.025], ["$r * 1.1", 0.06], ["$r", 0.1], ["$r", 0.2]], { segments: 20 }),
        box("Plate", ["$r * 1.2", 0.08, 0.008], { at: [0, "$height * 0.3", "$r - 0.002"], bevel: 0.002, material: "paint_white" }),
        group("Cap", [
          ellipsoid("Dome", ["$r + 0.01", 0.05, "$r + 0.01"], { at: [0, "$height - 0.06", 0], segments: 20 }),
          box("Nut", [0.03, 0.03, 0.03], { at: [0, "$height - 0.025", 0], anchor: "bottom", bevel: 0.003, material: "steel" }),
        ], { material: f.cap }),
      ];
    case "standpipe":
      return [
        lathe("Barrel", [["$r + 0.08", 0], ["$r + 0.08", 0.05], ["$r + 0.02", 0.07], ["$r", 0.1], ["$r", "$height - 0.1"], ["$r + 0.03", "$height - 0.09"], ["$r + 0.03", "$height - 0.06"]], { segments: 24 }),
        cyl("Bolt_{i}", 0.014, 0.02, { at: ["$r + 0.06", 0.05, 0], anchor: "base", segments: 6, repeat: { count: 8, around: "y", phase: 22.5 }, material: "rust" }),
        ...grimeProfile("Grime", [["$r + 0.08", 0.001], ["$r + 0.08", 0.05], ["$r + 0.02", 0.07], ["$r", 0.1], ["$r", 0.2]]),
        outlet("Outlet_{i}", "$out", 0.08, { at: ["$r - 0.01", "$height * 0.55", 0], repeat: { count: 4, around: "y", phase: 0 } }, f.cap),
        group("Cap", [
          cyl("Bonnet", "$r + 0.01", 0.05, { at: [0, "$height - 0.065", 0], anchor: "base", segments: 24, bevel: 0.01 }),
          cyl("Nut", 0.03, 0.04, { at: [0, "$height - 0.04", 0], anchor: "base", segments: 5, bevel: 0.003, rotate: [0, 90, 0], material: "steel" }),
        ], { material: f.cap }),
      ];
  }
}

function params(style: Style) {
  switch (style) {
    case "american":
      return [num("height", 0.75, 0.6, 0.95, "Height of the hydrant in metres."), num("r", 0.12, 0.1, 0.15, "Radius of the barrel in metres."), num("out", 0.04, 0.03, 0.05, "Radius of the side hose outlets in metres.")];
    case "column":
      return [num("height", 1.0, 0.85, 1.2, "Height of the hydrant in metres."), num("r", 0.085, 0.07, 0.11, "Radius of the column in metres."), num("out", 0.035, 0.028, 0.045, "Radius of the outlets in metres.")];
    case "post":
      return [num("height", 0.8, 0.6, 1.0, "Height of the hydrant in metres."), num("r", 0.07, 0.06, 0.09, "Radius of the post in metres."), num("out", 0.035, 0.028, 0.045, "Radius of the outlet in metres.")];
    case "standpipe":
      return [num("height", 0.6, 0.5, 0.75, "Height of the hydrant in metres."), num("r", 0.15, 0.13, 0.19, "Radius of the barrel in metres."), num("out", 0.04, 0.03, 0.05, "Radius of the outlets in metres.")];
  }
}

function makeHydrant(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const b = nice(f.body), c = nice(f.cap);
  return {
    slug: slugify("fire-hydrant", style, f.body.replace(/^(paint|pillar)_/, ""), f.cap !== f.body ? `${f.cap.replace(/^paint_/, "")}-cap` : ""),
    title: up(`${b} ${s.title}${f.cap !== f.body ? ` with ${c} caps` : ""}`),
    description: `A ${b} ${s.title}: ${s.text}. It faces +z.`,
    tags: [style, b, "brandkraan", "hydrant", "bovengrondse brandkraan"],
    params: params(style),
    materials: { ...useMats(f.body, f.cap, "steel", "rust", "reflector_white", "paint_white"), ...GRIME(f.body) },
    nodes: [group("FireHydrant", nodes(style, f), { material: f.body })],
  };
}

export const fireHydrant: Family = {
  id: "fire-hydrant",
  category: "street",
  archetype: "infrastructure.fire-hydrant",
  tags: ["fire hydrant", "hydrant", "fireplug", "brandkraan", "brandweer", "street furniture"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].finishes.map((f) => makeHydrant(style, f))),
};
