import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withLeakNames } from "../src/check/check.js";
import { formatLeaks, leakScene, SiteFinder, trend } from "../src/perf/leaks.js";
import { demangle, parseExitLeaks, playScene, playScript, type LeakSnapshot } from "../src/play/play.js";
import { makeProject, runCli } from "./helpers.js";

/** A snapshot as the play script prints it after a cycle. */
function snap(cycle: number, leak: number, extra: Partial<LeakSnapshot> = {}): LeakSnapshot {
  return {
    cycle,
    objects: 1000 + 7 * cycle * leak,
    nodes: 1 + cycle * leak,
    orphanNodes: 4 * cycle * leak,
    resources: 3,
    memory: 25_000_000 + 13_000 * cycle * leak,
    orphans: leak
      ? {
          "MeshInstance3D|||": [cycle, cycle, "/root/Chunk", "res://chunk.gd"],
          "Node|||": [cycle, 3 * cycle, "/root/Chunk", "res://chunk.gd"],
        }
      : {},
    tree: leak ? { "Node3D|||": [cycle, cycle, "/root", ""] } : {},
    ...extra,
  };
}

/** Exit lines Godot prints with --verbose (a few on stdout, the totals on stderr). */
const EXIT_OUT = [
  "Loading resource: res://chunk.tscn remapped: res://chunk.tscn",
  "ERROR: 5 RID allocations of type 'N17RendererSceneCull8InstanceE' were leaked at exit.",
  "Leaked instance: GDScriptNativeClass:9223372049588683482 - Reference count: 1",
  ...Array.from({ length: 5 }, (_, i) => `Leaked instance: MeshInstance3D:2692743316${i} - Node path: `),
  ...Array.from({ length: 5 }, (_, i) => `Leaked instance: Object:2696098760${i}`),
  "Hint: Leaked instances typically happen when nodes are removed from the scene tree (with `remove_child()`) but not freed (with `free()` or `queue_free()`).",
  "Resource still in use: res://chunk.gd (GDScript)",
  "Resource still in use: res://.godot/godotwright/play.gd (GDScript)",
  "Orphan StringName: @Node2D@3 (static: 0, total: 3)",
  "StringName: 33 unclaimed string names at exit.",
];
const EXIT_ERR = [
  "WARNING: 6 RIDs of type \"CanvasItem\" were leaked.",
  "   at: _free_rids (servers/rendering/renderer_canvas_cull.cpp:2735)",
  "WARNING: 15 ObjectDB instances were leaked at exit (run with `--verbose` for details).",
  "   at: cleanup (core/object/object.cpp:2536)",
  "ERROR: Cannot get path of node as it is not in a scene tree.",
  "   at: get_path (scene/main/node.cpp:2431)",
];

/** A stand-in for Godot that prints the snapshots of a cycle run, then the exit lists of --verbose. */
function fakeGodot(dir: string, snaps: LeakSnapshot[], options: { exit?: boolean; done?: boolean } = {}): string {
  const bin = join(dir, "fake-godot.sh");
  const lines = snaps.map((s) => `GODOTWRIGHT_PLAY_SNAP ${JSON.stringify(s)}`);
  writeFileSync(
    bin,
    `#!/bin/sh
case "$*" in *--import*) exit 0;; esac
echo "$*" > "${join(dir, "args.txt")}"
cat <<'OUT'
hello from the game
${lines.join("\n")}
${options.done === false ? "" : "GODOTWRIGHT_PLAY_DONE"}
${options.exit === false ? "" : EXIT_OUT.join("\n")}
OUT
cat >&2 <<'ERR'
GODOTWRIGHT_PLAY_EXIT
${options.exit === false ? "" : EXIT_ERR.join("\n")}
ERR
exit 0
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const CHUNK = 'extends Node3D\n\nstatic var registry: Array = []\n\n\nfunc _ready() -> void:\n\tvar m := MeshInstance3D.new()\n\tadd_child(m)\n\tremove_child(m)\n\tregistry.append(StandardMaterial3D.new())\n\tvar o := Object.new()\n\tvar holder := Node.new()\n\tadd_child(holder)\n\tremove_child(holder)\n\tvar stray := Node3D.new()\n\tget_tree().root.add_child.call_deferred(stray)\n';

const project = () =>
  makeProject({
    "project.godot": '[application]\nrun/main_scene="res://chunk.tscn"\n',
    "chunk.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://chunk.gd" id="1"]\n\n[node name="Chunk" type="Node3D"]\nscript = ExtResource("1")\n',
    "chunk.gd": CHUNK,
  });

describe("leak trends", () => {
  it("counts steady growth as a leak, and a cache that fills once or noise as none", () => {
    expect(trend([5, 6, 7, 8])).toEqual({ first: 5, last: 8, perCycle: 1, growing: true });
    expect(trend([1, 1, 2, 2, 3])).toMatchObject({ perCycle: 0.5, growing: true });
    expect(trend([10, 20, 20, 20])).toMatchObject({ growing: false });
    expect(trend([5, 7, 6, 8])).toMatchObject({ growing: false });
    expect(trend([3, 3, 3])).toEqual({ first: 3, last: 3, perCycle: 0, growing: false });
    expect(trend([4])).toMatchObject({ perCycle: 0, growing: false });
  });
});

describe("exit lists", () => {
  it("reads what --verbose lists at exit, without the GDScript module's own objects", () => {
    const named = parseExitLeaks([...EXIT_OUT, ...EXIT_ERR].join("\n"));
    expect(named.instances).toEqual({ MeshInstance3D: 5, Object: 5 });
    expect(named.resources).toEqual([
      { path: "res://chunk.gd", type: "GDScript" },
      { path: "res://.godot/godotwright/play.gd", type: "GDScript" },
    ]);
    expect(named.rids).toEqual({ "RendererSceneCull::Instance": 5, CanvasItem: 6 });
    expect(named.objects).toBe(15);
    expect(demangle("N17RendererSceneCull8InstanceE")).toBe("RendererSceneCull::Instance");
    expect(demangle("CanvasItem")).toBe("CanvasItem");
  });

  it("names the classes in check's at-exit warning", () => {
    const named = parseExitLeaks(EXIT_OUT.join("\n"));
    expect(withLeakNames("at exit: 15 ObjectDB instances were leaked at exit (run with `--verbose` for details).", named)).toBe(
      "at exit: 15 ObjectDB instances were leaked at exit: MeshInstance3D x5, Object x5 (godot_leaks shows where they come from)",
    );
    expect(withLeakNames("at exit: 1 resources still in use at exit (run with --verbose for details).", named)).toBe(
      "at exit: 1 resources still in use at exit: res://chunk.gd (GDScript)",
    );
    expect(withLeakNames("at exit: 2 ObjectDB instances were leaked at exit.", parseExitLeaks(""))).toBe("at exit: 2 ObjectDB instances were leaked at exit.");
  });
});

describe("play in cycles", () => {
  it("writes a script that frees the scene, waits a frame, snapshots and makes it again", () => {
    const script = playScript("res://chunk.tscn", [], [], 300, 301, { cycles: { count: 5, frames: 60 } });
    expect(script).toContain("const CYCLES := 5\nconst CYCLE_FRAMES := 60\nconst RELOAD := true");
    expect(script).toContain("\t_cycle_step()\n\treturn\n");
    expect(script).toContain("node_removed.connect(_on_removed)");
    expect(script).toContain("for id: int in Node.get_orphan_node_ids():");
    expect(script).toContain("if id == root_id:");
    expect(script).toContain("_scene.free()");
    expect(script).toContain('printerr("GODOTWRIGHT_PLAY_EXIT")');
    expect(playScript("res://chunk.tscn", [], [], 300, 301, { cycles: { count: 5, frames: 60, reload: false } })).toContain("const RELOAD := false");
    // Plain play runs do not get any of it.
    expect(playScript("res://chunk.tscn", [], [], 60, 10)).not.toContain("_cycle_step");
  });

  it("reads snapshots and the exit lists, and keeps --verbose lines out of the output and the errors", async () => {
    const root = project();
    const bin = fakeGodot(root, [snap(1, 1), snap(2, 1)]);
    const report = await playScene(root, { godot: bin, cycles: { count: 2, frames: 10 }, verbose: true });
    expect(report.snapshots?.map((s) => s.cycle)).toEqual([1, 2]);
    expect(report.atExit?.instances).toEqual({ MeshInstance3D: 5, Object: 5 });
    expect(report.output).toBe("hello from the game");
    expect(report.diagnostics).toEqual([]);
    expect(report.finished).toBe(true);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(root, "args.txt"), "utf8")).toContain("--verbose");
  });
});

describe("creation sites", () => {
  it("finds .new() of a class, a class_name, a preload alias, an exported scene and an instancing scene", () => {
    const root = makeProject({
      "project.godot": '[application]\n[autoload]\nCache="*res://cache.gd"\n',
      "chunk.gd": CHUNK,
      "leaky.gd": "class_name Leaky\nextends Node\n",
      "maker.gd": 'extends Node\n\nconst Bullet = preload("res://bullet.gd")\n\n\nfunc make() -> void:\n\tvar a := Leaky.new()\n\tvar b = Bullet.new()\n\t# MeshInstance3D.new() in a comment does not count\n\tvar s := "MeshInstance3D.new()"\n',
      "bullet.gd": "extends Node2D\n",
      "spawner.gd": "extends Node\n\n@export var mob_scene: PackedScene\n\n\nfunc spawn() -> void:\n\tvar mob = mob_scene.instantiate()\n\tadd_child(mob)\n",
      "main.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://spawner.gd" id="1"]\n[ext_resource type="PackedScene" path="res://mob.tscn" id="2"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\nmob_scene = ExtResource("2")\n\n[node name="Mob" parent="." instance=ExtResource("2")]\n',
      "mob.tscn": '[gd_scene format=3]\n\n[node name="Mob" type="Node2D"]\n',
      "cache.gd": "extends Node\n\nvar items: Array = []\n\n\nfunc keep(x: Object) -> void:\n\titems.append(x)\n",
    });
    const sites = SiteFinder.load(root);
    expect(sites.sites("MeshInstance3D")).toEqual(["res://chunk.gd:7  var m := MeshInstance3D.new()"]);
    expect(sites.sites("Node", "res://leaky.gd")).toEqual(["res://maker.gd:7  var a := Leaky.new()"]);
    expect(sites.sites("Node2D", "res://bullet.gd")).toEqual(["res://maker.gd:8  var b = Bullet.new()"]);
    expect(sites.sites("Node2D", undefined, "res://mob.tscn")).toEqual(["res://spawner.gd:7  var mob = mob_scene.instantiate()", 'res://main.tscn:10  node "Mob" instances it']);
    expect(sites.removals(["res://chunk.gd"], ["res://chunk.gd:7  var m := MeshInstance3D.new()"])).toEqual(["res://chunk.gd:9  remove_child(m)"]);
    expect(sites.removals(["res://chunk.gd"], [])).toEqual(["res://chunk.gd:9  remove_child(m)", "res://chunk.gd:14  remove_child(holder)"]);
    expect(sites.holders("res://main.tscn")).toEqual(["res://cache.gd:7  items.append(x)"]);
  });
});

describe("leakScene", () => {
  it("reports growth per cycle with where it comes from, and fails over the budget", async () => {
    const root = project();
    const bin = fakeGodot(root, [1, 2, 3, 4, 5].map((c) => snap(c, 1)));
    const report = await leakScene(root, { godot: bin, cycleFrames: 10 });
    expect(report.verdict).toBe("leaking");
    expect(report.objects).toMatchObject({ perCycle: 7, growing: true });
    expect(report.orphanNodes.perCycle).toBe(4);
    expect(report.nonNode.perCycle).toBe(2);
    expect(report.groups.map((g) => [g.kind, g.class, g.roots.perCycle, g.nodes.perCycle])).toEqual([
      ["orphan", "Node", 1, 3],
      ["orphan", "MeshInstance3D", 1, 1],
      ["tree", "Node3D", 1, 1],
    ]);
    const mesh = report.groups.find((g) => g.class === "MeshInstance3D")!;
    expect(mesh.sites).toEqual(["res://chunk.gd:7  var m := MeshInstance3D.new()"]);
    expect(mesh.removedAt).toEqual(["res://chunk.gd:9  remove_child(m)"]);
    expect(report.nonNodeAtExit).toEqual([{ class: "Object", count: 5, sites: ["res://chunk.gd:11  var o := Object.new()"] }]);
    // 2 non-node objects per cycle, 1 of them listed at exit: the other is held until exit, by the static array.
    expect(report.heldPerCycle).toBe(1);
    expect(report.holders).toEqual(["res://chunk.gd:10  registry.append(StandardMaterial3D.new())"]);
    expect(report.atExit.resources).toEqual([{ path: "res://chunk.gd", type: "GDScript" }]);
    expect(report.hints.map((h) => h.split(":")[0])).toEqual([
      "performance/remove-child-without-free-orphans",
      "performance/nodes-outside-scene-survive-reload",
      "performance/object-new-needs-free",
      "performance/static-array-holds-resources",
      "performance/record-per-reload-grows-forever",
    ]);
    const text = formatLeaks(report);
    expect(text).toMatch(/^leaks res:\/\/chunk\.tscn: 5 cycles of 10 frames \(load, run, free\), counted from cycle 2, .*: LEAKING$/m);
    expect(text).toContain("per cycle: objects +7, orphan nodes +4, nodes in tree +1, non-node objects +2, loaded resources 0, static memory +13 KiB");
    expect(text).toContain("  +1/cycle MeshInstance3D, 5 now; removed from /root/Chunk (res://chunk.gd)\n    made at res://chunk.gd:7  var m := MeshInstance3D.new()\n    removed at res://chunk.gd:9  remove_child(m)");
    expect(text).toContain("  +1/cycle Node (+3 nodes with children), 5 now");
    expect(text).toContain("nodes left in the tree after the scene was freed:\n  +1/cycle Node3D under /root, 5 now\n    made at res://chunk.gd:15  var stray := Node3D.new()");
    expect(text).toContain("  Object x5 still alive at exit\n    made at res://chunk.gd:11  var o := Object.new()");
    expect(text).toContain("    kept at res://chunk.gd:10  registry.append(StandardMaterial3D.new())");
    expect(text).toContain("at exit Godot still held 15 objects: MeshInstance3D x5, Object x5");
    expect(text).toContain("no earlier run");
    expect(text).toMatch(/Next: free what is named above/);
    expect(existsSync(join(root, ".godot", "godotwright", "leaks", "chunk.tscn.json"))).toBe(true);

    // A budget above the growth passes; the second run compares with the first.
    const within = await leakScene(root, { godot: bin, cycleFrames: 10, budget: { objects: 8, orphans: 5 } });
    expect(within.verdict).toBe("ok");
    expect(within.baseline).toMatchObject({ objects: 7, orphanNodes: 4, nonNode: 2 });
    expect(formatLeaks(within)).toContain("vs last run");

    // Another mode or cycle length measures something else: no comparison, and the reload run stays saved.
    const kept = await leakScene(root, { godot: bin, cycleFrames: 10, reload: false });
    expect(kept.baseline).toBeUndefined();
    expect(formatLeaks(kept)).not.toContain("vs last run");
    expect(existsSync(join(root, ".godot", "godotwright", "leaks", "chunk.tscn.keep.json"))).toBe(true);
    expect((await leakScene(root, { godot: bin, cycleFrames: 20 })).baseline).toBeUndefined();
    expect((await leakScene(root, { godot: bin, cycleFrames: 20 })).baseline).toMatchObject({ objects: 7, setup: "reload, 20 frames" });
  });

  it("is quiet when nothing grows, and counts only objects outside the tree with the scene kept running", async () => {
    const root = project();
    const clean = await leakScene(root, { godot: fakeGodot(root, [1, 2, 3, 4, 5].map((c) => snap(c, 0)), { exit: false }), baseline: false });
    expect(clean.verdict).toBe("ok");
    expect(clean.groups).toEqual([]);
    expect(formatLeaks(clean)).toBe(
      "leaks res://chunk.tscn: 5 cycles of 60 frames (load, run, free), counted from cycle 2, budget per cycle: objects 0, orphan nodes 0: OK\nper cycle: objects 0, orphan nodes 0, nodes in tree 0, non-node objects 0, loaded resources 0, static memory 0 KiB\nNext: nothing grows per cycle. Run it again after changes to the scene to keep it that way.\n",
    );
    // Kept running, a scene that spawns into itself grows its tree: shown, not a leak.
    const spawning = [1, 2, 3, 4, 5].map((c) => snap(c, 0, { objects: 1000 + 3 * c, nodes: 1 + 3 * c, tree: { "Node2D||res://mob.tscn|": [c, 3 * c, "/root/Main", ""] } }));
    const kept = await leakScene(root, { godot: fakeGodot(root, spawning, { exit: false }), reload: false, baseline: false });
    expect(kept.verdict).toBe("ok");
    expect(formatLeaks(kept)).toContain("nodes that keep piling up in the tree (not counted as a leak with the scene kept running");
  });

  it("refuses bad numbers and says when the run did not finish", async () => {
    const root = project();
    await expect(leakScene(root, { cycles: 1 })).rejects.toThrow(/cycles must be/);
    await expect(leakScene(root, { cycles: 3, warmupCycles: 2 })).rejects.toThrow(/at least 2 counted cycles/);
    await expect(leakScene(root, { cycleFrames: 0 })).rejects.toThrow(/cycle frames/);
    const cut = await leakScene(root, { godot: fakeGodot(root, [snap(1, 1), snap(2, 1)], { done: false }), baseline: false, input: "70 press ui_accept" });
    expect(cut.run.finished).toBe(false);
    const text = formatLeaks(cut);
    expect(text).toContain("the run did NOT finish");
    expect(text).toContain("warning: input on frame 70 never happens: a cycle has 60 frames");
  });

  it("runs from the CLI with exit code 1 on a leak, and as JSON", async () => {
    const root = project();
    const leaking = fakeGodot(root, [1, 2, 3].map((c) => snap(c, 1)));
    const run = await runCli(["leaks", root, "--godot", leaking, "--cycles", "3", "--cycle-frames", "5", "--no-baseline"]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("3 cycles of 5 frames");
    process.exitCode = undefined;
    const json = await runCli(["leaks", root, "--godot", leaking, "--cycles", "3", "--budget-objects", "10", "--budget-orphans", "10", "--json", "--no-baseline"]);
    expect(json.exitCode ?? 0).toBe(0);
    const parsed = JSON.parse(json.output) as { verdict: string; groups: unknown[]; run?: unknown; finished: boolean };
    expect(parsed.verdict).toBe("ok");
    expect(parsed.finished).toBe(true);
    expect(parsed.run).toBeUndefined();
    expect(parsed.groups).toHaveLength(3);
    process.exitCode = undefined;
  });
});
