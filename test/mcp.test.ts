import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Tier } from "../src/mcp/server.js";
import { DEMO, FIXTURES } from "./helpers.js";

async function connect(tier: Tier, root = DEMO) {
  const server = createServer({ tier, root, godot: "/no/such/godot" });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

type Result = { content: { type: string; text: string }[]; isError?: boolean };
const textOf = (r: unknown) => (r as Result).content.map((c) => c.text).join("\n");

describe("MCP server (cheap profile)", () => {
  let client: Client;
  let close: () => Promise<unknown>;
  beforeAll(async () => ({ client, close } = await connect("cheap")));
  afterAll(() => close());

  it("lists the tools with read-only hints", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "godot_api",
      "godot_api_search",
      "godot_check",
      "godot_checklist",
      "godot_feedback",
      "godot_model_build",
      "godot_model_identify",
      "godot_model_inspect",
      "godot_model_lint",
      "godot_model_spec",
      "godot_review",
      "godot_scan",
    ]);
    expect(tools.find((t) => t.name === "godot_scan")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "godot_api")?.inputSchema.required).toEqual(["query"]);
  });

  it("sends step-by-step instructions", () => {
    expect(client.getInstructions()).toContain("Never guess API names");
  });

  it("scans the project briefly", async () => {
    const out = textOf(await client.callTool({ name: "godot_scan", arguments: {} }));
    expect(out).toContain("project: Demo Game (Godot 4.7, Forward Plus)");
    expect(out).not.toContain(":12");
  });

  it("looks up the API and fails clearly on Godot 3 names", async () => {
    const ok = await client.callTool({ name: "godot_api", arguments: { query: "CharacterBody2D.move_and_slide" } });
    expect(textOf(ok)).toContain("CharacterBody2D.move_and_slide() -> bool");
    const old = (await client.callTool({ name: "godot_api", arguments: { query: "KinematicBody2D" } })) as Result;
    expect(old.isError).toBe(true);
    expect(textOf(old)).toContain("is called CharacterBody2D in Godot 4");
    const search = await client.callTool({ name: "godot_api_search", arguments: { query: "is on floor", limit: 3 } });
    expect(textOf(search)).toContain("CharacterBody2D.is_on_floor()");
  });

  it("reviews unsaved code before it is written", async () => {
    const code = "extends CharacterBody2D\n\n\nfunc _physics_process(delta: float) -> void:\n\tvelocity = move_and_slide(velocity, Vector2.UP)\n";
    const out = textOf(await client.callTool({ name: "godot_review", arguments: { code, file: "res://scripts/new_player.gd" } }));
    expect(out).toContain("findings in res://scripts/new_player.gd: 1 (1 errors)");
    expect(out).toContain("res://scripts/new_player.gd:5: error [api/wrong-arguments] move_and_slide() takes 0 arguments, but 2 are given.");
    const fixed = "extends CharacterBody2D\n\n\nfunc _physics_process(_delta: float) -> void:\n\tmove_and_slide()\n";
    const clean = textOf(await client.callTool({ name: "godot_review", arguments: { code: fixed, file: "scripts/new_player.gd" } }));
    expect(clean).toContain("No errors in these files.");
  });

  it("explains how to continue without Godot", async () => {
    const r = (await client.callTool({ name: "godot_check", arguments: {} })) as Result;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("not found or not executable");
  });

  it("returns errors as tool errors, not crashes", async () => {
    const r = (await client.callTool({ name: "godot_scan", arguments: { path: "/no/such/project" } })) as Result;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("No project.godot found");
  });
});

describe("MCP server (premium profile)", () => {
  let client: Client;
  let close: () => Promise<unknown>;
  beforeAll(async () => ({ client, close } = await connect("premium", `${FIXTURES}/messy`)));
  afterAll(() => close());

  it("gives full detail by default", async () => {
    const scan = textOf(await client.callTool({ name: "godot_scan", arguments: {} }));
    expect(scan).toContain("func DoDamage(amount)");
    const review = textOf(await client.callTool({ name: "godot_review", arguments: { files: ["res://scripts/enemy.gd"] } }));
    expect(review).toContain("fix: ");
    expect(review).toContain("[quality/naming]");
    expect(review).not.toContain("old_player.gd");
    const rules = textOf(await client.callTool({ name: "godot_checklist", arguments: {} }));
    expect(rules).toContain("[api/wrong-arguments] (error)");
  });

  it("describes all tools in its instructions", () => {
    expect(client.getInstructions()).toContain("godot_checklist lists every AAA rule");
    expect(client.getInstructions()).toContain("godot_feedback marks a review finding");
  });

  it("hides a finding after feedback says it is wrong", async () => {
    const files = ["res://scripts/old_player.gd"];
    const before = textOf(await client.callTool({ name: "godot_review", arguments: { files } }));
    const line = before.split("\n").find((l) => l.includes('Method "empty()"'))!;
    expect(line).toBeTruthy();
    const noted = textOf(await client.callTool({ name: "godot_feedback", arguments: { finding: line, verdict: "wrong" } }));
    expect(noted).toContain("api/unknown-member");
    const after = textOf(await client.callTool({ name: "godot_review", arguments: { files } }));
    expect(after).not.toContain('Method "empty()"');
    expect(after).toContain("1 finding hidden");
    const bad = (await client.callTool({ name: "godot_feedback", arguments: { finding: "nonsense", verdict: "wrong" } })) as Result;
    expect(bad.isError).toBe(true);
  });
});

describe("MCP Registry entry", () => {
  const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  const pkg = read("package.json") as { name: string; version: string; mcpName: string };
  const server = read("server.json") as {
    name: string;
    description: string;
    version: string;
    packages: { registryType: string; identifier: string; version: string; packageArguments: { value?: string }[] }[];
  };

  it("matches the npm package, so the registry accepts it", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0]).toMatchObject({ registryType: "npm", identifier: pkg.name, version: pkg.version });
    expect(server.packages[0]?.packageArguments[0]?.value).toBe("mcp");
  });
});
