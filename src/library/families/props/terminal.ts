import { box, cyl, ellipsoid, extrude, group, lathe, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode, type Vec } from "../../kit.js";
import { finish } from "./finishes.js";

/**
 * Terminals: sci-fi desk consoles, ticket machines, ATMs, arcade cabinets, information totems, holo pedestals and
 * industrial control podiums. Every one has a Body, an emissive Screen (its own node, so a script can swap its
 * material) and most a Panel of keys or controls. They stand on y = 0 and face +z.
 */
type Style = "console" | "ticket" | "atm" | "arcade" | "kiosk" | "holo" | "podium";

interface Finish {
  key: string;
  /** Words for the description, e.g. "anthracite powder coat". */
  text: string;
  body: string;
  trim: string;
  /** Dark screen glass and the colour of its glowing content. */
  screen: string;
  ui: string;
  /** A backlit sign (header, marquee, logo, brand band). */
  sign: string;
  /** Small indicator lights. */
  accent: string;
}

const FINISHES: Record<Style, [Finish, Finish]> = {
  console: [
    { key: "anthracite", text: "anthracite powder coat with satin aluminium cheeks", body: "powder_anthracite", trim: "satin_alu", screen: "screen_glass_cyan", ui: "ui_cyan", sign: "sign_cyan", accent: "led_on_blue" },
    { key: "white", text: "white powder coat with grey cheeks", body: "powder_white", trim: "abs_grey", screen: "screen_glass_blue", ui: "ui_blue", sign: "sign_blue", accent: "led_on_green" },
  ],
  ticket: [
    { key: "red", text: "signal-red powder coat with a brushed stainless canopy", body: "powder_red", trim: "stainless", screen: "screen_glass_blue", ui: "ui_blue", sign: "sign_white", accent: "led_on_green" },
    { key: "steel", text: "brushed stainless steel with an anthracite canopy", body: "stainless", trim: "powder_anthracite", screen: "screen_glass_green", ui: "ui_green", sign: "sign_amber", accent: "led_on_amber" },
  ],
  atm: [
    { key: "steel", text: "brushed stainless steel with a lit green brand band", body: "stainless", trim: "abs_black", screen: "screen_glass_blue", ui: "ui_blue", sign: "sign_green", accent: "led_on_green" },
    { key: "navy", text: "navy powder coat with a satin aluminium hood", body: "powder_navy", trim: "satin_alu", screen: "screen_glass_cyan", ui: "ui_cyan", sign: "sign_white", accent: "led_on_blue" },
  ],
  arcade: [
    { key: "black", text: "black paint with chrome T-moulding and an amber marquee", body: "powder_black", trim: "bright_chrome", screen: "screen_glass_cyan", ui: "ui_cyan", sign: "sign_amber", accent: "abs_red" },
    { key: "purple", text: "purple paint with black T-moulding and a magenta marquee", body: "powder_purple", trim: "abs_black", screen: "screen_glass_amber", ui: "ui_amber", sign: "sign_magenta", accent: "abs_yellow" },
  ],
  kiosk: [
    { key: "white", text: "white powder coat with satin aluminium caps", body: "powder_white", trim: "satin_alu", screen: "screen_glass_cyan", ui: "ui_cyan", sign: "sign_blue", accent: "led_on_blue" },
    { key: "black", text: "black powder coat with brushed stainless caps", body: "powder_black", trim: "stainless", screen: "screen_glass_amber", ui: "ui_amber", sign: "sign_amber", accent: "led_on_amber" },
  ],
  holo: [
    { key: "gunmetal", text: "satin gunmetal with chrome trim", body: "gunmetal_satin", trim: "bright_chrome", screen: "screen_glass_cyan", ui: "ui_cyan", sign: "sign_cyan", accent: "led_on_blue" },
    { key: "white", text: "white moulded plastic with satin aluminium trim", body: "abs_white", trim: "satin_alu", screen: "screen_glass_green", ui: "ui_green", sign: "sign_green", accent: "led_on_green" },
  ],
  podium: [
    { key: "grey", text: "light grey powder coat on a galvanised post", body: "powder_lightgrey", trim: "galvanised_steel", screen: "screen_glass_green", ui: "ui_green", sign: "sign_green", accent: "led_on_green" },
    { key: "yellow", text: "traffic-yellow powder coat with black trim", body: "powder_yellow", trim: "powder_black", screen: "screen_glass_amber", ui: "ui_amber", sign: "sign_amber", accent: "led_on_red" },
  ],
};

type Layout = "list" | "chart" | "game" | "tiles";

/**
 * Glowing screen content (header, text lines, bars, tiles) for a screen W x H whose front face is at local z = 0.003,
 * as a sibling of the Screen node with the same placement. The content sits 1-2 mm proud of the glass.
 */
function screenUi(W: Num, H: Num, layout: Layout, ui: string, o: { at?: Vec; rotate?: Vec } = {}): SpecNode {
  const w = `(${W})`, h = `(${H})`, z = 0.0035, t = 0.002;
  const lineW = (k: string): string => `${w} * (0.22 + 0.2 * abs(sin(${k} * 1.9 + 0.5)))`;
  const items: SpecNode[] = [box("UiHeader", [`${w} * 0.92`, `${h} * 0.08`, t], { at: [0, `${h} * 0.41`, z] })];
  if (layout === "list") {
    items.push(
      box("UiLine_{i}", [lineW("$i"), `${h} * 0.04`, t], { at: [`-${w} * 0.44 + ${lineW("$i")} / 2`, `${h} * (0.25 - $i * 0.11)`, z], material: "ui_white", repeat: { count: 6, step: [0, 0, 0] } }),
      box("UiTile_{i}", [`${w} * 0.28`, `${h} * 0.15`, t], { at: [`${w} * 0.29`, `${h} * (0.22 - $i * 0.21)`, z], repeat: { count: 3, step: [0, 0, 0] } }),
    );
  } else if (layout === "chart") {
    const bh = `${h} * (0.12 + 0.36 * abs(sin($i * 1.3 + 0.8)))`;
    items.push(
      box("UiBar_{i}", [`${w} * 0.07`, bh, t], { at: [`-${w} * 0.38 + $i * ${w} * 0.11`, `-${h} * 0.38 + ${bh} / 2`, z], repeat: { count: 6, step: [0, 0, 0] } }),
      box("UiAxis", [`${w} * 0.7`, `${h} * 0.012`, t], { at: [`-${w} * 0.1`, `-${h} * 0.385`, z], material: "ui_white" }),
      box("UiLine_{i}", [`${w} * 0.18`, `${h} * 0.035`, t], { at: [`${w} * 0.34`, `${h} * (0.26 - $i * 0.09)`, z], material: "ui_white", repeat: { count: 4, step: [0, 0, 0] } }),
      box("UiGauge", [`${w} * 0.18`, `${h} * 0.22`, t], { at: [`${w} * 0.34`, `-${h} * 0.22`, z] }),
    );
  } else if (layout === "game") {
    items.push(
      group("UiRow_{i}", [
        box("UiSprite_{i}", [`${w} * 0.07`, `${h} * 0.05`, t], { at: [`-${w} * 0.33 + $i * ${w} * 0.11`, 0, 0], repeat: { count: 7, step: [0, 0, 0] } }),
      ], { at: [0, `${h} * (0.26 - $i * 0.1)`, z], repeat: { count: 3, step: [0, 0, 0] } }),
      box("UiBunker_{i}", [`${w} * 0.12`, `${h} * 0.05`, t], { at: [`-${w} * 0.3 + $i * ${w} * 0.3`, `-${h} * 0.25`, z], material: "ui_green", repeat: { count: 3, step: [0, 0, 0] } }),
      box("UiPlayer", [`${w} * 0.08`, `${h} * 0.05`, t], { at: [`${w} * 0.05`, `-${h} * 0.4`, z], material: "ui_white" }),
    );
  } else {
    items.push(
      box("UiTile_{i}", [`${w} * 0.42`, `${h} * 0.17`, t], { at: [`${w} * (-0.23 + 0.46 * ($i - 2 * floor($i / 2)))`, `${h} * (0.25 - floor($i / 2) * 0.21)`, z], repeat: { count: 6, step: [0, 0, 0] } }),
      box("UiLine_{i}", [lineW("$i"), `${h} * 0.025`, t], { at: [`-${w} * 0.44 + ${lineW("$i")} / 2`, `-${h} * (0.36 + $i * 0.045)`, z], material: "ui_white", repeat: { count: 2, step: [0, 0, 0] } }),
    );
  }
  return group("Ui", items, { ...o, material: ui });
}

/** The dark outline of a service door W x H (centre at `at`) on a +z face: four 4 mm panel gaps. */
const doorGaps = (name: string, W: Num, H: Num, at: Vec): SpecNode =>
  group(name, [
    box("Gap_T", [W, 0.004, 0.004], { at: [0, `(${H}) / 2`, 0] }),
    box("Gap_B", [W, 0.004, 0.004], { at: [0, `-(${H}) / 2`, 0] }),
    box("Gap_L", [0.004, H, 0.004], { at: [`(${W}) / 2`, 0, 0], mirror: "Gap_R" }),
    cyl("Lock", 0.011, 0.01, { axis: "z", at: [`(${W}) / 2 - 0.05`, `(${H}) * 0.3`, 0.002], segments: 12, material: "bright_chrome" }),
  ], { at, material: "gap_dark" });

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
      box("Kick", ["$w - 0.06", 0.08, 0.02], { at: [0, 0, "$d / 2 - 0.004"], anchor: "bottom", bevel: 0.004, material: "rubber_black" }),
      box("VentFrame", ["$w - 0.16", 0.4, 0.008], { at: [0, 0.32, "$d / 2 + 0.002"], bevel: 0.003, material: f.trim }),
      box("Vent_{i}", [0.016, 0.34, 0.006], { at: ["-($w - 0.24) / 2 + $i * ($w - 0.24) / 13", 0.32, "$d / 2 + 0.005"], material: "gap_dark", repeat: { count: 14, step: [0, 0, 0] } }),
      doorGaps("ServiceGaps", "$w - 0.1", 0.62, [0, 0.39, "$d / 2 + 0.001"]),
      box("GlowStrip", ["$w - 0.08", 0.014, 0.012], { at: [0, 0.79, "$d / 2 - 0.003"], material: f.sign }),
      group("Panel", [
        box("Plate", ["$w - 0.12", 0.02, "$sl * 0.86"], { bevel: 0.006, material: "abs_black" }),
        box("PlateTrim", ["$w - 0.1", 0.012, "$sl * 0.88"], { at: [0, -0.008, 0], bevel: 0.004, material: f.trim }),
        keys("Switch", "max(floor(($w - 0.5) / 0.045), 4)", 3, 0.045, 0.05, [0.034, 0.014, 0.036], [0.12, 0.009, -0.03], "abs_grey"),
        box("SwitchLed_{i}", [0.012, 0.004, 0.006], { at: ["0.12 - (max(floor(($w - 0.5) / 0.045), 4) - 1) * 0.0225 + $i * 0.045", 0.011, -0.075], material: f.accent, repeat: { count: "max(floor(($w - 0.5) / 0.045), 4)", step: [0, 0, 0] } }),
        ellipsoid("Trackball", [0.03, 0.03, 0.03], { at: ["-$w / 2 + 0.17", 0.012, 0.02], segments: 16, material: f.sign }),
        cyl("TrackRing", 0.038, 0.012, { at: ["-$w / 2 + 0.17", 0.012, 0.02], segments: 20, material: f.trim }),
        box("Pad", [0.14, 0.006, 0.1], { at: ["-$w / 2 + 0.17", 0.012, -0.08], bevel: 0.003, material: "abs_grey" }),
      ], { at: [0, 0.92, 0.08], rotate: ["deg(atan(0.16 / ($d - 0.28)))", 0, 0] }),
      group("ScreenHood", [
        box("Hood", ["$w - 0.08", "$height - 0.97", 0.08], { anchor: "bottom", bevel: 0.012, material: f.body }),
        box("Bezel", ["$w - 0.14", "$height - 1.06", 0.012], { at: [0, "($height - 0.97) / 2", 0.042], bevel: 0.004, material: "abs_black" }),
        box("Screen", ["$w - 0.2", "$height - 1.12", 0.006], { at: [0, "($height - 0.97) / 2", 0.049], material: f.screen }),
        screenUi("$w - 0.2", "$height - 1.12", "chart", f.ui, { at: [0, "($height - 0.97) / 2", 0.049] }),
        box("StatusLight_{i}", [0.03, 0.01, 0.01], { at: ["-$w / 2 + 0.1 + $i * 0.05", "$height - 1.0", 0.042], material: f.accent, repeat: { count: 3, step: [0, 0, 0] } }),
      ], { at: [0, 0.97, "-$d / 2 + 0.1"], rotate: [-8, 0, 0] }),
    ], { material: f.body, vars: { w: "$width", d: "$depth", sl: "sqrt(0.16 * 0.16 + ($d - 0.28) * ($d - 0.28))" } }),
  ];
}

function ticket(f: Finish): SpecNode[] {
  return [
    group("TicketMachine", [
      box("Plinth", ["$width + 0.04", 0.08, "$depth + 0.04"], { anchor: "bottom", bevel: 0.01, material: "powder_anthracite" }),
      box("Body", ["$width", "$height - 0.2", "$depth"], { at: [0, 0.078, 0], anchor: "bottom", bevel: 0.02 }),
      box("Canopy", ["$width + 0.06", 0.13, "$depth + 0.12"], { at: [0, "$height - 0.13", 0.03], anchor: "bottom", bevel: 0.02, material: f.trim }),
      box("HeaderLight", ["$width - 0.04", 0.07, 0.01], { at: [0, "$height - 0.065", "$depth / 2 + 0.09"], material: f.sign }),
      box("Downlight", ["$width - 0.2", 0.008, 0.04], { at: [0, "$height - 0.134", "$depth / 2 + 0.05"], material: "sign_white" }),
      box("Bezel", ["$width * 0.68", "$width * 0.5", 0.02], { at: [0, "$height * 0.72", "$depth / 2"], bevel: 0.008, material: "abs_black" }),
      box("Screen", ["$width * 0.6", "$width * 0.42", 0.006], { at: [0, "$height * 0.72", "$depth / 2 + 0.01"], material: f.screen }),
      screenUi("$width * 0.6", "$width * 0.42", "list", f.ui, { at: [0, "$height * 0.72", "$depth / 2 + 0.01"] }),
      group("Panel", [
        box("Shelf", ["$width - 0.08", 0.03, 0.14], { bevel: 0.008, material: f.trim }),
        keys("Key", 4, 3, 0.05, 0.04, [0.04, 0.014, 0.032], [-0.06, 0.014, -0.04], "stainless"),
        box("CardReader", [0.11, 0.05, 0.08], { at: ["$width / 2 - 0.13", 0.035, -0.01], bevel: 0.008, material: "abs_black" }),
        box("CardLed", [0.05, 0.006, 0.006], { at: ["$width / 2 - 0.13", 0.05, 0.032], material: f.accent }),
      ], { at: [0, "$height * 0.48", "$depth / 2 + 0.05"], rotate: [12, 0, 0] }),
      box("CoinSlot", [0.06, 0.1, 0.03], { at: ["-$width / 2 + 0.12", "$height * 0.4", "$depth / 2 + 0.01"], bevel: 0.006, material: f.trim }),
      box("CoinMouth", [0.008, 0.05, 0.004], { at: ["-$width / 2 + 0.12", "$height * 0.4", "$depth / 2 + 0.026"], material: "gap_dark" }),
      box("NoteSlot", [0.14, 0.04, 0.03], { at: ["$width / 2 - 0.14", "$height * 0.4", "$depth / 2 + 0.01"], bevel: 0.006, material: f.trim }),
      box("NoteMouth", [0.1, 0.006, 0.004], { at: ["$width / 2 - 0.14", "$height * 0.4", "$depth / 2 + 0.026"], material: "gap_dark" }),
      box("TicketTray", ["$width * 0.5", 0.14, 0.06], { at: [0, 0.48, "$depth / 2 + 0.01"], bevel: 0.012, material: "abs_black" }),
      box("TrayFlap", ["$width * 0.46", 0.1, 0.01], { at: [0, 0.48, "$depth / 2 + 0.042"], bevel: 0.004, material: "glass_tint" }),
      doorGaps("ServiceGaps", "$width - 0.06", "$height * 0.5 - 0.1", [0, "0.15 + $height * 0.25", "$depth / 2 + 0.001"]),
    ], { material: f.body }),
  ];
}

function atm(f: Finish): SpecNode[] {
  return [
    group("Atm", [
      box("Plinth", ["$width + 0.02", 0.1, "$depth + 0.02"], { anchor: "bottom", bevel: 0.01, material: "powder_anthracite" }),
      box("Body", ["$width", "$height - 0.1", "$depth"], { at: [0, 0.098, 0], anchor: "bottom", bevel: 0.025 }),
      box("BrandBand", ["$width + 0.004", 0.12, "$depth + 0.004"], { at: [0, "$height - 0.12", 0], anchor: "bottom", bevel: 0.02, material: f.sign }),
      box("BandEdge_{i}", ["$width + 0.008", 0.012, "$depth + 0.008"], { at: [0, "$height - 0.126 + $i * 0.12", 0], anchor: "bottom", bevel: 0.004, material: "abs_black", repeat: { count: 2, step: [0, 0, 0] } }),
      group("Fascia", [
        box("HoodTop", ["$width - 0.04", 0.04, 0.2], { at: [0, "$height - 0.2", "$depth / 2 + 0.09"], bevel: 0.01 }),
        box("HoodSide_L", [0.04, 0.42, 0.2], { at: ["$width / 2 - 0.04", "$height - 0.4", "$depth / 2 + 0.09"], bevel: 0.01, mirror: "HoodSide_R" }),
      ], { material: f.trim }),
      box("Bezel", ["$width - 0.14", 0.34, 0.02], { at: [0, "$height - 0.43", "$depth / 2 + 0.005"], rotate: [-10, 0, 0], bevel: 0.006, material: "abs_black" }),
      box("Screen", ["$width - 0.22", 0.28, 0.006], { at: [0, "$height - 0.43", "$depth / 2 + 0.017"], rotate: [-10, 0, 0], material: f.screen }),
      screenUi("$width - 0.22", 0.28, "tiles", f.ui, { at: [0, "$height - 0.43", "$depth / 2 + 0.017"], rotate: [-10, 0, 0] }),
      group("Panel", [
        box("Shelf", ["$width - 0.06", 0.04, 0.22], { bevel: 0.01, material: f.trim }),
        keys("Key", 3, 4, 0.045, 0.038, [0.036, 0.014, 0.03], [0, 0.02, -0.06], "stainless"),
        box("CancelKey", [0.04, 0.014, 0.03], { at: [0.11, 0.025, -0.06], bevel: 0.005, material: "abs_red", mirror: "ConfirmKey" }),
        box("PrivacyShield", ["$width - 0.08", 0.06, 0.012], { at: [0, 0.045, -0.105], bevel: 0.004, material: "abs_black" }),
      ], { at: [0, "$height - 0.72", "$depth / 2 + 0.1"], rotate: [15, 0, 0] }),
      box("CardSlot", [0.12, 0.04, 0.04], { at: ["$width / 2 - 0.12", "$height - 0.62", "$depth / 2 + 0.01"], bevel: 0.008, material: "abs_black" }),
      box("CardLed", [0.08, 0.006, 0.006], { at: ["$width / 2 - 0.12", "$height - 0.605", "$depth / 2 + 0.03"], material: f.accent }),
      doorGaps("SafeGaps", "$width - 0.08", "$height - 1.05", [0, "0.14 + ($height - 1.05) / 2", "$depth / 2 + 0.001"]),
      box("CashSlot", ["$width * 0.45", 0.05, 0.05], { at: [0, "$height - 0.88", "$depth / 2 + 0.01"], bevel: 0.01, material: "abs_black" }),
      box("ReceiptSlot", [0.1, 0.02, 0.03], { at: ["-$width / 2 + 0.12", "$height - 0.62", "$depth / 2 + 0.008"], bevel: 0.005, material: "abs_black" }),
      box("Camera", [0.05, 0.03, 0.03], { at: [0, "$height - 0.205", "$depth / 2 + 0.17"], bevel: 0.008, material: "abs_black" }),
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
      side("Side_L", profile, "$width / 2 - 0.021", "$width / 2", { material: f.key === "black" ? "wood_dark" : "abs_black", mirror: "Side_R" }),
      box("TMold_L", [0.006, "$height", 0.03], { at: ["$width / 2 + 0.002", 0, "-$d / 2 + 0.014"], anchor: "bottom", material: f.trim, mirror: "TMold_R" }),
      box("Marquee", ["$width - 0.05", 0.2, 0.02], { at: [0, "$height - 0.13", "$d / 2 - 0.27 + 0.012"], rotate: [-12, 0, 0], material: f.sign }),
      box("MarqueeArt_{i}", ["$width * 0.14", 0.06, 0.004], { at: ["-$width * 0.3 + $i * $width * 0.2", "$height - 0.13 + 0.03 * cos($i * 1.6)", "$d / 2 - 0.27 + 0.024"], rotate: [-12, 0, 0], material: "ui_white", repeat: { count: 4, step: [0, 0, 0] } }),
      box("Speaker", ["$width - 0.08", 0.1, 0.015], { at: [0, "($height + 1.24) / 2", "$d / 2 - 0.35 + 0.012"], rotate: [-10, 0, 0], bevel: 0.004, material: "abs_black" }),
      box("Bezel", ["$width - 0.06", 0.46, 0.012], { at: [0, 1.272, "$d / 2 - 0.325 + 0.006"], rotate: [-18.4, 0, 0], bevel: 0.004, material: "abs_black" }),
      box("Screen", ["$width - 0.16", 0.36, 0.006], { at: [0, 1.274, "$d / 2 - 0.325 + 0.013"], rotate: [-18.4, 0, 0], material: f.screen }),
      screenUi("$width - 0.16", 0.36, "game", f.ui, { at: [0, 1.274, "$d / 2 - 0.325 + 0.013"], rotate: [-18.4, 0, 0] }),
      group("Panel", [
        box("Deck", ["$width - 0.04", 0.014, 0.26], { bevel: 0.004, material: "abs_black" }),
        group("Stick_L", [
          cyl("Shaft", 0.006, 0.07, { anchor: "base", segments: 8, material: "bright_chrome" }),
          ellipsoid("Ball", [0.018, 0.018, 0.018], { at: [0, 0.075, 0], segments: 12, material: "abs_red" }),
          cyl("Dust", 0.022, 0.006, { anchor: "base", segments: 12, material: "abs_black" }),
        ], { at: ["$width / 4 + 0.06", 0.006, 0], mirror: "Stick_R" }),
        cyl("Button_{i}L", 0.014, 0.014, { at: ["$width / 4 - 0.02 - $i * 0.04", 0.008, "-0.03 + ($i - 1) * ($i - 1) * 0.012"], anchor: "base", segments: 12, material: f.accent, repeat: { count: 3, step: [0, 0, 0] }, mirror: "Button_{i}R" }),
        cyl("Start_{i}", 0.01, 0.01, { at: ["-0.03 + $i * 0.06", 0.008, -0.1], anchor: "base", segments: 10, material: "abs_white", repeat: { count: 2, step: [0, 0, 0] } }),
      ], { at: [0, 1.01, "$d / 2 - 0.125"], rotate: [11.3, 0, 0] }),
      box("CoinDoor", [0.3, 0.32, 0.02], { at: [0, 0.6, "$d / 2 - 0.12"], bevel: 0.006, material: f.trim }),
      box("CoinSlot_L", [0.03, 0.06, 0.012], { at: [0.06, 0.66, "$d / 2 - 0.105"], bevel: 0.003, material: "led_on_red", mirror: "CoinSlot_R" }),
      box("CoinDoorGap", [0.32, 0.34, 0.016], { at: [0, 0.6, "$d / 2 - 0.122"], material: "gap_dark" }),
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
      box("LogoLight", ["$width * 0.5", 0.05, 0.008], { at: [0, "$height - 0.13", "$depth / 2 + 0.002"], material: f.sign }),
      box("SideGap_L", [0.004, "$height - 0.12", 0.004], { at: ["$width / 2 - 0.035", 0.06, "$depth / 2 + 0.001"], anchor: "bottom", material: "gap_dark", mirror: "SideGap_R" }),
      box("SideStrip_L", [0.004, "$height - 0.35", 0.018], { at: ["$width / 2 + 0.001", 0.2, "$depth / 2 - 0.04"], anchor: "bottom", material: f.sign, mirror: "SideStrip_R" }),
      box("Bezel", ["$width - 0.06", "$sh + 0.06", 0.012], { at: [0, "$height - 0.22 - $sh / 2", "$depth / 2 + 0.002"], bevel: 0.006, material: "abs_black" }),
      box("Screen", ["$width - 0.1", "$sh", 0.006], { at: [0, "$height - 0.22 - $sh / 2", "$depth / 2 + 0.009"], material: f.screen }),
      screenUi("$width - 0.1", "$sh", "tiles", f.ui, { at: [0, "$height - 0.22 - $sh / 2", "$depth / 2 + 0.009"] }),
      box("CameraDot", [0.02, 0.02, 0.006], { at: [0, "$height - 0.17", "$depth / 2 + 0.006"], bevel: 0.004, material: "abs_black" }),
      group("Panel", [
        box("Ledge", ["$width - 0.1", 0.03, 0.1], { bevel: 0.008, material: f.trim }),
        box("NfcPad", [0.12, 0.006, 0.07], { at: ["$width / 4 - 0.02", 0.016, 0], bevel: 0.003, material: f.sign, mirror: "PrinterSlot" }),
      ], { at: [0, "$height - 0.32 - $sh", "$depth / 2 + 0.04"], rotate: [20, 0, 0] }),
      box("Grille_{i}", ["$width - 0.16", 0.006, 0.006], { at: [0, "0.3 + $i * 0.02", "$depth / 2 + 0.001"], material: "gap_dark", repeat: { count: 6, step: [0, 0, 0] } }),
    ], { material: f.body, vars: { sh: "min(($width - 0.1) * 1.7, $height - 0.75)" } }),
  ];
}

function holo(f: Finish): SpecNode[] {
  return [
    group("HoloPedestal", [
      lathe("Body", [[0.02, 0], ["$r", 0], ["$r", 0.06], ["$r * 0.75", 0.12], ["$r * 0.45", 0.3], ["$r * 0.4", "$height * 0.62"], ["$r * 0.62", "$height * 0.7"], ["$r * 0.62", "$height * 0.74"], [0.02, "$height * 0.74"]], { segments: 24 }),
      cyl("GlowRing_Low", "$r * 0.78", 0.012, { at: [0, 0.12, 0], segments: 24, material: f.sign }),
      cyl("GlowRing_High", "$r * 0.63", 0.012, { at: [0, "$height * 0.72", 0], segments: 24, material: f.sign }),
      cyl("BaseSkirt", "$r + 0.004", 0.03, { at: [0, 0.012, 0], anchor: "base", segments: 24, material: "rubber_black" }),
      box("Seam_{i}", [0.004, "$height * 0.3", 0.004], { at: ["$r * 0.41 * sin($i * 90 + 45)", "$height * 0.3", "$r * 0.41 * cos($i * 90 + 45)"], anchor: "bottom", material: "gap_dark", repeat: { count: 4, step: [0, 0, 0] } }),
      cyl("FloorRing", "$r + 0.01", 0.012, { anchor: "base", segments: 24, material: f.trim }),
      group("Panel", [
        cyl("Disc", "$r * 0.4", 0.016, { segments: 20, material: f.trim }),
        cyl("Pad_{i}", 0.022, 0.008, { at: ["($i - 1) * 0.06", 0.01, 0.02], segments: 12, material: f.ui, repeat: { count: 3, step: [0, 0, 0] } }),
      ], { at: [0, "$height * 0.74 + 0.006", "$r * 0.15"], rotate: [8, 0, 0] }),
      tube("Arm", [[0, "$height * 0.73", "-$r * 0.45"], [0, "$height * 0.95", "-$r * 0.5"], [0, "$height + 0.05", "-$r * 0.35"]], 0.025, { segments: 12, material: f.trim }),
      group("Display", [
        box("Frame", ["$sw + 0.04", "$sw * 0.6 + 0.04", 0.03], { bevel: 0.01, material: f.trim }),
        box("Screen", ["$sw", "$sw * 0.6", 0.006], { at: [0, 0, 0.016], material: f.screen }),
        screenUi("$sw", "$sw * 0.6", "chart", f.ui, { at: [0, 0, 0.016] }),
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
        box("Bezel", ["$width * 0.55", 0.012, "$fl * 0.45"], { at: ["-$width * 0.2", 0.004, "-$fl * 0.2"], bevel: 0.004, material: "abs_black" }),
        box("Screen", ["$width * 0.5", 0.006, "$fl * 0.4"], { at: ["-$width * 0.2", 0.011, "-$fl * 0.2"], material: f.screen }),
        screenUi("$width * 0.5", "$fl * 0.4", "list", f.ui, { at: ["-$width * 0.2", 0.011, "-$fl * 0.2"], rotate: [-90, 0, 0] }),
        group("Panel", [
          box("ButtonPlate", [0.17, 0.006, 0.12], { at: [0, 0.001, 0.025], bevel: 0.002, material: "abs_black" }),
          keys("Button", 3, 2, 0.05, 0.05, [0.03, 0.016, 0.03], [0, 0, 0], "stainless"),
        ], { at: ["-$width * 0.2", 0, "$fl * 0.22"] }),
        group("EStop", [
          cyl("Collar", 0.035, 0.02, { anchor: "base", segments: 16, material: "abs_yellow" }),
          lathe("Mushroom", [[0.012, 0.015], [0.03, 0.02], [0.032, 0.035], [0.02, 0.045], [0.006, 0.047]], { segments: 16, material: "abs_red" }),
        ], { at: ["$width / 2 - 0.1", 0, "$fl * 0.12"] }),
        cyl("KeySwitch", 0.018, 0.02, { at: ["$width / 2 - 0.1", 0, "-$fl * 0.2"], anchor: "base", segments: 12, material: "bright_chrome" }),
        box("StatusLed_{i}", [0.02, 0.01, 0.02], { at: ["$width / 2 - 0.16 + $i * 0.04", 0.002, "-$fl * 0.38"], material: f.accent, repeat: { count: 3, step: [0, 0, 0] } }),
      ], { at: [0, "$height - 0.12", 0], rotate: ["deg(atan(0.24 / $d))", 0, 0] }),
      tube("Conduit", [[0.03, "$height - 0.33", "-0.08"], [0.03, 0.15, -0.08], [0.03, 0.03, -0.16], [0.03, 0.03, "-0.18 - $d * 0.2"]], 0.015, { segments: 10, material: "abs_black" }),
      box("HousingGap", ["$width + 0.002", 0.004, "$d + 0.002"], { at: [0, "$height - 0.3", 0], material: "gap_dark" }),
      box("WarningLabel", [0.1, 0.07, 0.004], { at: [0, "$height - 0.62", 0.061], material: "abs_yellow" }),
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

function terminal(style: Style, f: Finish): AssetDraft {
  const s = STYLES[style];
  const shared = ["abs_black", "abs_grey", "abs_white", "abs_red", "abs_yellow", "stainless", "bright_chrome", "powder_anthracite", "powder_black", "rubber_black", "gap_dark", "glass_tint", "ui_white", "ui_green", "sign_white", "led_on_red", "wood_dark"];
  return {
    slug: slugify("terminal", f.key, s.name),
    title: `${f.key.charAt(0).toUpperCase()}${f.key.slice(1)} ${s.name}`,
    description: `${s.text}, in ${f.text}; the dark screen glass glows with ${f.ui.replace("ui_", "")} content. It faces +z.`,
    tags: [style, f.key, ...f.text.split(" with ")[0]!.split(" "), ...s.tags],
    params: s.params(),
    materials: finish(...new Set([f.body, f.trim, f.screen, f.ui, f.sign, f.accent, ...shared])),
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
