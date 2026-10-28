import { Command, Option } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, type Tier } from "../mcp/server.js";

export function mcpCommand(): Command {
  return new Command("mcp")
    .description("run the MCP server over stdio, for Claude Code, Codex and other agents")
    .addOption(
      new Option("--tier <tier>", "model profile: cheap (short output, strict steps) or premium (full detail)")
        .choices(["cheap", "premium"])
        .default(process.env["GODOTWRIGHT_TIER"] ?? "cheap"),
    )
    .option("--project <path>", "project directory the tools use by default (default: the working directory)")
    .option("--godot <path>", "Godot binary for godot_check (default: $GODOT, then PATH)")
    .action(async (options: { tier: Tier; project?: string; godot?: string }) => {
      const server = createServer({ tier: options.tier, root: options.project, godot: options.godot });
      await server.connect(new StdioServerTransport());
    });
}
