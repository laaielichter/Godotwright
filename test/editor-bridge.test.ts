import { Command } from "commander";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import type { ApiMethod } from "../src/api/types.js";
import { editorCommand } from "../src/commands/editor.js";
import { BRIDGE_FILE, EDITOR_OPS, EDITOR_OP_NAMES, EditorBridgeError, MAX_MESSAGE_BYTES, editorCall, editorOpChanges, editorReachable } from "../src/editor/bridge.js";
import { formatEditorOps, formatEditorResult } from "../src/editor/format.js";
import { ADDON_DIR, PLUGIN_CFG, EditorInstallError, addonSourceDir, addonState, bundledAddonVersion, formatAddonState, formatInstall, formatUninstall, installAddon, uninstallAddon } from "../src/editor/install.js";
import { formatScript } from "../src/format/format.js";
import { parseProjectSettings } from "../src/godot/project-settings.js";
import { asStringList } from "../src/godot/variant.js";
import { readJournal, undoJournal } from "../src/journal/journal.js";
import { reviewProject } from "../src/review/review.js";
import { makeProject } from "./helpers.js";

const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Bridge Test"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n';
const SCENE = '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n';
const TOKEN = "0123456789abcdef0123456789abcdef";

const project = (extra: Record<string, string> = {}): string => makeProject({ "project.godot": PROJECT, "main.tscn": SCENE, ".gitignore": ".godot/\n", ...extra });

/** A stand-in for the addon: a TCP server that speaks the bridge protocol, and closes on anything without the token. */
interface FakeEditor {
  port: number;
  requests: { op: string; args: Record<string, unknown> }[];
  close(): Promise<void>;
}

type Handler = (op: string, args: Record<string, unknown>, socket: Socket, id: unknown) => { result?: unknown; error?: string } | "silent" | "raw";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((done) => s.close(() => done()))));
});

function fakeEditor(handler: Handler = (op) => ({ result: { op } })): Promise<FakeEditor> {
  const requests: FakeEditor["requests"] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf(10);
      if (end < 0) {
        if (buffer.length > MAX_MESSAGE_BYTES) socket.destroy();
        return;
      }
      let request: { id?: unknown; token?: unknown; op?: unknown; args?: unknown };
      try {
        request = JSON.parse(buffer.subarray(0, end).toString("utf8")) as typeof request;
      } catch {
        socket.destroy();
        return;
      }
      if (request.token !== TOKEN || typeof request.op !== "string") {
        socket.destroy();
        return;
      }
      const args = (request.args ?? {}) as Record<string, unknown>;
      requests.push({ op: request.op, args });
      const answer = handler(request.op, args, socket, request.id);
      if (answer === "silent" || answer === "raw") return;
      socket.end(`${JSON.stringify(answer.error !== undefined ? { id: request.id, ok: false, error: answer.error } : { id: request.id, ok: true, result: answer.result })}\n`);
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        requests,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            servers.splice(servers.indexOf(server), 1);
            server.close(() => done());
          }),
      });
    });
  });
}

function writeBridge(root: string, info: Record<string, unknown>): void {
  mkdirSync(join(root, ".godot"), { recursive: true });
  writeFileSync(join(root, ...BRIDGE_FILE.split("/")), `${JSON.stringify(info)}\n`);
}

async function failure(run: Promise<unknown>): Promise<EditorBridgeError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof EditorBridgeError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("editor bridge client", () => {
  it("sends one request with the token and returns the result", async () => {
    const root = project();
    const editor = await fakeEditor((op, args) => ({ result: { op, depth: args["depth"] } }));
    writeBridge(root, { port: editor.port, token: TOKEN, pid: process.pid, godot_version: "4.7.2", project: "Bridge Test" });
    expect(await editorCall(root, "tree", { depth: 2 })).toEqual({ op: "tree", depth: 2 });
    expect(editor.requests).toEqual([{ op: "tree", args: { depth: 2 } }]);
    // Any path inside the project finds the bridge file.
    mkdirSync(join(root, "levels"));
    expect(await editorCall(join(root, "levels"), "status", {})).toEqual({ op: "status" });
    expect(await editorReachable(root)).toEqual({ ok: true, status: { op: "status" } });
  });

  it("gives the editor's own refusal as the error", async () => {
    const root = project();
    const editor = await fakeEditor(() => ({ error: "res://nope.tscn does not exist" }));
    writeBridge(root, { port: editor.port, token: TOKEN });
    const error = await failure(editorCall(root, "open_scene", { path: "res://nope.tscn" }));
    expect(error.code).toBe("op_failed");
    expect(error.message).toBe("res://nope.tscn does not exist");
  });

  it("says the token was refused when the editor closes without an answer", async () => {
    const root = project();
    const editor = await fakeEditor();
    writeBridge(root, { port: editor.port, token: "f".repeat(32), pid: process.pid });
    const error = await failure(editorCall(root, "status", {}));
    expect(error.code).toBe("unauthorized");
    expect(error.message).toContain("token");
    expect(editor.requests).toEqual([]);
  });

  it("says how to install when there is no bridge file", async () => {
    const root = project();
    const error = await failure(editorCall(root, "status", {}));
    expect(error.code).toBe("not_running");
    expect(error.message).toBe("the editor is not running or the addon is not enabled: install it with `godotwright editor install` and enable it in Project Settings > Plugins");
    const reach = await editorReachable(root);
    expect(reach.ok).toBe(false);
  });

  it("calls a bridge file stale when nothing listens on its port, or its process is gone", async () => {
    const root = project();
    const editor = await fakeEditor();
    const port = editor.port;
    await editor.close();
    writeBridge(root, { port, token: TOKEN, pid: process.pid });
    const dead = await failure(editorCall(root, "status", {}));
    expect(dead.code).toBe("stale");
    expect(dead.message).toContain(`nothing listens on port ${port}`);

    // A pid that cannot exist explains why.
    writeBridge(root, { port, token: TOKEN, pid: 2 ** 30 });
    const gone = await failure(editorCall(root, "status", {}));
    expect(gone.code).toBe("stale");
    expect(gone.message).toContain("no longer runs");

    writeFileSync(join(root, ...BRIDGE_FILE.split("/")), "{ not json");
    expect((await failure(editorCall(root, "status", {}))).code).toBe("stale");
  });

  it("refuses a request over 1 MiB before sending it, and an answer over 1 MiB", async () => {
    const root = project();
    const editor = await fakeEditor((_op, _args, socket) => {
      socket.write("x".repeat(MAX_MESSAGE_BYTES + 10));
      return "raw";
    });
    writeBridge(root, { port: editor.port, token: TOKEN });
    const big = await failure(editorCall(root, "select", { paths: ["a".repeat(MAX_MESSAGE_BYTES)] }));
    expect(big.code).toBe("too_large");
    expect(editor.requests).toEqual([]);
    const answer = await failure(editorCall(root, "tree", {}));
    expect(answer.code).toBe("too_large");
    expect(answer.message).toContain("larger than 1 MiB");
  });

  it("times out when the editor does not answer", async () => {
    const root = project();
    const editor = await fakeEditor(() => "silent");
    writeBridge(root, { port: editor.port, token: TOKEN });
    const started = Date.now();
    const error = await failure(editorCall(root, "save_scene", {}, { timeoutMs: 150 }));
    expect(error.code).toBe("timeout");
    expect(error.message).toContain('did not answer "save_scene"');
    expect(Date.now() - started).toBeLessThan(5000);
    await editor.close();
  });

  it("refuses an answer that is not the bridge's", async () => {
    const root = project();
    const wrongId = await fakeEditor((_op, _args, socket) => {
      socket.end(`${JSON.stringify({ id: "other", ok: true, result: 1 })}\n`);
      return "raw";
    });
    writeBridge(root, { port: wrongId.port, token: TOKEN });
    expect((await failure(editorCall(root, "status", {}))).code).toBe("bad_reply");
    const http = await fakeEditor((_op, _args, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return "raw";
    });
    writeBridge(root, { port: http.port, token: TOKEN });
    expect((await failure(editorCall(root, "status", {}))).code).toBe("bad_reply");
  });

  it("refuses unknown ops and has no op that runs code", async () => {
    const root = project();
    writeBridge(root, { port: 1, token: TOKEN });
    for (const op of ["eval", "execute", "run_script", "undo_redo"]) expect((await failure(editorCall(root, op, {}))).code).toBe("bad_request");
    expect(EDITOR_OP_NAMES).not.toContain("eval");
    expect(editorOpChanges("eval")).toBe(true);
    expect(EDITOR_OP_NAMES.filter((op) => !editorOpChanges(op))).toEqual(["status", "selection", "inspect", "tree", "is_scanning", "errors"]);
    expect(formatEditorOps().split("\n").filter(Boolean)).toHaveLength(EDITOR_OP_NAMES.length);
  });

  it("formats answers as compact text", () => {
    const status = formatEditorResult("status", {
      godot_version: "4.7.2-stable (official)",
      project: "Bridge Test",
      scenes: [
        { path: "res://main.tscn", current: true, unsaved: true },
        { path: "res://hud.tscn", current: false, unsaved: false },
      ],
      has_scene: true,
      current_root: { name: "Main", class: "Node2D" },
      playing: false,
      main_screen: "2D",
      errors_supported: true,
    });
    expect(status).toContain("* res://main.tscn  [unsaved]");
    expect(status).toContain("game: not playing");
    const tree = formatEditorResult("tree", { scene: "res://main.tscn", depth: 1, truncated: false, nodes: [{ path: ".", name: "Main", class: "Node2D", depth: 0, children: 1 }, { path: "Hero", name: "Hero", class: "CharacterBody2D", script: "res://hero.gd", depth: 1, children: 2 }] });
    expect(tree).toContain("  Hero (CharacterBody2D) res://hero.gd  +2 below");
    const errors = formatEditorResult("errors", { supported: true, errors: [{ seq: 7, type: "script", file: "res://hero.gd", line: 12, function: "", message: 'Parse Error: Identifier "x" not declared' }], next: 7, more: 0, dropped: 0, game_errors: "Errors of a game started from the editor are not captured." });
    expect(errors).toContain('#7 script res://hero.gd:12: Parse Error: Identifier "x" not declared');
    expect(errors).toContain("next: since 7");
    expect(formatEditorResult("errors", { supported: false, reason: "needs Godot 4.5" })).toContain("not supported. needs Godot 4.5");
    expect(formatEditorResult("screenshot", { target: "editor", path: "/p/.godot/godotwright/editor_editor.png", width: 1920, height: 1080 })).toContain("(1920x1080)");
  });
});

describe("editor bridge install", () => {
  const enabled = (root: string): string[] => asStringList(parseProjectSettings(readFileSync(join(root, "project.godot"), "utf8")).values["editor_plugins/enabled"]);
  const addonFiles = (root: string): string[] => readdirSync(join(root, ...ADDON_DIR.split("/"))).sort();

  it("copies the addon and enables it, keeping another plugin, and is idempotent", () => {
    const root = project({ "project.godot": `${PROJECT}\n[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n`, "addons/other/plugin.cfg": '[plugin]\nname="Other"\nscript="plugin.gd"\n' });
    expect(addonState(root)).toMatchObject({ installed: false, enabled: false, foreign: false });
    const first = installAddon(root);
    expect(addonFiles(root)).toEqual(readdirSync(addonSourceDir()).sort());
    expect(first.written).toContain(PLUGIN_CFG);
    expect(first.settingChanged).toBe(true);
    expect(enabled(root)).toEqual(["res://addons/other/plugin.cfg", PLUGIN_CFG]);
    for (const name of addonFiles(root)) expect(readFileSync(join(root, ADDON_DIR, name)).equals(readFileSync(join(addonSourceDir(), name)))).toBe(true);
    expect(addonState(root)).toMatchObject({ installed: true, current: true, enabled: true, version: bundledAddonVersion() });
    expect(formatInstall(first)).toContain("installed the editor bridge");
    expect(formatAddonState(addonState(root))).toContain("enabled in project.godot");
    // The writes are in the journal.
    expect(readJournal(root).entries.map((e) => e.tool)).toEqual(["editor install", "project edit"]);

    const before = readFileSync(join(root, "project.godot"), "utf8");
    const again = installAddon(root);
    expect(again).toMatchObject({ written: [], settingChanged: false, journal: [] });
    expect(readFileSync(join(root, "project.godot"), "utf8")).toBe(before);
    expect(formatInstall(again)).toContain("already installed");
  });

  it("uninstalls cleanly: the other plugin stays, our files and their .uid files go", () => {
    const original = `${PROJECT}\n[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n`;
    const root = project({ "project.godot": original, "addons/other/plugin.cfg": '[plugin]\nname="Other"\nscript="plugin.gd"\n' });
    installAddon(root);
    // Godot writes a .uid file next to every script.
    writeFileSync(join(root, ADDON_DIR, "plugin.gd.uid"), "uid://abc\n");
    const result = uninstallAddon(root);
    expect(result.settingChanged).toBe(true);
    expect(result.kept).toEqual([]);
    expect(existsSync(join(root, ADDON_DIR))).toBe(false);
    expect(existsSync(join(root, "addons", "other", "plugin.cfg"))).toBe(true);
    expect(readFileSync(join(root, "project.godot"), "utf8")).toBe(original);
    expect(formatUninstall(result)).toContain("removed the plugin from project.godot");
    const again = uninstallAddon(root);
    expect(again).toMatchObject({ removed: [], settingChanged: false });
    expect(formatUninstall(again)).toContain("not installed");
    // Undo of the uninstall puts the files and the setting back.
    undoJournal(root, { steps: 2 });
    expect(addonState(root)).toMatchObject({ installed: true, current: true, enabled: true });
  });

  it("drops the setting when ours was the only plugin, and keeps files that are not ours", () => {
    const root = project();
    installAddon(root);
    expect(enabled(root)).toEqual([PLUGIN_CFG]);
    writeFileSync(join(root, ADDON_DIR, "notes.txt"), "mine\n");
    const result = uninstallAddon(root);
    expect(readFileSync(join(root, "project.godot"), "utf8")).not.toContain("enabled=");
    expect(result.kept).toEqual([`res://${ADDON_DIR}/notes.txt`]);
    expect(addonFiles(root)).toEqual(["notes.txt"]);
  });

  it("can copy the files without enabling", () => {
    const root = project();
    const result = installAddon(root, { enable: false });
    expect(result.settingChanged).toBe(false);
    expect(enabled(root)).toEqual([]);
    expect(formatAddonState(addonState(root))).toContain("not enabled in project.godot");
  });

  it("refuses a different addon of the same name, and updates an older version of ours", () => {
    const foreign = project({ [`${ADDON_DIR}/plugin.cfg`]: '[plugin]\nname="Someone else"\nscript="plugin.gd"\n', [`${ADDON_DIR}/plugin.gd`]: "@tool\nextends EditorPlugin\n" });
    expect(() => installAddon(foreign)).toThrow(EditorInstallError);
    expect(() => uninstallAddon(foreign)).toThrow(EditorInstallError);
    expect(readFileSync(join(foreign, ADDON_DIR, "plugin.gd"), "utf8")).toBe("@tool\nextends EditorPlugin\n");
    expect(addonState(foreign)).toMatchObject({ foreign: true, installed: false });

    const old = project({ [`${ADDON_DIR}/plugin.cfg`]: '; godotwright-editor-bridge 0\n[plugin]\nname="Godotwright Bridge"\nscript="plugin.gd"\n', [`${ADDON_DIR}/plugin.gd`]: "@tool\nextends EditorPlugin\n" });
    expect(addonState(old)).toMatchObject({ installed: true, current: false, version: "0" });
    const result = installAddon(old);
    expect(result.previous).toBe("0");
    expect(formatInstall(result)).toContain("updated the editor bridge from version 0");
    expect(addonState(old)).toMatchObject({ installed: true, current: true });
  });
});

describe("godotwright editor (CLI)", () => {
  async function run(args: string[]): Promise<{ output: string; exitCode: number }> {
    let output = "";
    const program = new Command().configureOutput({ writeOut: (t) => (output += t), writeErr: (t) => (output += t) });
    program.addCommand(editorCommand());
    // A usage error must throw here, not end the test process.
    const override = (c: Command): void => {
      c.exitOverride().configureOutput(program.configureOutput());
      c.commands.forEach(override);
    };
    override(program);
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((text: string | Uint8Array) => {
      output += String(text);
      return true;
    }) as typeof process.stderr.write;
    process.exitCode = undefined;
    try {
      await program.parseAsync(["editor", ...args], { from: "user" });
    } catch (error) {
      const exitCode = (error as { exitCode?: number }).exitCode;
      if (exitCode === undefined) throw error;
      return { output, exitCode };
    } finally {
      process.stderr.write = write;
    }
    const exitCode = process.exitCode === undefined ? 0 : Number(process.exitCode);
    process.exitCode = undefined;
    return { output, exitCode };
  }

  it("installs, reports status with and without an editor, runs an op, uninstalls", async () => {
    const root = project();
    expect((await run(["install", root])).output).toContain("installed the editor bridge");
    const offline = await run(["status", root]);
    expect(offline.exitCode).toBe(1);
    expect(offline.output).toContain("addon: installed");
    expect(offline.output).toContain("the editor is not running or the addon is not enabled");

    const editor = await fakeEditor((op) => (op === "status" ? { result: { godot_version: "4.7.2", project: "Bridge Test", scenes: [], playing: false } } : { result: { scene: "res://main.tscn", depth: 2, nodes: [{ path: ".", name: "Main", class: "Node2D", depth: 0, children: 0 }], truncated: false } }));
    writeBridge(root, { port: editor.port, token: TOKEN, pid: process.pid });
    const online = await run(["status", root]);
    expect(online.exitCode).toBe(0);
    expect(online.output).toContain('editor: Godot 4.7.2, project "Bridge Test"');
    const tree = await run(["tree", root, "--args", '{"depth": 2}']);
    expect(tree.output).toContain("Main (Node2D)");
    expect(editor.requests.at(-1)).toEqual({ op: "tree", args: { depth: 2 } });
    expect(JSON.parse((await run(["tree", root, "--json"])).output)).toMatchObject({ scene: "res://main.tscn" });
    expect((await run(["tree", root, "--args", "[1]"])).exitCode).not.toBe(0);
    expect((await run(["uninstall", root])).output).toContain("removed");
  });
});

/**
 * Godot is not installed where these tests run, so the addon is checked statically: the project review must find no
 * errors in it, the formatter must leave it as it is, and every engine method, property and constant it uses must
 * be in the bundled Godot 4.7 class reference.
 */
describe("the addon's GDScript", () => {
  const dir = addonSourceDir();
  const scripts = readdirSync(dir).filter((f) => f.endsWith(".gd"));
  const source = (name: string): string => readFileSync(join(dir, name), "utf8");
  const api = GodotApi.load();

  it("has the files the installer and the docs name", () => {
    expect(readdirSync(dir).sort()).toEqual(["README.md", "bridge_ops.gd", "error_log.gd", "plugin.cfg", "plugin.gd"]);
    expect(source("plugin.gd")).toContain(`const BRIDGE_VERSION := "${bundledAddonVersion()}"`);
    expect(readFileSync(join(dir, "plugin.cfg"), "utf8")).toContain(`version="${bundledAddonVersion()}"`);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("Run in a headless Godot 4.7.2 editor");
  });

  it("passes the project review without errors", () => {
    const root = project({ "project.godot": `${PROJECT}\n[editor_plugins]\n\nenabled=PackedStringArray("${PLUGIN_CFG}")\n` });
    cpSync(dir, join(root, ADDON_DIR), { recursive: true });
    // Addons are third-party code to the review unless asked: this one is ours.
    const report = reviewProject(root, { includeAddons: true });
    expect(report.scripts).toBeGreaterThanOrEqual(scripts.length);
    expect(report.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(report.findings.filter((f) => f.file.includes(ADDON_DIR) && f.severity !== "info")).toEqual([]);
  });

  it("is formatted", () => {
    for (const name of scripts) {
      const result = formatScript(source(name));
      expect(result.skipped, name).toBeUndefined();
      expect(result.changed, name).toBe(false);
    }
  });

  it("speaks the protocol the client speaks", () => {
    const plugin = source("plugin.gd");
    expect(plugin).toContain(`const BRIDGE_FILE := "res://${BRIDGE_FILE}"`);
    expect(plugin).toContain(`const MAX_MESSAGE_BYTES := ${MAX_MESSAGE_BYTES}`);
    expect(plugin).toContain('.listen(DEFAULT_PORT + offset, "127.0.0.1")');
    expect(plugin).toContain("constant_time_compare");
    // The ops of the addon are the ops of the client, in the same order.
    const ops = [...source("bridge_ops.gd").matchAll(/^\t\t"([a-z_]+)":$/gm)].map((m) => m[1]).filter((op) => !["main", "current", "scene", "editor", "viewport_2d", "viewport_3d"].includes(op ?? ""));
    expect(ops).toEqual(EDITOR_OP_NAMES);
    for (const name of scripts) expect(source(name)).not.toMatch(/\bExpression\b|\bGDScript\.new\b|source_code|\.reload\(/);
    for (const op of EDITOR_OP_NAMES) expect(EDITOR_OPS[op].what.length).toBeGreaterThan(10);
  });

  /** Typed engine objects per script: the name of a variable (or `a.b`) and its class. */
  const RECEIVERS: Record<string, Record<string, string>> = {
    "plugin.gd": { _server: "TCPServer", _crypto: "Crypto", peer: "StreamPeerTCP", "client.peer": "StreamPeerTCP", json: "JSON", file: "FileAccess", logger_script: "GDScript", main_screen_changed: "Signal" },
    "bridge_ops.gd": { root: "Node", node: "Node", attached: "Script", selection: "EditorSelection", files: "EditorFileSystem", viewport: "Viewport", texture: "ViewportTexture", image: "Image", resource: "Resource", object: "Object", paths: "PackedStringArray", unsaved: "PackedStringArray" },
    "error_log.gd": { _mutex: "Mutex", backtrace: "ScriptBacktrace" },
  };

  /** The index after the `)` that closes the `(` at `open`. */
  function afterCall(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      } else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return i + 1;
    }
    return text.length;
  }

  interface Use {
    file: string;
    cls: string;
    name: string;
    kind: "method" | "member";
  }

  /** Every `Receiver.method(...)` chain and `Receiver.member` in a script, with the class each one is looked up on. */
  function uses(file: string): Use[] {
    // Comments say things like "Logger and OS.add_logger": only code counts.
    const text = source(file)
      .split("\n")
      .map((l) => l.replace(/^\s*#.*$/, ""))
      .join("\n");
    const known = RECEIVERS[file] ?? {};
    const names = Object.keys(known).sort((a, b) => b.length - a.length).map((n) => n.replace(".", "\\."));
    const start = new RegExp(`(?<![\\w.])(${[...names, "[A-Z][A-Za-z0-9]+"].join("|")})(?=\\.[A-Za-z_])`, "g");
    const out: Use[] = [];
    for (const match of text.matchAll(start)) {
      const receiver = match[1] ?? "";
      let cls: string | undefined = known[receiver] ?? (api.getClass(receiver)?.name === receiver ? receiver : undefined);
      let at = match.index + receiver.length;
      while (cls) {
        const member = /^\.([A-Za-z_]\w*)/.exec(text.slice(at, at + 80));
        if (!member) break;
        const name = member[1] ?? "";
        at += member[0].length;
        // Class.new() is how GDScript makes an object: it is not a method in the class reference.
        if (name === "new" && receiver === cls) {
          at = afterCall(text, at);
          continue;
        }
        if (text[at] !== "(") {
          out.push({ file, cls, name, kind: "member" });
          break;
        }
        out.push({ file, cls, name, kind: "method" });
        // Methods reached by name: the name must be a method of the class too.
        const byName = /^\(&"(\w+)"/.exec(text.slice(at, at + 80));
        if ((name === "call" || name === "has_method") && byName) out.push({ file, cls, name: byName[1] ?? "", kind: "method" });
        at = afterCall(text, at);
        const method: ApiMethod | undefined = api.ancestors(cls).flatMap((c) => c.methods ?? []).find((m) => m.name === name);
        const returns = method?.returns.replace(/\[\]$/, "");
        cls = returns && api.getClass(returns)?.name === returns ? returns : undefined;
      }
    }
    return out;
  }

  it("only uses engine methods, properties and constants that Godot 4.7 has", () => {
    expect(api.version.startsWith("4.7")).toBe(true);
    const all = scripts.flatMap(uses);
    const missing = all.filter((u) => (u.kind === "method" ? !api.hasMethod(u.cls, u.name) : api.member(u.cls, u.name).length === 0)).map((u) => `${u.file}: ${u.cls}.${u.name}`);
    expect(missing).toEqual([]);
    const seen = new Set(all.map((u) => `${u.cls}.${u.name}`));
    // The extraction really sees the calls: direct ones, chains, by-name calls, properties and constants.
    for (const expected of [
      "EditorInterface.get_open_scenes",
      "EditorInterface.get_unsaved_scenes",
      "EditorInterface.close_scene",
      "EditorInterface.reload_scene_from_path",
      "EditorInterface.play_custom_scene",
      "EditorInterface.get_editor_viewport_3d",
      "Control.get_viewport",
      "EditorSelection.get_selected_nodes",
      "EditorFileSystem.reimport_files",
      "ViewportTexture.get_image",
      "Image.save_png",
      "TCPServer.take_connection",
      "TCPServer.is_connection_available",
      "StreamPeerTCP.get_partial_data",
      "StreamPeerTCP.STATUS_CONNECTED",
      "Crypto.constant_time_compare",
      "PackedByteArray.hex_encode",
      "OS.add_logger",
      "OS.remove_logger",
      "FileAccess.set_unix_permissions",
      "Node.scene_file_path",
      "ScriptBacktrace.get_frame_file",
      "Mutex.lock",
    ]) {
      expect(seen, expected).toContain(expected);
    }
    expect(seen.size).toBeGreaterThan(60);
  });

  it("the check itself catches a method Godot does not have", () => {
    expect(api.hasMethod("EditorInterface", "get_editor_log")).toBe(false);
    expect(api.hasMethod("EditorUndoRedoManager", "undo")).toBe(false);
    expect(api.hasMethod("EditorInterface", "save_scene")).toBe(true);
  });

  it("overrides the Logger virtuals with the parameters Godot 4.7 declares", () => {
    const logger = api.getClass("Logger");
    const error = logger?.methods?.find((m) => m.name === "_log_error");
    const message = logger?.methods?.find((m) => m.name === "_log_message");
    expect(error?.params?.map((p) => p.type)).toEqual(["String", "String", "int", "String", "String", "bool", "int", "ScriptBacktrace[]"]);
    expect(message?.params?.map((p) => p.type)).toEqual(["String", "bool"]);
    const text = source("error_log.gd");
    expect(text).toMatch(/^extends Logger$/m);
    const declared = /func _log_error\(([^)]*)\) -> void:/.exec(text)?.[1]?.split(",").map((p) => p.trim().split(":")[1]?.trim());
    expect(declared).toEqual(["String", "String", "int", "String", "String", "bool", "int", "Array[ScriptBacktrace]"]);
    expect(text).toContain("func _log_message(message: String, error: bool) -> void:");
    for (const name of ["_enter_tree", "_exit_tree", "_process"]) expect(api.hasMethod("EditorPlugin", name), name).toBe(true);
    expect(api.member("EditorPlugin", "main_screen_changed")[0]?.kind).toBe("signal");
  });
});
