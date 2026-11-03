import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ProtectedPathError, assertWritable } from "../project/protect.js";
import { DEFAULT_THRESHOLD, DEFAULT_TOLERANCE, diffImages, formatDiff, imageStats, type ImageDiff } from "./diff.js";
import { decodePng, encodePng, PngError } from "./png.js";

/**
 * Screenshot baselines: the last approved picture, compared pixel by pixel with a new one. One implementation for
 * every way in: `baseline: "auto"` or a .png path (godot_screenshot, `screenshot --baseline`), a named baseline with
 * its settings in a JSON file next to it (`baseline: "hud"`), the screenshot steps of a scenario, and `godotwright ci`.
 */

/** Baselines live in the project and are committed: a PNG, and for a named one a JSON file with how it was taken. */
export const BASELINE_DIR = ".godotwright/baselines";
/** New captures and diff pictures of named baselines go here (Godot projects ignore .godot/). */
export const DIFF_DIR = ".godot/godotwright/diff";

/** How a named baseline was taken, so a compare renders the same thing again. */
export interface BaselineMeta {
  scene?: string;
  /** A model, relative to the folder the baselines belong to. */
  model?: string;
  views?: string[];
  width: number;
  height: number;
  frames: number;
  /** Tolerance (0-255) and threshold (percent of pixels) for this baseline. */
  tolerance?: number;
  threshold?: number;
  /** For a capture in a scenario: the scenario file. The scenario checks it; it is not rendered on its own. */
  scenario?: string;
  renderer?: string;
  godot?: string;
  adapter?: string;
}

/**
 * saved: there was no baseline yet (or it was replaced); unchanged: not one pixel changed; within-threshold: some
 * pixels changed, but no more than the threshold allows; changed: more pixels changed than the threshold allows;
 * size-mismatch: the pictures have different sizes; missing: there is no baseline and none was made (CI);
 * failed: there was no picture to compare (the run ended early).
 */
export type BaselineStatus = "saved" | "unchanged" | "within-threshold" | "changed" | "size-mismatch" | "missing" | "failed";

export interface BaselineResult {
  status: BaselineStatus;
  /** False when the picture changed beyond the threshold, has another size, or was not compared. */
  ok: boolean;
  /** The baseline PNG. */
  file: string;
  /** True when an existing baseline was replaced. */
  replaced?: boolean;
  /** The diff picture: the baseline in grey with the changed pixels in red (only when a pixel changed). */
  diff?: string;
  percent?: number;
  pixels?: number;
  threshold: number;
  tolerance: number;
  region?: ImageDiff["region"];
  meanShift?: number;
  /** The size of the baseline when it differs from the new picture. */
  baselineSize?: { width: number; height: number };
  /** The size of the new picture when it differs from the baseline. */
  actualSize?: { width: number; height: number };
  /** Up to five areas of change, biggest first, with how far one moved when a shift explains it. */
  boxes?: ImageDiff["boxes"];
  moreBoxes?: number;
  /** Share of changed pixels per ninth of the picture. */
  regions?: ImageDiff["regions"];
  /** Mean brightness of the baseline and of the new picture. */
  luma?: ImageDiff["luma"];
  /** A named baseline's name. */
  name?: string;
  /** The new capture. */
  actual?: string;
  /** The capture shows nothing useful (black, transparent, one colour). */
  blank?: string;
  notes?: string[];
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
  return { png: join(base, `${name}.png`), json: join(base, `${name}.json`), actual: join(out, `${name}.actual.png`), diff: join(out, `${name}-diff.png`) };
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

/** Every named baseline of a project (one with its JSON file), sorted by name. */
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

function readImage(file: string, what: string) {
  try {
    return decodePng(readFileSync(file));
  } catch (error) {
    if (error instanceof PngError) throw new BaselineError(`the ${what} ${file} cannot be read (${error.message})${what === "baseline" ? "; update the baseline to replace it" : ""}`);
    throw error;
  }
}

/** A baseline write into a protected path (godotwright.json "protect") is a BaselineError, so callers report it. */
function writable(file: string): void {
  try {
    assertWritable(file);
  } catch (error) {
    throw error instanceof ProtectedPathError ? new BaselineError(error.message) : error;
  }
}

export interface CompareFileOptions {
  threshold?: number;
  tolerance?: number;
  /** Replace the baseline with the new picture instead of comparing. */
  update?: boolean;
  /** Make a missing baseline from the picture (default true); false reports it as missing, as CI should. */
  createMissing?: boolean;
  /** Where the diff picture goes (default: next to the shot, shot.png gives shot-diff.png). */
  diff?: string;
}

/**
 * Compares a new picture with its baseline file, or saves it as the baseline when there is none yet (or when asked
 * to). The diff picture is written only when a pixel changed; otherwise an old one is removed, so a diff on disk
 * always belongs to the last compare.
 */
export function compareBaselineFile(shot: string, baseline: string, options: CompareFileOptions = {}): BaselineResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const base = { file: baseline, threshold, tolerance };
  const diff = options.diff ?? `${shot.replace(/\.png$/i, "")}-diff.png`;
  writable(diff);
  rmSync(diff, { force: true });
  const exists = existsSync(baseline);
  if (!exists || options.update) {
    if (!exists && !options.update && options.createMissing === false) return { status: "missing", ok: false, ...base };
    writable(baseline);
    mkdirSync(dirname(baseline), { recursive: true });
    copyFileSync(shot, baseline);
    return { status: "saved", ok: true, ...base, ...(exists ? { replaced: true } : {}) };
  }
  const before = readImage(baseline, "baseline");
  const after = readImage(shot, "new picture");
  if (before.width !== after.width || before.height !== after.height)
    return { status: "size-mismatch", ok: false, ...base, baselineSize: { width: before.width, height: before.height }, actualSize: { width: after.width, height: after.height } };
  const { diff: d, image } = diffImages(before, after, { threshold, tolerance });
  const amount = {
    percent: d.percent,
    pixels: d.pixels,
    ...(d.region ? { region: d.region } : {}),
    meanShift: d.meanShift,
    ...(d.pixels ? { boxes: d.boxes, moreBoxes: d.moreBoxes, regions: d.regions, luma: d.luma } : {}),
  };
  if (d.pixels === 0) return { status: "unchanged", ok: true, ...base, ...amount };
  mkdirSync(dirname(diff), { recursive: true });
  writeFileSync(diff, encodePng(image.width, image.height, image.rgba, 4));
  return { status: d.ok ? "within-threshold" : "changed", ok: d.ok, ...base, diff, ...amount };
}

export interface CompareOptions {
  /** Folder for baselines, relative to the project or absolute (default .godotwright/baselines). */
  dir?: string;
  /** Replace the baseline with the new capture. */
  update?: boolean;
  /** Make a missing baseline from the capture (default true); false reports it as missing, as CI should. */
  createMissing?: boolean;
  tolerance?: number;
  threshold?: number;
  /** How the capture was taken, kept next to a new or updated baseline. */
  meta: BaselineMeta;
}

/**
 * Compares a new capture with the named baseline: makes it when it is missing (or reports it as missing), replaces
 * it on update, and otherwise diffs the two. The baseline's JSON file keeps how it was taken, and its tolerance and
 * threshold when they were given.
 */
export function compareBaseline(root: string, rawName: string, actualFile: string, options: CompareOptions): BaselineResult {
  const name = baselineName(rawName);
  const files = baselineFiles(root, name, options.dir);
  const stats = imageStats(readImage(actualFile, "new capture"));
  const old = readBaselineMeta(root, name, options.dir);
  const exists = existsSync(files.png);
  if (options.update || (!exists && options.createMissing !== false)) {
    writable(files.json);
    // Never write over a JSON file that is not this baseline's settings: it belongs to something else.
    if (!exists && !old && existsSync(files.json)) throw new BaselineError(`${files.json} exists and is not a baseline settings file; choose another baseline name or folder`);
  }
  const tolerance = options.tolerance ?? old?.tolerance;
  const threshold = options.threshold ?? old?.threshold;
  const r = compareBaselineFile(actualFile, files.png, {
    ...(tolerance !== undefined ? { tolerance } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    ...(options.update ? { update: true } : {}),
    ...(options.createMissing === false ? { createMissing: false } : {}),
    diff: files.diff,
  });
  const notes: string[] = [];
  if (r.status === "saved") {
    const meta: BaselineMeta = { ...options.meta, ...(tolerance !== undefined ? { tolerance } : {}), ...(threshold !== undefined ? { threshold } : {}) };
    writeFileSync(files.json, `${JSON.stringify(meta, null, 2)}\n`);
  } else if (r.status !== "missing") {
    if (stats.blank && !imageStats(readImage(files.png, "baseline")).blank) notes.push("the baseline was not blank: the scene stopped drawing");
    if (!r.ok) {
      for (const [k, what] of [["godot", "Godot"], ["adapter", "the graphics driver"]] as const) {
        const was = old?.[k];
        const now = options.meta[k];
        if (was && now && was !== now) notes.push(`the baseline was made with ${what} ${was}, this capture with ${now}: a different machine shades edges a little differently; make baselines on the machine that compares them`);
      }
    }
  }
  return { ...r, name, actual: actualFile, ...(stats.blank ? { blank: stats.blank } : {}), ...(notes.length ? { notes } : {}) };
}

/** How to accept a new picture, in the words of the tool that compared it. */
export const UPDATE_HINT = "update the baseline (update_baseline, or --update-baseline)";

/** A few lines per baseline: the verdict, then where and how the picture changed, for agents that cannot see it. */
export function formatBaseline(b: BaselineResult, update = UPDATE_HINT): string[] {
  const label = b.name ? `baseline ${b.name}` : "baseline";
  const tail = [...(b.blank ? [`  warning: the capture is blank: ${b.blank}`] : []), ...(b.notes ?? []).map((n) => `  note: ${n}`)];
  if (b.status === "saved")
    return [
      `${label} ${b.replaced ? "replaced" : "saved"}: ${b.file}`,
      ...tail,
      "Next: look at the picture once; keep the baseline with the project (Godot does not import .godotwright/), and screenshot with the baseline again after a change to compare.",
    ];
  if (b.status === "missing")
    return [`${label} MISSING: ${b.file}${b.actual ? ` (new capture: ${b.actual})` : ""}`, ...tail, `Next: make it (${update}), then commit it.`];
  if (b.status === "failed") return [`${label} NOT COMPARED`, ...tail];
  if (b.status === "size-mismatch")
    return [
      `${label} size differs: the baseline is ${b.baselineSize?.width}x${b.baselineSize?.height}, the new picture ${b.actualSize?.width}x${b.actualSize?.height}; nothing compared`,
      `  baseline: ${b.file}`,
      ...tail,
      `Next: render with the size and views the baseline was made with, or ${update} if the new size is intended.`,
    ];
  const region = b.region ? `; largest change at (${b.region.x}, ${b.region.y}) size ${b.region.width}x${b.region.height}, mean shift ${b.meanShift}` : "";
  const amount = `${b.percent}% of pixels changed (${b.pixels} px; threshold ${b.threshold}%, tolerance ${b.tolerance})${region}`;
  const details = b.boxes && b.regions && b.luma ? formatDiff({ boxes: b.boxes, moreBoxes: b.moreBoxes ?? 0, regions: b.regions, luma: b.luma } as ImageDiff).map((l) => `  ${l}`) : [];
  if (b.status === "unchanged") return [`${label} unchanged: ${amount}`, `  baseline: ${b.file}`, ...tail, "Next: nothing to fix; the picture matches its baseline."];
  const files = [`  baseline: ${b.file}`, ...(b.actual ? [`  new: ${b.actual}`] : []), `  diff: ${b.diff} (changed pixels in red)`];
  if (b.status === "within-threshold")
    return [
      `${label} within threshold: ${amount}`,
      ...details,
      ...files,
      ...tail,
      `Next: look at the diff; a small change can still matter (a missing icon, a moved label). If it is intended, ${update}; to fail on any change, use threshold 0.`,
    ];
  return [`${label} CHANGED: ${amount}`, ...details, ...files, ...tail, `Next: look at the diff; if the change is intended, ${update}; if not, fix it and screenshot again.`];
}
