import { cpSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCSharp, findDotnet } from "../../src/check/csharp-build.js";
import { migrateProjectChecked } from "../../src/migrate/migrate.js";

/**
 * Needs a checkout of the 3.x branch of godotengine/godot-demo-projects in $GODOT3_DEMOS (only mono/ is read; copies
 * are migrated, never the checkout), the .NET SDK, and Godot.NET.Sdk 4.7.2 where NuGet finds it. Skipped otherwise.
 */
const DEMOS = process.env["GODOT3_DEMOS"];
const enabled = DEMOS !== undefined && existsSync(join(DEMOS, "mono")) && findDotnet() !== undefined;

describe.skipIf(!enabled)("C# migration of the official Godot 3 C# demos", () => {
  const demos = enabled ? readdirSync(join(DEMOS!, "mono"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

  it("migrates each demo; dodge_the_creeps and pong build, and every compiler error left is a TO DO", { timeout: 1_200_000 }, async () => {
    const report: string[] = [];
    for (const demo of demos) {
      const root = join(mkdtempSync(join(tmpdir(), "godotwright-mono3-")), demo);
      cpSync(join(DEMOS!, "mono", demo), root, { recursive: true });
      const m = await migrateProjectChecked(root, { write: true, includeAddons: true });
      const build = await buildCSharp(root);
      const errors = build.diagnostics.filter((d) => d.severity === "error" && d.file);
      const todos = m.files.flatMap((f) => f.left.map((l) => `${f.file}:${l.line} ${l.message}`));
      report.push(`${demo}: ${build.status}, ${m.left} TO DOs, ${errors.length} errors`);
      // Nothing that does not build is left unreported.
      for (const e of errors) expect(todos.some((t) => t.startsWith(`${e.file}:${e.line} `) && t.includes(e.message)), `${demo}: ${e.file}:${e.line} ${e.message}`).toBe(true);
      if (demo === "dodge_the_creeps" || demo === "pong") expect(build.status, demo).toBe("ok");
    }
    console.log(report.join("\n"));
  });
});
