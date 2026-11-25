import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  /** True when the build also restored NuGet packages (no obj/project.assets.json yet): that needs the network. */
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
// The code is optional: NuGet.targets(156,5): warning : Unable to find a project to restore!
const LOCATED = /^\s*(?:\d+>)?(.+?)\((\d+)(?:,(\d+))?(?:,\d+,\d+)?\)\s*:\s*(error|warning)(?:\s+([A-Za-z]+\d+))?\s*:[ \t]?(.*)$/;
// MSBUILD : error MSB1009: message      /x/Game.csproj : error NU1101: message [/x/Game.sln]      CSC : error CS5001: ...
// /x/Game.csproj : error : Could not resolve SDK "Godot.NET.Sdk". ...   and its indented detail lines below it.
const UNLOCATED = /^\s*(?:\d+>)?(?:(.+?)\s*:\s*)?(error|warning)(?:\s+([A-Za-z]+\d+))?\s*:[ \t]?(.*)$/;
const IN_PROJECT = /\s+\[([^\]]+?\.(?:cs|fs|vb)proj|[^\]]+?\.slnx?)(?:::[^\]]*)?\]\s*$/i;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * MSBuild's console output as diagnostics. `root` is the Godot project: files inside it become res:// paths, a file
 * outside it (an SDK targets file) stays in the message. A relative path is relative to the project file MSBuild names
 * in the brackets at the end of the line. The same line printed twice (once per target framework, or again in the
 * summary) is kept once. A message without a code (`error : Could not resolve SDK ...`) is kept too, and the indented
 * lines MSBuild prints under it from the same origin (the SDK resolver's reasons) become part of its message. The
 * formats are checked against real `dotnet build` output in test/fixtures/msbuild/.
 */
export function parseMsbuildOutput(output: string, root: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const toRes = (path: string, project: string | undefined): string | undefined => {
    const base = project ? dirname(isAbsolute(project) ? project : resolve(root, project)) : root;
    const full = isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) ? path : resolve(base, path.replace(/\\/g, "/"));
    const rel = relative(root, full).replace(/\\/g, "/");
    return rel === "" || rel.startsWith("..") || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) ? undefined : `res://${rel}`;
  };
  // The last diagnostic without a code, with its origin: indented lines from the same origin continue it.
  let open: { d: Diagnostic; origin: string } | undefined;
  for (const raw of output.split(/\r?\n/)) {
    let line = raw.replace(ANSI, "").trimEnd();
    if (!/\b(error|warning)(\s+[A-Za-z]+\d+)?\s*:/.test(line)) {
      open = undefined;
      continue;
    }
    const project = IN_PROJECT.exec(line)?.[1];
    if (project) line = line.replace(IN_PROJECT, "");
    const located = LOCATED.exec(line);
    let d: Diagnostic;
    let origin = "";
    let detail = false;
    if (located) {
      const [, path, lineNo, , severity, code, message] = located;
      const file = toRes(path!.trim(), project);
      origin = `${path}(${lineNo})`;
      const text = `${code ? `${code}: ` : ""}${message!.trim()}`;
      d = { severity: severity as "error" | "warning", ...(file ? { file, line: Number(lineNo) } : {}), message: `${text}${file ? "" : ` (${path!.trim()}:${lineNo})`}`, source: "csharp" };
    } else {
      const m = UNLOCATED.exec(line);
      if (!m) {
        open = undefined;
        continue;
      }
      const [, originText, severity, code, message] = m;
      // The origin is a file (Game.csproj) or a tool (MSBUILD, CSC, NuGet).
      const isFile = originText !== undefined && /[\\/.]/.test(originText) && !/\s/.test(originText.trim());
      const file = isFile ? toRes(originText!.trim(), project) : undefined;
      origin = `${severity}|${originText?.trim() ?? ""}`;
      detail = /^\s/.test(message!);
      if (!message!.trim() && !code) continue;
      d = { severity: severity as "error" | "warning", ...(file ? { file } : {}), message: `${code ? `${code}: ` : ""}${message!.trim()}${!file && isFile ? ` (${originText!.trim()})` : ""}`, source: "csharp" };
    }
    if (detail && open && open.origin === origin) {
      open.d.message += `; ${d.message}`;
      continue;
    }
    const key = `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${d.message}`;
    const codeless = !/^[A-Za-z]+\d+: /.test(d.message);
    open = codeless && !located ? { d, origin } : undefined;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * Builds the C# project of a Godot project with `dotnet build`. Packages are restored only when they were never
 * restored (no obj/project.assets.json): the result says so, since a restore needs the network.
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
  const assets = existsSync(join(root, "obj", "project.assets.json")) || (found.csproj !== undefined && existsSync(join(root, dirname(found.csproj), "obj", "project.assets.json")));
  const args = ["build", target, "--nologo", "-v", "q", "-consoleloggerparameters:NoSummary", ...(options.configuration ? ["-c", options.configuration] : []), ...(assets ? ["--no-restore"] : [])];
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const run = await runGodot(dotnet, args, { cwd: root, timeoutMs });
  const log = `${run.stdout}\n${run.stderr}`;
  const diagnostics = parseMsbuildOutput(log, root);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  const how = assets ? "" : " (NuGet packages were restored first: obj/project.assets.json was missing)";
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
