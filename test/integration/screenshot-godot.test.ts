import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGlb } from "../../src/build/glb.js";
import { buildKind } from "../../src/build/generators/index.js";
import { formatScreenshot, takeScreenshot } from "../../src/screenshot/screenshot.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT and a screen (a display, or xvfb-run). CI provides both. */
const GODOT = process.env["GODOT"];
const SCREEN = process.platform !== "linux" || Boolean(process.env["DISPLAY"]) || spawnSync("which", ["xvfb-run"]).status === 0;

describe.skipIf(!GODOT || !SCREEN)("godotwright screenshot in Godot", () => {
  it("frames a built model from four sides, and every view shows it", { timeout: 300_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "godotwright-shot-"));
    writeFileSync(join(dir, "car.glb"), buildGlb(buildKind("car", {})));
    const report = await takeScreenshot(dir, { godot: GODOT, model: "car.glb", views: ["front", "side", "top", "iso"], width: 320, height: 180 });
    console.log(formatScreenshot(report));
    expect(report).toMatchObject({ width: 640, height: 360, autoCamera: true, renderer: "gl_compatibility" });
    expect(readFileSync(report.file).subarray(1, 4).toString()).toBe("PNG");
    expect(report.coverage.map((c) => c.view)).toEqual(["front", "side", "top", "iso"]);
    for (const c of report.coverage) {
      expect(c.percent).toBeGreaterThan(3);
      expect(c.percent).toBeLessThan(90);
    }
  });

  it("renders a 2D scene and finds what is drawn where", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Shot"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n\n[node name="Box" type="ColorRect" parent="."]\noffset_left = 40.0\noffset_top = 20.0\noffset_right = 120.0\noffset_bottom = 60.0\ncolor = Color(1, 0, 0, 1)\n',
    });
    const report = await takeScreenshot(root, { godot: GODOT, width: 320, height: 180 });
    console.log(formatScreenshot(report));
    expect(report.autoCamera).toBe(false);
    expect(existsSync(report.file)).toBe(true);
    const box = report.coverage[0]?.box;
    expect(box?.x0).toBeGreaterThanOrEqual(38);
    expect(box?.x1).toBeLessThanOrEqual(120);
    expect(box?.y0).toBeGreaterThanOrEqual(18);
    expect(box?.y1).toBeLessThanOrEqual(60);
  });
});
