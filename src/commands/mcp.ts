import { Command, Option } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { maybeShare } from "../learn/share.js";
import { createServer, type Tier } from "../mcp/server.js";
import { TOOLSET_NAMES, enabledTools, envFlag } from "../mcp/toolsets.js";
import { BASE_FILES_HELP, BASE_HELP, collect } from "./output.js";

const SHARE_CHECK_MS = 60 * 60 * 1000;

/**
 * The default project from $GODOTWRIGHT_PROJECT. Hosts that fill the variable from a setting (an MCP bundle
 * in Claude Desktop) may pass it empty, or as the unexpanded `${...}` placeholder when the setting is not set.
 */
export function projectFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env["GODOTWRIGHT_PROJECT"]?.trim();
  return value && !value.startsWith("${") ? value : undefined;
}

/** The tool sets from $GODOTWRIGHT_TOOLS; empty or an unexpanded `${...}` placeholder means all. */
export function toolsFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env["GODOTWRIGHT_TOOLS"]?.trim();
  return value && !value.startsWith("${") ? value : undefined;
}

export function mcpCommand(): Command {
  return new Command("mcp")
    .description("run the MCP server over stdio, for Claude Code, Codex and other agents")
    .addOption(
      new Option("--tier <tier>", "model profile: cheap (short output, strict steps) or premium (full detail)")
        .choices(["cheap", "premium"])
        .default(process.env["GODOTWRIGHT_TIER"] ?? "cheap"),
    )
    .option("--project <path>", "project directory the tools use by default (default: $GODOTWRIGHT_PROJECT, then the working directory)")
    .option("--godot <path>", "Godot binary for godot_check (default: $GODOT, then PATH, then the usual install folders)")
    .option(
      "--tools <sets>",
      `tool sets or tool names to offer, comma separated: ${TOOLSET_NAMES.join(", ")}, all (default: $GODOTWRIGHT_TOOLS, then all)`,
    )
    .option("--lean", "offer two tools (godot runs any tool by name, godot_help gives its parameters) instead of all: about 95% less tool list on every turn, and under any client's tool limit (default: $GODOTWRIGHT_LEAN)")
    .option("--read-only", "leave out the tools that always write and refuse write options (default: $GODOTWRIGHT_READ_ONLY)")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .action(async (options: { tier: Tier; project?: string; godot?: string; tools?: string; readOnly?: boolean; lean?: boolean; base: string[]; baseFiles: string[] }) => {
      const tools = options.tools ?? toolsFromEnv();
      enabledTools(tools); // an unknown name fails here, before the client connects
      const server = createServer({
        tier: options.tier,
        root: options.project ?? projectFromEnv(),
        godot: options.godot,
        tools,
        readOnly: options.readOnly === true || envFlag(process.env["GODOTWRIGHT_READ_ONLY"]),
        lean: options.lean === true || envFlag(process.env["GODOTWRIGHT_LEAN"]),
        base: options.base,
        baseFiles: options.baseFiles,
      });
      await server.connect(new StdioServerTransport());
      // Opt-in sharing: does nothing unless the user turned it on (godotwright learn share on).
      void maybeShare();
      setInterval(() => void maybeShare(), SHARE_CHECK_MS).unref();
    });
}
