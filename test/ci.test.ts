import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCi, runCi } from "../src/ci/ci.js";
import { ScenarioError, behaviourOk, compare, formatScenario, judge, loadScenarios, parseExpectation, parseScenario, runScenario, type Scenario, type ScenarioRunOptions } from "../src/ci/scenario.js";
import type { PlayOptions, PlayReport, playScene } from "../src/play/play.js";
import { compareBaseline, readBaselineMeta } from "../src/screenshot/baseline.js";
import { encodePng } from "../src/screenshot/png.js";
import type { ScreenshotOptions, takeScreenshot } from "../src/screenshot/screenshot.js";
import { makeProject, runCli } from "./helpers.js";

const report = (samples: Record<number, Record<string, string>>, extra: Partial<PlayReport> = {}): PlayReport => ({
  scene: "res://main.tscn",
  frames: 30,
  fps: 60,
  steps: [],
  watch: [],
  samples: Object.entries(samples).map(([frame, values]) => ({ frame: Number(frame), values })),
  diagnostics: [],
  output: "",
  warnings: [],
  finished: true,
  ...extra,
});

const files = (extra: Record<string, string> = {}) =>
  makeProject({
    "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n',
    "main.gd": "extends Node\n\n\nfunc _ready() -> void:\n\tpass\n",
    "main.tscn": '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
    ...extra,
  });

describe("scenario expectations", () => {
  it("reads watch, operator, value and frame", () => {
    expect(parseExpectation("Hero.position.x >= 100 @ 25")).toMatchObject({ watch: "Hero.position.x", op: ">=", value: "100", frame: 25 });
    expect(parseExpectation("Hero.is_on_floor() == true")).toMatchObject({ watch: "Hero.is_on_floor()", op: "==", value: "true" });
    expect(parseExpectation('HUD/Label.text == "HP 2" @ 40')).toMatchObject({ watch: "HUD/Label.text", value: "HP 2", frame: 40 });
    expect(() => parseExpectation("Hero.health is 2")).toThrow(ScenarioError);
  });

  it("compares as numbers when both are numbers, otherwise as text", () => {
    expect(compare("3.0", "==", "3")).toBe(true);
    expect(compare("2", "<", "10")).toBe(true);
    expect(compare("true", "==", "true")).toBe(true);
    expect(compare("(1, 2)", "!=", "(1, 3)")).toBe(true);
    expect(compare("abc", ">", "abb")).toBe(false);
  });

  it("refuses a scenario without expectations or with a wrong field", () => {
    expect(() => parseScenario({ scene: "res://a.tscn" }, "x")).toThrow(/at least one/);
    expect(() => parseScenario({ expect: ["A.b == 1"], frames: 0 }, "x")).toThrow(/frames/);
    expect(() => parseScenario([], "x")).toThrow(/object/);
    expect(parseScenario({ expect: ["A.b == 1"] }, "fallback").name).toBe("fallback");
  });
});

describe("judging a run", () => {
  const scenario = parseScenario({ expect: ["Hero.health == 2 @ 10", "Hero.health == 3 @ 5", "Hero.x > 0", "Nope.y == 1 @ 5", "Hero.health == 2 @ 99"] }, "s");
  it("names what was wrong, and uses the last sample when no frame is given", () => {
    const r = judge(scenario, report({ 5: { "Hero.health": "3", "Hero.x": "1" }, 10: { "Hero.health": "1", "Hero.x": "9" } }));
    expect(r.map((x) => x.ok)).toEqual([false, true, true, false, false]);
    expect(r[0]?.message).toBe("Hero.health was 1 at frame 10");
    expect(r[3]?.message).toBe("Nope.y was not sampled");
    expect(r[4]?.message).toBe("frame 99 was not reached");
  });

  it("runs a scenario with every=1 and fails it on a game error or an unfinished run", async () => {
    let seen: Record<string, unknown> = {};
    const s = parseScenario({ scene: "res://main.tscn", input: "5 tap jump", expect: ["Hero.health == 3 @ 20"] }, "jump");
    const ok = await runScenario("/p", "f.json", s, { play: async (_p, o) => ((seen = o as Record<string, unknown>), report({ 20: { "Hero.health": "3" } })) });
    expect(ok.ok).toBe(true);
    expect(seen).toMatchObject({ scene: "res://main.tscn", input: "5 tap jump", watch: ["Hero.health"], every: 1, frames: 120 });
    const bad = await runScenario("/p", "f.json", s, { play: async () => report({ 20: { "Hero.health": "3" } }, { finished: false, diagnostics: [{ severity: "error", file: "res://a.gd", line: 3, message: "boom", source: "run" }] }) });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toEqual(["res://a.gd:3 boom"]);
  });
});

describe("godotwright ci", () => {
  it("loads scenario files from the project", () => {
    const root = files({ ".godotwright/scenarios/a.json": '{"expect": ["A.b == 1"]}', ".godotwright/scenarios/b.json": '{"name": "second", "expect": ["A.b == 2"]}' });
    const { scenarios } = loadScenarios(root);
    expect(scenarios.map((s) => `${s.file} ${s.scenario.name}`)).toEqual([".godotwright/scenarios/a.json a", ".godotwright/scenarios/b.json second"]);
    mkdirSync(join(root, ".godotwright/scenarios"), { recursive: true });
    writeFileSync(join(root, ".godotwright/scenarios/c.json"), "{nope");
    expect(() => loadScenarios(root)).toThrow(/c\.json/);
  });

  it("skips what has nothing to run, fails on a review error, and prints one table", async () => {
    const root = files();
    const ci = await runCi(root, {
      deps: {
        check: async () => ({ godot: "g", godotVersion: "4.7.2", scripts: 1, scenes: 0, diagnostics: [], steps: [], errors: 0, warnings: 0 }),
      },
    });
    expect(ci.steps.map((s) => `${s.name}:${s.status}`)).toEqual(["review:pass", "check:pass", "test:skip", "scenarios:skip", "visual:skip"]);
    expect(ci.ok).toBe(true);
    const text = formatCi(ci);
    expect(text).toContain("## Godotwright: all checks passed");
    expect(text).toContain("| test | ➖ no GUT or GdUnit4 in res://addons |");

    const failing = await runCi(root, {
      noGodot: true,
      deps: { review: () => ({ project: root, godot: "4.7", overall: 70, categories: [], findings: [{ rule: "api/x", category: "api", severity: "error", file: "res://main.gd", line: 4, message: "bad call" }], typing: { typed: 0, total: 0, percent: 0 } as never, scripts: 1, scenes: 0 }) },
    });
    expect(failing.ok).toBe(false);
    expect(failing.steps.map((s) => s.status)).toEqual(["fail", "skip", "skip", "skip", "skip"]);
    expect(formatCi(failing)).toContain("res://main.gd:4");
  });

  it("runs scenarios through the injected runner and fails when one fails", async () => {
    const root = files({ ".godotwright/scenarios/a.json": '{"expect": ["A.b == 1"]}' });
    const ci = await runCi(root, {
      deps: {
        check: async () => ({ godot: "g", godotVersion: "4.7.2", scripts: 1, scenes: 0, diagnostics: [], steps: [], errors: 0, warnings: 0 }),
        scenario: async (_r, file, s) => ({ name: s.name, file, ok: false, results: [{ expect: "A.b == 1", ok: false, message: "A.b was 2 at frame 9" }], errors: [], finished: true }),
      },
    });
    expect(ci.ok).toBe(false);
    const step = ci.steps.find((x) => x.name === "scenarios");
    expect(step).toMatchObject({ status: "fail", summary: "0 of 1 scenarios passed" });
    expect(step?.details.join("\n")).toContain("A.b was 2 at frame 9");
  });

  it("runs from the command line without Godot and exits 0 when the review is clean", async () => {
    const root = files();
    const run = await runCli(["ci", root, "--no-godot-checks"]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("| review |");
    const json = JSON.parse((await runCli(["ci", root, "--no-godot-checks", "--json"])).output) as { ok: boolean };
    expect(json.ok).toBe(true);
    process.exitCode = undefined;
  });
});

describe("screenshots in scenarios and the visual step", () => {
  const png = (w: number, h: number, box?: { x: number; y: number }) => {
    const rgba = new Uint8Array(w * h * 4);
    for (let p = 0; p < w * h; p++) rgba.set([77, 77, 77, 255], p * 4);
    if (box) for (let y = box.y; y < box.y + 6; y++) for (let x = box.x; x < box.x + 10; x++) rgba.set([255, 0, 0, 255], (y * w + x) * 4);
    return encodePng(w, h, rgba, 4);
  };
  /** A play run that "draws" a red box at x on every frame it is asked to capture. */
  const fakePlay = (x: number, seen: Record<string, unknown>[] = []) =>
    (async (_p: string, o: PlayOptions) => {
      seen.push(o as Record<string, unknown>);
      for (const c of o.captures ?? []) {
        mkdirSync(dirname(c.out), { recursive: true });
        writeFileSync(c.out, png(o.size!.width, o.size!.height, { x, y: 10 }));
      }
      return report({ 20: { "Hero.health": "3" } }, { captures: (o.captures ?? []).map((c) => ({ frame: c.frame, file: c.out })) });
    }) as typeof playScene;

  it("reads screenshot steps as text or objects, with a window size", () => {
    const s = parseScenario({ screenshots: ["hud @ 60", { name: "menu", frame: 5, tolerance: 30, maxChanged: 1 }], size: "320x180" }, "x");
    expect(s.screenshots).toEqual([{ name: "hud", frame: 60 }, { name: "menu", frame: 5, tolerance: 30, maxChanged: 1 }]);
    expect(s.size).toEqual({ width: 320, height: 180 });
    expect(() => parseScenario({ screenshots: ["hud at 60"] }, "x")).toThrow(/<name> @ <frame>/);
    expect(() => parseScenario({ screenshots: ["a @ 1", "a @ 2"] }, "x")).toThrow(/two screenshots/);
    expect(() => parseScenario({ screenshots: [{ name: "a", frame: 1, tolerance: 300 }] }, "x")).toThrow(/tolerance/);
    expect(() => parseScenario({ screenshots: ["a @ 1"], size: "big" }, "x")).toThrow(/size/);
  });

  it("captures the frames, makes missing baselines, then fails with the diff when the picture changes", async () => {
    const root = makeProject({ "project.godot": "[application]\n" });
    const s = parseScenario({ input: "5 hold right 30", expect: ["Hero.health == 3 @ 20"], screenshots: ["hud @ 40"], size: "64x32" }, "walk");
    const seen: Record<string, unknown>[] = [];
    const first = await runScenario(root, ".godotwright/scenarios/walk.json", s, { play: fakePlay(10, seen) });
    expect(seen[0]).toMatchObject({ frames: 120, size: { width: 64, height: 32 }, captures: [{ frame: 40 }] });
    expect(first.ok).toBe(true);
    expect(first.screenshots?.[0]).toMatchObject({ name: "hud", frame: 40, status: "created" });
    expect(readBaselineMeta(root, "hud")).toMatchObject({ width: 64, height: 32, frames: 40, scenario: ".godotwright/scenarios/walk.json" });
    expect(formatScenario(first)).toContain("  ok   screenshot hud @ 40 (created .godotwright/baselines/hud.png (commit it))");

    const same = await runScenario(root, "walk.json", parseScenario({ expect: ["Hero.health == 3 @ 20"], screenshots: ["hud @ 40"] }, "walk"), { play: fakePlay(10, seen) });
    expect(seen[1]).toMatchObject({ size: { width: 64, height: 32 } });
    expect(same.screenshots?.[0]?.status).toBe("same");

    const moved = await runScenario(root, "walk.json", s, { play: fakePlay(18) });
    expect(moved.ok).toBe(false);
    expect(behaviourOk(moved)).toBe(true);
    const text = formatScenario(moved);
    expect(text).toContain("  FAIL screenshot hud @ 40 (CHANGED)");
    expect(text).toContain("moved (8,0)");
    expect(formatScenario(moved, { screenshots: false })).not.toContain("screenshot");

    const updated = await runScenario(root, "walk.json", s, { play: fakePlay(18), update: true });
    expect(updated.screenshots?.[0]?.status).toBe("updated");
  });

  it("fails a screenshot whose frame was never drawn, and one whose baseline is missing in CI", async () => {
    const root = makeProject({ "project.godot": "[application]\n" });
    const s = parseScenario({ screenshots: ["late @ 50"], frames: 40 }, "s");
    const r = await runScenario(root, "s.json", s, { play: fakePlay(10) });
    expect(r.screenshots?.[0]).toMatchObject({ status: "failed", notes: ["frame 50 is after the last frame (39)"] });
    const ci = await runScenario(root, "s.json", parseScenario({ screenshots: ["new @ 5"] }, "s"), { play: fakePlay(10), createMissing: false });
    expect(ci.screenshots?.[0]).toMatchObject({ status: "missing", ok: false });
  });

  it("puts screenshot baselines and scenario screenshots in one visual step of the receipt", async () => {
    const root = files({ ".godotwright/scenarios/a.json": '{"expect": ["Hero.health == 3 @ 20"], "screenshots": ["hud @ 40"], "size": "64x32"}' });
    // A baseline for the scenario, and one for godotwright screenshot.
    await runScenario(root, ".godotwright/scenarios/a.json", loadScenarios(root).scenarios[0]!.scenario, { play: fakePlay(10) });
    mkdirSync(join(root, ".godotwright/baselines"), { recursive: true });
    writeFileSync(join(root, ".godotwright/baselines/title.png"), png(64, 32, { x: 2, y: 2 }));
    writeFileSync(join(root, ".godotwright/baselines/title.json"), JSON.stringify({ scene: "res://main.tscn", width: 64, height: 32, frames: 10 }));
    const shots: unknown[] = [];
    const deps = {
      check: async () => ({ godot: "g", godotVersion: "4.7.2", scripts: 1, scenes: 0, diagnostics: [], steps: [], errors: 0, warnings: 0 }),
      scenario: (r: string, f: string, s: Scenario, o?: ScenarioRunOptions) => runScenario(r, f, s, { ...o, play: fakePlay(30) }),
      screenshot: (async (p: string, o: ScreenshotOptions) => {
        shots.push(o);
        const file = join(p, ".godot/godotwright/diff/title.actual.png");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, png(64, 32, { x: 2, y: 2 }));
        return { file, width: 64, height: 32, subject: "scene", views: [], coverage: [], autoCamera: false, renderer: "gl_compatibility", diagnostics: [], baseline: compareBaseline(p, "title", file, { meta: { width: 64, height: 32, frames: 10 }, createMissing: false }) };
      }) as typeof takeScreenshot,
    };
    const ci = await runCi(root, { deps });
    expect(shots).toEqual([expect.objectContaining({ baseline: "title", createMissing: false })]);
    expect(ci.steps.map((x) => `${x.name}:${x.status}`)).toEqual(["review:pass", "check:pass", "test:skip", "scenarios:pass", "visual:fail"]);
    const visual = ci.steps.at(-1)!;
    expect(visual.summary).toBe("1 of 2 baselines unchanged, 1 changed");
    const text = visual.details.join("\n");
    expect(text).toContain(".godotwright/scenarios/a.json:");
    expect(text).toContain("  FAIL screenshot hud @ 40 (CHANGED)");
    expect(text).toContain("intended? godotwright scenario --update to accept it");
    expect(text).toContain("diff pictures (changed pixels magenta) and new captures are in .godot/godotwright/diff/");
    expect(formatCi(ci)).toContain("| visual | ❌ 1 of 2 baselines unchanged, 1 changed |");
  });
});
