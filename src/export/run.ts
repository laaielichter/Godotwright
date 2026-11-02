import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { cleanup, EXIT_LEAK, physicsRate, runOutput, unexplainedExit, type CheckStep } from "../check/check.js";
import { findGodot, godotVersion, runGodot, type RunResult } from "../check/godot.js";
import { formatDiagnostic, parseGodotLog, type Diagnostic } from "../check/log.js";
import { parseResourceFile } from "../godot/resource-file.js";
import { asString } from "../godot/variant.js";
import { JournalWriter } from "../journal/journal.js";
import { findProjectRoot } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { GODOT_TARGET } from "../version.js";
import { checkContents, kb, type ContentsReport } from "./contents.js";
import { BOM_MESSAGE, hasBom, parsePresets, templateBases, type ExportPreset } from "./export.js";
import { assertWritable } from "../project/protect.js";
import { PckError, readPck, type Pck } from "./pck.js";

/**
 * A real headless export of a preset, checked instead of trusted: Godot's exit code and messages, that the file is
 * there, what the pack holds against what the game loads, and a smoke run of the exported game for some frames with
 * the same error and call-chain parsing as godot_check.
 */

export type ExportMode = "pack" | "release" | "debug";

/** What runs Godot; tests replace it. */
export interface ExportDeps {
  find: typeof findGodot;
  version: typeof godotVersion;
  run: typeof runGodot;
}

export const REAL_DEPS: ExportDeps = { find: findGodot, version: godotVersion, run: runGodot };

export interface ExportRunOptions {
  /** The preset's name or number. */
  preset: string;
  mode?: ExportMode;
  /** Output file; default .godot/godotwright/export/<preset>/... so the preset's own export_path is left alone. */
  out?: string;
  /** Frames to run the exported game for (default 120; 0 = no smoke run). */
  frames?: number;
  godot?: string;
  /** Run --import first (default true). */
  import?: boolean;
  /** Timeout per Godot run in milliseconds (default 10 minutes). */
  timeoutMs?: number;
}

export interface PackInfo {
  file: string;
  bytes: number;
  files: number;
  formatVersion: number;
  engine: string;
  encryptedDirectory: boolean;
  /** The pack is inside the exported executable. */
  embedded: boolean;
}

export interface SmokeReport {
  frames: number;
  fps: number;
  /** What ran: the exported binary, or Godot with --main-pack. */
  how: string;
  exitCode: number | null;
  timedOut: boolean;
  /** Errors the game printed while it ran (and an unexplained exit). */
  errors: number;
  /** What the game printed, engine banners removed. */
  output: string;
}

export interface PatchReport {
  /** What the patch is against: base packs, a file list, or both. */
  against: string[];
  /** Files in the patch (not removals) and their bytes. */
  files: number;
  bytes: number;
  changed: string[];
  added: string[];
  removed: string[];
  /** Delta-encoded files (Godot's patch_delta_encoding). */
  delta: string[];
  /** Files of the full export that are the same as in the base, left out. */
  unchanged: number;
  /** Who wrote the patch: Godot (--export-patch against base packs) or Godotwright (from the file list). */
  by: "godot" | "godotwright" | "none";
}

export interface ExportRun {
  project: string;
  preset?: { name: string; platform: string };
  mode: ExportMode | "patch" | "smoke" | "pck";
  out?: string;
  godot?: string;
  godotVersion?: string;
  steps: CheckStep[];
  pack?: PackInfo;
  contents?: ContentsReport;
  smoke?: SmokeReport;
  patch?: PatchReport;
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  notes: string[];
}

/** Extra preset settings that change how an export runs. */
export interface PresetOptions {
  customRelease?: string;
  customDebug?: string;
  embedPck: boolean;
  /** Base packs from the preset (Godot 4.4+ `patches`). */
  patches: string[];
  encrypted: boolean;
}

export function presetOptions(text: string, index: number): PresetOptions {
  const sections = parseResourceFile(text);
  const main = sections.find((s) => s.tag === `preset.${index}`)?.props ?? {};
  const opts = sections.find((s) => s.tag === `preset.${index}.options`)?.props ?? {};
  const patches = main["patches"];
  return {
    ...(asString(opts["custom_template/release"]) ? { customRelease: asString(opts["custom_template/release"])! } : {}),
    ...(asString(opts["custom_template/debug"]) ? { customDebug: asString(opts["custom_template/debug"])! } : {}),
    embedPck: opts["binary_format/embed_pck"] === true,
    patches: Array.isArray(patches) ? patches.filter((p): p is string => typeof p === "string" && p !== "") : [],
    encrypted: main["encrypt_pck"] === true,
  };
}

/** The template folder name for a `godot --version` line: "4.7.2.stable.official.abc" gives "4.7.2.stable". */
export function templateVersion(versionLine: string): string {
  const parts = versionLine.trim().split(".");
  const out: string[] = [];
  for (const p of parts) {
    out.push(p);
    if (!/^\d+$/.test(p)) break;
  }
  if (parts[out.length] === "mono") out.push("mono");
  return out.join(".");
}

/**
 * Godot prints an export error over several lines ("No export template found at the expected path:" and the path
 * on the next line); these are joined into one line, so the log parser keeps all of it.
 */
export function joinContinuations(text: string): string {
  const lines = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/);
  const out: string[] = [];
  let open = false;
  for (const raw of lines) {
    const line = raw.trim();
    const head = /^(ERROR|WARNING|SCRIPT ERROR|SCRIPT WARNING|USER ERROR|USER WARNING):/.test(line);
    const progress = /^\[\s*(\d+%|DONE)\s*\]/.test(line);
    if (head) {
      out.push(line);
      open = true;
      continue;
    }
    if (open && line && !progress && !/^at:/.test(line) && !/^\[\d+\]/.test(line) && !/^GDScript backtrace/i.test(line)) {
      const last = out.length - 1;
      if (out[last]!.length < 800) out[last] = `${out[last]} ${line}`;
      continue;
    }
    if (!line || /^at:/.test(line)) {
      if (/^at:/.test(line)) out.push(line);
      if (line) open = false;
      continue;
    }
    open = false;
    out.push(line);
  }
  return out.join("\n");
}

/** Godot's export output as diagnostics, with the restating "Project export ... failed" line dropped. */
export function exportDiagnostics(text: string): Diagnostic[] {
  const found = parseGodotLog(joinContinuations(text), "export").filter((d) => !/^Project export for preset ".*" (failed|completed with warnings)\.$/.test(d.message));
  for (const d of found) {
    // An empty [preset.N.options] section: Godot 4.7.2 complains, uses the defaults and exports fine.
    const empty = /^Cannot get keys from nonexistent section "(preset\.\d+\.options)"\.$/.exec(d.message);
    if (empty) {
      d.severity = "warning";
      d.file = "res://export_presets.cfg";
      d.message = `[${empty[1]}] is empty, so Godot prints an error and uses the default options (save the preset once in Project > Export to write them)`;
    }
    if (/No export template found at the expected path/.test(d.message)) {
      d.message = `${d.message.replace(/^Cannot export project with preset "(.*?)" due to configuration errors:\s*/, "")} (install the export templates for this Godot version: Editor > Manage Export Templates, or unpack the .tpz there; mode pack needs no templates)`;
    }
  }
  return found;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preset";
}

const PLATFORM_EXT: Record<string, string> = { "Windows Desktop": ".exe", Linux: ".x86_64", "Linux/X11": ".x86_64", macOS: ".zip", Web: ".html", Android: ".apk", iOS: ".ipa" };

/** Where an export goes by default: under .godot/godotwright/export/, so the preset's own build is left alone. */
export function defaultOut(root: string, preset: ExportPreset, mode: ExportMode | "patch"): string {
  const dir = join(root, ".godot", "godotwright", "export", slug(preset.name));
  if (mode === "pack") return join(dir, `${slug(preset.name)}.pck`);
  if (mode === "patch") return join(dir, `${slug(preset.name)}-patch.pck`);
  const own = preset.exportPath ? basename(preset.exportPath) : "";
  return join(dir, own || `${slug(preset.name)}${PLATFORM_EXT[preset.platform] ?? ""}`);
}

export interface Prepared {
  root: string;
  result: ExportRun;
  preset?: ExportPreset;
  options?: PresetOptions;
  bin?: string;
  /** Template folder name, e.g. "4.7.2.stable". */
  version?: string;
}

/** Finds the project and the preset, and Godot; reports what stops an export before Godot runs. */
export async function prepare(path: string, presetName: string, mode: ExportRun["mode"], godot: string | undefined, deps: ExportDeps): Promise<Prepared> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const result: ExportRun = { project: root, mode, steps: [], diagnostics: [], errors: 0, warnings: 0, notes: [] };
  const file = join(root, "export_presets.cfg");
  if (!existsSync(file)) {
    result.diagnostics.push({ severity: "error", message: "no export_presets.cfg: add a preset in Project > Export first (Godot exports nothing without one)", source: "export" });
    return { root, result };
  }
  const raw = readFileSync(file);
  if (hasBom(raw)) {
    result.diagnostics.push({ severity: "error", file: "res://export_presets.cfg", message: BOM_MESSAGE, source: "export" });
    return { root, result };
  }
  const text = raw.toString("utf8");
  const all = parsePresets(text);
  const preset = all.find((p) => p.name === presetName) ?? all.find((p) => String(p.index) === presetName);
  if (!preset) {
    result.diagnostics.push({
      severity: "error",
      file: "res://export_presets.cfg",
      message: all.length ? `no preset named "${presetName}"; presets: ${all.map((p) => `"${p.name}" (${p.index})`).join(", ")}` : "export_presets.cfg holds no presets",
      source: "export",
    });
    return { root, result };
  }
  result.preset = { name: preset.name, platform: preset.platform };
  if (preset.name !== preset.name.trim()) result.notes.push(`the preset name "${preset.name}" starts or ends with a space; it is passed to Godot exactly as written`);
  const bin = deps.find(godot);
  const line = await deps.version(bin);
  result.godot = bin;
  result.godotVersion = line;
  if (!line.startsWith(`${GODOT_TARGET}.`)) result.diagnostics.push({ severity: "warning", message: `Godot ${line} found; Godotwright targets Godot ${GODOT_TARGET}.x`, source: "engine" });
  return { root, result, preset, options: presetOptions(text, preset.index), bin, version: templateVersion(line) };
}

/** Runs one Godot step and records it. */
async function step(p: Prepared, deps: ExportDeps, name: string, args: string[], timeoutMs: number, cwd?: string, bin?: string): Promise<RunResult> {
  const r = await deps.run(bin ?? p.bin!, args, { cwd: cwd ?? p.root, timeoutMs });
  p.result.steps.push({ name, ms: r.ms, exitCode: r.code, timedOut: r.timedOut });
  if (r.timedOut) p.result.diagnostics.push({ severity: "error", message: `${name} timed out after ${Math.round(timeoutMs / 1000)}s`, source: name });
  return r;
}

/** Runs `--import`; true when the export can go on. */
export async function importStep(p: Prepared, deps: ExportDeps, timeoutMs: number): Promise<boolean> {
  const r = await step(p, deps, "import", ["--headless", "--path", p.root, "--import"], timeoutMs);
  const found = parseGodotLog(`${r.stderr}\n${r.stdout}`, "import");
  const exit = unexplainedExit("import", r, found);
  // A first import of a fresh checkout reports files it has not made yet (translations from a CSV, say); the export,
  // the pack's contents and the smoke run decide, so what the import said is kept as a warning.
  for (const d of found) {
    d.severity = "warning";
    d.message = `while importing: ${d.message}`;
  }
  p.result.diagnostics.push(...found);
  if (exit) p.result.diagnostics.push(exit);
  return !r.timedOut && !exit;
}

/**
 * Runs Godot's export into `out` and checks the file is really there. The flag is --export-pack, --export-release,
 * --export-debug or --export-patch; `extra` are more arguments (--patches). Returns whether the export succeeded.
 */
export async function exportStep(p: Prepared, deps: ExportDeps, flag: string, out: string, timeoutMs: number, extra: string[] = [], name = "export"): Promise<"ok" | "failed" | "nothing"> {
  assertWritable(out);
  mkdirSync(dirname(out), { recursive: true });
  // A file left from an earlier run must not pass for this run's output.
  rmSync(out, { force: true });
  const r = await step(p, deps, name, ["--headless", "--path", p.root, flag, p.preset!.name, out, ...extra], timeoutMs);
  const found = exportDiagnostics(`${r.stderr}\n${r.stdout}`);
  if (found.some((d) => /No files or changes to export/.test(d.message))) {
    rmSync(out, { force: true });
    return "nothing";
  }
  p.result.diagnostics.push(...found);
  if (r.timedOut) return "failed";
  if (r.code !== 0) {
    if (!found.some((d) => d.severity === "error")) p.result.diagnostics.push({ severity: "error", message: `the export exited with code ${r.code} without saying why`, source: "export" });
    if (existsSync(out)) p.result.notes.push(`Godot failed but left ${out} behind: do not ship it`);
    return "failed";
  }
  let size = -1;
  try {
    size = statSync(out).size;
  } catch {
    // Not there.
  }
  if (size < 0) {
    p.result.diagnostics.push({ severity: "error", message: `Godot exited with 0 but wrote no ${basename(out)}: the export did not happen`, source: "export" });
    return "failed";
  }
  if (size < 40) {
    p.result.diagnostics.push({ severity: "error", message: `${basename(out)} is ${size} bytes: too small for a Godot pack or game`, source: "export" });
    return "failed";
  }
  return "ok";
}

/** Reads a pack, or notes why it cannot be read. */
export function readPack(p: Prepared, file: string, embedded: boolean): Pck | undefined {
  try {
    const pck = readPck(file);
    p.result.pack = {
      file,
      bytes: embedded ? pck.bytes - pck.start : pck.bytes,
      files: pck.encryptedDirectory ? pck.fileCount : pck.entries.filter((e) => !(e.flags & 2)).length,
      formatVersion: pck.formatVersion,
      engine: pck.engine.join("."),
      encryptedDirectory: pck.encryptedDirectory,
      embedded: embedded || pck.start > 0,
    };
    if (pck.encryptedDirectory) p.result.notes.push(`the pack's directory is encrypted: ${pck.fileCount} files, names not readable without the key, so its contents were not compared`);
    if (pck.sparse) p.result.notes.push("the pack is a sparse bundle: the files' data is kept outside it");
    return pck;
  } catch (error) {
    if (!(error instanceof PckError)) throw error;
    p.result.diagnostics.push({ severity: "error", message: error.message, source: "contents" });
    return undefined;
  }
}

/** Where the pack of a release or debug export is: next to the binary, or inside it. */
function packOf(out: string): { file: string; embedded: boolean } | undefined {
  const sibling = out.replace(/\.[^./\\]+$/, "") + ".pck";
  if (sibling !== out && existsSync(sibling)) return { file: sibling, embedded: false };
  if (/\.(zip|apk|aab|ipa|app|dmg)$/i.test(out)) return undefined;
  return { file: out, embedded: true };
}

/** Whether an exported binary can run on this machine. */
function runsHere(out: string, platform: string): boolean {
  if (process.platform === "linux") return /^Linux/.test(platform) && (process.arch === "x64" ? /\.x86_64$/ : /\.arm64$/).test(out);
  if (process.platform === "win32") return platform === "Windows Desktop" && /\.exe$/i.test(out);
  return false;
}

/**
 * Runs an exported game headless for some frames: the binary itself when it runs here, else Godot with --main-pack
 * (which also opens an executable with the pack inside). It runs in an empty folder, so no project files mix in.
 */
export async function smokeStep(p: Prepared, deps: ExportDeps, target: { pack: string; binary?: string }, frames: number, timeoutMs: number): Promise<void> {
  const fps = physicsRate(p.root);
  const cwd = mkdtempSync(join(tmpdir(), "godotwright-smoke-"));
  const timing = ["--fixed-fps", String(fps), "--quit-after", String(frames)];
  const how = target.binary ? `the exported binary ${basename(target.binary)}` : `Godot --main-pack ${basename(target.pack)}`;
  let r: RunResult;
  try {
    r = target.binary
      ? await step(p, deps, "smoke", ["--headless", ...timing], timeoutMs, cwd, target.binary)
      : await step(p, deps, "smoke", ["--headless", "--main-pack", target.pack, ...timing], timeoutMs, cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  const found = parseGodotLog(r.stderr, "smoke");
  for (const d of found) {
    // Stopping after N frames can leave objects alive; reported, but not as errors.
    if (EXIT_LEAK.test(d.message)) {
      d.severity = "warning";
      d.message = `at exit: ${d.message}`;
    }
  }
  p.result.diagnostics.push(...found);
  const exit = unexplainedExit("smoke", r, found);
  if (exit) p.result.diagnostics.push(exit);
  const errors = cleanup([...found, ...(exit ? [exit] : [])]).filter((d) => d.severity === "error").length;
  p.result.smoke = { frames, fps, how, exitCode: r.code, timedOut: r.timedOut, errors, output: runOutput(r.stdout) };
}

/** Counts errors and warnings after removing repeats. */
export function finish(result: ExportRun): ExportRun {
  result.diagnostics = cleanup(result.diagnostics);
  result.errors = result.diagnostics.filter((d) => d.severity === "error").length;
  result.warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
  return result;
}

/** A path from a caller: absolute as given, else from the working folder. */
export function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(path);
}

/** Keeps a copy of a file inside the project before an export overwrites it (outside .godot/), for godot_undo. */
export function journalFor(root: string, out: string, preset: string): JournalWriter | undefined {
  const rel = relative(root, out);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(/[\\/]/)[0] === ".godot") return undefined;
  const journal = new JournalWriter(root, "export", `export ${preset} to ${rel}`);
  journal.remember(out);
  return journal;
}

/** Exports a preset headless, checks the result and runs it. */
export async function runExport(path: string, options: ExportRunOptions, deps: ExportDeps = REAL_DEPS): Promise<ExportRun> {
  const mode = options.mode ?? "pack";
  const p = await prepare(path, options.preset, mode, options.godot, deps);
  if (!p.preset) return finish(p.result);
  const preset = p.preset;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const out = options.out ? absolute(options.out) : defaultOut(p.root, preset, mode);
  p.result.out = out;
  if (mode === "pack" && !/\.pck$/i.test(out)) {
    p.result.diagnostics.push({ severity: "error", message: `out must end in .pck for mode pack (got ${basename(out)})`, source: "export" });
    return finish(p.result);
  }
  if (mode !== "pack") {
    const custom = mode === "release" ? p.options!.customRelease : p.options!.customDebug;
    const templates = templateBases().map((b) => join(b, p.version!));
    if (!custom && !templates.some((t) => existsSync(t))) {
      p.result.diagnostics.push({
        severity: "error",
        message: `no export templates for Godot ${p.version} (looked in ${templates[0]}): a ${mode} export needs them. Install them (Editor > Manage Export Templates, or unpack the .tpz of this exact version there), or use mode pack, which needs none`,
        source: "export",
      });
      return finish(p.result);
    }
  }
  if (options.import !== false && !(await importStep(p, deps, timeoutMs))) return finish(p.result);
  const journal = journalFor(p.root, out, preset.name);
  const flag = mode === "pack" ? "--export-pack" : mode === "release" ? "--export-release" : "--export-debug";
  const status = await exportStep(p, deps, flag, out, timeoutMs);
  journal?.commit();
  if (status !== "ok") return finish(p.result);

  const where = mode === "pack" ? { file: out, embedded: false } : packOf(out);
  const pck = where ? readPack(p, where.file, where.embedded) : undefined;
  if (!where) p.result.notes.push(`the pack is inside ${basename(out)} (an archive), so its contents were not listed`);
  if (pck && !pck.encryptedDirectory) {
    const { report, diagnostics } = checkContents(p.root, pck, { preset, main: true });
    p.result.contents = report;
    p.result.diagnostics.push(...diagnostics);
  }
  const frames = options.frames ?? 120;
  if (frames > 0) {
    const binary = mode !== "pack" && runsHere(out, preset.platform) ? out : undefined;
    if (p.options!.encrypted && !binary) p.result.notes.push("smoke run skipped: the pack is encrypted, and only the exported binary (with the key built in) can open it");
    else if (!binary && !pck) p.result.notes.push("smoke run skipped: no pack that this machine's Godot can open");
    else await smokeStep(p, deps, { pack: where?.file ?? out, ...(binary ? { binary } : {}) }, frames, timeoutMs);
  }
  return finish(p.result);
}

/** Runs an exported pack (or a game executable with the pack inside) headless, without exporting. */
export async function smokePack(file: string, options: { path?: string; frames?: number; godot?: string; timeoutMs?: number } = {}, deps: ExportDeps = REAL_DEPS): Promise<ExportRun> {
  const pack = absolute(file);
  const root = findProjectRoot(options.path ?? dirname(pack)) ?? dirname(pack);
  const bin = deps.find(options.godot);
  const line = await deps.version(bin);
  const p: Prepared = { root, result: { project: root, mode: "smoke", out: pack, godot: bin, godotVersion: line, steps: [], diagnostics: [], errors: 0, warnings: 0, notes: [] }, bin };
  const pck = readPack(p, pack, false);
  if (pck) await smokeStep(p, deps, { pack }, options.frames ?? 120, options.timeoutMs ?? 10 * 60_000);
  return finish(p.result);
}

/** Lists a pack and compares it with the project it was exported from (no Godot needed). */
export function inspectPack(file: string, options: { path?: string; preset?: string } = {}): ExportRun {
  const pack = absolute(file);
  // Without --path: the project around the current folder, else the one the pack sits in (.godot/godotwright/export/).
  const root = options.path ? findProjectRoot(options.path) : (findProjectRoot(process.cwd()) ?? findProjectRoot(dirname(pack)));
  const p: Prepared = { root: root ?? dirname(pack), result: { project: root ?? "", mode: "pck", out: pack, steps: [], diagnostics: [], errors: 0, warnings: 0, notes: [] } };
  const pck = readPack(p, pack, false);
  if (pck && !pck.encryptedDirectory) {
    if (root) {
      let preset: ExportPreset | undefined;
      try {
        const all = parsePresets(readFileSync(join(root, "export_presets.cfg"), "utf8"));
        preset = options.preset ? all.find((x) => x.name === options.preset || String(x.index) === options.preset) : all.length === 1 ? all[0] : undefined;
      } catch {
        // No presets: compare without one.
      }
      const patch = !pck.entries.some((e) => e.path === "project.binary");
      if (patch) p.result.notes.push("no project.binary in it: read as a patch, so files the game loads are not required");
      const { report, diagnostics } = checkContents(root, pck, { ...(preset ? { preset } : {}), main: !patch });
      p.result.contents = report;
      p.result.diagnostics.push(...diagnostics);
    } else p.result.notes.push("no project found: listed only, not compared with what the game loads");
  }
  return finish(p.result);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const SHOWN = 40;

/** The compact report: a summary line per stage, then the findings as file: severity: message, then what to do. */
export function formatExportRun(r: ExportRun, options: { files?: boolean } = {}): string {
  const out: string[] = [];
  const at = (f: string) => (r.project && !relative(r.project, f).startsWith("..") ? relative(r.project, f).split("\\").join("/") : f);
  const status = r.errors ? `${plural(r.errors, "error")}, ${plural(r.warnings, "warning")}` : r.warnings ? `ok, ${plural(r.warnings, "warning")}` : "ok";
  const what = r.preset ? `${r.mode} of ${r.preset.name} (${r.preset.platform})${r.out ? ` -> ${at(r.out)}` : ""}` : r.out ? at(r.out) : "";
  out.push(`export ${r.mode === "pck" || r.mode === "smoke" ? r.mode : "run"}: ${what}: ${status}${r.godotVersion ? ` (Godot ${r.godotVersion})` : ""}`);
  if (r.pack && !r.patch) {
    out.push(`pack: ${plural(r.pack.files, "file")}, ${kb(r.pack.bytes)}, format ${r.pack.formatVersion} by Godot ${r.pack.engine}${r.pack.embedded ? ", inside the executable" : ""}${r.pack.encryptedDirectory ? ", directory encrypted" : ""}`);
  }
  if (r.contents) {
    const c = r.contents;
    const parts = [c.needed ? `${c.needed - c.missing} of ${c.needed} files the game loads are in it` : "", c.junk ? `${plural(c.junk, "editor-only or test file")} shipped` : "", c.unreached.files ? `${plural(c.unreached.files, "file")} (${kb(c.unreached.bytes)}) nothing the game starts with reaches (${c.unreached.top.join(", ")}${c.unreached.files > c.unreached.top.length ? ", ..." : ""}; godot_deps unused lists them)` : ""].filter(Boolean);
    if (parts.length) out.push(`contents: ${parts.join("; ")}`);
    if (c.audit && c.audit.predicted) out.push(`audit: ${c.audit.confirmed} of ${c.audit.predicted} predicted missing files confirmed by the pack${c.audit.wrong.length ? `; wrong about ${c.audit.wrong.join(", ")} (they are in it)` : ""}`);
  }
  if (r.patch) {
    const x = r.patch;
    out.push(
      `patch: ${x.by === "none" ? "nothing changed against the base, no patch written" : `${plural(x.files, "file")}, ${kb(x.bytes)}: ${x.changed.length} changed, ${x.added.length} new, ${x.removed.length} removed${x.delta.length ? `, ${x.delta.length} as delta` : ""}; ${x.unchanged} unchanged left out`}${x.by === "godotwright" ? " (written by Godotwright from the file list)" : x.by === "godot" ? " (Godot --export-patch)" : ""}; against ${x.against.map(at).join(", ")}`,
    );
    if (options.files !== false) {
      const list = [...x.changed.map((f) => `~ ${f}`), ...x.added.map((f) => `+ ${f}`), ...x.removed.map((f) => `- ${f}`)];
      for (const l of list.slice(0, SHOWN)) out.push(`  ${l}`);
      if (list.length > SHOWN) out.push(`  +${list.length - SHOWN} more`);
    }
  }
  if (r.smoke) {
    const s = r.smoke;
    out.push(`smoke: ${s.frames} frames (${Math.round((s.frames / s.fps) * 100) / 100} s at ${s.fps} fps) with ${s.how}: ${s.timedOut ? "timed out" : `exit ${s.exitCode}`}, ${plural(s.errors, "error")}`);
  }
  for (const d of r.diagnostics.slice(0, 60)) out.push(formatDiagnostic(d));
  if (r.diagnostics.length > 60) out.push(`+${r.diagnostics.length - 60} more`);
  for (const n of r.notes) out.push(`note: ${n}`);
  if (r.smoke) out.push(`game printed:\n${r.smoke.output || "(nothing)"}`);
  out.push(nextStep(r));
  return `${out.join("\n")}\n`;
}

function nextStep(r: ExportRun): string {
  if (r.diagnostics.some((d) => d.source === "export" && d.severity === "error")) return "Next: fix the export error above and run it again.";
  if (r.contents?.missing) return "Next: get the missing files into the export (include_filter for plain files, or out of exclude_filter), then export again.";
  if (r.smoke?.errors) return "Next: fix the runtime errors above (they happen in the exported game), then export and run again.";
  if (r.errors) return "Next: fix the errors above, then export again.";
  if (r.warnings) return r.diagnostics.every((d) => d.severity !== "warning" || d.source === "contents") ? "Next: keep editor and test files out (exclude_filter), or ship as it is." : "Next: look at the warnings above, or ship as it is.";
  if (r.mode === "pck" && !r.project) return "Next: pass path (the project it was exported from) to compare the pack with what the game loads.";
  return r.mode === "pck" ? "Next: nothing to fix in the pack." : "Next: ship it, or keep this run as a CI step (godotwright export run exits 1 on any error).";
}
