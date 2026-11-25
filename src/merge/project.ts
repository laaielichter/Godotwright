import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VariantParseError } from "../godot/variant.js";
import { fromResPath } from "../project/files.js";
import { changedFiles, fileAt, GitError, mergeBase, stagedFile, unmergedFiles } from "../project/git.js";
import { projectRootOf } from "../scan/scan.js";
import { formatMerge, mergeKindOf, mergeText, type MergeKind, type MergeOptions, type MergeResult } from "./merge.js";

export interface MergedFile {
  file: string;
  result?: MergeResult;
  /** Why this file was not merged (one side deleted it, or it does not parse). */
  skipped?: string;
  written?: boolean;
}

export interface MergeReport {
  /** "conflicts": the files a merge left in conflict. "preview": what merging `theirs` into HEAD would do. */
  mode: "conflicts" | "preview";
  project: string;
  theirs?: string;
  base?: string;
  files: MergedFile[];
  /** Other files both sides changed (scripts, shaders, ...): git merges those line by line. */
  others: string[];
  conflicts: number;
  ok: boolean;
}

export interface MergeProjectOptions extends MergeOptions {
  /** Only these res:// files. */
  files?: string[];
  /** A branch or commit: preview merging it into HEAD instead of finishing a merge in progress. */
  theirs?: string;
  /** Write the merged files into the working tree (a merge in progress only). */
  write?: boolean;
}

const text = (b: Buffer | undefined) => (b === undefined ? undefined : b.toString("utf8"));

function mergeOne(file: string, kind: MergeKind, base: string | undefined, ours: string | undefined, theirs: string | undefined, options: MergeOptions): MergedFile {
  if (ours === undefined || theirs === undefined) return { file, skipped: `${ours === undefined ? "our" : "their"} side deleted this file and the other changed it: decide which one stays` };
  try {
    return { file, result: mergeText(base ?? "", ours, theirs, kind, options) };
  } catch (error) {
    if (!(error instanceof VariantParseError)) throw error;
    return { file, skipped: `one of the three versions is not a file Godot can read (${error.message}); merge it by hand` };
  }
}

export function mergeProject(path: string, options: MergeProjectOptions = {}): MergeReport {
  const root = projectRootOf(path);
  const wanted = options.files?.length ? new Set(options.files.map((f) => (f.startsWith("res://") ? f : `res://${f.replace(/^\.?\//, "")}`))) : undefined;
  const pick = (file: string) => !wanted || wanted.has(file);
  const files: MergedFile[] = [];
  const others: string[] = [];
  const report: MergeReport = { mode: options.theirs ? "preview" : "conflicts", project: root, files, others, conflicts: 0, ok: true };
  const prefer: MergeOptions = options.prefer ? { prefer: options.prefer } : {};

  if (options.theirs) {
    const base = mergeBase(root, "HEAD", options.theirs);
    report.theirs = options.theirs;
    report.base = base.slice(0, 10);
    const changed = (ref: string) => new Set(changedFiles(root, base, ref).filter((c) => c.status !== "deleted").map((c) => c.file));
    const [mine, theirs] = [changed("HEAD"), changed(options.theirs)];
    for (const file of [...mine].filter((f) => theirs.has(f)).sort()) {
      if (!pick(file)) continue;
      const kind = mergeKindOf(file);
      if (!kind) {
        others.push(file);
        continue;
      }
      files.push(mergeOne(file, kind, text(fileAt(root, base, file)), text(fileAt(root, "HEAD", file)), text(fileAt(root, options.theirs, file)), prefer));
    }
  } else {
    for (const u of unmergedFiles(root)) {
      if (!pick(u.file)) continue;
      const kind = mergeKindOf(u.file);
      if (!kind) {
        others.push(u.file);
        continue;
      }
      const merged = mergeOne(u.file, kind, text(stagedFile(root, 1, u.file)), text(stagedFile(root, 2, u.file)), text(stagedFile(root, 3, u.file)), prefer);
      if (options.write && merged.result) {
        writeFileSync(fromResPath(root, u.file), merged.result.text);
        merged.written = true;
      }
      files.push(merged);
    }
  }
  report.conflicts = files.reduce((n, f) => n + (f.result?.conflicts.length ?? 0), 0);
  report.ok = report.conflicts === 0 && files.every((f) => !f.skipped);
  return report;
}

export function formatMergeReport(report: MergeReport, limit = 40): string {
  const lines: string[] = [];
  const n = report.files.length;
  if (report.mode === "preview") {
    lines.push(`Merging ${report.theirs} into HEAD (common ancestor ${report.base}): ${n} Godot file${n === 1 ? "" : "s"} changed on both sides.`);
    if (n === 0) lines.push("No scene, resource or project.godot was changed on both sides, so none of them can conflict.");
  } else if (n === 0 && report.others.length === 0) {
    return "No files are in conflict. To see what merging a branch would do before you merge it, pass theirs (a branch or commit).\n";
  } else lines.push(`${n} Godot file${n === 1 ? "" : "s"} in conflict.`);
  for (const f of report.files) {
    if (f.skipped) lines.push(`${f.file}: NOT MERGED: ${f.skipped}`);
    else lines.push(formatMerge(f.file, f.result!, limit).trimEnd());
  }
  if (report.others.length) lines.push(`Not merged by meaning (git merges these line by line): ${report.others.slice(0, 20).join(", ")}${report.others.length > 20 ? `, and ${report.others.length - 20} more` : ""}`);
  if (report.mode === "conflicts" && n > 0) {
    const written = report.files.filter((f) => f.written).map((f) => f.file.replace(/^res:\/\//, ""));
    if (written.length) {
      lines.push(`Written: ${written.join(", ")}.${report.conflicts ? " Each CONFLICT above holds the side named there: change it if the other value is right." : ""}`);
      lines.push(`Next: review the files (godot_review), then mark them resolved: git add ${written.join(" ")}`);
    } else lines.push("Nothing was written. Pass write: true (CLI: --write) to put the merged files in the working tree; prefer: \"theirs\" makes conflicts take their side.");
  } else if (report.mode === "preview") {
    lines.push(report.conflicts ? `${report.conflicts} conflict${report.conflicts === 1 ? "" : "s"} to settle. Run git merge, then this again without theirs (and with write) to finish it.` : n ? "These merge without conflicts by meaning. Git's own line merge may still stop on them: run git merge, then this again with write if it does." : "");
  }
  return `${lines.filter(Boolean).join("\n")}\n`;
}

/** The kind of a file a merge driver gets: from its real name, or from how it starts (git hands over temp files). */
export function sniffKind(name: string | undefined, content: string): MergeKind {
  const byName = name ? mergeKindOf(name) : undefined;
  if (byName) return byName;
  const head = content.replace(/^﻿/, "").trimStart();
  return head.startsWith("[gd_scene") ? "scene" : head.startsWith("[gd_resource") ? "resource" : "settings";
}

/** Merges three files on disk (what git gives a merge driver). */
export function mergeFiles(base: string, ours: string, theirs: string, options: MergeOptions & { name?: string } = {}): MergeResult {
  const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const o = read(ours);
  return mergeText(read(base), o, read(theirs), sniffKind(options.name ?? ours, o), options);
}

const ATTRIBUTES = ["*.tscn merge=godotwright", "*.tres merge=godotwright", "project.godot merge=godotwright"];

/**
 * Makes git use this merge for scenes, resources and project.godot: three lines in the project's .gitattributes
 * (to commit, so the team shares them) and the driver in this clone's git config (each clone runs it once).
 */
export function installMergeDriver(path: string, command = "npx -y godotwright"): { attributes: string; added: string[]; driver: string } {
  const root = projectRootOf(path);
  const driver = `${command} merge --driver %O %A %B --name %P`;
  const run = (args: string[]) => {
    try {
      execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const e = error as { code?: string; stderr?: Buffer };
      throw new GitError(e.code === "ENOENT" ? "git is not installed" : `git ${args.join(" ")} failed: ${e.stderr?.toString("utf8").trim().split("\n")[0] ?? ""}`);
    }
  };
  run(["rev-parse", "--is-inside-work-tree"]);
  run(["config", "merge.godotwright.name", "Godotwright: merge Godot scenes and resources by meaning"]);
  run(["config", "merge.godotwright.driver", driver]);
  const attributes = join(root, ".gitattributes");
  const current = existsSync(attributes) ? readFileSync(attributes, "utf8") : "";
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const added = ATTRIBUTES.filter((l) => !have.has(l));
  if (added.length) writeFileSync(attributes, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${added.join("\n")}\n`);
  return { attributes, added, driver };
}
