import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lessonsForError, searchLessons } from "../lessons/search.js";
import { playScene, PlayError, type PlayReport, type PlayTimings } from "../play/play.js";
import { findProjectRoot } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";

/**
 * Measures a scene the way a player feels it: frame times over many frames (percentiles, not an average), the frames
 * that went over budget and what changed on them, the physics step apart from the rest, and how the numbers compare
 * with the last measurement of the same scene. Headless, so it measures the CPU side (scripts, physics, scene work);
 * the GPU is not drawn.
 */

export interface PerfOptions {
  godot?: string;
  scene?: string;
  /** Frames to measure (default 600). */
  frames?: number;
  /** Frames to run first without measuring: loading, first spawns, caches (default 60). */
  warmup?: number;
  /** Input timeline, as godot_play takes it, to measure the scene while something happens. */
  input?: string;
  /** Frame budget in milliseconds (default 16.6, 60 fps). */
  budgetMs?: number;
  /** Compare with the last saved measurement of this scene and save this one (default true). */
  baseline?: boolean;
  timeoutMs?: number;
}

export interface Stats {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface Spike {
  frame: number;
  ms: number;
  physicsMs: number;
  cause: string;
}

export interface PerfReport {
  scene: string;
  frames: number;
  warmup: number;
  budgetMs: number;
  frame: Stats;
  physics: Stats;
  process: Stats;
  overBudget: number;
  spikes: Spike[];
  nodes: { start: number; end: number; max: number };
  orphans: { start: number; end: number };
  baseline?: { frame: Stats; physics: Stats; process: Stats; date: string };
  verdict: "ok" | "over budget" | "worse than before";
  hints: string[];
  run: PlayReport;
}

function stats(values: number[]): Stats {
  if (!values.length) return { p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!;
  const round = (us: number) => Math.round(us / 10) / 100;
  return { p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1)!), mean: round(values.reduce((a, b) => a + b, 0) / values.length) };
}

function baselinePath(root: string, scene: string): string {
  return join(root, ".godot", "godotwright", "perf", `${scene.replace(/^res:\/\//, "").replace(/[^\w.-]+/g, "_")}.json`);
}

export async function perfScene(path: string, options: PerfOptions = {}): Promise<PerfReport> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const frames = options.frames ?? 600;
  const warmup = options.warmup ?? 60;
  const budgetMs = options.budgetMs ?? 16.6;
  if (!(Number.isInteger(frames) && frames >= 10 && frames <= 50_000)) throw new PlayError("frames must be a whole number from 10 to 50000");
  if (!(Number.isInteger(warmup) && warmup >= 0 && warmup <= 10_000)) throw new PlayError("warmup must be a whole number from 0 to 10000");
  const run = await playScene(root, {
    godot: options.godot,
    ...(options.scene ? { scene: options.scene } : {}),
    ...(options.input ? { input: options.input } : {}),
    frames: warmup + frames,
    every: warmup + frames + 1,
    perfFrom: warmup,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const t: PlayTimings = run.timings ?? { from: warmup, frame: [], physics: [], process: [], nodes: [], orphans: [] };
  const n = Math.min(t.frame.length, t.process.length, t.nodes.length);
  const frame = stats(t.frame.slice(0, n));
  const physics = stats(t.physics.slice(0, n));
  const process = stats(t.process.slice(0, n));
  const budgetUs = budgetMs * 1000;
  const median = frame.p50 * 1000;

  // Spikes: frames over budget, or far above the usual frame; the cause is what changed on that frame.
  const spikes: Spike[] = [];
  for (let i = 0; i < n; i++) {
    const us = t.frame[i]!;
    if (us <= budgetUs && us <= Math.max(3 * median, 2000)) continue;
    const dNodes = (t.nodes[i] ?? 0) - (t.nodes[i - 1] ?? t.nodes[i] ?? 0);
    const phys = t.physics[i] ?? 0;
    const cause =
      Math.abs(dNodes) >= 20
        ? `nodes ${dNodes > 0 ? "+" : ""}${dNodes} (made or freed in one frame)`
        : phys > us * 0.6
          ? "the physics step (physics callbacks, collision, many bodies)"
          : "scripts or engine work outside physics (_process, signals, loading on the main thread)";
    spikes.push({ frame: warmup + i, ms: Math.round(us / 10) / 100, physicsMs: Math.round(phys / 10) / 100, cause });
  }
  spikes.sort((a, b) => b.ms - a.ms);

  let baseline: PerfReport["baseline"];
  const file = baselinePath(root, run.scene);
  if (options.baseline !== false) {
    // No baseline yet when the file is not there.
    try {
      baseline = JSON.parse(readFileSync(file, "utf8")) as PerfReport["baseline"];
    } catch {
      baseline = undefined;
    }
  }
  const overBudget = t.frame.slice(0, n).filter((us) => us > budgetUs).length;
  const worse = baseline && frame.p95 > baseline.frame.p95 * 1.1 && frame.p95 - baseline.frame.p95 > 0.5;
  const verdict: PerfReport["verdict"] = frame.p95 > budgetMs ? "over budget" : worse ? "worse than before" : "ok";
  if (options.baseline !== false && n > 0 && run.finished) {
    mkdirSync(join(root, ".godot", "godotwright", "perf"), { recursive: true });
    writeFileSync(file, JSON.stringify({ frame, physics, process, date: new Date().toISOString() }, null, 2));
  }

  // Lessons that fit what the numbers show.
  const hints: string[] = [];
  const words: string[] = [];
  if (spikes.some((s) => s.cause.startsWith("nodes"))) words.push("spawn many nodes in one frame stutter");
  if (spikes.some((s) => s.cause.startsWith("the physics"))) words.push("physics step slow many bodies catch up");
  if (process.p95 > physics.p95 * 2 && frame.p95 > budgetMs / 2) words.push("process per frame heavy script");
  if (t.orphans.at(-1)! > (t.orphans[0] ?? 0) + 50) words.push("orphan nodes leak freed");
  const seen = new Set<string>();
  for (const w of words) {
    for (const hit of searchLessons(w, { limit: 2, topic: "performance" })) {
      if (seen.has(hit.lesson.id)) continue;
      seen.add(hit.lesson.id);
      hints.push(`${hit.lesson.id}: ${hit.lesson.title}`);
    }
  }
  for (const d of run.diagnostics.filter((x) => x.severity === "error").slice(0, 3)) {
    const hit = lessonsForError(d.message, { limit: 1 })[0];
    if (hit && !seen.has(hit.lesson.id)) hints.push(`${hit.lesson.id}: ${hit.lesson.title}`);
  }

  return {
    scene: run.scene,
    frames: n,
    warmup,
    budgetMs,
    frame,
    physics,
    process,
    overBudget,
    spikes: spikes.slice(0, 8),
    nodes: { start: t.nodes[0] ?? 0, end: t.nodes[n - 1] ?? 0, max: Math.max(0, ...t.nodes.slice(0, n)) },
    orphans: { start: t.orphans[0] ?? 0, end: t.orphans[n - 1] ?? 0 },
    ...(baseline ? { baseline } : {}),
    verdict,
    hints,
    run,
  };
}

const fmt = (s: Stats) => `p50 ${s.p50}  p95 ${s.p95}  p99 ${s.p99}  max ${s.max}`;
const delta = (now: number, before: number) => {
  const d = Math.round((now - before) * 100) / 100;
  return `${d > 0 ? "+" : ""}${d} ms`;
};

export function formatPerf(r: PerfReport): string {
  const out: string[] = [];
  out.push(`perf ${r.scene}: ${r.frames} frames after ${r.warmup} warm-up frames, headless (CPU side: scripts, physics, scene work), budget ${r.budgetMs} ms: ${r.verdict.toUpperCase()}`);
  if (!r.run.finished) out.push("the run did NOT reach the last frame: the numbers cover only part of it (see the errors)");
  out.push(`frame ms    ${fmt(r.frame)}   over budget ${r.overBudget} (${r.frames ? Math.round((1000 * r.overBudget) / r.frames) / 10 : 0}%)`);
  out.push(`physics ms  ${fmt(r.physics)}`);
  out.push(`rest ms     ${fmt(r.process)}   (_process, signals, deferred calls, the main loop)`);
  out.push(`nodes ${r.nodes.start} -> ${r.nodes.end} (max ${r.nodes.max}); orphan nodes ${r.orphans.start} -> ${r.orphans.end}${r.orphans.end > r.orphans.start + 50 ? " (growing: nodes removed but never freed; godot_leaks names their class, script and where they were made)" : ""}`);
  if (r.spikes.length) {
    out.push("slowest frames:");
    for (const s of r.spikes) out.push(`  frame ${s.frame}: ${s.ms} ms (physics ${s.physicsMs} ms): ${s.cause}`);
  }
  if (r.baseline) {
    out.push(`vs last run (${r.baseline.date.slice(0, 16).replace("T", " ")}): frame p95 ${delta(r.frame.p95, r.baseline.frame.p95)}, p99 ${delta(r.frame.p99, r.baseline.frame.p99)}, physics p95 ${delta(r.physics.p95, r.baseline.physics.p95)}`);
  } else out.push("no earlier run of this scene: this one is the baseline for the next");
  for (const d of r.run.diagnostics.filter((x) => x.severity === "error").slice(0, 5)) out.push(`error: ${d.file ? `${d.file}${d.line ? `:${d.line}` : ""}  ` : ""}${d.message}${d.count && d.count > 1 ? ` (x${d.count})` : ""}`);
  if (r.hints.length) {
    out.push("lessons for what these numbers show (godot_lessons <id>):");
    for (const h of r.hints) out.push(`  ${h}`);
  }
  out.push(
    r.verdict === "ok"
      ? "Next: measure again after each change; a p95 that grows more than 10% shows as WORSE THAN BEFORE."
      : "Next: fix the slowest frames first (their cause is named), then measure again with the same scene and input.",
  );
  return `${out.join("\n")}\n`;
}
