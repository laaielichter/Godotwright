import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { findGodot, godotVersion, runGodot, type RunResult } from "../check/godot.js";
import type { Diagnostic } from "../check/log.js";
import { excludePath } from "../check/checker-script.js";
import { findProjectRoot, fromResPath, listProjectFiles, resolveResPath, toResPath } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { screen } from "../screenshot/screenshot.js";
import { godot3Hint } from "./hints.js";
import { parseShaderLog, type ShaderLog, type ShaderLogEntry, type ShaderSeen } from "./log.js";
import { shaderRunnerSource } from "./runner.js";

/**
 * Compiles the project's shaders with real Godot. `godot_check` runs headless, where the dummy renderer never compiles a
 * shader for the GPU, so shader errors slip through it; this draws every shader for a few frames on the Compatibility
 * renderer (OpenGL, which also runs in software under xvfb) and reports Godot's errors at the line in the .gdshader,
 * .gdshaderinc, or the .tres/.tscn that embeds the shader.
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
  /** For an error in a .gdshaderinc: the shader that included it, with the line of its #include. */
  includedFrom?: string;
  /** The line of code Godot points to. */
  code?: string;
}

export const SHADER_TYPES = ["spatial", "canvas_item", "particles", "sky", "fog"] as const;

export interface CompiledShader {
  /** The shader: a .gdshader, a Shader/VisualShader .tres, or `res://file.tscn::Shader_id` for an embedded one. */
  path: string;
  type: string;
  visual: boolean;
  /** "gpu": compiled and drawn by the OpenGL driver; "parsed": only Godot's shader compiler ran (fog shaders). */
  compiled: "gpu" | "parsed";
  ok: boolean;
  /**
   * Time of the frame it was first drawn in, compile included. Only to compare shaders within one run: software OpenGL
   * is slow, and Godot's shader cache (user://shader_cache) makes a second run much faster.
   */
  firstDrawMs?: number;
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
  logs?: Record<string, string>;
}

const RUNNER_DIR = ".godot/godotwright";
const RUNNER_RES = `res://${RUNNER_DIR}/shaders.gd`;
/** A .tres/.tscn that is a shader or holds one; a scene that only refers to a .gdshader is covered by that file. */
const EMBEDS = /^\[(?:sub_resource|gd_resource) type="(?:Shader|VisualShader)"/m;
const INCLUDE = /#include\s+\\?"([^"\\]+)\\?"/g;

function toRes(root: string, file: string): string {
  if (file.startsWith("res://")) return file;
  if (isAbsolute(file)) return toResPath(root, file);
  return `res://${file.replace(/\\/g, "/").replace(/^\.?\/+/, "")}`;
}

function read(root: string, res: string): string | undefined {
  try {
    return readFileSync(fromResPath(root, res.replace(/::.*$/, "")), "utf8");
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
    const target = resolveResPath(file.replace(/::.*$/, ""), m[1]!);
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
      const users = all.sources.filter((s) => includedFiles(root, s).has(res));
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
  const out: ShaderDiagnostic[] = [];
  const keys = new Set<string>();
  const add = (d: ShaderDiagnostic) => {
    const key = `${d.file ?? ""}|${d.line ?? ""}|${d.message}`;
    if (keys.has(key)) return;
    keys.add(key);
    out.push(d);
  };
  for (const e of log.entries) {
    const d = entryDiagnostic(root, e, byPath);
    if (d) add(d);
  }
  return out;
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
      file: shader.replace(/::.*$/, ""),
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
      file: shader.replace(/::.*$/, ""),
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
      const res = resolveResPath(path.replace(/::.*$/, ""), target);
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
  let includedFrom: string | undefined;
  if (top && top !== path && path.endsWith(".gdshaderinc")) {
    const at = includeLine(root, top, path);
    includedFrom = `${top.replace(/::.*$/, "")}${at ? `:${at}` : ""}`;
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

export async function checkShaders(path: string, options: ShaderCheckOptions = {}): Promise<ShaderCheckResult> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const exclude = [...new Set([...(options.exclude ?? []), ...(options.includeAddons ? [] : ["addons"])])];
  const all = findShaderFiles(root, exclude);
  const files = options.files?.length ? selectFiles(root, options.files, all) : all.sources;
  const usedIncludes = new Set<string>();
  for (const f of files) for (const inc of includedFiles(root, f)) usedIncludes.add(inc);
  const includes = options.files?.length ? [...usedIncludes].sort() : all.includes;
  // Fail early when there is no screen, before Godot is looked for or anything is imported.
  const how = screen();
  if ("error" in how) throw new ShaderCheckError(`cannot compile shaders, they are compiled by drawing them: ${how.error.replace(/^no screen/, "there is no screen")}`);
  const bin = findGodot(options.godot);
  const version = await godotVersion(bin);
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const frames = options.frames ?? 2;
  const result: ShaderCheckResult = { godot: bin, godotVersion: version, renderer: "", shaders: [], includes, diagnostics: [], errors: 0, warnings: 0, notes: [] };
  const logs: Record<string, string> = {};
  if (!files.length) {
    result.notes.push("no shaders found (.gdshader files, or Shader/VisualShader resources in .tres/.tscn)");
    return result;
  }
  if (options.import !== false) {
    const imported = await runGodot(bin, ["--headless", "--path", root, "--import"], { cwd: root, timeoutMs });
    if (options.keepLogs) logs["import"] = `${imported.stdout}\n--- stderr ---\n${imported.stderr}`;
  }

  const dir = join(root, ...RUNNER_DIR.split("/"));
  const script = join(dir, "shaders.gd");
  mkdirSync(dir, { recursive: true });
  const runnerExclude = exclude.map(excludePath);
  const diagnostics: ShaderDiagnostic[] = [];
  try {
    writeFileSync(script, shaderRunnerSource({ files, exclude: runnerExclude, render: true, fog: false, frames }));
    const run = await runWithScreen(bin, root, ["-s", RUNNER_RES], timeoutMs);
    if (options.keepLogs) logs["render"] = `${run.stdout}\n--- stderr ---\n${run.stderr}`;
    // xvfb-run sends Godot's stderr to stdout; with a real display it stays on stderr.
    const output = `${run.stderr}\n${run.stdout}`;
    const log = parseShaderLog(output);
    if (!log.done) {
      diagnostics.push({
        severity: "error",
        message: run.timedOut
          ? `the shader check timed out after ${Math.round(timeoutMs / 1000)}s`
          : `the shader check did not finish (exit code ${run.code}); last output: ${tail(output)}`,
        source: "shader",
      });
    }
    const drawn = log.shaders.filter((s) => s.mode !== 4);
    diagnostics.push(...shaderDiagnostics(root, log, log.shaders));
    if (log.done) result.renderer = `${log.done.driver} ${log.done.method}${log.done.adapter ? `, ${log.done.adapter}` : ""}`;
    for (const s of drawn) {
      const ms = log.firstDrawMs.get(s.path);
      result.shaders.push({ path: s.path, type: typeName(s.mode), visual: s.kind === "VisualShader", compiled: "gpu", ok: true, ...(ms !== undefined ? { firstDrawMs: ms } : {}) });
    }
    for (const f of log.unloadable) diagnostics.push({ severity: "warning", file: f, message: "Godot could not load this file, so its shaders were not compiled (godot_check says why)", source: "shader" });

    // Fog shaders need Forward+; the dummy renderer of a headless run still parses them.
    const fogFiles = [...new Set(log.shaders.filter((s) => s.mode === 4).map((s) => s.file))];
    if (fogFiles.length) {
      writeFileSync(script, shaderRunnerSource({ files: fogFiles, exclude: runnerExclude, render: false, fog: true, frames }));
      const fogRun = await runGodot(bin, ["--headless", "--path", root, "-s", RUNNER_RES], { cwd: root, timeoutMs });
      if (options.keepLogs) logs["fog"] = `${fogRun.stdout}\n--- stderr ---\n${fogRun.stderr}`;
      const fogLog = parseShaderLog(fogRun.stderr);
      const fog = fogLog.shaders.filter((s) => s.mode === 4);
      // Only the fog shaders' errors: the others were compiled in the first run.
      const fogPaths = new Set(fog.map((s) => s.path));
      fogLog.entries = fogLog.entries.filter((e) => e.shader !== undefined && fogPaths.has(e.shader));
      diagnostics.push(...shaderDiagnostics(root, fogLog, fog));
      for (const s of fog) result.shaders.push({ path: s.path, type: "fog", visual: s.kind === "VisualShader", compiled: "parsed", ok: true });
      result.notes.push(`${fog.length} fog shader${fog.length === 1 ? "" : "s"} only parsed: fog shaders need Forward+ (Vulkan or Direct3D 12), which this check does not use`);
    }
  } finally {
    rmSync(script, { force: true });
  }

  // Each error once, even when several shaders include the same broken file.
  const seen = new Set<string>();
  result.diagnostics = diagnostics.filter((d) => {
    const key = `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const failed = new Set(result.diagnostics.filter((d) => d.severity === "error").flatMap((d) => [d.file, d.includedFrom?.replace(/:\d+$/, "")]));
  for (const s of result.shaders) s.ok = !failed.has(s.path) && !failed.has(s.path.replace(/::.*$/, ""));
  result.errors = result.diagnostics.filter((d) => d.severity === "error").length;
  result.warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
  if (options.keepLogs) result.logs = logs;
  return result;
}

/** The line godot_check adds with `shaders`. */
export function shaderSummary(s: { compiled: number; parsed: number; errors: number; renderer: string }): string {
  return `shaders: ${s.compiled} compiled${s.parsed ? `, ${s.parsed} parsed only (fog needs Forward+)` : ""}, ${s.errors} error${s.errors === 1 ? "" : "s"} (${s.renderer || "renderer unknown"})`;
}

/** A shader diagnostic as a check diagnostic: the hint and the including shader go into the message. */
export function asCheckDiagnostic(d: ShaderDiagnostic): Diagnostic {
  const extra = [d.hint, d.includedFrom ? `included from ${d.includedFrom}` : undefined].filter(Boolean).join("; ");
  return { severity: d.severity, ...(d.file ? { file: d.file } : {}), ...(d.line ? { line: d.line } : {}), message: extra ? `${d.message} (${extra})` : d.message, source: "shader" };
}

/** One line per error, the code it points to, a summary line and what to do next. */
export function formatShaderCheck(r: ShaderCheckResult): string {
  const out: string[] = [];
  for (const d of r.diagnostics) {
    const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ` : "";
    out.push(`${where}${d.severity}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`);
    if (d.code) out.push(`    | ${d.code}`);
    if (d.includedFrom) out.push(`    included from ${d.includedFrom}`);
  }
  const gpu = r.shaders.filter((s) => s.compiled === "gpu").length;
  const parsed = r.shaders.length - gpu;
  const visual = r.shaders.filter((s) => s.visual).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const counts = [
    `${plural(gpu, "shader")} compiled${visual ? ` (${visual} visual)` : ""}${parsed ? `, ${parsed} parsed only` : ""}`,
    plural(r.errors, "error"),
    ...(r.warnings ? [plural(r.warnings, "warning")] : []),
    ...(r.includes.length ? [plural(r.includes.length, "include")] : []),
  ];
  out.push(`${counts.join(", ")}; renderer ${r.renderer || "unknown"}; Godot ${r.godotVersion}`);
  out.push(...r.notes);
  if (r.errors) out.push("Next: fix each error at the line given (godot_api has the Godot 4 built-ins), then run this again; a shader with an error draws nothing in the game.");
  else if (r.shaders.length) out.push("Next: the shaders compile in the Compatibility renderer; render the scenes that use them with godot_screenshot to see them.");
  else out.push("Next: nothing to compile; pass files to check shaders in a skipped folder.");
  return `${out.join("\n")}\n`;
}
