import { crc32, deflateSync, inflateSync } from "node:zlib";

/** A PNG that cannot be read: not a PNG, damaged, or a kind this reader does not handle. */
export class PngError extends Error {}

/** A decoded picture: 8-bit RGBA, rows top to bottom. */
export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * An 8-bit RGB (3 channels) or RGBA (4 channels) PNG. Each row gets the filter that leaves the smallest numbers,
 * which compresses noise much better.
 */
export function encodePng(width: number, height: number, pixels: Uint8Array, channels: 3 | 4 = 3): Buffer {
  const stride = width * channels;
  if (pixels.length < stride * height) throw new PngError(`expected ${stride * height} bytes for ${width}x${height}, got ${pixels.length}`);
  const raw = Buffer.alloc((stride + 1) * height);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const trial = new Uint8Array(stride);
  const filtered = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    cur.set(pixels.subarray(y * stride, (y + 1) * stride));
    let best = -1, bestCost = Infinity;
    for (let f = 0; f <= 4; f++) {
      let cost = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? (cur[i - channels] as number) : 0, b = prev[i] as number, c = i >= channels ? (prev[i - channels] as number) : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const value = ((cur[i] as number) - pred) & 0xff;
        trial[i] = value;
        cost += value < 128 ? value : 256 - value;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
        filtered.set(trial);
      }
    }
    raw[y * (stride + 1)] = best;
    raw.set(filtered, y * (stride + 1) + 1);
    prev.set(cur);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

/** Samples per pixel for each PNG colour type: grey, RGB, palette, grey + alpha, RGBA. */
const SAMPLES: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Reads a PNG into 8-bit RGBA: grey, RGB, palette, grey + alpha and RGBA at 8 bits (16 bits keeps the high byte),
 * with transparency from tRNS. Interlaced files and bit depths below 8 are refused.
 */
export function decodePng(buf: Uint8Array): RgbaImage {
  const data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (data.length < 8 || !data.subarray(0, 8).equals(SIGNATURE)) throw new PngError("not a PNG file");
  let width = 0, height = 0, depth = 0, type = -1, interlace = 0;
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  const idat: Buffer[] = [];
  let at = 8;
  while (at + 8 <= data.length) {
    const length = data.readUInt32BE(at);
    const kind = data.toString("latin1", at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);
    if (body.length !== length) throw new PngError(`the ${kind} chunk is cut off`);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8] ?? 0;
      type = body[9] ?? -1;
      interlace = body[12] ?? 0;
    } else if (kind === "PLTE") palette = body;
    else if (kind === "tRNS") trns = body;
    else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  const samples = SAMPLES[type];
  if (!width || !height || samples === undefined) throw new PngError("the PNG has no valid header");
  if (interlace) throw new PngError("interlaced PNGs are not supported");
  if (depth !== 8 && !(depth === 16 && type !== 3)) throw new PngError(`a bit depth of ${depth} is not supported (8, or 16 without a palette)`);
  if (type === 3 && !palette) throw new PngError("a palette PNG without a palette");
  if (!idat.length) throw new PngError("the PNG has no image data");
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    throw new PngError("the PNG image data is damaged");
  }
  const bpp = (samples * depth) / 8;
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) throw new PngError("the PNG image data is cut off");
  // Undo the row filters in place: each row is a filter byte, then the filtered bytes.
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i] as number;
      const a = i >= bpp ? (rows[dst + i - bpp] as number) : 0;
      const b = y > 0 ? (rows[dst - stride + i] as number) : 0;
      const c = i >= bpp && y > 0 ? (rows[dst - stride + i - bpp] as number) : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new PngError(`unknown row filter ${filter}`);
      }
      rows[dst + i] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const step = depth / 8;
  const sample = (pixel: number, s: number): number => rows[pixel * bpp + s * step] as number;
  // tRNS for grey and RGB names one colour (16-bit values) that is fully transparent.
  const key = trns && (type === 0 || type === 2) ? [0, 2, 4].slice(0, type === 0 ? 1 : 3).map((o) => (depth === 16 ? trns.readUInt16BE(o) >> 8 : trns.readUInt16BE(o) & 0xff)) : undefined;
  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    if (type === 3) {
      const index = sample(p, 0);
      rgba[o] = palette![index * 3] ?? 0;
      rgba[o + 1] = palette![index * 3 + 1] ?? 0;
      rgba[o + 2] = palette![index * 3 + 2] ?? 0;
      rgba[o + 3] = trns && index < trns.length ? (trns[index] as number) : 255;
      continue;
    }
    const grey = type === 0 || type === 4;
    const r = sample(p, 0);
    const g = grey ? r : sample(p, 1);
    const b = grey ? r : sample(p, 2);
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = type === 4 ? sample(p, 1) : type === 6 ? sample(p, 3) : key && r === key[0] && g === (key[1] ?? r) && b === (key[2] ?? r) ? 0 : 255;
  }
  return { width, height, rgba };
}
