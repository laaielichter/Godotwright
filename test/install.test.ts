import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectFromEnv } from "../src/commands/mcp.js";
import { HOOK_EVENTS } from "../src/hooks/agent-hooks.js";

const SKILLS = ["godot", "review", "port", "learn", "debug", "perf", "patch", "model", "vehicles", "world"];

// The ways people install Godotwright: the Claude Code plugin and marketplace, the Gemini CLI extension,
// the Claude Desktop bundle and the one-click links on the install page. They name the package and its
// version in several files; these tests keep them in step with package.json.

const path = (file: string) => new URL(`../${file}`, import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(path(file), "utf8"));
const pkg = read("package.json") as { name: string; version: string };

interface Stdio {
  command: string;
  args: string[];
}

/** The arguments after `npx -y <package>`, checking the package is pinned to this version. */
function pinnedArgs(server: Stdio): string[] {
  expect(server.command).toBe("npx");
  expect(server.args.slice(0, 2)).toEqual(["-y", `${pkg.name}@${pkg.version}`]);
  return server.args.slice(2);
}

describe("Claude Code plugin and marketplace", () => {
  const marketplace = read(".claude-plugin/marketplace.json") as { name: string; plugins: { name: string; source: string }[] };
  const plugin = read("plugins/godotwright/.claude-plugin/plugin.json") as { name: string; version: string };
  const mcp = read("plugins/godotwright/.mcp.json") as { mcpServers: Record<string, Stdio> };

  it("lists the plugin under the name in its own manifest, at a path that exists", () => {
    expect(marketplace.plugins).toHaveLength(1);
    const entry = marketplace.plugins[0]!;
    expect(entry.name).toBe(plugin.name);
    expect(entry.source).toMatch(/^\.\/[^.]/);
    expect(existsSync(path(`${entry.source.slice(2)}/.claude-plugin/plugin.json`))).toBe(true);
  });

  it("has the package version and starts the MCP server of that version", () => {
    expect(plugin.version).toBe(pkg.version);
    expect(Object.keys(mcp.mcpServers)).toEqual(["godotwright"]);
    // No variable other than CLAUDE_PLUGIN_ROOT in the command, as the plugin directory asks. The server finds the
    // project from the folder Claude Code runs in.
    expect(pinnedArgs(mcp.mcpServers["godotwright"]!)).toEqual(["mcp", "--tier", "premium"]);
  });

  it("ships an icon, a README of at least 40 words, a license and a skill file for each skill folder", () => {
    expect(existsSync(path("plugins/godotwright/.claude-plugin/icon.png"))).toBe(true);
    expect(existsSync(path("plugins/godotwright/LICENSE"))).toBe(true);
    const readme = readFileSync(path("plugins/godotwright/README.md"), "utf8").replace(/```[\s\S]*?```/g, "");
    expect(readme.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    for (const skill of SKILLS) {
      const text = readFileSync(path(`plugins/godotwright/skills/${skill}/SKILL.md`), "utf8");
      expect(text).toMatch(new RegExp(`^---\\nname: ${skill}\\ndescription: .+`, "m"));
    }
    expect(readdirSync(path("plugins/godotwright/skills")).sort()).toEqual([...SKILLS].sort());
  });

  it("names only MCP tools the server has, in every skill and agent", () => {
    const tools = new Set([...readFileSync(path("src/mcp/server.ts"), "utf8").matchAll(/registerTool\(\s*"(godot_\w+)"/g)].map((m) => m[1]));
    expect(tools.size).toBeGreaterThan(20);
    const files = [
      ...SKILLS.map((s) => `plugins/godotwright/skills/${s}/SKILL.md`),
      ...readdirSync(path("plugins/godotwright/agents")).map((a) => `plugins/godotwright/agents/${a}`),
    ];
    for (const file of files) {
      for (const [name] of readFileSync(path(file), "utf8").matchAll(/\bgodot_[a-z_]+\b/g)) expect(tools.has(name), `${file}: ${name}`).toBe(true);
    }
  });

  it("ships subagents with a name and a description", () => {
    for (const agent of ["godot-reviewer", "godot-debugger"]) {
      const text = readFileSync(path(`plugins/godotwright/agents/${agent}.md`), "utf8");
      expect(text).toMatch(new RegExp(`^---\\nname: ${agent}\\ndescription: .{80,}`, "m"));
    }
  });

  it("runs its hooks through the shim, for events and scripts that exist", () => {
    const hooks = read("plugins/godotwright/hooks/hooks.json") as { hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]> };
    expect(Object.keys(hooks.hooks).sort()).toEqual(["PostToolUse", "SessionStart", "Stop"]);
    const events = new Set<string>();
    for (const groups of Object.values(hooks.hooks)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          expect(hook.type).toBe("command");
          const m = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/run\.mjs" ([a-z-]+)$/.exec(hook.command);
          expect(m, hook.command).not.toBeNull();
          events.add(m![1]!);
        }
      }
    }
    expect([...events].sort()).toEqual([...HOOK_EVENTS].sort());
    expect(existsSync(path("plugins/godotwright/hooks/run.mjs"))).toBe(true);
  });
});

describe("Gemini CLI extension", () => {
  const ext = read("gemini-extension.json") as { name: string; version: string; mcpServers: Record<string, Stdio> };

  it("has the package version and starts the MCP server of that version", () => {
    expect(ext.name).toBe(pkg.name);
    expect(ext.version).toBe(pkg.version);
    expect(pinnedArgs(ext.mcpServers["godotwright"]!)).toEqual(["mcp", "--tier", "premium"]);
  });
});

describe("Claude Desktop bundle", () => {
  const manifest = read("mcpb/manifest.json") as {
    name: string;
    icon: string;
    server: { type: string; entry_point: string; mcp_config: { command: string; args: string[]; env: Record<string, string> } };
    user_config: Record<string, { type: string; required: boolean }>;
  };

  it("runs the built CLI as an MCP server, with settings that exist", () => {
    expect(manifest.name).toBe(pkg.name);
    expect(manifest.server).toMatchObject({ type: "node", entry_point: "dist/cli.js" });
    expect(manifest.server.mcp_config.args).toEqual(["${__dirname}/dist/cli.js", "mcp", "--tier", "premium"]);
    expect(existsSync(path(`mcpb/${manifest.icon}`))).toBe(true);
    for (const value of Object.values(manifest.server.mcp_config.env)) {
      const key = /^\$\{user_config\.(\w+)\}$/.exec(value)?.[1];
      expect(key && manifest.user_config[key]).toBeTruthy();
    }
  });
});

describe("install page", () => {
  const html = readFileSync(path("docs/install.html"), "utf8").replaceAll("&amp;", "&");
  const expected = { command: "npx", args: ["-y", "godotwright", "mcp", "--tier", "premium"] };

  it("has a Cursor link that installs the MCP server", () => {
    const config = /cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=godotwright&config=([A-Za-z0-9+/=]+)/.exec(html)?.[1];
    expect(config).toBeDefined();
    expect(JSON.parse(Buffer.from(config!, "base64").toString("utf8"))).toEqual(expected);
  });

  it("has VS Code and VS Code Insiders links that install the MCP server", () => {
    for (const scheme of ["vscode", "vscode-insiders"]) {
      const config = new RegExp(`"${scheme}:mcp/install\\?([^"]+)"`).exec(html)?.[1];
      expect(config).toBeDefined();
      expect(JSON.parse(decodeURIComponent(config!))).toEqual({ name: "godotwright", type: "stdio", ...expected });
    }
  });
});

describe("projectFromEnv", () => {
  it("reads $GODOTWRIGHT_PROJECT and ignores an empty value or an unexpanded placeholder", () => {
    expect(projectFromEnv({ GODOTWRIGHT_PROJECT: "/games/my-game" })).toBe("/games/my-game");
    expect(projectFromEnv({ GODOTWRIGHT_PROJECT: "  " })).toBeUndefined();
    expect(projectFromEnv({ GODOTWRIGHT_PROJECT: "${user_config.project}" })).toBeUndefined();
    expect(projectFromEnv({})).toBeUndefined();
  });
});
