import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlayError, formatPlay, parseTimeline, playScene, playScript } from "../src/play/play.js";
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
    expect(playScript("res://main.tscn", [], ["Score.points"], 10, 1)).toContain("node = root.get_node_or_null(NodePath(w[0]))");
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
