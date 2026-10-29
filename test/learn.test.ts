import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodotApi } from "../src/api/api.js";
import type { CheckResult } from "../src/check/check.js";
import type { Diagnostic } from "../src/check/log.js";
import { lookupLearning, reviewLearning } from "../src/learn/hooks.js";
import { adjustFindings, DOWNGRADE_AFTER, fingerprint, learnedHints, parseFindingLine, recordApiLookup, recordCheck, recordFeedback } from "../src/learn/learn.js";
import { emptyLearning, learningFile, readLearning, resetLearning, updateLearning } from "../src/learn/store.js";
import { messageTemplate, shareableTemplate } from "../src/learn/template.js";
import { formatFinding, formatReview } from "../src/review/format.js";
import { reviewProject } from "../src/review/review.js";
import type { Finding } from "../src/review/rules.js";
import { makeProject, runCli } from "./helpers.js";

const PROJECT = '[application]\nconfig/name="Secret Game"\nconfig/features=PackedStringArray("4.7")\n';
// Array.empty() is Godot 3; the review reports api/unknown-member on line 5.
const SCRIPT = 'extends Node\n\n\nfunc _ready() -> void:\n\tvar secret_inventory: Array = []\n\tprint(secret_inventory.empty())\n';

function project(): string {
  return makeProject({ "project.godot": PROJECT, "player.gd": SCRIPT });
}

function godot(diagnostics: Diagnostic[], step: { exitCode?: number | null; timedOut?: boolean } = {}): CheckResult {
  return {
    godot: "godot",
    godotVersion: "4.7.stable",
    scripts: 1,
    scenes: 0,
    diagnostics,
    steps: [{ name: "check", ms: 1, exitCode: 0, timedOut: false, ...step }],
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: 0,
  };
}

const finding = (over: Partial<Finding> = {}): Finding => ({
  rule: "api/unknown-member",
  category: "api",
  severity: "error",
  file: "res://player.gd",
  line: 6,
  message: 'Method "empty()" does not exist on Array in Godot 4.7.',
  ...over,
});

// The shipped data/learned.json changes every week: these tests must not depend on it.
// (collector.test.ts keeps the one test that reads it.)
vi.mock("../src/learn/bundled.js", () => ({
  bundledLearning: () => ({ version: 1, installs: 0, apiHints: {}, rules: {}, missedByReview: {} }),
}));

beforeEach(() => resetLearning());

describe("learning store", () => {
  it("starts empty, with sharing off", () => {
    const data = readLearning();
    expect(data).toEqual(emptyLearning());
    expect(data.enabled).toBe(true);
    expect(data.sharing.enabled).toBe(false);
  });

  it("survives a broken file", () => {
    updateLearning(() => {});
    writeFileSync(learningFile(), "{ not json");
    expect(readLearning()).toEqual(emptyLearning());
    updateLearning((d) => (d.unparsed["x"] = 1));
    expect(readLearning().unparsed).toEqual({ x: 1 });
  });

  it("writes through a temp file and leaves none behind", () => {
    for (let i = 0; i < 5; i++) updateLearning((d) => (d.unparsed["n"] = i));
    expect(readLearning().unparsed["n"]).toBe(4);
    expect(readdirSync(dirname(learningFile())).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("ignores fields of the wrong type instead of failing on them", () => {
    writeFileSync(
      learningFile(),
      JSON.stringify({
        version: 1,
        enabled: "yes",
        rules: null,
        dismissed: [],
        apiMisses: { "Node2D.lookat": null, "Node2D.look_at": { count: "x", resolved: [] } },
        lastMiss: "oops",
        missedByReview: { a: "b" },
        unparsed: null,
        sharing: { enabled: true, sent: { rules: null } },
      }),
    );
    const data = readLearning();
    expect(data.enabled).toBe(true);
    expect(data.rules).toEqual({});
    expect(data.dismissed).toEqual({});
    expect(data.apiMisses).toEqual({ "Node2D.look_at": { count: 0, resolved: {} } });
    expect(data.lastMiss).toBeUndefined();
    expect(data.missedByReview).toEqual({});
    expect(data.unparsed).toEqual({});
    expect(data.sharing).toEqual({ enabled: true, sent: { rules: {}, apiMisses: {}, missedByReview: {}, unparsed: {} } });
  });

  it("keeps review, api and learn working on such a file", async () => {
    writeFileSync(learningFile(), JSON.stringify({ version: 1, enabled: true, rules: null, apiMisses: null, sharing: null }));
    expect(reviewLearning(project()).findings.length).toBeGreaterThan(0);
    expect(lookupLearning(GodotApi.load(), "Node2D.look_at").result.entries.length).toBeGreaterThan(0);
    recordFeedback(finding(), "wrong");
    expect((await runCli(["learn", "status"])).output).toContain("local learning: on");
  });

  it("fills in defaults for fields a file does not have", () => {
    updateLearning(() => {});
    writeFileSync(learningFile(), JSON.stringify({ version: 1, enabled: true, rules: {} }));
    const data = readLearning();
    expect(data.apiMisses).toEqual({});
    expect(data.sharing.enabled).toBe(false);
  });
});

describe("message templates", () => {
  it("drops paths, names and numbers", () => {
    expect(messageTemplate('Identifier "secret_inventory" not declared in the current scope.')).toBe('Identifier "<s>" not declared in the current scope.');
    expect(messageTemplate("Failed loading resource: res://levels/boss_7.tscn. Make sure resources have been imported")).toBe("Failed loading resource: <path>");
    expect(messageTemplate("Cannot open file /home/roel/My Game/a.gd at line 12")).toBe("Cannot open file <path>");
    // The last word of a path with a space must not survive as a plain word.
    expect(messageTemplate("Cannot open project at C:\\Users\\John Smith")).toBe("Cannot open project at <path>");
    expect(messageTemplate("too   many\nspaces 0xFF -3.5")).toBe("too many spaces <n> <n>");
  });

  it("only calls a template shareable when nothing personal is left", () => {
    expect(shareableTemplate('Identifier "<s>" not declared in the current scope.')).toBe(true);
    expect(shareableTemplate("Cannot open file <path>")).toBe(true);
    // A path is the last thing in a template; words after one may belong to the path.
    expect(shareableTemplate("Cannot open file <path> at line <n>")).toBe(false);
    expect(shareableTemplate("open C:\\Users")).toBe(false);
    expect(shareableTemplate("mail me at a.b@example.com now")).toBe(false);
    expect(shareableTemplate("short")).toBe(false);
  });
});

describe("adjusting findings", () => {
  it("hides findings marked as wrong, whatever their line", () => {
    const data = emptyLearning();
    data.dismissed[fingerprint(finding())] = 1;
    const adjusted = adjustFindings([finding({ line: 40 }), finding({ rule: "api/unknown-type", message: "other" })], data);
    expect(adjusted.hidden).toBe(1);
    expect(adjusted.findings.map((f) => f.rule)).toEqual(["api/unknown-type"]);
  });

  it(`downgrades a rule after ${DOWNGRADE_AFTER} contradictions and no confirmation`, () => {
    const data = emptyLearning();
    data.rules["api/unknown-member"] = { reported: 3, confirmed: 0, contradicted: DOWNGRADE_AFTER - 1, dismissed: 0 };
    expect(adjustFindings([finding()], data).findings[0]!.severity).toBe("error");

    data.rules["api/unknown-member"].contradicted = DOWNGRADE_AFTER;
    const adjusted = adjustFindings([finding(), finding({ severity: "warning" })], data);
    expect(adjusted.downgraded).toEqual(["api/unknown-member"]);
    expect(adjusted.findings.map((f) => f.severity)).toEqual(["warning", "warning"]);
    expect(adjusted.findings[0]!.message).toContain("treat it as a hint");

    data.rules["api/unknown-member"].confirmed = 1;
    expect(adjustFindings([finding()], data).findings[0]!.severity).toBe("error");
  });
});

describe("learning from real Godot checks", () => {
  const review = { findings: [finding()] };

  it("counts a review error as contradicted when Godot loaded the script cleanly", () => {
    recordCheck(godot([]), review);
    expect(readLearning().rules["api/unknown-member"]?.contradicted).toBe(1);
  });

  it("counts it as confirmed when Godot reports an error on the same line", () => {
    recordCheck(godot([{ severity: "error", file: "res://player.gd", line: 7, message: "Invalid call", source: "script" }]), review);
    const stats = readLearning().rules["api/unknown-member"];
    expect(stats?.confirmed).toBe(1);
    expect(stats?.contradicted).toBe(0);
  });

  it("does not judge when the check did not finish", () => {
    recordCheck(godot([], { timedOut: true, exitCode: null }), review);
    recordCheck(godot([{ severity: "error", message: "the checker did not finish", source: "check" }]), review);
    recordCheck({ ...godot([]), scripts: 0 }, review);
    expect(readLearning().rules).toEqual({});
  });

  it("does not judge review errors in dot-folders, which Godot never loads", () => {
    const root = makeProject({
      "project.godot": PROJECT,
      "player.gd": "extends Node\n\n\nfunc _ready() -> void:\n\tprint(1)\n",
      ".backup/old_player.gd": SCRIPT,
    });
    const review = reviewProject(root);
    expect(review.findings.some((f) => f.file.startsWith("res://.backup/") && f.rule === "api/unknown-member")).toBe(true);
    for (let i = 0; i < DOWNGRADE_AFTER; i++) recordCheck(godot([]), review);
    expect(readLearning().rules["api/unknown-member"]?.contradicted ?? 0).toBe(0);
  });

  it("remembers Godot errors the review missed, without names", () => {
    recordCheck(godot([{ severity: "error", file: "res://enemy.gd", line: 3, message: 'Identifier "secret_boss" not declared in the current scope.', source: "script" }]), review);
    expect(readLearning().missedByReview).toEqual({ 'Identifier "<s>" not declared in the current scope.': 1 });
  });

  it("remembers messages the log parser could not place", () => {
    recordCheck(godot([{ severity: "error", message: "Unexpected end of file 42", source: "import" }]), { findings: [] });
    expect(readLearning().unparsed).toEqual({ "Unexpected end of file <n>": 1 });
  });

  it("keeps no project name from a Godot message, and drops such names kept by an older version", () => {
    recordCheck(godot([{ severity: "error", file: "res://enemy.gd", line: 3, message: "Function take_damage not found in base Enemy", source: "script" }]), { findings: [] });
    expect(readLearning().missedByReview).toEqual({ "Function <id> not found in base <id>": 1 });
    updateLearning((d) => (d.missedByReview["Function take_damage not found in base Enemy"] = 2));
    recordCheck(godot([]), { findings: [] });
    expect(readLearning().missedByReview).toEqual({ "Function <id> not found in base <id>": 1 });
  });
});

describe("getting smarter over time", () => {
  it("stops calling a rule an error once Godot keeps contradicting it here", () => {
    const root = project();
    const first = reviewLearning(root);
    const line = first.findings.find((f) => f.rule === "api/unknown-member");
    expect(line?.severity).toBe("error");

    for (let i = 0; i < DOWNGRADE_AFTER; i++) recordCheck(godot([]), reviewProject(root));
    const later = reviewLearning(root);
    expect(later.findings.find((f) => f.rule === "api/unknown-member")?.severity).toBe("warning");
    expect(later.learning?.downgraded).toEqual(["api/unknown-member"]);
    expect(later.overall).toBeGreaterThan(first.overall);
    expect(formatReview(later)).toContain("api/unknown-member");
  });

  it("hides a finding after it was marked as wrong", () => {
    const root = project();
    const before = reviewLearning(root);
    const target = before.findings.find((f) => f.rule === "api/unknown-member")!;
    const parsed = parseFindingLine(formatFinding(target));
    expect(parsed).toEqual({ rule: target.rule, file: target.file, line: target.line, message: target.message });

    recordFeedback(parsed!, "wrong");
    const after = reviewLearning(root);
    expect(after.findings.some((f) => f.rule === "api/unknown-member")).toBe(false);
    expect(after.learning?.hidden).toBe(1);
    expect(formatReview(after)).toContain("marked as wrong");
    expect(readLearning().rules["api/unknown-member"]?.dismissed).toBe(1);
  });

  it("also hides a downgraded finding marked as wrong", () => {
    const root = project();
    for (let i = 0; i < DOWNGRADE_AFTER; i++) recordCheck(godot([]), reviewProject(root));
    const downgraded = reviewLearning(root).findings.find((f) => f.rule === "api/unknown-member")!;
    recordFeedback(parseFindingLine(formatFinding(downgraded))!, "wrong");
    expect(reviewLearning(root).findings.some((f) => f.rule === "api/unknown-member")).toBe(false);
  });

  it("learns what a failed API lookup meant", () => {
    const api = GodotApi.load();
    expect(lookupLearning(api, "Node2D.lookat").hints).toEqual([]);
    expect(lookupLearning(api, "Node2D.look_at").result.entries.length).toBeGreaterThan(0);
    expect(readLearning().apiMisses["Node2D.lookat"]).toEqual({ count: 1, resolved: { "Node2D.look_at": 1 } });
    expect(lookupLearning(api, "Node2D.lookat").hints).toEqual(["Node2D.look_at"]);
  });

  it("only links lookups close in time, and only to names that exist", () => {
    const api = GodotApi.load();
    recordApiLookup("Node2D.lookat", false, 0);
    recordApiLookup("Node.get_node", true, 10 * 60_000);
    expect(readLearning().apiMisses["Node2D.lookat"]?.resolved).toEqual({});
    expect(learnedHints("Node2D.lookat", api, readLearning(), { "Node2D.lookat": { "Node.get_node": 2, "Nope.nothing": 9 } })).toEqual(["Node.get_node"]);
  });

  it("keeps no failed lookup of the project's own names, nor a bare name", () => {
    const api = GodotApi.load();
    for (const query of ["Enemy.take_damage", "Level", "Node2D.my_position"]) lookupLearning(api, query);
    expect(readLearning().apiMisses).toEqual({});
    expect(readLearning().lastMiss).toBeUndefined();
    expect(existsSync(learningFile()) ? readFileSync(learningFile(), "utf8") : "").not.toMatch(/take_damage|my_position|Level/);
  });

  it("reads a finding line whose file path has a space", () => {
    const line = 'res://My Scripts/player.gd:6: error [api/unknown-member] Method "empty()" does not exist on Array in Godot 4.7.';
    expect(parseFindingLine(line)).toEqual({ rule: "api/unknown-member", file: "res://My Scripts/player.gd", line: 6, message: 'Method "empty()" does not exist on Array in Godot 4.7.' });
    expect(parseFindingLine("res://a.gd: warning [quality/todo] TODO here")).toEqual({ rule: "quality/todo", file: "res://a.gd", line: undefined, message: "TODO here" });
  });

  it("counts a verdict of right as verified, not as a Godot confirmation", () => {
    recordFeedback(finding(), "right");
    expect(readLearning().rules["api/unknown-member"]).toMatchObject({ verified: 1, confirmed: 0 });
  });

  it("does not let a verdict of right unlock a rule that Godot keeps contradicting", () => {
    for (let i = 0; i < DOWNGRADE_AFTER; i++) recordCheck(godot([]), { findings: [finding()] });
    recordFeedback(finding(), "right");
    expect(adjustFindings([finding()], readLearning()).findings[0]!.severity).toBe("warning");
  });
});

describe("turning learning off", () => {
  afterEach(() => {
    delete process.env["GODOTWRIGHT_LEARN"];
  });

  it("keeps learning off after learn reset, until learn on", async () => {
    await runCli(["learn", "off"]);
    const { output } = await runCli(["learn", "reset"]);
    expect(output).toContain("local learning stays off");
    expect(readLearning().enabled).toBe(false);
    recordFeedback(finding(), "wrong");
    expect(readLearning().dismissed).toEqual({});
    expect((await runCli(["learn", "on"])).output).toContain("local learning is on");
    expect(readLearning().enabled).toBe(true);
  });

  it("records nothing with GODOTWRIGHT_LEARN=0", () => {
    process.env["GODOTWRIGHT_LEARN"] = "0";
    reviewLearning(project());
    recordCheck(godot([]), { findings: [finding()] });
    lookupLearning(GodotApi.load(), "Node2D.lookat");
    recordFeedback(finding(), "wrong");
    expect(existsSync(learningFile())).toBe(false);
  });

  it("records nothing and changes nothing after learn off", async () => {
    recordFeedback(finding(), "wrong");
    const before = readLearning();
    expect((await runCli(["learn", "off"])).output).toContain("off");
    // Off: the local file no longer applies, so the finding is shown again.
    const report = reviewLearning(project());
    expect(report.findings.some((f) => f.rule === "api/unknown-member")).toBe(true);
    expect(report.learning).toBeUndefined();
    recordFeedback(finding(), "wrong");
    recordCheck(godot([]), { findings: [finding()] });
    lookupLearning(GodotApi.load(), "Node2D.lookat");
    expect(readLearning()).toEqual({ ...before, enabled: false });
    expect((await runCli(["learn"])).output).toContain("local learning: off");
  });
});

describe("saving the choice", () => {
  it("fails with the reason when the learning file cannot be written", async () => {
    // A file where the state folder should be: no write can succeed, not even as root.
    const home = process.env["GODOTWRIGHT_HOME"]!;
    const blocker = join(home, "not-a-folder");
    writeFileSync(blocker, "x");
    process.env["GODOTWRIGHT_HOME"] = blocker;
    try {
      await expect(runCli(["learn", "off"])).rejects.toThrow("not saved");
      await expect(runCli(["learn", "on"])).rejects.toThrow("not saved");
      await expect(runCli(["learn", "share", "on"])).rejects.toThrow("not saved");
    } finally {
      process.env["GODOTWRIGHT_HOME"] = home;
    }
  });
});

describe("privacy", () => {
  it("sends nothing anywhere and keeps no code, names or paths", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const root = project();
    const report = reviewLearning(root);
    recordCheck(godot([{ severity: "error", file: "res://enemy.gd", line: 2, message: `Identifier "secret_boss" not declared. In ${root}/enemy.gd`, source: "script" }]), report);
    recordFeedback(report.findings[0]!, "wrong");
    lookupLearning(GodotApi.load(), "Node2D.lookat");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    const file = readFileSync(learningFile(), "utf8");
    for (const secret of ["secret", "Secret Game", root, "player.gd", "enemy.gd", "res://"]) expect(file).not.toContain(secret);
  });
});

describe("learn command", () => {
  it("shows status, takes feedback and resets", async () => {
    const root = project();
    const { output } = await runCli(["review", root]);
    const line = output.split("\n").find((l) => l.includes("[api/unknown-member]"))!;
    expect(line).toBeTruthy();

    const status = await runCli(["learn", "status"]);
    expect(status.output).toContain("local learning: on (stays on this machine)");
    expect(status.output).toContain("sharing: off");
    expect(status.output).toContain("api/unknown-member: reported 1");

    expect((await runCli(["learn", "feedback", "wrong", ...line.trim().split(" ")])).output).toContain("noted: api/unknown-member");
    expect((await runCli(["review", root])).output).not.toContain("[api/unknown-member]");
    await expect(runCli(["learn", "feedback", "maybe", line])).rejects.toThrow("wrong or right");

    expect((await runCli(["learn", "reset"])).output).toContain("deleted");
    expect(existsSync(learningFile())).toBe(false);
    expect((await runCli(["review", root])).output).toContain("[api/unknown-member]");
  });
});
