import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../project/files.js";
import { formatFinding } from "./format.js";
import type { ReviewReport } from "./review.js";
import type { Finding } from "./rules.js";

/** What changed since the previous review of the same project. */
export interface ReviewDelta {
  /** Findings that were not there last time. */
  fresh: Finding[];
  /** Findings that were there last time and still are. */
  open: Finding[];
  /** How many findings of last time are gone. */
  fixed: number;
  /** How many findings there were last time. */
  previous: number;
  /** True when there was no previous review to compare with. */
  first: boolean;
}

const STORE = join(".godot", "godotwright", "review-last.json");

/** A finding without its line number, so an edit above it does not make it "new". */
const keyOf = (f: Finding): string => `${f.file}|${f.rule}|${f.message}`;

function storePath(path: string): string | undefined {
  const root = findProjectRoot(path);
  return root ? join(root, STORE) : undefined;
}

/**
 * Compares the report with the previous review of this project and remembers the report for the next time.
 * The memory lives in `.godot/godotwright/`, which Godot projects ignore in git.
 */
export function reviewDelta(path: string, report: ReviewReport, options: { remember?: boolean } = {}): ReviewDelta {
  const file = storePath(path);
  let before: string[] | undefined;
  if (file && existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as { keys?: unknown };
      if (Array.isArray(data.keys)) before = data.keys.filter((k): k is string => typeof k === "string");
    } catch {
      before = undefined;
    }
  }
  const now = report.findings.map(keyOf);
  if (file && options.remember !== false) {
    try {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ keys: now })}\n`);
    } catch {
      // A read-only project is reviewed all the same; only the memory is lost.
    }
  }
  if (!before) return { fresh: report.findings, open: [], fixed: 0, previous: 0, first: true };
  const seen = new Set(before);
  const fresh = report.findings.filter((f) => !seen.has(keyOf(f)));
  const open = report.findings.filter((f) => seen.has(keyOf(f)));
  const current = new Set(now);
  const fixed = before.filter((k) => !current.has(k)).length;
  return { fresh, open, fixed, previous: before.length, first: false };
}

/** Forgets the previous review of a project (the next delta starts over). */
export function forgetReview(path: string): void {
  const file = storePath(path);
  if (file) rmSync(file, { force: true });
}

export interface DeltaFormat {
  /** At most this many new findings in full (default all). */
  cap?: number;
  /** Only findings in these res:// files. */
  focus?: string[];
  /** Leave out infos (default false). */
  noInfos?: boolean;
  indent?: string;
}

/**
 * The findings part of a review as a delta: new findings in full, the ones still open as one short line each,
 * and how many are fixed. Made for an agent in a fix loop, which already read the open ones last time.
 */
export function formatDelta(delta: ReviewDelta, options: DeltaFormat = {}): string {
  const pad = options.indent ?? "";
  const keep = (f: Finding) => (!options.focus?.length || options.focus.includes(f.file)) && !(options.noInfos && f.severity === "info");
  const fresh = delta.fresh.filter(keep);
  const open = delta.open.filter(keep);
  const out: string[] = [];
  if (delta.first) out.push(`${pad}first review of this project: every finding is new (the next review with only-new shows only what changed)`);
  else out.push(`${pad}since the last review: ${fresh.length} new, ${delta.fixed} fixed, ${open.length} still open (${delta.previous} before)`);
  const cap = options.cap ?? fresh.length;
  if (fresh.length) {
    out.push(`${pad}new:`);
    for (const f of fresh.slice(0, cap)) out.push(`${pad}  ${formatFinding(f)}`);
    if (fresh.length > cap) out.push(`${pad}  +${fresh.length - cap} more`);
  }
  if (open.length && !delta.first) {
    out.push(`${pad}still open (as reported before):`);
    for (const f of open.slice(0, Math.max(cap, 40))) out.push(`${pad}  ${f.file}${f.line ? `:${f.line}` : ""} ${f.severity} [${f.rule}]`);
    if (open.length > Math.max(cap, 40)) out.push(`${pad}  +${open.length - Math.max(cap, 40)} more`);
  }
  if (!fresh.length && !open.length) out.push(`${pad}no findings`);
  return `${out.join("\n")}\n`;
}
