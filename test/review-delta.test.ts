import { existsSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/mcp/server.js";
import { forgetReview, formatDelta, reviewDelta } from "../src/review/delta.js";
import { reviewProject } from "../src/review/review.js";
import { makeProject, runCli } from "./helpers.js";

const PROJECT = '[application]\nconfig/name="T"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n';
const SCENE = '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://a.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n';
const project = (code: string) => makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n", "main.tscn": SCENE, "a.gd": code });
const BAD = "extends Node\n\nfunc _ready() -> void:\n\tvar a: Array = []\n\tif a.empty():\n\t\tpass\n\tvar b := deg2rad(1.0)\n";
const FIXED = "extends Node\n\nfunc _ready() -> void:\n\tvar a: Array = []\n\tif a.is_empty():\n\t\tpass\n\tvar b := deg2rad(1.0)\n";
const WORSE = `${FIXED}\nfunc _process(_d: float) -> void:\n\tvar n := get_node("X")\n\tn.queue_free()\n`;

describe("review delta", () => {
  it("reports every finding as new the first time, then only what changed, and remembers between runs", () => {
    const root = project(BAD);
    const first = reviewDelta(root, reviewProject(root));
    expect(first.first).toBe(true);
    expect(first.fresh.length).toBe(2);
    expect(existsSync(`${root}/.godot/godotwright/review-last.json`)).toBe(true);

    writeFileSync(`${root}/a.gd`, FIXED);
    const second = reviewDelta(root, reviewProject(root));
    expect(second.first).toBe(false);
    expect(second.fixed).toBe(1);
    expect(second.fresh).toEqual([]);
    expect(second.open.map((f) => f.rule)).toEqual(["api/unknown-function"]);
    expect(second.previous).toBe(2);

    writeFileSync(`${root}/a.gd`, WORSE);
    const third = reviewDelta(root, reviewProject(root));
    expect(third.fresh.map((f) => f.rule)).toContain("performance/node-lookup-per-frame");
    expect(third.open.map((f) => f.rule)).toEqual(["api/unknown-function"]);
    expect(third.fixed).toBe(0);
    const text = formatDelta(third);
    expect(text).toMatch(/since the last review: [12] new, 0 fixed, 1 still open \(1 before\)/);
    expect(text).toContain("new:\n  res://a.gd:");
    expect(text).toContain("still open (as reported before):\n  res://a.gd:7 error [api/unknown-function]");

    forgetReview(root);
    const again = reviewDelta(root, reviewProject(root));
    expect(again.first).toBe(true);
    expect(again.fresh.length).toBe(reviewProject(root).findings.length);
  });

  it("does not count a finding as new when only its line moved", () => {
    const root = project(BAD);
    reviewDelta(root, reviewProject(root));
    writeFileSync(`${root}/a.gd`, `# a comment on top\n${BAD}`);
    const d = reviewDelta(root, reviewProject(root));
    expect(d.fresh).toEqual([]);
    expect(d.open.length).toBe(2);
    expect(d.fixed).toBe(0);
  });

  it("can look without remembering, and says when there is nothing", () => {
    const root = project("extends Node\n");
    const d = reviewDelta(root, reviewProject(root), { remember: false });
    expect(d.first).toBe(true);
    expect(existsSync(`${root}/.godot/godotwright/review-last.json`)).toBe(false);
    expect(formatDelta({ fresh: [], open: [], fixed: 2, previous: 2, first: false })).toContain("no findings");
  });

  it("works from the CLI with --only-new", async () => {
    const root = project(BAD);
    const first = await runCli(["review", root, "--only-new"]);
    expect(first.output).toContain("first review of this project");
    expect(first.output).toContain("overall:");
    writeFileSync(`${root}/a.gd`, FIXED);
    const second = await runCli(["review", root, "--only-new"]);
    expect(second.output).toContain("since the last review: 0 new, 1 fixed, 1 still open");
    expect(second.output).not.toContain("is_empty");
    expect(second.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("works from the MCP tool with only_new, and a plain review still updates the memory", async () => {
    const root = project(BAD);
    const server = createServer({ tier: "cheap", root, godot: "/no/such/godot" });
    const client = new Client({ name: "t", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (args: Record<string, unknown>) => ((await client.callTool({ name: "godot_review", arguments: args })) as { content: { text: string }[] }).content.map((c) => c.text).join("\n");
    const plain = await call({});
    expect(plain).toContain("findings: 2");
    writeFileSync(`${root}/a.gd`, FIXED);
    const delta = await call({ only_new: true });
    expect(delta).toContain("since the last review: 0 new, 1 fixed, 1 still open");
    expect(delta).toContain("still open (as reported before):");
    expect(delta).not.toContain("is_empty");
    await Promise.all([client.close(), server.close()]);
  });
});
