import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { emptyFacts, readTranscript } from "../src/dream/transcripts.js";
import { createServer, type ServerOptions } from "../src/mcp/server.js";
import { ALL_TOOLS } from "../src/mcp/toolsets.js";
import { mcpCommand } from "../src/commands/mcp.js";
import { DEMO, makeProject } from "./helpers.js";

async function connect(options: ServerOptions) {
  const server = createServer({ root: DEMO, godot: "/no/such/godot", ...options });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

type Result = { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
const textOf = (r: unknown) => (r as Result).content.map((c) => c.text).join("\n");

describe("lean mode", () => {
  it("offers two tools, in a tool list at least twenty times smaller, that still names every tool", async () => {
    const full = await connect({});
    const fullSize = JSON.stringify((await full.client.listTools()).tools).length;
    await full.close();
    const { client, close } = await connect({ lean: true });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["godot", "godot_help"]);
    const size = JSON.stringify(tools).length;
    expect(size).toBeLessThan(5_000);
    expect(size * 20).toBeLessThan(fullSize);
    const router = tools[0]!.description!;
    for (const name of ALL_TOOLS) expect(router).toContain(`${name.replace(/^godot_/, "")} (`);
    expect(client.getInstructions()).toMatch(/^This server runs lean: its tools are not in your tool list\. Run any tool named below with `godot`/);
    expect(client.getInstructions()).toContain("godot_scan");
    await close();
  });

  it("runs any tool by name, with the tool's own result", async () => {
    const { client, close } = await connect({ lean: true });
    const call = async (args: Record<string, unknown>) => (await client.callTool({ name: "godot", arguments: args })) as Result;
    const api = await call({ tool: "api", args: { query: "Node2D.look_at" } });
    expect(api.isError).toBeFalsy();
    expect(textOf(api)).toContain("look_at(point: Vector2)");
    // The full name works too, and a tool without required arguments needs no args.
    expect(textOf(await call({ tool: "godot_scan" }))).toContain("Demo Game");
    // Structured results pass through.
    const review = await call({ tool: "Review", args: { files: ["res://scripts/player.gd"] } });
    expect(review.structuredContent).toHaveProperty("findings");
    await close();
  });

  it("answers a wrong call with what is wrong and the tool's parameters", async () => {
    const { client, close } = await connect({ lean: true });
    const call = async (args: Record<string, unknown>) => (await client.callTool({ name: "godot", arguments: args })) as Result;
    const missing = await call({ tool: "api" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/^godot_api: query: .*\nParameters \(\? = optional\):\n  query: string  /);
    const typo = await call({ tool: "review", args: { file: "res://a.gd", paths: 1 } });
    expect(typo.isError).toBe(true);
    expect(textOf(typo)).toMatch(/^godot_review: no parameter paths\n/);
    expect(textOf(typo)).toContain("  files?: string[]  ");
    const unknown = await call({ tool: "reveiw" });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toBe('no tool "reveiw"; did you mean review? Call godot_help without arguments for the list.');
    await close();
  });

  it("explains a tool, finds one by words, and lists them all", async () => {
    const { client, close } = await connect({ lean: true });
    const help = async (args: Record<string, unknown> = {}) => (await client.callTool({ name: "godot_help", arguments: args })) as Result;
    const one = textOf(await help({ tool: "collisions" }));
    expect(one).toMatch(/^godot_collisions: Physics layers and masks: who detects whom\n/);
    expect(one).toContain('  between?: string[]  two names: who detects whom');
    expect(one).toContain('  detail?: "brief" | "full"  ');
    expect(one).toMatch(/Call it: godot \{"tool": "collisions", "args": \{\.\.\.\}\}$/);
    const found = textOf(await help({ query: "rename a function everywhere" }));
    expect(found).toMatch(/^godot_rename: Rename everywhere\n/);
    expect(found).toContain("\nAlso:\n");
    const all = textOf(await help());
    expect(all).toMatch(new RegExp(`^${ALL_TOOLS.length} tools, by set`));
    expect(all).toContain("\nverify: diff (");
    expect((await help({ tool: "nope" })).isError).toBe(true);
    expect(textOf(await help({ query: "zzzz qqqq" }))).toMatch(/^no tool matches "zzzz qqqq"\. All tools:\ncore: /);
    await close();
  });

  it("keeps tool sets and read-only: only the enabled tools exist, and writes are refused", async () => {
    const root = makeProject({ "project.godot": 'config_version=5\n\n[application]\nconfig/name="G"\n' });
    const { client, close } = await connect({ lean: true, tools: "core,godot_project_edit", readOnly: true, root });
    const { tools } = await client.listTools();
    expect(tools[0]!.description).not.toContain("play (");
    expect(tools[0]!.description).not.toContain("undo (");
    expect(tools[0]!.annotations?.destructiveHint).toBe(false);
    const call = async (args: Record<string, unknown>) => (await client.callTool({ name: "godot", arguments: args })) as Result;
    expect(textOf(await call({ tool: "play", args: {} }))).toMatch(/^no tool "play"/);
    const write = await call({ tool: "project_edit", args: { op: "set", key: "application/config/name", value: "H", write: true } });
    expect(write.isError).toBe(true);
    expect(textOf(write)).toMatch(/read-only session: godot_project_edit with write: true is refused/);
    await close();
  });

  it("is switched on by --lean, and its calls count in a transcript like direct ones", async () => {
    expect(mcpCommand().helpInformation()).toContain("--lean");
    const facts = emptyFacts();
    readTranscript(
      [
        { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "mcp__godotwright__godot", input: { tool: "review", args: { files: ["res://a.gd"] } } }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "b", name: "mcp__godotwright__godot", input: { tool: "godot_check" } }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "c", name: "mcp__godotwright__godot_help", input: { tool: "review" } }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "d", name: "mcp__other__godot", input: { tool: "review" } }] } },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
      facts,
    );
    expect(facts.toolCalls).toEqual({ godot_review: 1, godot_check: 1 });
  });
});
