import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { findProjectRoot } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { checkProject, type CheckOptions, type CheckResult } from "./check.js";
import { formatDiagnostic, type Diagnostic } from "./log.js";

/**
 * Runs the same check with two Godot binaries and keeps only what differs: what breaks (or gets fixed) when the
 * project moves to another Godot release, e.g. a 4.8 beta.
 *
 * The second binary never touches the project: a different engine version re-imports into .godot/ and can rewrite
 * files, so it runs on a temporary copy without .godot/ and .git/, which is removed afterwards.
 */

export interface CompareOptions extends CheckOptions {
  /** The second Godot binary; default $GODOT_NEXT. */
  compareGodot?: string;
}

export interface CompareResult {
  base: CheckResult;
  other: CheckResult;
  /** Errors and warnings only the second binary reports. */
  onlyOther: Diagnostic[];
  /** Errors and warnings only the first binary reports (fixed, or no longer detected, in the second). */
  onlyBase: Diagnostic[];
  /** How many both report. */
  same: number;
}

/** The second binary: the one given, else $GODOT_NEXT. */
export function compareBinary(explicit: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const bin = explicit?.trim() || env["GODOT_NEXT"]?.trim();
  if (!bin || bin.startsWith("${")) throw new Error("No second Godot binary: pass compare_godot (--compare-godot <path>) or set GODOT_NEXT.");
  return bin;
}

/** Folders the copy leaves out: Godot's import cache (each engine version builds its own) and version control. */
const SKIP = new Set([".godot", ".git", ".hg", ".svn"]);

export async function compareGodot(path: string, options: CompareOptions = {}): Promise<CompareResult> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const second = compareBinary(options.compareGodot);
  const parent = mkdtempSync(join(tmpdir(), "godotwright-compare-"));
  const copy = join(parent, basename(root));
  try {
    cpSync(root, copy, {
      recursive: true,
      filter: (src) => !relative(root, src).split(sep).some((part) => SKIP.has(part)),
    });
    const { compareGodot: _skip, ...check } = options;
    const [base, other] = await Promise.all([checkProject(root, check), checkProject(copy, { ...check, godot: second })]);
    // Paths in messages point into the copy; make them point at the project, so the same message matches.
    const real = safeRealpath(copy);
    for (const d of other.diagnostics) d.message = d.message.split(real).join(root).split(copy).join(root);
    other.godot = second;
    return { base, other, ...diffDiagnostics(base, other) };
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The note each check adds when the binary is not the release Godotwright targets: it differs by design. */
const VERSION_NOTE = /^Godot \S+ found; Godotwright targets Godot /;

/**
 * The key two runs share for the same problem: severity, file, line and the message with its numbers left out, so a
 * count, an address or an engine line number that differs between the releases does not make it look new.
 */
export function diagnosticKey(d: Diagnostic): string {
  const message = d.message.replace(/0x[0-9a-f]+/gi, "#").replace(/\d+(\.\d+)?/g, "#").replace(/\s+/g, " ").trim();
  return `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${message}`;
}

export function diffDiagnostics(base: CheckResult, other: CheckResult): { onlyOther: Diagnostic[]; onlyBase: Diagnostic[]; same: number } {
  const relevant = (list: Diagnostic[]) => list.filter((d) => !(d.source === "engine" && VERSION_NOTE.test(d.message)));
  const a = relevant(base.diagnostics);
  const b = relevant(other.diagnostics);
  const inA = new Set(a.map(diagnosticKey));
  const inB = new Set(b.map(diagnosticKey));
  return {
    onlyOther: b.filter((d) => !inA.has(diagnosticKey(d))),
    onlyBase: a.filter((d) => !inB.has(diagnosticKey(d))),
    same: a.filter((d) => inB.has(diagnosticKey(d))).length,
  };
}

/** Short release name from `godot --version`: "4.8.beta2.official.abc" -> "4.8.beta2". */
export function shortVersion(version: string): string {
  return version.split(".").filter((p) => !/^(official|custom_build|mono)$/.test(p) && !/^[0-9a-f]{7,}$/.test(p)).join(".");
}

/** Compact text for agents: one summary line, then the new problems and the ones that went away. */
export function formatCompare(result: CompareResult, cap = 50): string {
  const a = shortVersion(result.base.godotVersion);
  const b = shortVersion(result.other.godotVersion);
  const newErrors = result.onlyOther.filter((d) => d.severity === "error").length;
  const out = [
    `Godot ${a} vs ${b}: ${result.onlyOther.length} new in ${b} (${newErrors} errors), ${result.onlyBase.length} gone, ${result.same} in both` +
      ` (${result.base.scripts} scripts, ${result.base.scenes} scenes)`,
  ];
  const list = (title: string, items: Diagnostic[]) => {
    if (!items.length) return;
    out.push(`${title}:`);
    for (const d of items.slice(0, cap)) out.push(formatDiagnostic(d));
    if (items.length > cap) out.push(`+${items.length - cap} more`);
  };
  list(`new in ${b}`, result.onlyOther);
  list(`gone in ${b}`, result.onlyBase);
  if (!result.onlyOther.length) out.push(`Nothing new in ${b}.`);
  return `${out.join("\n")}\n`;
}
