#!/usr/bin/env node
// Runs `godotwright hook <event>` for Claude Code with the hook input on stdin, using the same godotwright version as
// the plugin's MCP server (the version in .claude-plugin/plugin.json). Set GODOTWRIGHT_CLI to the path of a local
// dist/cli.js to use a build instead, and GODOTWRIGHT_HOOKS=0 to turn the hooks off.
// It fails open: when godotwright cannot run, is too old to know the event, or takes too long, it prints nothing and
// exits 0, so a hook never stands in the way.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const event = process.argv[2];
if (!event || process.env.GODOTWRIGHT_HOOKS === "0") process.exit(0);

let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

/**
 * Whether any protection can apply: a protect setting, or a godotwright.json with "protect" in or above the file's
 * folder, the session's folder or the default project, or in a direct subfolder of the session's folder (the same
 * places godotwright looks). Cheap, so most edits never start godotwright.
 */
function maybeProtected(file, cwd) {
  const set = (v) => Boolean(v && v.trim() && !v.trim().startsWith("${"));
  if (set(process.env.GODOTWRIGHT_PROTECT) || set(process.env.CLAUDE_PLUGIN_OPTION_PROTECT)) return true;
  const base = cwd || process.cwd();
  const has = (dir) => {
    const config = join(dir, "godotwright.json");
    return existsSync(config) && readFileSync(config, "utf8").includes('"protect"');
  };
  const above = (start) => {
    for (let dir = resolve(base, start); ; dir = dirname(dir)) {
      if (has(dir)) return true;
      if (dirname(dir) === dir) return false;
    }
  };
  const project = [process.env.GODOTWRIGHT_PROJECT, process.env.CLAUDE_PLUGIN_OPTION_PROJECT].find(set);
  if ((file && above(dirname(isAbsolute(file) ? file : resolve(base, file)))) || above(base) || (project && above(project))) return true;
  return readdirSync(base, { withFileTypes: true }).some((e) => e.isDirectory() && has(join(base, e.name)));
}

// Only Godot files, Godot output and writes near a "protect" list are worth starting godotwright for.
try {
  const data = JSON.parse(input || "{}");
  const file = String(data?.tool_input?.file_path ?? data?.tool_input?.notebook_path ?? "");
  if (event === "pre-edit" && !maybeProtected(file, data?.cwd)) process.exit(0);
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
