import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildGlb } from "../../src/build/glb.js";
import { MATERIALS } from "../../src/build/materials.js";
import { box } from "../../src/build/shapes.js";
import { buildSpec } from "../../src/build/spec.js";
import { PATTERN_NAMES, PATTERNS, TEXTURE_SIZE, encodePng, normalMap, texturesFor } from "../../src/build/textures.js";
import { loadGltf } from "../../src/model/gltf.js";
import { imageSize } from "../../src/model/images.js";
import { inspectModel } from "../../src/model/inspect.js";
import { lintModelFile } from "../../src/model/lint.js";
import { runCli } from "../helpers.js";
import { sha, single, writeScene } from "./helpers.js";

/** Decodes the 8-bit RGB PNGs encodePng writes (all five row filters). */
function decodePng(png: Buffer): { width: number; height: number; rgb: Uint8Array } {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o), type = png.toString("latin1", o + 4, o + 8);
    if (type === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3, rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= 3 ? rgb[y * stride + i - 3]! : 0, b = y > 0 ? rgb[(y - 1) * stride + i]! : 0, c = i >= 3 && y > 0 ? rgb[(y - 1) * stride + i - 3]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      rgb[y * stride + i] = (x + pred) & 0xff;
    }
  }
  return { width, height, rgb };
}

describe("PNG encoder", () => {
  it("writes a PNG that decodes to the same pixels", () => {
    const rgb = new Uint8Array(16 * 8 * 3).map((_, i) => (i * 37 + (i >> 5) * 11) & 0xff);
    const png = encodePng(16, 8, rgb);
    expect(imageSize(png)).toEqual({ width: 16, height: 8, format: "png" });
    expect(Buffer.from(decodePng(png).rgb)).toEqual(Buffer.from(rgb));
  });
});

describe("texture patterns", () => {
  it.each(PATTERN_NAMES)("%s: tiles without a seam, is deterministic, and its colour follows the material", (name) => {
    const n = TEXTURE_SIZE;
    const out = PATTERNS[name]!.make(n, [0.4, 0.3, 0.2]);
    // Along each axis, the step across the wrap is no bigger than the biggest step between neighbours inside: no seam.
    const h = (x: number, y: number) => out.height[y * n + x]!;
    for (const axis of [0, 1]) {
      const at = (i: number, j: number) => (axis === 0 ? h(i, j) : h(j, i));
      let inside = 0, across = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i + 1 < n; i++) inside = Math.max(inside, Math.abs(at(i + 1, j) - at(i, j)));
        across = Math.max(across, Math.abs(at(0, j) - at(n - 1, j)));
      }
      expect(across, `${name}, axis ${axis}`).toBeLessThanOrEqual(inside * 1.05 + 1e-6);
    }
    expect(sha(texturesFor(name, [0.4, 0.3, 0.2]).albedo)).toBe(sha(texturesFor(name, [0.4, 0.3, 0.2]).albedo));
    expect(sha(texturesFor(name, [0.4, 0.3, 0.2]).albedo)).not.toBe(sha(texturesFor(name, [0.1, 0.3, 0.6]).albedo));
    const mean = [0, 1, 2].map((k) => out.albedo.reduce((sum, v, i) => (i % 3 === k ? sum + v : sum), 0) / (n * n));
    expect(mean[0]! > mean[2]!, `${name}: a brown material stays more red than blue`).toBe(true);
  });

  it("makes a normal map that tilts towards the top of the image on a slope that rises upwards", () => {
    const n = 8;
    const height = new Float32Array(n * n).map((_, i) => 1 - Math.floor(i / n) / n);
    const map = normalMap(height, n, 1);
    const pixel = (x: number, y: number) => [...map.subarray((y * n + x) * 3, (y * n + x) * 3 + 3)];
    // Rising towards row 0 (the top) means the surface faces down, away from the top: green below 128.
    expect(pixel(3, 3)[1]).toBeLessThan(128);
    expect(pixel(3, 3)[0]).toBe(128);
    expect(pixel(3, 3)[2]).toBeGreaterThan(200);
  });

  it("refuses an unknown pattern", () => {
    expect(() => texturesFor("plaid", [1, 1, 1])).toThrow(/unknown texture pattern/);
  });
});

describe("textured materials in the .glb", () => {
  it("embeds a colour map and a normal map, repeats them per metre, and lints clean", () => {
    const glb = buildGlb(single(box([0, 0, 0], [4, 3, 0.2], "brick")));
    const path = writeScene(single(box([0, 0, 0], [4, 3, 0.2], "brick")));
    const json = loadGltf(path).json as unknown as {
      extensionsUsed: string[];
      images: { mimeType: string }[];
      materials: { pbrMetallicRoughness: { baseColorFactor: number[]; baseColorTexture: { index: number; extensions: { KHR_texture_transform: { scale: number[] } } } }; normalTexture: { index: number } }[];
      samplers: { wrapS: number }[];
    };
    expect(glb.length).toBeGreaterThan(10_000);
    expect(json.extensionsUsed).toEqual(["KHR_texture_transform"]);
    expect(json.images.map((i) => i.mimeType)).toEqual(["image/png", "image/png"]);
    expect(json.samplers[0]!.wrapS).toBe(10497);
    const mat = json.materials[0]!;
    expect(mat.pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 1]);
    expect(mat.pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.scale[0]).toBeCloseTo(4 / PATTERNS["brick"]!.tile);
    expect(mat.normalTexture.index).not.toBe(mat.pbrMetallicRoughness.baseColorTexture.index);
    const info = inspectModel(path);
    expect(info.textures.map((t) => [t.width, t.height])).toEqual([[TEXTURE_SIZE, TEXTURE_SIZE], [TEXTURE_SIZE, TEXTURE_SIZE]]);
    expect(lintModelFile(path).findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("stores each texture once when several materials and meshes share it", () => {
    const scene = { nodes: [{ name: "A", mesh: box([0, 0, 0], [1, 1, 1], "brick") }, { name: "B", mesh: box([2, 0, 0], [3, 1, 1], "brick").merge(box([4, 0, 0], [5, 1, 1], "wood")) }] };
    const json = loadGltf(writeScene(scene)).json;
    expect(json.images?.length).toBe(4);
  });

  it("writes plain colours instead when textures are turned off, from the CLI too", async () => {
    const glb = buildGlb(single(box([0, 0, 0], [1, 1, 1], "brick")), { textures: false });
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as Record<string, unknown> & { materials: { pbrMetallicRoughness: { baseColorFactor: number[] } }[] };
    expect(json["images"]).toBeUndefined();
    expect(json.materials[0]!.pbrMetallicRoughness.baseColorFactor).toEqual(MATERIALS["brick"]!.color);
    const out = writeScene(single(box([0, 0, 0], [1, 1, 1], "brick"))).replace("model.glb", "plain.glb");
    const run = await runCli(["model", "build", "barn", "--no-textures", "-o", out]);
    expect(run.exitCode).toBe(0);
    expect(loadGltf(out).json.images).toBeUndefined();
  });

  it("leaves untextured presets as plain colours, with no extension", () => {
    const json = loadGltf(writeScene(single(box([0, 0, 0], [1, 1, 1], "paint")))).json as unknown as Record<string, unknown>;
    expect(json["images"]).toBeUndefined();
    expect(json["extensionsUsed"]).toBeUndefined();
  });

  it("draws a pattern in the colour of a custom material from a spec, and refuses an unknown one", () => {
    const spec = (texture: string) => ({ version: 1, materials: { blue_door: { color: [0.05, 0.1, 0.4], texture } }, nodes: [{ name: "Door", shape: "box", material: "blue_door", size: [1, 2, 0.05] }] });
    const json = loadGltf(writeScene(buildSpec(spec("wood")))).json;
    expect(json.images?.length).toBe(2);
    expect(() => buildSpec(spec("plaid"))).toThrow(/texture: use one of/);
  });

  it("every preset with a texture names a pattern that exists", () => {
    for (const m of Object.values(MATERIALS)) if (m.texture) expect(PATTERN_NAMES, m.name).toContain(m.texture);
  });
});
