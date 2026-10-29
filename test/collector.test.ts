import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { aggregate, createCollector, readReports, safeTemplate, validateReport } from "../src/collector/collector.js";
import { learnFromProjects } from "../src/collector/public.js";
import { bundledLearning } from "../src/learn/bundled.js";
import { adjustFindings, learnedHints, recordApiLookup, SHARED_DOWNGRADE_AFTER } from "../src/learn/learn.js";
import { buildReport, maybeShare, setSharing, type ShareReport } from "../src/learn/share.js";
import { emptyLearning, readLearning, resetLearning } from "../src/learn/store.js";
import type { Finding } from "../src/review/rules.js";
import { DEMO, FIXTURES, runCli } from "./helpers.js";

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
    recordApiLookup("Node2D.look_at", true);
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
  // Each test gets its own report folder and server, so the order of tests does not matter.
  let dir = "";
  let server: ReturnType<typeof createCollector>;
  let url = "";
  beforeEach(async () => {
    resetLearning();
    dir = mkdtempSync(join(tmpdir(), "godotwright-reports-"));
    server = createCollector({ dir, now: () => new Date("2026-11-01T10:00:00Z") });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise((done) => server.close(done)));

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
    recordApiLookup("Node2D.look_at", true);
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

  it("ships a valid data/learned.json", () => {
    const shipped = bundledLearning();
    expect(shipped.version).toBe(1);
    expect(Object.keys(shipped).sort()).toEqual(["apiHints", "installs", "missedByReview", "rules", "version"]);
    for (const [rule, s] of Object.entries(shipped.rules)) expect(Object.keys(s).sort(), rule).toEqual(["confirmed", "contradicted", "dismissed", "installs", "reported"]);
    for (const t of Object.keys(shipped.missedByReview)) expect(safeTemplate(t), t).toBe(true);
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

describe("learning from public projects", () => {
  it("reviews and checks each project as its own install, and leaves no state behind", async () => {
    const home = process.env["GODOTWRIGHT_HOME"];
    const seen: string[] = [];
    // Fake Godot: on the second project (messy) it reports the Godot 3 `yield()` error, nothing else.
    const check = async (path: string) => {
      seen.push(path);
      const diagnostics = seen.length === 2 ? [{ severity: "error" as const, file: "res://scripts/old_player.gd", line: 11, message: 'Parse Error: Function "yield" not found.', source: "script" }] : [];
      return { godot: "godot", godotVersion: "4.7", scripts: 1, scenes: 0, diagnostics, steps: [{ name: "check", ms: 1, exitCode: 0, timedOut: false }], errors: diagnostics.length, warnings: 0 };
    };
    const logs: string[] = [];
    const learned = await learnFromProjects([DEMO, `${FIXTURES}/messy`, "/no/such/dir"], { check, log: (l) => logs.push(l) });
    expect(learned.installs).toBe(2);
    expect(learned.rules["api/godot3-syntax"]).toMatchObject({ installs: 1 });
    expect(learned.rules["api/godot3-syntax"]!.confirmed).toBeGreaterThan(0);
    expect(learned.rules["api/unknown-member"]?.contradicted).toBeGreaterThan(0);
    expect(logs.some((l) => l.startsWith("skip /no/such/dir"))).toBe(true);
    expect(seen.every((p) => !p.startsWith(FIXTURES))).toBe(true);
    expect(process.env["GODOTWRIGHT_HOME"]).toBe(home);
  });
});
