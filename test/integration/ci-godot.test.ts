import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCi, runCi } from "../../src/ci/ci.js";
import { createServer } from "../../src/mcp/server.js";
import { parseJUnit } from "../../src/test/run.js";
import { FIXTURES, runCli } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

describe.skipIf(!GODOT)("godotwright ci in Godot", () => {
  it("a scenario that is true passes the receipt, and one that is not fails it with the value the game had", { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-ci-"));
    cpSync(join(FIXTURES, "play"), root, { recursive: true });
    mkdirSync(join(root, ".godotwright/scenarios"), { recursive: true });
    const write = (name: string, expect: string[]) =>
      writeFileSync(join(root, ".godotwright/scenarios", name), JSON.stringify({ input: "10 tap jump", frames: 70, expect }));
    write("jump.json", ["Hero.velocity.y == -400 @ 10", "Hero.is_on_floor() == false @ 12", "Hero.is_on_floor() == true"]);
    const ok = await runCi(root, { godot: GODOT });
    console.log(formatCi(ok));
    expect(ok.steps.map((s) => `${s.name}:${s.status}`)).toEqual(["review:pass", "check:pass", "test:skip", "scenarios:pass", "visual:skip"]);

    write("jump.json", ["Hero.velocity.y == -999 @ 10"]);
    const bad = await runCi(root, { godot: GODOT });
    expect(bad.ok).toBe(false);
    expect(bad.steps.find((s) => s.name === "scenarios")?.details.join("\n")).toContain("Hero.velocity.y was -400.0 at frame 10");
  });

  it("the export step exports a pack, checks it and runs it", { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-ci-"));
    cpSync(join(FIXTURES, "play"), root, { recursive: true });
    writeFileSync(join(root, "export_presets.cfg"), '[preset.0]\n\nname="Linux"\nplatform="Linux"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path=""\n\n[preset.0.options]\n');
    const r = await runCi(root, { godot: GODOT, exportPreset: "Linux" });
    const step = r.steps.at(-1)!;
    expect(step).toMatchObject({ name: "export", status: "pass" });
    expect(step.summary).toMatch(/^pack of Linux: \d+ files, .*, ran 120 frames: 0 errors$/);
  });
});

const HERO_WITH_SIGNALS = `extends CharacterBody2D

signal jumped(height: float)
signal landed

const SPEED := 200.0
const JUMP := -400.0
var gravity: float = 980.0
var _air := false


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += gravity * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = JUMP
		jumped.emit(JUMP)
	velocity.x = Input.get_axis("ui_left", "right") * SPEED
	move_and_slide()
	if is_on_floor() and _air:
		landed.emit()
	_air = not is_on_floor()
`;

describe.skipIf(!GODOT)("godot_scenario and JUnit in Godot", () => {
  it("saves a proven play run as a scenario, refuses a false one, runs it, and writes JUnit from ci", { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-scenario-"));
    cpSync(join(FIXTURES, "play"), root, { recursive: true });
    writeFileSync(join(root, "hero.gd"), HERO_WITH_SIGNALS);
    rmSync(join(root, ".godotwright"), { recursive: true, force: true });
    const server = createServer({ root, godot: GODOT });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (args: Record<string, unknown>) => {
      const r = (await client.callTool({ name: "godot_scenario", arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { error: r.isError === true, text: r.content.map((c) => c.text).join("\n") };
    };
    try {
      const play = {
        input: "10 tap jump",
        frames: 90,
        signals: ["Hero.jumped", "Hero.landed"],
        expect: ["Hero.velocity.y == -400 @ 10", "Hero.jumped == 1 @ 10", "Hero.landed == 0 @ 30", "Hero.landed == 1", "Hero.is_on_floor() == true"],
      };
      const saved = await call({ op: "save", name: "jump", ...play });
      console.log(saved.text);
      expect(saved.error).toBe(false);
      expect(saved.text).toContain("saved .godotwright/scenarios/jump.json");

      const wrong = await call({ op: "save", name: "wrong", input: "10 tap jump", frames: 90, expect: ["Hero.velocity.y == -999 @ 10"] });
      expect(wrong.error).toBe(true);
      expect(wrong.text).toContain("Hero.velocity.y was -400.0 at frame 10");
      expect(existsSync(join(root, ".godotwright/scenarios/wrong.json"))).toBe(false);

      // until: the run stops at the top of the jump, and a claim without a frame is checked there.
      const top = await call({ op: "save", name: "top", input: "10 tap jump", frames: 120, until: "Hero.position.y < 450", expect: ["Hero.velocity.y < 0"] });
      expect(top.error).toBe(false);
      expect(top.text).toContain("stopped at frame 16 (until)");

      const run = await call({ op: "run" });
      console.log(run.text);
      expect(run.error).toBe(false);
      expect(run.text).toContain("2 of 2 scenarios passed");

      const junit = join(root, "out", "junit.xml");
      const cli = await runCli(["ci", root, "--godot", GODOT ?? "", "--junit", junit]);
      expect(cli.exitCode).toBe(0);
      const xml = readFileSync(junit, "utf8");
      expect(parseJUnit(xml)).toMatchObject({ tests: 2 + 5 + 1, failed: 0, errors: 0 });
      expect(xml).toContain('<testcase classname="scenario.jump" name="Hero.landed == 1"');
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.exitCode = undefined;
    }
  });
});

const GUT = process.env["GUT_ADDON"];

describe.skipIf(!GODOT || !GUT)("test --junit with GUT in Godot", () => {
  it("writes GUT's own JUnit, and ci puts it next to the scenarios", { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-junit-"));
    cpSync(join(FIXTURES, "play"), root, { recursive: true });
    cpSync(GUT ?? "", join(root, "addons", "gut"), { recursive: true });
    mkdirSync(join(root, "test"), { recursive: true });
    writeFileSync(join(root, "test", "test_math.gd"), 'extends GutTest\n\n\nfunc test_adds() -> void:\n\tassert_eq(1 + 2, 3)\n\n\nfunc test_fails_on_purpose() -> void:\n\tassert_eq(2 + 2, 5, "two and two")\n');
    mkdirSync(join(root, ".godotwright/scenarios"), { recursive: true });
    writeFileSync(join(root, ".godotwright/scenarios/jump.json"), JSON.stringify({ input: "10 tap jump", frames: 70, expect: ["Hero.velocity.y == -400 @ 10"] }));
    try {
      const file = join(root, "out", "test.xml");
      const test = await runCli(["test", root, "--godot", GODOT ?? "", "--junit", file]);
      expect(test.exitCode).toBe(1);
      expect(parseJUnit(readFileSync(file, "utf8"))).toMatchObject({ tests: 2, passed: 1, failed: 1 });

      const all = join(root, "out", "ci.xml");
      const ci = await runCli(["ci", root, "--godot", GODOT ?? "", "--junit", all]);
      expect(ci.exitCode).toBe(1);
      const xml = readFileSync(all, "utf8");
      console.log(xml);
      expect(parseJUnit(xml)).toMatchObject({ failed: 1 });
      expect(xml).toContain("test_fails_on_purpose");
      expect(xml).toContain('classname="scenario.jump"');
    } finally {
      process.exitCode = undefined;
    }
  });
});
