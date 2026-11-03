import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { findGodot, godotVersion, runGodot, type RunResult } from "../check/godot.js";
import type { Diagnostic } from "../check/log.js";
import { excludePath } from "../check/checker-script.js";
import { findProjectRoot, fromResPath, listProjectFiles, resolveResPath, toResPath, withoutSubResource } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { screen } from "../screenshot/screenshot.js";
import { godot3Hint } from "./hints.js";
import { parseShaderLog, type ShaderLog, type ShaderLogEntry, type ShaderSeen } from "./log.js";
import { shaderRunnerSource } from "./runner.js";

/**
 * The GPU pass over the project's shaders. Headless Godot runs the full shader compiler on its dummy renderer
 * (src/check/shader-compile.ts and the checker of godot_check use it), which finds every language error, but no GPU
 * driver ever sees the code. This draws every shader for a few frames on the Compatibility renderer (OpenGL, which also
 * runs in software under xvfb), which adds what only the driver rejects (a uniform block that is too big, a sampler
 * array indexed by a variable), and reports Godot's errors at the line in the .gdshader, .gdshaderinc, or the
 * .tres/.tscn that embeds the shader. `godotwright shaders`, `check --shaders` and `shader --gpu` use it.
 */

export class ShaderCheckError extends Error {}

export interface ShaderCheckOptions {
  /** Path to the Godot binary; found automatically when omitted. */
  godot?: string;
  /** Only these files (res:// or project-relative): .gdshader, .gdshaderinc (every shader that includes it), .tres, .tscn. */
  files?: string[];
  /** Folders to skip, e.g. ["levels/old"]; res://addons is skipped unless includeAddons. */
  exclude?: string[];
  includeAddons?: boolean;
  /** Run `--import` first (default true); godot_check has done it already. */
  import?: boolean;
  /** Frames each shader is drawn (default 2). */
  frames?: number;
  /** Timeout per Godot run in milliseconds (default 10 minutes). */
  timeoutMs?: number;
  /** Keep Godot's raw output in the result. */
  keepLogs?: boolean;
}

export interface ShaderDiagnostic extends Diagnostic {
  /** What to write instead, for Godot 3 code and other known causes. */
  hint?: string;
  /** For an error in a .gdshaderinc: every shader that included it, with the line of its #include. */
  includedFrom?: string[];
  /** The line of code Godot points to. */
  code?: string;
}

export const SHADER_TYPES = ["spatial", "canvas_item", "particles", "sky", "fog"] as const;

export interface CompiledShader {
  /** The shader: a .gdshader, a Shader/VisualShader .tres, or `res://file.tscn::Shader_id` for an embedded one. */
  path: string;
  type: string;
  visual: boolean;
  /**
   * "gpu": compiled and drawn by the OpenGL driver; "parsed": only Godot's shader compiler ran (fog shaders); "none": the
   * check stopped (timed out or crashed) before it got to this shader.
   */
  compiled: "gpu" | "parsed" | "none";
  /** Compiled, and no error points at it or at an include it uses. */
  ok: boolean;
  /**
   * Time of the frame it was first drawn in, compile included. Only to compare shaders within one run: software OpenGL
   * is slow, and Godot's shader cache (user://shader_cache) makes a second run much faster.
   */
  firstDrawMs?: number;
}

/** One Godot run of the check. */
export interface ShaderRun {
  name: "import" | "render" | "fog";
  ms: number;
  exitCode: number | null;
  timedOut: boolean;
}

export interface ShaderCheckResult {
  godot: string;
  godotVersion: string;
  /** e.g. "opengl3 gl_compatibility, llvmpipe (LLVM 20.1.2, 256 bits)". */
  renderer: string;
  shaders: CompiledShader[];
  /** .gdshaderinc files in the checked part of the project; they are compiled as part of the shaders that include them. */
  includes: string[];
  diagnostics: ShaderDiagnostic[];
  errors: number;
  warnings: number;
  notes: string[];
  /** False when a Godot run timed out or stopped before the end: the shaders it did not get to are `compiled: "none"`. */
  complete: boolean;
  runs: ShaderRun[];
  logs?: Record<string, string>;
}

const RUNNER_DIR = ".godot/godotwright";
const RUNNER_RES = `res://${RUNNER_DIR}/shaders.gd`;
/** A .tres/.tscn that is a shader or holds one; a scene that only refers to a .gdshader is covered by that file. */
const EMBEDS = /^\[(?:sub_resource|gd_resource) type="(?:Shader|VisualShader)"/m;
const NO_SHADER = "no shader to compile in this file";
const INCLUDE = /#include\s+\\?"([^"\\]+)\\?"/g;

function toRes(root: string, file: string): string {
  if (file.startsWith("res://")) return file;
  if (isAbsolute(file)) return toResPath(root, file);
  return `res://${file.replace(/\\/g, "/").replace(/^\.?\/+/, "")}`;
}

function read(root: string, res: string): string | undefined {
  try {
    return readFileSync(fromResPath(root, withoutSubResource(res)), "utf8");
  } catch {
    return undefined;
  }
}

/** The shader files of the project, and the .tres/.tscn files that hold a shader, outside the skipped folders. */
export function findShaderFiles(root: string, exclude: string[]): { sources: string[]; includes: string[] } {
  const skipped = exclude.map(excludePath);
  const sources: string[] = [];
  const includes: string[] = [];
  for (const file of listProjectFiles(root)) {
    if (skipped.some((folder) => file.startsWith(`${folder}/`))) continue;
    if (file.endsWith(".gdshader")) sources.push(file);
    else if (file.endsWith(".gdshaderinc")) includes.push(file);
    else if ((file.endsWith(".tres") || file.endsWith(".tscn")) && EMBEDS.test(read(root, file) ?? "")) sources.push(file);
  }
  return { sources, includes };
}

/** The files a shader source pulls in with #include, also through other includes. */
export function includedFiles(root: string, file: string, text = read(root, file) ?? "", seen = new Set<string>()): Set<string> {
  for (const m of text.matchAll(INCLUDE)) {
    const target = resolveResPath(withoutSubResource(file), m[1]!);
    if (seen.has(target)) continue;
    seen.add(target);
    includedFiles(root, target, read(root, target) ?? "", seen);
  }
  return seen;
}

/** The files to load for the `files` option: shader sources as given, and for an include every source that uses it. */
function selectFiles(root: string, files: string[], all: { sources: string[]; includes: string[] }): string[] {
  const out = new Set<string>();
  for (const given of files) {
    const res = toRes(root, given);
    if (!existsSync(fromResPath(root, res))) throw new ShaderCheckError(`${res} does not exist`);
    if (res.endsWith(".gdshaderinc")) {
      // An include asked for by name: its users outside the skipped folders, else wherever they are.
      let users = all.sources.filter((s) => includedFiles(root, s).has(res));
      if (!users.length) users = findShaderFiles(root, []).sources.filter((s) => includedFiles(root, s).has(res));
      if (!users.length) throw new ShaderCheckError(`no shader includes ${res}, so it cannot be compiled on its own`);
      for (const u of users) out.add(u);
    } else if (/\.(gdshader|tres|tscn|res|scn)$/.test(res)) {
      out.add(res);
    } else {
      throw new ShaderCheckError(`${res} is not a shader file (.gdshader, .gdshaderinc, .tres or .tscn)`);
    }
  }
  return [...out];
}

/**
 * The first line of a shader's code in a .tres/.tscn: the `code = "` line of sub_resource `id`, or of the [resource]
 * section when the file itself is the Shader. Godot counts lines from the start of the code string.
 */
export function codeStartLine(text: string, id?: string): number | undefined {
  const lines = text.split(/\r?\n/);
  let inString = false;
  let here = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!inString && line.startsWith("[")) {
      here = id ? new RegExp(`\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(line) : line.startsWith("[resource]");
      continue;
    }
    if (!inString && here && /^code\s*=\s*"/.test(line)) return i + 1;
    // Track multi-line strings, so a "[" at the start of a line of code is not taken for a section.
    const quotes = (line.replace(/\\\\/g, "").match(/(?<!\\)"/g) ?? []).length;
    if (quotes % 2 === 1) inString = !inString;
  }
  return undefined;
}

function typeName(mode: number | undefined): string {
  return mode !== undefined ? (SHADER_TYPES[mode] ?? `mode ${mode}`) : "unknown";
}

interface Located {
  file: string;
  line?: number;
  code?: string;
}

/** Turns a line Godot gave for a shader into a place in a file the user can open. */
function locate(root: string, path: string, line: number | undefined, visual: boolean, generated?: string): Located & { generated?: string } {
  const [file, id] = path.split("::") as [string, string | undefined];
  const text = read(root, file);
  if (line === undefined || !text) return { file };
  if (visual) {
    // A VisualShader's code is generated from its nodes; the line is in that code, not in the file.
    return { file, ...(generated ? { generated: `generated code line ${line}: ${generated}` } : { generated: `generated code line ${line}` }) };
  }
  if (id || /\.(tres|tscn)$/.test(file)) {
    const start = codeStartLine(text, id);
    if (start === undefined) return { file };
    const at = start + line - 1;
    const code = text.split(/\r?\n/)[at - 1]?.replace(/^code\s*=\s*"/, "").replace(/\\"/g, '"').trim();
    return { file, line: at, ...(code ? { code } : {}) };
  }
  const code = text.split(/\r?\n/)[line - 1]?.trim();
  return { file, line, ...(code ? { code } : {}) };
}

/** The line in `top` whose #include leads to `target`. */
function includeLine(root: string, top: string, target: string): number | undefined {
  const text = read(root, top);
  if (!text || top.includes("::")) return undefined;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*#include\s+"([^"]+)"/.exec(lines[i]!);
    if (!m) continue;
    const inc = resolveResPath(top, m[1]!);
    if (inc === target || includedFiles(root, inc).has(target)) return i + 1;
  }
  return undefined;
}

/** Diagnostics from what Godot printed, placed in the user's files. */
export function shaderDiagnostics(root: string, log: ShaderLog, seen: ShaderSeen[] = log.shaders): ShaderDiagnostic[] {
  const byPath = new Map(seen.map((s) => [s.path, s]));
  return mergeDiagnostics(log.entries.map((e) => entryDiagnostic(root, e, byPath)).filter((d): d is ShaderDiagnostic => d !== undefined));
}

/**
 * Each error once, even when several shaders include the same broken file: Godot reports it for every one of them, and
 * the kept diagnostic lists them all in `includedFrom`.
 */
export function mergeDiagnostics(list: ShaderDiagnostic[]): ShaderDiagnostic[] {
  const byKey = new Map<string, ShaderDiagnostic>();
  for (const d of list) {
    const key = `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${d.message}`;
    const kept = byKey.get(key);
    if (!kept) {
      byKey.set(key, d.includedFrom ? { ...d, includedFrom: [...d.includedFrom] } : { ...d });
      continue;
    }
    for (const from of d.includedFrom ?? []) {
      if (!kept.includedFrom?.includes(from)) kept.includedFrom = [...(kept.includedFrom ?? []), from];
    }
  }
  return [...byKey.values()];
}

function entryDiagnostic(root: string, e: ShaderLogEntry, byPath: Map<string, ShaderSeen>): ShaderDiagnostic | undefined {
  const shader = e.shader ?? e.loading;
  if (e.kind === "type") {
    const type = /^shader type (\S+)/.exec(e.message)?.[1];
    // Fog shaders are refused by the Compatibility renderer; the headless run parses them.
    if (type === "fog" || !shader) return undefined;
    const text = read(root, shader) ?? "";
    const line = text.split(/\r?\n/).findIndex((l) => /\bshader_type\b/.test(l));
    return {
      severity: "error",
      file: withoutSubResource(shader),
      ...(line >= 0 && !shader.includes("::") ? { line: line + 1 } : {}),
      message: `Unknown shader_type '${type}'.`,
      hint: `use ${SHADER_TYPES.join(", ")}`,
      source: "shader",
    };
  }
  if (e.kind === "driver") {
    if (!shader) return undefined;
    const detail = e.more.join(" ").trim();
    const big = /Uniform block \w+ too big/i.test(detail);
    return {
      severity: "error",
      file: withoutSubResource(shader),
      message: `${e.message}${detail ? `: ${detail}` : ""}`,
      ...(big ? { hint: "the uniforms take more memory than the GPU's uniform block allows; use smaller arrays or put the data in a texture" } : {}),
      source: "shader",
    };
  }
  // A language error: `at:` names the file and line, except in a headless run, where the shader is the one being parsed.
  const path = e.file || shader;
  if (!path) return { severity: e.severity, message: e.message, source: "shader" };
  const owner = byPath.get(path) ?? (shader ? byPath.get(shader) : undefined);
  const visual = owner?.kind === "VisualShader" && path === owner.path;
  const generated = e.context.at(-1)?.code;
  const place = locate(root, path, e.line, visual, generated);
  const lineText = place.code;
  const source = read(root, path);
  let hint = godot3Hint(e.message, { ...(lineText ? { line: lineText } : {}), ...(owner ? { mode: owner.mode } : {}), ...(source ? { source } : {}) });
  if (!hint && /^Tokenizer: Unknown character #35/.test(e.message) && lineText?.startsWith("#include")) {
    const target = /#include\s+"([^"]+)"/.exec(lineText)?.[1];
    if (target) {
      const res = resolveResPath(withoutSubResource(path), target);
      hint = existsSync(fromResPath(root, res)) ? `Godot could not read the included file ${res}` : `the included file ${res} does not exist`;
    }
  }
  if (!hint && /^Expected a ';'/.test(e.message) && place.line && source && !visual) {
    // Godot points at the token after the missing ';', often the next line.
    const lines = source.split(/\r?\n/);
    let before = place.line - 2;
    while (before >= 0 && lines[before]!.trim() === "") before--;
    const prev = lines[before]?.trim() ?? "";
    if (before >= 0 && before < place.line - 1 && prev && !/[;{}]$/.test(prev) && !prev.startsWith("//") && !prev.startsWith("#")) {
      hint = `the ';' is probably missing at the end of line ${before + 1}`;
    }
  }
  if (!hint && e.more.length) hint = e.more.join(" ");
  const top = shader && shader !== path ? shader : e.context.length > 1 ? e.context[0]?.file : undefined;
  let includedFrom: string[] | undefined;
  if (top && top !== path && path.endsWith(".gdshaderinc")) {
    const at = includeLine(root, top, path);
    includedFrom = [`${withoutSubResource(top)}${at ? `:${at}` : ""}`];
  }
  return {
    severity: e.severity,
    file: place.file,
    ...(place.line !== undefined ? { line: place.line } : {}),
    message: place.generated ? `${e.message} (${place.generated})` : e.message,
    ...(hint ? { hint } : {}),
    ...(includedFrom ? { includedFrom } : {}),
    ...(lineText ? { code: lineText } : {}),
    source: "shader",
  };
}

async function runWithScreen(bin: string, root: string, args: string[], timeoutMs: number): Promise<RunResult> {
  const how = screen();
  if ("error" in how) throw new ShaderCheckError(how.error);
  const godotArgs = ["--path", root, "--rendering-driver", "opengl3", "--rendering-method", "gl_compatibility", "--resolution", "320x240", "--audio-driver", "Dummy", ...args];
  return how.command ? runGodot(how.command, [...how.prefix, bin, ...godotArgs], { cwd: root, timeoutMs }) : runGodot(bin, godotArgs, { cwd: root, timeoutMs });
}

function tail(text: string): string {
  return text.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400) || "(none)";
}

/** The shaders the render run found (fog aside): compiled once drawn, so after a timeout the rest were not reached. */
export function drawnShaders(log: ShaderLog): CompiledShader[] {
  return log.shaders
    .filter((s) => s.mode !== 4)
    .map((s) => {
      // The runner prints the time after a shader's first frame, the one its program is compiled in.
      const ms = log.firstDrawMs.get(s.path);
      const drawn = log.done !== undefined || ms !== undefined;
      return { path: s.path, type: typeName(s.mode), visual: s.kind === "VisualShader", compiled: drawn ? "gpu" : "none", ok: drawn, ...(ms !== undefined ? { firstDrawMs: ms } : {}) };
    });
}

/** The fog shaders the render run found, parsed only when the headless run got to its end. */
export function parsedFogShaders(found: ShaderSeen[], fogLog: ShaderLog): CompiledShader[] {
  const parsed = new Set(fogLog.done ? fogLog.shaders.map((s) => s.path) : []);
  return found.map((s) => ({ path: s.path, type: "fog", visual: s.kind === "VisualShader", compiled: parsed.has(s.path) ? "parsed" : "none", ok: parsed.has(s.path) }));
}

function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}

export async function checkShaders(path: string, options: ShaderCheckOptions = {}): Promise<ShaderCheckResult> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const exclude = [...new Set([...(options.exclude ?? []), ...(options.includeAddons ? [] : ["addons"])])];
  const all = findShaderFiles(root, exclude);
  // Files asked for by name are checked even inside a skipped folder; the shaders they only refer to are not.
  const explicit = options.files?.length ? selectFiles(root, options.files, all) : undefined;
  const files = explicit ?? all.sources;
  const usedIncludes = new Set<string>();
  for (const f of files) for (const inc of includedFiles(root, f)) usedIncludes.add(inc);
  const includes = explicit ? [...usedIncludes].sort() : all.includes;
  // Fail early when there is no screen, before Godot is looked for or anything is imported.
  const how = screen();
  if ("error" in how) throw new ShaderCheckError(`cannot draw the shaders on the GPU (headless Godot still compiles them: godot_shader, godot_check): ${how.error.replace(/^no screen/, "there is no screen")}`);
  const bin = findGodot(options.godot);
  const version = await godotVersion(bin);
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const frames = options.frames ?? 2;
  const result: ShaderCheckResult = { godot: bin, godotVersion: version, renderer: "", shaders: [], includes, diagnostics: [], errors: 0, warnings: 0, notes: [], complete: true, runs: [] };
  const logs: Record<string, string> = {};
  if (!files.length) {
    result.notes.push("no shaders found (.gdshader files, or Shader/VisualShader resources in .tres/.tscn)");
    return result;
  }
  const ran = (name: ShaderRun["name"], run: RunResult) => {
    result.runs.push({ name, ms: run.ms, exitCode: run.code, timedOut: run.timedOut });
    if (options.keepLogs) logs[name] = `${run.stdout}\n--- stderr ---\n${run.stderr}`;
  };
  /** The error for a run that stopped before the runner's last line. */
  const stopped = (what: string, run: RunResult, output: string): ShaderDiagnostic => {
    result.complete = false;
    return {
      severity: "error",
      message: run.timedOut ? `${what} timed out after ${seconds(timeoutMs)}` : `${what} did not finish (exit code ${run.code}); last output: ${tail(output)}`,
      source: "shader",
    };
  };
  if (options.import !== false) ran("import", await runGodot(bin, ["--headless", "--path", root, "--import"], { cwd: root, timeoutMs }));

  const dir = join(root, ...RUNNER_DIR.split("/"));
  const script = join(dir, "shaders.gd");
  mkdirSync(dir, { recursive: true });
  const runnerExclude = exclude.map(excludePath);
  const allow = explicit ?? [];
  const diagnostics: ShaderDiagnostic[] = [];
  try {
    writeFileSync(script, shaderRunnerSource({ files, exclude: runnerExclude, allow, render: true, fog: false, frames }));
    const run = await runWithScreen(bin, root, ["-s", RUNNER_RES], timeoutMs);
    ran("render", run);
    // xvfb-run sends Godot's stderr to stdout; with a real display it stays on stderr.
    const output = `${run.stderr}\n${run.stdout}`;
    const log = parseShaderLog(output);
    if (!log.done) diagnostics.push(stopped("the shader check", run, output));
    diagnostics.push(...shaderDiagnostics(root, log, log.shaders));
    if (log.done) result.renderer = `${log.done.driver} ${log.done.method}${log.done.adapter ? `, ${log.done.adapter}` : ""}`;
    result.shaders.push(...drawnShaders(log));
    for (const f of log.unloadable) diagnostics.push({ severity: "warning", file: f, message: "Godot could not load this file, so its shaders were not compiled (godot_check says why)", source: "shader" });
    if (explicit && log.parsed !== undefined) {
      for (const f of explicit) {
        if (log.unloadable.includes(f) || log.shaders.some((s) => s.file === f)) continue;
        diagnostics.push({ severity: "warning", file: f, message: `${NO_SHADER} (shaders it uses from a skipped folder are left out)`, source: "shader" });
      }
    }

    // Fog shaders need Forward+; the dummy renderer of a headless run still parses them.
    const fogShaders = log.shaders.filter((s) => s.mode === 4);
    const fogFiles = [...new Set(fogShaders.map((s) => s.file))];
    if (fogFiles.length) {
      writeFileSync(script, shaderRunnerSource({ files: fogFiles, exclude: runnerExclude, allow, render: false, fog: true, frames }));
      const fogRun = await runGodot(bin, ["--headless", "--path", root, "-s", RUNNER_RES], { cwd: root, timeoutMs });
      ran("fog", fogRun);
      const fogLog = parseShaderLog(fogRun.stderr);
      if (!fogLog.done) diagnostics.push(stopped("parsing the fog shaders", fogRun, `${fogRun.stderr}\n${fogRun.stdout}`));
      const fog = fogLog.shaders.filter((s) => s.mode === 4);
      // Only the fog shaders' errors: the others were compiled in the first run.
      const fogPaths = new Set(fog.map((s) => s.path));
      fogLog.entries = fogLog.entries.filter((e) => e.shader !== undefined && fogPaths.has(e.shader));
      diagnostics.push(...shaderDiagnostics(root, fogLog, fog));
      const fogResult = parsedFogShaders(fogShaders, fogLog);
      result.shaders.push(...fogResult);
      const parsed = fogResult.filter((s) => s.compiled === "parsed").length;
      if (parsed) result.notes.push(`${parsed} fog shader${parsed === 1 ? "" : "s"} only parsed: fog shaders need Forward+ (Vulkan or Direct3D 12), which this check does not use`);
    }
  } finally {
    // After a timeout runGodot returns only once the processes it stopped are gone, so nothing runs the script now.
    rmSync(script, { force: true });
  }

  result.diagnostics = mergeDiagnostics(diagnostics);
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  const failed = new Set(errors.flatMap((d) => [d.file, ...(d.includedFrom ?? []).map((f) => f.replace(/:\d+$/, ""))]));
  for (const s of result.shaders) s.ok = s.compiled !== "none" && !failed.has(s.path) && !failed.has(withoutSubResource(s.path));
  result.errors = errors.length;
  result.warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
  if (options.keepLogs) result.logs = logs;
  return result;
}

/** The line godot_check adds with `shaders`. */
export function shaderSummary(s: { compiled: number; parsed: number; notReached?: number; errors: number; renderer: string }): string {
  return `shaders: ${s.compiled} compiled${s.parsed ? `, ${s.parsed} parsed only (fog needs Forward+)` : ""}${s.notReached ? `, ${s.notReached} not reached (the check stopped early)` : ""}, ${s.errors} error${s.errors === 1 ? "" : "s"} (${s.renderer || "renderer unknown"})`;
}

/** A shader diagnostic as a check diagnostic: the hint and the including shader go into the message. */
export function asCheckDiagnostic(d: ShaderDiagnostic): Diagnostic {
  const extra = [d.hint, d.includedFrom?.length ? `included from ${d.includedFrom.join(", ")}` : undefined].filter(Boolean).join("; ");
  return { severity: d.severity, ...(d.file ? { file: d.file } : {}), ...(d.line ? { line: d.line } : {}), message: extra ? `${d.message} (${extra})` : d.message, source: "shader" };
}

/** One line per error, the code it points to, a summary line and what to do next. */
export function formatShaderCheck(r: ShaderCheckResult): string {
  const out: string[] = [];
  for (const d of r.diagnostics) {
    const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ` : "";
    out.push(`${where}${d.severity}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`);
    if (d.code) out.push(`    | ${d.code}`);
    if (d.includedFrom?.length) out.push(`    included from ${d.includedFrom.join(", ")}`);
  }
  const gpu = r.shaders.filter((s) => s.compiled === "gpu").length;
  const parsed = r.shaders.filter((s) => s.compiled === "parsed").length;
  const none = r.shaders.length - gpu - parsed;
  const visual = r.shaders.filter((s) => s.visual).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const counts = [
    `${plural(gpu, "shader")} compiled${visual ? ` (${visual} visual)` : ""}${parsed ? `, ${parsed} parsed only` : ""}${none ? `, ${none} not reached` : ""}`,
    plural(r.errors, "error"),
    ...(r.warnings ? [plural(r.warnings, "warning")] : []),
    ...(r.includes.length ? [plural(r.includes.length, "include")] : []),
  ];
  out.push(`${counts.join(", ")}; renderer ${r.renderer || "unknown"}; Godot ${r.godotVersion}`);
  out.push(...r.notes);
  if (!r.complete) {
    const others = r.diagnostics.some((d) => d.severity === "error" && d.file);
    out.push(`Next: the check stopped before it compiled every shader; ${others ? "fix the errors at the lines given, then " : ""}run it again with a longer --timeout, or on fewer shaders with --file.`);
  } else if (r.errors) out.push("Next: fix each error at the line given (godot_api has the Godot 4 built-ins), then run this again; a shader with an error draws nothing in the game.");
  else if (r.shaders.length) out.push("Next: the shaders compile in the Compatibility renderer; render the scenes that use them with godot_screenshot to see them.");
  else if (r.diagnostics.some((d) => d.message.startsWith(NO_SHADER))) out.push("Next: nothing to compile; pass a .gdshader, a .gdshaderinc, or a .tres/.tscn that holds a Shader.");
  else out.push("Next: nothing to compile; shaders in res://addons are compiled only with --include-addons, and --exclude skips the folders it names.");
  return `${out.join("\n")}\n`;
}
