import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { withoutSubResource } from "../project/files.js";
import type { Diagnostic } from "../check/log.js";
import type { ReviewReport } from "./review.js";

export function escapeAnnotationData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function escapeAnnotationProperty(value: string): string {
  return escapeAnnotationData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

/** Resolve a Godot res:// path to a workspace-relative path; missing files remain unlocated. */
export function annotationFile(file: string | undefined, projectRoot: string, cwd = process.cwd(), workspace = process.env.GITHUB_WORKSPACE): string | undefined {
  if (!file) return undefined;
  const path = withoutSubResource(file).replace(/^res:\/\//, "");
  if (!path || (!file.startsWith("res://") && !isAbsolute(file))) return undefined;
  const absolute = isAbsolute(path) ? resolve(path) : resolve(projectRoot, path);
  if (!existsSync(absolute)) return undefined;
  const base = workspace ? resolve(workspace) : resolve(cwd);
  const root = resolve(projectRoot);
  const relativeTo = workspace && inside(base, root) ? base : resolve(cwd);
  return relative(relativeTo, absolute).split(sep).join("/");
}

function command(level: "error" | "warning" | "notice", message: string, file?: string, line?: number, title?: string): string {
  const properties: string[] = [];
  if (file) properties.push(`file=${escapeAnnotationProperty(file)}`);
  if (line && line > 0) properties.push(`line=${line}`);
  if (title) properties.push(`title=${escapeAnnotationProperty(title)}`);
  return `::${level}${properties.length ? ` ${properties.join(",")}` : ""}::${escapeAnnotationData(message)}`;
}

export function reviewAnnotations(report: ReviewReport, options: { detailFull?: boolean; projectRoot?: string } = {}): string[] {
  return report.findings
    .filter((finding) => finding.severity !== "info" || options.detailFull)
    .map((finding) => command(
      finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "notice",
      finding.message,
      options.projectRoot ? annotationFile(finding.file, options.projectRoot) : undefined,
      finding.line,
      finding.rule,
    ));
}

export function ciAnnotations(review: ReviewReport | undefined, diagnostics: Diagnostic[], projectRoot: string): string[] {
  const findings = review ? reviewAnnotations(review, { projectRoot }) : [];
  const checks = diagnostics.map((diagnostic) => command(
    diagnostic.severity === "error" ? "error" : "warning",
    diagnostic.message,
    annotationFile(diagnostic.file, projectRoot),
    diagnostic.line,
    diagnostic.source,
  ));
  return [...findings, ...checks];
}
