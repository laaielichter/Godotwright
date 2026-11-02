import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";
import { formatLeaks, leakScene } from "../../src/perf/leaks.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

const LEAKY = [
  "extends Node3D",
  "",
  "static var registry: Array = []",
  "",
  "",
  "func _ready() -> void:",
  "\tvar m := MeshInstance3D.new()",
  "\tadd_child(m)",
  "\tremove_child(m)",
  "\tregistry.append(StandardMaterial3D.new())",
  "\tvar o := Object.new()",
  "\tvar holder := Node.new()",
  "\tholder.add_child(Node2D.new())",
  "\tholder.add_child(Node2D.new())",
  "\tadd_child(holder)",
  "\tremove_child(holder)",
  "\tvar stray := Node3D.new()",
  "\tget_tree().root.add_child.call_deferred(stray)",
  "",
].join("\n");

const FIXED = [
  "extends Node3D",
  "",
  "static var registry: Array = []",
  "var _stray: Node3D",
  "",
  "",
  "func _ready() -> void:",
  "\tvar m := MeshInstance3D.new()",
  "\tadd_child(m)",
  "\tremove_child(m)",
  "\tm.queue_free()",
  "\tregistry.clear()",
  "\tregistry.append(StandardMaterial3D.new())",
  "\tvar o := Object.new()",
  "\to.free()",
  "\t_stray = Node3D.new()",
  "\tget_tree().root.add_child.call_deferred(_stray)",
  "\t# A tween made and finished every cycle is not a leak.",
  "\tget_tree().create_tween().tween_interval(0.05)",
  "",
  "",
  "func _exit_tree() -> void:",
  "\t_stray.queue_free()",
  "",
].join("\n");

function project(script: string): string {
  const root = mkdtempSync(join(tmpdir(), "godotwright-leaks-"));
  writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="Leaks"\nrun/main_scene="res://chunk.tscn"\nconfig/features=PackedStringArray("4.7")\n');
  writeFileSync(join(root, "chunk.tscn"), '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://chunk.gd" id="1"]\n\n[node name="Chunk" type="Node3D"]\nscript = ExtResource("1")\n');
  writeFileSync(join(root, "chunk.gd"), script);
  return root;
}

describe.skipIf(!GODOT)("godotwright leaks in Godot", () => {
  it("names every leak of a chunk scene per cycle, with the line that makes it", { timeout: 300_000 }, async () => {
    const root = project(LEAKY);
    const r = await leakScene(root, { godot: GODOT, cycleFrames: 10 });
    console.log(formatLeaks(r));
    expect(r.run.finished).toBe(true);
    expect(r.run.snapshots).toHaveLength(5);
    expect(r.verdict).toBe("leaking");
    // Per cycle: 1 MeshInstance3D, a Node with 2 Node2D children, 1 node under the root, 1 Object, 1 material = 7 objects.
    expect(r.objects.perCycle).toBe(7);
    expect(r.orphanNodes.perCycle).toBe(4);
    expect(r.nodes.perCycle).toBe(1);
    expect(r.nonNode.perCycle).toBe(2);
    const mesh = r.groups.find((g) => g.kind === "orphan" && g.class === "MeshInstance3D")!;
    expect(mesh).toMatchObject({ where: "/root/Chunk", whereScript: "res://chunk.gd", roots: { perCycle: 1, growing: true } });
    expect(mesh.sites).toEqual(["res://chunk.gd:7  var m := MeshInstance3D.new()"]);
    expect(mesh.removedAt).toEqual(["res://chunk.gd:9  remove_child(m)"]);
    const holder = r.groups.find((g) => g.kind === "orphan" && g.class === "Node")!;
    expect([holder.roots.perCycle, holder.nodes.perCycle]).toEqual([1, 3]);
    const stray = r.groups.find((g) => g.kind === "tree")!;
    expect(stray).toMatchObject({ class: "Node3D", where: "/root", sites: ["res://chunk.gd:17  var stray := Node3D.new()"] });
    // --verbose at exit: the Object from every cycle, with its line; the material in the static array is held until exit.
    expect(r.atExit.instances).toMatchObject({ MeshInstance3D: 5, Node: 5, Node2D: 10, Object: 5 });
    expect(r.nonNodeAtExit).toEqual([{ class: "Object", count: 5, sites: ["res://chunk.gd:11  var o := Object.new()"] }]);
    expect(r.heldPerCycle).toBe(1);
    expect(r.holders).toEqual(["res://chunk.gd:10  registry.append(StandardMaterial3D.new())"]);
    expect(r.run.diagnostics).toEqual([]);
    expect(r.hints.join("\n")).toMatch(/remove-child-without-free-orphans/);
  });

  it("proves the fix: 0 per cycle, reloaded or kept running, and compares with the run before", { timeout: 300_000 }, async () => {
    const root = project(LEAKY);
    await leakScene(root, { godot: GODOT, cycleFrames: 10 });
    writeFileSync(join(root, "chunk.gd"), FIXED);
    const fixed = await leakScene(root, { godot: GODOT, cycleFrames: 10 });
    console.log(formatLeaks(fixed));
    expect(fixed.verdict).toBe("ok");
    expect(fixed.groups).toEqual([]);
    expect([fixed.objects.perCycle, fixed.orphanNodes.perCycle, fixed.nonNode.perCycle]).toEqual([0, 0, 0]);
    expect(fixed.baseline).toMatchObject({ objects: 7, orphanNodes: 4, nonNode: 2 });
    expect(formatLeaks(fixed)).toContain("vs last run");
    const kept = await leakScene(root, { godot: GODOT, cycleFrames: 10, reload: false, baseline: false });
    expect(kept.verdict).toBe("ok");
  });

  it("check names the classes leaked at exit", { timeout: 300_000 }, async () => {
    const root = project(LEAKY);
    const result = await checkProject(root, { godot: GODOT, scene: "res://chunk.tscn" });
    const leak = result.diagnostics.find((d) => d.message.includes("ObjectDB instances"));
    expect(leak?.message).toMatch(/^at exit: \d+ ObjectDB instances were leaked at exit: .*MeshInstance3D x1.*Object x1.* \(godot_leaks shows where they come from\)$/);
    expect(result.steps.map((s) => s.name)).toContain("run-verbose");
  });
});
