import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { playScene } from "../../src/play/play.js";
import { formatGame } from "../../src/session/format.js";
import { gameRequest, newDiagnostics, readSession, reloadScripts, startSession, stepPayload, stopSession } from "../../src/session/session.js";
import { FIXTURES } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

describe.skipIf(!GODOT)("a game session in Godot", () => {
  const root = mkdtempSync(join(tmpdir(), "godotwright-session-"));
  cpSync(join(FIXTURES, "play"), root, { recursive: true });
  const hero = join(root, "hero.gd");
  writeFileSync(
    hero,
    readFileSync(hero, "utf8")
      .replace("var gravity", "signal jumped(height: float)\n\nvar gravity")
      .replace("\t\tvelocity.y = JUMP", "\t\tvelocity.y = JUMP\n\t\tjumped.emit(JUMP)"),
  );
  afterAll(() => stopSession(root));

  it("loads once, answers between calls, steps frame-exact like play, and stops", { timeout: 300_000 }, async () => {
    const started = await startSession(root, { godot: GODOT, idleMinutes: 5 });
    expect(started.reused).toBe(false);
    expect(readSession(root)?.scene).toBe("res://main.tscn");
    expect((await startSession(root, { godot: GODOT })).reused).toBe(true);

    const tree = await gameRequest(root, "tree", { root: ".", depth: 3, limit: 80 });
    expect(tree.reply["lines"]).toEqual(expect.arrayContaining(["Hero  CharacterBody2D  res://hero.gd"]));

    const get = await gameRequest(root, "get", { watch: ["Hero.position"] });
    expect((get.reply["values"] as Record<string, string>)["Hero.position"]).toBe("Vector2(100, 490)");

    await gameRequest(root, "signals", { signals: ["Hero.jumped"] });
    const step = await gameRequest(root, "step", stepPayload({ frames: 60, input: "10 tap jump", watch: ["Hero.velocity.y"], every: 1, until: "Hero.velocity.y > 0" }));
    console.log(formatGame("step", step.reply, step.diagnostics, ["Hero.velocity.y"]));
    const samples = step.reply["samples"] as [number, Record<string, string>][];
    expect(samples.find(([f]) => f === 10)?.[1]["Hero.velocity.y"]).toBe("-400.0");
    expect(step.reply["signals"]).toEqual([[10, "Hero.jumped", ["-400.0"]]]);
    expect(step.reply["until_met"]).toBe(true);

    // The same input from frame 0 in godot_play gives the same numbers.
    const play = await playScene(root, { godot: GODOT, input: "10 tap jump", watch: ["Hero.velocity.y"], frames: 20, every: 1, import: false });
    expect(play.samples.find((s) => s.frame === 15)?.values["Hero.velocity.y"]).toBe(samples.find(([f]) => f === 15)?.[1]["Hero.velocity.y"]);

    const set = await gameRequest(root, "set", { path: "Hero.position", value: "Vector2(300, 100)" });
    expect(set.reply["value"]).toBe("Vector2(300, 100)");
    const evaluated = await gameRequest(root, "eval", { expr: 'get_node("Hero").position.x * 2' });
    expect(evaluated.reply["value"]).toBe("600.0");
    const bad = await gameRequest(root, "eval", { expr: 'get_node("Nope").position' });
    expect(bad.reply["ok"]).toBe(false);
    expect(bad.diagnostics.map((d) => d.message).join("\n")).toMatch(/Node not found: "Nope"/);
    expect(newDiagnostics(root)).toEqual([]);

    // Hot reload: the edited script runs on the live node, which keeps its position; a new variable gets its value.
    expect((await reloadScripts(root)).reply["reloaded"]).toEqual([]);
    const source = readFileSync(hero, "utf8");
    writeFileSync(hero, source.replace("var gravity", "var boost := 3.0\nvar gravity").replace("* SPEED", "* SPEED * boost"));
    const reloaded = await reloadScripts(root);
    console.log(formatGame("reload", { ...reloaded.reply, others: reloaded.others }, reloaded.diagnostics));
    expect(reloaded.reply["reloaded"]).toEqual(["res://hero.gd"]);
    expect(reloaded.reply["initialized"]).toEqual(["boost"]);
    const moved = await gameRequest(root, "step", stepPayload({ frames: 2, input: "0 hold right 2", watch: ["Hero.velocity.x", "Hero.boost"], every: 1 }));
    expect((moved.reply["samples"] as [number, Record<string, string>][]).at(-1)?.[1]).toEqual({ "Hero.velocity.x": "600.0", "Hero.boost": "3.0" });
    expect((await gameRequest(root, "get", { watch: ["Hero.position.y"] })).reply["values"]).not.toEqual({ "Hero.position.y": "490.0" });
    // A script that does not compile is left as it was: the old code keeps running and the error names the line.
    writeFileSync(hero, readFileSync(hero, "utf8").replace("velocity.y += gravity * delta", "velocity.y += nothing_here"));
    const broken = await reloadScripts(root);
    expect(broken.reply["reloaded"]).toEqual([]);
    expect(String((broken.reply["failed"] as string[])[0])).toMatch(/^res:\/\/hero\.gd: .*old code keeps running/);
    expect(broken.diagnostics.some((d) => d.file === "res://hero.gd" && /nothing_here/.test(d.message))).toBe(true);
    const still = await gameRequest(root, "step", stepPayload({ frames: 1, input: "0 hold right 1", watch: ["Hero.velocity.x"], every: 1 }));
    expect((still.reply["samples"] as [number, Record<string, string>][]).at(-1)?.[1]["Hero.velocity.x"]).toBe("600.0");
    writeFileSync(hero, source);

    expect(await stopSession(root)).toBe(true);
    expect(readSession(root)).toBeUndefined();
    expect(existsSync(join(root, ".godot", "godotwright", "session.gd"))).toBe(false);
  });
});

describe.skipIf(!GODOT)("space and screen questions to a game session", () => {
  const root = mkdtempSync(join(tmpdir(), "godotwright-space-"));
  writeFileSync(
    join(root, "project.godot"),
    'config_version=5\n[application]\nconfig/name="Space"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n[display]\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n',
  );
  writeFileSync(
    join(root, "main.tscn"),
    [
      "[gd_scene format=3]",
      '[sub_resource type="BoxShape3D" id="g"]\nsize = Vector3(40, 1, 40)',
      '[sub_resource type="BoxMesh" id="m"]',
      '[node name="Main" type="Node3D"]',
      '[node name="Ground" type="StaticBody3D" parent="."]\ntransform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.5, 0)',
      '[node name="Shape" type="CollisionShape3D" parent="Ground"]\nshape = SubResource("g")',
      '[node name="Crate" type="MeshInstance3D" parent="."]\ntransform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0.5, 0)\nmesh = SubResource("m")',
      '[node name="Floating" type="MeshInstance3D" parent="."]\ntransform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, -3, 2.3, 0)\nmesh = SubResource("m")',
      '[node name="Hud" type="CanvasLayer" parent="."]',
      '[node name="Start" type="Button" parent="Hud"]\noffset_left = 1200.0\noffset_top = 600.0\noffset_right = 1340.0\noffset_bottom = 640.0\ntext = "Start"',
      '[node name="Back" type="Button" parent="Hud"]\noffset_left = 1210.0\noffset_top = 605.0\noffset_right = 1300.0\noffset_bottom = 630.0\ntext = "Back"',
    ].join("\n\n") + "\n",
  );
  afterAll(() => stopSession(root));

  it("says where 3D things are, what a ray hits, and what is wrong with the screen", { timeout: 300_000 }, async () => {
    await startSession(root, { godot: GODOT });
    const layout = ((await gameRequest(root, "layout", { root: ".", limit: 60 })).reply["lines"] as string[]).join("\n");
    expect(layout).toMatch(/Crate {2}pos \(2\.0, 0\.5, 0\.0\) {2}size 1\.00x1\.00x1\.00 m {2}lowest y 0\.00 {2}rests on Ground/);
    expect(layout).toMatch(/Floating .* floating 1\.80 m above Ground/);
    const ray = (await gameRequest(root, "ray", { from: "Vector3(-3, 10, 0)", to: "Vector3(-3, -10, 0)" })).reply["hit"] as Record<string, unknown>;
    expect(ray).toMatchObject({ hit: true, node: "Ground", position: "Vector3(-3, 0, 0)" });
    const ui = (await gameRequest(root, "ui", { sizes: ["1280x720"] })).reply["sizes"] as { size: string; issues: string[] }[];
    expect(ui[0]!.size).toBe("1280x720");
    expect(ui[0]!.issues.join("\n")).toMatch(/partly off-screen: Hud\/Start/);
    expect(ui[0]!.issues.join("\n")).toMatch(/overlap: Hud\/Start and Hud\/Back/);
  });
});
