import { describe, expect, it } from "vitest";
import { ScreenshotError, formatScreenshot, screenshotScript, takeScreenshot } from "../src/screenshot/screenshot.js";
import { makeProject } from "./helpers.js";

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

  it("refuses bad input before starting Godot", async () => {
    const root = makeProject({ "project.godot": "[application]\n" });
    await expect(takeScreenshot(root, { views: ["below" as never] })).rejects.toThrow(/not a view/);
    await expect(takeScreenshot(root, { width: 5 })).rejects.toThrow(/size must be/);
    await expect(takeScreenshot(root, { model: "nope.glb" })).rejects.toThrow(/does not exist/);
    await expect(takeScreenshot(root)).rejects.toThrow(ScreenshotError);
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
});
