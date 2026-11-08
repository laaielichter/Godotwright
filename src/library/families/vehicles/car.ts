import { box, cyl, ellipsoid, group, lathe, loft, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { carPaint, f, L, ladd, lerpL, lev, ls, lscale, lsub, ringProfile, VMATS, wheel, WHEEL_MATS, type Lin, type WheelStyle } from "./parts.js";

/** A point of the side silhouette: z as a fraction of the half length, y as a fraction of the roof height. */
type Pt = [number, number, string?];

interface CarStyle {
  name: string;
  text: string;
  length: [number, number, number];
  width: [number, number, number];
  height: [number, number, number];
  wheel: [number, number, number];
  /** Axles as fractions of the half length (front, rear). */
  ff: number;
  fr: number;
  /** Angle of the sill under the hub (radians): small = high ground clearance. */
  a0: number;
  tyreW: number;
  /**
   * The body side silhouette (without the greenhouse) from the front bottom over the top to the rear bottom; the arches
   * and the sill are added. Its top line is the centre line of the bonnet, the belt and the boot.
   */
  upper: Pt[];
  belt: number;
  /** Greenhouse sections: [z fraction, 0 = belt .. 1 = roof]. */
  glass: [number, number][];
  /** Shelf between the body's top edge and the foot of the glass, metres. */
  shelf: number;
  roof: [number, number];
  doors: 2 | 4;
  /** Front door front edge, B pillar, rear door end as fractions of the half length (rear end only with 4 doors). */
  doorZ: [number, number, number?];
  trunk: "lid" | "gate" | "bed";
  lamps: "slim" | "round" | "square";
  tails: "corner" | "bar" | "round" | "tall";
  bumper: "body" | "chrome" | "black";
  seats: { front: number; rear?: number };
  rails?: boolean;
  /** How far the side glass leans in, per metre of greenhouse height. */
  tumble: number;
  spoiler?: boolean;
  /** Body form: plan width (nose, between the arches, tail; fractions of the half width, 1 = over the arches). */
  plan: [number, number, number];
  /** Tuck-under of the lower side (m), the radius of the shoulder edge (m), the depth of the shoulder crease (0..1). */
  tuck: number;
  edge: number;
  crease: number;
  /** Inward lean of the side above the crease, per metre. */
  lean: number;
  /** Pickup only: bed floor as a fraction of the height, and the cab back (z fraction). */
  bed?: [number, number];
}

// Proportions after real cars: big wheels that fill the arches, a low stance, a bonnet that drops to the nose, a raked
// windscreen and a glasshouse that is clearly narrower than the body, sitting on a shoulder that runs the full length.
const STYLES: Record<string, CarStyle> = {
  hatchback: {
    name: "hatchback", text: "a compact five-door hatchback with a short nose and a steep tailgate",
    length: [4.0, 3.6, 4.35], width: [1.76, 1.66, 1.84], height: [1.48, 1.42, 1.56], wheel: [0.32, 0.3, 0.34],
    ff: 0.67, fr: 0.68, a0: 0.52, tyreW: 0.21,
    upper: [[0.955, 0.13], [0.99, 0.22], [1.0, 0.33, "lampF"], [0.99, 0.43], [0.95, 0.5, "hoodF"], [0.45, 0.59, "hoodR"], [0.0, 0.6], [-0.5, 0.615], [-0.9, 0.63, "trunkF"], [-0.975, 0.52, "lampR"], [-1.0, 0.36, "trunkR"], [-0.995, 0.22], [-0.955, 0.12]],
    belt: 0.6, glass: [[0.45, 0.04], [0.33, 0.48], [0.18, 0.88], [0.06, 1], [-0.72, 1], [-0.82, 0.9], [-0.87, 0.5], [-0.9, 0.04]], shelf: 0.05, roof: [0.06, -0.73], tumble: 0.3,
    doors: 4, doorZ: [0.36, -0.06, -0.5], trunk: "gate", lamps: "slim", tails: "tall", bumper: "body", seats: { front: -0.1, rear: -0.55 },
    plan: [0.78, 0.97, 0.84], tuck: 0.05, edge: 0.03, crease: 1, lean: 0.14,
  },
  sedan: {
    name: "sedan", text: "a four-door saloon with a separate boot and a sloping rear window",
    length: [4.65, 4.3, 5.0], width: [1.82, 1.74, 1.9], height: [1.45, 1.4, 1.52], wheel: [0.335, 0.31, 0.36],
    ff: 0.65, fr: 0.6, a0: 0.5, tyreW: 0.225,
    upper: [[0.965, 0.12], [0.993, 0.22], [1.0, 0.33, "lampF"], [0.99, 0.43], [0.955, 0.5, "hoodF"], [0.42, 0.585, "hoodR"], [0.1, 0.595], [-0.3, 0.6], [-0.63, 0.612, "trunkF"], [-0.94, 0.625, "trunkR"], [-0.99, 0.56], [-1.0, 0.45, "lampR"], [-0.99, 0.28], [-0.96, 0.12]],
    belt: 0.6, glass: [[0.42, 0.04], [0.3, 0.48], [0.15, 0.88], [0.04, 1], [-0.3, 1], [-0.44, 0.84], [-0.55, 0.45], [-0.63, 0.04]], shelf: 0.05, roof: [0.04, -0.31], tumble: 0.3,
    doors: 4, doorZ: [0.34, -0.04, -0.4], trunk: "lid", lamps: "slim", tails: "corner", bumper: "body", seats: { front: -0.04, rear: -0.38 },
    plan: [0.78, 0.97, 0.82], tuck: 0.05, edge: 0.03, crease: 1, lean: 0.14,
  },
  estate: {
    name: "estate", text: "a long estate car with a flat roof that runs to an upright tailgate",
    length: [4.75, 4.45, 5.0], width: [1.82, 1.75, 1.9], height: [1.48, 1.42, 1.56], wheel: [0.335, 0.31, 0.36],
    ff: 0.65, fr: 0.6, a0: 0.48, tyreW: 0.225,
    upper: [[0.965, 0.12], [0.993, 0.22], [1.0, 0.33, "lampF"], [0.99, 0.43], [0.955, 0.5, "hoodF"], [0.44, 0.58, "hoodR"], [0.0, 0.59], [-0.6, 0.605], [-0.94, 0.62, "trunkF"], [-0.985, 0.5, "lampR"], [-1.0, 0.38, "trunkR"], [-0.995, 0.23], [-0.96, 0.12]],
    belt: 0.59, glass: [[0.44, 0.04], [0.32, 0.48], [0.17, 0.88], [0.06, 1], [-0.8, 1], [-0.88, 0.85], [-0.915, 0.45], [-0.94, 0.04]], shelf: 0.05, roof: [0.06, -0.83], tumble: 0.3,
    doors: 4, doorZ: [0.36, -0.02, -0.38], trunk: "gate", lamps: "slim", tails: "tall", bumper: "body", seats: { front: -0.06, rear: -0.4 }, rails: true,
    plan: [0.78, 0.97, 0.84], tuck: 0.05, edge: 0.03, crease: 1, lean: 0.14,
  },
  suv: {
    name: "SUV", text: "a tall SUV with high ground clearance, black wheel-arch trims and roof rails",
    length: [4.6, 4.3, 4.95], width: [1.9, 1.82, 2.0], height: [1.72, 1.64, 1.86], wheel: [0.375, 0.35, 0.4],
    ff: 0.66, fr: 0.66, a0: 0.36, tyreW: 0.25,
    upper: [[0.96, 0.16], [0.99, 0.27], [1.0, 0.4, "lampF"], [0.99, 0.5], [0.96, 0.555, "hoodF"], [0.46, 0.61, "hoodR"], [0.0, 0.615], [-0.6, 0.625], [-0.92, 0.635, "trunkF"], [-0.98, 0.53, "lampR"], [-1.0, 0.4, "trunkR"], [-0.995, 0.26], [-0.965, 0.15]],
    belt: 0.62, glass: [[0.46, 0.04], [0.36, 0.48], [0.23, 0.88], [0.13, 1], [-0.76, 1], [-0.85, 0.88], [-0.895, 0.45], [-0.92, 0.04]], shelf: 0.055, roof: [0.13, -0.78], tumble: 0.26,
    doors: 4, doorZ: [0.37, -0.04, -0.47], trunk: "gate", lamps: "square", tails: "tall", bumper: "black", seats: { front: -0.04, rear: -0.48 }, rails: true,
    plan: [0.82, 0.97, 0.86], tuck: 0.035, edge: 0.035, crease: 0.8, lean: 0.1,
  },
  pickup: {
    name: "pickup", text: "a double-cab pickup with a long bonnet and an open load bed behind the cab",
    length: [5.2, 4.95, 5.3], width: [1.9, 1.84, 2.0], height: [1.8, 1.74, 1.9], wheel: [0.39, 0.37, 0.41],
    ff: 0.66, fr: 0.6, a0: 0.3, tyreW: 0.26,
    upper: [[0.965, 0.17], [0.992, 0.28], [1.0, 0.42, "lampF"], [0.995, 0.51], [0.965, 0.565, "hoodF"], [0.5, 0.6, "hoodR"], [0.0, 0.605], [-0.5, 0.605], [-0.985, 0.6, "trunkF"], [-1.0, 0.56, "lampR"], [-1.0, 0.28], [-0.97, 0.17]],
    belt: 0.6, glass: [[0.5, 0.04], [0.41, 0.45], [0.3, 0.86], [0.2, 1], [-0.17, 1], [-0.185, 0.6], [-0.2, 0.04]], shelf: 0.06, roof: [0.2, -0.18], tumble: 0.22,
    doors: 4, doorZ: [0.4, 0.06, -0.19], trunk: "bed", lamps: "square", tails: "tall", bumper: "chrome", seats: { front: 0.12, rear: -0.14 },
    plan: [0.88, 0.98, 0.97], tuck: 0.03, edge: 0.03, crease: 0.6, lean: 0.08, bed: [0.53, -0.21],
  },
  coupe: {
    name: "coupe", text: "a low two-door coupe with a long door and a fastback roofline",
    length: [4.5, 4.2, 4.8], width: [1.84, 1.76, 1.92], height: [1.38, 1.33, 1.45], wheel: [0.335, 0.31, 0.36],
    ff: 0.66, fr: 0.62, a0: 0.55, tyreW: 0.245,
    upper: [[0.965, 0.11], [0.993, 0.2], [1.0, 0.31, "lampF"], [0.99, 0.4], [0.955, 0.47, "hoodF"], [0.32, 0.585, "hoodR"], [0.0, 0.585], [-0.5, 0.6], [-0.7, 0.61, "trunkF"], [-0.95, 0.625, "trunkR"], [-0.99, 0.56], [-1.0, 0.46, "lampR"], [-0.99, 0.27], [-0.96, 0.11]],
    belt: 0.6, glass: [[0.32, 0.04], [0.2, 0.45], [0.06, 0.88], [-0.05, 1], [-0.25, 1], [-0.42, 0.78], [-0.58, 0.4], [-0.71, 0.04]], shelf: 0.06, roof: [-0.05, -0.27], tumble: 0.34,
    doors: 2, doorZ: [0.33, -0.22], trunk: "lid", lamps: "slim", tails: "bar", bumper: "body", seats: { front: -0.14, rear: -0.44 }, spoiler: true,
    plan: [0.77, 0.95, 0.82], tuck: 0.055, edge: 0.03, crease: 1, lean: 0.16,
  },
  mpv: {
    name: "MPV", text: "a tall people carrier with a short nose, a long steep windscreen and a boxy cabin",
    length: [4.6, 4.3, 4.9], width: [1.86, 1.78, 1.95], height: [1.76, 1.66, 1.86], wheel: [0.335, 0.31, 0.35],
    ff: 0.68, fr: 0.7, a0: 0.45, tyreW: 0.22,
    upper: [[0.96, 0.12], [0.99, 0.22], [1.0, 0.31, "lampF"], [0.985, 0.41], [0.94, 0.48, "hoodF"], [0.66, 0.54, "hoodR"], [0.3, 0.55], [-0.5, 0.56], [-0.94, 0.57, "trunkF"], [-0.985, 0.46, "lampR"], [-1.0, 0.34, "trunkR"], [-0.995, 0.23], [-0.96, 0.12]],
    belt: 0.55, glass: [[0.66, 0.04], [0.54, 0.4], [0.38, 0.84], [0.26, 1], [-0.84, 1], [-0.9, 0.85], [-0.925, 0.45], [-0.94, 0.04]], shelf: 0.05, roof: [0.26, -0.86], tumble: 0.2,
    doors: 4, doorZ: [0.39, 0.0, -0.45], trunk: "gate", lamps: "slim", tails: "tall", bumper: "body", seats: { front: 0.1, rear: -0.38 }, rails: true,
    plan: [0.8, 0.975, 0.86], tuck: 0.045, edge: 0.04, crease: 0.8, lean: 0.1,
  },
  sports: {
    name: "sports car", text: "a low, wide mid-engined sports car with a cab-forward canopy and a rear spoiler",
    length: [4.4, 4.1, 4.65], width: [1.92, 1.85, 2.0], height: [1.3, 1.27, 1.36], wheel: [0.335, 0.31, 0.345],
    ff: 0.68, fr: 0.64, a0: 0.62, tyreW: 0.28,
    upper: [[0.97, 0.09], [0.993, 0.17], [1.0, 0.26], [0.99, 0.36, "lampF"], [0.955, 0.46, "hoodF"], [0.45, 0.6, "hoodR"], [0.0, 0.62], [-0.4, 0.625], [-0.48, 0.635, "trunkF"], [-0.95, 0.65, "trunkR"], [-0.99, 0.59], [-1.0, 0.47, "lampR"], [-0.99, 0.23], [-0.965, 0.09]],
    belt: 0.62, glass: [[0.45, 0.04], [0.3, 0.45], [0.14, 0.88], [0.04, 1], [-0.18, 1], [-0.32, 0.72], [-0.42, 0.35], [-0.48, 0.04]], shelf: 0.09, roof: [0.04, -0.2], tumble: 0.42,
    doors: 2, doorZ: [0.34, -0.2], trunk: "lid", lamps: "slim", tails: "bar", bumper: "body", seats: { front: -0.08 }, spoiler: true,
    plan: [0.76, 0.92, 0.84], tuck: 0.07, edge: 0.025, crease: 1, lean: 0.2,
  },
  vintage: {
    name: "vintage", text: "a 1950s-style saloon with round headlamps, chrome bumpers, whitewall tyres and chrome hubcaps",
    length: [4.6, 4.3, 5.0], width: [1.8, 1.7, 1.9], height: [1.56, 1.5, 1.65], wheel: [0.355, 0.34, 0.38],
    ff: 0.62, fr: 0.6, a0: 0.4, tyreW: 0.19,
    upper: [[0.955, 0.16], [0.985, 0.26], [1.0, 0.35], [0.99, 0.41, "lampF"], [0.95, 0.48, "hoodF"], [0.38, 0.565, "hoodR"], [0.0, 0.575], [-0.32, 0.58], [-0.55, 0.585, "trunkF"], [-0.92, 0.54, "trunkR"], [-0.975, 0.48], [-0.995, 0.4, "lampR"], [-0.995, 0.28], [-0.955, 0.16]],
    belt: 0.57, glass: [[0.38, 0.04], [0.3, 0.45], [0.22, 0.86], [0.14, 1], [-0.22, 1], [-0.34, 0.85], [-0.46, 0.45], [-0.56, 0.04]], shelf: 0.05, roof: [0.14, -0.24], tumble: 0.3,
    doors: 4, doorZ: [0.34, -0.02, -0.37], trunk: "lid", lamps: "round", tails: "round", bumper: "chrome", seats: { front: 0.0, rear: -0.34 },
    plan: [0.84, 0.98, 0.86], tuck: 0.09, edge: 0.07, crease: 0.15, lean: 0.3,
  },
};

type Finish = { name: string; paint: MaterialDef; wheel: WheelStyle; spokes?: number; roof?: string; rim?: string; nl: string };
/** Solid colours get a little flake (0.2), metallic paints more (0.35); both under a clear coat (roughness 0.22-0.28). */
const P = (name: string, nl: string, rgb: [number, number, number], wheel: WheelStyle, spokes?: number, roof?: string, metallic = 0.35, rim?: string): Finish => ({ name, nl, paint: carPaint(...rgb, metallic, metallic > 0.3 ? 0.24 : 0.27), wheel, ...(spokes ? { spokes } : {}), ...(roof ? { roof } : {}), ...(rim ? { rim } : {}) });

// Real car colours (linear RGB): solid reds and yellows like the RAL cards, metallic greys, silvers and blues.
const RED: [number, number, number] = [0.33, 0.022, 0.02];
const WHITE: [number, number, number] = [0.62, 0.62, 0.6];
const SILVER: [number, number, number] = [0.42, 0.43, 0.44];
const BLACK: [number, number, number] = [0.018, 0.018, 0.02];
const GREY: [number, number, number] = [0.1, 0.105, 0.11];
const SOLID = 0.2;

const FINISHES: Record<string, Finish[]> = {
  hatchback: [P("red", "rood", RED, "alloy", 5, undefined, SOLID), P("white", "wit", WHITE, "steel", undefined, undefined, SOLID), P("sky blue", "lichtblauw", [0.16, 0.28, 0.42], "alloy", 10, "gloss_black"), P("yellow", "geel", [0.58, 0.36, 0.02], "alloy", 6, "gloss_black", SOLID, "alloy_dark")],
  sedan: [P("silver", "zilver", SILVER, "alloy", 5), P("black", "zwart", BLACK, "alloy", 10), P("blue", "blauw", [0.018, 0.05, 0.17], "alloy", 6), P("burgundy", "bordeaux", [0.13, 0.012, 0.02], "steel")],
  estate: [P("grey", "grijs", GREY, "alloy", 5), P("green", "groen", [0.018, 0.065, 0.035], "alloy", 10), P("white", "wit", WHITE, "steel", undefined, undefined, SOLID)],
  suv: [P("black", "zwart", BLACK, "alloy", 6, undefined, 0.35, "alloy_dark"), P("white", "wit", WHITE, "alloy", 5, "gloss_black", SOLID), P("sand", "zand", [0.33, 0.27, 0.17], "steel"), P("blue", "blauw", [0.025, 0.07, 0.18], "alloy", 10)],
  pickup: [P("red", "rood", [0.3, 0.02, 0.018], "steel", undefined, undefined, SOLID), P("silver", "zilver", SILVER, "alloy", 6), P("olive", "olijfgroen", [0.1, 0.1, 0.045], "steel", undefined, undefined, SOLID)],
  coupe: [P("orange", "oranje", [0.5, 0.11, 0.01], "alloy", 5, undefined, SOLID, "alloy_dark"), P("silver", "zilver", SILVER, "alloy", 10), P("black", "zwart", BLACK, "alloy", 6)],
  mpv: [P("white", "wit", WHITE, "alloy", 5, undefined, SOLID), P("grey", "grijs", GREY, "steel"), P("blue", "blauw", [0.03, 0.08, 0.24], "alloy", 10)],
  sports: [P("red", "rood", [0.4, 0.02, 0.016], "alloy", 5, undefined, SOLID, "alloy_dark"), P("yellow", "geel", [0.62, 0.4, 0.015], "alloy", 10, "carbon", SOLID, "alloy_dark"), P("white", "wit", WHITE, "alloy", 6, "carbon", SOLID)],
  vintage: [P("cream", "crème", [0.52, 0.45, 0.31], "chrome", undefined, undefined, SOLID), P("teal", "petrol", [0.03, 0.16, 0.16], "chrome", undefined, "whitewall"), P("burgundy", "bordeaux", [0.14, 0.012, 0.022], "wire", 24)],
};

type P2 = [number, number];
type LP = [Lin, Lin];

/** Linear interpolation in a table of [x, y] rows (sorted by x), clamped at the ends. */
function interp(rows: [number, number][], x: number): number {
  if (x <= rows[0]![0]) return rows[0]![1];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!, b = rows[i]!;
    if (x <= b[0]) return a[1] + ((x - a[0]) / (b[0] - a[0] || 1)) * (b[1] - a[1]);
  }
  return rows[rows.length - 1]![1];
}

function inside(poly: P2[], p: P2): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * The car body as a loft along z. Stations run on a coordinate s: 0..1 the front overhang (nose to the front arch), 1..2
 * the front arch, 2..3 between the arches, 3..4 the rear arch, 4..5 the rear overhang. Over an arch the bottom of every
 * section follows the arch circle, so the wheel sits in a tunnel that reads as a wheel arch from outside.
 */
class Body {
  env: Record<string, number>;
  envs: Record<string, number>[];
  sill: Lin;
  iF: number;
  iR: number;
  constructor(public st: CarStyle) {
    const wr = st.wheel[0], H = st.height[0];
    const ra = wr + 0.035;
    this.env = { L2: st.length[0] / 2, W2: st.width[0] / 2, H, wr, Ra: ra };
    // The parameter corners the shape decisions must also hold at: big wheels under a low roof, and the other way round.
    const corner = (h: number, w: number, l: number) => ({ L2: l / 2, W2: st.width[0] / 2, H: h, wr: w, Ra: w + 0.035 });
    this.envs = [this.env, corner(st.height[1], st.wheel[2], st.length[1]), corner(st.height[2], st.wheel[1], st.length[2]), corner(st.height[1], st.wheel[2], st.length[2]), corner(st.height[2], st.wheel[1], st.length[1])];
    this.sill = L(0, { wr: 1, Ra: -Math.sin(st.a0) });
    const zs = st.upper.map((p) => p[0]);
    this.iF = zs.indexOf(Math.max(...zs));
    this.iR = zs.lastIndexOf(Math.min(...zs));
  }
  /** Stations are asked for again and again (by every panel, seal and light), and the answer never changes. */
  private memo = new Map<string, unknown>();
  private cached<T>(key: string, make: () => T): T {
    if (this.memo.has(key)) return this.memo.get(key) as T;
    const value = make();
    this.memo.set(key, value);
    return value;
  }
  raExpr(): string { return "$wheelRadius + 0.035"; }
  ev(l: Lin): number { return lev(l, this.env); }
  /** Top centre line (fraction of H) at a z fraction. */
  topFracRaw(zf: number): number {
    const u = this.st.upper;
    const zs = u.map((p) => p[0]);
    const iF = zs.indexOf(Math.max(...zs)), iR = zs.lastIndexOf(Math.min(...zs));
    const chain = u.slice(iF, iR + 1).map((p) => [-p[0], p[1]] as [number, number]);
    return interp(chain, -zf);
  }
  /** z of a station. */
  Z(s: number): Lin { return this.cached(`Z${s}`, () => this.zRaw(s)); }
  private zRaw(s: number): Lin {
    const st = this.st, c = Math.cos(st.a0);
    const edge = (zc: number, sgn: number): Lin => L(sgn * 0.008, { L2: zc, Ra: sgn });
    void c;
    if (s <= 1) return lerpL(L(0, { L2: 1 }), edge(st.ff, 1), s);
    if (s < 2) { const th = this.th(s - 1); return L(0, { L2: st.ff, Ra: Math.cos(th) }); }
    if (s <= 3) return lerpL(edge(st.ff, -1), edge(-st.fr, 1), s - 2);
    if (s < 4) { const th = this.th(s - 3); return L(0, { L2: -st.fr, Ra: Math.cos(th) }); }
    return lerpL(edge(-st.fr, -1), L(0, { L2: -1 }), s - 4);
  }
  /** Over an arch the bottom runs on a half circle from hub height in front to hub height behind; under the hub it drops straight to the sill. */
  th(u: number): number { return u * Math.PI; }
  zf(s: number): number { return this.ev(this.Z(s)) / this.env.L2!; }
  /** The station at a z fraction (at the defaults). */
  sAt(zf: number): number {
    let a = 0, b = 5;
    for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (this.zf(m) > zf) a = m; else b = m; }
    return (a + b) / 2;
  }
  arch(s: number): boolean { return (s > 1 && s < 2) || (s > 3 && s < 4); }
  /** Bottom of the section. */
  bottom(s: number): Lin {
    const st = this.st, u = st.upper;
    if (this.arch(s)) { const th = this.th(s > 3 ? s - 3 : s - 1); return L(0, { wr: 1, Ra: Math.sin(th) }); }
    const zf = this.zf(s);
    if (s <= 1) {
      const chain = u.slice(0, this.iF + 1);
      const zm = chain[chain.length - 1]![0] - 0.004;
      const z = Math.min(zf, zm);
      if (z >= chain[0]![0]) return L(0, { H: interp(chain.map((p) => [p[0], p[1]]), z) });
      const t = (chain[0]![0] - z) / (chain[0]![0] - this.zf(1));
      return lerpL(L(0, { H: chain[0]![1] }), this.sill, t);
    }
    if (s >= 4) {
      const chain = u.slice(this.iR);
      const zm = chain[0]![0] + 0.004;
      const z = Math.max(zf, zm);
      const last = chain[chain.length - 1]!;
      if (z <= last[0]) return L(0, { H: interp(chain.map((p) => [p[0], p[1]]), z) });
      const t = (z - last[0]) / (this.zf(4) - last[0]);
      return lerpL(L(0, { H: last[1] }), this.sill, t);
    }
    return this.sill;
  }
  top(s: number): Lin {
    const u = this.st.upper;
    const zf = Math.min(u[this.iF]![0] - 0.004, Math.max(u[this.iR]![0] + 0.004, this.zf(s)));
    return L(0, { H: this.topFracRaw(zf) });
  }
  hw(s: number): number {
    const [n, m, t] = this.st.plan;
    return interp([[0, n], [0.03, n + 0.06], [0.12, n + 0.1], [0.35, Math.max(n + 0.12, 0.95)], [1, 0.985], [1.5, 1], [2, 0.985], [2.5, m], [3, 0.985], [3.5, 1], [4, 0.985], [4.65, Math.max(t + 0.1, 0.95)], [4.88, t + 0.08], [4.97, t + 0.04], [5, t]], s);
  }
  isBed(s: number): boolean { return !!this.st.bed && this.zf(s) < this.st.bed[1] - 0.004; }
  /**
   * The right half of the section at s, from the bottom (inboard) over the side and the shoulder to the top centre:
   * a rounded bottom corner, the tuck-under, the shoulder crease (widest point), the shoulder edge and the crowned top.
   */
  section(s: number) { return this.cached(`s${s}`, () => this.sectionRaw(s)); }
  private sectionRaw(s: number) {
    const st = this.st, ev = (l: Lin) => this.ev(l);
    const yB = this.bottom(s);
    const yT = this.top(s);
    const ext = ev(yT) - ev(yB);
    const crown = Math.min(0.025, 0.12 * ext);
    let yE = ladd(yT, L(-crown));
    // Over the arches the wings rise where the bonnet is low (sports cars): the shoulder stays 17 cm over the arch.
    const sm = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c); };
    const w = s < 1 ? sm(1 - (1 - s) / 0.8) : s <= 2 ? 1 : s < 3 ? Math.max(sm(1 - (s - 2) / 0.8), sm(1 - (3 - s) / 0.8)) : s <= 4 ? 1 : sm(1 - (s - 4) / 0.8);
    const wing = L(0.17, { wr: 1, Ra: 1 });
    const any = (f2: (e: Record<string, number>) => boolean) => this.envs.some(f2);
    if (w > 0 && ev(wing) > ev(yE) - 0.03) yE = lerpL(yE, wing, w);
    // The shoulder crease runs level along the side, a little under the belt; at nose and tail it follows the top edge.
    const belt = L(-0.085 + 0.012 * (s - 2.5) / 2.5, { H: st.belt });
    const lim = ev(yE) - 0.05;
    void lim;
    // Blended, not switched, so the crease never jumps between stations at any parameter setting.
    const c2 = ladd(yE, L(-0.05)), c3 = lerpL(yB, yE, 0.58);
    const k1 = Math.max(...this.envs.map((e) => sm((lev(belt, e) - lev(c2, e) + 0.05) / 0.1)));
    const m12 = lerpL(belt, c2, k1);
    const k2 = Math.max(...this.envs.map((e) => sm((lev(m12, e) - lev(c3, e) + 0.02) / 0.04)));
    let yC = lerpL(m12, c3, k2);
    // Over the arches the crease stays 7 cm above the arch at every parameter setting.
    const archC = L(0.07, { wr: 1, Ra: 1 });
    if (w > 0 && any((e) => lev(yC, e) < lev(archC, e))) yC = lerpL(yC, archC, w);
    const hs = ev(yC) - ev(yB);
    const hwm = L(0, { W2: this.hw(s) });
    const x = (d: number): Lin => ladd(hwm, L(-d));
    const rb = Math.min(0.06, 0.3 * hs);
    const tuck = st.tuck * Math.min(1, hs / 0.4);
    const cm = Math.min(0.02, 0.22 * hs), cp = Math.min(0.015, 0.3 * (ev(yE) - ev(yC)));
    const up = ev(yE) - ev(yC);
    const re = Math.min(st.edge, 0.4 * up, 0.3 * (ev(yE) - ev(yB)));
    const lean = st.lean * up;
    const yb0 = ladd(yB, L(rb));
    const pts: LP[] = [
      [x(tuck + rb), yB],
      [x(tuck + rb * 0.293), ladd(yB, L(rb * 0.293))],
      [x(tuck), yb0],
      ...[0.3, 0.6, 0.85].map((u): LP => [x(tuck * (1 - u) * (1 - u)), lerpL(yb0, ladd(yC, L(-cm)), u)]),
      [x(0.003 * st.crease + 0.001), ladd(yC, L(-cm))],
      [x(0), yC],
      [x(0.008 * st.crease + 0.002), ladd(yC, L(cp))],
      [x(0.008 * st.crease + 0.002 + lean * 0.5), lerpL(ladd(yC, L(cp)), ladd(yE, L(-re)), 0.5)],
      [x(0.008 * st.crease + 0.002 + lean), ladd(yE, L(-re))],
      [x(0.008 * st.crease + 0.002 + lean + re * 0.293), ladd(yE, L(-re * 0.293))],
    ];
    const xe = x(0.008 * st.crease + 0.002 + lean + re);
    pts.push([xe, yE]);
    if (this.isBed(s)) {
      const floor = L(0, { H: st.bed![0] });
      pts.push([ladd(xe, L(-0.05)), ladd(yE, L(-0.004))], [ladd(xe, L(-0.05)), floor]);
    } else {
      pts.push([lscale(xe, 0.62), lerpL(yE, yT, 1 - 0.62 * 0.62)], [lscale(xe, 0.25), lerpL(yE, yT, 1 - 0.25 * 0.25)]);
    }
    // Under the body: over an arch the tunnel only spans the wheel; inboard of it the body keeps its floor (a well wall).
    const xin = L(-(st.tyreW + 0.075), { W2: 1 });
    const floor = this.arch(s) ? this.sill : yB;
    const under: LP[] = [[ladd(xin, L(-0.03)), floor], [xin, yB]];
    return { pts, under, yB, yT, yE, yC, xe, hwm, rb };
  }
  ring(s: number): LP[] { return this.cached(`r${s}`, () => this.ringRaw(s)); }
  private ringRaw(s: number): LP[] {
    const S = this.section(s);
    const h = [...S.under, ...S.pts];
    return [...h, ...[...h].reverse().map(([x, y]): LP => [lscale(x, -1), y])];
  }
  ringDef(s: number): P2[] { return this.ring(s).map(([x, y]) => [this.ev(x), this.ev(y)]); }
  /** The station where the front (or rear) surface passes through (x, y) at the defaults. */
  surfaceS(x: number, y: number, rear = false): number {
    let a = rear ? 4 : 0, b = rear ? 5 : 1;
    if (!rear && !inside(this.ringDef(1), [x, y])) return 1;
    if (rear && !inside(this.ringDef(4), [x, y])) return 4;
    for (let k = 0; k < 30; k++) {
      const m = (a + b) / 2;
      const isIn = inside(this.ringDef(m), [x, y]);
      if (rear ? isIn : !isIn) a = m; else b = m;
    }
    return (a + b) / 2;
  }
  /** x of the body side at height y (default value) on station s, as an expression that scales with the half width. */
  sideX(s: number, y: number): Lin {
    const h = this.section(s).pts.slice(0, 13).map(([px, py]) => [this.ev(py), this.ev(px)] as [number, number]);
    const xs = interp(h, y);
    const w = this.hw(s);
    return L(xs - w * this.env.W2!, { W2: w });
  }
}

/** The body model of each style, built once: it depends on the style only, not on the finish. */
const BODIES = new Map<string, Body>();

function buildCar(key: string, st: CarStyle, fin: Finish): AssetDraft {
  const B = BODIES.get(key) ?? new Body(st);
  BODIES.set(key, B);
  const env = B.env;
  const ev = (l: Lin) => B.ev(l);
  const Hd = env.H!;
  const kids: SpecNode[] = [];
  const tagZ = (t: string): number => { const p = st.upper.find((q) => q[2] === t); if (!p) throw new Error(`car ${key}: no ${t}`); return p[0]; };

  // Stations: the overhangs dense at nose and tail, 12 over each arch, the tagged panel edges as extra stations.
  const over = [0, 0.01, 0.035, 0.08, 0.15, 0.25, 0.38, 0.54, 0.72, 0.88];
  const sList = new Set<number>([...over, ...Array.from({ length: 13 }, (_, i) => 1 + i / 12), 1.0005, 1.9995, 2.12, 2.28, 2.45, 2.62, 2.78, 2.9, ...Array.from({ length: 13 }, (_, i) => 3 + i / 12), 3.0005, 3.9995, ...over.map((v) => 5 - v)]);
  const extra: Record<string, number> = {};
  for (const t of ["hoodF", "hoodR", "trunkF", "trunkR"]) {
    if (st.trunk === "bed" && t === "trunkR") continue;
    let s = B.sAt(tagZ(t));
    if (Math.abs(s - Math.round(s)) < 0.04) s = Math.round(s);
    extra[t] = s;
    sList.add(s);
  }
  if (st.bed) { const s = B.sAt(st.bed[1] + 0.002); sList.add(s); extra["cab"] = s; const s2 = B.sAt(st.bed[1] - 0.012); sList.add(s2); extra["cab2"] = s2; }
  // A regular station too close to a panel edge would make sliver quads: the edge station replaces it.
  const ex = Object.values(extra);
  const stations = [...sList].sort((a, b) => a - b).filter((s) => ex.includes(s) || Math.abs(s - Math.round(s)) < 0.001 || ex.every((e) => Math.abs(s - e) > 0.035));
  const sec = (s: number) => ({ z: ls(B.Z(s)), points: B.ring(s).map(([x, y]) => [ls(x), ls(y)]) });
  kids.push(loft("Body", stations.map(sec), { material: "body_paint" }));

  // Arch liners: black wells between the wheels, so the tunnel over each axle reads as a dark wheel arch.
  const tw = st.tyreW + 0.015;
  for (const [n, zc] of [["ArchLiner_F", st.ff], ["ArchLiner_R", -st.fr]] as [string, number][]) {
    kids.push(box(`${n}L`, [0.02, `$wr + $Ra - $ys`, "$Ra * 2"], { at: [`$W2 - ${f(st.tyreW + 0.075 + 0.002)}`, `($wr + $Ra + $ys) / 2 - 0.004`, `${f(zc)} * $L2`], material: "trim_black", mirror: `${n}R` }));
    void n;
  }

  // Greenhouse: glass on a shelf inside the shoulders, bowed side glass, rounded roof corners.
  const yb = L(0, { H: st.belt });
  const glassAt = (zf: number, t: number) => {
    const s = B.sAt(zf);
    const S = B.section(s);
    const yT = lerpL(yb, L(-0.035, { H: 1 }), t);
    const h = ladd(lsub(yT, yb), L(0.05));
    const rc = Math.min(0.085, 0.4 * ev(h));
    const wbz = ladd(S.xe, L(-st.shelf));
    const wt = ladd(wbz, lscale(h, -st.tumble));
    const side: LP[] = [[wbz, ladd(yb, L(-0.05))], [ladd(lerpL(wbz, wt, 0.42), L(0.012 * Math.min(1, t * 1.5))), lerpL(yb, ladd(yT, L(-rc)), 0.5)]];
    const corner: LP[] = [0, 30, 60, 90].map((a) => { const r = (a * Math.PI) / 180; return [ladd(wt, L(-rc * (1 - Math.cos(r)))), ladd(yT, L(-rc * (1 - Math.sin(r))))]; });
    const half = [...side, ...corner];
    return { s, z: B.Z(s), half, wt, wbz, yT, rc };
  };
  const gl = [...st.glass].sort((a, b) => b[0] - a[0]).map(([z, t]) => glassAt(z, t));
  kids.push(loft("Glass", gl.map((g) => ({ z: ls(g.z), points: [...g.half, ...[...g.half].reverse().map(([x, y]): LP => [lscale(x, -1), y])].map(([x, y]) => [ls(x), ls(y)]) })), { material: "tinted_glass" }));

  // Roof: a separate panel on the glass, narrower than the body.
  const roofMat = fin.roof ?? "body_paint";
  const [rz0, rz1] = st.roof;
  const roofSec = (zf: number, dz: number, full: boolean) => {
    const g = glassAt(zf, 1);
    return { z: `${ls(g.z)} ${dz < 0 ? "-" : "+"} ${f(Math.abs(dz))}`, superellipse: { width: `2 * (${ls(g.wt)}) + ${full ? 0.012 : -0.06}`, height: full ? 0.034 : 0.012, n: 2.6, count: 24, cy: `$H - ${full ? 0.018 : 0.03}` } };
  };
  kids.push(loft("Roof", [roofSec(rz1, -0.03, false), roofSec(rz1, 0, true), roofSec((rz0 + rz1) / 2, 0, true), roofSec(rz0, 0, true), roofSec(rz0, 0.03, false)], { material: roofMat }));

  // Pillars along the glass corners (A at the windscreen, C at the rear window), B on the side glass; window seals.
  const cornerPt = (g: ReturnType<typeof glassAt>, out: number): [Num, Num, Num] => [ls(ladd(g.half[3]![0], L(out))), ls(ladd(g.half[3]![1], L(out * 0.5))), ls(g.z)];
  const front = gl.filter((g) => g.s <= B.sAt(st.roof[0]) + 1e-6);
  const rear = gl.filter((g) => g.s >= B.sAt(st.roof[1]) - 1e-6);
  const pathA = front.map((g) => cornerPt(g, 0.012));
  pathA[0] = [ls(ladd(front[0]!.wbz, L(0.01))), ls(ladd(yb, L(-0.01))), ls(front[0]!.z)];
  kids.push(tube("PillarA_L", pathA.reverse(), 0.034, { material: roofMat, segments: 10, mirror: "PillarA_R" }));
  const pathC = rear.map((g) => cornerPt(g, 0.012));
  pathC[pathC.length - 1] = [ls(ladd(rear[rear.length - 1]!.wbz, L(0.01))), ls(ladd(yb, L(-0.01))), ls(rear[rear.length - 1]!.z)];
  kids.push(tube("PillarC_L", pathC, st.trunk === "lid" ? 0.06 : 0.045, { material: roofMat, segments: 10, mirror: "PillarC_R" }));
  const gB = glassAt(st.doorZ[1], 1);
  kids.push(tube("PillarB_L", [[ls(ladd(gB.half[0]![0], L(0.006))), ls(ladd(yb, L(-0.02))), ls(gB.z)], [ls(ladd(gB.half[1]![0], L(0.006))), ls(gB.half[1]![1]), ls(gB.z)], [ls(ladd(gB.half[3]![0], L(0.004))), ls(gB.half[3]![1]), ls(gB.z)]], 0.036, { material: "trim_black", segments: 8, mirror: "PillarB_R" }));
  kids.push(tube("Seal_L", gl.map((g) => [ls(ladd(g.wbz, L(0.006))), ls(ladd(yb, L(0.004))), ls(g.z)] as [Num, Num, Num]), 0.011, { material: st.bumper === "chrome" ? "chrome" : "rubber_seal", segments: 8, mirror: "Seal_R" }));
  if (st.rails) {
    const a = glassAt(st.roof[0], 1), c = glassAt(st.roof[1], 1);
    kids.push(tube("RoofRail_L", [[ls(ladd(a.wt, L(-0.06))), `$H - 0.01`, `${ls(a.z)} - 0.02`], [ls(ladd(a.wt, L(-0.06))), `$H + 0.04`, `${ls(a.z)} - 0.1`], [ls(ladd(c.wt, L(-0.06))), `$H + 0.04`, `${ls(c.z)} + 0.1`], [ls(ladd(c.wt, L(-0.06))), `$H - 0.01`, `${ls(c.z)} + 0.02`]], 0.016, { material: "aluminium", segments: 8, mirror: "RoofRail_R" }));
  }

  // Doors: skins that follow the body side (tuck-under and crease), hinged on their front edge, over a dark shut line.
  const doorBotY = ev(B.sill) + 0.09;
  const sMid = B.sAt(st.doorZ[1]);
  const refSec = B.section(sMid);
  const doorTopY = Math.min(...[2, 2.2, 2.4, 2.6, 2.8, 3].map((s) => ev(B.section(s).yE))) - st.edge - 0.015;
  const heights = [doorBotY, ...refSec.pts.slice(3, 11).map(([, y]) => ev(y)).filter((y) => y > doorBotY + 0.02 && y < doorTopY - 0.01), doorTopY];
  const hLin = heights.map((y) => L(y - st.belt * Hd, { H: st.belt }));
  // A lens-shaped strip: the outer and inner skins meet at the top and bottom edges (no thin end faces).
  const strip = (zs: number[], out: number, inn: number, dy: number, origin: [Lin, Lin, Lin]) => zs.map((zf) => {
    const s = B.sAt(zf);
    const n = heights.length;
    const at = (i: number, off: number): [Num, Num] => {
      const yy = i === 0 ? heights[i]! - dy : i === n - 1 ? heights[i]! + dy : heights[i]!;
      const yl = i === 0 ? ladd(hLin[i]!, L(-dy)) : i === n - 1 ? ladd(hLin[i]!, L(dy)) : hLin[i]!;
      return [ls(lsub(ladd(B.sideX(s, yy), L(off)), origin[0])), ls(lsub(yl, origin[1]))];
    };
    const tip = (out - inn) / 2;
    const pts: [Num, Num][] = [at(0, tip)];
    for (let i = 1; i < n - 1; i++) pts.push(at(i, out));
    pts.push(at(n - 1, tip));
    for (let i = n - 2; i >= 1; i--) pts.push(at(i, -inn));
    return { z: ls(lsub(B.Z(s), origin[2])), points: pts };
  });
  const doorNode = (name: string, z0: number, z1: number, mirror: string): SpecNode => {
    const s0 = B.sAt(z0);
    const origin: [Lin, Lin, Lin] = [B.sideX(s0, doorBotY), hLin[0]!, B.Z(s0)];
    const span = z0 - z1;
    const mid = [0.12, 0.27, 0.42, 0.58, 0.73, 0.88].map((u) => z1 + span * u);
    const zs = [z1 + 0.003 / env.L2!, z1 + (0.025 / env.L2!), ...mid, z0 - 0.025 / env.L2!, z0 - 0.003 / env.L2!];
    const zg = [z1 - 0.004 / env.L2!, z1 + 0.025 / env.L2!, ...mid, z0 - 0.025 / env.L2!, z0 + 0.004 / env.L2!];
    const yH = doorTopY - 0.1;
    const sH = B.sAt(z1 + 0.16 / env.L2!);
    const handle = box("Handle", [0.03, 0.028, 0.16], { at: [ls(lsub(ladd(B.sideX(sH, yH), L(0.012)), origin[0])), ls(lsub(L(yH - st.belt * Hd, { H: st.belt }), origin[1])), ls(lsub(B.Z(sH), origin[2]))], bevel: 0.01, material: st.bumper === "chrome" ? "chrome" : "satin_black" });
    zs.reverse(); zg.reverse();
    return group(name, [
      loft("Skin", strip(zs, 0.0045, 0.006, 0, origin), { material: "body_paint" }),
      loft("Gap", strip(zg, 0.0018, 0.008, 0.005, origin), { material: "panel_gap" }),
      handle,
    ], { at: [ls(origin[0]), ls(origin[1]), ls(origin[2])], mirror });
  };
  const zArchF = (ev(B.Z(1)) - 0.06) / env.L2!, zArchR = (ev(B.Z(4)) + 0.04) / env.L2!;
  const zFront = Math.min(st.doorZ[0], (ev(B.Z(2)) - 0.03) / env.L2!);
  kids.push(doorNode("Door_FL", zFront, st.doorZ[1] + 0.004, "Door_FR"));
  if (st.doors === 4) kids.push(doorNode("Door_RL", st.doorZ[1] - 0.004, Math.max(st.doorZ[2]!, (ev(B.Z(3)) + 0.03) / env.L2!), "Door_RR"));
  void zArchF; void zArchR;

  // Bonnet and boot lid: shells over the top surface between their stations, a few millimetres proud, over a dark gap.
  const shell = (name: string, sA: number, sB: number, hingeAtA: boolean, extraKids: SpecNode[] = []): SpecNode => {
    const ss = stations.filter((s) => s >= Math.min(sA, sB) - 1e-9 && s <= Math.max(sA, sB) + 1e-9);
    const sh = hingeAtA ? sA : sB;
    const H0 = B.section(sh);
    // The hinge on the top of the panel's edge: the crown, or the wing tops when they stand higher (sports cars).
    const tops: Lin[] = [ladd(H0.pts[12]![1], L(-0.0005)), ladd(H0.pts[13]![1], L(0.005)), ladd(H0.pts[14]![1], L(0.005))];
    const topY = tops.reduce((m, l) => (ev(l) > ev(m) ? l : m));
    const origin: [Lin, Lin] = [topY, B.Z(sh)];
    const ringOf = (s: number, up: number, down: number, grow: number) => {
      const S = B.section(s);
      const [e, t1, t2] = S.pts.slice(12) as [LP, LP, LP];
      const P = ([x, y]: LP, dx: number, dyy: number): [Num, Num] => [ls(ladd(x, L(dx))), ls(lsub(ladd(y, L(dyy)), origin[0]))];
      const M = ([x, y]: LP): LP => [lscale(x, -1), y];
      const tipY = (up - down) / 2;
      return { z: ls(lsub(B.Z(s), origin[1])), points: [P(e, grow, tipY), P(t1, 0, up), P(t2, 0, up), P(M(t2), 0, up), P(M(t1), 0, up), P(M(e), -grow, tipY), P(M(t1), 0, -down), P(M(t2), 0, -down), P(t2, 0, -down), P(t1, 0, -down)] };
    };
    return group(name, [
      loft("Panel", ss.map((s) => ringOf(s, 0.005, 0.006, 0)), { material: "body_paint" }),
      loft("Gap", ss.map((s) => ringOf(s, 0.0022, 0.008, 0.006)), { material: "panel_gap" }),
      ...extraKids,
    ], { at: [0, ls(origin[0]), ls(origin[1])] });
  };
  kids.push(shell("Hood", extra["hoodR"]!, extra["hoodF"]!, true));
  if (st.trunk === "lid") kids.push(shell("Trunk", extra["trunkF"]!, extra["trunkR"]!, true));

  // Lamps sit in the surface, turned to its normal.
  const onFront = (x: number, y: number, rear = false) => {
    const s = B.surfaceS(x, y, rear);
    const z = ev(B.Z(s));
    const dzx = ev(B.Z(B.surfaceS(x + 0.04, y, rear))) - ev(B.Z(B.surfaceS(x - 0.04, y, rear)));
    const dzy = ev(B.Z(B.surfaceS(x, y + 0.03, rear))) - ev(B.Z(B.surfaceS(x, y - 0.03, rear)));
    const sg = rear ? -1 : 1;
    const yaw = (Math.atan2(-sg * dzx / 0.08, 1) * 180) / Math.PI;
    const pitch = (Math.atan2(-sg * dzy / 0.06, 1) * 180) / Math.PI;
    return { s, z, Zl: B.Z(s), yaw: Math.max(-55, Math.min(55, yaw)), pitch: Math.max(-40, Math.min(40, pitch)) };
  };
  const yl = (y: number): Lin => L(0, { H: y / Hd });
  const xl = (x: number): Lin => L(0, { W2: x / env.W2! });
  const lampFY0 = st.upper.find((p) => p[2] === "lampF")![1] * Hd;
  const lampFY = st.lamps === "round" ? lampFY0 : lampFY0 + 0.55 * (st.upper.find((p) => p[2] === "hoodF")![1] * Hd - lampFY0);
  const lampRY = st.upper.find((p) => p[2] === "lampR")![1] * Hd;
  const W2 = env.W2!;
  const lampX = st.lamps === "round" ? W2 * 0.66 : st.lamps === "square" ? W2 * 0.62 : W2 * 0.64;
  const lf = onFront(lampX, lampFY);
  const lampF: SpecNode[] = st.lamps === "round"
    ? [cyl("Bezel", 0.095, 0.08, { axis: "z", segments: 24, material: "chrome", bevel: 0.01 }), ellipsoid("Bowl", [0.078, 0.078, 0.03], { at: [0, 0, 0.03], segments: 18, material: "reflector" }), cyl("Bulb", 0.02, 0.04, { axis: "z", at: [0, 0, 0.045], segments: 12, material: "lamp_lens" }), ellipsoid("Lens", [0.082, 0.082, 0.035], { at: [0, 0, 0.042], segments: 18, material: "lamp_glass" })]
    : st.lamps === "square"
      ? [box("Housing", [0.32, 0.12, 0.1], { bevel: 0.02, material: "gloss_black" }), box("Bowl_{i}", [0.12, 0.08, 0.03], { at: [-0.07, 0.008, 0.04], repeat: { count: 2, step: [0.14, 0, 0] }, bevel: 0.012, material: "reflector" }), cyl("Bulb_{i}", 0.025, 0.03, { axis: "z", at: [-0.07, 0.008, 0.055], repeat: { count: 2, step: [0.14, 0, 0] }, segments: 12, material: "lamp_lens" }), box("Lens", [0.3, 0.1, 0.03], { at: [0, 0, 0.05], bevel: 0.012, material: "lamp_glass" }), box("Drl", [0.28, 0.012, 0.02], { at: [0, -0.05, 0.05], material: "lamp_lens" })]
      : [ellipsoid("Housing", [0.21, 0.056, 0.08], { segments: 16, material: "gloss_black" }), ellipsoid("Bowl", [0.12, 0.036, 0.05], { at: [-0.03, 0.002, 0.02], segments: 14, material: "reflector" }), cyl("Bulb", 0.022, 0.05, { axis: "z", at: [-0.03, 0.002, 0.04], segments: 12, material: "lamp_lens" }), box("Drl", [0.26, 0.01, 0.03], { at: [0, -0.03, 0.045], material: "lamp_lens" }), ellipsoid("Lens", [0.205, 0.052, 0.07], { at: [0, 0, 0.022], segments: 16, material: "lamp_glass" }), box("Signal", [0.06, 0.02, 0.03], { at: [0.13, -0.01, 0.03], material: "lamp_amber" })];
  kids.push(group("Headlight_L", lampF, { at: [ls(xl(lampX)), ls(yl(lampFY)), `${ls(lf.Zl)} - 0.035`], rotate: [-lf.pitch, lf.yaw, 0], mirror: "Headlight_R" }));

  const tailX = st.tails === "bar" || st.tails === "corner" ? W2 * 0.68 : st.trunk === "bed" ? W2 * 0.86 : W2 * 0.76;
  const tailY = st.trunk === "bed" ? Hd * 0.42 : lampRY;
  const lr = onFront(tailX, tailY, true);
  const tail: SpecNode[] = st.tails === "round"
    ? [cyl("Lens", 0.06, 0.08, { axis: "z", segments: 20, material: "lamp_red", bevel: 0.01 }), cyl("Ring", 0.07, 0.05, { axis: "z", segments: 20, material: "chrome" })]
    : st.tails === "tall"
      ? [box("Lens", [0.12, 0.26, 0.08], { bevel: 0.02, material: "lamp_red" }), box("Reverse", [0.07, 0.05, 0.08], { at: [-0.015, -0.1, 0.008], material: "lamp_lens" })]
      : st.tails === "bar"
        ? [box("Lens", [0.36, 0.06, 0.08], { bevel: 0.02, material: "lamp_red" })]
        : [box("Lens", [0.3, 0.1, 0.08], { bevel: 0.02, material: "lamp_red" }), box("Amber", [0.1, 0.1, 0.08], { at: [-0.13, 0, 0.006], bevel: 0.015, material: "lamp_amber" })];
  kids.push(group("Taillight_L", tail, { at: [ls(xl(tailX)), ls(yl(tailY)), `${ls(lr.Zl)} + 0.025`], rotate: [-lr.pitch, 180 - lr.yaw, 0], mirror: "Taillight_R" }));
  if (st.tails === "bar") {
    const c = onFront(0, lampRY, true);
    kids.push(box("TailStrip", ["$W2 * 1.0", 0.025, 0.05], { at: [0, ls(yl(lampRY)), `${ls(c.Zl)} + 0.012`], material: "lamp_red" }));
  }

  // Bumpers: wrap-around bands lofted across the nose and the tail, following the surface.
  const bumperBand = (name: string, y0: number, y1: number, prot: number, xfrac: number, mat: string, rear: boolean, sink = 0.04): SpecNode => {
    const n = 15;
    const rr = B.ringDef(rear ? 4.3 : 0.7).filter((p) => p[0] > 0);
    const halfAt = (y: number) => { const c = rr.filter((p) => Math.abs(p[1] - y) < 0.06).map((p) => p[0]); return c.length ? Math.max(...c) : W2; };
    const xb = Math.min(W2 * xfrac, Math.min(halfAt(y0), halfAt(y1)) - 0.05);
    const ys = [y0, y0 + (y1 - y0) * 0.12, y0 + (y1 - y0) * 0.5, y0 + (y1 - y0) * 0.88, y1];
    const bulge = [0.55, 0.92, 1, 0.92, 0.55];
    const secs = Array.from({ length: n }, (_, i) => {
      const X = -xb + (2 * xb * i) / (n - 1);
      const taper = 1 - Math.pow(Math.abs(X) / xb, 4) * 0.8;
      const sg = rear ? -1 : 1;
      const zf = ys.map((y) => ev(B.Z(B.surfaceS(Math.abs(X), y, rear))));
      const zBack = rear ? Math.max(...zf) + sink : Math.min(...zf) - sink;
      const pts: [Num, Num][] = ys.map((y, k) => [ls(lscale(L(0, { L2: zf[k]! / env.L2! }), -1) as Lin), ls(yl(y))]).map(([z, y], k) => [`${z} - ${f(sg * prot * taper * bulge[k]!)}`, y] as [Num, Num]);
      pts.push([ls(L(0, { L2: -zBack / env.L2! })), ls(yl(y1 - 0.004))], [ls(L(0, { L2: -zBack / env.L2! })), ls(yl(y0 + 0.004))]);
      return { z: ls(xl(X)), points: pts };
    });
    return loft(name, secs, { material: mat, rotate: [0, 90, 0] });
  };
  const yBot0 = ev(B.bottom(0.25));
  const yBot5 = ev(B.bottom(4.75));
  const sillY = ev(B.sill);
  const frontZ = (x: number, y: number) => B.Z(B.surfaceS(x, y));
  const rearZ = (x: number, y: number) => B.Z(B.surfaceS(x, y, true));
  let plateFY: number, plateRY: number;
  if (st.bumper === "chrome") {
    const y0 = Math.max(yBot0, sillY) + 0.02, y1 = y0 + 0.13;
    kids.push(bumperBand("BumperFront", y0, y1, 0.07, 0.94, "chrome", false));
    const r0 = Math.max(yBot5, sillY) + 0.04;
    kids.push(bumperBand("BumperRear", r0, r0 + 0.13, 0.06, 0.94, "chrome", true));
    plateFY = y1 + 0.07; plateRY = st.trunk === "bed" ? r0 + 0.22 : lampRY - 0.09;
    if (st.trunk === "bed") plateRY = r0 + 0.065;
  } else if (st.bumper === "black") {
    const y0 = yBot0 + 0.01, y1 = y0 + 0.2;
    kids.push(bumperBand("BumperFront", y0, y1, 0.035, 0.93, "trim_black", false));
    kids.push(bumperBand("BumperRear", yBot5 + 0.01, yBot5 + 0.2, 0.03, 0.93, "trim_black", true));
    const zs = frontZ(0, y0 + 0.03);
    kids.push(box("SkidPlate", ["$W2 * 0.8", 0.05, 0.16], { at: [0, ls(yl(y0 + 0.03)), `${ls(zs)} - 0.02`], rotate: [12, 0, 0], bevel: 0.015, material: "aluminium" }));
    plateFY = y1 + 0.1; plateRY = yBot5 + 0.28;
  } else {
    // Body-colour bumper skins with a lower intake, a black splitter lip and a rear diffuser.
    const y0 = yBot0 + 0.005, y1 = lampFY0 - 0.02;
    kids.push(bumperBand("BumperFront", y0, y1, 0.012, 0.95, "body_paint", false));
    const r0 = yBot5 + 0.005, r1 = Math.min(lampRY - 0.09, r0 + 0.32);
    kids.push(bumperBand("BumperRear", r0, r1, 0.012, 0.95, "body_paint", true));
    kids.push(bumperBand("Splitter", y0 - 0.004, y0 + 0.04, 0.03, 0.82, "trim_black", false, 0.06));
    kids.push(bumperBand("Diffuser", r0 - 0.004, r0 + 0.07, 0.025, 0.8, "trim_black", true, 0.06));
    const yi = y0 + 0.1;
    const zi = frontZ(0, yi);
    kids.push(group("Intake", [
      box("Frame", ["$W2 * 0.95", 0.12, 0.08], { bevel: 0.03, material: "trim_black" }),
      box("Slat_{i}", ["$W2 * 0.9", 0.008, 0.02], { at: [0, -0.04, 0.035], repeat: { count: 4, step: [0, 0.027, 0] }, material: "satin_black" }),
      box("Fog_L", [0.1, 0.04, 0.03], { at: ["$W2 * 0.55", 0, 0.03], bevel: 0.01, material: "lamp_lens", mirror: "Fog_R" }),
    ], { at: [0, ls(yl(yi)), `${ls(zi)} - 0.02`] }));
    plateFY = yi + 0.11; plateRY = Math.min(lampRY - 0.13, r1 - 0.02);
    if (st.trunk !== "gate") plateRY = r1 - 0.09;
  }

  // Grille between the headlamps.
  if (st.lamps === "round") {
    const yg = lampFY - 0.06;
    kids.push(group("Grille", [
      box("Frame", ["$W2 * 0.72", 0.22, 0.06], { bevel: 0.025, material: "chrome" }),
      box("Bar_{i}", ["$W2 * 0.68", 0.012, 0.03], { at: [0, -0.085, 0.025], repeat: { count: 7, step: [0, 0.028, 0] }, material: "chrome" }),
    ], { at: [0, ls(yl(yg)), `${ls(frontZ(0, yg))} - 0.02`] }));
  } else {
    const big = st.bumper === "black" || st.trunk === "bed";
    let yg = lampFY - (big ? 0.06 : 0.03);
    // The grille stays in the face of the nose, under the bonnet's leading edge (lower on a low bonnet between wings).
    while (B.surfaceS(0, yg + (big ? 0.13 : 0.055)) > 0.06 && yg > lampFY0 - 0.25) yg -= 0.01;
    kids.push(group("Grille", [
      box("Frame", [`$W2 * ${big ? 0.95 : 0.62}`, big ? 0.24 : 0.09, 0.06], { bevel: 0.02, material: big && st.bumper === "chrome" ? "chrome" : "gloss_black" }),
      box("Mesh", [`$W2 * ${big ? 0.88 : 0.56}`, big ? 0.19 : 0.06, 0.03], { at: [0, 0, 0.012], material: "trim_black" }),
      box("Slat_{i}", [`$W2 * ${big ? 0.86 : 0.54}`, 0.01, 0.015], { at: [0, big ? -0.06 : -0.02, 0.03], repeat: { count: big ? 4 : 3, step: [0, big ? 0.04 : 0.02, 0] }, material: big ? "chrome" : "satin_black" }),
      box("Badge", [0.08, 0.04, 0.012], { at: [0, 0, 0.036], bevel: 0.006, material: "chrome" }),
    ], { at: [0, ls(yl(yg)), `${ls(frontZ(0, yg))} - 0.02`] }));
  }
  const zpf = frontZ(0, plateFY);
  kids.push(box("PlateFront", [0.52, 0.11, 0.012], { at: [0, ls(yl(plateFY)), `${ls(zpf)} + ${st.bumper === "chrome" ? 0.0 : 0.012}`], bevel: 0.004, material: "plate" }));
  const zpr = rearZ(0, plateRY);
  kids.push(box("PlateRear", [0.52, 0.11, 0.012], { at: [0, ls(yl(plateRY)), `${ls(zpr)} - 0.012`], bevel: 0.004, material: "plate" }));
  kids.push(cyl("Exhaust", 0.035, 0.16, { axis: "z", at: ["$W2 * 0.55", ls(yl(yBot5 + 0.03)), `${ls(rearZ(W2 * 0.55, yBot5 + 0.06))} + 0.02`], segments: 14, material: "chrome" }));

  // Tailgate (hatch, estate, SUV, MPV): a panel between the rear window and the bumper; pickup: the bed and its gate.
  if (st.trunk === "gate") {
    const yA = st.upper.find((p) => p[2] === "trunkF")![1] * Hd - 0.02, yZ = (st.bumper === "body" ? Math.min(lampRY - 0.09, yBot5 + 0.325) : yBot5 + 0.2) + 0.02;
    const zA = rearZ(0, yA), zZ = rearZ(0, yZ);
    const dz = ev(zZ) - ev(zA), dy = yZ - yA;
    const len = Math.hypot(dz, dy);
    const ang = (Math.atan2(-dy, dz) * 180) / Math.PI;
    const sT = B.sAt(-0.96);
    const half = ev(B.section(sT).xe) * 0.86;
    kids.push(group("Trunk", [
      box("Panel", [ls(xl(2 * half)), 0.02, len], { at: [0, -0.006, len / 2], bevel: 0.008, material: "body_paint" }),
      box("Gap", [ls(ladd(xl(2 * half), L(0.012))), 0.02, len + 0.008], { at: [0, -0.0035, len / 2], material: "panel_gap" }),
      box("Handle", [0.24, 0.03, 0.03], { at: [0, -0.02, Math.min(0.12, len * 0.3)], material: "chrome", bevel: 0.008 }),
    ], { at: [0, ls(yl(yA)), `${ls(zA)} - 0.008`], rotate: [ang, 0, 0] }));
  } else if (st.trunk === "bed") {
    const floor = st.bed![0] * Hd;
    const yTop = st.upper.find((p) => p[2] === "trunkF")![1] * Hd - 0.03;
    const sT = B.sAt(-0.98);
    const half = ev(B.section(sT).xe) - 0.02;
    kids.push(box("BedLiner", [ls(xl(2 * half - 0.12)), 0.02, `${f(0.98 + st.bed![1])} * $L2 - 0.06`], { at: [0, ls(yl(floor + 0.008)), `${f((st.bed![1] - 0.98) / 2)} * $L2`], material: "trim_black" }));
    kids.push(tube("BedRail_L", [[ls(xl(half - 0.02)), ls(yl(yTop + 0.03)), `${f(st.bed![1] - 0.01)} * $L2`], [ls(xl(half - 0.02)), ls(yl(yTop + 0.03)), "-$L2 * 0.985"]], 0.022, { material: "trim_black", segments: 8, mirror: "BedRail_R" }));
    const zg = B.Z(5);
    kids.push(group("Trunk", [
      box("Panel", [ls(xl(2 * half - 0.04)), yTop - floor, 0.03], { at: [0, (yTop - floor) / 2, -0.012], bevel: 0.01, material: "body_paint" }),
      box("Handle", [0.26, 0.05, 0.03], { at: [0, (yTop - floor) * 0.78, -0.03], material: "chrome", bevel: 0.008 }),
    ], { at: [0, ls(yl(floor)), ls(zg)] }));
  }
  if (st.spoiler) {
    const tr = st.upper.find((p) => p[2] === "trunkR")!;
    kids.push(group("Spoiler", [
      box("Wing", ["$W2 * 1.5", 0.025, 0.2], { at: [0, 0.075, 0], rotate: [-6, 0, 0], bevel: 0.01, material: "carbon" }),
      box("Stand_L", [0.03, 0.09, 0.06], { at: ["$W2 * 0.55", 0.03, 0], material: "carbon", mirror: "Stand_R" }),
    ], { at: [0, ls(L(0, { H: tr[1] })), `${f(tr[0])} * $L2 + 0.12`] }));
  }

  // Side: sill trim (black cladding on SUVs), wheel-arch lips that follow the arch and the side.
  const black = st.bumper === "black" || st.trunk === "bed";
  {
    const s1 = 2.08, s2 = 2.92;
    const yS = sillY + 0.07;
    kids.push(tube("Sill_L", [[ls(ladd(B.sideX(s1, yS), L(0.004))), ls(yl(yS)), ls(B.Z(s1))], [ls(ladd(B.sideX(2.5, yS), L(0.004))), ls(yl(yS)), ls(B.Z(2.5))], [ls(ladd(B.sideX(s2, yS), L(0.004))), ls(yl(yS)), ls(B.Z(s2))]], black ? 0.05 : 0.022, { material: black ? "trim_black" : "satin_black", segments: 8, mirror: "Sill_R" }));
  }
  for (const [n, base] of [["ArchFlare_FL", 1], ["ArchFlare_RL", 3]] as [string, number][]) {
    const arc = Array.from({ length: 13 }, (_, i) => {
      const u = 0.04 + (0.92 * i) / 12;
      const s = base + u;
      const S = B.section(s);
      const th = B.th(u);
      const r = 0.012;
      return [ls(ladd(S.pts[2]![0], L(black ? 0.014 : 0.002))), ls(L(Math.sin(th) * r, { wr: 1, Ra: Math.sin(th) })), ls(ladd(B.Z(s), L(Math.cos(th) * r)))] as [Num, Num, Num];
    });
    kids.push(tube(n, arc, black ? 0.034 : 0.02, { segments: 8, material: black ? "trim_black" : "body_paint", mirror: n.replace("L", "R") }));
  }

  // Mirrors at the foot of the A pillar, wipers at the foot of the windscreen.
  const g0 = gl[0]!;
  const sM = B.sAt((ev(g0.z) - 0.15) / env.L2!);
  kids.push(group("Mirror_L", [
    box("Arm", [0.12, 0.03, 0.07], { at: [0.04, 0, 0], bevel: 0.01, material: "trim_black" }),
    ellipsoid("Housing", [0.1, 0.065, 0.06], { at: [0.13, 0.04, 0], segments: 14, material: st.bumper === "chrome" ? "chrome" : roofMat === "carbon" ? "carbon" : "body_paint" }),
    ellipsoid("Face", [0.088, 0.054, 0.012], { at: [0.13, 0.04, -0.05], segments: 12, material: "chrome" }),
    box("Repeater", [0.05, 0.012, 0.03], { at: [0.15, 0.0, 0.03], material: "lamp_amber" }),
  ], { at: [ls(ladd(B.section(sM).xe, L(-0.03))), ls(ladd(yb, L(0.03))), ls(B.Z(sM))], mirror: "Mirror_R" }));
  kids.push(box("Wiper_L", ["$W2 * 0.5", 0.012, 0.02], { at: ["$W2 * 0.28", ls(ladd(yb, L(0.0))), `${ls(g0.z)} - 0.05`], rotate: [0, -6, 3], material: "trim_black", mirror: "Wiper_R" }));

  // Interior: seats and a dashboard behind the glass, the steering wheel on the left (+x).
  const up = key === "vintage" || (key === "sports" && fin.name === "white") || (key === "coupe" && fin.name === "silver") ? "upholstery_tan" : "upholstery";
  const seat = (name: string, x: Num, z: Num, mirror?: string): SpecNode => group(name, [
    box("Cushion", [0.5, 0.14, 0.5], { at: [0, 0, 0.22], bevel: 0.04 }),
    box("Back", [0.48, 0.6, 0.13], { at: [0, 0.3, -0.04], rotate: [-14, 0, 0], bevel: 0.04 }),
    box("Headrest", [0.26, 0.15, 0.09], { at: [0, 0.66, -0.12], rotate: [-10, 0, 0], bevel: 0.03 }),
  ], { at: [x, "$yb - 0.28", z], material: up, ...(mirror ? { mirror } : {}) });
  const interior: SpecNode[] = [seat("Seat_FL", "$wb * 0.48", `${f(st.seats.front)} * $L2`, "Seat_FR")];
  if (st.seats.rear !== undefined) {
    interior.push(group("RearBench", [
      box("Cushion", ["2 * $wb - 0.15", 0.14, 0.48], { at: [0, 0, 0.2], bevel: 0.04 }),
      box("Back", ["2 * $wb - 0.15", 0.56, 0.13], { at: [0, 0.28, -0.04], rotate: [-16, 0, 0], bevel: 0.04 }),
      box("Headrest_{i}", [0.24, 0.13, 0.08], { at: ["-$wb * 0.48", 0.6, -0.12], repeat: { count: 2, step: ["$wb * 0.96", 0, 0] }, bevel: 0.03 }),
    ], { at: [0, "$yb - 0.28", `${f(st.seats.rear)} * $L2`], material: up }));
  }
  const zDash = `${ls(g0.z)} - 0.12`;
  interior.push(box("Dash", ["2 * $wb - 0.04", 0.14, 0.32], { at: [0, "$yb - 0.02", zDash], bevel: 0.04, material: "trim_black" }));
  kids.push(group("Interior", interior, { material: up }));
  kids.push(group("SteeringWheel", [
    lathe("Rim", ringProfile(0.18, 0.016, 8), { segments: 20, caps: false, material: "trim_black" }),
    box("Spokes", [0.33, 0.02, 0.05], { material: "trim_black" }),
    cyl("Boss", 0.055, 0.05, { segments: 16, material: "trim_black" }),
  ], { at: ["$wb * 0.48", "$yb + 0.1", `${zDash} - 0.32`], rotate: [-62, 0, 0] }));

  // Wheels at the hubs, outer face out.
  const wo = { r: "$wr", w: f(tw), style: fin.wheel, rim: fin.rim ?? (fin.wheel === "steel" ? "steel_wheel" : fin.wheel === "chrome" || fin.wheel === "wire" ? "chrome" : "alloy"), hub: fin.wheel === "alloy" ? "gloss_black" : fin.wheel === "chrome" ? "alloy" : "chrome", ...(fin.spokes ? { spokes: fin.spokes } : {}), ...(fin.roof === "whitewall" || key === "vintage" ? { whitewall: "whitewall" } : {}) } as const;
  const wx = `$W2 - ${f(tw / 2 + 0.008)}`;
  kids.push(group("Wheels", [
    wheel("Wheel_FL", [wx, "$wr", `${f(st.ff)} * $L2`], wo, { mirror: "Wheel_FR" }),
    wheel("Wheel_RL", [wx, "$wr", `-${f(st.fr)} * $L2`], wo, { mirror: "Wheel_RR" }),
  ]));
  if (fin.wheel === "alloy") {
    const cal = key === "sports" || key === "coupe" ? "caliper" : "alloy_dark";
    for (const [n, z] of [["Caliper_FL", st.ff], ["Caliper_RL", -st.fr]] as [string, number][]) {
      kids.push(box(n, [0.045, "$wr * 0.2", "$wr * 0.34"], { at: [`${wx} - ${f(tw * 0.1)}`, "$wr * 1.4", `${f(z)} * $L2 - $wr * 0.12`], rotate: [-18, 0, 0], bevel: 0.012, material: cal, mirror: n.replace("L", "R") }));
    }
  }
  const nodes: SpecNode[] = [group("Car", kids, {
    vars: {
      L2: "$length / 2", W2: "$width / 2", H: "$height", wr: "$wheelRadius", Ra: B.raExpr(),
      ys: `$wheelRadius - ${f(Math.sin(st.a0))} * $Ra`,
      yb: `$height * ${f(st.belt)}`, wb: `$width / 2 - ${f(0.1 + st.shelf)}`,
    },
  })];

  const roofText = fin.roof === "gloss_black" || fin.roof === "carbon" ? `, a contrasting ${fin.roof === "carbon" ? "carbon" : "black"} roof` : "";
  const mats2: Record<string, MaterialDef> = { body_paint: fin.paint, ...mats("aluminium", "chrome"), ...WHEEL_MATS() };
  for (const k of ["tinted_glass", "trim_black", "satin_black", "gloss_black", "rubber_seal", "panel_gap", "lamp_lens", "lamp_glass", "reflector", "lamp_red", "lamp_amber", "plate", "upholstery", "upholstery_tan", "carbon", "whitewall", "caliper", "alloy_dark"]) mats2[k] = VMATS[k]!;
  return {
    slug: slugify("car", st.name, fin.name),
    title: `${fin.name.charAt(0).toUpperCase()}${fin.name.slice(1)} ${st.name}`,
    description: `A ${fin.name} ${st.name}: ${st.text}, ${st.doors} doors, a hood and ${st.trunk === "lid" ? "boot lid" : "tailgate"} on hinges, ${fin.wheel === "wire" ? "wire" : fin.wheel === "steel" ? "steel" : fin.wheel === "chrome" ? "chrome-capped" : "alloy"} wheels with the pivot at the hub${roofText}. It faces +z.`,
    tags: [st.name.toLowerCase(), fin.name, fin.nl, fin.wheel === "alloy" ? "alloy wheels" : `${fin.wheel} wheels`, `${st.doors}-door`],
    params: [
      num("length", st.length[0], st.length[1], st.length[2], "Body length in metres, bumper to bumper."),
      num("width", st.width[0], st.width[1], st.width[2], "Body width in metres (without mirrors)."),
      num("height", st.height[0], st.height[1], st.height[2], "Height of the roof in metres."),
      num("wheelRadius", st.wheel[0], st.wheel[1], st.wheel[2], "Tyre radius in metres."),
    ],
    materials: mats2,
    nodes,
  };
}

export const car: Family = {
  id: "car",
  category: "vehicles",
  archetype: "vehicle.wheeled.car",
  tags: ["car", "auto", "personenauto", "vehicle", "voertuig", "automobile", "wagen"],
  assets: () => Object.entries(STYLES).flatMap(([key, st]) => FINISHES[key]!.map((fin) => buildCar(key, st, fin))),
};
