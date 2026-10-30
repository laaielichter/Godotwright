import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCi, runCi } from "../../src/ci/ci.js";
import { FIXTURES } from "../helpers.js";

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
    expect(ok.steps.map((s) => `${s.name}:${s.status}`)).toEqual(["review:pass", "check:pass", "test:skip", "scenarios:pass"]);

    write("jump.json", ["Hero.velocity.y == -999 @ 10"]);
    const bad = await runCi(root, { godot: GODOT });
    expect(bad.ok).toBe(false);
    expect(bad.steps.at(-1)?.details.join("\n")).toContain("Hero.velocity.y was -400.0 at frame 10");
  });
});
