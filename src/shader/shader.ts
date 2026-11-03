import { compileShaders, type ShaderCompileResult, type ShaderToCompile } from "../check/shader-compile.js";
import { GodotNotFoundError } from "../check/godot.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { asCheckDiagnostic, checkShaders, ShaderCheckError, type ShaderCheckResult } from "../shaders/shaders.js";
import type { Diagnostic } from "../check/log.js";
import { parseShader, resolveInclude } from "../godot/shader.js";
import { bundledLearning } from "../learn/bundled.js";
import { currentLearning } from "../learn/learn.js";
import { emptyLearning } from "../learn/store.js";
import { formatFinding } from "../review/format.js";
import { reviewProject } from "../review/review.js";
import { RULES, type Finding, type Severity } from "../review/rules.js";
import type { Detail } from "../scan/format.js";
import { loadProject, type ShaderSource } from "../scan/scan.js";

/**
 * godot_shader: every shader of a project (.gdshader, .gdshaderinc and Shader resources stored in scenes) reviewed
 * statically against Godot 4.7's shader tables, then compiled by real Godot headless, with file:line for both.
 * Headless Godot runs the full shader compiler (get_rid() compiles a shader on the dummy renderer), which finds every
 * language error. With `gpu` the shaders are also drawn on the Compatibility renderer (src/shaders/), which adds what
 * only a GPU driver rejects: a uniform block that is too big, a sampler array indexed by a variable.
 */

export interface ShaderOptions {
  /** Only these res:// files: shaders, includes (the shaders that include them are compiled), or scenes holding shaders. */
  files?: string[];
  /** Unsaved file contents by res:// path. */
  overrides?: Record<string, string>;
  /** Compile with Godot: true requires it, false skips it, undefined compiles when Godot is found. */
  compile?: boolean;
  godot?: string;
  timeoutMs?: number;
  /** Also shaders under res://addons/ (third-party code). */
  includeAddons?: boolean;
  /**
   * Also draw the shaders on the Compatibility renderer (needs a display, or xvfb-run on Linux): finds what only the
   * GPU driver rejects. Draws the files on disk, not unsaved code.
   */
  gpu?: boolean;
  base?: string[];
  baseFiles?: string[];
}

export interface ShaderEntry {
  path: string;
  type?: string;
  include?: boolean;
  /** Stored in a scene or resource. */
  embedded?: boolean;
}

export interface ShaderReport {
  project: string;
  shaders: ShaderEntry[];
  /** Review findings of the shader rules. */
  findings: Finding[];
  /** Godot's compile result, when it ran. */
  compile?: ShaderCompileResult;
  /** Requested files that are no shader, include or scene with a shader in this project (each counts as an error). */
  unknownFiles?: string[];
  /** Why Godot did not compile them, when it did not. */
  compileSkipped?: string;
  /** With `gpu`: the result of drawing them on the Compatibility renderer. */
  gpu?: ShaderCheckResult;
  /** With `gpu`: why they were not drawn, when they were not. */
  gpuSkipped?: string;
  errors: number;
  warnings: number;
}

/** Rules about shaders: their findings are what godot_shader reports. */
export const SHADER_RULES = Object.keys(RULES).filter((id) => /\/shader-/.test(id));

export async function shaderReport(path: string, options: ShaderOptions = {}): Promise<ShaderReport> {
  const data = loadProject(path, { overrides: options.overrides, base: options.base, baseFiles: options.baseFiles });
  const wanted = (p: string) => !options.files || options.files.some((f) => p === f || p.startsWith(`${f}::`));
  const inScope = (p: string) => options.includeAddons || !p.startsWith("res://addons/");
  const all = [...data.shaders].filter(([p, s]) => !s.external && inScope(p)).sort(([a], [b]) => a.localeCompare(b));
  const selected = all.filter(([p]) => wanted(p));
  const shaders: ShaderEntry[] = selected.map(([p, s]) => ({
    path: p,
    ...(s.include ? { include: true } : { type: parseShader(s.source).type }),
    ...(s.embedded ? { embedded: true } : {}),
  }));

  const review = reviewProject(data.root, {
    overrides: options.overrides,
    base: options.base,
    baseFiles: options.baseFiles,
    includeAddons: options.includeAddons,
    learning: currentLearning() ?? emptyLearning(),
    shared: bundledLearning(),
    focus: [...new Set(selected.map(([p]) => p.replace(/::.*$/, "")))],
  });
  const findings = review.findings.filter((f) => SHADER_RULES.includes(f.rule) && wanted(f.file));

  const report: ShaderReport = { project: data.map.project.name ?? "(unnamed)", shaders, findings, errors: 0, warnings: 0 };
  const unknown = (options.files ?? []).filter((f) => !selected.some(([p]) => p === f || p.startsWith(`${f}::`)));
  if (unknown.length) report.unknownFiles = unknown;
  const targets = compileTargets(all, new Set(selected.map(([p]) => p)), options.overrides ?? {});
  if (options.compile !== false && targets.length > 0) {
    try {
      report.compile = await compileShaders(data.root, targets, { godot: options.godot, timeoutMs: options.timeoutMs });
    } catch (error) {
      // Without Godot (or with a wrong path to it) the static review still stands, unless the compile was required.
      if (options.compile === true) throw error;
      const why = error instanceof GodotNotFoundError ? "Godot not found (set GODOT or pass godot)" : error instanceof Error ? error.message : String(error);
      report.compileSkipped = `${why}; only the static review ran`;
    }
  } else if (options.compile !== false) {
    report.compileSkipped = "nothing to compile";
  }
  if (options.gpu && targets.length > 0) {
    // Scenes and resources that hold a shader are drawn as a whole file.
    const files = options.files ? [...new Set([...targets.map((t) => t.path), ...selected.map(([p]) => p)].map((p) => p.replace(/::.*$/, "")))] : undefined;
    try {
      report.gpu = await checkShaders(data.root, { godot: options.godot, ...(files ? { files } : {}), includeAddons: Boolean(options.includeAddons), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
      if (options.overrides && Object.keys(options.overrides).length) report.gpu.notes.push("the GPU pass drew the files on disk, not the unsaved code");
    } catch (error) {
      if (!(error instanceof ShaderCheckError || error instanceof GodotNotFoundError || error instanceof ProjectNotFoundError)) throw error;
      report.gpuSkipped = error instanceof GodotNotFoundError ? "Godot not found (set GODOT or pass godot)" : error.message;
    }
  }
  const lines = shown(report);
  report.errors = lines.filter((l) => l.severity === "error").length;
  report.warnings = lines.filter((l) => l.severity === "warning").length;
  return report;
}

/**
 * What to compile: the selected shaders (not includes, which Godot only compiles inside a shader), and every shader that
 * includes a selected include, directly or through another include.
 */
function compileTargets(all: [string, ShaderSource][], selected: Set<string>, overrides: Record<string, string>): ShaderToCompile[] {
  const includesOf = new Map<string, string[]>();
  for (const [p, s] of all) {
    includesOf.set(p, parseShader(s.source).includes.map((i) => resolveInclude(p, i.path) ?? ""));
  }
  const pulls = (p: string, seen = new Set<string>()): boolean => {
    if (selected.has(p)) return true;
    if (seen.has(p)) return false;
    seen.add(p);
    return (includesOf.get(p) ?? []).some((i) => pulls(i, seen));
  };
  const out: ShaderToCompile[] = [];
  for (const [p, s] of all) {
    if (s.include || !(selected.has(p) || pulls(p))) continue;
    if (s.embedded) out.push({ path: p, code: s.source, embedded: s.embedded });
    else if (overrides[p] !== undefined) out.push({ path: p, code: s.source });
    else out.push({ path: p });
  }
  return out;
}

interface Line {
  file?: string;
  line?: number;
  severity: Severity;
  text: string;
  fix?: string;
}

/** Review findings and Godot's errors as one list; a Godot error on a line the review already reports is left out. */
function shown(report: ShaderReport): Line[] {
  const out: Line[] = report.findings.map((f) => ({ file: f.file, line: f.line, severity: f.severity, text: formatFinding(f), fix: RULES[f.rule]?.fix }));
  const reviewed = new Set(report.findings.filter((f) => f.severity === "error").map((f) => `${f.file}:${f.line}`));
  const missingInclude = new Set(report.findings.filter((f) => f.rule === "structure/shader-missing-include").map((f) => f.file));
  const badType = new Set(report.findings.filter((f) => f.rule === "api/shader-type").map((f) => f.file));
  for (const d of report.compile?.diagnostics ?? []) {
    if (d.line && reviewed.has(`${d.file}:${d.line}`)) continue;
    // Godot's "Unknown character #35: '#'" is what a missing include looks like; the review names the include.
    if (d.file && missingInclude.has(d.file) && d.message.startsWith("Tokenizer: Unknown character #35")) continue;
    if (d.file && badType.has(d.file) && /^(No|Unknown) shader_type/.test(d.message)) continue;
    out.push({ file: d.file, line: d.line, severity: d.severity, text: formatGodot(d) });
  }
  // The GPU pass finds the language errors again (same file and line): only what it adds is shown.
  const at = (file: string | undefined, line: number | undefined) => `${(file ?? "").replace(/::.*$/, "")}:${line ?? ""}`;
  const known = new Set(out.filter((l) => l.line).map((l) => at(l.file, l.line)));
  for (const g of report.gpu?.diagnostics ?? []) {
    if (g.line && known.has(at(g.file, g.line))) continue;
    const d = asCheckDiagnostic(g);
    out.push({ file: d.file, line: d.line, severity: d.severity, text: formatGodot(d, "gpu") });
  }
  for (const f of report.unknownFiles ?? []) {
    out.push({ file: f, severity: "error", text: `${f}: error no shader, shader include or scene holding a shader at this path in the project` });
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0));
}

function formatGodot(d: Diagnostic, tag = "godot"): string {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ` : "";
  return `${where}${d.severity} [${tag}] ${d.message}${d.count && d.count > 1 ? ` (x${d.count})` : ""}`;
}

export function formatShaderReport(report: ShaderReport, detail: Detail = "brief"): string {
  const out: string[] = [];
  const kinds = new Map<string, number>();
  for (const s of report.shaders) {
    const kind = s.include ? "include" : (s.type ?? "no shader_type");
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const embedded = report.shaders.filter((s) => s.embedded).length;
  const summary = [...kinds].map(([k, n]) => `${k} ${n}`).join(", ");
  out.push(`shaders: ${report.shaders.length}${summary ? ` (${summary}${embedded ? `; ${embedded} stored in scenes or resources` : ""})` : ""}`);
  if (report.compile) {
    out.push(`compiled ${report.compile.compiled} with Godot ${report.compile.godotVersion.replace(/\.official.*$/, "")} headless in ${(report.compile.ms / 1000).toFixed(1)} s`);
  } else if (report.compileSkipped) {
    out.push(`not compiled: ${report.compileSkipped}`);
  }
  if (report.gpu) {
    const drawn = report.gpu.shaders.filter((s) => s.compiled === "gpu").length;
    const ms = report.gpu.runs.reduce((n, r) => n + r.ms, 0);
    out.push(`drew ${drawn} on the GPU (${report.gpu.renderer || "renderer unknown"}) in ${(ms / 1000).toFixed(1)} s`);
    out.push(...report.gpu.notes);
  } else if (report.gpuSkipped) {
    out.push(`not drawn on the GPU: ${report.gpuSkipped}`);
  }
  const lines = shown(report);
  const visible = detail === "full" ? lines : lines.filter((l) => l.severity !== "info");
  for (const l of visible) {
    out.push(l.text);
    if (detail === "full" && l.fix) out.push(`  fix: ${l.fix}`);
  }
  const infos = lines.length - visible.length;
  out.push(
    `${report.errors} error${report.errors === 1 ? "" : "s"}, ${report.warnings} warning${report.warnings === 1 ? "" : "s"}` +
      `${infos ? `, ${infos} performance hint${infos === 1 ? "" : "s"} (detail full shows them)` : ""}`,
  );
  return `${out.join("\n")}\n`;
}
