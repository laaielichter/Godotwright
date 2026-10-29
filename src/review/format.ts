import type { Detail } from "../scan/format.js";
import type { ReviewReport } from "./review.js";
import { RULES, type Finding } from "./rules.js";

const BRIEF_FINDINGS = 25;

export function formatFinding(f: Finding): string {
  const where = `${f.file}${f.line ? `:${f.line}` : ""}`;
  return `${where}: ${f.severity} [${f.rule}] ${f.message}`;
}

/** The project, the scores and the typing line: everything above the findings. */
export function formatReviewSummary(report: ReviewReport): string {
  const out: string[] = [];
  out.push(`AAA review: ${report.project} (Godot ${report.godot}, ${report.scripts} scripts, ${report.scenes} scenes)`);
  out.push(`overall: ${report.overall}/100`);
  for (const c of report.categories) {
    const counts = [c.errors && `${c.errors} errors`, c.warnings && `${c.warnings} warnings`, c.infos && `${c.infos} infos`].filter(Boolean).join(", ");
    out.push(`  ${c.category.padEnd(12)} ${String(c.score).padStart(3)}  ${counts || "no findings"}`);
  }
  out.push(`  static typing: ${report.typing.percent}% (${report.typing.typed}/${report.typing.total} declarations)`);
  return `${out.join("\n")}\n`;
}

export function formatReview(report: ReviewReport, detail: Detail = "brief"): string {
  const out: string[] = [formatReviewSummary(report).trimEnd()];

  const shown = detail === "full" ? report.findings : report.findings.filter((f) => f.severity !== "info").slice(0, BRIEF_FINDINGS);
  const hidden = report.findings.length - shown.length;
  out.push("");
  out.push(`findings (${report.findings.length}):`);
  for (const f of shown) {
    out.push(`  ${formatFinding(f)}`);
    if (detail === "full") out.push(`    fix: ${RULES[f.rule]?.fix ?? ""}`);
  }
  if (hidden > 0) out.push(`  +${hidden} more (infos and the rest: use --detail full)`);
  if (report.learning?.hidden) out.push(`  ${report.learning.hidden} ${report.learning.hidden === 1 ? "finding" : "findings"} hidden because they were marked as wrong (godotwright learn reset undoes this)`);
  if (report.learning?.downgraded.length) out.push(`  learned: ${report.learning.downgraded.join(", ")} reported as warnings, because Godot did not confirm them`);
  return `${out.join("\n")}\n`;
}
