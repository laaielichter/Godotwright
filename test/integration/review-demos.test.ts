import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatFinding } from "../../src/review/format.js";
import { reviewProject } from "../../src/review/review.js";
import { DEMO_PROJECTS } from "./demo-list.js";

/** Official demo projects (pinned checkout in $GODOT_DEMOS) check clean in Godot, so the review must report no errors. */
const DEMOS = process.env["GODOT_DEMOS"];

describe.skipIf(!DEMOS)("godotwright review on official demo projects", () => {
  for (const demo of DEMO_PROJECTS) {
    it(demo, () => {
      const report = reviewProject(join(DEMOS!, demo));
      console.log(`=== ${demo}: ${report.overall}/100 ${report.categories.map((c) => `${c.category} ${c.score}`).join(", ")}`);
      for (const f of report.findings.filter((x) => x.severity !== "info")) console.log(formatFinding(f));
      expect(report.findings.filter((f) => f.severity === "error").map(formatFinding)).toEqual([]);
      expect(report.overall).toBeGreaterThanOrEqual(85);
    });
  }
});
