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
  lastSentAt?: string;
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
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LearningData>;
    const base = emptyLearning();
    return { ...base, ...parsed, sharing: { ...base.sharing, ...(parsed.sharing ?? {}) } } as LearningData;
  } catch {
    // A broken file must never break a tool; start fresh.
    return emptyLearning();
  }
}

/**
 * Reads, changes and writes the learning file. Writes go to a temp file first,
 * so a crash or a second process never leaves a half-written file.
 * Errors are swallowed: learning is a side effect and must not break tools.
 */
export function updateLearning(change: (data: LearningData) => void, file = learningFile()): LearningData {
  const data = readLearning(file);
  try {
    change(data);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, file);
  } catch {
    // Read-only home, full disk, ...: carry on without learning.
  }
  return data;
}

export function resetLearning(file = learningFile()): void {
  rmSync(file, { force: true });
}

export function ruleStats(data: LearningData, rule: string): RuleStats {
  return (data.rules[rule] ??= { reported: 0, confirmed: 0, contradicted: 0, dismissed: 0 });
}
