import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolsFromEnv } from "../src/commands/mcp.js";
import { createServer, type ServerOptions } from "../src/mcp/server.js";
import { ALL_TOOLS, TOOLSETS, TOOLSET_NAMES, WRITE_ONLY_TOOLS, enabledTools, envFlag } from "../src/mcp/toolsets.js";
import { DEMO, makeProject } from "./helpers.js";

async function connect(options: ServerOptions) {
  const server = createServer({ root: DEMO, godot: "/no/such/godot", ...options });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

type Result = { content: { type: string; text: string }[]; isError?: boolean };
const textOf = (r: unknown) => (r as Result).content.map((c) => c.text).join("\n");

describe("tool sets", () => {
  it("puts every tool the server has in exactly one set", async () => {
    expect(new Set(ALL_TOOLS).size).toBe(ALL_TOOLS.length);
    const { client, close } = await connect({});
    const { tools } = await client.listTools();
    await close();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
  });

  it("reads set names, single tools and all, and names the valid sets for a typo", () => {
    expect([...enabledTools("core")]).toEqual([...TOOLSETS.core]);
    expect(enabledTools("core, godot_play").has("godot_play")).toBe(true);
    expect(enabledTools("model,play").has("godot_play")).toBe(true);
    expect(enabledTools("").size).toBe(ALL_TOOLS.length);
    expect(enabledTools("all,core").size).toBe(ALL_TOOLS.length);
    expect(() => enabledTools("cor")).toThrow(/unknown tool set or tool "cor"; use core, edit/);
    expect(toolsFromEnv({ GODOTWRIGHT_TOOLS: " core,run " })).toBe("core,run");
    expect(toolsFromEnv({ GODOTWRIGHT_TOOLS: "${user_config.tools}" })).toBeUndefined();
    expect(envFlag("1") && envFlag("true") && !envFlag("0") && !envFlag(undefined)).toBe(true);
  });

  it("offers only the core tools with --tools core, in a much smaller tool list", async () => {
    const all = await connect({});
    const allSize = JSON.stringify((await all.client.listTools()).tools).length;
    await all.close();
    const { client, close } = await connect({ tools: "core" });
    const { tools } = await client.listTools();
    await close();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLSETS.core].sort());
    const size = JSON.stringify(tools).length;
    expect(size).toBeLessThan(22_000);
    expect(size * 3).toBeLessThan(allSize);
  });

  it("names only enabled tools in the instructions, for every set and both tiers", async () => {
    for (const tier of ["cheap", "premium"] as const) {
      for (const set of [...TOOLSET_NAMES, "all"]) {
        for (const readOnly of [false, true]) {
          const { client, close } = await connect({ tier, tools: set, readOnly });
          const names = new Set((await client.listTools()).tools.map((t) => t.name));
          const instructions = client.getInstructions() ?? "";
          await close();
          const named = [...instructions.matchAll(/\bgodot_[a-z_]+/g)].map((m) => m[0]);
          expect(named.filter((n) => !names.has(n)), `${tier} ${set} ${readOnly}`).toEqual([]);
          expect(instructions).toContain("Godotwright gives you");
          if (readOnly) expect(instructions).toContain("This session is read-only");
        }
      }
    }
  });

  it("numbers the cheap steps without gaps when sets are left out", async () => {
    const { client, close } = await connect({ tier: "cheap", tools: "core" });
    const steps = (client.getInstructions() ?? "").split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split(".")[0]));
    await close();
    expect(steps).toEqual(steps.map((_, i) => i + 1));
    expect(steps.length).toBeGreaterThan(5);
  });
});

describe("read-only server", () => {
  it("leaves out the tools that always write and keeps the review and the learning tools", async () => {
    const { client, close } = await connect({ readOnly: true });
    const names = (await client.listTools()).tools.map((t) => t.name);
    await close();
    for (const tool of WRITE_ONLY_TOOLS) expect(names).not.toContain(tool);
    expect(names).toEqual(expect.arrayContaining(["godot_review", "godot_api", "godot_lessons", "godot_fix", "godot_scene_edit"]));
  });

  it("shows the dry run of an edit and refuses write: true without touching the file", async () => {
    const root = makeProject({
      "project.godot": "config_version=5\n",
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n',
      "hero.gd": "extends Node\n\nfunc _ready() -> void:\n\temit_signal(\"ready\")\n",
    });
    const before = readFileSync(join(root, "main.tscn"), "utf8");
    const { client, close } = await connect({ root, readOnly: true });
    const edit = { scene: "res://main.tscn", op: "add_node", parent: ".", name: "Box", type: "Node2D" };
    const dry = await client.callTool({ name: "godot_scene_edit", arguments: edit });
    expect(dry.isError).toBeFalsy();
    expect(textOf(dry)).toContain("Box");
    const write = await client.callTool({ name: "godot_scene_edit", arguments: { ...edit, write: true } });
    expect(write.isError).toBe(true);
    expect(textOf(write)).toContain("read-only session: godot_scene_edit with write: true is refused");
    const fix = await client.callTool({ name: "godot_fix", arguments: { write: true } });
    expect(fix.isError).toBe(true);
    const game = await client.callTool({ name: "godot_game", arguments: { op: "eval", expr: "1" } });
    expect(textOf(game)).toContain("op eval is refused");
    await close();
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toBe(before);
    expect(readFileSync(join(root, "hero.gd"), "utf8")).toContain("emit_signal");
  });
});
