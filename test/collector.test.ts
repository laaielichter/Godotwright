import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { aggregate, createCollector, readReports, safeTemplate, validateReport } from "../src/collector/collector.js";
import { bundledLearning } from "../src/learn/bundled.js";
import { adjustFindings, learnedHints, recordApiLookup, SHARED_DOWNGRADE_AFTER } from "../src/learn/learn.js";
import { buildReport, maybeShare, setSharing, type ShareReport } from "../src/learn/share.js";
import { emptyLearning, readLearning, resetLearning } from "../src/learn/store.js";
import type { Finding } from "../src/review/rules.js";
import { runCli } from "./helpers.js";

const api = GodotApi.load();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function report(install: number, over: Partial<ShareReport> = {}): ShareReport {
  return {
    schema: 1,
    godotwright: "0.1.0",
    godot: "4.7",
    platform: "linux",
    install: id(install),
    rules: { "api/unknown-member": { reported: 2, confirmed: 0, contradicted: 1, dismissed: 0 } },
    apiMisses: { "Node2D.lookat": { count: 1, resolved: { "Node2D.look_at": 1 } } },
    missedByReview: { 'Identifier "<s>" not declared in the current scope.': 1 },
    unparsed: {},
    ...over,
  };
}

describe("checking reports again on the collector", () => {
  it("accepts what the client builds", () => {
    resetLearning();
    recordApiLookup("Node2D.lookat", false);
    const built = buildReport(readLearning(), api, id(1))!;
    expect(validateReport(JSON.parse(JSON.stringify(built.report)))).toBeDefined();
    expect(validateReport(report(1))).toBeDefined();
  });

  it("rejects anything that could carry project details", () => {
    const bad: unknown[] = [
      { ...report(1), project: "My Game" },
      report(1, { install: "roel@example.com" }),
      report(1, { missedByReview: { "Cannot open /home/roel/game/a.gd now": 1 } }),
      report(1, { missedByReview: { "Function secret_vault not found": 1 } }),
      report(1, { apiMisses: { "res://player.gd": { count: 1, resolved: {} } } }),
      report(1, { apiMisses: { "Node2D.lookat": { count: 1, resolved: { "a b": 1 } } } }),
      report(1, { rules: { "My Rule": { reported: 1, confirmed: 0, contradicted: 0, dismissed: 0 } } }),
      report(1, { rules: { "api/unknown-member": { reported: -1, confirmed: 0, contradicted: 0, dismissed: 0 } } }),
      { ...report(1), schema: 2 },
      "text",
      null,
    ];
    for (const b of bad) expect(validateReport(b), JSON.stringify(b)).toBeUndefined();
    expect(safeTemplate('Identifier "<s>" not declared at <path>')).toBe(true);
  });
});

describe("collector server", () => {
  const dir = mkdtempSync(join(tmpdir(), "godotwright-reports-"));
  const server = createCollector({ dir, now: () => new Date("2026-11-01T10:00:00Z") });
  let url = "";
  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((done) => server.close(done)));
  beforeEach(() => resetLearning());

  const post = (body: string, path = "/v1/report") => fetch(`${url}${path}`, { method: "POST", body, headers: { "x-forwarded-for": "203.0.113.9" } });

  it("stores valid reports without IP address or headers", async () => {
    expect((await post(JSON.stringify(report(1)))).status).toBe(204);
    expect((await post("{ nope")).status).toBe(400);
    expect((await post(JSON.stringify({ ...report(1), extra: 1 }))).status).toBe(400);
    expect((await post("x".repeat(70_000))).status).toBe(413);
    expect((await post("{}", "/other")).status).toBe(404);
    expect(readdirSync(dir)).toEqual(["reports-2026-11-01.ndjson"]);
    const stored = readFileSync(join(dir, "reports-2026-11-01.ndjson"), "utf8");
    expect(stored.trim().split("\n")).toHaveLength(1);
    expect(stored).not.toContain("203.0.113.9");
    expect(stored).not.toContain("127.0.0.1");
    expect(stored).not.toContain("T10:00");
  });

  it("receives what a client with sharing on sends", async () => {
    setSharing(true);
    recordApiLookup("Node2D.lookat", false);
    expect(await maybeShare({ env: { GODOTWRIGHT_SHARE_URL: `${url}/v1/report` } })).toBe("sent");
    expect(readReports(dir).some((r) => r.install === readLearning().sharing.installId)).toBe(true);
  });
});

describe("aggregating", () => {
  it(`keeps only what at least 3 installs reported`, () => {
    const two = aggregate([report(1), report(2), report(2)]);
    expect(two.installs).toBe(2);
    expect(two.apiHints).toEqual({});
    expect(two.rules).toEqual({});
    expect(two.missedByReview).toEqual({});

    const odd = report(4, { apiMisses: { "Node.get_nod": { count: 1, resolved: { "Node.get_node": 1 } } } });
    const three = aggregate([report(1), report(2), report(3), odd]);
    expect(three.installs).toBe(4);
    expect(three.apiHints).toEqual({ "Node2D.lookat": { "Node2D.look_at": 3 } });
    expect(three.rules["api/unknown-member"]).toEqual({ reported: 8, confirmed: 0, contradicted: 4, dismissed: 0, installs: 4 });
    expect(three.missedByReview).toEqual({ 'Identifier "<s>" not declared in the current scope.': 4 });
  });

  it("is used by every install once shipped", () => {
    const shared = aggregate([1, 2, 3].map((n) => report(n)));
    expect(learnedHints("Node2D.lookat", api, emptyLearning(), shared.apiHints)).toEqual(["Node2D.look_at"]);

    const f: Finding = { rule: "api/unknown-member", category: "api", severity: "error", file: "res://a.gd", line: 1, message: "m" };
    expect(adjustFindings([f], emptyLearning(), shared).findings[0]!.severity).toBe("error");
    const noisy = aggregate([1, 2, 3].map((n) => report(n, { rules: { "api/unknown-member": { reported: 9, confirmed: 0, contradicted: SHARED_DOWNGRADE_AFTER, dismissed: 0 } } })));
    expect(adjustFindings([f], emptyLearning(), noisy).findings[0]!.severity).toBe("warning");
    // One confirmation on this machine keeps it an error.
    const local = emptyLearning();
    local.rules["api/unknown-member"] = { reported: 1, confirmed: 1, contradicted: 0, dismissed: 0 };
    expect(adjustFindings([f], local, noisy).findings[0]!.severity).toBe("error");
  });

  it("ships an empty, valid data/learned.json until there is data", () => {
    expect(bundledLearning()).toEqual({ version: 1, installs: 0, apiHints: {}, rules: {}, missedByReview: {} });
  });

  it("writes the result with the CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "godotwright-reports-"));
    const server = createCollector({ dir });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/report`;
    for (const n of [1, 2, 3]) await fetch(url, { method: "POST", body: JSON.stringify(report(n)) });
    await new Promise((done) => server.close(done));
    const { output } = await runCli(["collector", "aggregate", dir]);
    expect(JSON.parse(output).apiHints).toEqual({ "Node2D.lookat": { "Node2D.look_at": 3 } });
    const low = await runCli(["collector", "aggregate", dir, "--min-installs", "1"]);
    expect(JSON.parse(low.output).installs).toBe(3);
    expect(JSON.parse(low.output).apiHints).toEqual({ "Node2D.lookat": { "Node2D.look_at": 3 } });
  });
});
