import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Diagnostic } from "../check/log.js";
import { configPaths, exportedToSource } from "../scan/scan.js";
import { defaultOut, exportStep, finish, importStep, journalFor, prepare, readPack, REAL_DEPS, smokeStep, absolute, type ExportDeps, type ExportRun, type PatchReport } from "./run.js";
import { overlay, PACK_FILE_DELTA, PACK_FILE_REMOVAL, PckError, readPck, sourcesOf, writePck, type Pck, type PckEntry } from "./pck.js";

/**
 * A patch pack that holds exactly what changed: Godot's own --export-patch against base packs, or, when only a list
 * of the base game's files is here (a .pck manifest with an md5 per file, as a mod over a shipped game has), a patch
 * Godotwright writes from a full export. Either way it is checked against a fresh full export: a patch never ships a
 * file the base already has unchanged, and never misses one that changed.
 */

export interface PatchOptions {
  preset: string;
  out?: string;
  /** Base packs, in load order (default: the preset's `patches`). */
  against?: string[];
  /** Lists of the base game's files (default: godotwright.json baseFiles). */
  manifest?: string[];
  frames?: number;
  godot?: string;
  import?: boolean;
  timeoutMs?: number;
}

export interface BaseEntry {
  md5?: string;
  bytes?: number;
}

export interface BaseList {
  /** By the name stored in the pack, without res://. */
  entries: Map<string, BaseEntry>;
  /** The source files the names stand for. */
  sources: Set<string>;
}

const norm = (name: string) => name.trim().replace(/\\/g, "/").replace(/^res:\/\//, "").replace(/\/{2,}/g, "/").replace(/^\/+/, "");

/**
 * Reads lists of a base game's files: JSON (a list of paths, or objects with resource/path/file and optional md5 and
 * bytes, under `resources`, `files` or `entries` when there is such a list) or plain text, one path per line.
 */
export function readBaseList(files: string[]): BaseList {
  const entries = new Map<string, BaseEntry>();
  const sources = new Set<string>();
  const add = (name: string, extra: BaseEntry = {}) => {
    const path = norm(name);
    if (!path || /^[a-z]+:\/\//i.test(path)) return;
    entries.set(path, extra);
    const source = exportedToSource(path);
    if (source) sources.add(source);
  };
  const walk = (value: unknown): void => {
    if (typeof value === "string") return add(value);
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    const name = ["resource", "path", "file"].map((k) => o[k]).find((v): v is string => typeof v === "string");
    if (name !== undefined) {
      const md5 = typeof o["md5"] === "string" && /^[0-9a-f]{32}$/i.test(o["md5"]) ? o["md5"].toLowerCase() : undefined;
      const bytes = typeof o["bytes"] === "number" ? o["bytes"] : typeof o["size"] === "number" ? o["size"] : undefined;
      return add(name, { ...(md5 ? { md5 } : {}), ...(bytes !== undefined ? { bytes } : {}) });
    }
    const list = ["resources", "files", "entries"].find((k) => Array.isArray(o[k]));
    if (list) return walk(o[list]);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new Error(`base file list not found: ${file}`);
    }
    if (/^\s*[[{]/.test(text)) {
      try {
        walk(JSON.parse(text));
        continue;
      } catch {
        // Not JSON after all: one path per line.
      }
    }
    text.split("\n").forEach((l) => add(l));
  }
  return { entries, sources };
}

const live = (pck: Pck) => pck.entries.filter((e) => !(e.flags & PACK_FILE_REMOVAL));

/** How a file of the full export compares with a base list: changed, the same, or unknown (listed without md5). */
function againstList(e: PckEntry, list: BaseList): "new" | "changed" | "same" | "unknown" {
  const m = list.entries.get(e.path);
  if (m?.md5) return m.md5 === e.md5 ? "same" : "changed";
  if (m) return "unknown";
  const source = exportedToSource(e.path);
  return source && list.sources.has(source) ? "unknown" : "new";
}

/** Checks a patch against base packs: what a fresh full export says changed must be in it, and nothing more. */
function checkAgainstPacks(full: Pck, bases: Pck[], patch: Pck): Diagnostic[] {
  const out: Diagnostic[] = [];
  const base = overlay(bases).files;
  const inPatch = new Map(patch.entries.map((e) => [e.path, e]));
  for (const e of live(patch)) {
    if (e.flags & PACK_FILE_DELTA) continue;
    const b = base.get(e.path);
    if (b && b.entry.md5 === e.md5) out.push({ severity: "error", file: `res://${e.path}`, message: "the patch ships this file unchanged: the base pack has the same data", source: "patch" });
  }
  const fullPaths = new Set<string>();
  for (const e of live(full)) {
    fullPaths.add(e.path);
    const b = base.get(e.path);
    if (b && b.entry.md5 === e.md5) continue;
    if (!inPatch.has(e.path)) out.push({ severity: "error", file: `res://${e.path}`, message: `${b ? "changed against the base" : "new"} in a fresh full export, but the patch does not hold it`, source: "patch" });
  }
  for (const path of base.keys()) {
    if (fullPaths.has(path)) continue;
    const e = inPatch.get(path);
    if (!e || !(e.flags & PACK_FILE_REMOVAL)) out.push({ severity: "warning", file: `res://${path}`, message: "the base has it and the project no longer does, but the patch does not remove it", source: "patch" });
  }
  return out;
}

/** Checks a patch against a list of the base game's files. */
function checkAgainstList(full: Pck, patch: Pck, list: BaseList, listName: string): { diagnostics: Diagnostic[]; notes: string[] } {
  const diagnostics: Diagnostic[] = [];
  const notes: string[] = [];
  const inPatch = new Set(live(patch).map((e) => e.path));
  let unknown = 0;
  for (const e of live(patch)) {
    const how = againstList(e, list);
    if (how === "same") diagnostics.push({ severity: "error", file: `res://${e.path}`, message: `the patch ships this base file unchanged (the same md5 as in ${listName})`, source: "patch" });
    if (how === "unknown") unknown++;
  }
  for (const e of live(full)) {
    const how = againstList(e, list);
    if ((how === "changed" || how === "new") && !inPatch.has(e.path)) {
      diagnostics.push({ severity: "error", file: `res://${e.path}`, message: `${how === "new" ? "new" : `changed against ${listName}`}, but the patch does not hold it`, source: "patch" });
    }
  }
  if (unknown) notes.push(`${unknown} files in the patch replace files ${listName} lists without an md5, so an unchanged copy cannot be told apart; a list with md5 per file (a .pck manifest) makes this exact`);
  // A patch replaces Godot's caches whole: one smaller than the base's drops UIDs or classes only the base knows,
  // unless files were removed.
  for (const cache of [".godot/uid_cache.bin", ".godot/global_script_class_cache.cfg"]) {
    const ours = patch.entries.find((e) => e.path === cache && !(e.flags & PACK_FILE_REMOVAL));
    const theirs = list.entries.get(cache);
    if (ours && theirs?.bytes !== undefined && ours.size < theirs.bytes) {
      notes.push(`the patch replaces the base's ${cache.slice(7)} (${theirs.bytes} bytes) with a smaller one (${ours.size} bytes): fine when files were removed, but if this project does not hold the whole game, uid:// paths or class names only the base knows stop resolving`);
    }
  }
  const missingFromExport = [...list.entries.entries()].filter(([path, m]) => m.md5 && !full.entries.some((e) => e.path === path)).length;
  if (missingFromExport) notes.push(`${missingFromExport} files of ${listName} are not in this project's export; the patch leaves them as the base has them`);
  return { diagnostics, notes };
}

function classify(patch: Pck, isBase: (path: string) => boolean): Pick<PatchReport, "changed" | "added" | "removed" | "delta" | "files" | "bytes"> {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const delta: string[] = [];
  let bytes = 0;
  for (const e of patch.entries) {
    if (e.flags & PACK_FILE_REMOVAL) {
      removed.push(e.path);
      continue;
    }
    bytes += e.size;
    if (e.flags & PACK_FILE_DELTA) delta.push(e.path);
    (isBase(e.path) ? changed : added).push(e.path);
  }
  return { changed, added, removed, delta, files: changed.length + added.length, bytes };
}

/** Exports a patch for a preset against base packs or a list of the base game's files, checks it and runs it. */
export async function patchExport(path: string, options: PatchOptions, deps: ExportDeps = REAL_DEPS): Promise<ExportRun> {
  const p = await prepare(path, options.preset, "patch", options.godot, deps);
  if (!p.preset) return finish(p.result);
  const { root, result } = p;
  const preset = p.preset;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const fromRoot = (f: string) => (f.startsWith("res://") ? join(root, f.slice(6)) : isAbsolute(f) ? f : resolve(root, f));
  const against = options.against?.length ? options.against.map(absolute) : p.options!.patches.map(fromRoot);
  let manifests: string[] = [];
  try {
    manifests = options.manifest?.length ? options.manifest.map(absolute) : configPaths(root, "baseFiles");
  } catch (error) {
    result.diagnostics.push({ severity: "error", message: error instanceof Error ? error.message : String(error), source: "patch" });
    return finish(result);
  }
  if (!against.length && !manifests.length) {
    result.diagnostics.push({ severity: "error", message: "a patch needs a base: pass against (the base .pck files), set patches in the preset, or list the base game's files in godotwright.json baseFiles", source: "patch" });
    return finish(result);
  }
  for (const f of [...against, ...manifests]) if (!existsSync(f)) result.diagnostics.push({ severity: "error", message: `base not found: ${f}`, source: "patch" });
  if (against.some((f) => f.includes(","))) result.diagnostics.push({ severity: "error", message: "a base pack path contains a comma, which Godot's --patches reads as a separator: rename it", source: "patch" });
  const out = options.out ? absolute(options.out) : defaultOut(root, preset, "patch");
  result.out = out;
  if (!/\.pck$/i.test(out)) result.diagnostics.push({ severity: "error", message: `out must end in .pck (got ${out})`, source: "patch" });
  if (result.diagnostics.some((d) => d.severity === "error")) return finish(result);

  let list: BaseList | undefined;
  try {
    list = manifests.length ? readBaseList(manifests) : undefined;
  } catch (error) {
    result.diagnostics.push({ severity: "error", message: error instanceof Error ? error.message : String(error), source: "patch" });
    return finish(result);
  }
  const bases: Pck[] = [];
  for (const f of against) {
    try {
      const b = readPck(f);
      if (b.encryptedDirectory) throw new PckError(`${f}: the directory is encrypted, so the patch cannot be checked against it`);
      bases.push(b);
    } catch (error) {
      if (!(error instanceof PckError)) throw error;
      result.diagnostics.push({ severity: "error", message: error.message, source: "patch" });
    }
  }
  if (result.diagnostics.some((d) => d.severity === "error")) return finish(result);

  if (options.import !== false && !(await importStep(p, deps, timeoutMs))) return finish(result);
  // The full export is what the patch is checked against (and, from a file list, what it is cut from).
  const fullFile = join(dirname(defaultOut(root, preset, "pack")), "full-for-patch.pck");
  const temps = [fullFile];
  try {
    if ((await exportStep(p, deps, "--export-pack", fullFile, timeoutMs)) !== "ok") return finish(result);
    const full = readPck(fullFile);
    if (full.encryptedDirectory) {
      result.diagnostics.push({ severity: "error", message: "the preset encrypts the pack directory, so the patch cannot be checked; turn encrypt_directory off to check it", source: "patch" });
      return finish(result);
    }
    const listName = manifests.map((m) => m.slice(m.replace(/\\/g, "/").lastIndexOf("/") + 1)).join(", ");
    const journal = journalFor(root, out, preset.name);
    let patch: Pck | undefined;
    if (bases.length) {
      const status = await exportStep(p, deps, "--export-patch", out, timeoutMs, ["--patches", against.join(",")], "patch");
      if (status === "failed") return finish(result);
      if (status === "ok") {
        patch = readPck(out);
        result.diagnostics.push(...checkAgainstPacks(full, bases, patch));
      }
    } else {
      const keep = live(full).filter((e) => againstList(e, list!) !== "same");
      if (keep.length) {
        const sources = new Map(sourcesOf(full).map((s) => [s.path, s]));
        writePck(out, keep.map((e) => sources.get(e.path)!), full.engine);
        patch = readPck(out);
      }
    }
    journal?.commit();
    const baseView = overlay(bases).files;
    const isBase = (f: string) => (bases.length ? baseView.has(f) : list ? againstList({ path: f, offset: 0, size: 0, md5: "", flags: 0 }, list) !== "new" : false);
    if (!patch) {
      result.patch = { against: [...against, ...manifests], files: 0, bytes: 0, changed: [], added: [], removed: [], delta: [], unchanged: live(full).length, by: "none" };
      return finish(result);
    }
    const parts = classify(patch, isBase);
    result.patch = { against: [...against, ...manifests], ...parts, unchanged: Math.max(0, live(full).length - parts.files), by: bases.length ? "godot" : "godotwright" };
    readPack(p, out, false);
    if (list) {
      const checked = checkAgainstList(full, patch, list, listName);
      result.diagnostics.push(...checked.diagnostics);
      result.notes.push(...checked.notes);
    }
    const frames = options.frames ?? 120;
    if (frames > 0) {
      if (p.options!.encrypted) result.notes.push("smoke run skipped: the pack is encrypted, and only the exported binary (with the key built in) can open it");
      else if (bases.length && parts.delta.length) result.notes.push("smoke run skipped: delta-encoded files need Godot to apply them to the base, which a headless run cannot do from the command line");
      else if (bases.length) {
        // What the game sees with the patch loaded over the base: one pack, so --main-pack can start it.
        const merged = join(dirname(fullFile), "patched-game.pck");
        temps.push(merged);
        const view = overlay([...bases, patch]).files;
        const sources = new Map<string, ReturnType<typeof sourcesOf>[number]>();
        for (const pck of [...bases, patch]) for (const s of sourcesOf(pck)) if (view.get(s.path)?.pck === pck) sources.set(s.path, s);
        writePck(merged, [...sources.values()], patch.engine);
        await smokeStep(p, deps, { pack: merged }, frames, timeoutMs);
        if (result.smoke) result.smoke.how = `the base with the patch over it (${result.smoke.how})`;
      } else {
        result.notes.push("no base .pck here, so the smoke run started this project's full export instead of base + patch");
        await smokeStep(p, deps, { pack: fullFile }, frames, timeoutMs);
      }
    }
    return finish(result);
  } catch (error) {
    if (!(error instanceof PckError)) throw error;
    result.diagnostics.push({ severity: "error", message: error.message, source: "patch" });
    return finish(result);
  } finally {
    for (const t of temps) rmSync(t, { force: true });
  }
}
