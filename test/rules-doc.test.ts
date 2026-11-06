import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RULES, CATEGORIES } from "../src/review/rules.js";

describe("docs/rules.md", () => {
  const md = readFileSync(join(process.cwd(), "docs/rules.md"), "utf8");

  it("lists every rule from RULES and no others", () => {
    const listed = new Set<string>();
    // Rule IDs appear as `category/id` in the table
    for (const match of md.matchAll(/`([a-z]+\/[a-z0-9-]+)`/g)) {
      listed.add(match[1]!);
    }
    const expected = new Set(Object.keys(RULES));
    expect([...listed].sort()).toEqual([...expected].sort());
  });

  it("groups rules by the known categories", () => {
    for (const cat of CATEGORIES) {
      expect(md).toContain(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
    }
  });

  it("includes severity, title and fix for a sample rule", () => {
    const sample = RULES["api/unknown-type"];
    expect(sample).toBeDefined();
    if (!sample) return;
    expect(md).toContain("`api/unknown-type`");
    expect(md).toContain(sample.severity);
    expect(md).toContain(sample.title);
    // Escape pipes as the generator does
    expect(md).toContain(sample.fix.replace(/\|/g, "\\|"));
  });
});
