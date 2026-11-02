import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { playScene } from "../../src/play/play.js";
import { formatGame } from "../../src/session/format.js";
import { gameRequest, newDiagnostics, readSession, startSession, stepPayload, stopSession } from "../../src/session/session.js";
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

    expect(await stopSession(root)).toBe(true);
    expect(readSession(root)).toBeUndefined();
    expect(existsSync(join(root, ".godot", "godotwright", "session.gd"))).toBe(false);
  });
});
