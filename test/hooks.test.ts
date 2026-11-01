import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { postBash, postEdit, sessionStart, stop, type HookInput } from "../src/hooks/agent-hooks.js";
import { makeProject, runCli, tempFolder } from "./helpers.js";

const PROJECT = 'config_version=5\n[application]\nconfig/name="Hooked"\nconfig/features=PackedStringArray("4.7", "Forward Plus")\nrun/main_scene="res://main.tscn"\n';
const BROKEN = 'extends CharacterBody2D\n\nfunc _physics_process(_delta: float) -> void:\n\tmove_and_slide(Vector2.ZERO)\n';
const FIXED = "extends CharacterBody2D\n\nfunc _physics_process(_delta: float) -> void:\n\tmove_and_slide()\n";

function setup(files: Record<string, string> = {}) {
  const root = makeProject({ "project.godot": PROJECT, "player.gd": BROKEN, ...files });
  const context = { stateDir: tempFolder("gw-hooks-") };
  const edit = (file: string, session = "s1"): HookInput => ({ session_id: session, cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, file) } });
  return { root, context, edit };
}

describe("agent hooks", () => {
  it("send the errors of an edited script back to the agent, with the rule and line", () => {
    const { context, edit } = setup();
    const out = postEdit(edit("player.gd"), context);
    expect(out?.decision).toBe("block");
    expect(out?.reason).toMatch(/res:\/\/player\.gd:4 error \[api\/wrong-arguments\]/);
    expect(out?.reason).toMatch(/godot_feedback/);
  });

  it("stay quiet for clean files, files outside a Godot project, other file types and add-ons", () => {
    const { root, context, edit } = setup({ "clean.gd": FIXED, "notes.md": "x", "addons/x/broken.gd": BROKEN });
    expect(postEdit(edit("clean.gd"), context)).toBeUndefined();
    expect(postEdit(edit("notes.md"), context)).toBeUndefined();
    expect(postEdit(edit("addons/x/broken.gd"), context)).toBeUndefined();
    const outside = tempFolder("gw-outside-");
    expect(postEdit({ tool_input: { file_path: join(outside, "a.gd") } }, context)).toBeUndefined();
    expect(postEdit({ cwd: root, tool_input: { file_path: "clean.gd" } }, context)).toBeUndefined();
  });

  it("mention warnings without blocking", () => {
    const { context, edit } = setup({ "warn.gd": 'extends Node\n\nfunc _ready() -> void:\n\tvar data: Dictionary = JSON.parse_string("{}")\n\tprint(data)\n' });
    const out = postEdit(edit("warn.gd"), context);
    expect(out?.decision).toBeUndefined();
    expect(out?.hookSpecificOutput?.additionalContext).toMatch(/api\/parse-into-typed/);
  });

  it("say once at the end when changed files still have errors, and not again for the same errors", () => {
    const { root, context, edit } = setup();
    postEdit(edit("player.gd"), context);
    const first = stop({ session_id: "s1", cwd: root }, context);
    expect(first?.decision).toBe("block");
    expect(first?.reason).toMatch(/1 review error is still open/);
    expect(stop({ session_id: "s1", cwd: root }, context)).toBeUndefined();
    expect(stop({ session_id: "s1", cwd: root, stop_hook_active: true }, context)).toBeUndefined();
    // Another session knows nothing of these edits.
    expect(stop({ session_id: "s2", cwd: root }, context)).toBeUndefined();
  });

  it("let the agent stop once the errors are fixed, and say they are fixed", async () => {
    const { root, context, edit } = setup();
    postEdit(edit("player.gd"), context);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "player.gd"), FIXED);
    expect(postEdit(edit("player.gd"), context)?.hookSpecificOutput?.additionalContext).toMatch(/errors are fixed/);
    expect(stop({ session_id: "s1", cwd: root }, context)).toBeUndefined();
  });

  it("add lessons under Godot errors in a command's output, and nothing for other output", () => {
    const out = postBash({
      tool_name: "Bash",
      tool_response: { stdout: 'SCRIPT ERROR: Parse Error: Cannot infer the type of "x" variable because the value doesn\'t have a set type.\n   at: GDScript::reload (res://a.gd:3)\n', stderr: "" },
    });
    expect(out?.hookSpecificOutput?.additionalContext).toMatch(/gdscript\/variant-loop-inference/);
    expect(postBash({ tool_response: { stdout: "all 12 tests passed", stderr: "" } })).toBeUndefined();
    expect(postBash({ tool_response: "ERROR: something no lesson knows about at all" })).toBeUndefined();
  });

  it("start a session in a Godot project with what it is, and say nothing elsewhere", () => {
    const { root } = setup();
    const out = sessionStart({ cwd: join(root) }, { env: { GODOT: join(root, "no-godot-here") } })?.hookSpecificOutput;
    expect(out?.hookEventName).toBe("SessionStart");
    expect(out?.additionalContext).toMatch(/"Hooked" \(Godot 4\.7, Forward Plus\): 1 script, 0 scenes, main scene res:\/\/main\.tscn/);
    expect(out?.additionalContext).toMatch(/godot_lessons holds \d+ lessons/);
    expect(sessionStart({ cwd: tempFolder("gw-empty-") }, { env: {} })).toBeUndefined();
  });

  it("run from the CLI, print hook JSON, and never fail on bad input", async () => {
    const { root } = setup();
    const ok = await runCli(["hook", "post-edit", "--input", JSON.stringify({ session_id: `cli-${Date.now()}`, tool_input: { file_path: join(root, "player.gd") } })]);
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(ok.output).decision).toBe("block");
    const bad = await runCli(["hook", "post-edit", "--input", "{not json"]);
    expect(bad).toEqual({ output: "", exitCode: 0 });
    expect(existsSync(root)).toBe(true);
  });
});

describe("the plugin's hook shim", () => {
  const shim = new URL("../plugins/godotwright/hooks/run.mjs", import.meta.url).pathname;
  const run = async (event: string, input: object, env: Record<string, string> = {}) => {
    const { spawnSync } = await import("node:child_process");
    return spawnSync(process.execPath, [shim, event], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env } });
  };

  it("does not start godotwright for files and output that are not Godot's", async () => {
    const r = await run("post-edit", { tool_input: { file_path: "/tmp/readme.md" } }, { GODOTWRIGHT_CLI: "/nonexistent/cli.js" });
    expect([r.status, r.stdout]).toEqual([0, ""]);
    const b = await run("post-bash", { tool_response: { stdout: "ok", stderr: "" } }, { GODOTWRIGHT_CLI: "/nonexistent/cli.js" });
    expect([b.status, b.stdout]).toEqual([0, ""]);
  });

  it("fails open when godotwright cannot run, and when the hooks are off", async () => {
    const r = await run("post-edit", { tool_input: { file_path: "/tmp/x.gd" } }, { GODOTWRIGHT_CLI: "/nonexistent/cli.js" });
    expect([r.status, r.stdout]).toEqual([0, ""]);
    const off = await run("stop", { session_id: "x" }, { GODOTWRIGHT_HOOKS: "0" });
    expect([off.status, off.stdout]).toEqual([0, ""]);
  });
});
