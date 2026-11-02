import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatPlay, playScene, summarizePlay } from "../../src/play/play.js";
import { FIXTURES } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

describe.skipIf(!GODOT)("godotwright play in Godot", () => {
  it("the hero jumps on the frame of the press, walks while right is held, and every run is the same", { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-play-"));
    cpSync(join(FIXTURES, "play"), root, { recursive: true });
    const options = { godot: GODOT, input: "10 tap jump; 20 hold right 30", watch: ["Hero.position.x", "Hero.velocity.y", "Hero.is_on_floor()"], frames: 60, every: 10 };
    const report = await playScene(root, options);
    console.log(formatPlay(report));
    expect(report.finished).toBe(true);
    expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const at = (frame: number) => report.samples.find((s) => s.frame === frame)?.values ?? {};
    expect(at(0)).toEqual({ "Hero.position.x": "100.0", "Hero.velocity.y": "0.0", "Hero.is_on_floor()": "true" });
    expect(at(10)["Hero.velocity.y"]).toBe("-400.0");
    expect(at(10)["Hero.is_on_floor()"]).toBe("false");
    expect(Number(at(20)["Hero.position.x"])).toBeCloseTo(100 + 200 / 60, 3);
    expect(Number(at(50)["Hero.position.x"])).toBeCloseTo(100 + 30 * (200 / 60), 3);
    expect(at(59)["Hero.is_on_floor()"]).toBe("true");
    const again = await playScene(root, { ...options, import: false });
    expect(again.samples).toEqual(report.samples);
    // A key goes through the input map: Space is bound to jump in the fixture.
    const key = await playScene(root, { godot: GODOT, input: "10 tap Key:Space", watch: ["Hero.velocity.y"], frames: 12, every: 5, import: false });
    expect(key.samples.find((s) => s.frame === 10)?.values["Hero.velocity.y"]).toBe("-400.0");
  });

  it("stops when a condition holds, records signals with their arguments, and sums values up", { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-play-"));
    cpSync(join(FIXTURES, "play"), root, { recursive: true });
    const hero = join(root, "hero.gd");
    writeFileSync(
      hero,
      readFileSync(hero, "utf8")
        .replace("var gravity", "signal jumped(height: float)\n\nvar gravity")
        .replace("\t\tvelocity.y = JUMP", "\t\tvelocity.y = JUMP\n\t\tjumped.emit(JUMP)"),
    );
    const report = await playScene(root, {
      godot: GODOT,
      input: "10 tap jump",
      watch: ["Hero.position.y", "Hero.is_on_floor()"],
      frames: 200,
      every: 1,
      until: "Hero.velocity.y > 0",
      signals: ["Hero.jumped", "Hero.missing_signal"],
    });
    console.log(formatPlay(report, { summary: true }));
    expect(report.finished).toBe(true);
    expect(report.until?.frame).toBeGreaterThan(10);
    expect(report.until?.frame).toBeLessThan(60);
    expect(report.samples.at(-1)?.frame).toBe(report.until?.frame);
    expect(report.signals).toEqual([{ frame: 10, signal: "Hero.jumped", args: ["-400.0"] }]);
    expect(report.warnings.join("\n")).toMatch(/Hero.missing_signal is not a signal/);
    expect(summarizePlay(report).find((l) => l.startsWith("Hero.is_on_floor()"))).toMatch(/start true, .*first change at frame 10/);
  });
});
