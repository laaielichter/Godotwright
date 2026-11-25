import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildCSharp, findCSharpProject, findDotnet } from "../check/csharp-build.js";
import { runGodot } from "../check/godot.js";
import { allClasses, maskCSharp, outlineCSharp } from "../godot/csharp.js";
import type { JournalWriter } from "../journal/journal.js";
import { fromResPath, listProjectFiles } from "../project/files.js";
import { ProtectedPathError } from "../project/protect.js";
import { changedLineCount, unifiedDiff } from "./diff.js";
import type { FormatChange, FormatSkip } from "./project.js";

/**
 * C# formatting with `dotnet format whitespace`, the formatter of the .NET SDK (the one that builds the project, so
 * there is nothing more to install). It follows the project's .editorconfig; without one it writes the .NET defaults,
 * which are also Godot's C# style guide (4 spaces, Allman braces, LF). Only the project's own .editorconfig files apply
 * (one in a folder above the project is not seen). Whitespace only: it never touches names,
 * usings or code style, and it runs on a copy of the asked files in a temp folder (`--folder`, so no restore, no build,
 * no network), so nothing else in the project is formatted.
 *
 * The same promise as the GDScript formatter: the meaning may not change. Each file is checked three ways before it is
 * kept: the code outside strings and comments is the same once whitespace is dropped, every string literal is the same,
 * and the outline has as many symbols. When writing, the project is built before and after (with the .NET SDK and a
 * .csproj); a file whose new text makes the build worse is put back and reported as skipped.
 */

export interface CSharpFormatOptions {
  write?: boolean;
  diff?: boolean;
  journal?: JournalWriter;
  /** The dotnet executable (default: findDotnet). */
  dotnet?: string;
  /** Build before and after writing (default true when there is a .csproj). */
  build?: boolean;
}

export interface CSharpFormatResult {
  changed: FormatChange[];
  unchanged: number;
  skipped: FormatSkip[];
  /** Errors of `dotnet build` before and after the write, when it ran. */
  build?: { before: number; after: number };
}

/** Everything in the outline that has a name: classes, methods, members, exports and signals. */
export function csharpSymbolCount(source: string): number {
  return allClasses(outlineCSharp(source)).reduce((n, c) => n + 1 + c.methods.length + c.members.length + c.exports.length + c.signals.length, 0);
}

/** Why the formatted text may not mean the same as the source, or undefined when only whitespace changed. */
export function csharpMeaningChange(before: string, after: string): string | undefined {
  const a = maskCSharp(before);
  const b = maskCSharp(after);
  const squash = (code: string) => code.replace(/\s+/g, "");
  if (squash(a.code) !== squash(b.code)) return "the formatter changed more than whitespace in the code";
  const values = (m: ReturnType<typeof maskCSharp>) => [...m.literals.values()].sort((x, y) => x.start - y.start).map((l) => l.value);
  const va = values(a);
  const vb = values(b);
  if (va.length !== vb.length || va.some((v, i) => v !== vb[i])) return "the formatter changed a string";
  if (csharpSymbolCount(before) !== csharpSymbolCount(after)) return "the outline has a different number of symbols after formatting";
  return undefined;
}

/** The project's .editorconfig and .globalconfig files, which dotnet format reads, as res:// paths. */
function configFiles(root: string): string[] {
  return listProjectFiles(root).filter((f) => /(?:^|\/)\.editorconfig$|\.globalconfig$/i.test(f));
}

/** Runs dotnet format whitespace on copies of `files`; returns the formatted text of each one. */
async function formatCopies(root: string, files: string[], dotnet: string): Promise<{ texts: Map<string, string>; error?: string }> {
  const temp = mkdtempSync(join(tmpdir(), "godotwright-csformat-"));
  try {
    const rel = (res: string) => res.slice("res://".length);
    // listProjectFiles skips dot files: the root .editorconfig is looked for by name.
    const configs = new Set(configFiles(root));
    for (const name of [".editorconfig", ".globalconfig"]) {
      try {
        readFileSync(join(root, name));
        configs.add(`res://${name}`);
      } catch {
        // Not there.
      }
    }
    for (const res of [...files, ...configs]) {
      const target = join(temp, rel(res));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(fromResPath(root, res), target);
    }
    const run = await runGodot(dotnet, ["format", "whitespace", temp, "--folder", "--include", ...files.map(rel), "-v", "q"], { cwd: temp, timeoutMs: 120_000 });
    const texts = new Map<string, string>();
    for (const res of files) texts.set(res, readFileSync(join(temp, rel(res)), "utf8"));
    if (run.code !== 0) return { texts, error: `dotnet format exited with code ${run.code}: ${`${run.stdout}\n${run.stderr}`.trim().split(/\r?\n/).slice(-2).join(" | ").slice(0, 300)}` };
    return { texts };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Formats the C# files `files` (res:// paths) of the project at `root`. */
export async function formatCSharp(root: string, files: string[], options: CSharpFormatOptions = {}): Promise<CSharpFormatResult> {
  const result: CSharpFormatResult = { changed: [], unchanged: 0, skipped: [] };
  if (!files.length) return result;
  const dotnet = options.dotnet ?? findDotnet();
  if (!dotnet) {
    for (const file of files) result.skipped.push({ file, reason: "dotnet is not on PATH: C# is formatted with dotnet format, which comes with the .NET SDK 8 or later" });
    return result;
  }
  const sources = new Map<string, string>();
  const todo: string[] = [];
  for (const file of files) {
    const bytes = readFileSync(fromResPath(root, file));
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) result.skipped.push({ file, reason: "the file is not valid UTF-8" });
    else {
      sources.set(file, source);
      todo.push(file);
    }
  }
  const { texts, error } = await formatCopies(root, todo, dotnet);
  if (error) {
    for (const file of todo) result.skipped.push({ file, reason: error });
    return result;
  }
  const changed = new Map<string, string>();
  for (const file of todo) {
    const before = sources.get(file)!;
    const after = texts.get(file) ?? before;
    if (after === before) {
      result.unchanged++;
      continue;
    }
    const why = csharpMeaningChange(before, after);
    if (why) {
      result.skipped.push({ file, reason: why });
      continue;
    }
    changed.set(file, after);
  }

  const journal = options.write ? options.journal : undefined;
  if (journal && changed.size) {
    const buildIt = options.build ?? Boolean(findCSharpProject(root).csproj ?? findCSharpProject(root).sln);
    const errors = async () => (await buildCSharp(root, { dotnet })).errors;
    const before = buildIt ? await errors() : 0;
    const write = (file: string, text: string): boolean => {
      try {
        journal.write(fromResPath(root, file), text);
        return true;
      } catch (e) {
        if (!(e instanceof ProtectedPathError)) throw e;
        result.skipped.push({ file, reason: e.message });
        return false;
      }
    };
    const kept = [...changed.entries()].filter(([file, text]) => write(file, text));
    let after = buildIt ? await errors() : 0;
    if (buildIt && after > before) {
      // Put every file back, then keep them one at a time while the build stays as good as before.
      for (const [file] of kept) journal.write(fromResPath(root, file), sources.get(file)!);
      const good: string[] = [];
      for (const [file, text] of kept) {
        journal.write(fromResPath(root, file), text);
        if (kept.length > 8 || (await errors()) > before) {
          journal.write(fromResPath(root, file), sources.get(file)!);
          result.skipped.push({ file, reason: `the build had more errors after formatting (${before} before); the file was put back` });
        } else good.push(file);
      }
      after = good.length ? await errors() : before;
      for (const [file] of kept) changed.delete(file);
      for (const file of good) changed.set(file, kept.find(([f]) => f === file)![1]);
    }
    if (buildIt) result.build = { before, after };
  }
  for (const [file, text] of changed) {
    const before = sources.get(file)!;
    result.changed.push({ file, lines: changedLineCount(before, text), ...(options.diff ? { diff: unifiedDiff(file.slice("res://".length), before, text) } : {}) });
  }
  return result;
}
