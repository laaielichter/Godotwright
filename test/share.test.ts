import { beforeEach, describe, expect, it, vi } from "vitest";
import { GodotApi } from "../src/api/api.js";
import type { CheckResult } from "../src/check/check.js";
import { lookupLearning, reviewLearning } from "../src/learn/hooks.js";
import { recordApiLookup, recordCheck, recordFeedback } from "../src/learn/learn.js";
import {
  buildReport,
  maybeShare,
  ROTATE_ID_MS,
  scrubTemplate,
  SEND_EVERY_MS,
  setSharing,
  shareableQuery,
  shareBlocked,
  shareEndpoint,
  takeShareNotice,
  validEndpoint,
} from "../src/learn/share.js";
import { readLearning, resetLearning, updateLearning } from "../src/learn/store.js";
import { makeProject, runCli } from "./helpers.js";

// Same as learn.test.ts: the shipped data/learned.json must not change these results.
vi.mock("../src/learn/bundled.js", () => ({
  bundledLearning: () => ({ version: 1, installs: 0, apiHints: {}, rules: {}, missedByReview: {} }),
}));

const api = GodotApi.load();
const URL = "https://collector.example/v1/report";
const env = { GODOTWRIGHT_SHARE_URL: URL };

/** A fake collector that records what it got. */
function collector(ok = true) {
  const bodies: unknown[] = [];
  const fake = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: ok ? 204 : 500 });
  });
  return { fetch: fake as unknown as typeof fetch, bodies, calls: fake };
}

function godotClean(): CheckResult {
  return { godot: "godot", godotVersion: "4.7", scripts: 1, scenes: 0, diagnostics: [], steps: [{ name: "check", ms: 1, exitCode: 0, timedOut: false }], errors: 0, warnings: 0 };
}

/** Learning data from a project full of names that must never leave the machine. */
function learnFromSecretProject(): string {
  const root = makeProject({
    "project.godot": '[application]\nconfig/name="Top Secret Heist"\nconfig/features=PackedStringArray("4.7")\n',
    "secret_vault.gd": "extends Node\nclass_name SecretVault\n\n\nfunc _ready() -> void:\n\tvar vault_codes: Array = []\n\tprint(vault_codes.empty())\n\tunlockVault(vault_codes)\n",
  });
  const report = reviewLearning(root);
  recordCheck(
    {
      ...godotClean(),
      diagnostics: [
        { severity: "error", file: "res://heist_planner.gd", line: 4, message: `Identifier "vault_codes" not declared. In ${root}/heist_planner.gd`, source: "script" },
        { severity: "error", file: "res://heist_planner.gd", line: 9, message: "Function unlockVault not found in base SecretVault", source: "script" },
        { severity: "error", message: "Cannot open C:\\Users\\roel\\Heist Game\\x.pck for reading", source: "import" },
      ],
    },
    report,
  );
  recordFeedback(report.findings[0]!, "wrong");
  lookupLearning(api, "Node2D.lookat");
  lookupLearning(api, "Node2D.look_at");
  lookupLearning(api, "SecretVault.unlockVault");
  lookupLearning(api, "heist_planner");
  lookupLearning(api, "Node.vault_codes");
  return root;
}

beforeEach(() => resetLearning());

describe("what may be shared", () => {
  it("keeps Godot names that were mistyped, not the project's own names", () => {
    expect(shareableQuery("Node2D.lookat", api)).toBe(true);
    expect(shareableQuery("CharacterBody2D.is_on_flor", api)).toBe(true);
    expect(shareableQuery("Charactrbody2D", api)).toBe(true);
    expect(shareableQuery("SecretVault.unlock", api)).toBe(false);
    expect(shareableQuery("Node.vault_codes", api)).toBe(false);
    expect(shareableQuery("heist_planner", api)).toBe(false);
    expect(shareableQuery("MySecretNode2D", api)).toBe(false);
    expect(shareableQuery("res://x.gd", api)).toBe(false);
  });

  it("scrubs identifiers from templates but keeps Godot class names", () => {
    expect(scrubTemplate("Function unlockVault not found in base SecretVault", api)).toBe("Function <id> not found in base <id>");
    expect(scrubTemplate('Identifier "<s>" not declared in Node2D at <path>', api)).toBe('Identifier "<s>" not declared in Node2D at <path>');
    expect(scrubTemplate("call is_on_floor or vault_7 or HTTPRequest", api)).toBe("call <id> or <id> or HTTPRequest");
  });

  it("only accepts https collectors, or http on this machine", () => {
    expect(validEndpoint(URL)).toBe(true);
    expect(validEndpoint("http://localhost:8080/report")).toBe(true);
    expect(validEndpoint("http://collector.example/report")).toBe(false);
    expect(validEndpoint("not a url")).toBe(false);
    expect(shareEndpoint(readLearning(), { GODOTWRIGHT_SHARE_URL: "http://evil.example" })).toBe("");
  });
});

describe("the report", () => {
  it("holds nothing from the project: no code, names or paths", () => {
    const root = learnFromSecretProject();
    const built = buildReport(readLearning(), api, "install-id");
    expect(built).toBeDefined();
    const json = JSON.stringify(built!.report);
    for (const secret of ["ecret", "eist", "ault", "Vault", "roel", root, "res://", ".gd", "C:", "\\\\", "/tmp"]) expect(json, secret).not.toContain(secret);
    expect(json).not.toContain("dismissed\":{\"");
  });

  it("holds what helps: rule counts, Godot API misses and templates", () => {
    learnFromSecretProject();
    const { report } = buildReport(readLearning(), api, "install-id")!;
    expect(report).toMatchObject({ schema: 1, godot: "4.7", install: "install-id" });
    expect(Object.keys(report)).toEqual(["schema", "godotwright", "godot", "platform", "install", "rules", "apiMisses", "missedByReview", "unparsed"]);
    expect(report.rules["api/unknown-member"]).toMatchObject({ reported: 1, contradicted: 1 });
    expect(report.apiMisses).toEqual({ "Node2D.lookat": { count: 1, resolved: { "Node2D.look_at": 1 } } });
    expect(report.missedByReview).toEqual({ 'Identifier "<s>" not declared. In <path>': 1, "Function <id> not found in base <id>": 1 });
    expect(report.unparsed).toEqual({ "Cannot open <path>": 1 });
  });

  it("never shares a verdict of right as a Godot confirmation", () => {
    recordFeedback({ rule: "api/unknown-member", file: "res://a.gd", message: "m" }, "right");
    expect(readLearning().rules["api/unknown-member"]).toMatchObject({ verified: 1, confirmed: 0 });
    expect(buildReport(readLearning(), api, "id")).toBeUndefined();
  });

  it("only sends what is new since the last report", () => {
    recordApiLookup("Node2D.lookat", false);
    const first = buildReport(readLearning(), api, "id")!;
    updateLearning((d) => (d.sharing.sent = first.snapshot));
    expect(buildReport(readLearning(), api, "id")).toBeUndefined();
    recordApiLookup("Node2D.lookat", false);
    expect(buildReport(readLearning(), api, "id")!.report.apiMisses).toEqual({ "Node2D.lookat": { count: 1, resolved: {} } });
  });
});

describe("sending", () => {
  beforeEach(() => recordApiLookup("Node2D.lookat", false));

  it("sends nothing while sharing is off (the default)", async () => {
    const c = collector();
    expect(await maybeShare({ env, fetch: c.fetch })).toBe("blocked");
    expect(c.calls).not.toHaveBeenCalled();
    expect(shareBlocked(readLearning(), env)).toContain("sharing is off");
  });

  it("sends nothing without a collector, or with DO_NOT_TRACK", async () => {
    setSharing(true);
    const c = collector();
    expect(await maybeShare({ env: {}, fetch: c.fetch })).toBe("blocked");
    expect(await maybeShare({ env: { ...env, DO_NOT_TRACK: "1" }, fetch: c.fetch })).toBe("blocked");
    expect(await maybeShare({ env: { ...env, GODOTWRIGHT_LEARN: "0" }, fetch: c.fetch })).toBe("blocked");
    expect(c.calls).not.toHaveBeenCalled();
  });

  it("sends the preview, at most once a day, after a yes", async () => {
    setSharing(true);
    const c = collector();
    const now = Date.parse("2026-11-01T12:00:00Z");
    const preview = buildReport(readLearning(), api)!.report;
    expect(await maybeShare({ env, fetch: c.fetch, now })).toBe("sent");
    expect(c.calls).toHaveBeenCalledTimes(1);
    expect(c.calls.mock.calls[0]![0]).toBe(URL);
    const sent = c.bodies[0] as typeof preview;
    expect({ ...sent, install: "x" }).toEqual({ ...preview, install: "x" });

    recordApiLookup("Node2D.lookat", false);
    expect(await maybeShare({ env, fetch: c.fetch, now: now + 60_000 })).toBe("blocked");
    expect(await maybeShare({ env, fetch: c.fetch, now: now + SEND_EVERY_MS })).toBe("sent");
    expect((c.bodies[1] as typeof preview).apiMisses).toEqual({ "Node2D.lookat": { count: 1, resolved: {} } });
    expect((c.bodies[1] as typeof preview).install).toBe(sent.install);
  });

  it("shows a last report only once the collector accepted one, but still waits a day after a failure", async () => {
    setSharing(true);
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(await maybeShare({ env, fetch: collector(false).fetch, now })).toBe("failed");
    expect(readLearning().sharing.lastSentAt).toBeUndefined();
    expect((await runCli(["learn", "status"])).output).toContain("last report sent: never");
    expect(shareBlocked(readLearning(), env, now + 60_000)).toContain("less than a day");
    const c = collector();
    expect(await maybeShare({ env, fetch: c.fetch, now: now + SEND_EVERY_MS })).toBe("sent");
    expect(readLearning().sharing.lastSentAt).toBe(new Date(now + SEND_EVERY_MS).toISOString());
    expect((await runCli(["learn", "status"])).output).toContain(`last report sent: ${new Date(now + SEND_EVERY_MS).toISOString()}`);
  });

  it("uses a new random install id every 30 days, and forgets it when sharing is turned off", async () => {
    setSharing(true);
    const c = collector();
    const now = Date.parse("2026-11-01T12:00:00Z");
    await maybeShare({ env, fetch: c.fetch, now });
    const first = readLearning().sharing.installId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    recordApiLookup("Node2D.lookat", false);
    await maybeShare({ env, fetch: c.fetch, now: now + ROTATE_ID_MS + 1 });
    expect(readLearning().sharing.installId).not.toBe(first);
    setSharing(false);
    expect(readLearning().sharing.installId).toBeUndefined();
  });

  it("keeps the counts for later when the collector fails, and never throws", async () => {
    setSharing(true);
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(await maybeShare({ env, fetch: collector(false).fetch, now })).toBe("failed");
    const broken = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await maybeShare({ env, fetch: broken, now: now + SEND_EVERY_MS })).toBe("failed");
    expect(readLearning().sharing.sent).toBeUndefined();
    const c = collector();
    expect(await maybeShare({ env, fetch: c.fetch, now: now + 2 * SEND_EVERY_MS })).toBe("sent");
    expect((c.bodies[0] as { apiMisses: unknown }).apiMisses).toEqual({ "Node2D.lookat": { count: 1, resolved: {} } });
  });
});

describe("asking once", () => {
  it("shows the note once in a terminal, never in CI or after a choice", () => {
    expect(takeShareNotice({}, false)).toBeUndefined();
    expect(takeShareNotice({ CI: "true" }, true)).toBeUndefined();
    expect(takeShareNotice({}, true)).toContain("godotwright learn share on");
    expect(takeShareNotice({}, true)).toBeUndefined();
    resetLearning();
    setSharing(false);
    expect(takeShareNotice({}, true)).toBeUndefined();
  });
});

describe("learn share and preview", () => {
  it("turns sharing on and off, and previews the report", async () => {
    recordApiLookup("Node2D.lookat", false);
    const preview = await runCli(["learn", "preview"]);
    expect(preview.output).toContain("not sent now: sharing is off");
    expect(preview.output).toContain('"Node2D.lookat"');

    const on = await runCli(["learn", "share", "on"]);
    expect(on.output).toContain("sharing is on");
    expect(on.output).toContain("Never code, file names, paths or project names");
    expect(readLearning().sharing.enabled).toBe(true);
    expect((await runCli(["learn"])).output).toContain("sharing: on");

    expect((await runCli(["learn", "share", "off"])).output).toContain("sharing is off");
    expect(readLearning().sharing.enabled).toBe(false);
    await expect(runCli(["learn", "share", "maybe"])).rejects.toThrow("on or off");
  });

  it("sends nothing from normal commands while sharing is off", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await runCli(["api", "Node2D.lookat"]);
    await runCli(["review", makeProject({ "project.godot": "" })]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
