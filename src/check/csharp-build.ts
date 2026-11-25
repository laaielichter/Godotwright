import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseProjectSettings } from "../godot/project-settings.js";
import { projectRootOf } from "../scan/scan.js";
import { runGodot } from "./godot.js";
import type { Diagnostic } from "./log.js";

/**
 * The real C# compiler for a Godot .NET project: `dotnet build` on the project's .sln or .csproj, with MSBuild's
 * errors and warnings as the diagnostics `godot_check` reports (res:// paths, de-duplicated). Without `dotnet` on
 * PATH nothing is built and the result says so: that is not a problem of the project.
 */

export interface CSharpBuildOptions {
  /** Debug (the default, as Godot builds for the editor), ExportDebug or ExportRelease. */
  configuration?: string;
  /** Default 5 minutes. */
  timeoutMs?: number;
  /** The dotnet executable; found on PATH when omitted. */
  dotnet?: string;
}

export interface CSharpBuildResult {
  /**
   * ok: built without errors. failed: the build reported errors. no-project: no .csproj or .sln in the project root.
   * no-dotnet: dotnet is not installed, so nothing was built. timed-out: the build did not finish in time.
   */
  status: "ok" | "failed" | "no-project" | "no-dotnet" | "timed-out";
  /** The .sln or .csproj that was (or would be) built, relative to the project. */
  target?: string;
  /** True when the build also restored NuGet packages (no project.assets.json yet): that needs the network. */
  restored: boolean;
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  ms: number;
  exitCode: number | null;
  /** What to tell the user in one line. */
  note: string;
  /** The command that ran. */
  command?: string[];
  /** Raw output of the build. */
  log?: string;
}

/** The .csproj Godot builds (named by dotnet/project/assembly_name, else the only one in the root) and the .sln next to it. */
export function findCSharpProject(root: string): { csproj?: string; sln?: string } {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return {};
  }
  const projects = names.filter((n) => /\.csproj$/i.test(n)).sort();
  const solutions = names.filter((n) => /\.slnx?$/i.test(n)).sort();
  let assembly: string | undefined;
  try {
    const value = parseProjectSettings(readFileSync(join(root, "project.godot"), "utf8")).values["dotnet/project/assembly_name"];
    if (typeof value === "string" && value) assembly = value;
  } catch {
    // No readable project.godot: the file names decide.
  }
  const pick = (list: string[], ext: RegExp) => list.find((n) => assembly !== undefined && n.replace(ext, "") === assembly) ?? list[0];
  const csproj = pick(projects, /\.csproj$/i);
  const sln = pick(solutions, /\.slnx?$/i);
  return { ...(csproj ? { csproj } : {}), ...(sln ? { sln } : {}) };
}

/** True when the project has a .csproj or .sln in its root. */
export function hasCSharpProject(root: string): boolean {
  const found = findCSharpProject(root);
  return Boolean(found.csproj ?? found.sln);
}

/** The dotnet executable on PATH (or `$DOTNET_ROOT`), or undefined. */
export function findDotnet(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const names = platform === "win32" ? ["dotnet.exe", "dotnet.cmd", "dotnet"] : ["dotnet"];
  const dirs = [...(env["PATH"] ?? env["Path"] ?? "").split(delimiter), ...(env["DOTNET_ROOT"] ? [env["DOTNET_ROOT"]] : [])].filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const file = join(dir, name);
      try {
        if (statSync(file).isFile()) return file;
      } catch {
        // Not here.
      }
    }
  }
  return undefined;
}

// path(line,col): error CS0103: message [project.csproj]   (also path(line,col,endLine,endCol) and path(line))
const LOCATED = /^\s*(?:\d+>)?(.+?)\((\d+)(?:,(\d+))?(?:,\d+,\d+)?\)\s*:\s*(error|warning)\s+([A-Za-z]+\d+)\s*:\s*(.*)$/;
// MSBUILD : error MSB1009: message      /x/Game.csproj : error NU1101: message [/x/Game.sln]      CSC : error CS5001: ...
const UNLOCATED = /^\s*(?:\d+>)?(?:(.+?)\s*:\s*)?(error|warning)\s+([A-Za-z]+\d+)\s*:\s*(.*)$/;
const IN_PROJECT = /\s+\[([^\]]+?\.(?:cs|fs|vb)proj|[^\]]+?\.slnx?)(?:::[^\]]*)?\]\s*$/i;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * What every dotnet command Godotwright starts runs with: English messages whatever the machine's language (the
 * compiler's texts are localised, e.g. German with DOTNET_CLI_UI_LANGUAGE=de), no first-run banner in the output and
 * no telemetry sent on the user's behalf.
 */
export const DOTNET_ENV: Record<string, string> = { DOTNET_CLI_UI_LANGUAGE: "en", DOTNET_NOLOGO: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1" };

/** True when NuGet restored the project before. The Godot.NET.Sdk keeps obj/ under .godot/mono/temp/; a plain .NET project next to the .csproj. */
export function isRestored(root: string, csproj?: string): boolean {
  const dirs = [join(root, ".godot", "mono", "temp", "obj"), join(root, "obj"), ...(csproj ? [join(root, dirname(csproj), "obj")] : [])];
  return dirs.some((d) => existsSync(join(d, "project.assets.json")));
}

/**
 * MSBuild's console output as diagnostics. `root` is the Godot project: files inside it become res:// paths, a file
 * outside it (an SDK targets file) stays in the message. A relative path is relative to the project file MSBuild names
 * in the brackets at the end of the line. The same line printed twice (once per target framework, or again in the
 * summary) is kept once.
 */
export function parseMsbuildOutput(output: string, root: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  // MSBuild prints the real path: a project reached through a symlink (/tmp on macOS) is still the project.
  let real = root;
  try {
    real = realpathSync(root);
  } catch {
    // Not on disk (a test, or a log from another machine).
  }
  const toRes = (path: string, project: string | undefined): string | undefined => {
    const base = project ? dirname(isAbsolute(project) ? project : resolve(root, project)) : root;
    const full = isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) ? path : resolve(base, path.replace(/\\/g, "/"));
    for (const from of real === root ? [root] : [root, real]) {
      const rel = relative(from, full).replace(/\\/g, "/");
      if (!(rel === "" || rel.startsWith("..") || isAbsolute(rel) || /^[A-Za-z]:/.test(rel))) return `res://${rel}`;
    }
    return undefined;
  };
  for (const raw of output.split(/\r?\n/)) {
    let line = raw.replace(ANSI, "").trimEnd();
    if (!/\b(error|warning)\s+[A-Za-z]+\d+\s*:/.test(line)) continue;
    const project = IN_PROJECT.exec(line)?.[1];
    if (project) line = line.replace(IN_PROJECT, "");
    const located = LOCATED.exec(line);
    let d: Diagnostic;
    if (located) {
      const [, path, lineNo, , severity, code, message] = located;
      const file = toRes(path!.trim(), project);
      d = { severity: severity as "error" | "warning", ...(file ? { file, line: Number(lineNo) } : {}), message: `${code}: ${message!.trim()}${file ? "" : ` (${path!.trim()}:${lineNo})`}`, source: "csharp" };
    } else {
      const m = UNLOCATED.exec(line);
      if (!m) continue;
      const [, origin, severity, code, message] = m;
      // The origin is a file (Game.csproj) or a tool (MSBUILD, CSC, NuGet).
      const isFile = origin !== undefined && /[\\/.]/.test(origin) && !/\s/.test(origin.trim());
      const file = isFile ? toRes(origin!.trim(), project) : undefined;
      d = { severity: severity as "error" | "warning", ...(file ? { file } : {}), message: `${code}: ${message!.trim()}`, source: "csharp" };
    }
    const key = `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * Builds the C# project of a Godot project with `dotnet build`. Packages are restored only when they were never
 * restored (no project.assets.json, see isRestored): the result says so, since a restore needs the network.
 */
export async function buildCSharp(project: string, options: CSharpBuildOptions = {}): Promise<CSharpBuildResult> {
  const root = projectRootOf(project);
  const empty = { restored: false, diagnostics: [], errors: 0, warnings: 0, ms: 0, exitCode: null };
  const found = findCSharpProject(root);
  const target = found.sln ?? found.csproj;
  if (!target) return { ...empty, status: "no-project", note: "no .csproj or .sln in the project root: this is not a C# project, or Godot has not made the C# solution yet (Project > Tools > C# > Create C# solution)" };
  const dotnet = options.dotnet ?? findDotnet();
  if (!dotnet) {
    return { ...empty, status: "no-dotnet", target, note: `dotnet is not on PATH, so ${target} was not built and C# compile errors are not checked (install the .NET SDK 8 or later; godot_review still checks the C# files)` };
  }
  // Restored before: build with what is there, so a check never waits on (or fails for) the network.
  const assets = isRestored(root, found.csproj);
  // --no-incremental: a build that is up to date skips the compiler, and with it every warning it gave last time.
  const args = ["build", target, "--nologo", "-v", "q", "-consoleloggerparameters:NoSummary", "--no-incremental", ...(options.configuration ? ["--configuration", options.configuration] : []), ...(assets ? ["--no-restore"] : [])];
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const run = await runGodot(dotnet, args, { cwd: root, timeoutMs, env: DOTNET_ENV });
  const log = `${run.stdout}\n${run.stderr}`;
  const diagnostics = parseMsbuildOutput(log, root);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const how = assets ? "" : " (NuGet packages were restored first: there was no project.assets.json)";
  let status: CSharpBuildResult["status"] = run.timedOut ? "timed-out" : run.code === 0 && errors === 0 ? "ok" : "failed";
  if (run.timedOut) diagnostics.push({ severity: "error", message: `dotnet build timed out after ${Math.round(timeoutMs / 1000)}s${assets ? "" : " (it was restoring NuGet packages; run `dotnet restore` once with network access)"}`, source: "csharp" });
  else if (status === "failed" && errors === 0) {
    // A failure MSBuild did not word as `error X0000:` must not pass as clean.
    const tail = log.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400) || "(no output)";
    diagnostics.push({ severity: "error", message: `dotnet build exited with code ${run.code}; last output: ${tail}`, source: "csharp" });
  }
  const finalErrors = diagnostics.filter((d) => d.severity === "error").length;
  if (finalErrors > 0 && status === "ok") status = "failed";
  const note =
    status === "ok"
      ? `dotnet build ${target}: ok, ${warnings} warning${warnings === 1 ? "" : "s"}${how}`
      : status === "timed-out"
        ? `dotnet build ${target}: timed out`
        : `dotnet build ${target}: ${finalErrors} error${finalErrors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}${how}`;
  return { status, target, restored: !assets, diagnostics, errors: finalErrors, warnings, ms: run.ms, exitCode: run.code, note, command: ["dotnet", ...args], log };
}
