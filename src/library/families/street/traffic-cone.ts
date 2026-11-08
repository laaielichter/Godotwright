import { box, cyl, group, lathe, num, slugify, type AssetDraft, type Family, type SpecNode } from "../../kit.js";
import { GRIME, grimeRound, nice, up, useMats } from "./common.js";

type Style = "cone" | "lamp-cone" | "delineator" | "drum";

const STYLES: Record<Style, { title: string; text: string; colours: string[] }> = {
  cone: { title: "traffic cone", text: "a tapered cone with two reflective collars on a square rubber base with a raised rim", colours: ["plastic_orange", "plastic_red"] },
  "lamp-cone": { title: "traffic cone with warning lamp", text: "a tall cone with a reflective collar on a square base, topped by an amber warning lamp in a clip housing", colours: ["plastic_orange", "plastic_yellow"] },
  delineator: { title: "delineator post", text: "a tall round post with reflective bands and a grip ring on top, standing in a heavy octagonal rubber base", colours: ["plastic_orange", "plastic_yellow"] },
  drum: { title: "traffic drum", text: "a ribbed barrel with alternating reflective bands and a handle in the lid, standing in a rubber tyre base", colours: ["plastic_orange", "plastic_red"] },
};

/** Radius of the cone surface at height y (base radius $r at 0.035, 0.022 at the top). */
const rc = (y: string): string => `($r - ($r - 0.022) * ((${y}) - 0.035) / ($height - 0.045))`;

const collar = (name: string, y0: string, y1: string): SpecNode =>
  lathe(name, [[`${rc(y0)} + 0.003`, y0], [`${rc(y1)} + 0.003`, y1]], { segments: 24, material: "reflector_white" });

function nodes(style: Style): SpecNode[] {
  switch (style) {
    case "cone":
    case "lamp-cone": {
      const lamp = style === "lamp-cone";
      return [
        group("Base", [
          box("Plate", ["$r * 2 + 0.08", 0.03, "$r * 2 + 0.08"], { anchor: "bottom", bevel: 0.015 }),
          lathe("Rim", [["$r + 0.01", 0.02], ["$r + 0.01", 0.045], ["$r - 0.005", 0.05]], { segments: 24 }),
        ], { material: "rubber" }),
        lathe("Cone", [["$r", 0.035], ["0.022", "$height - 0.01"], [0.012, "$height"]], { segments: 24 }),
        // Scuffs and road dirt on the lower cone: two see-through films that follow its taper.
        lathe("Grime_1", [[`${rc("0.036")} + 0.003`, 0.036], [`${rc("$height * 0.2")} + 0.003`, "$height * 0.2"]], { segments: 24, material: "grime" }),
        lathe("Grime_2", [[`${rc("0.036")} + 0.0045`, 0.036], [`${rc("0.036 + $height * 0.06")} + 0.0045`, "0.036 + $height * 0.06"]], { segments: 24, material: "grime_heavy" }),
        ...(lamp
          ? [collar("Band", "$height * 0.45", "$height * 0.6"),
              group("Lamp", [
                box("Clip", [0.04, 0.08, 0.03], { at: [0, "$height - 0.02", 0], anchor: "bottom", bevel: 0.006, material: "plastic_black" }),
                box("Housing", [0.16, 0.16, 0.06], { at: [0, "$height + 0.12", 0], bevel: 0.02, material: "plastic_black" }),
                cyl("Lens", 0.07, 0.012, { axis: "z", at: [0, "$height + 0.12", 0.031], segments: 20, material: "bulb_amber" }),
                cyl("LensBack", 0.07, 0.012, { axis: "z", at: [0, "$height + 0.12", -0.031], segments: 20, material: "bulb_amber" }),
              ])]
          : [collar("Band_1", "$height * 0.3", "$height * 0.45"), collar("Band_2", "$height * 0.58", "$height * 0.68")]),
      ];
    }
    case "delineator":
      return [
        group("Base", [
          cyl("Weight", "$r * 2", 0.05, { anchor: "base", segments: 8, bevel: 0.012, rotate: [0, 22.5, 0] }),
          lathe("Socket", [["$r + 0.025", 0.04], ["$r + 0.015", 0.1], ["$r + 0.008", 0.12]], { segments: 20 }),
        ], { material: "rubber" }),
        cyl("Body", "$r", "$height - 0.07", { at: [0, 0.04, 0], anchor: "base", segments: 20, bevel: 0.01 }),
        cyl("Band_{i}", "$r + 0.003", 0.08, { at: [0, "$height - 0.32", 0], anchor: "base", segments: 20, repeat: { count: 3, step: [0, -0.18, 0] }, material: "reflector_white" }),
        lathe("Grip", [["$r * 0.5", "$height - 0.04"], ["$r * 0.9", "$height - 0.02"], ["$r * 0.9", "$height"], ["$r * 0.4", "$height + 0.005"]], { segments: 20 }),
        ...grimeRound("Grime", "$r + 0.004", "$r + 0.004", 0.22, [0, 0.12, 0], 20),
      ];
    case "drum": {
      const prof: [string, string | number][] = [["$r * 0.9", 0.06]];
      for (let k = 0; k < 6; k++) {
        const y0 = `0.06 + ($height - 0.12) * ${k / 6}`;
        const y1 = `0.06 + ($height - 0.12) * ${(k + 0.5) / 6}`;
        prof.push([k === 0 ? "$r * 0.95" : "$r * 0.97", y0], ["$r", y1]);
      }
      prof.push(["$r * 0.96", "$height - 0.06"], ["$r * 0.9", "$height - 0.03"], ["$r * 0.6", "$height - 0.02"]);
      return [
        group("Base", [lathe("Tyre", [["$r * 0.85", 0], ["$r + 0.08", 0], ["$r + 0.1", 0.04], ["$r + 0.06", 0.08], ["$r * 0.85", 0.08]], { segments: 24 })], { material: "rubber" }),
        lathe("Body", prof, { segments: 24 }),
        cyl("Band_{i}", "$r + 0.003", "($height - 0.12) / 12", { at: [0, "0.06 + ($height - 0.12) * 0.25 / 6", 0], anchor: "base", segments: 24, repeat: { count: 2, step: [0, "($height - 0.12) * 2 / 6", 0] }, material: "reflector_white" }),
        cyl("Band_Top", "$r + 0.003", "($height - 0.12) / 12", { at: [0, "0.06 + ($height - 0.12) * 4.25 / 6", 0], anchor: "base", segments: 24, material: "reflector_white" }),
        box("Handle", ["$r * 0.8", 0.04, 0.05], { at: [0, "$height - 0.02", 0], anchor: "bottom", bevel: 0.015 }),
        ...grimeRound("Grime", "$r + 0.004", "$r + 0.004", 0.24, [0, 0.07, 0]),
      ];
    }
  }
}

function params(style: Style) {
  switch (style) {
    case "cone":
      return [num("height", 0.75, 0.45, 0.95, "Height of the cone in metres."), num("r", 0.16, 0.12, 0.2, "Radius of the cone at its base in metres.")];
    case "lamp-cone":
      return [num("height", 0.75, 0.6, 0.95, "Height of the cone without the lamp in metres."), num("r", 0.17, 0.14, 0.2, "Radius of the cone at its base in metres.")];
    case "delineator":
      return [num("height", 1.0, 0.8, 1.15, "Height of the post in metres."), num("r", 0.05, 0.04, 0.065, "Radius of the post in metres.")];
    case "drum":
      return [num("height", 1.0, 0.85, 1.1, "Height of the drum in metres."), num("r", 0.25, 0.22, 0.28, "Radius of the drum in metres.")];
  }
}

function makeCone(style: Style, colour: string): AssetDraft {
  const s = STYLES[style];
  const c = nice(colour);
  return {
    slug: slugify("traffic-cone", style, colour.replace(/^plastic_/, "")),
    title: up(`${c} ${s.title}`),
    description: `A ${c} ${s.title}: ${s.text}. It is round and faces +z.`,
    tags: [style, c, "pylon", "verkeerskegel", "pion", "pylon", "wegafzetting", ...(style === "drum" ? ["vat", "barrel"] : []), ...(style === "delineator" ? ["bakenpaal", "markeringspaal"] : [])],
    params: params(style),
    materials: { ...useMats(colour, "rubber", "reflector_white", "plastic_black", "bulb_amber"), ...GRIME(colour) },
    nodes: [group("TrafficCone", nodes(style), { material: colour })],
  };
}

export const trafficCone: Family = {
  id: "traffic-cone",
  category: "street",
  archetype: "prop.traffic-cone",
  tags: ["traffic cone", "cone", "pylon", "verkeerskegel", "pion", "pylon", "roadworks", "wegwerkzaamheden"],
  assets: () => (Object.keys(STYLES) as Style[]).flatMap((style) => STYLES[style].colours.map((c) => makeCone(style, c))),
};
