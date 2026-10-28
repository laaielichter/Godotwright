import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../../src/check/check.js";
import { formatDiagnostic } from "../../src/check/log.js";

/** Official demo projects (pinned checkout in $GODOT_DEMOS) should check clean. */
const GODOT = process.env["GODOT"];
const DEMOS = process.env["GODOT_DEMOS"];

export const DEMO_PROJECTS = [
  "2d/dodge_the_creeps",
  "2d/platformer",
  "2d/role_playing_game",
  "2d/finite_state_machine",
  "3d/platformer",
  "3d/squash_the_creeps",
];

describe.skipIf(!GODOT || !DEMOS)("godotwright check on official demo projects", () => {
  for (const demo of DEMO_PROJECTS) {
    it(demo, { timeout: 300_000 }, async () => {
      const dir = mkdtempSync(join(tmpdir(), "godotwright-demo-"));
      cpSync(join(DEMOS!, demo), dir, { recursive: true });
      const result = await checkProject(dir, { godot: GODOT, runFrames: 30 });
      console.log(`=== ${demo}: ${result.scripts} scripts, ${result.scenes} scenes, ${result.steps.map((s) => `${s.name} ${s.ms}ms`).join(", ")}`);
      for (const d of result.diagnostics) console.log(`[${d.source}] ${formatDiagnostic(d)}`);
      expect(result.scripts).toBeGreaterThan(0);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    });
  }
});
