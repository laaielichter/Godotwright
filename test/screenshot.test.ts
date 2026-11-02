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

describe("screenshot baselines", () => {
  const project = () =>
    makeProject({
      "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n',
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n',
      ".godotwright/baselines/hud.json": JSON.stringify({ scene: "res://main.tscn", width: 320, height: 180, frames: 10 }),
      ".godotwright/baselines/hud.png": "x",
      ".godotwright/baselines/jump-top.json": JSON.stringify({ scene: "res://main.tscn", width: 640, height: 360, frames: 30, scenario: ".godotwright/scenarios/jump.json" }),
    });

  it("refuses to compare with other settings than the baseline's, before starting Godot", async () => {
    await expect(takeScreenshot(project(), { baseline: "hud", width: 640, godot: "/nope" })).rejects.toThrow(
      "baseline hud was taken with other settings: width 640 (baseline: 320). Leave them out to compare like for like, or pass update to replace the baseline.",
    );
    await expect(takeScreenshot(project(), { baseline: "hud", scene: "other.tscn", godot: "/nope" })).rejects.toThrow(/scene other.tscn \(baseline: res:\/\/main.tscn\)/);
  });

  it("leaves a scenario's baseline to the scenario", async () => {
    await expect(takeScreenshot(project(), { baseline: "jump-top", godot: "/nope" })).rejects.toThrow(/belongs to the scenario .godotwright\/scenarios\/jump.json/);
  });

  it("puts the blank warning and the comparison under the picture", () => {
    const text = formatScreenshot(
      {
        file: "/p/.godot/godotwright/diff/hud.actual.png",
        width: 320,
        height: 180,
        subject: "scene res://main.tscn",
        views: [],
        coverage: [{ view: "scene", percent: 0 }],
        autoCamera: false,
        renderer: "gl_compatibility",
        diagnostics: [],
        blank: "the whole picture is black",
        baseline: { name: "hud", status: "same", ok: true, baseline: ".godotwright/baselines/hud.png", actual: ".godot/godotwright/diff/hud.actual.png", notes: [], blank: "the whole picture is black" },
      },
      "run again with --update",
    );
    expect(text).toContain("  warning: the picture is blank: the whole picture is black\nbaseline hud: same\n");
    expect(text.match(/blank/g)).toHaveLength(1);
  });
});
