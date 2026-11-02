import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatClaims, judgeClaims, parseExpectation } from "../src/ci/scenario.js";
import { PlayError, formatPlay, parseCondition, parseTimeline, playScene, playScript, summarizePlay } from "../src/play/play.js";
import { makeProject, runCli } from "./helpers.js";

/** A stand-in for Godot that prints two samples the way the play script does. */
function fakeGodot(dir: string, done = true): string {
  const bin = join(dir, "fake-godot.sh");
  writeFileSync(
    bin,
    `#!/bin/sh
case "$*" in *--import*) exit 0;; esac
echo 'GODOTWRIGHT_PLAY [0,{"Hero.position":"Vector2(100, 490)"}]'
echo 'hello from the game'
echo 'GODOTWRIGHT_PLAY [10,{"Hero.position":"Vector2(100, 483)"}]'
${done ? "echo GODOTWRIGHT_PLAY_DONE" : 'echo "ERROR: boom" >&2; echo "   at: _physics_process (res://hero.gd:9)" >&2'}
exit 0
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const project = () => makeProject({ "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n[input]\njump={"deadzone": 0.2, "events": []}\n', "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n\n[node name="Hero" type="Node2D" parent="."]\n' });

describe("play", () => {
  it("reads a timeline: press, release, tap and hold, in frame order", () => {
    expect(parseTimeline("40 hold right 20; 10 tap jump; 5: press Key:Space")).toEqual([
      { frame: 5, down: true, input: "Key:Space" },
      { frame: 10, down: true, input: "jump" },
      { frame: 11, down: false, input: "jump" },
      { frame: 40, down: true, input: "right" },
      { frame: 60, down: false, input: "right" },
    ]);
    expect(parseTimeline("")).toEqual([]);
    expect(() => parseTimeline("jump at 10")).toThrow(PlayError);
    expect(() => parseTimeline("10 hold right")).toThrow(/hold needs a number/);
    expect(() => parseTimeline("10 press jump 5")).toThrow(/only hold/);
  });

  it("writes a script that gives input the frame before and samples after the physics step", () => {
    const script = playScript("res://main.tscn", parseTimeline("10 tap jump; 0 press Key:Ctrl+S"), ["Hero.velocity.y", "Hero.is_on_floor()"], 60, 10);
    expect(script).toContain('const WATCH: Array = [["Hero", "velocity:y", "Hero.velocity.y"], ["Hero", "is_on_floor()", "Hero.is_on_floor()"]]');
    expect(script).toContain('\t\t10:\n\t\t\tInput.action_press("jump")');
    expect(script).toContain('\t\t11:\n\t\t\tInput.action_release("jump")');
    expect(script).toContain(`\t\t0:\n\t\t\t_key(${83}, true, false, false, true)`);
    expect(script).toContain("process_frame.connect(_on_frame_done)");
    expect(() => playScript("res://m.tscn", parseTimeline("1 press Key:Nope"), [], 10, 1)).toThrow(/not a Godot key/);
  });

  it("warns about actions that are not in the input map and nodes that are not in the scene", async () => {
    const root = project();
    const report = await playScene(root, { godot: fakeGodot(root), input: "10 tap jump; 20 tap fly", watch: ["Hero.position", "Ghost.position"] });
    expect(report.warnings).toEqual([
      '"fly" is not an input action in project.godot, so pressing it does nothing (add it with godotwright project input add)',
      "Ghost is not a node in res://main.tscn (it may be made at run time)",
    ]);
    expect(report.samples).toEqual([
      { frame: 0, values: { "Hero.position": "Vector2(100, 490)" } },
      { frame: 10, values: { "Hero.position": "Vector2(100, 483)" } },
    ]);
    expect(report.finished).toBe(true);
    const text = formatPlay(report);
    expect(text).toContain("frame  Hero.position      Ghost.position");
    expect(text).toContain("   10  Vector2(100, 483)");
    expect(text).toContain("printed:\nhello from the game");
  });

  it("finds autoloads by name, both in the warning and in the script", async () => {
    const root = makeProject({
      "project.godot": '[application]\nrun/main_scene="res://main.tscn"\n[autoload]\nScore="*res://score.gd"\n',
      "score.gd": "extends Node\n\nvar points := 0\n",
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n',
    });
    const report = await playScene(root, { godot: fakeGodot(root), watch: ["Score.points", "/root/Score.points"] });
    expect(report.warnings).toEqual([]);
    expect(playScript("res://main.tscn", [], ["Score.points"], 10, 1)).toContain("node = root.get_node_or_null(NodePath(path))");
  });

  it("says when the run did not reach the last frame, with the error", async () => {
    const root = project();
    const report = await playScene(root, { godot: fakeGodot(root, false), watch: ["Hero.position"] });
    expect(report.finished).toBe(false);
    expect(formatPlay(report)).toContain("the run did NOT reach the last frame");
    expect(formatPlay(report)).toContain("error: res://hero.gd:9  boom");
  });

  it("refuses a missing scene, no scene, and bad numbers", async () => {
    const root = project();
    await expect(playScene(root, { scene: "res://nope.tscn" })).rejects.toThrow(/does not exist/);
    await expect(playScene(makeProject({ "project.godot": "[application]\n" }))).rejects.toThrow(/no scene/);
    await expect(playScene(root, { frames: 0 })).rejects.toThrow(/frames must be/);
  });

  it("refuses captures outside the run and bad window sizes", async () => {
    const root = project();
    await expect(playScene(root, { frames: 30, captures: [{ frame: 30, out: "/tmp/x.png" }] })).rejects.toThrow("a capture at frame 30 is outside the run (frames 0 to 29)");
    await expect(playScene(root, { frames: 30, captures: [{ frame: 3, out: "/tmp/x.png" }], size: { width: 8, height: 8 } })).rejects.toThrow(/size must be/);
  });

  it("saves the picture of a capture frame after it is drawn", () => {
    const script = playScript("res://main.tscn", [], [], 60, 10, { captures: [{ frame: 40, out: "/p/.godot/godotwright/diff/hud.actual.png" }] });
    expect(script).toContain('var CAPTURES: Dictionary = {40: "/p/.godot/godotwright/diff/hud.actual.png"}');
    expect(script).toContain("RenderingServer.frame_post_draw.connect(_on_post_draw)");
    expect(script).toContain("root.get_texture().get_image().save_png(out)");
    expect(playScript("res://main.tscn", [], [], 60, 10)).toContain("var CAPTURES: Dictionary = {}");
  });

  it("runs from the CLI", async () => {
    const root = project();
    const run = await runCli(["play", root, "--godot", fakeGodot(root), "--watch", "Hero.position", "--input", "10 tap jump"]);
    expect(run.exitCode ?? 0).toBe(0);
    expect(run.output).toContain("input: 10 press jump, 11 release jump");
    const bad = await runCli(["play", root, "--godot", fakeGodot(root, false)]);
    expect(bad.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

describe("play summaries and conditions", () => {
  const report = {
    scene: "res://main.tscn",
    frames: 4,
    fps: 60,
    steps: [],
    watch: ["Hero.position.y", "Hero.is_on_floor()", "Hero.position"],
    samples: [
      { frame: 0, values: { "Hero.position.y": "5.0", "Hero.is_on_floor()": "false", "Hero.position": "Vector2(0, 5)" } },
      { frame: 1, values: { "Hero.position.y": "3.0", "Hero.is_on_floor()": "false", "Hero.position": "Vector2(0, 3)" } },
      { frame: 2, values: { "Hero.position.y": "1.0", "Hero.is_on_floor()": "true", "Hero.position": "Vector2(0, 1)" } },
      { frame: 3, values: { "Hero.position.y": "1.0", "Hero.is_on_floor()": "true", "Hero.position": "Vector2(0, 1)" } },
    ],
    diagnostics: [],
    output: "",
    warnings: [],
    finished: true,
  };

  it("gives one line per watched value", () => {
    expect(summarizePlay(report)).toEqual([
      "Hero.position.y: start 5.0, end 1.0, min 1 (frame 2), max 5 (frame 0), first change at frame 1, 2 changes in 4 samples",
      "Hero.is_on_floor(): start false, end true, first change at frame 2, 1 change in 4 samples",
      "Hero.position: start Vector2(0, 5), end Vector2(0, 1), first change at frame 1, 2 changes in 4 samples",
    ]);
  });

  it("reads conditions and refuses what it cannot read", () => {
    expect(parseCondition("Hero.is_on_floor() == true")).toEqual({ node: "Hero", prop: "is_on_floor()", op: "==", value: "true" });
    expect(parseCondition('Hud/Label.text != "Ready"')).toEqual({ node: "Hud/Label", prop: "text", op: "!=", value: "Ready" });
    expect(() => parseCondition("Hero landed")).toThrow(/cannot read the condition/);
  });

  it("puts the condition and the signals into the script it runs", () => {
    const script = playScript("res://main.tscn", [], [], 60, 10, { until: "Hero.velocity.y > 0", signals: ["Hero.landed"] });
    expect(script).toContain('var UNTIL: Array = ["Hero", "velocity:y", ">", "0"]');
    expect(script).toContain('const SIGNALS: Array = [["Hero", "landed", "Hero.landed"]]');
    expect(script).toContain("func _on_signal(...args: Array) -> void:");
  });

  it("formats claims about a run", () => {
    expect(formatClaims(judgeClaims([parseExpectation("Hero.position.y < 2"), parseExpectation("Hero.is_on_floor() == true @ 1")], report))).toBe(
      "expect: 1 of 2 FAILED\n  ok: Hero.position.y < 2 (1.0)\n  FAILED: Hero.is_on_floor() == true @ 1 (Hero.is_on_floor() was false at frame 1)\n",
    );
  });
});

describe("perf report text", () => {
  it("names the verdict, the percentiles, the slowest frames and the next step", async () => {
    const { formatPerf } = await import("../src/perf/perf.js");
    const s = { p50: 1, p95: 2, p99: 3, max: 20, mean: 1.2 };
    const text = formatPerf({
      scene: "res://main.tscn",
      frames: 100,
      warmup: 10,
      budgetMs: 16.6,
      frame: s,
      physics: { ...s, p95: 0.5 },
      process: s,
      overBudget: 1,
      spikes: [{ frame: 50, ms: 20, physicsMs: 0.1, cause: "nodes +3000 (made or freed in one frame)" }],
      nodes: { start: 2, end: 3002, max: 3002 },
      orphans: { start: 0, end: 0 },
      verdict: "ok",
      hints: ["performance/one-frame-burst: Spread spawning, building and unloading over frames"],
      run: { scene: "res://main.tscn", frames: 110, fps: 60, steps: [], watch: [], samples: [], diagnostics: [], output: "", warnings: [], finished: true },
    });
    expect(text).toMatch(/budget 16\.6 ms: OK/);
    expect(text).toMatch(/frame ms {4}p50 1 {2}p95 2 {2}p99 3 {2}max 20 {3}over budget 1 \(1%\)/);
    expect(text).toMatch(/frame 50: 20 ms \(physics 0\.1 ms\): nodes \+3000/);
    expect(text).toMatch(/one-frame-burst/);
    expect(text).toMatch(/no earlier run of this scene/);
  });
});
