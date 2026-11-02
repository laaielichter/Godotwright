import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pluginOptions } from "../src/commands/hook.js";
import { preEdit, runHook } from "../src/hooks/agent-hooks.js";
import { JournalWriter, undoJournal } from "../src/journal/journal.js";
import { createServer } from "../src/mcp/server.js";
import { ProtectedPathError, assertWritable, protectionOf } from "../src/project/protect.js";
import { runCli, tempFolder } from "./helpers.js";

const SCENE = '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n';
const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Game"\n';

/** A workspace as in a mod project: the installed game and a base project kept byte-identical, a candidate to work in. */
function workspace(protect: unknown = ["installed-code", "baseline-authoring"]) {
  const top = tempFolder("gw-protect-");
  for (const dir of ["installed-code", "baseline-authoring", "development/candidate"]) {
    mkdirSync(join(top, dir), { recursive: true });
    writeFileSync(join(top, dir, "project.godot"), PROJECT);
    writeFileSync(join(top, dir, "main.tscn"), SCENE);
  }
  writeFileSync(join(top, "godotwright.json"), JSON.stringify({ protect }));
  return top;
}

const deny = (out: ReturnType<typeof preEdit>) => out?.hookSpecificOutput?.permissionDecision;

describe("protected paths", () => {
  it("protects what a godotwright.json above names, and nothing else", () => {
    const top = workspace();
    expect(protectionOf(join(top, "installed-code", "main.tscn"))?.path).toBe(join(top, "installed-code"));
    expect(protectionOf(join(top, "baseline-authoring", "new", "file.gd"))?.source).toBe(join(top, "godotwright.json"));
    expect(protectionOf(join(top, "development", "candidate", "main.tscn"))).toBeUndefined();
    expect(protectionOf(join(top, "installed-code-copy", "x.gd"))).toBeUndefined();
    // Godot's cache inside a protected project is Godot's to rewrite.
    expect(protectionOf(join(top, "installed-code", ".godot", "godotwright", "check.gd"))).toBeUndefined();
    expect(() => assertWritable(join(top, "installed-code", "main.tscn"))).toThrow(ProtectedPathError);
  });

  it("reads res:// and ../ entries of a project's own godotwright.json, and $GODOTWRIGHT_PROTECT", () => {
    const top = workspace([]);
    writeFileSync(join(top, "installed-code", "godotwright.json"), JSON.stringify({ protect: ["res://", "../baseline-authoring"] }));
    expect(protectionOf(join(top, "installed-code", "a.gd"))).toBeDefined();
    // ../baseline-authoring counts when the project is the default one, or a folder in the session's folder.
    expect(protectionOf(join(top, "baseline-authoring", "a.gd"), {}, join(top, "development"))).toBeUndefined();
    expect(protectionOf(join(top, "baseline-authoring", "a.gd"), {}, top)?.source).toBe(join(top, "installed-code", "godotwright.json"));
    expect(protectionOf(join(top, "baseline-authoring", "a.gd"), { GODOTWRIGHT_PROJECT: join(top, "installed-code") }, join(top, "development"))).toBeDefined();
    const env = { GODOTWRIGHT_PROTECT: `${join(top, "baseline-authoring")},${join(top, "nothing")}` };
    expect(protectionOf(join(top, "baseline-authoring", "a.gd"), env)?.source).toBe("$GODOTWRIGHT_PROTECT");
    expect(protectionOf(join(top, "development", "a.gd"), { GODOTWRIGHT_PROTECT: "${user_config.protect}" })).toBeUndefined();
  });

  it("refuses journaled writes, keeping what was written before in the journal", () => {
    const top = workspace(["development/candidate/locked.gd"]);
    const root = join(top, "development", "candidate");
    const journal = new JournalWriter(root, "test", "two files");
    journal.write(join(root, "free.gd"), "extends Node\n");
    expect(() => journal.write(join(root, "locked.gd"), "extends Node\n")).toThrow(/locked\.gd is protected/);
    expect(existsSync(join(root, "locked.gd"))).toBe(false);
    // The first write can still be undone.
    expect(undoJournal(root).undone[0]?.removed).toEqual(["res://free.gd"]);
  });
});

describe("pre-edit hook", () => {
  it("denies Write, Edit, MultiEdit and NotebookEdit into a protected path, with the reason", () => {
    const top = workspace();
    for (const [tool, key] of [["Write", "file_path"], ["Edit", "file_path"], ["MultiEdit", "file_path"], ["NotebookEdit", "notebook_path"]] as const) {
      const out = preEdit({ cwd: top, tool_name: tool, tool_input: { [key]: join(top, "installed-code", "main.tscn") } }, { env: {} });
      expect(deny(out), tool).toBe("deny");
      expect(out?.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
      expect(out?.hookSpecificOutput?.permissionDecisionReason).toMatch(/installed-code.* is protected .*"protect" of .*godotwright\.json.*byte-identical/);
    }
    // Relative paths start at the session's folder.
    expect(deny(preEdit({ cwd: top, tool_input: { file_path: "baseline-authoring/x.gd" } }, { env: {} }))).toBe("deny");
  });

  it("allows the candidate, files without protection and input it cannot read", () => {
    const top = workspace();
    expect(preEdit({ cwd: top, tool_input: { file_path: join(top, "development", "candidate", "main.tscn") } }, { env: {} })).toBeUndefined();
    expect(preEdit({ cwd: top, tool_input: {} }, { env: {} })).toBeUndefined();
    expect(runHook("pre-edit", {} as never)).toBeUndefined();
  });

  it("prints the deny JSON from the CLI, and nothing for garbage on stdin", async () => {
    const top = workspace();
    const input = JSON.stringify({ cwd: top, hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: join(top, "installed-code", "main.tscn") } });
    const out = await runCli(["hook", "pre-edit", "--input", input]);
    expect(JSON.parse(out.output).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(await runCli(["hook", "pre-edit", "--input", "{not json"])).toEqual({ output: "", exitCode: 0 });
  });

  it("maps the plugin's settings onto the variables Godotwright reads, without overriding them", () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_PLUGIN_OPTION_GODOT: "/g/godot", CLAUDE_PLUGIN_OPTION_PROTECT: "a,b", CLAUDE_PLUGIN_OPTION_PROJECT: "${user_config.project}", GODOT: "" };
    pluginOptions(env);
    expect([env["GODOT"], env["GODOTWRIGHT_PROTECT"], env["GODOTWRIGHT_PROJECT"]]).toEqual(["/g/godot", "a,b", undefined]);
    const set: NodeJS.ProcessEnv = { CLAUDE_PLUGIN_OPTION_GODOT: "/g/godot", GODOT: "/mine" };
    pluginOptions(set);
    expect(set["GODOT"]).toBe("/mine");
  });
});

describe("the plugin's hook shim with Claude Code hook JSON on stdin", () => {
  const shim = new URL("../plugins/godotwright/hooks/run.mjs", import.meta.url).pathname;
  const cli = new URL("../dist/cli.js", import.meta.url).pathname;
  const run = (input: object, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [shim, "pre-edit"], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, GODOTWRIGHT_PROTECT: "", CLAUDE_PLUGIN_OPTION_PROTECT: "", ...env } });

  it("does not start godotwright when no protect list is in reach", () => {
    const top = tempFolder("gw-free-");
    const r = run({ cwd: top, tool_name: "Write", tool_input: { file_path: join(top, "a.gd") } }, { GODOTWRIGHT_CLI: "/nonexistent/cli.js" });
    expect([r.status, r.stdout]).toEqual([0, ""]);
  });

  it("fails open when godotwright cannot run", () => {
    const top = workspace();
    const r = run({ cwd: top, tool_name: "Write", tool_input: { file_path: join(top, "installed-code", "a.gd") } }, { GODOTWRIGHT_CLI: "/nonexistent/cli.js" });
    expect([r.status, r.stdout]).toEqual([0, ""]);
  });

  it.skipIf(!existsSync(cli))("denies through the built CLI (npm run build first)", () => {
    const top = workspace();
    const r = run({ cwd: top, hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: join(top, "installed-code", "main.tscn") } }, { GODOTWRIGHT_CLI: cli });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    const ok = run({ cwd: top, tool_name: "Edit", tool_input: { file_path: join(top, "development", "candidate", "main.tscn") } }, { GODOTWRIGHT_CLI: cli });
    expect([ok.status, ok.stdout]).toEqual([0, ""]);
  });
});

describe("Godotwright's write tools in a protected project", () => {
  async function connect(root: string) {
    const server = createServer({ root, godot: "/no/such/godot" });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
  }
  type Result = { content: { text: string }[]; isError?: boolean };

  it("refuses scene, project, rename, model and undo writes, and still shows dry runs", async () => {
    const top = workspace();
    const root = join(top, "installed-code");
    const before = readFileSync(join(root, "main.tscn"), "utf8");
    const { client, close } = await connect(root);
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result;
    const edit = { scene: "res://main.tscn", op: "add_node", parent: ".", name: "Box", type: "Node2D" };
    expect((await call("godot_scene_edit", edit)).isError).toBeFalsy();
    const refused = [
      await call("godot_scene_edit", { ...edit, write: true }),
      await call("godot_project_edit", { op: "set", key: "application/config/description", value: '"x"', write: true }),
      await call("godot_rename", { from: "res://main.tscn", to: "res://moved.tscn", write: true }),
      await call("godot_model_build", { kind: "house", out: "models/house.glb" }),
    ];
    for (const r of refused) {
      expect(r.isError, r.content[0]?.text).toBe(true);
      expect(r.content[0]?.text).toMatch(/is protected/);
    }
    await close();
    expect(readFileSync(join(root, "main.tscn"), "utf8")).toBe(before);
    expect(readFileSync(join(root, "project.godot"), "utf8")).toBe(PROJECT);
    expect(existsSync(join(root, "models"))).toBe(false);
    expect(existsSync(join(root, "moved.tscn"))).toBe(false);
  });

  it("refuses an undo that would write into a protected path", async () => {
    const top = workspace([]);
    const root = join(top, "installed-code");
    const journal = new JournalWriter(root, "test", "one file");
    journal.write(join(root, "a.gd"), "extends Node\n");
    journal.commit();
    writeFileSync(join(top, "godotwright.json"), JSON.stringify({ protect: ["installed-code"] }));
    const { client, close } = await connect(root);
    const r = (await client.callTool({ name: "godot_undo", arguments: {} })) as Result;
    await close();
    expect(r.isError).toBe(true);
    expect(existsSync(join(root, "a.gd"))).toBe(true);
  });
});
