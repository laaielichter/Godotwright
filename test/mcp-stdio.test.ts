import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { DEMO } from "./helpers.js";

/** Starts the built CLI the way agents do: `godotwright mcp` over stdio. Needs `npm run build`. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

describe.skipIf(!existsSync(CLI))("godotwright mcp over stdio", () => {
  it("says which tiers exist when GODOTWRIGHT_TIER is not one of them", { timeout: 30_000 }, () => {
    const run = spawnSync(process.execPath, [CLI, "mcp"], { cwd: DEMO, env: { ...process.env, GODOTWRIGHT_TIER: "Premium" }, input: "", encoding: "utf8", timeout: 20_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("tier must be cheap or premium");
  });

  it("serves tools to a stdio client", { timeout: 30_000 }, async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp", "--tier", "premium"], cwd: DEMO, stderr: "pipe" });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.name).toBe("godotwright");
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(12);
      const result = (await client.callTool({ name: "godot_review", arguments: {} })) as { content: { text: string }[] };
      expect(result.content[0]!.text).toContain("overall 100/100");
    } finally {
      await client.close();
    }
  });
});
