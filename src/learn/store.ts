import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { lessonFrom } from "../lessons/library.js";
import type { LessonStats, LocalLesson } from "../lessons/types.js";

/**
 * What Godotwright has learned on this machine. It never holds code, paths or
 * project names in the parts that can be shared (see share.ts); the local-only
 * `dismissed` map holds hashes.
 */
export interface RuleStats {
  /** Reviews in which the rule fired. */
  reported: number;
  /** Times real Godot reported an error at the same place. */
  confirmed: number;
  /** Times real Godot loaded the file without the error the rule predicted. */
  contradicted: number;
  /** Times a user or agent marked a finding of this rule as wrong. */
  dismissed: number;
  /** Times a user or agent marked a finding of this rule as right. Local only: not a Godot confirmation. */
  verified?: number;
}

export interface ApiMiss {
  count: number;
  /** Successful lookups that followed this miss, i.e. what was meant. */
  resolved: Record<string, number>;
}

export interface LearningData {
  version: 1;
  /** Local learning on or off (default on; nothing leaves the machine). */
  enabled: boolean;
  rules: Record<string, RuleStats>;
  /** Fingerprints of findings marked as wrong, with when. Local only. */
  dismissed: Record<string, number>;
  /**
   * Fingerprints of findings marked as right, or confirmed by Godot after they were marked wrong, with when. Local
   * only: `godotwright dream` uses it to find verdicts that contradict each other.
   */
  verified: Record<string, number>;
  /** API lookups that found nothing, by query. */
  apiMisses: Record<string, ApiMiss>;
  /** The last miss, so the next successful lookup can resolve it. */
  lastMiss?: { query: string; at: number };
  /** Godot script errors the review did not predict, by message template. */
  missedByReview: Record<string, number>;
  /** Godot messages the log parser could not tie to a file, by template. */
  unparsed: Record<string, number>;
  /** Per lesson id: how often it was shown, and how often it helped or was wrong. */
  lessons: Record<string, LessonStats>;
  /** Lessons learned on this machine, scrubbed of names, paths and code. Local only: never sent. */
  localLessons: LocalLesson[];
  sharing: SharingState;
}

export interface SharingState {
  /** Opt-in: false until the user turns sharing on. */
  enabled: boolean;
  /** When the user turned sharing on or off. */
  decidedAt?: string;
  /** The one-time notice about sharing was shown. */
  noticeShown?: boolean;
  /** Random id, replaced every 30 days, so the collector can count distinct installs. */
  installId?: string;
  installIdSince?: string;
  /** When the collector last accepted a report. */
  lastSentAt?: string;
  /** When a send was last tried, accepted or not: a failed try also waits a day. */
  lastAttemptAt?: string;
  /** Counts already sent, so each report holds only what is new. */
  sent?: Snapshot;
  /** Where to send; overrides the built-in collector URL. */
  endpoint?: string;
}

/** The shareable counters, as sent last time. */
export interface Snapshot {
  rules: Record<string, RuleStats>;
  apiMisses: Record<string, ApiMiss>;
  missedByReview: Record<string, number>;
  unparsed: Record<string, number>;
  /** Counts per lesson that ships with Godotwright (never a local lesson). */
  lessons: Record<string, LessonStats>;
}

export function emptyLearning(): LearningData {
  return {
    version: 1,
    enabled: true,
    rules: {},
    dismissed: {},
    verified: {},
    apiMisses: {},
    missedByReview: {},
    unparsed: {},
    lessons: {},
    localLessons: [],
    sharing: { enabled: false },
  };
}

/** Directory for Godotwright's state: $GODOTWRIGHT_HOME, else the platform's usual place. */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["GODOTWRIGHT_HOME"]) return env["GODOTWRIGHT_HOME"];
  if (process.platform === "win32") return join(env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "godotwright");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "godotwright");
  return join(env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), "godotwright");
}

export function learningFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), "learning.json");
}

/** False when GODOTWRIGHT_LEARN=0 or local learning was switched off. */
export function learningAllowed(data: LearningData, env: NodeJS.ProcessEnv = process.env): boolean {
  return env["GODOTWRIGHT_LEARN"] !== "0" && data.enabled;
}

export function readLearning(file = learningFile()): LearningData {
  try {
    if (!existsSync(file)) return emptyLearning();
    return normalizeLearning(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    // A broken file must never break a tool; start fresh.
    return emptyLearning();
  }
}

/** Keeps each field only in the shape it has; anything else falls back to its default (a hand edit must not break a tool). */
function normalizeLearning(parsed: unknown): LearningData {
  const base = emptyLearning();
  const top = isRecord(parsed) ? parsed : {};
  return {
    version: 1,
    enabled: typeof top["enabled"] === "boolean" ? top["enabled"] : base.enabled,
    rules: recordOf(top["rules"], ruleFrom),
    dismissed: counts(top["dismissed"]),
    verified: counts(top["verified"]),
    apiMisses: recordOf(top["apiMisses"], missFrom),
    lastMiss: lastMissFrom(top["lastMiss"]),
    missedByReview: counts(top["missedByReview"]),
    unparsed: counts(top["unparsed"]),
    lessons: recordOf(top["lessons"], lessonStatsFrom),
    localLessons: localLessonsFrom(top["localLessons"]),
    sharing: sharingFrom(top["sharing"]),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function counts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const [k, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[k] = n;
  return out;
}

function recordOf<T>(v: unknown, item: (x: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) {
    const value = item(x);
    if (value !== undefined) out[k] = value;
  }
  return out;
}

function ruleFrom(v: unknown): RuleStats | undefined {
  if (!isRecord(v)) return undefined;
  const stats: RuleStats = { reported: count(v["reported"]), confirmed: count(v["confirmed"]), contradicted: count(v["contradicted"]), dismissed: count(v["dismissed"]) };
  if (v["verified"] !== undefined) stats.verified = count(v["verified"]);
  return stats;
}

export function lessonStatsFrom(v: unknown): LessonStats | undefined {
  return isRecord(v) ? { shown: count(v["shown"]), helped: count(v["helped"]), wrong: count(v["wrong"]) } : undefined;
}

function localLessonsFrom(v: unknown): LocalLesson[] {
  if (!Array.isArray(v)) return [];
  const out: LocalLesson[] = [];
  for (const item of v) {
    const lesson = lessonFrom(item);
    const added = isRecord(item) && typeof item["added"] === "string" ? item["added"] : undefined;
    const projects = isRecord(item) && Array.isArray(item["projects"]) ? item["projects"].filter((p): p is string => typeof p === "string" && /^[0-9a-f]{16}$/.test(p)).slice(0, 20) : [];
    if (lesson && lesson.id.startsWith("local/") && added) out.push({ ...lesson, added, ...(projects.length ? { projects } : {}) });
  }
  return out;
}

function missFrom(v: unknown): ApiMiss | undefined {
  return isRecord(v) ? { count: count(v["count"]), resolved: counts(v["resolved"]) } : undefined;
}

function lastMissFrom(v: unknown): LearningData["lastMiss"] {
  if (!isRecord(v) || typeof v["query"] !== "string" || typeof v["at"] !== "number") return undefined;
  return { query: v["query"], at: v["at"] };
}

function snapshotFrom(v: unknown): Snapshot | undefined {
  if (!isRecord(v)) return undefined;
  return {
    rules: recordOf(v["rules"], ruleFrom),
    apiMisses: recordOf(v["apiMisses"], missFrom),
    missedByReview: counts(v["missedByReview"]),
    unparsed: counts(v["unparsed"]),
    lessons: recordOf(v["lessons"], lessonStatsFrom),
  };
}

function sharingFrom(v: unknown): SharingState {
  const s = isRecord(v) ? v : {};
  const out: SharingState = { enabled: s["enabled"] === true };
  for (const key of ["decidedAt", "installId", "installIdSince", "lastSentAt", "lastAttemptAt", "endpoint"] as const) {
    const text = s[key];
    if (typeof text === "string") out[key] = text;
  }
  if (typeof s["noticeShown"] === "boolean") out.noticeShown = s["noticeShown"];
  const sent = snapshotFrom(s["sent"]);
  if (sent) out.sent = sent;
  return out;
}

/**
 * Reads, changes and writes the learning file. Writes go to a temp file first,
 * so a crash or a second process never leaves a half-written file.
 * Returns the data, and why the write failed when it did (read-only home, full disk, ...).
 */
export function saveLearning(change: (data: LearningData) => void, file = learningFile()): { data: LearningData; error?: string } {
  const data = readLearning(file);
  let tmp: string | undefined;
  try {
    change(data);
    mkdirSync(dirname(file), { recursive: true });
    tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, file);
    return { data };
  } catch (error) {
    try {
      if (tmp) rmSync(tmp, { force: true });
    } catch {
      // Nothing more to clean up.
    }
    return { data, error: error instanceof Error ? error.message : String(error) };
  }
}

/** saveLearning for tools: errors are swallowed, since learning is a side effect and must not break a tool. */
export function updateLearning(change: (data: LearningData) => void, file = learningFile()): LearningData {
  return saveLearning(change, file).data;
}

/** A stable hash of a local lesson as it is stored, so an undo can tell whether it changed since. */
export function lessonHash(lesson: LocalLesson): string {
  // Keys sorted: the same lesson read back from the file hashes the same.
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : isRecord(v) ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canonical(v[k])])) : v;
  return createHash("sha1").update(JSON.stringify(canonical(lesson))).digest("hex").slice(0, 16);
}

/**
 * What a journalled write changed in the learning file, so `godotwright undo` can put it back. Lessons are restored by
 * id, and only when they are still as the write left them (`after`, "" when the write removed it): a lesson rewritten
 * since is left alone. Fingerprints hold their value before the write (null: there was none).
 */
export interface LearningUndo {
  /** `at`: where a removed lesson stood, so it goes back to the same place. */
  lessons: { id: string; before?: LocalLesson; after: string; at?: number }[];
  dismissed?: Record<string, number | null>;
  verified?: Record<string, number | null>;
}

/** Puts back what a write changed in the learning data. Returns the lesson ids restored and those left alone. */
export function applyLearningUndo(data: LearningData, undo: LearningUndo, force = false): { restored: string[]; skipped: string[] } {
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const change of [...undo.lessons].reverse()) {
    const at = data.localLessons.findIndex((l) => l.id === change.id);
    const now = at >= 0 ? lessonHash(data.localLessons[at]!) : "";
    if (now !== change.after && !force) {
      skipped.push(change.id);
      continue;
    }
    if (change.before) {
      if (at >= 0) data.localLessons[at] = change.before;
      else data.localLessons.splice(Math.min(change.at ?? data.localLessons.length, data.localLessons.length), 0, change.before);
    } else if (at >= 0) data.localLessons.splice(at, 1);
    restored.push(change.id);
  }
  for (const [key, map] of [["dismissed", data.dismissed], ["verified", data.verified]] as const) {
    for (const [fingerprint, value] of Object.entries(undo[key] ?? {})) {
      if (value === null) delete map[fingerprint];
      else map[fingerprint] = value;
    }
  }
  return { restored, skipped };
}

export function resetLearning(file = learningFile()): void {
  rmSync(file, { force: true });
}

export function ruleStats(data: LearningData, rule: string): RuleStats {
  return (data.rules[rule] ??= { reported: 0, confirmed: 0, contradicted: 0, dismissed: 0 });
}

export function lessonStats(data: LearningData, id: string): LessonStats {
  return (data.lessons[id] ??= { shown: 0, helped: 0, wrong: 0 });
}
