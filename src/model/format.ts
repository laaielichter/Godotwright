import type { Detail } from "../scan/format.js";
import type { ModelInfo } from "./inspect.js";
import type { ModelReport } from "./lint.js";
import { MODEL_RULES, type ModelFinding } from "./rules.js";

const MAX_NODES_BRIEF = 40;
const BRIEF_FINDINGS = 25;

function m(n: number): string {
  return `${n.toFixed(3)} m`;
}

export function formatModelInfo(info: ModelInfo, detail: Detail = "brief"): string {
  const out: string[] = [];
  out.push(`model: ${info.file} (${(info.bytes / 1048576).toFixed(1)} MB${info.generator ? `, ${info.generator}` : ""})`);
  out.push(`  ${info.triangles.toLocaleString("en-US")} triangles, ${info.nodes.length} nodes, ${info.materials.length} materials, ${info.textures.length} textures, ${info.animations} animations`);
  if (info.bounds) {
    const { min, max, size } = info.bounds;
    out.push(`  size: ${m(size[0])} wide (x), ${m(size[1])} high (y), ${m(size[2])} long (z)`);
    out.push(`  lowest point y = ${min[1].toFixed(3)}, x from ${min[0].toFixed(3)} to ${max[0].toFixed(3)}, z from ${min[2].toFixed(3)} to ${max[2].toFixed(3)}`);
  }
  const mb = info.textures.reduce((n, t) => n + t.megabytes, 0);
  if (info.textures.length) out.push(`  texture memory: about ${mb.toFixed(1)} MB (uncompressed RGBA with mipmaps)`);
  const shown = detail === "full" ? info.nodes : info.nodes.slice(0, MAX_NODES_BRIEF);
  out.push("");
  out.push("nodes:");
  for (const n of shown) out.push(`  ${"  ".repeat(n.depth)}${n.name}${n.mesh ? ` [mesh ${n.mesh}, ${n.triangles.toLocaleString("en-US")} tris]` : ""}`);
  if (shown.length < info.nodes.length) out.push(`  +${info.nodes.length - shown.length} more (use --detail full)`);
  if (detail === "full") {
    out.push("");
    out.push("materials:");
    for (const mat of info.materials) out.push(`  ${mat.name}${mat.doubleSided ? " (double sided)" : ""}${mat.normalMapped ? " (normal map)" : ""}`);
    out.push("");
    out.push("textures:");
    for (const t of info.textures) out.push(`  ${t.name}: ${t.width ?? "?"}x${t.height ?? "?"} ${t.format ?? ""} ${t.roles.join("+")} ${t.megabytes.toFixed(1)} MB`);
  }
  return `${out.join("\n")}\n`;
}

export function formatModelFinding(f: ModelFinding): string {
  return `${f.node ?? f.file}: ${f.severity} [${f.rule}] ${f.message}`;
}

export function formatModelReport(report: ModelReport, detail: Detail = "brief"): string {
  const out: string[] = [];
  out.push(`Model lint: ${report.file} (${report.triangles.toLocaleString("en-US")} triangles, ${report.nodes} nodes)`);
  out.push(`overall: ${report.overall}/100`);
  for (const c of report.categories) {
    const counts = [c.errors && `${c.errors} errors`, c.warnings && `${c.warnings} warnings`, c.infos && `${c.infos} infos`].filter(Boolean).join(", ");
    out.push(`  ${c.category.padEnd(12)} ${String(c.score).padStart(3)}  ${counts || "no findings"}`);
  }
  const shown = detail === "full" ? report.findings : report.findings.filter((f) => f.severity !== "info").slice(0, BRIEF_FINDINGS);
  const hidden = report.findings.length - shown.length;
  out.push("");
  out.push(`findings (${report.findings.length}):`);
  for (const f of shown) {
    out.push(`  ${formatModelFinding(f)}`);
    if (detail === "full") out.push(`    fix: ${MODEL_RULES[f.rule]?.fix ?? ""}`);
  }
  if (hidden > 0) out.push(`  +${hidden} more (infos and the rest: use --detail full)`);
  return `${out.join("\n")}\n`;
}
