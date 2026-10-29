import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
  /** Fingerprints of findings marked as wrong. Local only. */
  dismissed: Record<string, number>;
  /** API lookups that found nothing, by query. */
  apiMisses: Record<string, ApiMiss>;
  /** The last miss, so the next successful lookup can resolve it. */
  lastMiss?: { query: string; at: number };
  /** Godot script errors the review did not predict, by message template. */
  missedByReview: Record<string, number>;
  /** Godot messages the log parser could not tie to a file, by template. */
  unparsed: Record<string, number>;
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
}

export function emptyLearning(): LearningData {
  return {
    version: 1,
    enabled: true,
    rules: {},
    dismissed: {},
    apiMisses: {},
    missedByReview: {},
    unparsed: {},
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
    apiMisses: recordOf(top["apiMisses"], missFrom),
    lastMiss: lastMissFrom(top["lastMiss"]),
    missedByReview: counts(top["missedByReview"]),
    unparsed: counts(top["unparsed"]),
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
  return stats;
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
  return { rules: recordOf(v["rules"], ruleFrom), apiMisses: recordOf(v["apiMisses"], missFrom), missedByReview: counts(v["missedByReview"]), unparsed: counts(v["unparsed"]) };
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

export function resetLearning(file = learningFile()): void {
  rmSync(file, { force: true });
}

export function ruleStats(data: LearningData, rule: string): RuleStats {
  return (data.rules[rule] ??= { reported: 0, confirmed: 0, contradicted: 0, dismissed: 0 });
}
