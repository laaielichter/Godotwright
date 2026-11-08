import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLibrary } from "../../src/archetype/library.js";
import { buildGlb } from "../../src/build/glb.js";
import { buildSpec } from "../../src/build/spec.js";
import { searchAssets, type LibraryAsset } from "../../src/library/library.js";
import type { Category } from "../../src/library/kit.js";
import { inspectModel } from "../../src/model/inspect.js";
import { lintModelFile } from "../../src/model/lint.js";
import { sha, writeScene } from "../build/helpers.js";

const archetypes = loadLibrary();

/** Triangle budgets per category: a library asset is placed many times, so it must stay light. */
export const BUDGET: Record<Category, number> = { furniture: 40_000, street: 40_000, storage: 40_000, nature: 80_000, buildings: 200_000, vehicles: 200_000, props: 60_000 };

/** Everything above info that the lint and the archetype check find in an asset built with these parameters, and any albedo finding. */
export function problems(asset: LibraryAsset, input: Record<string, unknown> = {}): { findings: string[]; triangles: number; min: number[]; size: number[] } {
  const path = writeScene(buildSpec(asset.spec, input));
  // LIBRARY_DUMP=<dir> keeps the default build of every asset, to look at (a contact sheet, Godot).
  const dump = process.env["LIBRARY_DUMP"];
  if (dump && Object.keys(input).length === 0) {
    mkdirSync(dump, { recursive: true });
    copyFileSync(path, join(dump, `${asset.id.replace("/", "--")}.glb`));
  }
  const report = lintModelFile(path, { archetype: archetypes.resolve(asset.archetype) });
  const info = inspectModel(path);
  return {
    // Albedo is info for models in general, but a library asset must look real under Godot's sun.
    findings: report.findings.filter((f) => f.severity !== "info" || f.rule === "model/albedo").map((f) => `${f.rule} ${f.node ?? ""} ${f.message}`),
    triangles: info.triangles,
    min: info.bounds!.min,
    size: info.bounds!.size,
  };
}

/**
 * The tests every asset of a category must pass. LIBRARY_FAMILY=<family> runs one family only; LIBRARY_EXTREMES=all
 * checks the parameter extremes of every asset instead of the first of each family.
 */
export function testCategory(category: Category): void {
  const only = process.env["LIBRARY_FAMILY"];
  const assets = searchAssets({ category }).filter((a) => !only || a.family === only);
  const firsts = new Set<string>();
  for (const a of assets) if (![...firsts].some((id) => assets.find((b) => b.id === id)!.family === a.family)) firsts.add(a.id);
  const allExtremes = process.env["LIBRARY_EXTREMES"] === "all";

  describe(`library: ${category}`, () => {
    it.skipIf(only !== undefined)("has assets", () => {
      expect(assets.length).toBeGreaterThan(0);
    });

    describe.each(assets.map((a) => [a.id, a] as const))("%s", (_id, asset) => {
      it("builds clean, on y = 0, within its archetype's size and the budget", () => {
        const r = problems(asset);
        expect(r.findings).toEqual([]);
        expect(r.triangles).toBeLessThanOrEqual(BUDGET[category]);
        expect(r.triangles).toBeGreaterThan(100);
        if (asset.archetype.startsWith("vessel")) expect(r.min[1]).toBeLessThan(-0.05);
        else {
          expect(r.min[1]).toBeGreaterThan(-0.06);
          expect(r.min[1]).toBeLessThan(0.05);
        }
        const s = archetypes.resolve(asset.archetype).scale;
        if (s) {
          const hi = Math.max(...[s.length, s.width, s.height].flatMap((x) => (x ? [x[1]] : [])));
          expect(Math.max(...r.size)).toBeLessThan(1.5 * hi);
        }
      });

      it.runIf(allExtremes || firsts.has(asset.id))("stays clean at the extremes of its parameters, and builds the same bytes twice", () => {
        const params = (asset.spec["params"] as { name: string; type: string; min?: number; max?: number }[]).filter((p) => p.type === "number" || p.type === "integer");
        const cases: Record<string, unknown>[] = [];
        for (const p of params) cases.push({ [p.name]: p.min }, { [p.name]: p.max });
        cases.push(Object.fromEntries(params.map((p) => [p.name, p.min])), Object.fromEntries(params.map((p) => [p.name, p.max])));
        for (const input of cases) expect(problems(asset, input).findings, JSON.stringify(input)).toEqual([]);
        expect(sha(buildGlb(buildSpec(asset.spec)))).toBe(sha(buildGlb(buildSpec(asset.spec))));
      });
    });
  });
}
