import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BaselineError, baselineName, compareBaseline, formatBaseline, loadBaselines, readBaselineMeta } from "../src/screenshot/baseline.js";
import { diffImages, formatDiff, imageStats } from "../src/screenshot/diff.js";
import { PngError, decodePng, encodePng, type RgbaImage } from "../src/screenshot/png.js";
import { FIXTURES, tempFolder } from "./helpers.js";

/** A PNG with one given filter per row (row y uses filter y % 5), so the reader meets every filter. */
function handPng(width: number, height: number, type: number, depth: number, samples: Uint8Array, extra: [string, Buffer][] = []): Buffer {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]!;
  const bpp = (channels * depth) / 8;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const cur = samples[y * stride + i]!;
      const a = i >= bpp ? samples[y * stride + i - bpp]! : 0;
      const b = y > 0 ? samples[(y - 1) * stride + i]! : 0;
      const c = i >= bpp && y > 0 ? samples[(y - 1) * stride + i - bpp]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!;
      raw[y * (stride + 1) + 1 + i] = (cur - pred) & 0xff;
    }
  }
  const chunk = (kind: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(kind, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = type;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra.map(([k, d]) => chunk(k, d)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const noise = (n: number, seed = 7): Uint8Array => {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = i % 7 === 0 ? s & 0xff : (i * 13) & 0xff;
  }
  return out;
};

/** A flat grey picture with filled rectangles on it. */
function picture(w: number, h: number, rects: { x: number; y: number; w: number; h: number; c: [number, number, number] }[], bg: [number, number, number] = [77, 77, 77]): RgbaImage {
  const rgba = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) rgba.set([...bg, 255], p * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) rgba.set([...r.c, 255], (y * w + x) * 4);
  return { width: w, height: h, rgba };
}

describe("PNG reader and writer", () => {
  it("reads back what it writes, RGB and RGBA", () => {
    const rgb = noise(37 * 23 * 3);
    const back = decodePng(encodePng(37, 23, rgb));
    expect(back.width).toBe(37);
    for (let p = 0; p < 37 * 23; p++) expect([...back.rgba.subarray(p * 4, p * 4 + 4)]).toEqual([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], 255]);
    const rgba = noise(19 * 11 * 4, 3);
    expect([...decodePng(encodePng(19, 11, rgba, 4)).rgba]).toEqual([...rgba]);
  });

  it("undoes all five row filters, and reads grey, grey + alpha, palette with tRNS and 16-bit files", () => {
    const rgba = noise(9 * 10 * 4);
    expect([...decodePng(handPng(9, 10, 6, 8, rgba)).rgba]).toEqual([...rgba]);
    const grey = noise(6 * 5);
    expect([...decodePng(handPng(6, 5, 0, 8, grey)).rgba.subarray(0, 8)]).toEqual([grey[0], grey[0], grey[0], 255, grey[1], grey[1], grey[1], 255]);
    const ga = noise(4 * 5 * 2);
    expect([...decodePng(handPng(4, 5, 4, 8, ga)).rgba.subarray(0, 4)]).toEqual([ga[0], ga[0], ga[0], ga[1]]);
    const palette = Buffer.from([10, 20, 30, 200, 100, 0]);
    const pal = decodePng(handPng(2, 1, 3, 8, Uint8Array.from([1, 0]), [["PLTE", palette], ["tRNS", Buffer.from([0])]]));
    expect([...pal.rgba]).toEqual([200, 100, 0, 255, 10, 20, 30, 0]);
    const wide = decodePng(handPng(1, 1, 2, 16, Uint8Array.from([0x12, 0x34, 0xab, 0xcd, 0xff, 0x00])));
    expect([...wide.rgba]).toEqual([0x12, 0xab, 0xff, 255]);
  });

  it("reads the PNG Godot 4.7 writes (8-bit RGBA, filters 1, 2 and 4)", () => {
    const img = decodePng(readFileSync(join(FIXTURES, "png", "godot-scene.png")));
    const at = (x: number, y: number) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    expect([img.width, img.height]).toEqual([320, 180]);
    expect(at(0, 0)).toEqual([77, 77, 77, 255]);
    expect(at(30, 30)).toEqual([255, 0, 0, 255]);
  });

  it("refuses what it cannot read with a reason", () => {
    expect(() => decodePng(Buffer.from("not a png"))).toThrow(PngError);
    const interlaced = handPng(2, 2, 6, 8, noise(16));
    interlaced[8 + 8 + 12] = 1;
    expect(() => decodePng(interlaced)).toThrow(/interlaced/);
    expect(() => decodePng(handPng(8, 1, 0, 8, noise(8)).subarray(0, 40))).toThrow(PngError);
  });
});

describe("blank captures", () => {
  it("names black, white, transparent, background-only and one-colour pictures, and leaves real ones alone", () => {
    expect(imageStats(picture(64, 32, [], [0, 0, 0])).blank).toBe("the whole picture is black");
    expect(imageStats(picture(64, 32, [], [255, 255, 255])).blank).toBe("the whole picture is white");
    expect(imageStats(picture(64, 32, [])).blank).toMatch(/background colour rgb\(77,77,77\): nothing drawn/);
    expect(imageStats(picture(64, 32, [], [20, 90, 200])).blank).toBe("the whole picture is one colour rgb(20,90,200)");
    const clear = picture(8, 8, []);
    for (let p = 0; p < 64; p++) clear.rgba[p * 4 + 3] = 0;
    expect(imageStats(clear).blank).toMatch(/fully transparent/);
    const almost = picture(100, 100, [{ x: 0, y: 0, w: 1, h: 5, c: [255, 0, 0] }], [0, 0, 0]);
    expect(imageStats(almost).blank).toBe("99.9% of the picture is black");
    const real = picture(64, 32, [{ x: 4, y: 4, w: 20, h: 10, c: [255, 0, 0] }]);
    expect(imageStats(real).blank).toBeUndefined();
    expect(imageStats(real).meanLuma).toBeLessThan(77);
  });
});

describe("diffImages", () => {
  const scene = (labelX: number, extra: Partial<{ dark: number }> = {}) => {
    const img = picture(200, 120, [
      { x: 10, y: 10, w: 30, h: 20, c: [200, 40, 40] },
      { x: labelX, y: 90, w: 40, h: 10, c: [240, 240, 240] },
    ]);
    if (extra.dark) for (let i = 0; i < img.rgba.length; i++) if (i % 4 !== 3) img.rgba[i] = Math.max(0, img.rgba[i]! - extra.dark);
    return img;
  };

  it("finds nothing in the same picture", () => {
    const { diff } = diffImages(scene(60), scene(60));
    expect(diff).toMatchObject({ pixels: 0, percent: 0, meanShift: 0, ok: true, boxes: [], regions: [] });
    expect(diff.region).toBeUndefined();
  });

  it("finds a label that moved 12 px, with its box, its region and the move", () => {
    const { diff, image } = diffImages(scene(60), scene(72));
    expect(diff.ok).toBe(false);
    expect(diff.boxes).toHaveLength(1);
    expect(diff.boxes[0]).toMatchObject({ x0: 60, y0: 90, x1: 111, y1: 99, moved: { dx: 12, dy: 0 } });
    // 12 columns where it was and 12 where it is now.
    expect(diff.pixels).toBe(2 * 12 * 10);
    expect(diff.percent).toBe(1);
    expect(diff.regions.map((r) => r.region)).toEqual(["bottom-left", "bottom"]);
    const at = (x: number, y: number) => [...image.rgba.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 4)];
    expect(at(65, 95)).toEqual([255, 0, 0, 255]);
    expect(at(80, 95)[1]).toBe(at(80, 95)[0]);
    const text = formatDiff(diff).join("\n");
    expect(text).toContain("areas: (60,90)-(111,99) 240 px moved (12,0)");
  });

  it("does not call a removed label a move", () => {
    const gone = picture(200, 120, [{ x: 10, y: 10, w: 30, h: 20, c: [200, 40, 40] }]);
    const { diff } = diffImages(scene(60), gone);
    expect(diff.boxes[0]?.moved).toBeUndefined();
    expect(diff.boxes[0]).toMatchObject({ x0: 60, y0: 90, x1: 99, y1: 99, pixels: 400 });
  });

  it("says a picture got darker", () => {
    const { diff } = diffImages(scene(60), scene(60, { dark: 30 }));
    expect(diff.ok).toBe(false);
    expect(diff.luma.actual).toBeLessThan(diff.luma.base);
    expect(formatDiff(diff).join("\n")).toMatch(/mean brightness .* -> .* \(darker\)/);
  });

  it("ignores colour noise within the tolerance, and counts a 1 px shift", () => {
    const noisy = scene(60);
    for (let i = 0; i < noisy.rgba.length; i += 4 * 7) noisy.rgba[i] = noisy.rgba[i]! + 5;
    expect(diffImages(scene(60), noisy).diff.pixels).toBe(0);
    expect(diffImages(scene(60), noisy, { tolerance: 0 }).diff.pixels).toBeGreaterThan(0);
    expect(diffImages(scene(60), scene(61)).diff.pixels).toBe(20);
  });

  it("passes within the threshold and fails above it, and a stricter tolerance catches more", () => {
    const a = scene(60);
    const b = scene(60);
    b.rgba.set([77, 77, 120, 255], (5 * 200 + 150) * 4);
    expect(diffImages(a, b).diff).toMatchObject({ pixels: 1, ok: true, threshold: 0.5, tolerance: 3 });
    expect(diffImages(a, b, { threshold: 0 }).diff.ok).toBe(false);
    // A blue change of 13 is a distance of 4.4: over the default tolerance of 3, under 5.
    b.rgba.set([77, 77, 90, 255], (6 * 200 + 150) * 4);
    expect(diffImages(a, b).diff.pixels).toBe(2);
    expect(diffImages(a, b, { tolerance: 5 }).diff.pixels).toBe(1);
  });

  it("refuses pictures of different sizes", () => {
    expect(() => diffImages(picture(20, 10, []), picture(10, 10, []))).toThrow(PngError);
  });
});

describe("baselines", () => {
  const capture = (dir: string, img: RgbaImage, name = "shot.png") => {
    const file = join(dir, name);
    writeFileSync(file, encodePng(img.width, img.height, img.rgba, 4));
    return file;
  };
  const meta = { scene: "res://hud.tscn", width: 64, height: 32, frames: 10, renderer: "gl_compatibility", adapter: "llvmpipe A" };

  it("makes a missing baseline, then says same, then changed with a diff picture, then takes an update", () => {
    const root = tempFolder("gw-baseline-");
    const first = compareBaseline(root, "hud", capture(root, picture(64, 32, [{ x: 4, y: 4, w: 20, h: 8, c: [255, 0, 0] }])), { meta });
    const png = join(root, ".godotwright/baselines/hud.png");
    expect(first).toMatchObject({ status: "saved", ok: true, name: "hud", file: png });
    expect(first.replaced).toBeUndefined();
    expect(readBaselineMeta(root, "hud")).toMatchObject({ scene: "res://hud.tscn", width: 64 });
    expect(formatBaseline(first)[0]).toBe(`baseline hud saved: ${png}`);

    const same = compareBaseline(root, "hud", capture(root, picture(64, 32, [{ x: 4, y: 4, w: 20, h: 8, c: [255, 0, 0] }])), { meta });
    expect(same).toMatchObject({ status: "unchanged", ok: true, pixels: 0 });

    const moved = capture(root, picture(64, 32, [{ x: 30, y: 20, w: 20, h: 8, c: [255, 0, 0] }]));
    const changed = compareBaseline(root, "hud", moved, { meta: { ...meta, adapter: "llvmpipe B" } });
    const diff = join(root, ".godot/godotwright/diff/hud-diff.png");
    expect(changed).toMatchObject({ status: "changed", ok: false, diff, actual: moved });
    expect(existsSync(diff)).toBe(true);
    const text = formatBaseline(changed, "run again with --update-baseline").join("\n");
    expect(text).toContain("baseline hud CHANGED: ");
    expect(text).toContain("(changed pixels in red)");
    expect(text).toContain("if the change is intended, run again with --update-baseline");
    expect(text).toContain("made with the graphics driver llvmpipe A, this capture with llvmpipe B");

    const updated = compareBaseline(root, "hud", moved, { meta, update: true, tolerance: 30 });
    expect(updated).toMatchObject({ status: "saved", replaced: true });
    expect(existsSync(diff)).toBe(false);
    expect(readBaselineMeta(root, "hud")?.tolerance).toBe(30);
    expect(compareBaseline(root, "hud", moved, { meta }).status).toBe("unchanged");
    expect(loadBaselines(root).map((b) => b.name)).toEqual(["hud"]);
  });

  it("reports a missing baseline as a failure when it may not make one (CI), and warns about a blank capture", () => {
    const root = tempFolder("gw-baseline-");
    const r = compareBaseline(root, "menu", capture(root, picture(16, 16, [], [0, 0, 0])), { meta, createMissing: false });
    expect(r).toMatchObject({ status: "missing", ok: false, blank: "the whole picture is black" });
    expect(formatBaseline(r, "run again with --update-baseline").join("\n")).toContain(`baseline menu MISSING: ${join(root, ".godotwright/baselines/menu.png")}`);
    expect(formatBaseline(r, "run again with --update-baseline").join("\n")).toContain("Next: make it (run again with --update-baseline), then commit it.");
    expect(existsSync(join(root, ".godotwright/baselines/menu.png"))).toBe(false);
  });

  it("uses the threshold stored with the baseline, and a given folder", () => {
    const root = tempFolder("gw-baseline-");
    mkdirSync(join(root, "shots"));
    compareBaseline(root, "a", capture(root, picture(16, 16, [])), { meta, dir: "shots", threshold: 50 });
    const r = compareBaseline(root, "a", capture(root, picture(16, 16, [{ x: 0, y: 0, w: 8, h: 8, c: [0, 0, 0] }])), { meta, dir: "shots" });
    expect(r).toMatchObject({ status: "within-threshold", ok: true, file: join(root, "shots/a.png"), percent: 25, threshold: 50 });
    expect(formatBaseline(r)[0]).toMatch(/^baseline a within threshold: 25% of pixels changed \(64 px; threshold 50%, tolerance 3\)/);
  });

  it("will not write over a JSON file that is not a baseline", () => {
    const root = tempFolder("gw-baseline-");
    writeFileSync(join(root, "keep.json"), '{"keep":1}\n');
    expect(() => compareBaseline(root, "keep", capture(root, picture(16, 16, [])), { meta, dir: "." })).toThrow(/keep\.json exists and is not a baseline settings file/);
    expect(readFileSync(join(root, "keep.json"), "utf8")).toBe('{"keep":1}\n');
    expect(existsSync(join(root, "keep.png"))).toBe(false);
    // A baseline whose settings file is damaged can still be replaced: its picture shows it is a baseline.
    compareBaseline(root, "hud", capture(root, picture(16, 16, [])), { meta });
    writeFileSync(join(root, ".godotwright/baselines/hud.json"), "not json");
    expect(compareBaseline(root, "hud", capture(root, picture(16, 16, [])), { meta, update: true })).toMatchObject({ status: "saved", replaced: true });
    expect(readBaselineMeta(root, "hud")?.width).toBe(64);
  });

  it("keeps names safe as file names", () => {
    expect(baselineName("HUD / main menu.png")).toBe("HUD_main_menu");
    expect(() => baselineName("..")).toThrow(BaselineError);
  });
});
