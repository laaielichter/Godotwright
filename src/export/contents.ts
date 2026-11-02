import { existsSync, readFileSync } from "node:fs";
import type { Diagnostic } from "../check/log.js";
import { buildGraph, type DepsGraph } from "../deps/deps.js";
import { fromResPath } from "../project/files.js";
import { exportedToSource } from "../scan/scan.js";
import { checkExport, matchesFilter, RESOURCE_EXT, type ExportPreset } from "./export.js";
import { PACK_FILE_REMOVAL, type Pck } from "./pck.js";

/**
 * What an exported pack really holds, compared with what the game loads: files the game loads that are not in it
 * (the build fails there), editor-only and test code that is in it (dead weight, and an EditorPlugin cannot even
 * compile in the game), files nothing reaches, and whether the static export audit predicted the pack right.
 */

export interface ContentsReport {
  /** Files in the pack (not removals). */
  files: number;
  /** The project's files the game loads from where it starts (ext_resource, preload, load with a literal path). */
  needed: number;
  missing: number;
  /** Editor-only and test files shipped. */
  junk: number;
  /** Shipped files of the project that nothing the game starts with reaches. */
  unreached: { files: number; bytes: number; top: string[] };
  /** The export audit's errors for this preset, checked against the pack. */
  audit?: { predicted: number; confirmed: number; wrong: string[] };
}

/** Edges that load the file with the one that names it, or by a literal path: a missing file is an error then. */
const LOADS = new Set(["ext_resource", "preload", "load"]);
/** Settings that only the editor reads. */
const EDITOR_SETTING = /^project\.godot: (editor|editor_plugins|dotnet|filesystem)\//;
/** Source files Godot does not ship as such: C# is compiled into the assembly. */
const NOT_SHIPPED = /\.(cs|gdshaderinc)$/i;
/**
 * Classes only the editor has (extension_api.json of Godot 4.7.2 marks them api_type "editor"; every Editor* class is
 * one): a script that extends one cannot even load in an export template.
 */
const EDITOR_CLASS = /^(Editor[A-Z]\w*|GridMapEditorPlugin|OpenXR(BindingModifier|InteractionProfile)Editor(Base)?|ScriptEditorBase|ResourceImporter\w*)$/;
const TEST_ADDON = /^res:\/\/addons\/(gut|gdUnit4|gdunit4|WAT)\//;
const TEST_FILE = /\/tests?\/(.*\/)?(test_[^/]*|[^/]*_test)\.gd$/;

/** What a script extends, read from its text: `extends EditorPlugin` gives EditorPlugin. */
function extendsOf(root: string, file: string): string | undefined {
  if (!file.endsWith(".gd")) return undefined;
  try {
    return /^\s*extends\s+([A-Za-z_]\w*)/m.exec(readFileSync(fromResPath(root, file), "utf8"))?.[1];
  } catch {
    return undefined;
  }
}

/** The source files a pack holds, with the bytes of everything that stands for each (x.gdc and x.gd.remap for x.gd). */
export function packSources(pck: Pck): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of pck.entries) {
    if (e.flags & PACK_FILE_REMOVAL) continue;
    const source = exportedToSource(e.path);
    if (source) out.set(source, (out.get(source) ?? 0) + e.size);
  }
  return out;
}

export interface GameFile {
  file: string;
  /** From where the game starts to the file: "res://a.tscn ext_resource < res://main.tscn < project.godot: application/run/main_scene". */
  chain: string;
  /** How the last step loads it, and from where. */
  kind: string;
  from?: string;
}

/** The project's own files that the game loads when it starts and plays, through edges that really load them. */
export function gameFiles(root: string, g: DepsGraph = buildGraph(root)): GameFile[] {
  const parent = new Map<string, { from: string; kind: string; line?: number }>();
  const startWhy = new Map<string, string>();
  const queue: string[] = [];
  for (const [file, why] of g.roots) {
    if (!(why.startsWith("project.godot: ") || why.startsWith("Godot's default")) || EDITOR_SETTING.test(why)) continue;
    startWhy.set(file, why);
    queue.push(file);
  }
  const seen = new Set(queue);
  while (queue.length) {
    const file = queue.shift()!;
    for (const edge of g.edgesOf(file)) {
      if (!LOADS.has(edge.kind) || seen.has(edge.to)) continue;
      seen.add(edge.to);
      parent.set(edge.to, { from: file, kind: edge.kind, ...(edge.line ? { line: edge.line } : {}) });
      queue.push(edge.to);
    }
  }
  const out: GameFile[] = [];
  for (const file of seen) {
    if (NOT_SHIPPED.test(file) || !existsSync(fromResPath(root, file))) continue;
    const steps: string[] = [file];
    let at = file;
    for (let i = 0; i < 12; i++) {
      const p = parent.get(at);
      if (!p) break;
      steps.push(`${p.kind} in ${p.from}${p.line ? `:${p.line}` : ""}`);
      at = p.from;
    }
    const why = startWhy.get(at);
    if (why) steps.push(why);
    const p = parent.get(file);
    out.push({ file, chain: steps.join(" < "), kind: p?.kind ?? "start", ...(p ? { from: `${p.from}${p.line ? `:${p.line}` : ""}` } : {}) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Why a file the game loads is not in the pack, as far as the preset tells. */
function cause(file: string, preset: ExportPreset | undefined, root: string): string {
  if (!preset) return "";
  const rel = file.slice(6);
  if (preset.exclude.some((f) => matchesFilter(rel, f))) return "exclude_filter leaves it out";
  const imported = existsSync(fromResPath(root, `${file}.import`));
  if ((!RESOURCE_EXT.test(rel) || (/\.csv$/i.test(rel) && !imported)) && !preset.include.some((f) => matchesFilter(rel, f))) {
    return `a plain file, which Godot exports only when include_filter names it: add "*.${rel.slice(rel.lastIndexOf(".") + 1)}"`;
  }
  if (preset.exportFilter === "resources" || preset.exportFilter === "scenes") return `the preset exports only the ${preset.exportFilter} it lists and what they load`;
  return "";
}

/**
 * Compares a pack with the project. `main` says the pack is meant to start the game (a full export), not a patch.
 */
export function checkContents(root: string, pck: Pck, options: { preset?: ExportPreset; main?: boolean } = {}): { report: ContentsReport; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const sources = packSources(pck);
  const files = pck.entries.filter((e) => !(e.flags & PACK_FILE_REMOVAL)).length;
  const report: ContentsReport = { files, needed: 0, missing: 0, junk: 0, unreached: { files: 0, bytes: 0, top: [] } };
  if (pck.encryptedDirectory) return { report, diagnostics };

  if (options.main !== false && !pck.entries.some((e) => e.path === "project.binary")) {
    diagnostics.push({ severity: "error", message: "the pack holds no project.binary (the project settings): Godot cannot start it as the game's main pack", source: "contents" });
  }

  const g = buildGraph(root);
  const game = options.main === false ? [] : gameFiles(root, g);
  report.needed = game.length;
  for (const g of game) {
    if (sources.has(g.file)) continue;
    report.missing++;
    const why = cause(g.file, options.preset, root);
    diagnostics.push({
      severity: "error",
      file: g.file,
      message: `the game loads it, but the pack does not hold it, so this load fails in the build${why ? `; ${why}` : ""}. Chain: ${g.chain}`,
      source: "contents",
    });
  }

  // Editor-only and test code, one line per folder.
  const junk = new Map<string, { kind: string; files: string[]; bytes: number }>();
  const reached = (f: string) => g.roots.has(f) || g.parent.has(f);
  const own = new Set(g.assets);
  for (const [file, bytes] of sources) {
    const ext = extendsOf(root, file);
    const kind = ext && EDITOR_CLASS.test(ext) ? `editor-only script|; it extends ${ext}, a class only the editor has` : TEST_ADDON.test(file) || TEST_FILE.test(file) || ext === "GutTest" || ext === "GdUnitTestSuite" ? "test file|" : undefined;
    if (kind) {
      const folder = TEST_ADDON.exec(file)?.[0] ?? file.slice(0, file.lastIndexOf("/") + 1);
      const key = `${kind}|${folder}`;
      const entry = junk.get(key) ?? { kind, files: [], bytes: 0 };
      entry.files.push(file);
      entry.bytes += bytes;
      junk.set(key, entry);
      continue;
    }
    if (own.has(file) && !reached(file)) {
      report.unreached.files++;
      report.unreached.bytes += bytes;
      report.unreached.top.push(file);
    }
  }
  report.unreached.top = report.unreached.top.sort((a, b) => (sources.get(b) ?? 0) - (sources.get(a) ?? 0)).slice(0, 3);
  for (const [key, j] of junk) {
    const folder = key.slice(key.indexOf("|") + 1);
    report.junk += j.files.length;
    const filter = j.files.length <= 2 ? j.files.map((f) => f.slice(6)).join(",") : `${folder.slice(6)}*`;
    const [label, detail] = j.kind.split("|") as [string, string];
    diagnostics.push({
      severity: "warning",
      file: j.files.length === 1 ? j.files[0]! : folder,
      message: `${j.files.length} ${label}${j.files.length === 1 ? "" : "s"} shipped in the pack (${kb(j.bytes)})${detail}: add "${filter}" to the preset's exclude_filter`,
      source: "contents",
    });
  }

  // The static audit's predictions, checked against the real pack.
  if (options.preset && options.main !== false) {
    const predicted = checkExport(root, { preset: options.preset.name }).problems.filter((p) => p.severity === "error" && p.preset === options.preset!.name);
    const wrong = [...new Set(predicted.filter((p) => sources.has(p.file)).map((p) => p.file))];
    report.audit = { predicted: new Set(predicted.map((p) => p.file)).size, confirmed: new Set(predicted.map((p) => p.file)).size - wrong.length, wrong };
  }
  return { report, diagnostics };
}

export function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
