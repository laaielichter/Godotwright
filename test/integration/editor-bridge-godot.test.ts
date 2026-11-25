import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editorCall } from "../../src/editor/bridge.js";
import { installAddon } from "../../src/editor/install.js";
import { FIXTURES } from "../helpers.js";

/**
 * The editor bridge in a real Godot editor: `godot --editor --headless` with the addon installed. Needs a Godot 4.7
 * binary in $GODOT. A headless editor draws nothing, so `screenshot` is not tested here (docs/editor-bridge.md).
 */
const GODOT = process.env["GODOT"];

describe.skipIf(!GODOT)("the editor bridge in a running Godot editor", () => {
  const root = join(mkdtempSync(join(tmpdir(), "godotwright-bridge-")), "demo");
  let editor: ChildProcess | undefined;
  type Result = Record<string, unknown>;
  const call = (op: string, args: Record<string, unknown> = {}) => editorCall(root, op, args, { timeoutMs: 30_000 }) as Promise<Result>;

  beforeAll(async () => {
    cpSync(join(FIXTURES, "demo"), root, { recursive: true });
    installAddon(root);
    editor = spawn(GODOT!, ["--editor", "--headless", "--path", root], { stdio: "ignore" });
    const deadline = Date.now() + 120_000;
    while (!existsSync(join(root, ".godot", "godotwright_bridge.json"))) {
      if (Date.now() > deadline) throw new Error("the bridge did not start");
      await new Promise((r) => setTimeout(r, 300));
    }
    // The plugin starts before the editor has opened the main scene (on a first import that takes longer).
    while (!((await editorCall(root, "status", {}, { timeoutMs: 30_000 })) as Result)["has_scene"]) {
      if (Date.now() > deadline) throw new Error("the editor did not open the main scene");
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 180_000);

  afterAll(() => {
    editor?.kill("SIGKILL");
  });

  it("answers the read ops with what the editor has open", { timeout: 120_000 }, async () => {
    const status = await call("status");
    expect(status).toMatchObject({ godot_version: expect.stringMatching(/^4\.7/), current_scene: "res://scenes/main.tscn", has_scene: true, playing: false, unsaved_known: true });
    const tree = await call("tree", { depth: 1 });
    expect((tree["nodes"] as Result[]).map((n) => n["path"])).toEqual(expect.arrayContaining([".", "Player", "HUD"]));
    const inspect = await call("inspect", { path: "Player", limit: 500 });
    expect((inspect["properties"] as Result[]).some((p) => p["name"] === "position")).toBe(true);
    await call("select", { paths: ["Player"] });
    expect(((await call("selection"))["nodes"] as Result[]).map((n) => n["path"])).toEqual(["Player"]);
    expect(await call("is_scanning")).toMatchObject({ scanning: expect.any(Boolean) });
    await expect(call("open_scene", { path: "res://nope.tscn" })).rejects.toThrow(/does not exist/);
    expect(await call("open_scene", { path: "res://scenes/player.tscn" })).toMatchObject({ current_scene: "res://scenes/player.tscn" });
    expect(await call("close_scene")).toMatchObject({ closed: "res://scenes/player.tscn" });
    expect(await call("reload_scene")).toMatchObject({ reloaded: "res://scenes/main.tscn" });
    expect(await call("reimport", { paths: ["res://icon.svg"] })).toMatchObject({ reimported: ["res://icon.svg"] });
    expect(await call("errors")).toMatchObject({ supported: true });
  });

  it("edits the open scene as undoable editor actions, and save_scene writes them", { timeout: 120_000 }, async () => {
    const set = await call("set_property", { path: "Player", property: "position", value: "Vector2(10, 20)" });
    expect(set).toMatchObject({ property: "position", after: "Vector2(10, 20)", undo: "Godotwright: set position" });
    await expect(call("set_property", { path: "Player", property: "position", value: '"text"' })).rejects.toThrow("position is a Vector2, not a String");
    expect(await call("set_property", { path: "Player", property: "z_index", value: 3 })).toMatchObject({ after: "3" });
    expect(await call("add_node", { parent: ".", type: "Sprite2D", name: "Badge", properties: { position: "Vector2(5, 5)" } })).toMatchObject({ path: "Badge", class: "Sprite2D", undo: "Godotwright: add Badge" });
    expect(await call("add_node", { scene: "res://scenes/player.tscn", name: "Player2" })).toMatchObject({ path: "Player2", script: "res://scripts/player.gd" });
    await expect(call("add_node", { type: "Resource" })).rejects.toThrow("is not a node class");
    expect(await call("rename_node", { path: "Badge", name: "Star" })).toMatchObject({ path: "Star", before: "Badge" });
    await expect(call("rename_node", { path: "Star", name: "Player" })).rejects.toThrow("already has a child called Player");
    expect(await call("remove_node", { path: "HUD" })).toMatchObject({ removed: { path: "HUD" }, undo: "Godotwright: remove HUD" });
    await expect(call("remove_node", { path: "." })).rejects.toThrow("the scene root cannot be removed");
    const status = await call("status");
    expect((status["scenes"] as Result[])[0]).toMatchObject({ path: "res://scenes/main.tscn", unsaved: true });
    await call("save_scene");
    const scene = readFileSync(join(root, "scenes", "main.tscn"), "utf8");
    expect(scene).toContain("position = Vector2(10, 20)");
    expect(scene).toContain("z_index = 3");
    expect(scene).toMatch(/\[node name="Star" type="Sprite2D" parent="\."/);
    expect(scene).toMatch(/\[node name="Player2" parent="\."[^\]]*instance=ExtResource/);
    expect(scene).not.toContain('name="HUD"');
  });
});
