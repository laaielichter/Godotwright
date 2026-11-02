import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGlb } from "../../src/build/glb.js";
import { buildKind } from "../../src/build/generators/index.js";
import { formatCi, runCi } from "../../src/ci/ci.js";
import { formatScenario, loadScenarios, runScenario } from "../../src/ci/scenario.js";
import { decodePng } from "../../src/screenshot/png.js";
import { formatScreenshot, takeScreenshot } from "../../src/screenshot/screenshot.js";
import { makeProject, tempFolder } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT and a screen (a display, or xvfb-run). CI provides both. */
const GODOT = process.env["GODOT"];
const SCREEN = process.platform !== "linux" || Boolean(process.env["DISPLAY"]) || spawnSync("which", ["xvfb-run"]).status === 0;

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** A red box that walks right while "right" is held, and a blue bar that turns with the frame time (delta). */
const game = (step = "2.0", left = 20) =>
  makeProject({
    "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Visual"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n\n[input]\n\nright={\n"deadzone": 0.2,\n"events": []\n}\n',
    "mover.gd": `extends ColorRect\n\nvar t := 0.0\n\n\nfunc _physics_process(_delta: float) -> void:\n\tif Input.is_action_pressed("right"):\n\t\tposition.x += ${step}\n\n\nfunc _process(delta: float) -> void:\n\tt += delta\n\t($Spin as ColorRect).rotation = t\n`,
    "main.tscn": `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://mover.gd" id="1"]\n\n[node name="Main" type="Node2D"]\n\n[node name="Box" type="ColorRect" parent="."]\noffset_left = ${left}.0\noffset_top = 20.0\noffset_right = ${left + 40}.0\noffset_bottom = 60.0\ncolor = Color(1, 0, 0, 1)\nscript = ExtResource("1")\n\n[node name="Spin" type="ColorRect" parent="Box"]\noffset_left = 100.0\noffset_top = 50.0\noffset_right = 140.0\noffset_bottom = 70.0\ncolor = Color(0, 0, 1, 1)\n`,
  });

/** The first red pixel on a row, to see where the box was drawn. */
function redFrom(file: string, y: number): number {
  const img = decodePng(readFileSync(file));
  for (let x = 0; x < img.width; x++) {
    const o = (y * img.width + x) * 4;
    if (img.rgba[o] === 255 && img.rgba[o + 1] === 0 && img.rgba[o + 2] === 0) return x;
  }
  return -1;
}

describe.skipIf(!GODOT || !SCREEN)("visual regression in Godot", () => {
  it("makes a baseline, finds the same picture byte for byte again (time-driven motion included), then finds a moved box", { timeout: 300_000 }, async () => {
    const root = game();
    const first = await takeScreenshot(root, { godot: GODOT, baseline: "main", width: 320, height: 180 });
    console.log(formatScreenshot(first));
    expect(first.baseline).toMatchObject({ status: "created", baseline: ".godotwright/baselines/main.png" });
    expect(first.blank).toBeUndefined();
    // The coverage compares with the clear colour, so the red box in the corner counts as drawn, not as background.
    expect(first.coverage[0]?.box).toMatchObject({ x0: 20, y0: 20 });
    expect(first.coverage[0]?.percent).toBeLessThan(10);

    const again = await takeScreenshot(root, { godot: GODOT, baseline: "main" });
    expect(again.baseline).toMatchObject({ status: "same" });
    expect(again.baseline?.diff?.changed).toBe(0);
    expect(sha(again.file)).toBe(sha(join(root, ".godotwright/baselines/main.png")));

    const scene = readFileSync(join(root, "main.tscn"), "utf8").replace("offset_left = 20.0", "offset_left = 32.0").replace("offset_right = 60.0", "offset_right = 72.0");
    writeFileSync(join(root, "main.tscn"), scene);
    const moved = await takeScreenshot(root, { godot: GODOT, baseline: "main" });
    console.log(formatScreenshot(moved));
    expect(moved.baseline).toMatchObject({ status: "changed", ok: false, diffFile: ".godot/godotwright/diff/main.diff.png" });
    const box = moved.baseline?.diff?.boxes[0];
    expect(box?.moved).toEqual({ dx: 12, dy: 0 });
    expect(box?.x0).toBeGreaterThanOrEqual(18);
    expect(box?.x0).toBeLessThanOrEqual(22);

    const updated = await takeScreenshot(root, { godot: GODOT, baseline: "main", update: true });
    expect(updated.baseline?.status).toBe("updated");
    expect((await takeScreenshot(root, { godot: GODOT, baseline: "main" })).baseline?.status).toBe("same");
  });

  it("says a picture is blank when the scene draws one black rectangle over everything", { timeout: 300_000 }, async () => {
    const root = makeProject({
      "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Black"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Control"]\nlayout_mode = 3\nanchors_preset = 15\nanchor_right = 1.0\nanchor_bottom = 1.0\n\n[node name="Black" type="ColorRect" parent="."]\nlayout_mode = 1\nanchors_preset = 15\nanchor_right = 1.0\nanchor_bottom = 1.0\ncolor = Color(0, 0, 0, 1)\n',
    });
    const report = await takeScreenshot(root, { godot: GODOT, width: 160, height: 90 });
    console.log(formatScreenshot(report));
    expect(report.blank).toBe("the whole picture is black");
    expect(formatScreenshot(report)).toContain("warning: the picture is blank: the whole picture is black");
  });

  it("compares a built model from two views like for like", { timeout: 300_000 }, async () => {
    const dir = tempFolder("godotwright-visual-");
    writeFileSync(join(dir, "car.glb"), buildGlb(buildKind("car", {})));
    const made = await takeScreenshot(dir, { godot: GODOT, model: "car.glb", views: ["front", "iso"], width: 200, height: 120, baseline: "car" });
    expect(made.baseline?.status).toBe("created");
    expect(JSON.parse(readFileSync(join(dir, ".godotwright/baselines/car.json"), "utf8"))).toMatchObject({ model: "car.glb", views: ["front", "iso"], width: 200, height: 120 });
    const same = await takeScreenshot(dir, { godot: GODOT, baseline: "car" });
    expect(same.baseline?.status).toBe("same");
    expect(same.width).toBe(400);
  });

  it("captures the frame a scenario names, compares it, and the CI receipt reports the visual change", { timeout: 300_000 }, async () => {
    const root = game();
    mkdirSync(join(root, ".godotwright/scenarios"), { recursive: true });
    writeFileSync(
      join(root, ".godotwright/scenarios/walk.json"),
      JSON.stringify({ input: "0 hold right 20", frames: 40, expect: ["Box.position.x == 60 @ 30"], screenshots: ["walk-start @ 0", "walk-end @ 30"], size: "320x180" }),
    );
    const { scenarios } = loadScenarios(root);
    const { file, scenario } = scenarios[0]!;
    const first = await runScenario(root, file, scenario, { godot: GODOT });
    console.log(formatScenario(first));
    expect(first.ok).toBe(true);
    expect(first.screenshots?.map((s) => s.status)).toEqual(["created", "created"]);
    // Frame 0 already holds right once (input goes in before the first physics step); frame 30 is after 20 steps of 2 px.
    expect(redFrom(join(root, ".godotwright/baselines/walk-start.png"), 40)).toBe(22);
    expect(redFrom(join(root, ".godotwright/baselines/walk-end.png"), 40)).toBe(60);

    const ok = await runCi(root, { godot: GODOT });
    console.log(formatCi(ok));
    expect(ok.steps.map((s) => `${s.name}:${s.status}`)).toEqual(["review:pass", "check:pass", "test:skip", "scenarios:pass", "visual:pass"]);
    expect(ok.steps.at(-1)?.summary).toBe("2 of 2 baselines unchanged");

    writeFileSync(join(root, "mover.gd"), readFileSync(join(root, "mover.gd"), "utf8").replace("position.x += 2.0", "position.x += 2.5"));
    writeFileSync(join(root, ".godotwright/scenarios/walk.json"), JSON.stringify({ input: "0 hold right 20", frames: 40, expect: ["Box.position.x > 0"], screenshots: ["walk-start @ 0", "walk-end @ 30"], size: "320x180" }));
    const bad = await runCi(root, { godot: GODOT });
    console.log(formatCi(bad));
    expect(bad.ok).toBe(false);
    expect(bad.steps.map((s) => `${s.name}:${s.status}`)).toEqual(["review:pass", "check:pass", "test:skip", "scenarios:pass", "visual:fail"]);
    const details = bad.steps.at(-1)!.details.join("\n");
    expect(details).toContain("FAIL screenshot walk-end @ 30 (CHANGED)");
    expect(details).toContain("moved (10,0)");
    expect(details).not.toContain("walk-start");
  });
});
