import { deflateSync, inflateSync } from "node:zlib";

/**
 * Just enough PNG to compare two screenshots: 8-bit greyscale, grey with alpha, RGB, RGBA and palette images, not
 * interlaced (what Godot's save_png writes), decoded to RGBA; and an RGBA encoder for the diff picture.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** width * height * 4 bytes, row by row. */
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class PngError extends Error {}

export function decodePng(file: Buffer): RgbaImage {
  if (file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) throw new PngError("not a PNG file");
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos + 8 <= file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString("latin1", pos + 4, pos + 8);
    const body = file.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colour = body[9]!;
      interlace = body[12]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (!width || !height) throw new PngError("PNG without a header");
  if (depth !== 8 || interlace !== 0) throw new PngError(`only 8-bit, non-interlaced PNG files can be compared (this one is ${depth}-bit${interlace ? ", interlaced" : ""})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  if (!channels) throw new PngError(`unknown PNG colour type ${colour}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let prior = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels]! : 0;
      const b = prior[x]!;
      const c = x >= channels ? prior[x - channels]! : 0;
      let value = line[x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
    prior = out;
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 4;
    if (colour === 6) data.set(pixels.subarray(s, s + 4), d);
    else if (colour === 2) {
      data[d] = pixels[s]!;
      data[d + 1] = pixels[s + 1]!;
      data[d + 2] = pixels[s + 2]!;
      data[d + 3] = 255;
    } else if (colour === 0 || colour === 4) {
      data[d] = data[d + 1] = data[d + 2] = pixels[s]!;
      data[d + 3] = colour === 4 ? pixels[s + 1]! : 255;
    } else {
      const index = pixels[s]!;
      data[d] = palette?.[index * 3] ?? 0;
      data[d + 1] = palette?.[index * 3 + 1] ?? 0;
      data[d + 2] = palette?.[index * 3 + 2] ?? 0;
      data[d + 3] = transparency?.[index] ?? 255;
    }
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function encodePng(image: RgbaImage): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export interface ImageDiff {
  /** Share of pixels that changed by more than the tolerance, in percent. */
  percent: number;
  pixels: number;
  /** The box around the largest group of changed pixels (by a coarse grid of 16x16 cells). */
  region?: { x: number; y: number; width: number; height: number };
  /** Mean change of the changed pixels, 0-255 (how strong the change is). */
  meanShift: number;
  /** The baseline faded to grey with the changed pixels in red. */
  image: RgbaImage;
}

/**
 * Compares two pictures of the same size. A pixel counts as changed when its colour moved by more than `tolerance`
 * (0-255, perceptually weighted), so anti-aliasing noise does not count.
 */
export function diffImages(before: RgbaImage, after: RgbaImage, tolerance = 24): ImageDiff {
  if (before.width !== after.width || before.height !== after.height) throw new PngError(`sizes differ: ${before.width}x${before.height} and ${after.width}x${after.height}`);
  const { width, height } = before;
  const out = new Uint8Array(width * height * 4);
  const cell = 16;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells = new Uint32Array(cols * rows);
  let changed = 0;
  let shift = 0;
  for (let i = 0; i < width * height; i++) {
    const d = i * 4;
    const dr = after.data[d]! - before.data[d]!;
    const dg = after.data[d + 1]! - before.data[d + 1]!;
    const db = after.data[d + 2]! - before.data[d + 2]!;
    const da = after.data[d + 3]! - before.data[d + 3]!;
    // Luma-weighted distance (YIQ Y weights), plus alpha.
    const delta = Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db) + Math.abs(da) * 0.5;
    const grey = Math.round(0.299 * before.data[d]! + 0.587 * before.data[d + 1]! + 0.114 * before.data[d + 2]!);
    if (delta > tolerance) {
      changed++;
      shift += delta;
      const x = i % width;
      const y = Math.floor(i / width);
      cells[Math.floor(y / cell) * cols + Math.floor(x / cell)]!++;
      out[d] = 255;
      out[d + 1] = 0;
      out[d + 2] = 0;
    } else {
      const faded = 128 + Math.round(grey / 2);
      out[d] = out[d + 1] = out[d + 2] = faded;
    }
    out[d + 3] = 255;
  }
  // The largest connected group of cells with changes.
  let region: ImageDiff["region"];
  const seen = new Uint8Array(cols * rows);
  let best = 0;
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    let x0 = cols;
    let y0 = rows;
    let x1 = -1;
    let y1 = -1;
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
  return {
    percent: Math.round((10000 * changed) / (width * height)) / 100,
    pixels: changed,
    ...(region ? { region } : {}),
    meanShift: changed ? Math.round((10 * shift) / changed) / 10 : 0,
    image: { width, height, data: out },
  };
}
