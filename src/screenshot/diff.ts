import { encodePng, type RgbaImage } from "./png.js";

/** How strict a comparison is. */
export interface DiffOptions {
  /** Largest difference per channel (0..255) that still counts as the same pixel (default 16). */
  tolerance?: number;
  /** Largest share of changed pixels, in percent, that still passes (default 0.1). */
  maxChanged?: number;
  /** Ignore a changed pixel when both pictures have its colour within 1 px (anti-aliased edges; default true). */
  antialias?: boolean;
}

export const DEFAULT_TOLERANCE = 16;
export const DEFAULT_MAX_CHANGED = 0.1;

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
  /** Pixels that differ by more than the tolerance (all of them when the sizes differ). */
  changed: number;
  changedPercent: number;
  tolerance: number;
  maxChanged: number;
  ok: boolean;
  /** Set when the pictures have different sizes; then nothing else is compared. */
  sizeMismatch?: { base: string; actual: string };
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
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
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

/** The largest per-channel difference (alpha included) between pixel i of a and pixel j of b. */
function delta(a: Uint8Array, i: number, b: Uint8Array, j: number): number {
  return Math.max(Math.abs((a[i] as number) - (b[j] as number)), Math.abs((a[i + 1] as number) - (b[j + 1] as number)), Math.abs((a[i + 2] as number) - (b[j + 2] as number)), Math.abs((a[i + 3] as number) - (b[j + 3] as number)));
}

/** True when pixel (x, y) of `from` has a colour that `to` has within 1 px of (x, y). */
function nearMatch(from: Uint8Array, to: Uint8Array, x: number, y: number, w: number, h: number, tol: number): boolean {
  const o = (y * w + x) * 4;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
      if (delta(from, o, to, (yy * w + xx) * 4) <= tol) return true;
    }
  }
  return false;
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
        const ok = bx >= 0 && by >= 0 && bx < w && by < h && ax >= 0 && ay >= 0 && ax < w && ay < h && delta(actual.rgba, p * 4, base.rgba, (by * w + bx) * 4) <= tol && delta(base.rgba, p * 4, actual.rgba, (ay * w + ax) * 4) <= tol;
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

/**
 * Compares a new capture with its baseline, pixel by pixel. Returns the numbers an agent can read (changed share,
 * where, boxes of change and whether they moved, brightness) and a mask of the changed pixels for the diff picture.
 */
export function diffImages(base: RgbaImage, actual: RgbaImage, options: DiffOptions = {}): { diff: ImageDiff; mask: Uint8Array } {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxChanged = options.maxChanged ?? DEFAULT_MAX_CHANGED;
  const lumaOf = (img: RgbaImage): number => {
    let s = 0;
    for (let p = 0; p < img.width * img.height; p++) s += luma(img.rgba, p * 4);
    return round1(s / Math.max(1, img.width * img.height));
  };
  const lumas = { base: lumaOf(base), actual: lumaOf(actual) };
  if (base.width !== actual.width || base.height !== actual.height) {
    const n = actual.width * actual.height;
    return {
      diff: { width: actual.width, height: actual.height, changed: n, changedPercent: 100, tolerance, maxChanged, ok: false, sizeMismatch: { base: `${base.width}x${base.height}`, actual: `${actual.width}x${actual.height}` }, regions: [], boxes: [], moreBoxes: 0, luma: lumas },
      mask: new Uint8Array(n).fill(1),
    };
  }
  const w = base.width;
  const h = base.height;
  const mask = new Uint8Array(w * h);
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const cells = new Uint32Array(cols * rows);
  const regionCount = new Uint32Array(9);
  const regionSize = new Uint32Array(9);
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const region = Math.min(2, Math.floor((3 * y) / h)) * 3 + Math.min(2, Math.floor((3 * x) / w));
      regionSize[region]! += 1;
      if (delta(base.rgba, p * 4, actual.rgba, p * 4) <= tolerance) continue;
      if (options.antialias !== false && nearMatch(base.rgba, actual.rgba, x, y, w, h, tolerance) && nearMatch(actual.rgba, base.rgba, x, y, w, h, tolerance)) continue;
      mask[p] = 1;
      changed++;
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
  const merged: ChangeBox[] = [];
  for (const b of tried) {
    const near = (m: ChangeBox) => m.moved && b.moved && m.moved.dx === b.moved.dx && m.moved.dy === b.moved.dy && b.x0 - m.x1 <= MERGE && m.x0 - b.x1 <= MERGE && b.y0 - m.y1 <= MERGE && m.y0 - b.y1 <= MERGE;
    const into = merged.find(near);
    if (!into) merged.push({ ...b });
    else Object.assign(into, { x0: Math.min(into.x0, b.x0), y0: Math.min(into.y0, b.y0), x1: Math.max(into.x1, b.x1), y1: Math.max(into.y1, b.y1), pixels: into.pixels + b.pixels });
  }
  merged.sort((a, b) => b.pixels - a.pixels);
  const top = merged.slice(0, 5);
  const changedPercent = round3((100 * changed) / (w * h));
  return {
    diff: {
      width: w,
      height: h,
      changed,
      changedPercent,
      tolerance,
      maxChanged,
      ok: changedPercent <= maxChanged,
      regions: REGIONS.map((region, i) => ({ region, percent: round1((100 * (regionCount[i] as number)) / Math.max(1, regionSize[i] as number)) })).filter((r) => r.percent > 0),
      boxes: top,
      moreBoxes: Math.max(0, merged.length - top.length) + Math.max(0, boxes.length - tried.length),
      luma: lumas,
    },
    mask,
  };
}

/** The diff picture: changed pixels magenta, everything else the new picture in dim grey. */
export function diffPng(actual: RgbaImage, mask: Uint8Array): Buffer {
  const n = actual.width * actual.height;
  const rgb = new Uint8Array(n * 3);
  for (let p = 0; p < n; p++) {
    if (mask[p]) {
      rgb[p * 3] = 255;
      rgb[p * 3 + 1] = 0;
      rgb[p * 3 + 2] = 255;
    } else {
      const v = Math.round(40 + luma(actual.rgba, p * 4) * 0.35);
      rgb[p * 3] = v;
      rgb[p * 3 + 1] = v;
      rgb[p * 3 + 2] = v;
    }
  }
  return encodePng(actual.width, actual.height, rgb, 3);
}

/** The diff as a few lines: verdict, boxes (with a move when a shift explains one), regions and brightness. */
export function formatDiff(d: ImageDiff): string[] {
  if (d.sizeMismatch) return [`size differs: baseline ${d.sizeMismatch.base}, now ${d.sizeMismatch.actual}`];
  const out = [`${d.changed} px changed (${d.changedPercent}%, allowed ${d.maxChanged}% at tolerance ${d.tolerance}/255)`];
  if (d.boxes.length) {
    const boxes = d.boxes.map((b) => `(${b.x0},${b.y0})-(${b.x1},${b.y1}) ${b.pixels} px${b.moved ? ` moved (${b.moved.dx},${b.moved.dy})` : ""}`);
    out.push(`boxes: ${boxes.join("; ")}${d.moreBoxes ? `; +${d.moreBoxes} more` : ""}`);
  }
  if (d.regions.length) out.push(`where: ${d.regions.map((r) => `${r.region} ${r.percent}%`).join(", ")}`);
  const shift = round1(d.luma.actual - d.luma.base);
  if (Math.abs(shift) >= 3) out.push(`mean brightness ${d.luma.base} -> ${d.luma.actual} (${shift < 0 ? "darker" : "brighter"})`);
  return out;
}
