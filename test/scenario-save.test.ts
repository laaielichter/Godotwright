import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCi } from "../src/ci/ci.js";
import { escapeXml, frameworkSuites, toJUnit } from "../src/ci/junit.js";
import {
  ScenarioError,
  formatScenarioList,
  formatScenarios,
  judge,
  loadScenarios,
  parseScenario,
  pickScenarios,
  runScenario,
  saveScenario,
  scenarioData,
  scenarioJson,
  type ScenarioResult,
} from "../src/ci/scenario.js";
import { undoJournal } from "../src/journal/journal.js";
import type { PlayOptions, PlayReport } from "../src/play/play.js";
import { parseJUnit, type TestReport } from "../src/test/run.js";
import { makeProject } from "./helpers.js";

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

const project = () => makeProject({ "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n' });

describe("scenario files with until and signals", () => {
  it("reads until and signals, refuses a bad condition, and writes back what it read", () => {
    const data = { name: "jump", input: "10 tap jump", frames: 90, until: "Hero.velocity.y >= 0", signals: ["Hero.landed"], expect: ["Hero.landed == 1"] };
    const s = parseScenario(data, "x");
    expect(s).toMatchObject({ until: "Hero.velocity.y >= 0", signals: ["Hero.landed"] });
    expect(scenarioJson(s)).toEqual(data);
    expect(() => parseScenario({ until: "nonsense", expect: ["A.b == 1"] }, "x")).toThrow(/"until"/);
    // Old files without the new fields read as before.
    expect(scenarioJson(parseScenario({ expect: ["A.b == 1"] }, "old"))).toEqual({ name: "old", expect: ["A.b == 1"] });
  });

  it("counts a recorded signal up to the claim's frame and fails when until never held", () => {
    const s = parseScenario({ until: "Hero.y < 0", signals: ["Hero.landed"], expect: ["Hero.landed == 0 @ 5", "Hero.landed == 2", "Hero.landed >= 3"] }, "s");
    const r = judge(s, report({ 5: {}, 20: {} }, { signals: [{ frame: 6, signal: "Hero.landed", args: [] }, { frame: 20, signal: "Hero.landed", args: [] }], until: { condition: "Hero.y < 0" } }));
    expect(r.map((x) => `${x.ok} ${x.actual ?? ""} ${x.message ?? ""}`.trim())).toEqual([
      "true 0",
      "true 2",
      "false 2 Hero.landed fired 2 times by frame 20",
      "false  never held in 20 frames",
    ]);
  });

  it("passes until and signals to the run and does not sample a signal as a value", async () => {
    let seen: PlayOptions = {};
    const s = parseScenario({ until: "Hero.y < 0", signals: ["Hero.landed"], watch: ["Hero.y"], expect: ["Hero.landed == 0"] }, "s");
    const r = await runScenario("/p", "f.json", s, { play: async (_p, o) => ((seen = o ?? {}), report({ 3: {} }, { until: { condition: "Hero.y < 0", frame: 3 } })) });
    expect(seen).toMatchObject({ until: "Hero.y < 0", signals: ["Hero.landed"], watch: ["Hero.y"] });
    expect(r).toMatchObject({ ok: true, stoppedAt: 3 });
    expect(formatScenarios([r])).toContain("stopped at frame 3 (until)");
  });

  it("picks the exact name first, else every name that contains it", () => {
    const list = ["jump", "jump_high", "run"].map((name) => ({ scenario: parseScenario({ expect: ["A.b == 1"] }, name) }));
    expect(pickScenarios(list, "jump").map((s) => s.scenario.name)).toEqual(["jump"]);
    expect(pickScenarios(list, "ju").map((s) => s.scenario.name)).toEqual(["jump", "jump_high"]);
    expect(pickScenarios(list).length).toBe(3);
  });
});

describe("saving a scenario", () => {
  const passing = async () => report({ 10: { "Hero.velocity.y": "-400.0" }, 89: { "Hero.velocity.y": "0.0" } });

  it("runs it once, writes it when it passes, lists it, and godot_undo takes it back", async () => {
    const root = project();
    const data = scenarioData("jump", { input: "10 tap jump", frames: 90, signals: [], expect: ["Hero.velocity.y == -400 @ 10"] });
    const saved = await saveScenario(root, data, { play: passing });
    expect(saved.file).toBe(".godotwright/scenarios/jump.json");
    expect(JSON.parse(readFileSync(join(root, saved.file!), "utf8"))).toEqual({ name: "jump", input: "10 tap jump", frames: 90, expect: ["Hero.velocity.y == -400 @ 10"] });
    const { scenarios } = loadScenarios(root);
    expect(formatScenarioList(scenarios)).toBe('jump: main scene; 90 frames; input "10 tap jump"\n  Hero.velocity.y == -400 @ 10\n');
    await expect(saveScenario(root, data, { play: passing })).rejects.toThrow(/exists; pass overwrite/);
    expect((await saveScenario(root, data, { play: passing, overwrite: true })).file).toBeDefined();
    undoJournal(root, { steps: 2 });
    expect(existsSync(join(root, saved.file!))).toBe(false);
  });

  it("does not write a scenario that fails, and refuses bad names, input and empty claims", async () => {
    const root = project();
    const failed = await saveScenario(root, scenarioData("jump", { expect: ["Hero.velocity.y == -999 @ 10"] }), { play: passing });
    expect(failed.file).toBeUndefined();
    expect(failed.result.results[0]?.message).toBe("Hero.velocity.y was -400.0 at frame 10");
    expect(existsSync(join(root, ".godotwright/scenarios/jump.json"))).toBe(false);
    await expect(saveScenario(root, scenarioData("../x", { expect: ["A.b == 1"] }), { play: passing })).rejects.toThrow(ScenarioError);
    await expect(saveScenario(root, scenarioData("x", { expect: [] }), { play: passing })).rejects.toThrow(/at least one/);
    await expect(saveScenario(root, scenarioData("x", { input: "soon jump", expect: ["A.b == 1"] }), { play: passing })).rejects.toThrow(/"input"/);
  });
});

const GUT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="GutTests" failures="1" tests="2">
    <testsuite name="test/test_calc.gd" tests="2" failures="1" skipped="0" time="0.01" >
      <testcase name="test_adds" assertions="1" status="pass" classname="test/test_calc.gd" time="0.001"></testcase>
      <testcase name="test_fails" assertions="1" status="fail" classname="test/test_calc.gd" time="0.001">
        <failure message="failed"><![CDATA[[Failed]:  [4] expected to equal [5]:  two and two
          at line 9]]></failure>
      </testcase>
    </testsuite>
</testsuites>`;

const scenarioResult = (extra: Partial<ScenarioResult> = {}): ScenarioResult => ({
  name: "jump",
  file: ".godotwright/scenarios/jump.json",
  ok: false,
  results: [
    { expect: "Hero.velocity.y == -400 @ 10", ok: true, actual: "-400.0" },
    { expect: 'Hero/Label.text == "a<b"', ok: false, actual: "a&b", message: "Hero/Label.text was a&b at frame 89" },
  ],
  errors: [],
  finished: true,
  seconds: 1.5,
  ...extra,
});

describe("JUnit XML", () => {
  it("escapes what XML cannot hold", () => {
    expect(escapeXml(`a<b & "c" 'd'>\u0001`)).toBe("a&lt;b &amp; &quot;c&quot; &apos;d&apos;&gt;");
  });

  it("writes a suite per scenario with a case per claim, and an error case for a broken run", () => {
    const xml = toJUnit({ scenarios: [scenarioResult(), scenarioResult({ name: "crash", ok: false, results: [], errors: ["res://hero.gd:4 boom"], finished: false })] });
    expect(xml).toContain('<testsuites name="godotwright" tests="3" failures="1" errors="1" skipped="0" time="3">');
    expect(xml).toContain('<testcase classname="scenario.jump" name="Hero/Label.text == &quot;a&lt;b&quot;" file=".godotwright/scenarios/jump.json">');
    expect(xml).toContain('<failure message="Hero/Label.text was a&amp;b at frame 89">');
    expect(xml).toContain('<error message="res://hero.gd:4 boom">res://hero.gd:4 boom\nthe run ended before the last frame</error>');
    // What we write, a JUnit reader reads back.
    expect(parseJUnit(xml)).toMatchObject({ tests: 3, passed: 1, failed: 1, errors: 1 });
  });

  it("keeps the framework's suites as they are and adds review and check as cases", () => {
    const tests = { framework: "gut", xml: GUT_XML } as TestReport;
    const steps = [
      { name: "review" as const, status: "fail" as const, summary: "score 70/100, 1 errors, 0 warnings", details: ["res://main.gd:4  error  bad call"] },
      { name: "check" as const, status: "skip" as const, summary: "skipped (--no-godot-checks)", details: [] },
    ];
    const xml = toJUnit({ steps, tests, scenarios: [scenarioResult({ ok: true, results: [{ expect: "A.b == 1", ok: true }] })] });
    expect(frameworkSuites(GUT_XML)).toHaveLength(1);
    expect(xml).toContain('<testsuite name="test/test_calc.gd" tests="2" failures="1"');
    expect(xml).toContain('<skipped message="skipped (--no-godot-checks)"/>');
    expect(xml).toContain('<testsuites name="godotwright" tests="5" failures="2" errors="0" skipped="1"');
    expect(parseJUnit(xml)).toMatchObject({ tests: 5, failed: 2, skipped: 1 });
    // A test run that left no report shows up as an error, not as nothing.
    const broken = toJUnit({ tests: { framework: "gdunit", timedOut: true, exitCode: null, output: "last words" } as TestReport });
    expect(broken).toContain('<error message="the test run timed out">last words</error>');
  });

  it("comes out of ci with the full results only when asked", async () => {
    const root = makeProject({
      "project.godot": "[application]\n",
      ".godotwright/scenarios/a.json": '{"expect": ["A.b == 1"]}',
    });
    const deps = {
      check: async () => ({ godot: "g", godotVersion: "4.7.2", scripts: 0, scenes: 0, diagnostics: [], steps: [], errors: 0, warnings: 0 }),
      scenario: async () => scenarioResult(),
    };
    expect((await runCi(root, { deps })).results).toBeUndefined();
    const ci = await runCi(root, { deps, keepResults: true });
    expect(ci.results?.scenarios).toHaveLength(1);
    expect(toJUnit({ steps: ci.steps, ...ci.results })).toContain('classname="scenario.jump"');
  });
});
