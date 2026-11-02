import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng, type RgbaImage } from "../src/screenshot/png.js";
import { ScreenshotError, baselineKey, compareBaseline, formatScreenshot, screenshotScript, takeScreenshot, type ScreenshotReport } from "../src/screenshot/screenshot.js";
import { makeProject, tempFolder } from "./helpers.js";

function flat(width: number, height: number, colour: [number, number, number], box?: { x: number; y: number; w: number; h: number; colour: [number, number, number] }): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = box && x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      data.set([...(inside ? box.colour : colour), 255], (y * width + x) * 4);
    }
  return encodePng({ width, height, data } satisfies RgbaImage);
}

const REPORT: ScreenshotReport = {
  file: "/p/.godot/godotwright/screenshot.png",
  width: 320,
  height: 180,
  subject: "scene res://main.tscn",
  views: [],
  coverage: [{ view: "scene", percent: 12 }],
  autoCamera: false,
  renderer: "gl_compatibility",
  diagnostics: [],
};

describe("screenshot", () => {
  it("writes a script that loads a model at run time, frames it per view and saves one PNG", () => {
    const script = screenshotScript({ model: "/m/car.glb", views: ["front", "top"], frames: 10, out: "/o/car.png", width: 320, height: 240 });
    expect(script).toContain('const VIEWS: Array = ["front","top"]');
    expect(script).toContain('_content = _load_model("/m/car.glb")');
    expect(script).toContain("GLTFDocument.new()");
    expect(script).toContain('const OUT := "/o/car.png"');
    expect(script).toContain("sheet.save_png(OUT)");
    const scene = screenshotScript({ scene: "res://main.tscn", views: ["iso"], frames: 5, out: "/o/s.png", width: 320, height: 240 });
    expect(scene).toContain('var packed := load("res://main.tscn") as PackedScene');
  });

  it("writes a script that compiles under any project warning setting (strict typing as errors)", () => {
    const script = screenshotScript({ scene: "res://main.tscn", views: ["iso"], frames: 5, out: "/o/s.png", width: 320, height: 240 });
    const ignore = /^@warning_ignore_start\((.+)\)$/m.exec(script);
    expect(ignore).not.toBeNull();
    for (const w of ["unsafe_property_access", "unsafe_method_access", "unsafe_cast", "unsafe_call_argument", "untyped_declaration", "inferred_declaration", "return_value_discarded", "integer_division"])
      expect(ignore![1]).toContain(`"${w}"`);
    // The seed hook sets particle properties by name, so it is safe on a node typed Node even without the ignore.
    expect(script).toContain('node.set("use_fixed_seed", true)');
    expect(script).not.toMatch(/node\.(use_fixed_seed|seed)\b/);
  });

  it("refuses bad input before starting Godot", async () => {
    const root = makeProject({ "project.godot": "[application]\n" });
    await expect(takeScreenshot(root, { views: ["below" as never] })).rejects.toThrow(/not a view/);
    await expect(takeScreenshot(root, { width: 5 })).rejects.toThrow(/size must be/);
    await expect(takeScreenshot(root, { model: "nope.glb" })).rejects.toThrow(/does not exist/);
    await expect(takeScreenshot(root)).rejects.toThrow(ScreenshotError);
    await expect(takeScreenshot(root, { threshold: 150 })).rejects.toThrow(/threshold/);
    await expect(takeScreenshot(root, { tolerance: -1 })).rejects.toThrow(/tolerance/);
  });

  it("describes the picture in words: how much is drawn and where, and warns when nothing is", () => {
    const text = formatScreenshot({
      file: "/o/car.png",
      width: 1280,
      height: 360,
      subject: "model car.glb",
      views: ["front", "side"],
      coverage: [
        { view: "front", percent: 11.3, box: { x0: 214, y0: 132, x1: 426, y1: 286 } },
        { view: "side", percent: 0 },
      ],
      autoCamera: true,
      renderer: "gl_compatibility",
      diagnostics: [],
    });
    expect(text).toContain("screenshot of model car.glb: /o/car.png (1280x360, gl_compatibility renderer, camera placed by Godotwright: front, side)");
    expect(text).toContain("  front: 11.3% drawn, from (214, 132) to (426, 286)");
    expect(text).toContain("  side: 0% drawn  <- nothing drawn");
  });

  it("names an automatic baseline after the scene or model, the size and the views", () => {
    expect(baselineKey("res://main.tscn", 640, 360, ["iso"])).toBe("main_tscn@640x360_iso");
    expect(baselineKey("res://levels/level 1.tscn", 320, 180, ["front", "top"])).toBe("levels_level_1_tscn@320x180_front-top");
    expect(baselineKey("car.glb", 640, 360, ["iso"])).toBe("car_glb@640x360_iso");
  });

  it("saves the first picture as the baseline, then compares later ones with it", () => {
    const dir = tempFolder("gw-baseline-");
    const shot = join(dir, "shot.png");
    const baseline = join(dir, "baselines", "main.png");
    writeFileSync(shot, flat(160, 90, [40, 80, 120]));
    expect(compareBaseline(shot, baseline)).toEqual({ status: "saved", file: baseline, threshold: 0.5, tolerance: 3 });
    expect(readFileSync(baseline).equals(readFileSync(shot))).toBe(true);

    expect(compareBaseline(shot, baseline)).toMatchObject({ status: "unchanged", percent: 0, pixels: 0, diff: join(dir, "shot-diff.png") });

    // A 20x10 block changes colour: 1.39% of the pixels, above the default threshold of 0.5%.
    writeFileSync(shot, flat(160, 90, [40, 80, 120], { x: 100, y: 40, w: 20, h: 10, colour: [200, 40, 40] }));
    const changed = compareBaseline(shot, baseline);
    expect(changed).toMatchObject({ status: "changed", pixels: 200, percent: 1.39, region: { x: 96, y: 32, width: 32, height: 32 } });
    const diff = decodePng(readFileSync(join(dir, "shot-diff.png")));
    expect([...diff.data.subarray((45 * 160 + 110) * 4, (45 * 160 + 110) * 4 + 3)]).toEqual([255, 0, 0]);
    // The same change within a looser threshold passes, but still says where it is.
    expect(compareBaseline(shot, baseline, { threshold: 2 })).toMatchObject({ status: "unchanged", pixels: 200 });
    // A one-pixel-wide line in a slightly different colour is caught at the default tolerance.
    writeFileSync(shot, flat(160, 90, [40, 80, 120], { x: 30, y: 0, w: 1, h: 90, colour: [60, 80, 120] }));
    expect(compareBaseline(shot, baseline, { threshold: 0 })).toMatchObject({ status: "changed", pixels: 90, region: { x: 16, y: 0, width: 16, height: 90 } });

    // Accepting the change replaces the baseline.
    expect(compareBaseline(shot, baseline, { update: true })).toMatchObject({ status: "saved", replaced: true });
    expect(compareBaseline(shot, baseline)).toMatchObject({ status: "unchanged", pixels: 0 });
  });

  it("reports a baseline of another size without comparing", () => {
    const dir = tempFolder("gw-baseline-");
    const shot = join(dir, "shot.png");
    const baseline = join(dir, "base.png");
    writeFileSync(baseline, flat(160, 90, [0, 0, 0]));
    writeFileSync(shot, flat(320, 180, [0, 0, 0]));
    expect(compareBaseline(shot, baseline)).toMatchObject({ status: "size-mismatch", baselineSize: { width: 160, height: 90 } });
    expect(existsSync(join(dir, "shot-diff.png"))).toBe(false);
    writeFileSync(baseline, "not a png");
    expect(() => compareBaseline(shot, baseline)).toThrow(/cannot be read/);
  });

  it("says in words whether the picture matches its baseline, and what to do next", () => {
    const base = { file: "/p/.godotwright/baselines/main_tscn@320x180_iso.png", threshold: 0.5, tolerance: 3 };
    const saved = formatScreenshot({ ...REPORT, baseline: { status: "saved", ...base } });
    expect(saved).toContain("baseline saved: /p/.godotwright/baselines/main_tscn@320x180_iso.png");
    expect(saved.trimEnd().split("\n").at(-1)).toMatch(/^Next: /);
    const same = formatScreenshot({ ...REPORT, baseline: { status: "unchanged", ...base, diff: "/d.png", percent: 0, pixels: 0, meanShift: 0 } });
    expect(same).toContain("baseline unchanged: 0% of pixels changed (0 px; threshold 0.5%, tolerance 3)");
    expect(same).not.toContain("diff:");
    const changed = formatScreenshot({ ...REPORT, baseline: { status: "changed", ...base, diff: "/d.png", percent: 1.39, pixels: 800, region: { x: 96, y: 32, width: 32, height: 32 }, meanShift: 87.5 } });
    expect(changed).toContain("baseline CHANGED: 1.39% of pixels changed (800 px; threshold 0.5%, tolerance 3); largest change at (96, 32) size 32x32, mean shift 87.5");
    expect(changed).toContain("  diff: /d.png (changed pixels in red)");
    expect(changed).toMatch(/Next: look at the diff; if the change is intended, update the baseline/);
    const size = formatScreenshot({ ...REPORT, baseline: { status: "size-mismatch", ...base, baselineSize: { width: 640, height: 360 } } });
    expect(size).toContain("baseline size differs: the baseline is 640x360, the new picture 320x180; nothing compared");
    expect(formatScreenshot(REPORT)).toMatch(/Next: look at the picture/);
  });

  it("refuses a baseline that is not a PNG, or that is the picture itself", async () => {
    const root = makeProject({ "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n', "main.tscn": "[gd_scene format=3]\n" });
    await expect(takeScreenshot(root, { baseline: "base.txt" })).rejects.toThrow(/\.png file/);
    await expect(takeScreenshot(root, { baseline: "same.png", out: join(root, "same.png") })).rejects.toThrow(/same file/);
  });
});
