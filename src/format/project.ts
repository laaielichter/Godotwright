import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { JournalWriter } from "../journal/journal.js";
import { fromResPath, isInside, listProjectFiles, toResPath } from "../project/files.js";
import { OptionError } from "../project/options.js";
import { ProtectedPathError } from "../project/protect.js";
import { projectRootOf } from "../scan/scan.js";
import { changedLineCount, unifiedDiff } from "./diff.js";
import { formatScript } from "./format.js";

export interface FormatProjectOptions {
  /** Only these scripts or folders: `res://` paths, or paths on disk. Default: every .gd file of the project. */
  files?: string[];
  /** Write the formatted scripts (default false: only report what would change). */
  write?: boolean;
  /** Also format res://addons/ (default false). A file named in `files` is always formatted. */
  includeAddons?: boolean;
  /** Add a unified diff to every changed file. */
  diff?: boolean;
}

export interface FormatChange {
  /** `res://` path. */
  file: string;
  /** Lines the formatter changes, adds or removes. */
  lines: number;
  /** Unified diff, with `diff: true`. */
  diff?: string;
}

export interface FormatSkip {
  file: string;
  reason: string;
}

export interface FormatReport {
  root: string;
  /** True when the changed files were written. */
  written: boolean;
  /** Scripts looked at. */
  files: number;
  changed: FormatChange[];
  unchanged: number;
  /** Scripts left as they are, and why (a script that cannot be read, mixed indentation, a guard refusal). */
  skipped: FormatSkip[];
  /** The journal entry of the write, for `godotwright undo`. */
  journal?: number;
}

/** The scripts to format, as `res://` paths. */
function scriptsOf(root: string, options: FormatProjectOptions): string[] {
  const all = () => listProjectFiles(root).filter((f) => f.endsWith(".gd"));
  if (!options.files?.length) return all().filter((f) => options.includeAddons || !f.startsWith("res://addons/"));
  const out = new Set<string>();
  let listed: string[] | undefined;
  for (const named of options.files) {
    const res = named.startsWith("res://") ? named : toResPath(root, resolve(named));
    const full = fromResPath(root, res);
    if (!isInside(root, full) || !existsSync(full)) throw new OptionError(`${res} does not exist in the project`);
    if (statSync(full).isDirectory()) {
      const prefix = res.endsWith("/") ? res : `${res}/`;
      listed ??= all();
      for (const f of listed) {
        if ((res === "res://" || f.startsWith(prefix)) && (options.includeAddons || !f.startsWith("res://addons/") || prefix.startsWith("res://addons/"))) out.add(f);
      }
    } else if (res.endsWith(".gd")) out.add(res);
    else throw new OptionError(`${res} is not a GDScript file`);
  }
  return [...out].sort();
}

/**
 * Formats the GDScript files of a project (see `formatScript`). Nothing is written without `write`; with it,
 * the writes go through the journal, so `godotwright undo` puts the files back. A script the formatter
 * cannot format safely is skipped with a reason and never written.
 */
export function formatProject(path: string, options: FormatProjectOptions = {}): FormatReport {
  const root = projectRootOf(path);
  const scripts = scriptsOf(root, options);
  const report: FormatReport = { root, written: false, files: scripts.length, changed: [], unchanged: 0, skipped: [] };
  const journal = options.write ? new JournalWriter(root, "format", "format scripts") : undefined;
  for (const file of scripts) {
    const full = fromResPath(root, file);
    const bytes = readFileSync(full);
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) {
      report.skipped.push({ file, reason: "the file is not valid UTF-8" });
      continue;
    }
    const result = formatScript(source);
    if (result.skipped !== undefined) {
      report.skipped.push({ file, reason: result.skipped });
      continue;
    }
    if (!result.changed) {
      report.unchanged++;
      continue;
    }
    if (journal) {
      try {
        journal.write(full, result.text);
      } catch (error) {
        if (!(error instanceof ProtectedPathError)) throw error;
        report.skipped.push({ file, reason: error.message });
        continue;
      }
    }
    report.changed.push({ file, lines: changedLineCount(source, result.text), ...(options.diff ? { diff: unifiedDiff(file.slice("res://".length), source, result.text) } : {}) });
  }
  if (journal) {
    report.written = true;
    const id = journal.commit();
    if (id !== undefined) report.journal = id;
  }
  return report;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The report as text: the files that change (at most `limit`), the skipped ones with their reason, and what to do next. */
export function formatFormatReport(report: FormatReport, limit = 30): string {
  const out: string[] = [];
  const skipped = report.skipped.length ? `, ${report.skipped.length} skipped` : "";
  if (!report.files) return "format: no GDScript files to format\n";
  if (!report.changed.length) out.push(`format: ${plural(report.files, "script")} checked, all formatted already${skipped}`);
  else out.push(`format: ${report.written ? "formatted" : "would format"} ${report.changed.length} of ${plural(report.files, "script")}${skipped}`);
  for (const c of report.changed.slice(0, limit)) out.push(`  ${c.file} (${plural(c.lines, "line")})`);
  if (report.changed.length > limit) out.push(`  ... ${report.changed.length - limit} more`);
  if (report.skipped.length) {
    out.push("skipped (left as they are):");
    for (const s of report.skipped.slice(0, limit)) out.push(`  ${s.file}: ${s.reason}`);
    if (report.skipped.length > limit) out.push(`  ... ${report.skipped.length - limit} more`);
  }
  for (const c of report.changed.slice(0, limit)) if (c.diff) out.push("", c.diff.trimEnd());
  if (report.changed.length) {
    out.push(
      report.written
        ? `Next: only whitespace changed, and the guard checked every file${report.journal !== undefined ? `; godotwright undo puts them back (journal #${report.journal})` : ""}.`
        : "Next: nothing was written; write: true (--write) formats them, diff: true (--diff) shows the changes first.",
    );
  }
  return `${out.join("\n")}\n`;
}
