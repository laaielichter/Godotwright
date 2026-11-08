import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  BLOCK_END,
  BLOCK_START,
  agentsBlock,
  applyDream,
  dream,
  dreamDue,
  draftLessonInput,
  markDreamed,
  parseSince,
  readDreamConfig,
  readProjectState,
  recordSession,
  selectProposals,
  withBlock,
  type Proposal,
} from "../src/dream/dream.js";
import { claudeSlug, emptyFacts, readTranscript, readTranscripts } from "../src/dream/transcripts.js";
import { dreamNotice } from "../src/hooks/agent-hooks.js";
import { JournalWriter, readJournal, undoJournal } from "../src/journal/journal.js";
import { fingerprint } from "../src/learn/learn.js";
import { readLearning, resetLearning, saveLearning, type LearningData } from "../src/learn/store.js";
import { addLocalLesson, projectKey } from "../src/lessons/local.js";
import { errorTemplate } from "../src/lessons/search.js";
import { createServer } from "../src/mcp/server.js";
import { makeProject, runCli, tempFolder } from "./helpers.js";

const PROJECT = '; Engine configuration file.\nconfig_version=5\n\n[application]\n\nconfig/name="Wizard Tower"\nconfig/features=PackedStringArray("4.7")\n';

/** A Godot message with names and a path in it, and the template Godotwright keeps of it. */
const MESSAGE = "Invalid call. Nonexistent function 'spawn_wizard_boss' in base 'Node'.";

function project(files: Record<string, string> = {}): string {
  return makeProject({ "project.godot": PROJECT, ...files });
}

function learn(change: (d: LearningData) => void): void {
  const { error } = saveLearning(change);
  if (error) throw new Error(error);
}

const kinds = (proposals: Proposal[]) => proposals.map((p) => p.kind);

beforeEach(() => resetLearning());

describe("dream proposals", () => {
  it("drafts a lesson for a Godot error that keeps coming back with no rule or lesson", () => {
    const template = errorTemplate(MESSAGE);
    learn((d) => {
      d.missedByReview[template] = 3;
      d.missedByReview[errorTemplate("Something odd happened once in the engine here.")] = 1;
    });
    const r = dream(project());
    const drafts = r.proposals.filter((p) => p.kind === "draft-lesson");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ n: 1, auto: true, detail: { template }, evidence: { "missed by the review (all projects on this machine)": 3 } });
    // The learning file counts for the whole machine: the reason does not claim it was this project.
    expect(drafts[0]!.reason).toMatch(/on this machine \(any project\)/);
    expect(drafts[0]!.reason).not.toMatch(/in this project/);
    expect(drafts[0]!.key).toMatch(/^[0-9a-f]{8}$/);
    // The template is kept as is, so the lesson it becomes matches the message again.
    expect(errorTemplate(template)).toBe(template);
  });

  it("does not draft a lesson for an error a lesson already explains", () => {
    const template = errorTemplate("Cannot call method 'add_child' on a null value.");
    learn((d) => (d.missedByReview[template] = 5));
    addLocalLesson({ title: "A node read before the scene is ready is null", fix: "Read the node in ready or later, with an onready variable.", error: "Cannot call method 'add_child' on a null value." });
    expect(kinds(dream(project()).proposals)).not.toContain("draft-lesson");
  });

  it("proposes a project hint for an API name the agent keeps guessing", () => {
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 3, resolved: { "Node2D.look_at": 2 } }));
    const [p] = dream(project()).proposals;
    expect(p).toMatchObject({ kind: "api-hint", title: "Remember: use Node2D.look_at, not Node2D.look_att", auto: true, detail: { use: "Node2D.look_at", not: "Node2D.look_att" } });
  });

  it("proposes to retire a local lesson marked wrong, to rewrite a bundled one, and to merge duplicates", () => {
    const a = addLocalLesson({ title: "Moving decks need the deck speed on the body", fix: "Give the body the deck velocity when it lands.", error: "Body slid off the moving platform." }).lesson;
    const b = addLocalLesson({ title: "Bodies landing on a moving ship must inherit its speed", fix: "Set the landing body velocity to the ship velocity.", error: "Body slid off the moving platform." }).lesson;
    const c = addLocalLesson({ title: "Physics interpolation hides jitter on fast cameras", fix: "Turn on physics interpolation in the project settings." }).lesson;
    learn((d) => {
      d.lessons[c.id] = { shown: 9, helped: 0, wrong: 3 };
      d.lessons["physics/moving-platform-velocity"] = { shown: 12, helped: 1, wrong: 4 };
    });
    const r = dream(project());
    expect(kinds(r.proposals)).toEqual(expect.arrayContaining(["merge-lessons", "retire-lesson", "rewrite-lesson"]));
    expect(r.proposals.find((p) => p.kind === "merge-lessons")!.detail.lessons!.sort()).toEqual([a.id, b.id].sort());
    expect(r.proposals.find((p) => p.kind === "retire-lesson")).toMatchObject({ detail: { lessons: [c.id] }, auto: false, evidence: { shown: 9, helped: 0, wrong: 3 } });
    const rewrite = r.proposals.find((p) => p.kind === "rewrite-lesson")!;
    expect(rewrite.detail.lessons).toEqual(["physics/moving-platform-velocity"]);
    expect(rewrite.apply).toBeUndefined();
  });

  it("says a rule is noisy here, as a suggestion only", () => {
    learn((d) => (d.rules["quality/magic-number"] = { reported: 30, confirmed: 0, contradicted: 0, dismissed: 6, verified: 1 }));
    const p = dream(project()).proposals.find((x) => x.kind === "noisy-rule")!;
    expect(p).toMatchObject({ detail: { rule: "quality/magic-number" }, auto: false });
    expect(p.apply).toBeUndefined();
  });

  it("proposes a lesson about writes that were undone again and again", () => {
    const root = project({ "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n' });
    for (let i = 0; i < 2; i++) {
      const j = new JournalWriter(root, "scene edit", "add node Secret");
      j.write(join(root, "main.tscn"), `[gd_scene format=3]\n\n[node name="Main${i}" type="Node2D"]\n`);
      j.commit();
      undoJournal(root);
    }
    const p = dream(root).proposals.find((x) => x.kind === "undo-lesson")!;
    expect(p).toMatchObject({ title: "Writes by the scene edit tool to scene files were undone repeatedly", evidence: { "undone writes": 2 }, auto: true, detail: { tool: "scene edit", fileKind: ".tscn" } });
    expect(JSON.stringify(p)).not.toContain("Secret");
  });

  it("finds verdicts that contradict each other and resolves them to the newest", () => {
    const older = { rule: "api/unknown-member", file: "res://a.gd", message: "x" };
    const newer = { rule: "api/unknown-member", file: "res://b.gd", message: "y" };
    learn((d) => {
      d.dismissed[fingerprint(older)] = 1000;
      d.verified[fingerprint(older)] = 2000; // marked right later: should show again
      d.verified[fingerprint(newer)] = 1000;
      d.dismissed[fingerprint(newer)] = 2000; // marked wrong later: stays hidden
      d.rules["api/unknown-member"] = { reported: 5, confirmed: 2, contradicted: 0, dismissed: 3 };
    });
    const root = project();
    const r = dream(root);
    const resolve = r.proposals.filter((p) => p.kind === "resolve");
    expect(resolve.map((p) => p.detail.findings ?? p.detail.rule)).toEqual(expect.arrayContaining([2, "api/unknown-member"]));
    const fp = resolve.find((p) => p.detail.findings)!;
    applyDream(root, String(fp.n));
    const after = readLearning();
    expect(after.dismissed[fingerprint(older)]).toBeUndefined();
    expect(after.verified[fingerprint(newer)]).toBeUndefined();
    expect(after.dismissed[fingerprint(newer)]).toBe(2000);
    // Undo puts both verdicts back.
    undoJournal(root);
    expect(readLearning().dismissed[fingerprint(older)]).toBe(1000);
    expect(readLearning().verified[fingerprint(newer)]).toBe(1000);
  });

  it("numbers proposals in a stable order and picks them by number or id", () => {
    learn((d) => {
      d.missedByReview[errorTemplate(MESSAGE)] = 2;
      d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } };
    });
    const root = project();
    const a = dream(root).proposals;
    const b = dream(root).proposals;
    expect(a.map((p) => [p.n, p.key])).toEqual(b.map((p) => [p.n, p.key]));
    expect(selectProposals(a, "2")).toEqual([a[1]]);
    expect(selectProposals(a, [a[0]!.key])).toEqual([a[0]]);
    expect(selectProposals(a, "all")).toEqual(a);
    expect(() => selectProposals(a, "9")).toThrow(/no proposal "9"/);
    expect(() => selectProposals(a, "")).toThrow(/name the proposals/);
  });

  it("parses --since", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    expect(parseSince("7d", now)).toBe(now.getTime() - 7 * 86_400_000);
    expect(parseSince("12h", now)).toBe(now.getTime() - 12 * 3_600_000);
    expect(() => parseSince("soon", now)).toThrow(/since must be/);
  });
});

describe("dream transcripts", () => {
  const claudeLines = (root: string) =>
    [
      { type: "user", message: { content: `please fix /home/alice/MySecretGame and keep the api key sk-ant-123456789012345678901234 safe` } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__godotwright__godot_check", input: { path: root } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: `res://wizard/boss_brain.gd:12: error: ${MESSAGE}\nres://wizard/boss_brain.gd:3: error: Identifier "mana" not declared in the current scope. [api/unknown-identifier]` }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "godot --headless /home/alice/MySecretGame" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: `SCRIPT ERROR: ${MESSAGE}\n   at: spawn (res://wizard/boss_brain.gd:12)\nfunc spawn_wizard_boss():\n\tvar secret_sauce := 42` }] }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "mcp__godotwright__godot_api", input: { query: "Node2D.look_att" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", is_error: true, content: "not found in Godot 4.7: Node2D.look_att" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t4", name: "mcp__godotwright__godot_api", input: { query: "Node2D.look_at" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t4", content: "Node2D.look_at(point: Vector2) -> void" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t5", name: "mcp__godotwright__godot_api", input: { query: "WizardBoss.cast_spel" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t5", is_error: true, content: "not found in Godot 4.7: WizardBoss.cast_spel" }] } },
      "not json at all",
    ]
      .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
      .join("\n");

  function homes(root: string) {
    const claudeDir = tempFolder("gw-claude-");
    const codexDir = tempFolder("gw-codex-");
    const dir = join(claudeDir, "projects", claudeSlug(root));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session-1.jsonl"), claudeLines(root));
    const day = join(codexDir, "sessions", "2026", "11", "07");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-1.jsonl"),
      [
        { type: "session_meta", payload: { cwd: root, instructions: "you work on MySecretGame for alice@example.com" } },
        { type: "response_item", payload: { type: "function_call", name: "godotwright__godot_check", arguments: JSON.stringify({ path: root }), call_id: "c1" } },
        { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: `res://wizard/boss_brain.gd:12: error: ${MESSAGE}` } },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
    );
    // A transcript of another project is not read.
    writeFileSync(join(day, "rollout-2.jsonl"), JSON.stringify({ type: "session_meta", payload: { cwd: "/somewhere/else" } }));
    return { claudeDir, codexDir };
  }

  it("reads tool calls, Godot errors and guessed API names, and keeps nothing personal", () => {
    const root = project();
    const facts = readTranscripts(root, homes(root));
    expect(facts).toMatchObject({ sessions: 2, claude: 1, codex: 1 });
    expect(facts.toolCalls).toEqual({ godot_check: 2, godot_api: 3 });
    expect(facts.errors).toEqual({ [errorTemplate(MESSAGE)]: 3 });
    // Only Godot classes with a near-miss member are kept, so a project's own class name is not.
    expect(Object.keys(facts.apiMisses)).toEqual(["Node2D.look_att"]);
    expect(facts.apiMisses["Node2D.look_att"]!.resolved).toEqual({ "Node2D.look_at": 1 });
    const text = JSON.stringify(facts);
    for (const secret of ["alice", "MySecretGame", "spawn_wizard_boss", "boss_brain", "wizard", "secret_sauce", "sk-ant", "/home", "WizardBoss", "mana"]) expect(text).not.toContain(secret);
  });

  it("turns transcripts into proposals only when asked, and the output and the applied files hold nothing from them", () => {
    const root = project({ "CLAUDE.md": "# Notes\n\nOur own rules.\n" });
    const transcriptOptions = homes(root);
    // One failed lookup in the transcripts and one in the learning file: together they recur.
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 1, resolved: {} }));
    expect(kinds(dream(root, { transcriptOptions }).proposals)).toEqual([]);
    const r = dream(root, { transcripts: true, transcriptOptions });
    expect(kinds(r.proposals)).toEqual(["draft-lesson", "api-hint"]);
    expect(r.sources.transcripts).toMatchObject({ sessions: 2, errors: 3 });
    const applied = applyDream(root, "all", { transcripts: true, transcriptOptions });
    expect(applied.applied).toHaveLength(2);
    // The project folder itself is only kept internally (`root`); the CLI and the tool never print it.
    const written = [
      JSON.stringify({ ...r, root: undefined }),
      JSON.stringify({ ...applied, root: undefined }),
      ...applied.files.map((f) => readFileSync(join(root, f.slice("res://".length)), "utf8")),
      JSON.stringify(readLearning().localLessons),
    ].join("\n");
    for (const secret of ["alice", "MySecretGame", "spawn_wizard_boss", "boss_brain", "wizard", "secret_sauce", "sk-ant", "/home", "WizardBoss", root]) expect(written).not.toContain(secret);
  });

  it("skips lines it cannot read", () => {
    const facts = emptyFacts();
    readTranscript('{"type":"assistant","message":{"content":[null,{"type":"tool_use"}]}}\n{"payload":5}\n[1,2]\n', facts);
    expect(facts.toolCalls).toEqual({});
  });

  it("reads only transcripts changed since the given time", () => {
    const root = project();
    const h = homes(root);
    const old = new Date("2020-01-01T00:00:00Z");
    utimesSync(join(h.claudeDir, "projects", claudeSlug(root), "session-1.jsonl"), old, old);
    expect(readTranscripts(root, { ...h, since: Date.parse("2025-01-01T00:00:00Z") })).toMatchObject({ sessions: 1, claude: 0, codex: 1 });
  });
});

describe("dream apply and undo", () => {
  it("keeps lessons and hints, writes the report and the agents block, and undo takes all of it back", () => {
    const root = project({ "AGENTS.md": "# Agents\n\nBe kind.\n" });
    learn((d) => {
      d.missedByReview[errorTemplate(MESSAGE)] = 4;
      d.apiMisses["Node2D.look_att"] = { count: 3, resolved: { "Node2D.look_at": 2 } };
    });
    const r = applyDream(root, "all");
    expect(r.applied.map((a) => a.proposal.kind)).toEqual(["draft-lesson", "api-hint"]);
    const lesson = readLearning().localLessons[0]!;
    expect(lesson).toMatchObject({ tags: ["draft", "dream"], errors: [errorTemplate(MESSAGE)] });
    expect(lesson.title).toMatch(/^Godot error without a lesson yet: /);
    expect(readProjectState(root).hints).toEqual([{ use: "Node2D.look_at", not: "Node2D.look_att", count: 3 }]);
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Agents\n\nBe kind.\n\n")).toBe(true);
    expect(agents).toContain("## Godotwright lessons for agents");
    expect(agents).toContain("- Use `Node2D.look_at`, not `Node2D.look_att`.");
    expect(r.files).toEqual(expect.arrayContaining(["res://.godot/godotwright/dreams/state.json", "res://AGENTS.md"]));
    expect(r.files.some((f) => /^res:\/\/\.godot\/godotwright\/dreams\/\d{4}-\d{2}-\d{2}-\d{4}\.md$/.test(f))).toBe(true);
    expect(readJournal(root).entries.at(-1)).toMatchObject({ tool: "dream", id: r.journal });

    // Applied proposals are not proposed again.
    expect(dream(root).proposals).toEqual([]);

    const u = undoJournal(root);
    expect(u.undone[0]!.lessons).toEqual({ restored: [lesson.id], kept: [] });
    expect(readLearning().localLessons).toEqual([]);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# Agents\n\nBe kind.\n");
    expect(existsSync(join(root, ".godot/godotwright/dreams/state.json"))).toBe(false);
    expect(dream(root).proposals).toHaveLength(2);
  });

  it("drops the draft tag when a draft is rewritten with a real cause and fix, so it is no longer a draft", () => {
    const root = project();
    learn((d) => (d.missedByReview[errorTemplate(MESSAGE)] = 2));
    applyDream(root, "1");
    const draft = readLearning().localLessons[0]!;
    expect(draft.tags).toContain("draft");
    addLocalLesson({ title: draft.title, cause: "The method is defined on another node than the one it is called on.", fix: "Call the function on the node that defines it, after checking it with has_method.", error: MESSAGE });
    const done = readLearning().localLessons[0]!;
    expect(done.tags).not.toContain("draft");
    expect(done.tags).toContain("dream");
    learn((d) => (d.lessons[done.id] = { shown: 5, helped: 0, wrong: 0 }));
    expect(kinds(dream(root, { all: true }).proposals)).not.toContain("finish-draft");
    // It may now go into the agents block.
    expect(agentsBlock(readLearning(), readProjectState(root), undefined, projectKey(root))).toContain("has_method");
  });

  it("still treats a lesson whose fix is the draft placeholder as a draft", () => {
    const root = project();
    addLocalLesson({ ...draftLessonInput(errorTemplate(MESSAGE), { x: 2 }), tags: ["dream"] }, { project: root });
    expect(kinds(dream(root).proposals)).toContain("finish-draft");
  });

  it("leaves a lesson rewritten since the apply alone on undo", () => {
    const root = project();
    learn((d) => (d.missedByReview[errorTemplate(MESSAGE)] = 2));
    applyDream(root, "1");
    const draft = readLearning().localLessons[0]!;
    // The agent finishes the draft: same title, a real fix.
    addLocalLesson({ title: draft.title, fix: "Call the function on the node that defines it, after checking it with has_method.", error: MESSAGE });
    const u = undoJournal(root);
    expect(u.undone[0]!.lessons).toEqual({ restored: [], kept: [draft.id] });
    expect(readLearning().localLessons[0]!.fix).toMatch(/has_method/);
  });

  it("does not write an agents file unless one exists or it is asked to, and finds one at the repository root", () => {
    const repo = makeProject({ ".git/HEAD": "ref: refs/heads/main\n", "CLAUDE.md": "# Repo rules\n", "game/project.godot": PROJECT });
    const root = join(repo, "game");
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } }));
    const r = applyDream(root, "all");
    expect(r.files).toContain("res://../CLAUDE.md");
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toContain(BLOCK_START);
    undoJournal(root);
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe("# Repo rules\n");

    const bare = project();
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } }));
    applyDream(bare, "all");
    expect(existsSync(join(bare, "AGENTS.md"))).toBe(false);
    undoJournal(bare);
    applyDream(bare, "all", { writeAgentsFile: true });
    expect(readFileSync(join(bare, "AGENTS.md"), "utf8")).toContain("Use `Node2D.look_at`");
  });

  it("skips a protected agents file with a note and stores one journal entry that undo takes back", () => {
    const root = project({ "AGENTS.md": "# Agents\n", "godotwright.json": JSON.stringify({ protect: ["AGENTS.md"] }) });
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } }));
    const before = readJournal(root).entries.length;
    const r = applyDream(root, "all");
    expect(r.notes).toEqual(["res://AGENTS.md is protected and was not written"]);
    expect(readJournal(root).entries).toHaveLength(before + 1);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# Agents\n");
    const u = undoJournal(root);
    expect(u.blocked).toBeUndefined();
    expect(existsSync(join(root, ".godot/godotwright/dreams/state.json"))).toBe(false);
  });

  it("marks suggestions as seen until their evidence doubles", () => {
    const root = project();
    learn((d) => (d.rules["quality/magic-number"] = { reported: 30, confirmed: 0, contradicted: 0, dismissed: 3 }));
    const r = applyDream(root, "1");
    expect(r.seen.map((p) => p.kind)).toEqual(["noisy-rule"]);
    expect(dream(root).proposals).toEqual([]);
    expect(dream(root, { all: true }).proposals).toHaveLength(1);
    learn((d) => (d.rules["quality/magic-number"]!.dismissed = 6));
    expect(kinds(dream(root).proposals)).toEqual(["noisy-rule"]);
  });

  it("retires and merges lessons, and undo puts them back", () => {
    const root = project();
    const a = addLocalLesson({ title: "Moving decks need the deck speed on the body", fix: "Give the body the deck velocity when it lands.", error: "Body slid off the moving platform.", tags: ["deck"] }).lesson;
    const b = addLocalLesson({ title: "Bodies landing on a moving ship must inherit its speed", fix: "Set the landing body velocity to the ship velocity.", error: "Body slid off the moving platform.", tags: ["ship"] }).lesson;
    const c = addLocalLesson({ title: "Physics interpolation hides jitter on fast cameras", fix: "Turn on physics interpolation in the project settings." }).lesson;
    learn((d) => (d.lessons[c.id] = { shown: 9, helped: 0, wrong: 3 }));
    const before = readLearning().localLessons;
    const r = applyDream(root, "all");
    expect(r.applied.map((x) => x.proposal.kind).sort()).toEqual(["merge-lessons", "retire-lesson"]);
    const after = readLearning().localLessons;
    expect(after).toHaveLength(1);
    // Same help and age: the first id is kept.
    expect(after[0]!.id).toBe([a.id, b.id].sort()[0]);
    expect(after[0]!.tags).toEqual(expect.arrayContaining(["deck", "ship"]));
    undoJournal(root);
    expect(readLearning().localLessons).toEqual(before);
  });

  it("refuses to apply in a read-only MCP session and lists proposals through the tool", async () => {
    const root = project();
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } }));
    for (const readOnly of [true, false]) {
      const server = createServer({ root, godot: "/no/such/godot", readOnly });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [x, y] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(x), client.connect(y)]);
      const listed = (await client.callTool({ name: "godot_dream", arguments: {} })) as { content: { text: string }[]; isError?: boolean };
      expect(listed.content[0]!.text).toContain("#1 [project hint] Remember: use Node2D.look_at, not Node2D.look_att");
      const applied = (await client.callTool({ name: "godot_dream", arguments: { apply: "1" } })) as { content: { text: string }[]; isError?: boolean };
      if (readOnly) expect(applied).toMatchObject({ isError: true });
      else expect(applied.content[0]!.text).toContain("applied #1 [project hint]: hint: use Node2D.look_at, not Node2D.look_att");
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("runs from the CLI, as text and JSON", async () => {
    const root = project();
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } }));
    const listed = await runCli(["dream", root, "--json"]);
    expect(JSON.parse(listed.output).proposals[0]).toMatchObject({ n: 1, kind: "api-hint" });
    const applied = await runCli(["dream", root, "--apply", "1"]);
    expect(applied.output).toMatch(/applied #1 \[project hint\]/);
    expect(applied.output).toMatch(/journal #\d+: godotwright undo/);
    const bad = await runCli(["dream", root, "--apply", "7"]);
    expect(bad.exitCode).toBe(1);
  });
});

describe("the agents-file block", () => {
  it("replaces the old block in place and keeps the rest of the file", () => {
    const block = `${BLOCK_START}\nnew\n${BLOCK_END}`;
    expect(withBlock(`# A\n\n${BLOCK_START}\nold\n${BLOCK_END}\n\n## B\n`, block)).toBe(`# A\n\n${block}\n\n## B\n`);
    expect(withBlock("", block)).toBe(`${block}\n`);
    expect(withBlock("# A\n\n\n", block)).toBe(`# A\n\n${block}\n`);
  });

  it("lists recurring mistakes with their fix and the project hints, without drafts, and stays short", () => {
    const root = project();
    const template = errorTemplate("Cannot call method 'add_child' on a null value.");
    addLocalLesson({ title: "A node read before the scene is ready is null", fix: "Read the node in ready or later, with an onready variable.", error: "Cannot call method 'add_child' on a null value." }, { project: root });
    addLocalLesson(draftLessonInput(errorTemplate(MESSAGE), { x: 2 }), { project: root });
    learn((d) => (d.missedByReview[template] = 3));
    const block = agentsBlock(readLearning(), { version: 1, hints: [{ use: "Node2D.look_at", not: "Node2D.look_att", count: 2 }], acknowledged: {} }, undefined, projectKey(root));
    expect(block).toContain("Recurring mistakes:\n- A node read before the scene is ready is null Fix: Read the node in ready or later");
    expect(block).toContain("Project hints:\n- Use `Node2D.look_at`, not `Node2D.look_att`.");
    expect(block).not.toContain("without a lesson yet");
    expect(block.split("\n").length).toBeLessThan(25);
  });
});

describe("agents-file privacy", () => {
  it("never writes local lessons of other projects, or without a project, into this project's agents file", () => {
    const mine = project({ "AGENTS.md": "# Agents\n" });
    const other = project();
    addLocalLesson({ title: "Lanterns flicker when the tower generator overloads", fix: "Limit the lantern lights per room to eight." }, { project: other });
    addLocalLesson({ title: "An old lesson kept before projects were tagged", fix: "Keep the old fix written down here somewhere." });
    addLocalLesson({ title: "Moving decks need the deck speed on the body", fix: "Give the body the deck velocity when it lands." }, { project: mine });
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } }));
    applyDream(mine, "all");
    const text = readFileSync(join(mine, "AGENTS.md"), "utf8");
    expect(text).toContain("Moving decks need the deck speed");
    expect(text).not.toContain("Lanterns");
    expect(text).not.toContain("old lesson");
    // The lessons hold a hash of their project, never its path.
    expect(JSON.stringify(readLearning().localLessons)).not.toContain(mine);
    expect(readLearning().localLessons.find((l) => l.title.startsWith("Moving"))!.projects).toEqual([projectKey(mine)]);
  });

  it("does not add a block to an agents file when an apply only marks suggestions as seen", () => {
    const root = project({ "AGENTS.md": "# Agents\n" });
    learn((d) => (d.rules["quality/magic-number"] = { reported: 30, confirmed: 0, contradicted: 0, dismissed: 3 }));
    const r = applyDream(root, "all");
    expect(r.seen).toHaveLength(1);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# Agents\n");
  });
});

describe("dream due", () => {
  it("is due after 24 hours and 5 sessions by default, counting a session id once", () => {
    const root = project();
    const t0 = new Date("2026-11-01T08:00:00Z");
    expect(dreamDue(root, readDreamConfig(root), t0).due).toBe(false);
    for (const id of ["a", "b", "c", "d", "d"]) recordSession(root, id, t0);
    const later = new Date("2026-11-02T09:00:00Z");
    expect(dreamDue(root, readDreamConfig(root), later)).toMatchObject({ due: false, sessions: 4, hours: 25 });
    recordSession(root, "e", later);
    expect(dreamDue(root, readDreamConfig(root), later)).toMatchObject({ due: true, sessions: 5 });
    markDreamed(root, later);
    expect(dreamDue(root, readDreamConfig(root), new Date("2026-11-04T09:00:00Z"))).toMatchObject({ due: false, sessions: 0, hours: 48 });
  });

  it("reads its settings from godotwright.json", () => {
    expect(readDreamConfig(project())).toEqual({ auto: "suggest", minHours: 24, minSessions: 5 });
    const root = project({ "godotwright.json": JSON.stringify({ dream: { auto: "apply", minHours: 0, minSessions: 1 } }) });
    expect(readDreamConfig(root)).toEqual({ auto: "apply", minHours: 0, minSessions: 1 });
    const off = project({ "godotwright.json": JSON.stringify({ dream: { auto: "off", minHours: "x" } }) });
    expect(readDreamConfig(off)).toEqual({ auto: "off", minHours: 24, minSessions: 5 });
    recordSession(off, "a");
    expect(dreamDue(off, readDreamConfig(off), new Date(Date.now() + 1e10)).due).toBe(false);
  });

  it("says in one line at session start how many proposals wait, without applying them", () => {
    const root = project({ "godotwright.json": JSON.stringify({ dream: { minHours: 0, minSessions: 1 } }) });
    learn((d) => (d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } }));
    expect(dreamNotice(root, "s1")).toBe("Godotwright has 1 dream proposal: run godot_dream.");
    expect(readProjectState(root).hints).toEqual([]);
  });

  it("applies only lesson and hint changes by itself with auto apply, never a removal", () => {
    const root = project({ "godotwright.json": JSON.stringify({ dream: { auto: "apply", minHours: 0, minSessions: 1 } }) });
    const c = addLocalLesson({ title: "Physics interpolation hides jitter on fast cameras", fix: "Turn on physics interpolation in the project settings." }).lesson;
    learn((d) => {
      d.lessons[c.id] = { shown: 9, helped: 0, wrong: 3 };
      d.apiMisses["Node2D.look_att"] = { count: 2, resolved: { "Node2D.look_at": 1 } };
    });
    expect(dreamNotice(root, "s1")).toBe("Godotwright dreamed: applied 1 lesson and hint change (godot_undo takes them back); 1 more proposal waits: run godot_dream.");
    expect(readProjectState(root).hints).toHaveLength(1);
    expect(readLearning().localLessons.map((l) => l.id)).toEqual([c.id]);
    // The dream counts as done: nothing more until the next one is due.
    expect(dreamNotice(root, "s1")).toBeUndefined();
  });
});
