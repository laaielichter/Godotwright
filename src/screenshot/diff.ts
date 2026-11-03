import { PngError, type RgbaImage } from "./png.js";

/** How strict a comparison is. */
export interface DiffOptions {
  /** How far (0-255) a pixel's colour may move before it counts as changed (default 3). */
  tolerance?: number;
  /** Percent of pixels that may change before the picture counts as changed (default 0.5). */
  threshold?: number;
}

/** Percent of pixels that may change before a picture counts as changed. */
export const DEFAULT_THRESHOLD = 0.5;
/**
 * Renders are pixel identical run after run (fixed fps and fixed seeds); a little tolerance absorbs rounding in other
 * drivers, while any visible colour change, even of one pixel, still counts.
 */
export const DEFAULT_TOLERANCE = 3;

/** A connected area of changed pixels, and how far it moved when a shift explains it. */
export interface ChangeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pixels: number;
  moved?: { dx: number; dy: number };
}

export interface ImageDiff {
  width: number;
  height: number;
  /** Pixels whose colour moved by more than the tolerance. */
  pixels: number;
  /** Share of changed pixels, in percent (two decimals). */
  percent: number;
  tolerance: number;
  threshold: number;
  /** True when no more pixels changed than the threshold allows. */
  ok: boolean;
  /** The box around the largest group of changed pixels (by a coarse grid of 16x16 cells). */
  region?: { x: number; y: number; width: number; height: number };
  /** Mean change of the changed pixels, 0-255 (how strong the change is). */
  meanShift: number;
  /** Share of changed pixels per ninth of the picture, only where something changed. */
  regions: { region: string; percent: number }[];
  /** Up to five areas of change, biggest first. */
  boxes: ChangeBox[];
  /** How many more areas there are. */
  moreBoxes: number;
  /** Mean brightness (0..255) of the baseline and of the new picture. */
  luma: { base: number; actual: number };
}

/** What is wrong with a picture that shows nothing: black, white, fully transparent or (nearly) one colour. */
export interface ImageStats {
  meanLuma: number;
  /** Share of the picture in its most common colour, in percent. */
  dominant: number;
  dominantColor: [number, number, number];
  blank?: string;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const luma = (px: Uint8Array, o: number): number => 0.2126 * (px[o] as number) + 0.7152 * (px[o + 1] as number) + 0.0722 * (px[o + 2] as number);

/** The clear colour Godotwright's screenshot script draws behind a scene: Color(0.3, 0.3, 0.3) as 8-bit. */
export const BACKGROUND_RGB: [number, number, number] = [77, 77, 77];

/**
 * Says when a capture shows nothing useful: fully transparent, or one colour (black, white, the background) over
 * at least 99.9% of the picture. Those are the captures other tools hand back without a word.
 */
export function imageStats(img: RgbaImage, background: [number, number, number] = BACKGROUND_RGB): ImageStats {
  const px = img.rgba;
  const n = img.width * img.height;
  const buckets = new Uint32Array(1 << 15);
  let sum = 0;
  let transparent = 0;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    sum += luma(px, o);
    if (px[o + 3] === 0) transparent++;
    buckets[((px[o] as number) >> 3) | (((px[o + 1] as number) >> 3) << 5) | (((px[o + 2] as number) >> 3) << 10)]! += 1;
  }
  let top = 0;
  for (let i = 1; i < buckets.length; i++) if ((buckets[i] as number) > (buckets[top] as number)) top = i;
  // The real colour of the biggest bucket: the first pixel that falls in it.
  let color: [number, number, number] = [0, 0, 0];
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if ((((px[o] as number) >> 3) | (((px[o + 1] as number) >> 3) << 5) | (((px[o + 2] as number) >> 3) << 10)) === top) {
      color = [px[o] as number, px[o + 1] as number, px[o + 2] as number];
      break;
    }
  }
  const dominant = (100 * (buckets[top] as number)) / n;
  const meanLuma = round1(sum / n);
  const stats: ImageStats = { meanLuma, dominant: round1(dominant), dominantColor: color };
  const rgb = `rgb(${color.join(",")})`;
  if (transparent === n) stats.blank = "fully transparent: every pixel has alpha 0";
  else if (dominant >= 99.9) {
    const share = dominant >= 100 ? "the whole picture is" : `${Math.floor(dominant * 10) / 10}% of the picture is`;
    const close = (c: [number, number, number]) => Math.max(...c.map((v, i) => Math.abs(v - color[i]!))) <= 8;
    const what = color.every((v) => v <= 8) ? "black" : color.every((v) => v >= 247) ? "white" : close(background) ? `the background colour ${rgb}: nothing drawn` : `one colour ${rgb}`;
    stats.blank = `${share} ${what}`;
  }
  return stats;
}

/**
 * How far the colour of pixel i of a is from pixel j of b, 0-255: luma-weighted (YIQ Y weights), plus half the alpha
 * change, so anti-aliasing noise stays small and a visible change does not.
 */
function distance(a: Uint8Array, i: number, b: Uint8Array, j: number): number {
  const dr = (a[i] as number) - (b[j] as number);
  const dg = (a[i + 1] as number) - (b[j + 1] as number);
  const db = (a[i + 2] as number) - (b[j + 2] as number);
  const da = (a[i + 3] as number) - (b[j + 3] as number);
  return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db) + Math.abs(da) * 0.5;
}

const REGIONS = ["top-left", "top", "top-right", "left", "centre", "right", "bottom-left", "bottom", "bottom-right"];
const CELL = 8;
const SHIFT = 16;
/** Areas explained by the same move are one thing when they are at most this far apart. */
const MERGE = 64;

/** Tries to explain a box by a shift of up to 16 px: the new picture is the old one moved, both ways round. */
function findShift(base: RgbaImage, actual: RgbaImage, pixels: number[], tol: number): { dx: number; dy: number } | undefined {
  const w = base.width;
  const h = base.height;
  const sample = pixels.length > 3000 ? pixels.filter((_, i) => i % Math.ceil(pixels.length / 3000) === 0) : pixels;
  let best: { dx: number; dy: number; score: number } | undefined;
  for (let dy = -SHIFT; dy <= SHIFT; dy++) {
    for (let dx = -SHIFT; dx <= SHIFT; dx++) {
      if (dx === 0 && dy === 0) continue;
      let hits = 0;
      let misses = 0;
      const allowed = sample.length * 0.1;
      for (const p of sample) {
        const x = p % w;
        const y = (p - x) / w;
        // What is now at p was at p - d, and what was at p is now at p + d.
        const bx = x - dx, by = y - dy, ax = x + dx, ay = y + dy;
        const ok = bx >= 0 && by >= 0 && bx < w && by < h && ax >= 0 && ay >= 0 && ax < w && ay < h && distance(actual.rgba, p * 4, base.rgba, (by * w + bx) * 4) <= tol && distance(base.rgba, p * 4, actual.rgba, (ay * w + ax) * 4) <= tol;
        if (ok) hits++;
        else if (++misses > allowed) break;
      }
      if (misses > allowed) continue;
      const score = hits / sample.length;
      const better = !best || score > best.score || (score === best.score && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy));
      if (better) best = { dx, dy, score };
    }
  }
  return best && best.score >= 0.9 ? { dx: best.dx, dy: best.dy } : undefined;
}

/** The box around the largest 4-connected group of 16x16 cells with changes, weighed by their changed pixels. */
function largestRegion(mask: Uint8Array, width: number, height: number): ImageDiff["region"] {
  const cell = 16;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells = new Uint32Array(cols * rows);
  for (let p = 0; p < mask.length; p++) if (mask[p]) cells[Math.floor(Math.floor(p / width) / cell) * cols + Math.floor((p % width) / cell)]! += 1;
  let region: ImageDiff["region"];
  const seen = new Uint8Array(cols * rows);
  let best = 0;
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    while (stack.length) {
      const c = stack.pop()!;
      count += cells[c]!;
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (cells[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (count > best) {
      best = count;
      const x = x0 * cell;
      const y = y0 * cell;
      region = { x, y, width: Math.min(width, (x1 + 1) * cell) - x, height: Math.min(height, (y1 + 1) * cell) - y };
    }
  }
  return region;
}

/**
 * Compares a new picture with its baseline, pixel by pixel; both must have the same size. A pixel counts as changed
 * when its colour moved by more than `tolerance`. Returns the numbers an agent can read (changed share, the largest
 * changed area, areas of change and whether they moved, where, brightness) and the diff picture: the baseline faded
 * to grey with the changed pixels in red.
 */
export function diffImages(base: RgbaImage, actual: RgbaImage, options: DiffOptions = {}): { diff: ImageDiff; image: RgbaImage } {
  if (base.width !== actual.width || base.height !== actual.height) throw new PngError(`sizes differ: ${base.width}x${base.height} and ${actual.width}x${actual.height}`);
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const w = base.width;
  const h = base.height;
  const mask = new Uint8Array(w * h);
  const out = new Uint8Array(w * h * 4);
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const cells = new Uint32Array(cols * rows);
  const regionCount = new Uint32Array(9);
  const regionSize = new Uint32Array(9);
  let changed = 0;
  let shift = 0;
  let lumaBase = 0;
  let lumaActual = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const o = p * 4;
      lumaBase += luma(base.rgba, o);
      lumaActual += luma(actual.rgba, o);
      const region = Math.min(2, Math.floor((3 * y) / h)) * 3 + Math.min(2, Math.floor((3 * x) / w));
      regionSize[region]! += 1;
      out[o + 3] = 255;
      const d = distance(actual.rgba, o, base.rgba, o);
      if (d <= tolerance) {
        const grey = Math.round(0.299 * (base.rgba[o] as number) + 0.587 * (base.rgba[o + 1] as number) + 0.114 * (base.rgba[o + 2] as number));
        out[o] = out[o + 1] = out[o + 2] = 128 + Math.round(grey / 2);
        continue;
      }
      out[o] = 255;
      mask[p] = 1;
      changed++;
      shift += d;
      regionCount[region]! += 1;
      cells[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]! += 1;
    }
  }
  // Areas of change: 8x8 cells with a changed pixel, joined when they touch (corners too).
  const label = new Int32Array(cols * rows).fill(-1);
  const groups: number[][] = [];
  for (let c = 0; c < cells.length; c++) {
    if (!cells[c] || label[c] !== -1) continue;
    const id = groups.length;
    const members: number[] = [];
    const stack = [c];
    label[c] = id;
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      const cx = cur % cols;
      const cy = (cur - cx) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (cells[n] && label[n] === -1) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
    }
    groups.push(members);
  }
  const boxes = groups.map((members) => {
    const box = { x0: w, y0: h, x1: -1, y1: -1, pixels: 0 };
    const pixels: number[] = [];
    for (const cell of members) {
      const cx = (cell % cols) * CELL;
      const cy = Math.floor(cell / cols) * CELL;
      for (let y = cy; y < Math.min(h, cy + CELL); y++) {
        for (let x = cx; x < Math.min(w, cx + CELL); x++) {
          if (!mask[y * w + x]) continue;
          pixels.push(y * w + x);
          box.x0 = Math.min(box.x0, x);
          box.y0 = Math.min(box.y0, y);
          box.x1 = Math.max(box.x1, x);
          box.y1 = Math.max(box.y1, y);
        }
      }
    }
    box.pixels = pixels.length;
    return { box, pixels };
  });
  boxes.sort((a, b) => b.box.pixels - a.box.pixels || a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  // A thing that moved leaves two areas, where it was and where it is now, explained by the same shift: one box.
  const tried: ChangeBox[] = boxes.slice(0, 10).map(({ box, pixels }) => {
    const moved = findShift(base, actual, pixels, tolerance);
    return moved ? { ...box, moved } : box;
  });
  const merged: ChangeBox[] = tried.map((b) => ({ ...b }));
  const near = (a: ChangeBox, b: ChangeBox) =>
    a.moved && b.moved && a.moved.dx === b.moved.dx && a.moved.dy === b.moved.dy && b.x0 - a.x1 <= MERGE && a.x0 - b.x1 <= MERGE && b.y0 - a.y1 <= MERGE && a.y0 - b.y1 <= MERGE;
  // Join until nothing joins any more: a joined box can reach one it did not reach before.
  for (let joined = true; joined; ) {
    joined = false;
    for (let i = 0; i < merged.length && !joined; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i]!;
        const b = merged[j]!;
        if (!near(a, b)) continue;
        Object.assign(a, { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), pixels: a.pixels + b.pixels });
        merged.splice(j, 1);
        joined = true;
        break;
      }
    }
  }
  merged.sort((a, b) => b.pixels - a.pixels);
  const top = merged.slice(0, 5);
  const region = largestRegion(mask, w, h);
  const n = Math.max(1, w * h);
  return {
    diff: {
      width: w,
      height: h,
      pixels: changed,
      percent: Math.round((10000 * changed) / n) / 100,
      tolerance,
      threshold,
      ok: (100 * changed) / n <= threshold,
      ...(region ? { region } : {}),
      meanShift: changed ? Math.round((10 * shift) / changed) / 10 : 0,
      regions: REGIONS.map((name, i) => ({ region: name, percent: round1((100 * (regionCount[i] as number)) / Math.max(1, regionSize[i] as number)) })).filter((r) => r.percent > 0),
      boxes: top,
      moreBoxes: Math.max(0, merged.length - top.length) + Math.max(0, boxes.length - tried.length),
      luma: { base: round1(lumaBase / n), actual: round1(lumaActual / n) },
    },
    image: { width: w, height: h, rgba: out },
  };
}

/** The areas of change, where they are and a brightness shift, as a few lines (the verdict is the caller's). */
export function formatDiff(d: ImageDiff): string[] {
  const out: string[] = [];
  if (d.boxes.length) {
    const boxes = d.boxes.map((b) => `(${b.x0},${b.y0})-(${b.x1},${b.y1}) ${b.pixels} px${b.moved ? ` moved (${b.moved.dx},${b.moved.dy})` : ""}`);
    out.push(`areas: ${boxes.join("; ")}${d.moreBoxes ? `; +${d.moreBoxes} more` : ""}`);
  }
  if (d.regions.length) out.push(`where: ${d.regions.map((r) => `${r.region} ${r.percent}%`).join(", ")}`);
  const shift = round1(d.luma.actual - d.luma.base);
  if (Math.abs(shift) >= 3) out.push(`mean brightness ${d.luma.base} -> ${d.luma.actual} (${shift < 0 ? "darker" : "brighter"})`);
  return out;
}
