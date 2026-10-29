import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { GodotApi } from "../api/api.js";
import { RULES } from "../review/rules.js";
import { scrubTemplate, shareableQuery, typoOf, type ShareReport } from "../learn/share.js";
import type { RuleStats } from "../learn/store.js";
import { shareableTemplate } from "../learn/template.js";

/**
 * Reference collector for opt-in reports. It checks each report again (the
 * client may be old or modified), stores it without IP address or headers,
 * and aggregates only what at least K_ANONYMITY installs reported.
 */

export const K_ANONYMITY = 3;
const MAX_BODY = 64 * 1024;
const MAX_ENTRIES = 200;
const RULE = /^[a-z]+\/[a-z0-9-]+$/;
const API_NAME = /^@?[A-Za-z_]\w{0,40}(\.[A-Za-z_]\w{0,40}){0,2}$/;
const COUNT = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100_000;

/** A report that passed all checks, or undefined. */
export function validateReport(value: unknown): ShareReport | undefined {
  if (!isObject(value)) return undefined;
  const keys = ["schema", "godotwright", "godot", "platform", "install", "rules", "apiMisses", "missedByReview", "unparsed"];
  if (Object.keys(value).some((k) => !keys.includes(k))) return undefined;
  const r = value as Record<string, unknown>;
  if (r["schema"] !== 1) return undefined;
  if (typeof r["godotwright"] !== "string" || !/^\d+\.\d+\.\d+[\w.-]*$/.test(r["godotwright"])) return undefined;
  if (typeof r["godot"] !== "string" || !/^\d+\.\d+$/.test(r["godot"])) return undefined;
  if (!["linux", "macos", "windows", "other"].includes(r["platform"] as string)) return undefined;
  if (typeof r["install"] !== "string" || !/^[0-9a-f-]{36}$/.test(r["install"])) return undefined;

  const api = GodotApi.load();
  const rules = entries(r["rules"]);
  if (!rules || !rules.every(([k, s]) => RULE.test(k) && Object.hasOwn(RULES, k) && isObject(s) && ["reported", "confirmed", "contradicted", "dismissed"].every((f) => COUNT((s as Record<string, unknown>)[f])) && Object.keys(s).length === 4)) return undefined;
  const misses = entries(r["apiMisses"]);
  if (
    !misses ||
    !misses.every(([q, m]) => {
      // The same test as the client applies (shareableQuery): a Godot class and member, never a bare name.
      if (!shareableQuery(q, api) || !isObject(m) || !COUNT(m["count"]) || Object.keys(m).length !== 2) return false;
      const resolved = entries(m["resolved"]);
      return !!resolved && resolved.every(([t, n]) => API_NAME.test(t) && COUNT(n) && typoOf(q, t) && api.lookup(t).entries.length > 0);
    })
  )
    return undefined;
  for (const part of ["missedByReview", "unparsed"]) {
    const list = entries(r[part]);
    if (!list || !list.every(([t, n]) => safeTemplate(t, api) && COUNT(n))) return undefined;
  }
  return value as unknown as ShareReport;
}

/** Templates must pass the client's check (shareableTemplate) and hold no name of a project: only Godot's wording survives scrubTemplate. */
export function safeTemplate(t: string, api: GodotApi = GodotApi.load()): boolean {
  return t.length <= 160 && shareableTemplate(t) && scrubTemplate(t, api) === t;
}

export interface CollectorOptions {
  /** Directory for the daily report files. */
  dir: string;
  now?: () => Date;
}

/** POST /v1/report stores a valid report; everything else is 404. */
export function createCollector(options: CollectorOptions): Server {
  mkdirSync(options.dir, { recursive: true });
  return createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/report") {
      res.writeHead(404).end();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.headersSent) return;
      let report: ShareReport | undefined;
      try {
        report = validateReport(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        report = undefined;
      }
      if (!report) {
        res.writeHead(400).end();
        return;
      }
      const day = (options.now?.() ?? new Date()).toISOString().slice(0, 10);
      // Only the report itself: no IP address, no headers, no exact time.
      appendFileSync(join(options.dir, `reports-${day}.ndjson`), `${JSON.stringify({ day, ...report })}\n`);
      res.writeHead(204).end();
    });
  });
}

/** What ships with Godotwright: data/learned.json. */
export interface LearnedData {
  version: 1;
  installs: number;
  /** Per failed lookup: the real names looked up next, by number of installs. */
  apiHints: Record<string, Record<string, number>>;
  /** Rule counts summed over installs, for rules at least K installs reported. */
  rules: Record<string, RuleStats & { installs: number }>;
  /** Godot errors the review missed, by number of installs. */
  missedByReview: Record<string, number>;
}

/** Reads every stored report in a directory. Broken lines are skipped. */
export function readReports(dir: string): ShareReport[] {
  const out: ShareReport[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ndjson")).sort()) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const { day: _day, ...rest } = JSON.parse(line) as Record<string, unknown>;
        const report = validateReport(rest);
        if (report) out.push(report);
      } catch {
        // skip
      }
    }
  }
  return out;
}

/** Sums reports, keeping only what at least `k` distinct installs reported. */
export function aggregate(reports: ShareReport[], k = K_ANONYMITY): LearnedData {
  const installs = new Set(reports.map((r) => r.install));
  const ruleSum = new Map<string, RuleStats & { ids: Set<string> }>();
  const hints = new Map<string, Map<string, Set<string>>>();
  const missed = new Map<string, Set<string>>();

  for (const r of reports) {
    for (const [rule, s] of Object.entries(r.rules)) {
      const sum = ruleSum.get(rule) ?? { reported: 0, confirmed: 0, contradicted: 0, dismissed: 0, ids: new Set<string>() };
      sum.reported += s.reported;
      sum.confirmed += s.confirmed;
      sum.contradicted += s.contradicted;
      sum.dismissed += s.dismissed;
      sum.ids.add(r.install);
      ruleSum.set(rule, sum);
    }
    for (const [query, miss] of Object.entries(r.apiMisses)) {
      for (const target of Object.keys(miss.resolved)) {
        const byTarget = hints.get(query) ?? new Map<string, Set<string>>();
        byTarget.set(target, (byTarget.get(target) ?? new Set()).add(r.install));
        hints.set(query, byTarget);
      }
    }
    for (const t of Object.keys(r.missedByReview)) missed.set(t, (missed.get(t) ?? new Set()).add(r.install));
  }

  const rules: LearnedData["rules"] = {};
  for (const [rule, { ids, ...s }] of [...ruleSum].sort(([a], [b]) => a.localeCompare(b))) if (ids.size >= k) rules[rule] = { ...s, installs: ids.size };
  const apiHints: LearnedData["apiHints"] = {};
  for (const [query, byTarget] of [...hints].sort(([a], [b]) => a.localeCompare(b))) {
    const kept = [...byTarget].filter(([, ids]) => ids.size >= k).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
    if (kept.length) apiHints[query] = Object.fromEntries(kept.slice(0, 3).map(([t, ids]) => [t, ids.size]));
  }
  const missedByReview = Object.fromEntries(
    [...missed]
      .filter(([, ids]) => ids.size >= k)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, MAX_ENTRIES)
      .map(([t, ids]) => [t, ids.size]),
  );
  return { version: 1, installs: installs.size, apiHints, rules, missedByReview };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function entries(v: unknown): [string, Record<string, unknown> | number][] | undefined {
  if (!isObject(v)) return undefined;
  const list = Object.entries(v) as [string, Record<string, unknown> | number][];
  return list.length <= MAX_ENTRIES ? list : undefined;
}
