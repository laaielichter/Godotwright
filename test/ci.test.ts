import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCi, runCi } from "../src/ci/ci.js";
import { ScenarioError, compare, judge, loadScenarios, parseExpectation, parseScenario, runScenario } from "../src/ci/scenario.js";
import type { PlayReport } from "../src/play/play.js";
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
  const files = (extra: Record<string, string> = {}) =>
    makeProject({
      "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n',
      "main.gd": "extends Node\n\n\nfunc _ready() -> void:\n\tpass\n",
      "main.tscn": '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
      ...extra,
    });

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
    expect(ci.steps.map((s) => `${s.name}:${s.status}`)).toEqual(["review:pass", "check:pass", "test:skip", "scenarios:skip"]);
    expect(ci.ok).toBe(true);
    const text = formatCi(ci);
    expect(text).toContain("## Godotwright: all checks passed");
    expect(text).toContain("| test | ➖ no GUT or GdUnit4 in res://addons |");

    const failing = await runCi(root, {
      noGodot: true,
      deps: { review: () => ({ project: root, godot: "4.7", overall: 70, categories: [], findings: [{ rule: "api/x", category: "api", severity: "error", file: "res://main.gd", line: 4, message: "bad call" }], typing: { typed: 0, total: 0, percent: 0 } as never, scripts: 1, scenes: 0 }) },
    });
    expect(failing.ok).toBe(false);
    expect(failing.steps.map((s) => s.status)).toEqual(["fail", "skip", "skip", "skip"]);
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
    expect(ci.steps.at(-1)).toMatchObject({ name: "scenarios", status: "fail", summary: "0 of 1 scenarios passed" });
    expect(ci.steps.at(-1)?.details.join("\n")).toContain("A.b was 2 at frame 9");
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
