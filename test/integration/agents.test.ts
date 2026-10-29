import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEMO } from "../helpers.js";

/**
 * Connects real agent CLIs to `godotwright mcp`. Needs the built CLI, plus
 * `claude` (Claude Code) and `codex` (Codex CLI) on PATH. CI sets AGENT_CLIS=1.
 */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli.js");
const enabled = process.env["AGENT_CLIS"] === "1" && existsSync(CLI);

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "godotwright-agent-"));
  cpSync(DEMO, dir, { recursive: true });
  return dir;
}

describe.skipIf(!enabled)("agent CLIs talk to godotwright mcp", () => {
  it("Claude Code connects", { timeout: 120_000 }, () => {
    const cwd = project();
    const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), "claude-home-")) };
    execFileSync("claude", ["mcp", "add", "godotwright", "-s", "local", "--", process.execPath, CLI, "mcp"], { cwd, env });
    const out = execFileSync("claude", ["mcp", "get", "godotwright"], { cwd, env, encoding: "utf8" });
    console.log(out);
    expect(out).toMatch(/Status: .*Connected/);
  });

  it("Codex lists the tools and calls one", { timeout: 120_000 }, async () => {
    const cwd = project();
    const env = { ...process.env, CODEX_HOME: mkdtempSync(join(tmpdir(), "codex-home-")) };
    execFileSync("codex", ["mcp", "add", "godotwright", "--", process.execPath, CLI, "mcp"], { cwd, env });

    // Drive Codex's app-server (JSON-RPC over stdio); no model or login needed.
    const child = spawn("codex", ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const pending = new Map<number, (msg: { result?: unknown; error?: unknown }) => void>();
    let buffer = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
        if (msg.id !== undefined) pending.get(msg.id)?.(msg);
      }
    });
    let next = 0;
    const call = (method: string, params: unknown) =>
      new Promise<{ result?: any; error?: unknown }>((resolve) => {
        const id = ++next;
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    try {
      expect((await call("initialize", { clientInfo: { name: "godotwright-ci", version: "1.0.0" } })).error).toBeUndefined();
      child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
      const status = await call("mcpServerStatus/list", { serverName: "godotwright" });
      const tools = Object.keys(status.result?.data?.[0]?.tools ?? {}).sort();
      console.log("codex sees:", tools.join(", "));
      expect(tools).toEqual(["godot_api", "godot_api_search", "godot_check", "godot_checklist", "godot_feedback", "godot_migrate", "godot_model_brief", "godot_model_build", "godot_model_identify", "godot_model_inspect", "godot_model_lint", "godot_model_spec", "godot_model_view", "godot_project_edit", "godot_rename", "godot_review", "godot_scan", "godot_scene_edit", "godot_test", "godot_usages"]);
      const thread = await call("thread/start", { cwd });
      const threadId = thread.result?.thread?.id;
      expect(threadId).toBeTruthy();
      const result = await call("mcpServer/tool/call", { server: "godotwright", threadId, tool: "godot_api", arguments: { query: "Node2D.look_at" } });
      const text = JSON.stringify(result.result);
      console.log("codex tool call:", text.slice(0, 200));
      expect(text).toContain("Node2D.look_at(point: Vector2) -> void");
    } finally {
      child.kill();
    }
  });
});
