import { Command, Option } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { maybeShare } from "../learn/share.js";
import { createServer, type Tier } from "../mcp/server.js";
import { BASE_FILES_HELP, BASE_HELP, collect } from "./output.js";

const SHARE_CHECK_MS = 60 * 60 * 1000;

/** The tier named by GODOTWRIGHT_TIER. Any other value is cheap, so a typo cannot stop the server from starting. */
function tierFromEnv(): Tier {
  const value = process.env["GODOTWRIGHT_TIER"];
  return value === "cheap" || value === "premium" ? value : "cheap";
}

export function mcpCommand(): Command {
  return new Command("mcp")
    .description("run the MCP server over stdio, for Claude Code, Codex and other agents")
    .addOption(
      new Option("--tier <tier>", "model profile: cheap (short output, strict steps) or premium (full detail)")
        .choices(["cheap", "premium"])
        .default(tierFromEnv()),
    )
    .option("--project <path>", "project directory the tools use by default (default: the working directory)")
    .option("--godot <path>", "Godot binary for godot_check (default: $GODOT, then PATH, then the usual install folders)")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .action(async (options: { tier: Tier; project?: string; godot?: string; base: string[]; baseFiles: string[] }, command: Command) => {
      const env = process.env["GODOTWRIGHT_TIER"];
      if (env && env !== "cheap" && env !== "premium" && command.getOptionValueSource("tier") === "default") {
        process.stderr.write(`note: GODOTWRIGHT_TIER="${env}" is not cheap or premium; using cheap\n`);
      }
      const server = createServer({ tier: options.tier, root: options.project, godot: options.godot, base: options.base, baseFiles: options.baseFiles });
      await server.connect(new StdioServerTransport());
      // Opt-in sharing: does nothing unless the user turned it on (godotwright learn share on).
      void maybeShare();
      setInterval(() => void maybeShare(), SHARE_CHECK_MS).unref();
    });
}
