import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatPerf, perfScene } from "../../src/perf/perf.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

describe.skipIf(!GODOT)("godotwright perf in Godot", () => {
  it("finds the frames that make thousands of nodes at once, names the cause and compares with the last run", { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-perf-"));
    writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="Perf"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n');
    writeFileSync(join(root, "main.tscn"), '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://spawner.gd" id="1"]\n\n[node name="Main" type="Node3D"]\nscript = ExtResource("1")\n');
    writeFileSync(join(root, "spawner.gd"), "extends Node3D\n\nvar frame := 0\n\n\nfunc _process(_delta: float) -> void:\n\tframe += 1\n\tif frame % 100 == 0:\n\t\tfor i in 3000:\n\t\t\tadd_child(Node3D.new())\n");
    const first = await perfScene(root, { godot: GODOT, frames: 250, warmup: 20 });
    console.log(formatPerf(first));
    expect(first.run.finished).toBe(true);
    expect(first.frames).toBeGreaterThan(240);
    expect(first.frame.p50).toBeGreaterThan(0);
    expect(first.spikes.map((s) => s.frame).sort()).toEqual(expect.arrayContaining([99, 199]));
    expect(first.spikes[0]!.cause).toMatch(/^nodes \+3000/);
    expect(first.nodes.end - first.nodes.start).toBeGreaterThanOrEqual(6000);
    expect(first.hints.join("\n")).toMatch(/performance\/one-frame-burst/);
    expect(first.baseline).toBeUndefined();
    const second = await perfScene(root, { godot: GODOT, frames: 250, warmup: 20 });
    expect(second.baseline?.frame.p95).toBe(first.frame.p95);
    expect(formatPerf(second)).toMatch(/vs last run/);
  });
});
