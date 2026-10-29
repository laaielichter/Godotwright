import { randomUUID } from "node:crypto";
import { distance, GodotApi } from "../api/api.js";
import { RULES } from "../review/rules.js";
import { GODOT_TARGET, VERSION } from "../version.js";
import { learningFile, readLearning, saveLearning, updateLearning, type ApiMiss, type LearningData, type RuleStats, type Snapshot } from "./store.js";
import { shareableTemplate } from "./template.js";

/**
 * Opt-in sharing: anonymous counters, sent at most once a day, only after the
 * user turned sharing on. Reports hold rule ids, Godot API names, message
 * templates and counts. Never code, file names, paths or project names.
 */

/** The built-in collector. Empty until it runs: then nothing is sent. */
export const DEFAULT_ENDPOINT = "";
export const SEND_EVERY_MS = 24 * 60 * 60 * 1000;
export const ROTATE_ID_MS = 30 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;
const MAX_ENTRIES = 200;

export interface ShareReport {
  schema: 1;
  godotwright: string;
  godot: string;
  platform: "linux" | "macos" | "windows" | "other";
  /** Random, replaced every 30 days; lets the collector count distinct installs. */
  install: string;
  rules: Record<string, RuleStats>;
  apiMisses: Record<string, ApiMiss>;
  missedByReview: Record<string, number>;
  unparsed: Record<string, number>;
}

/** Where reports go: $GODOTWRIGHT_SHARE_URL, the configured endpoint, or the built-in one. */
export function shareEndpoint(data: LearningData, env: NodeJS.ProcessEnv = process.env): string {
  const url = env["GODOTWRIGHT_SHARE_URL"] ?? data.sharing.endpoint ?? DEFAULT_ENDPOINT;
  return validEndpoint(url) ? url : "";
}

/** https only, except http on this machine (for tests and a local collector). */
export function validEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
}

/** Why nothing would be sent now, or undefined when a report may go out. */
export function shareBlocked(data: LearningData, env: NodeJS.ProcessEnv = process.env, now = Date.now()): string | undefined {
  if (!data.sharing.enabled) return "sharing is off (godotwright learn share on turns it on)";
  if (env["GODOTWRIGHT_LEARN"] === "0" || !data.enabled) return "learning is off";
  if (env["DO_NOT_TRACK"] && env["DO_NOT_TRACK"] !== "0") return "DO_NOT_TRACK is set";
  if (!shareEndpoint(data, env)) return "no collector is set up yet, so nothing is sent";
  const last = Date.parse(data.sharing.lastAttemptAt ?? data.sharing.lastSentAt ?? "");
  if (now - last < SEND_EVERY_MS) return "a report was sent or tried less than a day ago";
  return undefined;
}

/** A query is shared only when it is a near-typo of a real Godot name, not a project's own name. */
export function shareableQuery(query: string, api: GodotApi): boolean {
  if (!/^@?[A-Za-z_][\w]{0,40}(\.[A-Za-z_][\w]{0,40})?$/.test(query)) return false;
  const dot = query.indexOf(".");
  const close = (name: string, candidates: string[]) => candidates.some((c) => distance(name.toLowerCase(), c.toLowerCase(), 2) <= 2);
  if (dot < 0) return close(query, api.closeClassNames(query));
  const cls = api.classes.get(query.slice(0, dot));
  if (!cls) return false;
  const member = query.slice(dot + 1);
  return close(member, api.closeMemberNames(cls.name, member));
}

/**
 * Replaces words that look like identifiers (snake_case, digits, camelCase)
 * with <id>, unless they are Godot class names.
 */
export function scrubTemplate(template: string, api: GodotApi): string {
  return template.replace(/<\w+>|[A-Za-z_@][\w@]*/g, (word) => {
    if (/^<\w+>$/.test(word) || api.classes.has(word)) return word;
    return /[_\d@]|[a-z][A-Z]|[A-Z]{2,}[a-z]/.test(word) ? "<id>" : word;
  });
}

/** The counters that may leave the machine, filtered for privacy. */
export function shareableSnapshot(data: LearningData, api: GodotApi): Snapshot {
  const rules: Record<string, RuleStats> = {};
  for (const [rule, stats] of Object.entries(data.rules)) if (RULES[rule]) rules[rule] = { ...stats };

  const apiMisses: Record<string, ApiMiss> = {};
  for (const [query, miss] of top(Object.entries(data.apiMisses), ([, m]) => m.count)) {
    if (!shareableQuery(query, api)) continue;
    const resolved = Object.fromEntries(Object.entries(miss.resolved).filter(([target]) => api.lookup(target).entries.length > 0));
    apiMisses[query] = { count: miss.count, resolved };
  }

  const templates = (source: Record<string, number>) => {
    const out: Record<string, number> = {};
    for (const [t, n] of Object.entries(source)) {
      const clean = scrubTemplate(t, api);
      if (shareableTemplate(clean)) out[clean] = (out[clean] ?? 0) + n;
    }
    return Object.fromEntries(top(Object.entries(out), ([, n]) => n));
  };

  return { rules, apiMisses, missedByReview: templates(data.missedByReview), unparsed: templates(data.unparsed) };
}

/** What is new since the last report; empty parts are left out. */
export function snapshotDelta(current: Snapshot, sent: Snapshot | undefined): Snapshot {
  const rules: Record<string, RuleStats> = {};
  for (const [rule, s] of Object.entries(current.rules)) {
    const before = sent?.rules[rule];
    const d: RuleStats = {
      reported: s.reported - (before?.reported ?? 0),
      confirmed: s.confirmed - (before?.confirmed ?? 0),
      contradicted: s.contradicted - (before?.contradicted ?? 0),
      dismissed: s.dismissed - (before?.dismissed ?? 0),
    };
    for (const k of Object.keys(d) as (keyof RuleStats)[]) d[k] = Math.max(0, d[k]);
    if (Object.values(d).some((v) => v > 0)) rules[rule] = d;
  }
  const apiMisses: Record<string, ApiMiss> = {};
  for (const [query, m] of Object.entries(current.apiMisses)) {
    const before = sent?.apiMisses[query];
    const count = Math.max(0, m.count - (before?.count ?? 0));
    const resolved = counterDelta(m.resolved, before?.resolved);
    if (count > 0 || Object.keys(resolved).length) apiMisses[query] = { count, resolved };
  }
  return {
    rules,
    apiMisses,
    missedByReview: counterDelta(current.missedByReview, sent?.missedByReview),
    unparsed: counterDelta(current.unparsed, sent?.unparsed),
  };
}

/** The report that would be sent next, or undefined when nothing is new. */
export function buildReport(data: LearningData, api: GodotApi, install = data.sharing.installId ?? "(new random id)"): { report: ShareReport; snapshot: Snapshot } | undefined {
  const snapshot = shareableSnapshot(data, api);
  const delta = snapshotDelta(snapshot, data.sharing.sent);
  if (Object.values(delta).every((part) => Object.keys(part).length === 0)) return undefined;
  const platform = process.platform === "linux" ? "linux" : process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "other";
  return { report: { schema: 1, godotwright: VERSION, godot: GODOT_TARGET, platform, install, ...delta }, snapshot };
}

export interface ShareOptions {
  env?: NodeJS.ProcessEnv;
  now?: number;
  fetch?: typeof fetch;
}

/**
 * Sends a report when sharing is on, a collector is set, and the last one went
 * out more than a day ago. Never throws and never waits more than a few seconds.
 */
export async function maybeShare(options: ShareOptions = {}): Promise<"sent" | "nothing new" | "failed" | "blocked"> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  try {
    const data = readLearning();
    if (shareBlocked(data, env, now)) return "blocked";
    const rotate = !data.sharing.installId || !data.sharing.installIdSince || now - Date.parse(data.sharing.installIdSince) > ROTATE_ID_MS;
    const install = rotate ? randomUUID() : data.sharing.installId!;
    const built = buildReport(data, GodotApi.load(), install);
    let outcome: "sent" | "nothing new" | "failed" = "nothing new";
    if (built) {
      const response = await (options.fetch ?? fetch)(shareEndpoint(data, env), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.report),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => undefined);
      outcome = response?.ok ? "sent" : "failed";
    }
    updateLearning((d) => {
      d.sharing.lastAttemptAt = new Date(now).toISOString();
      if (outcome !== "sent") return;
      d.sharing.lastSentAt = d.sharing.lastAttemptAt;
      d.sharing.sent = built!.snapshot;
      if (rotate) {
        d.sharing.installId = install;
        d.sharing.installIdSince = new Date(now).toISOString();
      }
    });
    return outcome;
  } catch {
    return "failed";
  }
}

export const SHARE_NOTICE = [
  "Godotwright learns from your use on this machine, to make reviews better.",
  "You can help every user: `godotwright learn share on` sends anonymous counts once a day",
  "(which rules Godot confirmed, API names that were mistyped; no code, names or paths).",
  "`godotwright learn preview` shows exactly what would be sent. This note is shown once.",
].join("\n");

/** The one-time note about sharing, for an interactive terminal; undefined once shown or decided. */
export function takeShareNotice(env: NodeJS.ProcessEnv = process.env, interactive = Boolean(process.stderr.isTTY)): string | undefined {
  if (!interactive || env["CI"] || env["GODOTWRIGHT_LEARN"] === "0" || (env["DO_NOT_TRACK"] && env["DO_NOT_TRACK"] !== "0")) return undefined;
  const data = readLearning();
  if (!data.enabled || data.sharing.decidedAt || data.sharing.noticeShown) return undefined;
  updateLearning((d) => (d.sharing.noticeShown = true));
  return SHARE_NOTICE;
}

/** Turns sharing on or off. Off also forgets the install id. */
export function setSharing(enabled: boolean, now = Date.now()): LearningData {
  const { data, error } = saveLearning((d) => {
    d.sharing.enabled = enabled;
    d.sharing.decidedAt = new Date(now).toISOString();
    if (!enabled) {
      delete d.sharing.installId;
      delete d.sharing.installIdSince;
    }
  });
  if (error) throw new Error(`sharing not saved (${learningFile()}): ${error}`);
  return data;
}

function counterDelta(current: Record<string, number>, before: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(current)) {
    const d = n - (before?.[k] ?? 0);
    if (d > 0) out[k] = d;
  }
  return out;
}

function top<T>(entries: T[], weight: (e: T) => number): T[] {
  return [...entries].sort((a, b) => weight(b) - weight(a)).slice(0, MAX_ENTRIES);
}
