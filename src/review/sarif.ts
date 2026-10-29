import { VERSION } from "../version.js";
import type { ReviewReport } from "./review.js";
import { RULES, type Severity } from "./rules.js";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = { error: "error", warning: "warning", info: "note" };

/** A `res://` path as a path relative to the project root; a built-in script (`scene.tscn::Id`) points at its scene. */
export function sarifUri(file: string): string {
  return file.replace(/^res:\/\//, "").replace(/::.*$/, "");
}

/**
 * The review as SARIF 2.1.0, the format GitHub code scanning reads: every finding becomes a result with its rule,
 * level, message and location, so it shows inline on a pull request.
 */
export function toSarif(report: ReviewReport): object {
  const used = [...new Set(report.findings.map((f) => f.rule))].sort();
  const rules = used.map((id) => {
    const rule = RULES[id];
    return {
      id,
      name: id.replace(/[/-]+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase()),
      shortDescription: { text: rule?.title ?? id },
      ...(rule ? { help: { text: rule.fix }, fullDescription: { text: `${rule.title}. ${rule.fix}` } } : {}),
      defaultConfiguration: { level: LEVEL[rule?.severity ?? "warning"] },
      properties: { category: rule?.category ?? "quality" },
    };
  });
  const index = new Map(used.map((id, i) => [id, i]));
  const results = report.findings.map((f) => ({
    ruleId: f.rule,
    ruleIndex: index.get(f.rule),
    level: LEVEL[f.severity],
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: sarifUri(f.file), uriBaseId: "%SRCROOT%" },
          ...(f.line ? { region: { startLine: f.line } } : {}),
        },
      },
    ],
  }));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Godotwright",
            version: VERSION,
            informationUri: "https://github.com/laaielichter/Godotwright",
            rules,
          },
        },
        results,
        properties: { overall: report.overall, categories: Object.fromEntries(report.categories.map((c) => [c.category, c.score])), godot: report.godot },
      },
    ],
  };
}
