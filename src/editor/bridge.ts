import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { projectRootOf } from "../scan/scan.js";

/**
 * The client of the editor bridge: the addon `addons/godotwright_bridge` runs a small server inside the open Godot
 * editor (loopback only, with a token) and writes where it listens to `.godot/godotwright_bridge.json`. One call is
 * one connection: a JSON line out, a JSON line back. Without the addon nothing here is used, and every other tool
 * works as before.
 */

export const BRIDGE_FILE = ".godot/godotwright_bridge.json";
/** The largest message either side sends: 1 MiB, the newline included. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const INSTALL_HINT = "install it with `godotwright editor install` and enable it in Project Settings > Plugins";

export type EditorBridgeErrorCode = "not_running" | "stale" | "unauthorized" | "timeout" | "too_large" | "bad_reply" | "bad_request" | "op_failed";

export class EditorBridgeError extends Error {
  constructor(
    readonly code: EditorBridgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EditorBridgeError";
  }
}

/** What the addon writes when it starts. */
export interface BridgeInfo {
  port: number;
  token: string;
  pid?: number;
  godot_version?: string;
  project?: string;
  bridge_version?: string;
}

export interface EditorOp {
  /** The arguments, as an agent would write them. */
  args: string;
  what: string;
  /**
   * What the op touches. `read`: nothing. `view`: only what the editor shows (open tab, selection, inspector; a
   * screenshot also writes a PNG under .godot/godotwright/). `write`: project files, or unsaved editor changes
   * (save, reload, close, scan, reimport). `run`: starts or stops the game.
   */
  kind: "read" | "view" | "write" | "run";
  /** How long the editor may take, when longer than the default. */
  timeoutMs?: number;
}

/** Every op of the bridge. The addon has no op that runs code; its scene edits are undoable editor actions. */
export const EDITOR_OPS = {
  status: { args: "{}", what: "Godot version, project, open scenes (current, unsaved), whether the game runs, main screen", kind: "read" },
  open_scene: { args: "{path: res://x.tscn}", what: "open a scene, or switch to its tab", kind: "view" },
  save_scene: { args: "{}", what: "save the current scene", kind: "write", timeoutMs: 60_000 },
  save_all: { args: "{}", what: "save every open scene", kind: "write", timeoutMs: 60_000 },
  reload_scene: { args: "{path?: res://x.tscn, discard?: bool}", what: "load an open scene from disk again, so the editor shows file edits (default: the current scene; discard drops unsaved editor changes)", kind: "write", timeoutMs: 60_000 },
  close_scene: { args: "{discard?: bool}", what: "close the current scene (discard drops unsaved changes)", kind: "write" },
  selection: { args: "{}", what: "the selected nodes: path, class, script", kind: "read" },
  select: { args: "{paths: [node path, ...]}", what: "select these nodes of the edited scene (replaces the selection)", kind: "view" },
  edit_node: { args: "{path: node path}", what: "select a node and show it in the inspector", kind: "view" },
  inspect: { args: "{path?: node path, limit?: 1-500}", what: "the stored properties of a node as the editor has them now (default: the scene root, 200 properties)", kind: "read" },
  tree: { args: "{depth?: 0-64, limit?: 1-2000}", what: "the edited scene tree as the editor has it now, unsaved changes included (default: depth 4, 300 nodes)", kind: "read" },
  play: { args: "{mode?: main|current|scene, scene?: res://x.tscn}", what: "run the game from the editor: the main scene (default), the current scene, or a scene by path", kind: "run" },
  stop: { args: "{}", what: "stop the running game", kind: "run" },
  screenshot: { args: "{target?: editor|viewport_2d|viewport_3d, index?: 0-3}", what: "a PNG of the editor window or an editor viewport, written under .godot/godotwright/; returns path, width, height", kind: "view" },
  filesystem_scan: { args: "{}", what: "make the editor look for new and changed files", kind: "write" },
  reimport: { args: "{paths: [res://file, ...]}", what: "import files again that already have an .import file (blocks until done)", kind: "write", timeoutMs: 300_000 },
  is_scanning: { args: "{}", what: "whether the editor is scanning or importing", kind: "read" },
  errors: { args: "{since?: number, limit?: 1-500}", what: "errors and warnings of the editor process since sequence number `since` (Godot 4.5+); pass the returned `next` the next time", kind: "read" },
  set_property: { args: '{path: node path, property: name, value: 3 | true | "Vector2(1, 2)" (Variant text, as in a .tscn)}', what: "set a property of a node in the open scene, as one undoable editor action (Ctrl+Z takes it back); the scene stays unsaved until save_scene", kind: "write" },
  add_node: { args: '{parent?: node path, type?: Sprite2D, scene?: res://x.tscn, name?: text, properties?: {name: value}}', what: "add a node of a class, or an instance of a scene, to the open scene, as one undoable editor action", kind: "write" },
  remove_node: { args: "{path: node path}", what: "remove a node (and its children) from the open scene, as one undoable editor action", kind: "write" },
  rename_node: { args: "{path: node path, name: text}", what: "rename a node of the open scene, as one undoable editor action", kind: "write" },
} as const satisfies Record<string, EditorOp>;

export type EditorOpName = keyof typeof EDITOR_OPS;

export const EDITOR_OP_NAMES = Object.keys(EDITOR_OPS) as EditorOpName[];

export const isEditorOp = (op: string): op is EditorOpName => Object.hasOwn(EDITOR_OPS, op);

/** Whether an op changes anything: every kind but `read` (unknown ops count as changing, so a read-only server refuses them). */
export function editorOpChanges(op: string): boolean {
  return isEditorOp(op) ? EDITOR_OPS[op].kind !== "read" : true;
}

export function bridgeFile(root: string): string {
  return join(root, ...BRIDGE_FILE.split("/"));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process is there, but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const notRunning = (): EditorBridgeError => new EditorBridgeError("not_running", `the editor is not running or the addon is not enabled: ${INSTALL_HINT}`);

const stale = (why: string): EditorBridgeError =>
  new EditorBridgeError("stale", `${BRIDGE_FILE} is left over from an editor that is gone (${why}): open the project in the Godot editor again with the Godotwright Bridge plugin enabled`);

/** Reads the bridge file of a project root. Throws `not_running` when there is none. */
export function readBridgeFile(root: string): BridgeInfo {
  let text: string;
  try {
    text = readFileSync(bridgeFile(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw notRunning();
    throw error;
  }
  let info: unknown;
  try {
    info = JSON.parse(text);
  } catch {
    info = undefined;
  }
  const o = (info ?? {}) as Partial<BridgeInfo>;
  if (typeof o.port !== "number" || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535 || typeof o.token !== "string" || !o.token) {
    throw new EditorBridgeError("stale", `${BRIDGE_FILE} is not a bridge file Godotwright can read: disable and enable the Godotwright Bridge plugin in Project Settings > Plugins`);
  }
  return {
    port: o.port,
    token: o.token,
    ...(typeof o.pid === "number" ? { pid: o.pid } : {}),
    ...(typeof o.godot_version === "string" ? { godot_version: o.godot_version } : {}),
    ...(typeof o.project === "string" ? { project: o.project } : {}),
    ...(typeof o.bridge_version === "string" ? { bridge_version: o.bridge_version } : {}),
  };
}

export interface EditorCallOptions {
  /** How long to wait for the editor (default 15 s, longer for saves and imports). */
  timeoutMs?: number;
}

/** One request to a bridge: connects to 127.0.0.1, sends one line, reads one line. */
export function editorRequest(info: BridgeInfo, op: string, args: Record<string, unknown> = {}, options: EditorCallOptions = {}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? (isEditorOp(op) ? (EDITOR_OPS[op] as EditorOp).timeoutMs : undefined) ?? 15_000;
  const id = randomBytes(6).toString("hex");
  const line = Buffer.from(`${JSON.stringify({ id, token: info.token, op, args })}\n`, "utf8");
  if (line.length > MAX_MESSAGE_BYTES) {
    return Promise.reject(new EditorBridgeError("too_large", `the request for "${op}" is ${line.length} bytes; the bridge takes at most 1 MiB per message`));
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: info.port });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let connected = false;
    const finish = (error: EditorBridgeError | undefined, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          new EditorBridgeError(
            "timeout",
            connected
              ? `the editor did not answer "${op}" within ${Math.round(timeoutMs / 1000)} s (it may be busy importing, showing a dialog, or stuck)`
              : `no connection to the editor on 127.0.0.1:${info.port} within ${Math.round(timeoutMs / 1000)} s`,
          ),
        ),
      timeoutMs,
    );
    const closedEarly = () =>
      finish(
        new EditorBridgeError(
          "unauthorized",
          `the editor closed the connection without an answer: the token in ${BRIDGE_FILE} was not accepted (the file is from another editor run, or something else listens on port ${info.port}). Disable and enable the Godotwright Bridge plugin, or restart the editor`,
        ),
      );
    socket.on("connect", () => {
      connected = true;
      socket.write(line);
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      const newline = chunk.indexOf(10);
      if (newline < 0) {
        if (size > MAX_MESSAGE_BYTES) finish(new EditorBridgeError("too_large", `the editor's answer to "${op}" is larger than 1 MiB; ask for less (a lower depth or limit)`));
        return;
      }
      const all = Buffer.concat(chunks);
      const end = size - chunk.length + newline;
      if (end + 1 > MAX_MESSAGE_BYTES) return finish(new EditorBridgeError("too_large", `the editor's answer to "${op}" is larger than 1 MiB; ask for less (a lower depth or limit)`));
      let reply: unknown;
      try {
        reply = JSON.parse(all.subarray(0, end).toString("utf8"));
      } catch {
        return finish(new EditorBridgeError("bad_reply", `port ${info.port} did not answer as the Godotwright bridge (not JSON); is ${BRIDGE_FILE} from this editor?`));
      }
      const r = reply as { id?: unknown; ok?: unknown; result?: unknown; error?: unknown } | null;
      if (!r || typeof r !== "object" || r.id !== id || typeof r.ok !== "boolean") {
        return finish(new EditorBridgeError("bad_reply", `port ${info.port} did not answer as the Godotwright bridge (wrong id or shape); is ${BRIDGE_FILE} from this editor?`));
      }
      if (!r.ok) return finish(new EditorBridgeError("op_failed", typeof r.error === "string" && r.error ? r.error : `the editor refused "${op}"`));
      finish(undefined, r.result);
    });
    socket.on("end", closedEarly);
    socket.on("close", closedEarly);
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (!connected && (error.code === "ECONNREFUSED" || error.code === "EADDRNOTAVAIL" || error.code === "ETIMEDOUT")) return finish(stale(`nothing listens on port ${info.port}`));
      if (connected && (error.code === "ECONNRESET" || error.code === "EPIPE")) return closedEarly();
      finish(new EditorBridgeError("bad_reply", `the connection to the editor on port ${info.port} failed: ${error.message}`));
    });
  });
}

/**
 * Asks the open editor of a project to do one op, and returns its result. Throws an EditorBridgeError with a message
 * that says what to do: the addon is not installed or the editor is closed (`not_running`), the bridge file is left
 * over (`stale`), the token was refused (`unauthorized`), no answer in time (`timeout`), or the editor's own refusal
 * (`op_failed`).
 */
export async function editorCall(project: string, op: string, args: Record<string, unknown> = {}, options: EditorCallOptions = {}): Promise<unknown> {
  const root = projectRootOf(project);
  if (!isEditorOp(op)) throw new EditorBridgeError("bad_request", `unknown editor op "${op}"; the ops are ${EDITOR_OP_NAMES.join(", ")}`);
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw new EditorBridgeError("bad_request", `args must be an object, e.g. ${EDITOR_OPS[op].args}`);
  const info = readBridgeFile(root);
  try {
    return await editorRequest(info, op, args, options);
  } catch (error) {
    // The editor removes the file when it closes; after a crash it stays, with the pid of a process that is gone.
    // The pid only explains a failure: an editor in a container or WSL has a pid this side cannot see.
    const gone = info.pid !== undefined && !alive(info.pid);
    if (gone && error instanceof EditorBridgeError && ["stale", "unauthorized", "bad_reply", "timeout"].includes(error.code)) throw stale(`process ${info.pid} no longer runs`);
    throw error;
  }
}

/** Whether a bridge answers for this project, without throwing: for status lines. */
export async function editorReachable(project: string, options: EditorCallOptions = {}): Promise<{ ok: true; status: unknown } | { ok: false; error: EditorBridgeError }> {
  try {
    return { ok: true, status: await editorCall(project, "status", {}, options) };
  } catch (error) {
    if (error instanceof EditorBridgeError) return { ok: false, error };
    throw error;
  }
}
