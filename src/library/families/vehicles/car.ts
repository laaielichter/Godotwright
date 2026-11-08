import { box, cyl, ellipsoid, group, lathe, loft, num, slugify, tube, type AssetDraft, type Family, type Num, type SpecNode } from "../../kit.js";
import { mats, type MaterialDef } from "../../palette.js";
import { carPaint, f, L, ladd, lerpL, lev, ls, lscale, ringProfile, VMATS, wheel, WHEEL_MATS, type Lin, type WheelStyle } from "./parts.js";

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
  /** The body side silhouette from the front bottom over the top to the rear bottom (arches are added). */
  upper: Pt[];
  belt: number;
  /** Greenhouse sections: [z fraction, 0 = belt .. 1 = roof]. */
  glass: [number, number][];
  /** Inset of the greenhouse from the body side, metres. */
  gin: number;
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
  /** How far the side glass leans in, per metre of greenhouse height (default 0.3). */
  tumble?: number;
  spoiler?: boolean;
}

// Proportions after real cars: big wheels that fill the arches, a low stance (sill 0.12-0.16 m on cars, more on SUVs and
// pickups), a bonnet that drops to the nose, a raked windscreen (about 30-35 degrees on saloons, steeper on vans and SUVs)
// and a greenhouse that leans in over the shoulders.
const STYLES: Record<string, CarStyle> = {
  hatchback: {
    name: "hatchback", text: "a compact five-door hatchback with a short nose and a steep tailgate",
    length: [4.0, 3.6, 4.35], width: [1.76, 1.66, 1.84], height: [1.48, 1.42, 1.56], wheel: [0.32, 0.3, 0.34],
    ff: 0.67, fr: 0.68, a0: 0.52, tyreW: 0.21,
    upper: [[0.965, 0.11], [0.995, 0.2], [1.0, 0.3, "lampF"], [0.98, 0.39], [0.92, 0.46, "hoodF"], [0.45, 0.575, "hoodR"], [0.0, 0.6], [-0.5, 0.615], [-0.93, 0.63, "trunkF"], [-0.985, 0.5, "lampR"], [-1.0, 0.36, "trunkR"], [-0.995, 0.22], [-0.965, 0.11]],
    belt: 0.6, glass: [[0.45, 0.04], [0.33, 0.48], [0.18, 0.88], [0.06, 1], [-0.72, 1], [-0.82, 0.9], [-0.88, 0.5], [-0.92, 0.04]], gin: 0.12, roof: [0.06, -0.73],
    doors: 4, doorZ: [0.36, -0.06, -0.5], trunk: "gate", lamps: "slim", tails: "tall", bumper: "body", seats: { front: -0.1, rear: -0.55 },
  },
  sedan: {
    name: "sedan", text: "a four-door saloon with a separate boot and a sloping rear window",
    length: [4.65, 4.3, 5.0], width: [1.82, 1.74, 1.9], height: [1.45, 1.4, 1.52], wheel: [0.335, 0.31, 0.36],
    ff: 0.65, fr: 0.6, a0: 0.5, tyreW: 0.225,
    upper: [[0.975, 0.12], [0.998, 0.22], [1.0, 0.32, "lampF"], [0.985, 0.4], [0.95, 0.46, "hoodF"], [0.42, 0.575, "hoodR"], [0.1, 0.59], [-0.3, 0.6], [-0.63, 0.612, "trunkF"], [-0.95, 0.625, "trunkR"], [-0.995, 0.56], [-1.0, 0.46, "lampR"], [-0.99, 0.28], [-0.965, 0.12]],
    belt: 0.6, glass: [[0.42, 0.04], [0.3, 0.48], [0.15, 0.88], [0.04, 1], [-0.3, 1], [-0.44, 0.84], [-0.55, 0.45], [-0.63, 0.04]], gin: 0.13, roof: [0.04, -0.31],
    doors: 4, doorZ: [0.34, -0.04, -0.4], trunk: "lid", lamps: "slim", tails: "corner", bumper: "body", seats: { front: -0.04, rear: -0.38 },
  },
  estate: {
    name: "estate", text: "a long estate car with a flat roof that runs to an upright tailgate",
    length: [4.75, 4.45, 5.0], width: [1.82, 1.75, 1.9], height: [1.48, 1.42, 1.56], wheel: [0.335, 0.31, 0.36],
    ff: 0.65, fr: 0.6, a0: 0.48, tyreW: 0.225,
    upper: [[0.975, 0.12], [0.998, 0.22], [1.0, 0.32, "lampF"], [0.985, 0.4], [0.95, 0.46, "hoodF"], [0.44, 0.57, "hoodR"], [0.0, 0.59], [-0.6, 0.605], [-0.95, 0.62, "trunkF"], [-0.99, 0.5, "lampR"], [-1.0, 0.38, "trunkR"], [-0.995, 0.23], [-0.965, 0.12]],
    belt: 0.59, glass: [[0.44, 0.04], [0.32, 0.48], [0.17, 0.88], [0.06, 1], [-0.8, 1], [-0.88, 0.85], [-0.92, 0.45], [-0.94, 0.04]], gin: 0.13, roof: [0.06, -0.83],
    doors: 4, doorZ: [0.36, -0.02, -0.38], trunk: "gate", lamps: "slim", tails: "tall", bumper: "body", seats: { front: -0.06, rear: -0.4 }, rails: true,
  },
  suv: {
    name: "SUV", text: "a tall SUV with high ground clearance, black wheel-arch trims and roof rails",
    length: [4.6, 4.3, 4.95], width: [1.9, 1.82, 2.0], height: [1.72, 1.64, 1.86], wheel: [0.375, 0.35, 0.4],
    ff: 0.66, fr: 0.66, a0: 0.36, tyreW: 0.25,
    upper: [[0.97, 0.15], [0.995, 0.25], [1.0, 0.37, "lampF"], [0.985, 0.45], [0.94, 0.51, "hoodF"], [0.46, 0.595, "hoodR"], [0.0, 0.615], [-0.6, 0.625], [-0.93, 0.635, "trunkF"], [-0.985, 0.52, "lampR"], [-1.0, 0.4, "trunkR"], [-0.995, 0.26], [-0.97, 0.15]],
    belt: 0.62, glass: [[0.46, 0.04], [0.36, 0.48], [0.23, 0.88], [0.13, 1], [-0.76, 1], [-0.85, 0.88], [-0.9, 0.45], [-0.93, 0.04]], gin: 0.13, roof: [0.13, -0.78],
    doors: 4, doorZ: [0.37, -0.04, -0.47], trunk: "gate", lamps: "square", tails: "tall", bumper: "black", seats: { front: -0.04, rear: -0.48 }, rails: true,
  },
  pickup: {
    name: "pickup", text: "a double-cab pickup with a long bonnet and an open load bed behind the cab",
    length: [5.2, 4.95, 5.3], width: [1.9, 1.84, 2.0], height: [1.8, 1.74, 1.9], wheel: [0.39, 0.37, 0.41],
    ff: 0.66, fr: 0.6, a0: 0.3, tyreW: 0.26,
    upper: [[0.97, 0.16], [0.995, 0.28], [1.0, 0.42, "lampF"], [0.99, 0.5], [0.95, 0.55, "hoodF"], [0.5, 0.6, "hoodR"], [0.0, 0.605], [-0.2, 0.61], [-0.21, 0.52], [-0.985, 0.52, "trunkF"], [-1.0, 0.5, "lampR"], [-1.0, 0.28], [-0.97, 0.16]],
    belt: 0.6, glass: [[0.5, 0.04], [0.41, 0.45], [0.3, 0.86], [0.2, 1], [-0.17, 1], [-0.19, 0.6], [-0.2, 0.04]], gin: 0.13, roof: [0.2, -0.18], tumble: 0.22,
    doors: 4, doorZ: [0.4, 0.06, -0.19], trunk: "bed", lamps: "square", tails: "tall", bumper: "chrome", seats: { front: 0.12, rear: -0.14 },
  },
  coupe: {
    name: "coupe", text: "a low two-door coupe with a long door and a fastback roofline",
    length: [4.5, 4.2, 4.8], width: [1.84, 1.76, 1.92], height: [1.38, 1.33, 1.45], wheel: [0.335, 0.31, 0.36],
    ff: 0.66, fr: 0.62, a0: 0.55, tyreW: 0.245,
    upper: [[0.975, 0.11], [0.998, 0.2], [1.0, 0.31, "lampF"], [0.985, 0.38], [0.95, 0.43, "hoodF"], [0.32, 0.57, "hoodR"], [0.0, 0.585], [-0.5, 0.6], [-0.7, 0.61, "trunkF"], [-0.96, 0.625, "trunkR"], [-0.995, 0.56], [-1.0, 0.46, "lampR"], [-0.99, 0.27], [-0.965, 0.11]],
    belt: 0.6, glass: [[0.32, 0.04], [0.2, 0.45], [0.06, 0.88], [-0.05, 1], [-0.25, 1], [-0.42, 0.78], [-0.58, 0.4], [-0.71, 0.04]], gin: 0.14, roof: [-0.05, -0.27],
    doors: 2, doorZ: [0.33, -0.22], trunk: "lid", lamps: "slim", tails: "bar", bumper: "body", seats: { front: -0.14, rear: -0.44 }, spoiler: true,
  },
  mpv: {
    name: "MPV", text: "a tall people carrier with a short nose, a long steep windscreen and a boxy cabin",
    length: [4.6, 4.3, 4.9], width: [1.86, 1.78, 1.95], height: [1.76, 1.66, 1.86], wheel: [0.335, 0.31, 0.35],
    ff: 0.68, fr: 0.7, a0: 0.45, tyreW: 0.22,
    upper: [[0.97, 0.12], [0.995, 0.22], [1.0, 0.31, "lampF"], [0.98, 0.39], [0.92, 0.45, "hoodF"], [0.66, 0.52, "hoodR"], [0.3, 0.55], [-0.5, 0.56], [-0.95, 0.57, "trunkF"], [-0.99, 0.46, "lampR"], [-1.0, 0.34, "trunkR"], [-0.995, 0.23], [-0.965, 0.12]],
    belt: 0.55, glass: [[0.66, 0.04], [0.54, 0.4], [0.38, 0.84], [0.26, 1], [-0.84, 1], [-0.9, 0.85], [-0.93, 0.45], [-0.95, 0.04]], gin: 0.13, roof: [0.26, -0.86],
    doors: 4, doorZ: [0.39, 0.0, -0.45], trunk: "gate", lamps: "slim", tails: "tall", bumper: "body", seats: { front: 0.1, rear: -0.38 }, rails: true,
  },
  sports: {
    name: "sports car", text: "a low, wide mid-engined sports car with a cab-forward canopy and a rear spoiler",
    length: [4.4, 4.1, 4.65], width: [1.92, 1.85, 2.0], height: [1.3, 1.27, 1.36], wheel: [0.335, 0.31, 0.345],
    ff: 0.68, fr: 0.64, a0: 0.62, tyreW: 0.28,
    upper: [[0.975, 0.09], [0.998, 0.18], [1.0, 0.27], [0.985, 0.37, "lampF"], [0.95, 0.47, "hoodF"], [0.45, 0.6, "hoodR"], [0.0, 0.62], [-0.4, 0.625], [-0.48, 0.635, "trunkF"], [-0.95, 0.65, "trunkR"], [-0.995, 0.59], [-1.0, 0.47, "lampR"], [-0.99, 0.23], [-0.965, 0.09]],
    belt: 0.62, glass: [[0.45, 0.04], [0.3, 0.45], [0.14, 0.88], [0.04, 1], [-0.18, 1], [-0.32, 0.72], [-0.42, 0.35], [-0.48, 0.04]], gin: 0.17, roof: [0.04, -0.2],
    doors: 2, doorZ: [0.34, -0.2], trunk: "lid", lamps: "slim", tails: "bar", bumper: "body", seats: { front: -0.08 }, spoiler: true,
  },
  vintage: {
    name: "vintage", text: "a 1950s-style saloon with round headlamps, chrome bumpers, whitewall tyres and chrome hubcaps",
    length: [4.6, 4.3, 5.0], width: [1.8, 1.7, 1.9], height: [1.56, 1.5, 1.65], wheel: [0.355, 0.34, 0.38],
    ff: 0.62, fr: 0.6, a0: 0.4, tyreW: 0.19,
    upper: [[0.96, 0.15], [0.99, 0.25], [1.0, 0.35], [0.99, 0.41, "lampF"], [0.95, 0.48, "hoodF"], [0.38, 0.565, "hoodR"], [0.0, 0.575], [-0.32, 0.58], [-0.55, 0.585, "trunkF"], [-0.92, 0.54, "trunkR"], [-0.975, 0.48], [-0.995, 0.4, "lampR"], [-0.995, 0.28], [-0.96, 0.15]],
    belt: 0.57, glass: [[0.38, 0.04], [0.3, 0.45], [0.22, 0.86], [0.14, 1], [-0.22, 1], [-0.34, 0.85], [-0.46, 0.45], [-0.56, 0.04]], gin: 0.13, roof: [0.14, -0.24],
    doors: 4, doorZ: [0.34, -0.02, -0.37], trunk: "lid", lamps: "round", tails: "round", bumper: "chrome", seats: { front: 0.0, rear: -0.34 },
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

/** Body sections across the width: [distance in from the side, inset of the silhouette]; the shoulders round off. */
const EDGE: [number, number][] = [[0, 0.085], [0.01, 0.062], [0.03, 0.036], [0.065, 0.016], [0.12, 0.004], [0.19, 0]];

const zl = (z: number): Lin => L(0, { L2: z });
const yl = (y: number): Lin => L(0, { H: y });

function buildCar(key: string, st: CarStyle, fin: Finish, idx: number): AssetDraft {
  const env = { L2: st.length[0] / 2, W2: st.width[0] / 2, H: st.height[0], wr: st.wheel[0] };
  // The side silhouette: the upper line, then the rear arch and the front arch along the bottom.
  // The silhouette height over an axle (z as a fraction of the half length), along the top of the outline.
  const yAt = (zf: number): Lin => {
    for (let i = 1; i + 2 < st.upper.length; i++) {
      const a = st.upper[i]!, b = st.upper[i + 1]!;
      if ((a[0] - zf) * (b[0] - zf) <= 0 && a[0] !== b[0]) return yl(a[1] + ((zf - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
    }
    throw new Error(`car ${key}: no silhouette over ${zf}`);
  };
  // The arch radius never reaches into the hood line: the arch stays 6 cm under it, and the shoulders are 4 cm lower at the side.
  const room = (zf: number): string => `${ls(yAt(zf))} - 0.07 - $wheelRadius`;
  const raExpr = `min($wheelRadius + 0.03, ${room(st.ff)}, ${room(-st.fr)})`;
  const ra0 = Math.min(env.wr + 0.03, lev(yAt(st.ff), env) - 0.07 - env.wr, lev(yAt(-st.fr), env) - 0.07 - env.wr);
  const envR = { ...env, Ra: ra0 };
  const sill = L(0, { wr: 1, Ra: -Math.sin(st.a0) });
  // The first and last points (under the bumpers) sit a little above the sill line, so the bottom never folds.
  const pts: [Lin, Lin][] = st.upper.map(([z, y], i) => [zl(z), i === 0 || i === st.upper.length - 1 ? ladd(sill, L(0.035)) : yl(y)]);
  const N = 12;
  for (const [zc] of [[-st.fr], [st.ff]] as [number][]) {
    for (let k = 0; k <= N; k++) {
      const th = Math.PI + st.a0 - (k * (Math.PI + 2 * st.a0)) / N;
      const c = Math.cos(th), s = Math.sin(th);
      pts.push([L(0, { L2: zc, Ra: c }), L(0, { wr: 1, Ra: s })]);
    }
  }
  const tag = (t: string): [Lin, Lin] => {
    const i = st.upper.findIndex((p) => p[2] === t);
    if (i < 0) throw new Error(`car ${key}: no ${t}`);
    return pts[i]!;
  };
  // Outward normals at the defaults, for the rounded shoulders of the outer sections.
  const P2 = pts.map(([z, y]) => [lev(z, envR), lev(y, envR)] as [number, number]);
  let area = 0;
  P2.forEach((p, i) => { const q = P2[(i + 1) % P2.length]!; area += p[0] * q[1] - q[0] * p[1]; });
  const sgn = area >= 0 ? 1 : -1;
  const normals = P2.map((_, i) => {
    const a = P2[(i - 1 + P2.length) % P2.length]!, b = P2[(i + 1) % P2.length]!;
    const tz = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tz, ty) || 1;
    return [(sgn * ty) / l, (-sgn * tz) / l] as [number, number];
  });
  const span = (Math.max(...P2.map((p) => p[1])) - lev(sill, envR)) * 2;
  const section = (z: string, d: number) => ({
    z,
    points: pts.map(([pz, py], i) => {
      // Arch points move straight away from the hub (the lip flares); the rest along their normal, more at nose and tail.
      const k = i - st.upper.length;
      if (k >= 0) {
        const th = Math.PI + st.a0 - ((k % (N + 1)) * (Math.PI + 2 * st.a0)) / N;
        void th;
        return [ls(pz), ls(py)];
      }
      // Scaling toward the middle of the sill line can never fold the outline.
      return [ls(lscale(pz, 1 - (1.7 * d) / env.L2)), ls(ladd(lscale(py, 1 - d / span), lscale(sill, d / span)))];
    }),
  });
  const sections = [
    ...EDGE.map(([e, d]) => section(`-$W2 + ${f(e)}`, d)),
    ...[...EDGE].reverse().map(([e, d]) => section(`$W2 - ${f(e)}`, d)),
  ];

  const yb = `$yb`;
  const nodes: SpecNode[] = [];
  const kids: SpecNode[] = [];
  kids.push(loft("Body", sections, { material: "body_paint", rotate: [0, -90, 0] }));

  // Greenhouse: glass loft with tumblehome and rounded roof corners.
  const gsec = [...st.glass].sort((a, b) => a[0] - b[0]).map(([z, t]) => {
    const yT = `($yb + ${f(t)} * ($H - 0.035 - $yb))`;
    const h = `(${yT} - $yb + 0.05)`;
    const rc = `min(0.085, 0.4 * ${h})`;
    const wt = `($wb - ${f(st.tumble ?? 0.3)} * ${h})`;
    const pts2: [Num, Num][] = [[`$wb`, `$yb - 0.05`]];
    for (const a of [0, 30, 60, 90]) {
      const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
      pts2.push([`${wt} - ${rc} * ${f(1 - c)}`, `${yT} - ${rc} * ${f(1 - s)}`]);
    }
    for (const a of [90, 120, 150, 180]) {
      const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
      pts2.push([`-${wt} + ${rc} * ${f(1 + c)}`, `${yT} - ${rc} * ${f(1 - s)}`]);
    }
    pts2.push([`-$wb`, `$yb - 0.05`]);
    return { z: `${f(z)} * $L2`, points: pts2 };
  });
  kids.push(loft("Glass", gsec, { material: "tinted_glass" }));
  const roofMat = fin.roof ?? "body_paint";
  const [rz0, rz1] = st.roof;
  const rw = (dz: number, k: number) => ({ z: `${f(rz1 + (rz0 - rz1) * k)} * $L2 ${dz < 0 ? "-" : "+"} ${f(Math.abs(dz))}`, superellipse: { width: `2 * $wtop + ${f(dz === 0 ? 0.03 : 0.0)}`, height: dz === 0 ? 0.07 : 0.04, n: 5, count: 24, cy: `$H - ${dz === 0 ? 0.035 : 0.025}` } });
  kids.push(loft("Roof", [rw(-0.04, 0), rw(0, 0), rw(0, 0.5), rw(0, 1), rw(0.04, 1)], { material: roofMat }));

  // Pillars and window seals.
  const zws = st.glass[0]![0], zgr = st.glass[st.glass.length - 1]![0];
  const za = st.roof[0], zc = st.roof[1];
  kids.push(tube("PillarA_L", [[`$wb - 0.02`, `$yb - 0.01`, `${f(zws)} * $L2 - 0.02`], [`$wtop - 0.02`, `$H - 0.045`, `${f(za)} * $L2`]], 0.032, { material: roofMat, segments: 10, mirror: "PillarA_R" }));
  kids.push(tube("PillarC_L", [[`$wtop - 0.02`, `$H - 0.045`, `${f(zc)} * $L2`], [`$wb - 0.02`, `$yb - 0.01`, `${f(zgr)} * $L2 + 0.02`]], st.trunk === "lid" ? 0.06 : 0.045, { material: roofMat, segments: 10, mirror: "PillarC_R" }));
  kids.push(tube("Seal_L", [[`$wb + 0.004`, `$yb + 0.004`, `${f(zws)} * $L2 - 0.04`], [`$wb + 0.004`, `$yb + 0.004`, `${f(zgr)} * $L2 + 0.04`]], 0.012, { material: st.bumper === "chrome" ? "chrome" : "rubber_seal", segments: 8, mirror: "Seal_R" }));
  const zB = st.doorZ[1];
  kids.push(box("PillarB_L", [0.05, `$H - 0.04 - $yb`, 0.08], { at: [`($wb + $wtop) / 2 - 0.012`, `($H - 0.04 + $yb) / 2`, `${f(zB)} * $L2 - 0.02`], rotate: [0, 0, 12.4], material: "trim_black", mirror: "PillarB_R" }));
  if (st.rails) {
    kids.push(tube("RoofRail_L", [[`$wtop - 0.06`, `$H - 0.01`, `${f(za)} * $L2 - 0.02`], [`$wtop - 0.06`, `$H + 0.04`, `${f(za)} * $L2 - 0.1`], [`$wtop - 0.06`, `$H + 0.04`, `${f(zc)} * $L2 + 0.1`], [`$wtop - 0.06`, `$H - 0.01`, `${f(zc)} * $L2 + 0.02`]], 0.016, { material: "aluminium", segments: 8, mirror: "RoofRail_R" }));
  }

  // Doors: hinged on their front edge, the skin sits a few millimetres proud of the body side.
  const doorBot = `$ys + 0.05`, doorTop = `$yb - 0.07`;
  const door = (name: string, z0: Num, z1: Num, mirror: string): SpecNode =>
    group(name, [
      box("Skin", [0.028, `${doorTop} - (${doorBot})`, `${z0} - (${z1}) - 0.012`], { at: [-0.01, `(${doorTop} - (${doorBot})) / 2`, `-(${z0} - (${z1}) - 0.012) / 2`], bevel: 0.006, material: "body_paint" }),
      box("Gap", [0.026, `${doorTop} - (${doorBot}) + 0.01`, `${z0} - (${z1}) - 0.002`], { at: [-0.0115, `(${doorTop} - (${doorBot})) / 2`, `-(${z0} - (${z1}) - 0.012) / 2`], material: "panel_gap" }),
      // Shut lines at the leading and trailing edges, where the door meets the wing and the next panel.
      box("Seam_{i}", [0.008, `${doorTop} - (${doorBot}) - 0.03`, 0.005], { at: [0.007, `(${doorTop} - (${doorBot})) / 2 + 0.01`, 0.0], repeat: { count: 2, step: [0, 0, `-(${z0} - (${z1}) - 0.006)`] }, material: "panel_gap" }),
      box("Seal", [0.02, 0.012, `${z0} - (${z1}) - 0.03`], { at: [-0.012, `${doorTop} - (${doorBot}) + 0.012`, `-(${z0} - (${z1}) - 0.012) / 2`], material: st.bumper === "chrome" ? "chrome" : "rubber_seal" }),
      box("Handle", [0.03, 0.03, 0.17], { at: [0.008, `${doorTop} - (${doorBot}) - 0.12`, `-(${z0} - (${z1})) + 0.16`], bevel: 0.01, material: st.bumper === "chrome" ? "chrome" : "satin_black" }),
    ], { at: ["$W2 - 0.006", doorBot, z0], mirror });
  const frontEdge = `min(${f(st.doorZ[0])} * $L2, ${f(st.ff)} * $L2 - $Ra - 0.06)`;
  kids.push(door("Door_FL", frontEdge, `${f(zB)} * $L2`, "Door_FR"));
  if (st.doors === 4) kids.push(door("Door_RL", `${f(zB)} * $L2 - 0.008`, `max(${f(st.doorZ[2]!)} * $L2, -${f(st.fr)} * $L2 + $Ra + 0.05)`, "Door_RR"));

  // Hinged panels: a thin plate from the hinge (a) to its far edge (b), proud of the surface on the outside.
  const panel = (name: string, a: [Lin, Lin], b: [Lin, Lin], out: [number, number], width: Num, extra: SpecNode[] = []): SpecNode => {
    const dz = ladd(b[0], lscale(a[0], -1)), dy = ladd(b[1], lscale(a[1], -1));
    const vz = lev(dz, env), vy = lev(dy, env);
    const phi = Math.atan2(-vy, vz);
    // Local +y after the turn about x.
    const ly: [number, number] = [Math.cos(phi), Math.sin(phi)]; // (y, z)
    const sgn = ly[0] * out[0] + ly[1] * out[1] >= 0 ? 1 : -1;
    const len = `hypot(${ls(dz)}, ${ls(dy)})`;
    return group(name, [
      box("Panel", [width, 0.024, len], { at: [0, f(sgn * 0.004), `${len} / 2`], bevel: 0.008, material: "body_paint" }),
      box("Gap", [`${width} + 0.012`, 0.024, `${len} + 0.006`], { at: [0, f(sgn * 0.0015), `${len} / 2`], material: "panel_gap" }),
      ...extra,
    ], { at: [0, ls(a[1]), ls(a[0])], rotate: [`deg(atan2(-(${ls(dy)}), ${ls(dz)}))`, 0, 0] });
  };
  kids.push(panel("Hood", tag("hoodR"), tag("hoodF"), [1, 0], "$W2 * 1.56"));
  if (st.trunk === "lid") kids.push(panel("Trunk", tag("trunkF"), tag("trunkR"), [1, 0], "$W2 * 1.5"));
  else if (st.trunk === "gate") kids.push(panel("Trunk", tag("trunkF"), tag("trunkR"), [0, -1], "$W2 * 1.4", [box("Handle", [0.24, 0.03, 0.03], { at: [0, -0.012, 0.09], material: "chrome", bevel: 0.008 })]));
  else {
    // Pickup bed: floor at trunkF, side walls up to the belt, a tailgate hinged at the bottom.
    const [fz, fy] = tag("trunkF");
    const cab = "-0.21 * $L2";
    kids.push(box("BedSide_L", [0.055, `$yb - (${ls(fy)}) + 0.1`, `${cab} + $L2 - 0.03`], { at: ["$W2 - 0.03", `($yb + ${ls(fy)} - 0.1) / 2`, `(${cab} - $L2 + 0.03) / 2`], bevel: 0.01, material: "body_paint", mirror: "BedSide_R" }));
    kids.push(tube("BedRail_L", [["$W2 - 0.03", "$yb + 0.01", `${cab} - 0.02`], ["$W2 - 0.03", "$yb + 0.01", "-$L2 + 0.05"]], 0.03, { material: "trim_black", segments: 8, mirror: "BedRail_R" }));
    kids.push(box("BedFront", ["2 * $W2 - 0.08", `$yb - (${ls(fy)}) + 0.1`, 0.05], { at: [0, `($yb + ${ls(fy)} - 0.1) / 2`, `${cab} - 0.02`], bevel: 0.01, material: "body_paint" }));
    kids.push(box("BedLiner", ["2 * $W2 - 0.1", 0.02, `${cab} + $L2 - 0.12`], { at: [0, `${ls(fy)} + 0.005`, `(${cab} - $L2 + 0.05) / 2`], material: "trim_black" }));
    void fz;
    kids.push(group("Trunk", [
      box("Panel", ["2 * $W2 - 0.08", `$yb - (${ls(fy)})`, 0.05], { at: [0, `($yb - (${ls(fy)})) / 2`, -0.02], bevel: 0.01, material: "body_paint" }),
      box("Handle", [0.26, 0.04, 0.03], { at: [0, `($yb - (${ls(fy)})) * 0.8`, -0.05], material: "chrome", bevel: 0.008 }),
    ], { at: [0, ls(fy), "-$L2 - 0.005"] }));
  }

  // Lights.
  const [lfz, lfy] = tag("lampF");
  const [lrz, lry] = tag("lampR");
  // Headlamps: a dark housing, a chrome reflector bowl with a projector, a clear outer lens, and a DRL strip.
  const lampF: SpecNode[] = st.lamps === "round"
    ? [cyl("Bezel", 0.095, 0.08, { axis: "z", segments: 24, material: "chrome", bevel: 0.01 }), ellipsoid("Bowl", [0.078, 0.078, 0.03], { at: [0, 0, 0.03], segments: 18, material: "reflector" }), cyl("Bulb", 0.02, 0.04, { axis: "z", at: [0, 0, 0.045], segments: 12, material: "lamp_lens" }), ellipsoid("Lens", [0.082, 0.082, 0.035], { at: [0, 0, 0.042], segments: 18, material: "lamp_glass" })]
    : st.lamps === "square"
      ? [box("Housing", [0.32, 0.12, 0.1], { bevel: 0.02, material: "gloss_black" }), box("Bowl_{i}", [0.12, 0.08, 0.03], { at: [-0.07, 0.008, 0.04], repeat: { count: 2, step: [0.14, 0, 0] }, bevel: 0.012, material: "reflector" }), cyl("Bulb_{i}", 0.025, 0.03, { axis: "z", at: [-0.07, 0.008, 0.055], repeat: { count: 2, step: [0.14, 0, 0] }, segments: 12, material: "lamp_lens" }), box("Lens", [0.3, 0.1, 0.03], { at: [0, 0, 0.05], bevel: 0.012, material: "lamp_glass" }), box("Drl", [0.28, 0.012, 0.02], { at: [0, -0.05, 0.05], material: "lamp_lens" })]
      : [ellipsoid("Housing", [0.17, 0.055, 0.07], { segments: 16, material: "gloss_black" }), ellipsoid("Bowl", [0.11, 0.04, 0.05], { at: [-0.03, 0.002, 0.02], segments: 14, material: "reflector" }), cyl("Bulb", 0.022, 0.05, { axis: "z", at: [-0.03, 0.002, 0.04], segments: 12, material: "lamp_lens" }), box("Drl", [0.22, 0.01, 0.03], { at: [0, -0.034, 0.04], rotate: [0, 0, 0], material: "lamp_lens" }), ellipsoid("Lens", [0.165, 0.05, 0.06], { at: [0, 0, 0.022], segments: 16, material: "lamp_glass" }), box("Signal", [0.06, 0.02, 0.03], { at: [0.11, -0.012, 0.03], material: "lamp_amber" })];
  kids.push(group("Headlight_L", lampF, { at: ["$W2 * 0.66", ls(lfy), `${ls(lfz)} - 0.04`], rotate: [0, st.lamps === "round" ? 0 : 12, 0], mirror: "Headlight_R" }));
  const tail: SpecNode[] = st.tails === "round"
    ? [cyl("Lens", 0.06, 0.08, { axis: "z", segments: 20, material: "lamp_red", bevel: 0.01 }), cyl("Ring", 0.07, 0.05, { axis: "z", segments: 20, material: "chrome" })]
    : st.tails === "tall"
      ? [box("Lens", [0.1, 0.26, 0.08], { bevel: 0.02, material: "lamp_red" }), box("Reverse", [0.06, 0.05, 0.08], { at: [-0.015, -0.1, 0.008], material: "lamp_lens" })]
      : st.tails === "bar"
        ? [box("Lens", [0.32, 0.06, 0.08], { bevel: 0.02, material: "lamp_red" })]
        : [box("Lens", [0.28, 0.1, 0.08], { bevel: 0.02, material: "lamp_red" }), box("Amber", [0.1, 0.1, 0.08], { at: [-0.12, 0, 0.006], bevel: 0.015, material: "lamp_amber" })];
  const tx = st.tails === "bar" || st.tails === "corner" ? "$W2 * 0.7" : st.trunk === "bed" ? "$W2 - 0.03" : "$W2 * 0.8";
  kids.push(group("Taillight_L", tail, { at: [tx, ls(st.trunk === "bed" ? L(-0.18, { H: 0.6 }) : lry), `${ls(lrz)} + 0.02`], rotate: [0, 180, 0], mirror: "Taillight_R" }));
  if (st.tails === "bar") kids.push(box("TailStrip", ["$W2 * 1.0", 0.025, 0.04], { at: [0, ls(lry), `${ls(lrz)} - 0.005`], material: "lamp_red" }));

  // Front: grille, bumpers, plates.
  const grilleY = ls(ladd(lfy, L(-0.02)));
  if (st.lamps === "round") {
    kids.push(group("Grille", [
      box("Frame", ["$W2 * 0.75", 0.2, 0.06], { bevel: 0.025, material: "chrome" }),
      box("Bar_{i}", ["$W2 * 0.7", 0.012, 0.03], { at: [0, -0.08, 0.025], repeat: { count: 7, step: [0, 0.027, 0] }, material: "chrome" }),
    ], { at: [0, `${grilleY} - 0.04`, `$L2 - 0.03`] }));
  } else {
    kids.push(group("Grille", [
      box("Frame", [`$W2 * ${st.bumper === "black" || st.trunk === "bed" ? 0.9 : 0.62}`, st.trunk === "bed" ? 0.2 : 0.11, 0.06], { bevel: 0.02, material: "trim_black" }),
      box("Slat_{i}", [`$W2 * ${st.bumper === "black" || st.trunk === "bed" ? 0.84 : 0.56}`, 0.008, 0.015], { at: [0, -0.03, 0.028], repeat: { count: 4, step: [0, 0.02, 0] }, material: "chrome" }),
    ], { at: [0, grilleY, `${ls(lfz)} - 0.03`] }));
  }
  const bumperY0 = ls(yl(st.upper[0]![1]));
  if (st.bumper === "chrome") {
    kids.push(box("BumperFront", ["$W2 * 2 - 0.06", 0.12, 0.14], { at: [0, `${bumperY0} + 0.1`, "$L2 + 0.0"], bevel: 0.045, material: "chrome" }));
    kids.push(box("BumperRear", ["$W2 * 2 - 0.06", 0.12, 0.14], { at: [0, `${bumperY0} + 0.1`, "-$L2"], bevel: 0.045, material: "chrome" }));
  } else if (st.bumper === "black") {
    kids.push(box("BumperFront", ["$W2 * 2 - 0.1", 0.16, 0.12], { at: [0, `${bumperY0} + 0.08`, "$L2 - 0.02"], bevel: 0.04, material: "trim_black" }));
    kids.push(box("SkidPlate", ["$W2 * 0.9", 0.05, 0.14], { at: [0, `${bumperY0} + 0.02`, "$L2 - 0.06"], bevel: 0.015, material: "aluminium" }));
    kids.push(box("BumperRear", ["$W2 * 2 - 0.1", 0.16, 0.12], { at: [0, `${bumperY0} + 0.08`, "-$L2 + 0.02"], bevel: 0.04, material: "trim_black" }));
    kids.push(box("Cladding_L", [0.04, 0.12, `${f(st.ff + st.fr)} * $L2 - 2 * $Ra - 0.06`], { at: ["$W2 - 0.01", "$ys + 0.07", `${f((st.ff - st.fr) / 2)} * $L2`], bevel: 0.015, material: "trim_black", mirror: "Cladding_R" }));
  } else {
    kids.push(box("Intake", ["$W2 * 1.1", 0.08, 0.06], { at: [0, `${bumperY0} + 0.08`, "$L2 - 0.035"], bevel: 0.025, material: "trim_black" }));
    kids.push(box("Diffuser", ["$W2 * 1.3", 0.06, 0.12], { at: [0, `${bumperY0} + 0.04`, "-$L2 + 0.07"], bevel: 0.02, material: "trim_black" }));
    kids.push(box("Sill_L", [0.03, 0.06, `${f(st.ff + st.fr)} * $L2 - 2 * $Ra - 0.08`], { at: ["$W2 - 0.04", "$ys + 0.03", `${f((st.ff - st.fr) / 2)} * $L2`], bevel: 0.01, material: "trim_black", mirror: "Sill_R" }));
  }
  kids.push(box("PlateFront", [0.52, 0.11, 0.012], { at: [0, `${bumperY0} + 0.17`, `$L2 + ${st.bumper === "chrome" ? 0.075 : 0.003}`], bevel: 0.004, material: "plate" }));
  kids.push(box("PlateRear", [0.52, 0.11, 0.012], { at: [0, st.trunk === "bed" ? `${bumperY0} + 0.22` : `${ls(lry)} - 0.08`, `-$L2 - ${st.bumper === "chrome" && st.trunk !== "bed" ? 0.004 : 0.004}`], bevel: 0.004, material: "plate" }));
  kids.push(cyl("Exhaust", 0.035, 0.12, { axis: "z", at: ["$W2 * 0.55", `${bumperY0} + 0.04`, "-$L2 + 0.03"], segments: 14, material: "chrome" }));
  if (st.spoiler) {
    kids.push(group("Spoiler", [
      box("Wing", ["$W2 * 1.5", 0.025, 0.2], { at: [0, 0.07, 0], rotate: [-6, 0, 0], bevel: 0.01, material: "carbon" }),
      box("Stand_L", [0.03, 0.08, 0.06], { at: ["$W2 * 0.55", 0.03, 0], material: "carbon", mirror: "Stand_R" }),
    ], { at: [0, ls(tag("trunkR")[1]), `${ls(tag("trunkR")[0])} + 0.12`] }));
  }

  // Mirrors, wipers.
  kids.push(group("Mirror_L", [
    box("Arm", [0.12, 0.03, 0.06], { at: [0.05, 0, 0], bevel: 0.01, material: "trim_black" }),
    ellipsoid("Housing", [0.1, 0.065, 0.055], { at: [0.14, 0.035, 0], segments: 14, material: st.bumper === "chrome" ? "chrome" : "body_paint" }),
    ellipsoid("Face", [0.088, 0.054, 0.012], { at: [0.14, 0.035, -0.045], segments: 12, material: "chrome" }),
  ], { at: ["$W2 - 0.05", "$yb + 0.05", `${f(zws)} * $L2 - 0.18`], mirror: "Mirror_R" }));
  kids.push(box("Wiper_L", ["$W2 * 0.5", 0.012, 0.02], { at: ["$W2 * 0.3", "$yb + 0.02", `${f(zws)} * $L2 - 0.04`], rotate: [0, -6, 3], material: "trim_black", mirror: "Wiper_R" }));

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
  const zDash = `${f(zws)} * $L2 - 0.12`;
  interior.push(box("Dash", ["2 * $wb - 0.04", 0.14, 0.32], { at: [0, "$yb - 0.02", zDash], bevel: 0.04, material: "trim_black" }));
  kids.push(group("Interior", interior, { material: up }));
  kids.push(group("SteeringWheel", [
    lathe("Rim", ringProfile(0.18, 0.016, 8), { segments: 20, caps: false, material: "trim_black" }),
    box("Spokes", [0.33, 0.02, 0.05], { material: "trim_black" }),
    cyl("Boss", 0.055, 0.05, { segments: 16, material: "trim_black" }),
  ], { at: ["$wb * 0.48", "$yb + 0.12", `${zDash} - 0.32`], rotate: [-62, 0, 0] }));

  // Wheels at the hubs, outer face out.
  const tw = st.tyreW + 0.015;
  const wo = { r: "$wr", w: f(tw), style: fin.wheel, rim: fin.rim ?? (fin.wheel === "steel" ? "steel_wheel" : fin.wheel === "chrome" || fin.wheel === "wire" ? "chrome" : "alloy"), hub: fin.wheel === "alloy" ? "gloss_black" : fin.wheel === "chrome" ? "alloy" : "chrome", ...(fin.spokes ? { spokes: fin.spokes } : {}), ...(fin.roof === "whitewall" || key === "vintage" ? { whitewall: "whitewall" } : {}) } as const;
  const wx = `$W2 - ${f(tw / 2 + 0.006)}`;
  kids.push(group("Wheels", [
    wheel("Wheel_FL", [wx, "$wr", `${f(st.ff)} * $L2`], wo, { mirror: "Wheel_FR" }),
    wheel("Wheel_RL", [wx, "$wr", `-${f(st.fr)} * $L2`], wo, { mirror: "Wheel_RR" }),
  ]));
  // Flared wheel-arch lips (black cladding on the SUV and pickup) and a shoulder crease along the side above them.
  const flare = st.bumper === "black" || st.trunk === "bed" ? "trim_black" : "body_paint";
  for (const [n, zc] of [["ArchFlare_FL", st.ff], ["ArchFlare_RL", -st.fr]] as [string, number][]) {
    const arc = Array.from({ length: 11 }, (_, i) => {
      const a = ((168 - i * 15.6) * Math.PI) / 180;
      return [`$W2 - 0.012`, `$wr + ($Ra + 0.014) * ${f(Math.sin(a))}`, `${f(zc)} * $L2 + ($Ra + 0.014) * ${f(Math.cos(a))}`] as [Num, Num, Num];
    });
    kids.push(tube(n, arc, flare === "trim_black" ? 0.032 : 0.022, { segments: 8, material: flare, mirror: n.replace("L", "R") }));
  }
  kids.push(tube("Shoulder_L", [[`$W2 - 0.006`, "$yb - 0.13", `${frontEdge} + 0.02`], [`$W2 - 0.006`, "$yb - 0.125", `-${f(st.fr)} * $L2 + $Ra + 0.02`]], 0.011, { segments: 8, material: "body_paint", mirror: "Shoulder_R" }));
  if (fin.wheel === "alloy") {
    const cal = key === "sports" || key === "coupe" ? "caliper" : "alloy_dark";
    for (const [n, z] of [["Caliper_FL", st.ff], ["Caliper_RL", -st.fr]] as [string, number][]) {
      kids.push(box(n, [0.045, "$wr * 0.2", "$wr * 0.34"], { at: [`${wx} - ${f(tw * 0.1)}`, "$wr * 1.4", `${f(z)} * $L2 - $wr * 0.12`], rotate: [-18, 0, 0], bevel: 0.012, material: cal, mirror: n.replace("L", "R") }));
    }
  }
  nodes.push(group("Car", kids, {
    vars: {
      L2: "$length / 2", W2: "$width / 2", H: "$height", wr: "$wheelRadius", Ra: raExpr,
      ys: `$wheelRadius - ${f(Math.sin(st.a0))} * $Ra`,
      yb: `$height * ${f(st.belt)}`, wb: `$width / 2 - ${f(st.gin)}`,
      wtop: `$width / 2 - ${f(st.gin)} - ${f(st.tumble ?? 0.3)} * ($height - 0.035 - $height * ${f(st.belt)} + 0.05)`,
    },
  }));

  const roofText = fin.roof === "gloss_black" || fin.roof === "carbon" ? `, a contrasting ${fin.roof === "carbon" ? "carbon" : "black"} roof` : "";
  const mats2: Record<string, MaterialDef> = { body_paint: fin.paint, ...mats("aluminium", "chrome"), ...WHEEL_MATS() };
  for (const k of ["tinted_glass", "trim_black", "satin_black", "gloss_black", "rubber_seal", "panel_gap", "lamp_lens", "lamp_glass", "reflector", "lamp_red", "lamp_amber", "plate", "upholstery", "upholstery_tan", "carbon", "whitewall", "caliper", "alloy_dark"]) mats2[k] = VMATS[k]!;
  void idx;
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
  assets: () => Object.entries(STYLES).flatMap(([key, st]) => FINISHES[key]!.map((fin, i) => buildCar(key, st, fin, i))),
};
