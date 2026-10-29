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
  it("serves tools to a stdio client", { timeout: 30_000 }, async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp", "--tier", "premium"], cwd: DEMO, stderr: "pipe" });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.name).toBe("godotwright");
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(14);
      const result = (await client.callTool({ name: "godot_review", arguments: {} })) as { content: { text: string }[] };
      expect(result.content[0]!.text).toContain("overall 100/100");
    } finally {
      await client.close();
    }
  });
});
