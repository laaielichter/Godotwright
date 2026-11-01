#!/usr/bin/env node
// Runs `godotwright hook <event>` for Claude Code with the hook input on stdin, using the same godotwright version as
// the plugin's MCP server (the version in .claude-plugin/plugin.json). Set GODOTWRIGHT_CLI to the path of a local
// dist/cli.js to use a build instead, and GODOTWRIGHT_HOOKS=0 to turn the hooks off.
// It fails open: when godotwright cannot run, is too old to know the event, or takes too long, it prints nothing and
// exits 0, so a hook never stands in the way.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const event = process.argv[2];
if (!event || process.env.GODOTWRIGHT_HOOKS === "0") process.exit(0);

let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

// Only Godot files and Godot output are worth starting godotwright for.
try {
  const data = JSON.parse(input || "{}");
  const file = String(data?.tool_input?.file_path ?? "");
  if (event === "post-edit" && !/\.(gd|tscn|tres|gdshader)$|project\.godot$/.test(file)) process.exit(0);
  if (event === "post-bash") {
    const r = data?.tool_response;
    const text = typeof r === "string" ? r : `${r?.stdout ?? ""}\n${r?.stderr ?? ""}`;
    if (!/^(?:SCRIPT ERROR|USER ERROR|ERROR|Parse Error):/m.test(text)) process.exit(0);
  }
} catch {
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let version = "latest";
try {
  version = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")).version ?? version;
} catch {
  // Use the latest release.
}
const local = process.env.GODOTWRIGHT_CLI;
const windows = process.platform === "win32";
const [command, args] = local
  ? [process.execPath, [local, "hook", event]]
  : [windows ? "npx.cmd" : "npx", ["-y", `godotwright@${version}`, "hook", event]];
const result = spawnSync(command, args, {
  input,
  encoding: "utf8",
  timeout: 110_000,
  shell: windows && !local,
  env: { ...process.env, GODOTWRIGHT_HOOK: "1" },
});
if (result.status === 0 && result.stdout?.trim().startsWith("{")) process.stdout.write(result.stdout);
process.exit(0);
