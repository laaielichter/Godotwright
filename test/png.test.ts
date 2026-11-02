import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PngError, decodePng, diffImages, encodePng, type RgbaImage } from "../src/screenshot/png.js";
import { FIXTURES } from "./helpers.js";

function image(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}

/** A PNG whose rows use the given filters in turn, so the decoder sees every filter type. */
function filteredPng(img: RgbaImage, filters: number[]): Buffer {
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    const filter = filters[y % filters.length]!;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const at = (yy: number, xx: number) => (yy < 0 || xx < 0 ? 0 : img.data[yy * stride + xx]!);
      const a = at(y, x - 4);
      const b = at(y - 1, x);
      const c = at(y - 1, x - 4);
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filter]!;
      raw[y * (stride + 1) + 1 + x] = (at(y, x) - predictor) & 0xff;
    }
  }
  const png = encodePng(img);
  // Swap the encoder's IDAT for the filtered one; the CRC is not checked by the decoder.
  const idat = deflateSync(raw);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(idat.length, 0);
  head.write("IDAT", 4, "latin1");
  return Buffer.concat([png.subarray(0, 33), head, idat, Buffer.alloc(4), png.subarray(png.length - 12)]);
}

const noise = image(37, 23, (x, y) => [(x * 37 + y * 11) % 256, (x * x + y * 7) % 256, (x * y * 13) % 256, 255 - ((x + y) % 64)]);

describe("png", () => {
  it("encodes and decodes RGBA without loss", () => {
    const back = decodePng(encodePng(noise));
    expect(back.width).toBe(37);
    expect(back.height).toBe(23);
    expect(Buffer.from(back.data).equals(Buffer.from(noise.data))).toBe(true);
  });

  it("undoes every row filter: none, sub, up, average and paeth", () => {
    const back = decodePng(filteredPng(noise, [0, 1, 2, 3, 4, 3, 2, 4, 1]));
    expect(Buffer.from(back.data).equals(Buffer.from(noise.data))).toBe(true);
  });

  it("reads PNG files written by Godot (RGBA, RGB, grey, grey with alpha, and a cropped render) as Godot reads them", () => {
    const dir = join(FIXTURES, "png");
    const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Record<string, string>;
    for (const name of ["rgba", "rgb", "grey", "greyalpha", "render"]) {
      const img = decodePng(readFileSync(join(dir, `${name}.png`)));
      expect(Buffer.from(img.data).toString("hex"), name).toBe(expected[name]);
    }
  });

  it("refuses files it cannot read", () => {
    expect(() => decodePng(Buffer.from("not a png"))).toThrow(PngError);
    const sixteen = encodePng(noise);
    sixteen[24] = 16;
    expect(() => decodePng(sixteen)).toThrow(/only 8-bit/);
  });

  it("finds no change between identical pictures", () => {
    const diff = diffImages(noise, decodePng(encodePng(noise)), 0);
    expect(diff).toMatchObject({ percent: 0, pixels: 0, meanShift: 0 });
    expect(diff.region).toBeUndefined();
    expect(diff.image.width).toBe(37);
  });

  it("finds a changed block as the largest region, and paints it red in the diff", () => {
    const before = image(160, 90, () => [40, 80, 120, 255]);
    const after = image(160, 90, (x, y) => (x >= 100 && x < 120 && y >= 40 && y < 50 ? [250, 200, 0, 255] : x === 5 && y === 5 ? [255, 255, 255, 255] : [40, 80, 120, 255]));
    const diff = diffImages(before, after, 3);
    expect(diff.pixels).toBe(201);
    expect(diff.percent).toBe(1.4);
    // Cells of 16 pixels: the block spans cells 6-7 across and 2-3 down.
    expect(diff.region).toEqual({ x: 96, y: 32, width: 32, height: 32 });
    expect(diff.meanShift).toBeGreaterThan(100);
    const at = (x: number, y: number) => [...diff.image.data.subarray((y * 160 + x) * 4, (y * 160 + x) * 4 + 4)];
    expect(at(110, 45)).toEqual([255, 0, 0, 255]);
    expect(at(50, 20)[0]).toBe(at(50, 20)[1]);
  });

  it("ignores changes within the tolerance, and refuses pictures of different sizes", () => {
    const before = image(32, 32, () => [100, 100, 100, 255]);
    const after = image(32, 32, () => [102, 101, 100, 255]);
    expect(diffImages(before, after, 3).pixels).toBe(0);
    expect(diffImages(before, after, 0).pixels).toBe(32 * 32);
    expect(() => diffImages(before, image(16, 32, () => [0, 0, 0, 255]))).toThrow(/sizes differ/);
  });
});
