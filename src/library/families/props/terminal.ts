import { box, cyl, ellipsoid, extrude, group, lathe, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { label, mats, type MaterialDef } from "../../palette.js";

/**
 * Terminals: sci-fi desk consoles, ticket machines, ATMs, arcade cabinets, information totems, holo pedestals and
 * industrial control podiums. Every one has a Body, an emissive Screen (its own node, so a script can swap its
 * material) and most a Panel of keys or controls. They stand on y = 0 and face +z.
 */
type Style = "console" | "ticket" | "atm" | "arcade" | "kiosk" | "holo" | "podium";

interface Finish {
  key: string;
  body: string;
  trim: string;
  screen: string;
  accent: string;
}

const FINISHES: Record<Style, [Finish, Finish]> = {
  console: [
    { key: "anthracite", body: "paint_anthracite", trim: "gunmetal", screen: "screen_cyan", accent: "led_blue" },
    { key: "white", body: "paint_white", trim: "brushed_steel", screen: "screen_blue", accent: "led_green" },
  ],
  ticket: [
    { key: "red", body: "paint_red", trim: "brushed_steel", screen: "screen_blue", accent: "bulb_cool" },
    { key: "steel", body: "brushed_steel", trim: "paint_anthracite", screen: "screen_green", accent: "bulb_warm" },
  ],
  atm: [
    { key: "steel", body: "brushed_steel", trim: "plastic_black", screen: "screen_blue", accent: "led_green" },
    { key: "navy", body: "paint_navy", trim: "aluminium", screen: "screen_cyan", accent: "led_blue" },
  ],
  arcade: [
    { key: "black", body: "paint_black", trim: "chrome", screen: "screen_cyan", accent: "bulb_warm" },
    { key: "purple", body: "paint_purple", trim: "plastic_black", screen: "screen_amber", accent: "bulb_cool" },
  ],
  kiosk: [
    { key: "white", body: "paint_white", trim: "aluminium", screen: "screen_cyan", accent: "led_blue" },
    { key: "black", body: "black_steel", trim: "brushed_steel", screen: "screen_amber", accent: "bulb_amber" },
  ],
  holo: [
    { key: "gunmetal", body: "gunmetal", trim: "chrome", screen: "screen_cyan", accent: "led_blue" },
    { key: "white", body: "plastic_white", trim: "aluminium", screen: "screen_green", accent: "led_green" },
  ],
  podium: [
    { key: "grey", body: "paint_grey", trim: "galvanised", screen: "screen_green", accent: "led_green" },
    { key: "yellow", body: "paint_yellow", trim: "black_steel", screen: "screen_amber", accent: "led_red" },
  ],
};

/** A prism along x from a side profile of [z, y] points, between x0 and x1. */
const side = (name: string, pts: [Num, Num][], x0: Num, x1: Num, o: { material?: string; mirror?: string } = {}): SpecNode =>
  extrude(name, pts.map(([z, y]) => [y, z]), `-(${x1})`, `-(${x0})`, { rotate: [0, 0, 90], ...o });

/** A grid of keys on a plate whose top is at local y = 0: rows run along z, keys along x. */
const keys = (name: string, cols: Num, rows: Num, px: number, pz: number, size: [number, number, number], at: [Num, Num, Num], material: string): SpecNode =>
  group(`${name}Row_{i}`, [
    box(`${name}_{i}`, size, { at: [`-(${cols} - 1) * ${px} / 2`, size[1] / 2 - 0.002, 0], bevel: Math.min(size[0], size[2]) * 0.2, repeat: { count: cols, step: [px, 0, 0] } }),
  ], { at, repeat: { count: rows, step: [0, 0, pz] }, material });

function console_(f: Finish): SpecNode[] {
  const profile: [Num, Num][] = [["$d / 2", 0], ["$d / 2", 0.78], ["$d / 2 - 0.06", 0.84], ["-$d / 2 + 0.22", 1.0], ["-$d / 2", 1.0], ["-$d / 2", 0]];
  return [
    group("Console", [
      side("Body", profile, "-$w / 2 + 0.03", "$w / 2 - 0.03"),
      side("Cheek_L", [["$d / 2 + 0.015", 0], ["$d / 2 + 0.015", 0.8], ["$d / 2 - 0.05", 0.87], ["-$d / 2 + 0.2", 1.04], ["-$d / 2 - 0.01", 1.04], ["-$d / 2 - 0.01", 0]], "$w / 2 - 0.031", "$w / 2", { material: f.trim, mirror: "Cheek_R" }),
      box("Kick", ["$w - 0.06", 0.08, 0.02], { at: [0, 0, "$d / 2 - 0.004"], anchor: "bottom", bevel: 0.004, material: "plastic_black" }),
      box("Vent_{i}", [0.012, 0.36, 0.012], { at: ["-($w - 0.2) / 2 + $i * ($w - 0.2) / 11", 0.32, "$d / 2 + 0.002"], bevel: 0.003, material: f.trim, repeat: { count: 12, step: [0, 0, 0] } }),
      box("GlowStrip", ["$w - 0.08", 0.014, 0.012], { at: [0, 0.79, "$d / 2 - 0.003"], material: f.accent }),
      group("Panel", [
        box("Plate", ["$w - 0.12", 0.02, "$sl * 0.86"], { bevel: 0.006, material: "plastic_black" }),
        keys("Switch", "max(floor(($w - 0.5) / 0.045), 4)", 3, 0.045, 0.05, [0.034, 0.014, 0.036], [0.12, 0.009, -0.03], f.trim),
        ellipsoid("Trackball", [0.03, 0.03, 0.03], { at: ["-$w / 2 + 0.17", 0.012, 0.02], segments: 16, material: f.accent }),
        box("Pad", [0.14, 0.006, 0.1], { at: ["-$w / 2 + 0.17", 0.012, -0.08], bevel: 0.003, material: f.trim }),
      ], { at: [0, 0.92, 0.08], rotate: ["deg(atan(0.16 / ($d - 0.28)))", 0, 0] }),
      group("ScreenHood", [
        box("Hood", ["$w - 0.08", "$height - 0.97", 0.08], { anchor: "bottom", bevel: 0.012, material: f.body }),
        box("Bezel", ["$w - 0.14", "$height - 1.06", 0.012], { at: [0, "($height - 0.97) / 2", 0.042], bevel: 0.004, material: "plastic_black" }),
        box("Screen", ["$w - 0.2", "$height - 1.12", 0.008], { at: [0, "($height - 0.97) / 2", 0.049], material: f.screen }),
        box("StatusLight_{i}", [0.03, 0.01, 0.01], { at: ["-$w / 2 + 0.1 + $i * 0.05", "$height - 1.0", 0.042], material: f.accent, repeat: { count: 3, step: [0, 0, 0] } }),
      ], { at: [0, 0.97, "-$d / 2 + 0.1"], rotate: [-8, 0, 0] }),
    ], { material: f.body, vars: { w: "$width", d: "$depth", sl: "sqrt(0.16 * 0.16 + ($d - 0.28) * ($d - 0.28))" } }),
  ];
}

function ticket(f: Finish): SpecNode[] {
  return [
    group("TicketMachine", [
      box("Plinth", ["$width + 0.04", 0.08, "$depth + 0.04"], { anchor: "bottom", bevel: 0.01, material: "paint_anthracite" }),
      box("Body", ["$width", "$height - 0.2", "$depth"], { at: [0, 0.078, 0], anchor: "bottom", bevel: 0.02 }),
      box("Canopy", ["$width + 0.06", 0.13, "$depth + 0.12"], { at: [0, "$height - 0.13", 0.03], anchor: "bottom", bevel: 0.02, material: f.trim }),
      box("HeaderLight", ["$width - 0.04", 0.07, 0.01], { at: [0, "$height - 0.065", "$depth / 2 + 0.09"], material: f.accent }),
      box("Bezel", ["$width * 0.68", "$width * 0.5", 0.02], { at: [0, "$height * 0.72", "$depth / 2"], bevel: 0.008, material: "plastic_black" }),
      box("Screen", ["$width * 0.6", "$width * 0.42", 0.006], { at: [0, "$height * 0.72", "$depth / 2 + 0.01"], material: f.screen }),
      group("Panel", [
        box("Shelf", ["$width - 0.08", 0.03, 0.14], { bevel: 0.008, material: f.trim }),
        keys("Key", 4, 3, 0.05, 0.04, [0.04, 0.014, 0.032], [-0.06, 0.014, -0.04], "brushed_steel"),
        box("CardReader", [0.11, 0.05, 0.08], { at: ["$width / 2 - 0.13", 0.035, -0.01], bevel: 0.008, material: "plastic_black" }),
        box("CardLed", [0.05, 0.006, 0.006], { at: ["$width / 2 - 0.13", 0.05, 0.032], material: "led_green" }),
      ], { at: [0, "$height * 0.48", "$depth / 2 + 0.05"], rotate: [12, 0, 0] }),
      box("CoinSlot", [0.06, 0.1, 0.03], { at: ["-$width / 2 + 0.12", "$height * 0.4", "$depth / 2 + 0.01"], bevel: 0.006, material: f.trim }),
      box("NoteSlot", [0.14, 0.04, 0.03], { at: ["$width / 2 - 0.14", "$height * 0.4", "$depth / 2 + 0.01"], bevel: 0.006, material: f.trim }),
      box("TicketTray", ["$width * 0.5", 0.14, 0.06], { at: [0, 0.48, "$depth / 2 + 0.01"], bevel: 0.012, material: "plastic_black" }),
      box("TrayFlap", ["$width * 0.46", 0.1, 0.01], { at: [0, 0.48, "$depth / 2 + 0.042"], bevel: 0.004, material: "glass_smoke" }),
      box("ServiceDoorSeam", [0.006, "$height * 0.5", 0.006], { at: ["$width / 2 - 0.03", 0.15, "$depth / 2"], anchor: "bottom", material: "plastic_black", mirror: "ServiceDoorSeam_R" }),
    ], { material: f.body }),
  ];
}

function atm(f: Finish): SpecNode[] {
  return [
    group("Atm", [
      box("Plinth", ["$width + 0.02", 0.1, "$depth + 0.02"], { anchor: "bottom", bevel: 0.01, material: "paint_anthracite" }),
      box("Body", ["$width", "$height - 0.1", "$depth"], { at: [0, 0.098, 0], anchor: "bottom", bevel: 0.025 }),
      box("BrandBand", ["$width + 0.004", 0.12, "$depth + 0.004"], { at: [0, "$height - 0.12", 0], anchor: "bottom", bevel: 0.02, material: f.accent }),
      group("Fascia", [
        box("HoodTop", ["$width - 0.04", 0.04, 0.2], { at: [0, "$height - 0.2", "$depth / 2 + 0.09"], bevel: 0.01 }),
        box("HoodSide_L", [0.04, 0.42, 0.2], { at: ["$width / 2 - 0.04", "$height - 0.4", "$depth / 2 + 0.09"], bevel: 0.01, mirror: "HoodSide_R" }),
      ], { material: f.trim }),
      box("Bezel", ["$width - 0.14", 0.34, 0.02], { at: [0, "$height - 0.43", "$depth / 2 + 0.005"], rotate: [-10, 0, 0], bevel: 0.006, material: "plastic_black" }),
      box("Screen", ["$width - 0.22", 0.28, 0.006], { at: [0, "$height - 0.43", "$depth / 2 + 0.017"], rotate: [-10, 0, 0], material: f.screen }),
      group("Panel", [
        box("Shelf", ["$width - 0.06", 0.04, 0.22], { bevel: 0.01, material: f.trim }),
        keys("Key", 3, 4, 0.045, 0.038, [0.036, 0.014, 0.03], [0, 0.02, -0.06], "brushed_steel"),
        box("CancelKey", [0.04, 0.014, 0.03], { at: [0.11, 0.025, -0.06], bevel: 0.005, material: "led_red", mirror: "ConfirmKey" }),
        box("PrivacyShield", ["$width - 0.08", 0.06, 0.012], { at: [0, 0.045, -0.105], bevel: 0.004, material: "plastic_black" }),
      ], { at: [0, "$height - 0.72", "$depth / 2 + 0.1"], rotate: [15, 0, 0] }),
      box("CardSlot", [0.12, 0.04, 0.04], { at: ["$width / 2 - 0.12", "$height - 0.62", "$depth / 2 + 0.01"], bevel: 0.008, material: "plastic_black" }),
      box("CardLed", [0.08, 0.006, 0.006], { at: ["$width / 2 - 0.12", "$height - 0.605", "$depth / 2 + 0.03"], material: "led_green" }),
      box("CashSlot", ["$width * 0.45", 0.05, 0.05], { at: [0, "$height - 0.88", "$depth / 2 + 0.01"], bevel: 0.01, material: "plastic_black" }),
      box("ReceiptSlot", [0.1, 0.02, 0.03], { at: ["-$width / 2 + 0.12", "$height - 0.62", "$depth / 2 + 0.008"], bevel: 0.005, material: "plastic_black" }),
      box("Camera", [0.05, 0.03, 0.03], { at: [0, "$height - 0.205", "$depth / 2 + 0.17"], bevel: 0.008, material: "plastic_black" }),
    ], { material: f.body }),
  ];
}

function arcade(f: Finish): SpecNode[] {
  const profile: [Num, Num][] = [
    ["$d / 2 - 0.12", 0], ["$d / 2 - 0.12", 0.85], ["$d / 2", 0.9], ["$d / 2", 0.98], ["$d / 2 - 0.25", 1.04],
    ["$d / 2 - 0.4", 1.5], ["$d / 2 - 0.3", "$height - 0.26"], ["$d / 2 - 0.24", "$height"], ["-$d / 2", "$height"], ["-$d / 2", 0],
  ];
  return [
    group("ArcadeCabinet", [
      side("Body", profile, "-$width / 2 + 0.02", "$width / 2 - 0.02"),
      side("Side_L", profile, "$width / 2 - 0.021", "$width / 2", { material: f.trim === "chrome" ? "paint_black" : "plastic_black", mirror: "Side_R" }),
      box("TMold_L", [0.006, "$height", 0.03], { at: ["$width / 2 + 0.002", 0, "-$d / 2 + 0.014"], anchor: "bottom", material: f.trim, mirror: "TMold_R" }),
      box("Marquee", ["$width - 0.05", 0.2, 0.02], { at: [0, "$height - 0.13", "$d / 2 - 0.27 + 0.012"], rotate: [-12, 0, 0], material: f.accent }),
      box("Speaker", ["$width - 0.08", 0.1, 0.015], { at: [0, "($height + 1.24) / 2", "$d / 2 - 0.35 + 0.012"], rotate: [-10, 0, 0], bevel: 0.004, material: "plastic_black" }),
      box("Bezel", ["$width - 0.06", 0.46, 0.012], { at: [0, 1.272, "$d / 2 - 0.325 + 0.006"], rotate: [-18.4, 0, 0], bevel: 0.004, material: "plastic_black" }),
      box("Screen", ["$width - 0.16", 0.36, 0.006], { at: [0, 1.274, "$d / 2 - 0.325 + 0.013"], rotate: [-18.4, 0, 0], material: f.screen }),
      group("Panel", [
        box("Deck", ["$width - 0.04", 0.014, 0.26], { bevel: 0.004, material: "plastic_black" }),
        group("Stick_L", [
          cyl("Shaft", 0.006, 0.07, { anchor: "base", segments: 8, material: "chrome" }),
          ellipsoid("Ball", [0.018, 0.018, 0.018], { at: [0, 0.075, 0], segments: 12, material: "led_red" }),
          cyl("Dust", 0.022, 0.006, { anchor: "base", segments: 12, material: "plastic_black" }),
        ], { at: ["$width / 4 + 0.06", 0.006, 0], mirror: "Stick_R" }),
        cyl("Button_{i}L", 0.014, 0.014, { at: ["$width / 4 - 0.02 - $i * 0.04", 0.008, "-0.03 + ($i - 1) * ($i - 1) * 0.012"], anchor: "base", segments: 12, material: f.accent, repeat: { count: 3, step: [0, 0, 0] }, mirror: "Button_{i}R" }),
        cyl("Start_{i}", 0.01, 0.01, { at: ["-0.03 + $i * 0.06", 0.008, -0.1], anchor: "base", segments: 10, material: "plastic_white", repeat: { count: 2, step: [0, 0, 0] } }),
      ], { at: [0, 1.01, "$d / 2 - 0.125"], rotate: [11.3, 0, 0] }),
      box("CoinDoor", [0.3, 0.32, 0.02], { at: [0, 0.6, "$d / 2 - 0.12"], bevel: 0.006, material: f.trim }),
      box("CoinSlot_L", [0.03, 0.06, 0.012], { at: [0.06, 0.66, "$d / 2 - 0.105"], bevel: 0.003, material: "led_red", mirror: "CoinSlot_R" }),
      box("KickPlate", ["$width - 0.04", 0.12, 0.012], { at: [0, 0, "$d / 2 - 0.12"], anchor: "bottom", bevel: 0.003, material: f.trim }),
    ], { material: f.body, vars: { d: "$depth" } }),
  ];
}

function kiosk(f: Finish): SpecNode[] {
  return [
    group("Kiosk", [
      box("BasePlate", ["$width + 0.14", 0.03, "$depth + 0.2"], { anchor: "bottom", bevel: 0.01, material: f.trim }),
      box("Body", ["$width", "$height - 0.05", "$depth"], { at: [0, 0.028, 0], anchor: "bottom", bevel: 0.05 }),
      box("TopCap", ["$width + 0.02", 0.05, "$depth + 0.02"], { at: [0, "$height - 0.05", 0], anchor: "bottom", bevel: 0.02, material: f.trim }),
      box("LogoLight", ["$width * 0.5", 0.05, 0.008], { at: [0, "$height - 0.13", "$depth / 2 + 0.002"], material: f.accent }),
      box("Bezel", ["$width - 0.06", "$sh + 0.06", 0.012], { at: [0, "$height - 0.22 - $sh / 2", "$depth / 2 + 0.002"], bevel: 0.006, material: "plastic_black" }),
      box("Screen", ["$width - 0.1", "$sh", 0.006], { at: [0, "$height - 0.22 - $sh / 2", "$depth / 2 + 0.009"], material: f.screen }),
      box("CameraDot", [0.02, 0.02, 0.006], { at: [0, "$height - 0.17", "$depth / 2 + 0.006"], bevel: 0.004, material: "plastic_black" }),
      group("Panel", [
        box("Ledge", ["$width - 0.1", 0.03, 0.1], { bevel: 0.008, material: f.trim }),
        box("NfcPad", [0.12, 0.006, 0.07], { at: ["$width / 4 - 0.02", 0.016, 0], bevel: 0.003, material: f.accent, mirror: "PrinterSlot" }),
      ], { at: [0, "$height - 0.32 - $sh", "$depth / 2 + 0.04"], rotate: [20, 0, 0] }),
      box("Grille_{i}", ["$width - 0.16", 0.006, 0.006], { at: [0, "0.3 + $i * 0.02", "$depth / 2 + 0.001"], material: "plastic_black", repeat: { count: 6, step: [0, 0, 0] } }),
    ], { material: f.body, vars: { sh: "min(($width - 0.1) * 1.7, $height - 0.75)" } }),
  ];
}

function holo(f: Finish): SpecNode[] {
  return [
    group("HoloPedestal", [
      lathe("Body", [[0.02, 0], ["$r", 0], ["$r", 0.06], ["$r * 0.75", 0.12], ["$r * 0.45", 0.3], ["$r * 0.4", "$height * 0.62"], ["$r * 0.62", "$height * 0.7"], ["$r * 0.62", "$height * 0.74"], [0.02, "$height * 0.74"]], { segments: 24 }),
      cyl("GlowRing_Low", "$r * 0.78", 0.012, { at: [0, 0.12, 0], segments: 24, material: f.accent }),
      cyl("GlowRing_High", "$r * 0.63", 0.012, { at: [0, "$height * 0.72", 0], segments: 24, material: f.accent }),
      cyl("FloorRing", "$r + 0.01", 0.012, { anchor: "base", segments: 24, material: f.trim }),
      group("Panel", [
        cyl("Disc", "$r * 0.4", 0.016, { segments: 20, material: f.trim }),
        cyl("Pad_{i}", 0.022, 0.008, { at: ["($i - 1) * 0.06", 0.01, 0.02], segments: 12, material: f.accent, repeat: { count: 3, step: [0, 0, 0] } }),
      ], { at: [0, "$height * 0.74 + 0.006", "$r * 0.15"], rotate: [8, 0, 0] }),
      tube("Arm", [[0, "$height * 0.73", "-$r * 0.45"], [0, "$height * 0.95", "-$r * 0.5"], [0, "$height + 0.05", "-$r * 0.35"]], 0.025, { segments: 12, material: f.trim }),
      group("Display", [
        box("Frame", ["$sw + 0.04", "$sw * 0.6 + 0.04", 0.03], { bevel: 0.01, material: f.trim }),
        box("Screen", ["$sw", "$sw * 0.6", 0.006], { at: [0, 0, 0.016], material: f.screen }),
      ], { at: [0, "$height + 0.12", "-$r * 0.28"], rotate: [-25, 0, 0] }),
    ], { material: f.body, vars: { r: "$radius", sw: "$radius * 2.2" } }),
  ];
}

function podium(f: Finish): SpecNode[] {
  const head: [Num, Num][] = [["$d / 2", "$height - 0.32"], ["$d / 2", "$height - 0.24"], ["-$d / 2", "$height"], ["-$d / 2", "$height - 0.32"]];
  return [
    group("ControlPodium", [
      box("FootPlate", ["$width * 0.7", 0.02, "$d * 0.9"], { anchor: "bottom", bevel: 0.006, material: f.trim }),
      cyl("Bolt_{i}", 0.012, 0.016, { at: ["$width * 0.3 * (1 - 2 * floor($i / 2))", 0.018, "$d * 0.38 * (1 - 2 * ($i - 2 * floor($i / 2)))"], segments: 6, material: f.trim, repeat: { count: 4, step: [0, 0, 0] } }),
      box("Post", [0.12, "$height - 0.32", 0.12], { at: [0, 0.018, 0], anchor: "bottom", bevel: 0.01, material: f.body }),
      side("Body", head, "-$width / 2", "$width / 2", { material: f.body }),
      box("Lid", ["$width + 0.02", 0.02, 0.06], { at: [0, "$height - 0.005", "-$d / 2 + 0.02"], bevel: 0.006, material: f.trim }),
      group("Face", [
        box("Bezel", ["$width * 0.55", 0.012, "$fl * 0.45"], { at: ["-$width * 0.2", 0.004, "-$fl * 0.2"], bevel: 0.004, material: "plastic_black" }),
        box("Screen", ["$width * 0.5", 0.006, "$fl * 0.4"], { at: ["-$width * 0.2", 0.011, "-$fl * 0.2"], material: f.screen }),
        group("Panel", [
          keys("Button", 3, 2, 0.05, 0.05, [0.03, 0.016, 0.03], [0, 0, 0], "brushed_steel"),
        ], { at: ["-$width * 0.2", 0, "$fl * 0.22"] }),
        group("EStop", [
          cyl("Collar", 0.035, 0.02, { anchor: "base", segments: 16, material: "paint_yellow" }),
          lathe("Mushroom", [[0.012, 0.015], [0.03, 0.02], [0.032, 0.035], [0.02, 0.045], [0.006, 0.047]], { segments: 16, material: "plastic_red" }),
        ], { at: ["$width / 2 - 0.1", 0, "$fl * 0.12"] }),
        cyl("KeySwitch", 0.018, 0.02, { at: ["$width / 2 - 0.1", 0, "-$fl * 0.2"], anchor: "base", segments: 12, material: "chrome" }),
        box("StatusLed_{i}", [0.02, 0.01, 0.02], { at: ["$width / 2 - 0.16 + $i * 0.04", 0.002, "-$fl * 0.38"], material: f.accent, repeat: { count: 3, step: [0, 0, 0] } }),
      ], { at: [0, "$height - 0.12", 0], rotate: ["deg(atan(0.24 / $d))", 0, 0] }),
      tube("Conduit", [[0.03, "$height - 0.33", "-0.08"], [0.03, 0.15, -0.08], [0.03, 0.03, -0.16], [0.03, 0.03, "-0.18 - $d * 0.2"]], 0.015, { segments: 10, material: "plastic_black" }),
    ], { vars: { d: "$depth", fl: "sqrt($d * $d + 0.24 * 0.24)" } }),
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
  console: {
    name: "sci-fi console",
    text: "A sci-fi control console: a desk body with a sloped panel of switches, a trackball and a pad, side cheeks, a glow strip, vents and a raked screen hood at the back",
    build: console_,
    params: () => [num("width", 1.1, 0.8, 1.6, "Width of the console along x, in metres."), num("height", 1.55, 1.3, 1.8, "Height to the top of the screen hood."), num("depth", 0.75, 0.6, 0.9, "Depth of the desk along z.")],
    tags: ["sci-fi", "scifi", "control console", "bridge", "bedieningsconsole", "ruimteschip"],
  },
  ticket: {
    name: "ticket machine",
    text: "A station ticket machine: a cabinet on a plinth with a lit header canopy, a screen, a tilted keypad shelf with a card reader, coin and note slots and a ticket tray",
    build: ticket,
    params: () => [num("width", 0.75, 0.6, 0.9, "Width of the cabinet along x, in metres."), num("height", 1.8, 1.6, 2.0, "Overall height."), num("depth", 0.45, 0.4, 0.6, "Depth of the cabinet along z.")],
    tags: ["ticket machine", "kaartautomaat", "vending", "station", "ov", "parking"],
  },
  atm: {
    name: "ATM",
    text: "A free-standing cash machine (ATM) with a hooded raked screen, a keypad shelf with privacy shield, card, cash and receipt slots, a camera and a lit brand band",
    build: atm,
    params: () => [num("width", 0.72, 0.6, 0.9, "Width of the cabinet along x, in metres."), num("height", 1.65, 1.5, 1.8, "Overall height."), num("depth", 0.7, 0.6, 0.9, "Depth of the cabinet along z.")],
    tags: ["atm", "cash machine", "geldautomaat", "pinautomaat", "bank"],
  },
  arcade: {
    name: "arcade cabinet",
    text: "An upright arcade cabinet with shaped side panels, a lit marquee, a raked screen behind a bezel, a two-player control panel with sticks and buttons, a coin door and a kick plate",
    build: arcade,
    params: () => [num("width", 0.68, 0.6, 0.8, "Width of the cabinet along x, in metres."), num("height", 1.8, 1.7, 1.95, "Overall height."), num("depth", 0.82, 0.75, 0.9, "Depth of the cabinet along z.")],
    tags: ["arcade", "arcade cabinet", "speelhal", "gokkast", "retro", "game"],
  },
  kiosk: {
    name: "information kiosk",
    text: "A slim information totem on a base plate with a large portrait touch screen, a lit logo, a tilted ledge with a card pad and a speaker grille",
    build: kiosk,
    params: () => [num("width", 0.62, 0.5, 0.8, "Width of the totem along x, in metres."), num("height", 2.0, 1.8, 2.2, "Overall height."), num("depth", 0.3, 0.25, 0.4, "Depth of the totem along z.")],
    tags: ["kiosk", "info kiosk", "informatiezuil", "totem", "touch screen", "wayfinding"],
  },
  holo: {
    name: "holo pedestal",
    text: "A round sci-fi pedestal with glowing rings, a control disc on top and a tilted screen held on a curved arm",
    build: holo,
    params: () => [num("radius", 0.32, 0.25, 0.4, "Radius of the pedestal foot, in metres."), num("height", 1.15, 1.0, 1.4, "Height of the pedestal top; the screen sits above it.")],
    tags: ["sci-fi", "pedestal", "hologram", "zuil", "futuristic"],
  },
  podium: {
    name: "control podium",
    text: "An industrial control podium: a sloped housing on a steel post, with a screen, push buttons, an emergency stop, a key switch, status lights and a cable conduit to the bolted foot plate",
    build: podium,
    params: () => [num("width", 0.6, 0.5, 0.8, "Width of the housing along x, in metres."), num("height", 1.2, 1.05, 1.35, "Height of the top of the housing."), num("depth", 0.42, 0.35, 0.5, "Depth of the housing along z.")],
    tags: ["control panel", "bedieningspaneel", "industrial", "machine", "noodstop", "factory"],
  },
};

const LOCAL: Record<string, MaterialDef> = {
  glass_smoke: { color: [0.2, 0.22, 0.24, 0.35], metallic: 0, roughness: 0.1, alpha: "BLEND" },
};

function terminal(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const names = [...new Set([f.body, f.trim, f.screen, f.accent, "plastic_black", "brushed_steel", "chrome", "led_red", "led_green", "plastic_white", "paint_anthracite", "paint_yellow", "plastic_red", "paint_black"])];
  return {
    slug: slugify("terminal", f.key, s.name),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${s.name}`,
    description: `${s.text}, in ${label(f.body)} with a ${label(f.screen).replace("screen ", "")} screen. It faces +z.`,
    tags: [style, f.key, label(f.body), ...s.tags],
    params: s.params(),
    materials: { ...mats(...names), ...(style === "ticket" ? LOCAL : {}) },
    nodes: s.build(f),
  };
}

const ORDER: Style[] = ["console", "ticket", "atm", "arcade", "kiosk", "holo", "podium"];

export const terminalFamily: Family = {
  id: "terminal",
  category: "props",
  archetype: "prop.terminal",
  tags: ["terminal", "console", "kiosk", "screen", "scherm", "computer", "automaat", "prop"],
  assets: () => ORDER.flatMap((style) => FINISHES[style].map((f) => terminal(style, f))),
};
