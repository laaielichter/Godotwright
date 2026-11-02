import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { diffImages, diffPng, formatDiff, imageStats, type ImageDiff } from "./diff.js";
import { decodePng, PngError } from "./png.js";

/** Baselines live in the project and are committed: a PNG and a JSON file with how it was taken. */
export const BASELINE_DIR = ".godotwright/baselines";
/** New captures and diff pictures go here (Godot projects ignore .godot/). */
export const DIFF_DIR = ".godot/godotwright/diff";

/** How a baseline was taken, so a compare renders the same thing again. */
export interface BaselineMeta {
  scene?: string;
  /** A model, relative to the folder the baselines belong to. */
  model?: string;
  views?: string[];
  width: number;
  height: number;
  frames: number;
  /** Per-channel tolerance (0..255) and the largest changed share in percent, for this baseline. */
  tolerance?: number;
  maxChanged?: number;
  /** For a capture in a scenario: the scenario file. The scenario checks it; it is not rendered on its own. */
  scenario?: string;
  renderer?: string;
  godot?: string;
  adapter?: string;
}

export type BaselineStatus = "created" | "updated" | "same" | "changed" | "missing";

export interface BaselineResult {
  name: string;
  status: BaselineStatus;
  ok: boolean;
  /** Paths relative to the project. */
  baseline: string;
  actual: string;
  diffFile?: string;
  /** The diff picture as an absolute path, for tools that attach it. */
  diffPath?: string;
  diff?: ImageDiff;
  /** The capture shows nothing useful (black, transparent, one colour). */
  blank?: string;
  notes: string[];
}

export interface CompareOptions {
  /** Folder for baselines, relative to the project or absolute (default .godotwright/baselines). */
  dir?: string;
  /** Replace the baseline with the new capture. */
  update?: boolean;
  /** Make a missing baseline from the capture (default true); false reports it as missing, as CI should. */
  createMissing?: boolean;
  tolerance?: number;
  maxChanged?: number;
  /** How the capture was taken, kept next to a new or updated baseline. */
  meta: BaselineMeta;
}

export class BaselineError extends Error {}

/** A baseline name as a safe file name: letters, digits, dot, dash and underscore. */
export function baselineName(name: string): string {
  const clean = name.trim().replace(/\.png$/i, "").replace(/[^\w.-]+/g, "_").replace(/^\.+/, "");
  if (!clean) throw new BaselineError(`"${name}" is not a usable baseline name`);
  return clean;
}

export function baselineDir(root: string, dir?: string): string {
  return dir ? (isAbsolute(dir) ? dir : resolve(root, dir)) : join(root, ...BASELINE_DIR.split("/"));
}

export function baselineFiles(root: string, name: string, dir?: string): { png: string; json: string; actual: string; diff: string } {
  const base = baselineDir(root, dir);
  const out = join(root, ...DIFF_DIR.split("/"));
  return { png: join(base, `${name}.png`), json: join(base, `${name}.json`), actual: join(out, `${name}.actual.png`), diff: join(out, `${name}.diff.png`) };
}

export function readBaselineMeta(root: string, name: string, dir?: string): BaselineMeta | undefined {
  const { json } = baselineFiles(root, name, dir);
  if (!existsSync(json)) return undefined;
  try {
    const meta = JSON.parse(readFileSync(json, "utf8")) as BaselineMeta;
    return typeof meta === "object" && meta !== null && typeof meta.width === "number" ? meta : undefined;
  } catch {
    return undefined;
  }
}

/** Every baseline of a project that has its JSON file, sorted by name. */
export function loadBaselines(root: string, dir?: string): { name: string; meta: BaselineMeta }[] {
  const base = baselineDir(root, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      const name = f.slice(0, -5);
      const meta = readBaselineMeta(root, name, dir);
      return meta && existsSync(join(base, `${name}.png`)) ? [{ name, meta }] : [];
    });
}

const rel = (root: string, file: string): string => {
  const r = relative(root, file);
  return (r.startsWith("..") || isAbsolute(r) ? file : r).split(sep).join("/");
};

function readImage(file: string, what: string) {
  try {
    return decodePng(readFileSync(file));
  } catch (error) {
    throw new BaselineError(`cannot read the ${what} ${file}: ${error instanceof PngError ? error.message : String(error)}`);
  }
}

/**
 * Compares a new capture with the baseline of that name: makes it when it is missing (or reports it as missing),
 * replaces it on update, and otherwise diffs the two and writes the diff picture (changed pixels magenta).
 */
export function compareBaseline(root: string, rawName: string, actualFile: string, options: CompareOptions): BaselineResult {
  const name = baselineName(rawName);
  const files = baselineFiles(root, name, options.dir);
  const actual = readImage(actualFile, "new capture");
  const stats = imageStats(actual);
  const result: BaselineResult = { name, status: "same", ok: true, baseline: rel(root, files.png), actual: rel(root, actualFile), notes: [], ...(stats.blank ? { blank: stats.blank } : {}) };
  rmSync(files.diff, { force: true });
  const exists = existsSync(files.png);
  const old = readBaselineMeta(root, name, options.dir);
  if (options.update || (!exists && options.createMissing !== false)) {
    mkdirSync(dirname(files.png), { recursive: true });
    copyFileSync(actualFile, files.png);
    const tolerance = options.tolerance ?? old?.tolerance;
    const maxChanged = options.maxChanged ?? old?.maxChanged;
    const meta: BaselineMeta = { ...options.meta, ...(tolerance !== undefined ? { tolerance } : {}), ...(maxChanged !== undefined ? { maxChanged } : {}) };
    writeFileSync(files.json, `${JSON.stringify(meta, null, 2)}\n`);
    return { ...result, status: exists ? "updated" : "created" };
  }
  if (!exists) return { ...result, status: "missing", ok: false };
  const base = readImage(files.png, "baseline");
  const { diff, mask } = diffImages(base, actual, { tolerance: options.tolerance ?? old?.tolerance, maxChanged: options.maxChanged ?? old?.maxChanged });
  result.diff = diff;
  if (stats.blank && !imageStats(base).blank) result.notes.push("the baseline was not blank: the scene stopped drawing");
  if (diff.ok) return result;
  mkdirSync(dirname(files.diff), { recursive: true });
  writeFileSync(files.diff, diffPng(actual, mask));
  const machine = (k: "godot" | "adapter", what: string) => {
    const was = old?.[k];
    const now = options.meta[k];
    if (was && now && was !== now) result.notes.push(`the baseline was made with ${what} ${was}, this capture with ${now}: a different machine shades edges a little differently; make baselines on the machine that compares them`);
  };
  machine("godot", "Godot");
  machine("adapter", "the graphics driver");
  return { ...result, status: "changed", ok: false, diffFile: rel(root, files.diff), diffPath: files.diff };
}

/** A few lines per baseline: the verdict, then where and how the picture changed, for agents that cannot see it. */
export function formatBaseline(r: BaselineResult, accept = "run again with update"): string[] {
  const out: string[] = [];
  switch (r.status) {
    case "created":
      out.push(`baseline ${r.name}: created ${r.baseline} (commit it)`);
      break;
    case "updated":
      out.push(`baseline ${r.name}: updated ${r.baseline}`);
      break;
    case "missing":
      out.push(`baseline ${r.name}: MISSING ${r.baseline}; make it with ${accept.replace(/^run again with /, "")} and commit it (new capture: ${r.actual})`);
      break;
    case "same":
      out.push(`baseline ${r.name}: same${r.diff?.changed ? ` (${r.diff.changed} px changed, ${r.diff.changedPercent}%, within ${r.diff.maxChanged}%)` : ""}`);
      break;
    case "changed":
      out.push(`baseline ${r.name}: CHANGED`);
      for (const line of formatDiff(r.diff!)) out.push(`  ${line}`);
      out.push(`  diff: ${r.diffFile} (changed pixels magenta)  new: ${r.actual}  baseline: ${r.baseline}`);
      out.push(`  intended? ${accept} to accept it`);
      break;
  }
  if (r.blank) out.push(`  warning: the capture is blank: ${r.blank}`);
  for (const n of r.notes) out.push(`  note: ${n}`);
  return out;
}
