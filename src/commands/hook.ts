import { join } from "node:path";
import { Command, Option } from "commander";
import { HOOK_EVENTS, runHook, type HookEvent, type HookInput } from "../hooks/agent-hooks.js";
import { writeOut } from "./output.js";

/** Reads all of stdin; an empty string when nothing is piped in. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The Claude Code plugin's settings (userConfig) reach hooks as CLAUDE_PLUGIN_OPTION_<KEY>; they fill the variables
 * Godotwright already reads, unless those are set.
 */
export function pluginOptions(env: NodeJS.ProcessEnv): void {
  const map: [string, string][] = [
    ["CLAUDE_PLUGIN_OPTION_GODOT", "GODOT"],
    ["CLAUDE_PLUGIN_OPTION_PROJECT", "GODOTWRIGHT_PROJECT"],
    ["CLAUDE_PLUGIN_OPTION_PROTECT", "GODOTWRIGHT_PROTECT"],
  ];
  for (const [from, to] of map) {
    const value = env[from]?.trim();
    if (value && !value.startsWith("${") && !env[to]?.trim()) env[to] = value;
  }
}

export function hookCommand(): Command {
  return new Command("hook")
    .description(
      "run as a coding-agent hook (Claude Code hook JSON on stdin, hook JSON on stdout): pre-edit denies a write into a protected path, post-edit reviews an edited Godot file, " +
        "post-bash adds lessons under Godot errors in a command's output, stop names review errors left in changed files, " +
        "session-start describes the project. Says nothing when it has nothing to add or anything fails; GODOTWRIGHT_HOOKS=0 turns it off",
    )
    .addArgument(new Command().createArgument("<event>", "the hook event").choices(HOOK_EVENTS))
    .addOption(new Option("--input <json>", "the hook input as JSON instead of stdin (for testing)").hideHelp())
    .action(async (event: HookEvent, options: { input?: string }, command: Command) => {
      if (process.env["GODOTWRIGHT_HOOKS"] === "0") return;
      try {
        pluginOptions(process.env);
        const raw = options.input ?? (await readStdin());
        const input = (raw.trim() ? JSON.parse(raw) : {}) as HookInput;
        // A plugin's own data folder keeps the per-session state when Claude Code gives one.
        const data = process.env["CLAUDE_PLUGIN_DATA"];
        const output = runHook(event, input, data ? { stateDir: join(data, "hook-state") } : {});
        if (output) writeOut(command, `${JSON.stringify(output)}\n`);
      } catch (error) {
        // A hook must never stand in the agent's way.
        if (process.env["GODOTWRIGHT_DEBUG"]) process.stderr.write(`godotwright hook ${event}: ${error instanceof Error ? error.stack : String(error)}\n`);
      }
    });
}
