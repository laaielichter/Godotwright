import { describe, expect, it } from "vitest";
import { reviewProject } from "../src/review/review.js";
import { RULES } from "../src/review/rules.js";
import { sarifUri, toSarif } from "../src/review/sarif.js";
import { FIXTURES, runCli } from "./helpers.js";

interface Sarif {
  version: string;
  runs: { tool: { driver: { name: string; version: string; rules: { id: string; defaultConfiguration: { level: string }; help?: { text: string } }[] } }; results: { ruleId: string; ruleIndex: number; level: string; message: { text: string }; locations: { physicalLocation: { artifactLocation: { uri: string; uriBaseId: string }; region?: { startLine: number } } }[] }[]; properties: { overall: number } }[];
}

describe("SARIF output", () => {
  const report = reviewProject(`${FIXTURES}/messy`);
  const sarif = toSarif(report) as Sarif;
  const run = sarif.runs[0]!;

  it("is SARIF 2.1.0 with one run, one result per finding, and every rule the results use", () => {
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
    expect(run.tool.driver.name).toBe("Godotwright");
    expect(run.tool.driver.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(run.results).toHaveLength(report.findings.length);
    const ids = run.tool.driver.rules.map((r) => r.id);
    for (const r of run.results) {
      expect(ids).toContain(r.ruleId);
      expect(run.tool.driver.rules[r.ruleIndex]!.id).toBe(r.ruleId);
      expect(["error", "warning", "note"]).toContain(r.level);
    }
    for (const r of run.tool.driver.rules) expect(r.help?.text).toBe(RULES[r.id]!.fix);
    expect(run.properties.overall).toBe(report.overall);
  });

  it("maps severities to SARIF levels and res:// paths to project-relative files with the line", () => {
    const godot3 = run.results.find((r) => r.ruleId === "api/godot3-syntax")!;
    expect(godot3.level).toBe("error");
    expect(godot3.locations[0]!.physicalLocation.artifactLocation).toEqual({ uri: "scripts/old_player.gd", uriBaseId: "%SRCROOT%" });
    expect(godot3.locations[0]!.physicalLocation.region?.startLine).toBe(3);
    const info = run.results.find((r) => r.level === "note");
    expect(info).toBeDefined();
    expect(sarifUri("res://scenes/Main.tscn::GDScript_abc")).toBe("scenes/Main.tscn");
  });

  it("prints from the CLI with --sarif", async () => {
    const out = await runCli(["review", `${FIXTURES}/messy`, "--sarif"]);
    const parsed = JSON.parse(out.output) as Sarif;
    expect(parsed.runs[0]!.results.length).toBe(report.findings.length);
    expect(out.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
