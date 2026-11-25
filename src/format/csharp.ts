import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DOTNET_ENV, buildCSharp, findCSharpProject, findDotnet, isRestored } from "../check/csharp-build.js";
import { runGodot } from "../check/godot.js";
import { outlineCSharp } from "../godot/csharp.js";
import type { JournalWriter } from "../journal/journal.js";
import { fromResPath, toResPath } from "../project/files.js";
import { ProtectedPathError, assertWritable } from "../project/protect.js";
import { changedLineCount, unifiedDiff } from "./diff.js";
import type { FormatReport } from "./project.js";

/**
 * The C# side of `godot_format`: `dotnet format` on the project's .sln or .csproj, restricted to the requested files
 * (`--include`); without a project file, `dotnet format whitespace --folder`. The style is the project's own
 * (.editorconfig); without one, dotnet's defaults apply, which indent with four spaces where Godot's own templates use
 * tabs. Observed with dotnet 8.0.134: `--verify-no-changes` exits with 2 when a file would change and `--report`
 * writes the places as JSON; one run takes about 8 s on a small project (it loads the project).
 *
 * The promise is the GDScript formatter's: formatting cannot change what the code means. `dotnet format` can do more
 * than whitespace when the project's .editorconfig asks for it, so after it wrote, the outline of each changed file
 * (classes, members, signals, methods, the calls and every string literal) is compared with the one before, and the
 * project is built when it has a .csproj. A file whose outline differs, or that the build reports an error in, is put
 * back as it was and reported as skipped.
 */

export interface CSharpFormatOptions {
  write?: boolean;
  diff?: boolean;
  /** The dotnet executable; found on PATH when omitted. */
  dotnet?: string;
  /** Default 10 minutes per dotnet run. */
  timeoutMs?: number;
}

/** The outline without where things are: only what the code declares and says. String literals keep every character. */
export function outlineShape(source: string): string {
  const drop = new Set(["line", "endLine", "range", "body", "start", "end", "lineCount", "lineStarts"]);
  const walk = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!drop.has(k)) out[k] = walk(v, k);
      return out;
    }
    // Types and attribute arguments may get or lose spaces (`Dictionary<string,int>`); a literal's value may not.
    return typeof value === "string" && key !== "value" ? value.replace(/\s+/g, "") : value;
  };
  return JSON.stringify(walk(outlineCSharp(source)));
}

/** What differs between two outlines, in a few words. */
function outlineDifference(before: string, after: string): string {
  const a = JSON.parse(before) as { classes?: { name: string }[]; literals?: { value: string }[]; usages?: unknown[] };
  const b = JSON.parse(after) as typeof a;
  if (JSON.stringify(a.literals) !== JSON.stringify(b.literals)) return "a string literal changed";
  if (JSON.stringify(a.classes?.map((c) => c.name)) !== JSON.stringify(b.classes?.map((c) => c.name))) return "the classes changed";
  if (JSON.stringify(a.usages) !== JSON.stringify(b.usages)) return "a call that names a node, file, signal, action or group changed";
  return "a class, member, signal or method changed";
}

interface ReportEntry {
  FilePath?: string;
  FileChanges?: { LineNumber?: number }[];
}

/** Formats the C# files (res:// paths) into `report`; writes go through `journal`. */
export async function formatCSharpFiles(root: string, files: string[], options: CSharpFormatOptions, report: FormatReport, journal: JournalWriter | undefined): Promise<void> {
  report.files += files.length;
  if (!files.length) return;
  const skipAll = (list: string[], reason: string) => report.skipped.push(...list.map((file) => ({ file, reason })));
  const dotnet = options.dotnet ?? findDotnet();
  if (!dotnet) {
    skipAll(files, "dotnet is not on PATH, and C# is formatted by `dotnet format` (install the .NET SDK 8 or later)");
    return;
  }
  const found = findCSharpProject(root);
  const target = found.sln ?? found.csproj;
  const base = target ? ["format", target, ...(isRestored(root, found.csproj) ? ["--no-restore"] : [])] : ["format", "whitespace", "--folder", "."];
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const write = Boolean(options.write && journal);
  const notes = (report.notes ??= []);
  if (!target) notes.push("C#: no .csproj or .sln in the project root, so only whitespace was formatted (dotnet format whitespace) and no build checked the result");

  // Files the journal may not write stay out of the run.
  let todo = files;
  if (write) {
    todo = [];
    for (const file of files) {
      try {
        assertWritable(fromResPath(root, file));
        todo.push(file);
      } catch (error) {
        if (!(error instanceof ProtectedPathError)) throw error;
        report.skipped.push({ file, reason: error.message });
      }
    }
  }

  const kept: string[] = [];
  const originals = new Map<string, Buffer>();
  for (const file of todo) originals.set(file, readFileSync(fromResPath(root, file)));
  const failed = (run: { code: number | null; stdout: string; stderr: string; timedOut: boolean }): string =>
    run.timedOut ? `dotnet format timed out after ${Math.round(timeoutMs / 1000)}s` : `dotnet format failed (exit ${run.code}): ${`${run.stdout}\n${run.stderr}`.trim().split(/\r?\n/).slice(-2).join(" | ").slice(0, 300) || "no output"}`;

  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const include = ["--include", ...chunk.map((f) => relative(root, fromResPath(root, f)))];
    if (!write) {
      // Nothing is written: dotnet format says which files would change, and where.
      const dir = mkdtempSync(join(tmpdir(), "godotwright-format-"));
      try {
        const run = await runGodot(dotnet, [...base, ...include, "--verify-no-changes", "--report", dir, "-v", "q"], { cwd: root, timeoutMs, env: DOTNET_ENV });
        if (run.timedOut || (run.code !== 0 && run.code !== 2)) {
          skipAll(chunk, failed(run));
          continue;
        }
        const places = new Map<string, number>();
        for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
          for (const entry of JSON.parse(readFileSync(join(dir, name), "utf8")) as ReportEntry[]) {
            if (!entry.FilePath) continue;
            const res = toResPath(root, entry.FilePath);
            places.set(res, (places.get(res) ?? 0) + new Set((entry.FileChanges ?? []).map((c) => c.LineNumber)).size);
          }
        }
        for (const file of chunk) {
          // dotnet names the real path: match by the end of it when the project is reached through a link.
          const lines = places.get(file) ?? [...places].find(([p]) => p.endsWith(file.slice("res://".length)) && !places.has(file))?.[1];
          if (lines) report.changed.push({ file, lines });
          else report.unchanged++;
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      continue;
    }

    const run = await runGodot(dotnet, [...base, ...include, "-v", "q"], { cwd: root, timeoutMs, env: DOTNET_ENV });
    const restore = (file: string) => writeFileSync(fromResPath(root, file), originals.get(file)!);
    if (run.timedOut || run.code !== 0) {
      for (const file of chunk) restore(file);
      skipAll(chunk, `${failed(run)}; the file was left as it was`);
      continue;
    }
    for (const file of chunk) {
      const before = originals.get(file)!;
      const after = readFileSync(fromResPath(root, file));
      if (after.equals(before)) {
        report.unchanged++;
        continue;
      }
      const was = outlineShape(before.toString("utf8"));
      const now = outlineShape(after.toString("utf8"));
      if (was !== now) {
        restore(file);
        report.skipped.push({ file, reason: `dotnet format changed more than the layout (${outlineDifference(was, now)}): the file was put back as it was` });
        continue;
      }
      kept.push(file);
    }
  }
  if (!write) {
    if (report.changed.some((c) => c.file.endsWith(".cs"))) notes.push("C#: the count is of lines dotnet format would touch; the outline and build checks run when the files are written (write: true), and a diff of C# files is shown then");
    return;
  }

  // The build has the last word: a formatted file the compiler now rejects goes back.
  if (found.csproj && kept.length) {
    let built = await buildCSharp(root, { dotnet, timeoutMs });
    if (built.status === "failed" || built.status === "timed-out") {
      const broken = new Set(built.diagnostics.filter((d) => d.severity === "error" && d.file).map((d) => d.file!));
      const blamed = kept.filter((f) => broken.has(f));
      for (const file of blamed) {
        const first = built.diagnostics.find((d) => d.severity === "error" && d.file === file)!;
        writeFileSync(fromResPath(root, file), originals.get(file)!);
        report.skipped.push({ file, reason: `dotnet build reports an error in it after formatting (line ${first.line ?? "?"}: ${first.message}): the file was put back as it was` });
      }
      kept.splice(0, kept.length, ...kept.filter((f) => !broken.has(f)));
      if (blamed.length && kept.length) built = await buildCSharp(root, { dotnet, timeoutMs });
      if (kept.length && (built.status === "failed" || built.status === "timed-out")) {
        // Not a file that was formatted: the project did not build to begin with, so the build cannot vouch for anything.
        const first = built.diagnostics.find((d) => d.severity === "error");
        for (const file of kept) writeFileSync(fromResPath(root, file), originals.get(file)!);
        skipAll(kept, `the project does not build (${first ? `${first.file ?? "dotnet build"}${first.line ? `:${first.line}` : ""}: ${first.message}` : built.note}), so the build could not check the formatting: the file was put back as it was`);
        kept.length = 0;
      }
    } else if (built.status !== "ok") {
      notes.push(`C#: the build did not check the result (${built.note})`);
    }
  }
  for (const file of kept) {
    const full = fromResPath(root, file);
    const before = originals.get(file)!.toString("utf8");
    const formatted = readFileSync(full);
    const after = formatted.toString("utf8");
    // dotnet format wrote the file itself: put the old bytes back for a moment, so the journal keeps them and makes the
    // write (and only the files that changed are in its entry).
    writeFileSync(full, originals.get(file)!);
    journal!.write(full, formatted);
    report.changed.push({ file, lines: changedLineCount(before, after), ...(options.diff ? { diff: unifiedDiff(file.slice("res://".length), before, after) } : {}) });
  }
  if (kept.length) notes.push(`C#: formatted by dotnet format; the outline of every file is the same as before${found.csproj ? " and the project builds" : ""}`);
}
