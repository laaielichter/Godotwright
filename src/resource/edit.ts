import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { cleanup } from "../check/check.js";
import { GodotNotFoundError, findGodot, runGodot } from "../check/godot.js";
import { parseGodotLog } from "../check/log.js";
import { JournalWriter } from "../journal/journal.js";
import { findProjectRoot, fromResPath, isInside, toResPath } from "../project/files.js";
import { reviewProject } from "../review/review.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { lineDiff, formatHunks, type Hunk } from "./diff.js";
import { destMd5, planImport, unmet, type Expectation } from "./import.js";
import { planTres } from "./tres.js";
import { ResourceEditError, type ResourceOp } from "./types.js";

export { ResourceEditError, type ResourceOp } from "./types.js";

export interface ReimportResult {
  /** changed: reimported and the output differs; same: reimported, identical output; dropped: Godot did not keep a value. */
  status: "changed" | "same" | "dropped" | "not_reimported" | "failed" | "skipped";
  message: string;
  errors: string[];
  ms?: number;
}

export interface ResourcePlan {
  file: string;
  kind: "resource" | "import";
  summary: string[];
  hunks: Hunk[];
  warnings: string[];
  info: string[];
  written: boolean;
  journal?: number;
  review?: { before: number; after: number };
  reimport?: ReimportResult;
}

export interface ResourceEditOptions {
  write?: boolean;
  project?: string;
  /** Godot binary for the reimport (default: found like godot_check finds it). */
  godot?: string;
  /** Reimport after writing a .import (default true). */
  reimport?: boolean;
  timeoutMs?: number;
}

const READ_ONLY = new Set(["get", "diff"]);

/**
 * Edits a text resource (.tres, or the sub_resources of a .tscn) or an asset's import settings (.import, or the
 * asset itself), with every name and value checked first. Without `write` nothing changes and the diff is returned.
 * A .import write is followed by a headless `--import`, and the result says whether Godot kept each value and
 * whether the imported output changed.
 */
export async function editResource(path: string, ops: ResourceOp[], options: ResourceEditOptions = {}): Promise<ResourcePlan> {
  if (!ops.length) throw new ResourceEditError(`give at least one op`);
  const start = options.project ?? (path.startsWith("res://") ? process.cwd() : dirname(resolve(path)));
  const root = findProjectRoot(start);
  if (!root) throw new ProjectNotFoundError(start);
  let full = path.startsWith("res://") ? fromResPath(root, path) : isAbsolute(path) ? path : resolve(path);
  if (!insideProject(root, full)) throw new ResourceEditError(`${path} is outside the project (${root}); give a file inside it`);
  if (!/\.(tres|tscn|import)$/.test(full) && existsSync(`${full}.import`)) full = `${full}.import`;
  // A new asset Godot has not imported yet: a reimport is the one thing to do with it.
  if (!/\.(tres|tscn|import)$/.test(full) && existsSync(full) && ops.every((o) => o.op === "reimport")) {
    const importFull = `${full}.import`;
    const run = await reimport(root, importFull, [], options, undefined);
    return { file: toResPath(root, importFull), kind: "import", summary: [`reimport ${toResPath(root, full)}`], hunks: [], warnings: [], info: [], written: false, reimport: run };
  }
  if (!existsSync(full)) throw new ResourceEditError(`${path} does not exist${/\.(tres|tscn|import)$/.test(full) ? "" : " (or has no .import file: Godot has not imported it yet)"}`);
  if (/\.(res|scn)$/.test(full)) throw new ResourceEditError(`${path} is a binary resource; save it as .tres to edit it as text`);
  if (!/\.(tres|tscn|import)$/.test(full)) throw new ResourceEditError(`${path} is not a .tres, .tscn or imported asset`);
  const resPath = toResPath(root, full);
  const original = readFileSync(full, "utf8");
  const isImport = full.endsWith(".import");
  const plan = isImport ? planImport(root, resPath, full.slice(0, -".import".length), original, ops) : planTres(root, resPath, original, ops);
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const hunks = lineDiff(original.split(eol), plan.text.split(eol));
  const changes = ops.some((o) => !READ_ONLY.has(o.op) && o.op !== "reimport");
  if (changes && plan.text === original) throw new ResourceEditError(`nothing to change: ${plan.summaries.join("; ")} ${plan.summaries.length === 1 ? "is" : "are"} already so`);
  const result: ResourcePlan = { file: resPath, kind: isImport ? "import" : "resource", summary: plan.summaries, hunks, warnings: plan.warnings, info: plan.info, written: false };
  const wantsReimport = ops.some((o) => o.op === "reimport");
  if (!options.write || !changes) {
    if (isImport && wantsReimport && !changes) result.reimport = await reimport(root, full, [], options, destMd5(root, original));
    return result;
  }

  if (!isImport) {
    const errors = () => reviewProject(root).categories.reduce((n, c) => n + c.errors, 0);
    const before = errors();
    const journal = new JournalWriter(root, "resource edit", plan.summaries.join("; "));
    journal.write(full, plan.text);
    const id = journal.commit();
    result.warnings.push("an editor that has this resource open keeps its cached copy: reload it there, or the editor writes the old one back when it saves");
    return { ...result, written: true, ...(id ? { journal: id } : {}), review: { before, after: errors() } };
  }

  const asset = resPath.replace(/\.import$/, "");
  const journal = new JournalWriter(root, "import edit", `${plan.summaries.join("; ")}`, `the imported output of ${asset} stays as last imported until Godot imports again: run godotwright resource reimport ${asset} (godot_resource_edit op reimport), or godot_check`);
  const before = destMd5(root, original);
  journal.write(full, plan.text);
  const done = options.reimport === false ? undefined : await reimport(root, full, "expect" in plan ? (plan.expect as Expectation[]) : [], options, before);
  // The journal is kept after the import: Godot rewrites the .import, and undo compares against that version.
  const id = journal.commit();
  result.warnings.push("an editor open on this project does not see this until it reimports (or restarts); close it or reimport there before saving");
  return { ...result, written: true, ...(id ? { journal: id } : {}), ...(done ? { reimport: done } : {}) };
}

/** Whether `full` lies in the project, also after following links (a missing file is judged by its folder). */
function insideProject(root: string, full: string): boolean {
  if (!isInside(root, full)) return false;
  const real = (p: string): string | undefined => {
    try {
      return realpathSync(p);
    } catch {
      return undefined;
    }
  };
  const realRoot = real(root) ?? root;
  const target = real(full) ?? real(dirname(full));
  return target === undefined || isInside(realRoot, target);
}

/** Runs `godot --headless --import` and checks what became of the edit. */
async function reimport(root: string, importFull: string, expect: Expectation[], options: ResourceEditOptions, before: ReturnType<typeof destMd5>): Promise<ReimportResult> {
  let bin: string;
  try {
    bin = findGodot(options.godot);
  } catch (error) {
    if (error instanceof GodotNotFoundError || /Godot binary not found/.test((error as Error).message)) {
      return { status: "skipped", message: `not reimported: ${(error as Error).message.split(". ")[0]}; the .import is written, run godot_check or open the editor to reimport`, errors: [] };
    }
    throw error;
  }
  const run = await runGodot(bin, ["--headless", "--path", root, "--import"], { cwd: root, timeoutMs: options.timeoutMs ?? 600_000 });
  const asset = toResPath(root, importFull).replace(/\.import$/, "");
  const name = asset.slice(asset.lastIndexOf("/") + 1);
  const diags = cleanup(parseGodotLog(`${run.stdout}\n${run.stderr}`, "import")).filter((d) => d.severity === "error");
  const mine = diags.filter((d) => d.file === asset || d.message.includes(name)).map((d) => d.message);
  const others = diags.length - mine.length;
  if (run.timedOut) return { status: "failed", message: `the import did not finish in ${Math.round((options.timeoutMs ?? 600_000) / 1000)} s`, errors: mine, ms: run.ms };
  const now = existsSync(importFull) ? readFileSync(importFull, "utf8") : "";
  const after = destMd5(root, now);
  const missing = unmet(now, expect);
  const tail = others ? `; ${others} other import error${others === 1 ? "" : "s"} in the project (godot_check)` : "";
  if (mine.length && !after) return { status: "failed", message: `Godot could not import ${asset}${tail}`, errors: mine, ms: run.ms };
  if (missing.length) return { status: "dropped", message: `Godot did not keep ${missing.join(", ")}: the option is not one this importer reads${tail}`, errors: mine, ms: run.ms };
  if (!after) return { status: "failed", message: `no imported output for ${asset} after the import${tail}`, errors: mine, ms: run.ms };
  const reimported = !before || after.mtime !== before.mtime || after.md5 !== before.md5;
  const kept = expect.length ? `Godot kept ${expect.length === 1 ? "the value" : `all ${expect.length} values`}, ` : "";
  if (!reimported) return { status: "not_reimported", message: `${kept}but Godot did not reimport ${asset} (its import record is unchanged)${tail}`, errors: mine, ms: run.ms };
  if (before && after.md5 === before.md5) return { status: "same", message: `reimported; ${kept}the output is identical (dest_md5 ${after.md5.slice(0, 8)}), so this setting changes nothing for this asset${tail}`, errors: mine, ms: run.ms };
  // dest_md5 also changes when only the options changed, so a changed output does not prove a per-item option took effect.
  const subs = expect.some((e) => e.what === "sub") ? "; Godot also does this for an option it ignores (such as one under a name the asset does not have), so check the result where it matters" : "";
  return { status: "changed", message: `reimported; ${kept}output changed (dest_md5 ${before ? `${before.md5.slice(0, 8)} -> ` : ""}${after.md5.slice(0, 8)})${subs}${tail}`, errors: mine, ms: run.ms };
}

/** The plan as compact text: what changes, the diff, warnings, and when written the review or reimport result. */
export function formatResourcePlan(plan: ResourcePlan): string {
  const out: string[] = [];
  if (plan.summary.length) {
    const state = plan.written ? `written${plan.journal ? `, journal #${plan.journal}: godot_undo reverts it` : ""}` : plan.hunks.length ? "dry run: add write to apply" : "";
    out.push(`${plan.kind === "import" ? "import" : "resource"} ${plan.summary.join("; ")}${state ? ` (${state})` : ""}`);
  }
  out.push(...plan.info);
  if (plan.hunks.length) out.push(plan.file, ...formatHunks(plan.hunks));
  for (const w of plan.warnings) out.push(`warning: ${w}`);
  if (plan.review) out.push(`review errors: ${plan.review.before} before, ${plan.review.after} after${plan.review.after > plan.review.before ? "  <- the change broke something: run godotwright review" : ""}`);
  if (plan.reimport) {
    out.push(`reimport ${plan.reimport.status}: ${plan.reimport.message}`);
    for (const e of plan.reimport.errors.slice(0, 5)) out.push(`  error: ${e}`);
  }
  return `${out.join("\n")}\n`;
}

/** Whether the result should count as a failure (more review errors, or a reimport that did not take). */
export function planFailed(plan: ResourcePlan): boolean {
  return Boolean((plan.review && plan.review.after > plan.review.before) || (plan.reimport && ["dropped", "failed", "not_reimported"].includes(plan.reimport.status)));
}
