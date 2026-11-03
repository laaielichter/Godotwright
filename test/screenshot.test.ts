import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/mcp/server.js";
import { decodePng, encodePng, type RgbaImage } from "../src/screenshot/png.js";
import { compareBaselineFile as compareBaseline } from "../src/screenshot/baseline.js";
import { ScreenshotError, baselineKey, formatScreenshot, screenshotScript, takeScreenshot, type ScreenshotReport } from "../src/screenshot/screenshot.js";
import { makeProject, tempFolder } from "./helpers.js";

function flat(width: number, height: number, colour: [number, number, number], box?: { x: number; y: number; w: number; h: number; colour: [number, number, number] }): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inside = box && x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      rgba.set([...(inside ? box.colour : colour), 255], (y * width + x) * 4);
    }
  const img: RgbaImage = { width, height, rgba };
  return encodePng(img.width, img.height, img.rgba, 4);
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
    expect(baselineKey("res://main.tscn", 640, 360, ["iso"])).toMatch(/^main_tscn-[0-9a-f]{8}@640x360_iso$/);
    expect(baselineKey("res://main.tscn", 640, 360, ["iso"])).toBe(baselineKey("main.tscn", 640, 360, ["iso"]));
    expect(baselineKey("res://levels/level 1.tscn", 320, 180, ["front", "top"])).toMatch(/^levels_level_1_tscn-[0-9a-f]{8}@320x180_front-top$/);
    expect(baselineKey("car.glb", 640, 360, ["iso"])).toMatch(/^car_glb-[0-9a-f]{8}@640x360_iso$/);
    expect(baselineKey("res://关卡.tscn", 640, 360, ["iso"])).toMatch(/^关卡_tscn-[0-9a-f]{8}@/);
    expect(baselineKey("res://niveau_één.tscn", 640, 360, ["iso"])).toMatch(/^niveau_één_tscn-/);
  });

  it("gives every scene its own automatic baseline, also when the readable names are the same", () => {
    const pairs = [
      ["res://关卡.tscn", "res://菜单.tscn"],
      ["res://niveau_één.tscn", "res://niveau_ëën.tscn"],
      ["res://a/b_c.tscn", "res://a_b/c.tscn"],
      ["res://a b.tscn", "res://a_b.tscn"],
    ];
    for (const [a, b] of pairs) expect(baselineKey(a!, 640, 360, ["iso"])).not.toBe(baselineKey(b!, 640, 360, ["iso"]));
    // The same file written in decomposed Unicode (as macOS file names are) is the same baseline.
    expect(baselineKey("res://niveau_één.tscn", 640, 360, ["iso"])).toBe(baselineKey("res://niveau_één.tscn", 640, 360, ["iso"]));
    // A long path keeps a short name.
    expect(baselineKey(`res://${"deep/".repeat(40)}level.tscn`, 640, 360, ["iso"]).length).toBeLessThan(100);
  });

  it("saves the first picture as the baseline, then compares later ones with it", () => {
    const dir = tempFolder("gw-baseline-");
    const shot = join(dir, "shot.png");
    const baseline = join(dir, "baselines", "main.png");
    writeFileSync(shot, flat(160, 90, [40, 80, 120]));
    expect(compareBaseline(shot, baseline)).toEqual({ status: "saved", ok: true, file: baseline, threshold: 0.5, tolerance: 3 });
    expect(readFileSync(baseline).equals(readFileSync(shot))).toBe(true);

    // Not one pixel changed: no diff picture, and a stale one from an earlier compare is removed.
    writeFileSync(join(dir, "shot-diff.png"), "stale");
    const same = compareBaseline(shot, baseline);
    expect(same).toMatchObject({ status: "unchanged", percent: 0, pixels: 0 });
    expect(same.diff).toBeUndefined();
    expect(existsSync(join(dir, "shot-diff.png"))).toBe(false);

    // A 20x10 block changes colour: 1.39% of the pixels, above the default threshold of 0.5%.
    writeFileSync(shot, flat(160, 90, [40, 80, 120], { x: 100, y: 40, w: 20, h: 10, colour: [200, 40, 40] }));
    const changed = compareBaseline(shot, baseline);
    expect(changed).toMatchObject({ status: "changed", pixels: 200, percent: 1.39, region: { x: 96, y: 32, width: 32, height: 32 } });
    const diff = decodePng(readFileSync(join(dir, "shot-diff.png")));
    expect([...diff.rgba.subarray((45 * 160 + 110) * 4, (45 * 160 + 110) * 4 + 3)]).toEqual([255, 0, 0]);
    // The same change within a looser threshold passes, but is not called unchanged, and still says where it is.
    expect(compareBaseline(shot, baseline, { threshold: 2 })).toMatchObject({ status: "within-threshold", pixels: 200, diff: join(dir, "shot-diff.png"), region: { x: 96, y: 32 } });
    // The diff can go elsewhere, e.g. out of the folders Godot imports.
    const elsewhere = join(dir, ".scratch", "main-diff.png");
    expect(compareBaseline(shot, baseline, { diff: elsewhere })).toMatchObject({ status: "changed", diff: elsewhere });
    expect(existsSync(elsewhere)).toBe(true);
    // A one-pixel-wide line in a slightly different colour is caught at the default tolerance.
    writeFileSync(shot, flat(160, 90, [40, 80, 120], { x: 30, y: 0, w: 1, h: 90, colour: [60, 80, 120] }));
    expect(compareBaseline(shot, baseline, { threshold: 0 })).toMatchObject({ status: "changed", pixels: 90, region: { x: 16, y: 0, width: 16, height: 90 } });

    // Accepting the change replaces the baseline.
    expect(compareBaseline(shot, baseline, { update: true })).toMatchObject({ status: "saved", replaced: true });
    expect(compareBaseline(shot, baseline)).toMatchObject({ status: "unchanged", pixels: 0 });
    expect(existsSync(join(dir, "shot-diff.png"))).toBe(false);
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
    const base = { file: "/p/.godotwright/baselines/main_tscn-867a7a3a@320x180_iso.png", threshold: 0.5, tolerance: 3, ok: true };
    const saved = formatScreenshot({ ...REPORT, baseline: { status: "saved", ...base } });
    expect(saved).toContain("baseline saved: /p/.godotwright/baselines/main_tscn-867a7a3a@320x180_iso.png");
    expect(saved.trimEnd().split("\n").at(-1)).toMatch(/^Next: /);
    const same = formatScreenshot({ ...REPORT, baseline: { status: "unchanged", ...base, percent: 0, pixels: 0, meanShift: 0 } });
    expect(same).toContain("baseline unchanged: 0% of pixels changed (0 px; threshold 0.5%, tolerance 3)");
    expect(same).not.toContain("diff:");
    expect(same).toContain("Next: nothing to fix");
    // A small visible change under the threshold is not called a match.
    const small = formatScreenshot({ ...REPORT, baseline: { status: "within-threshold", ...base, diff: "/d.png", percent: 0.35, pixels: 800, region: { x: 0, y: 0, width: 64, height: 32 }, meanShift: 122.2 } });
    expect(small).toContain("baseline within threshold: 0.35% of pixels changed (800 px; threshold 0.5%, tolerance 3); largest change at (0, 0) size 64x32, mean shift 122.2");
    expect(small).toContain("  diff: /d.png (changed pixels in red)");
    expect(small).not.toMatch(/unchanged|nothing to fix|matches/);
    expect(small.trimEnd().split("\n").at(-1)).toMatch(/^Next: look at the diff/);
    const changed = formatScreenshot({ ...REPORT, baseline: { status: "changed", ...base, ok: false, diff: "/d.png", percent: 1.39, pixels: 800, region: { x: 96, y: 32, width: 32, height: 32 }, meanShift: 87.5 } });
    expect(changed).toContain("baseline CHANGED: 1.39% of pixels changed (800 px; threshold 0.5%, tolerance 3); largest change at (96, 32) size 32x32, mean shift 87.5");
    expect(changed).toContain("  diff: /d.png (changed pixels in red)");
    expect(changed).toMatch(/Next: look at the diff; if the change is intended, update the baseline/);
    const size = formatScreenshot({ ...REPORT, baseline: { status: "size-mismatch", ...base, ok: false, baselineSize: { width: 640, height: 360 }, actualSize: { width: 320, height: 180 } } });
    expect(size).toContain("baseline size differs: the baseline is 640x360, the new picture 320x180; nothing compared");
    expect(formatScreenshot(REPORT)).toMatch(/Next: look at the picture/);
  });

  it("refuses a baseline that is the picture itself, or a threshold or tolerance out of range", async () => {
    const root = makeProject({ "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n', "main.tscn": "[gd_scene format=3]\n" });
    await expect(takeScreenshot(root, { baseline: "auto", threshold: 101 })).rejects.toThrow(/threshold is a percent/);
    await expect(takeScreenshot(root, { baseline: "hud", tolerance: -1 })).rejects.toThrow(/tolerance is a colour distance/);
    await expect(takeScreenshot(root, { baseline: "same.png", out: join(root, "same.png") })).rejects.toThrow(/same file/);
  });

  it("keeps baselines inside the project and never writes through a link", async () => {
    const root = makeProject({ "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n', "main.tscn": "[gd_scene format=3]\n" });
    const outside = tempFolder("gw-outside-");
    const options = { godot: "/no/such/godot" };
    await expect(takeScreenshot(root, { ...options, baseline: "../evil.png" })).rejects.toThrow(/outside the project/);
    await expect(takeScreenshot(root, { ...options, baseline: join(outside, "deep", "new", "abs.png") })).rejects.toThrow(/outside the project/);
    // A link inside the project that points out is refused, whether it is the file or a folder on the way.
    symlinkSync(join(outside, "target.png"), join(root, "link.png"));
    await expect(takeScreenshot(root, { ...options, baseline: "link.png" })).rejects.toThrow(/outside the project|symbolic link/);
    symlinkSync(outside, join(root, ".godotwright"));
    await expect(takeScreenshot(root, { ...options, baseline: "auto" })).rejects.toThrow(/outside the project/);
    // A link to a file inside the project is still a link: writing through it would change that other file.
    writeFileSync(join(root, "other.png"), "x");
    symlinkSync(join(root, "other.png"), join(root, "inner.png"));
    await expect(takeScreenshot(root, { ...options, baseline: "inner.png" })).rejects.toThrow(/symbolic link/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses a baseline outside the project over MCP, before anything is written", async () => {
    const root = makeProject({ "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n', "main.tscn": "[gd_scene format=3]\n" });
    const outside = tempFolder("gw-outside-");
    const server = createServer({ tier: "premium", root, godot: "/no/such/godot" });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      for (const baseline of ["../evil.png", "res://../../evil.png", join(outside, "deep", "abs.png")]) {
        const r = (await client.callTool({ name: "godot_screenshot", arguments: { baseline } })) as { content: { text: string }[]; isError?: boolean };
        expect(r.isError).toBe(true);
        expect(r.content[0]?.text).toMatch(/outside the project/);
      }
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
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
      "baseline hud was taken with other settings: width 640 (baseline: 320). Leave them out to compare like for like, or update the baseline to replace it.",
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
        baseline: { name: "hud", status: "unchanged", ok: true, file: "/p/.godotwright/baselines/hud.png", threshold: 0.5, tolerance: 3, percent: 0, pixels: 0, meanShift: 0, actual: "/p/.godot/godotwright/diff/hud.actual.png", blank: "the whole picture is black" },
      },
      "run again with --update-baseline",
    );
    expect(text).toContain("  warning: the picture is blank: the whole picture is black\nbaseline hud unchanged: 0% of pixels changed");
    expect(text.match(/blank/g)).toHaveLength(1);
  });
});
