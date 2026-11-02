import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { join } from "node:path";
import { findGodot, runGodot } from "../check/godot.js";
import { parseGodotLog, type Diagnostic } from "../check/log.js";
import { parseProjectSettings } from "../godot/project-settings.js";
import { isObject, parseVariant } from "../godot/variant.js";
import { parseCondition, parseTimeline, PlayError } from "../play/play.js";
import { findProjectRoot, fromResPath, listProjectFiles } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { inputEventText } from "../settings/edit.js";
import { SESSION_MARK, sessionScript } from "./script.js";

/**
 * A game session that stays up between calls: Godot runs the scene headless and paused, and answers on a loopback port
 * (with a token) to tree, get, set, call, eval, step and until requests. Time only moves on a step, so a session is as
 * deterministic as godot_play, but the world loads once. The session stops itself after a while without requests.
 * Nothing in the project changes: the script and the session file live in .godot/godotwright/.
 */

const DIR = ".godot/godotwright";

export interface SessionInfo {
  pid: number;
  port: number;
  token: string;
  scene: string;
  started: string;
  /** How much of the log the last request already reported. */
  logOffset: number;
  fps: number;
  /** When scripts were last reloaded into the game (ISO time); edits after it are what a reload picks up. */
  reloadedAt?: string;
}

export interface SessionStart {
  info: SessionInfo;
  /** Seconds the scene took to load. */
  loadSeconds: number;
  reused: boolean;
  diagnostics: Diagnostic[];
}

export interface SessionOptions {
  godot?: string;
  scene?: string;
  /** Minutes without requests after which the game quits (default 15). */
  idleMinutes?: number;
  /** Run `--import` first (default true). */
  import?: boolean;
  /** Stop a running session and start a new one. */
  restart?: boolean;
  timeoutMs?: number;
}

const paths = (root: string) => ({
  dir: join(root, ...DIR.split("/")),
  info: join(root, ...DIR.split("/"), "session.json"),
  script: join(root, ...DIR.split("/"), "session.gd"),
  log: join(root, ...DIR.split("/"), "session.log"),
});

function projectRoot(path: string): string {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  return root;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readSession(path: string): SessionInfo | undefined {
  const file = paths(projectRoot(path)).info;
  // No session when the file is not there.
  try {
    const info = JSON.parse(readFileSync(file, "utf8")) as SessionInfo;
    return alive(info.pid) ? info : undefined;
  } catch {
    return undefined;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** One request to the session: a JSON line out, a JSON line back. */
export function request(info: SessionInfo, op: string, payload: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: info.port });
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new PlayError(`the game did not answer "${op}" within ${Math.round(timeoutMs / 1000)} s (a long step, or the game is stuck)`));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: info.token, id: 1, op, ...payload })}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startSession(path: string, options: SessionOptions = {}): Promise<SessionStart> {
  const root = projectRoot(path);
  const p = paths(root);
  const running = readSession(root);
  if (running && !options.restart) {
    const status = await request(running, "status").catch(() => undefined);
    if (status?.["ok"]) return { info: running, loadSeconds: 0, reused: true, diagnostics: [] };
  }
  if (running) await stopSession(root);
  let projectText = "";
  try {
    projectText = readFileSync(join(root, "project.godot"), "utf8");
  } catch {
    // No project.godot: no settings.
  }
  const settings = parseProjectSettings(projectText);
  const scene = options.scene ? (options.scene.startsWith("res://") ? options.scene : `res://${options.scene.replace(/^\/+/, "")}`) : settings.mainScene;
  if (!scene) throw new PlayError("no scene: pass scene (a res:// path), or set a main scene (application/run/main_scene)");
  if (!existsSync(fromResPath(root, scene))) throw new PlayError(`${scene} does not exist in the project`);
  const fps = Number(settings.values["physics/common/physics_ticks_per_second"] ?? 60) || 60;
  const bin = findGodot(options.godot);
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  if (options.import !== false) await runGodot(bin, ["--headless", "--path", root, "--import"], { cwd: root, timeoutMs });
  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.script, sessionScript());
  const port = await freePort();
  const token = randomBytes(16).toString("hex");
  // The game writes its output here; this side reads it back through the same open file while it waits.
  const log = openSync(p.log, "w+");
  const started = Date.now();
  const child = spawn(
    bin,
    ["--headless", "--path", root, "--fixed-fps", String(fps), "-s", `res://${DIR}/session.gd`, "--", `--gw-port=${port}`, `--gw-token=${token}`, `--gw-scene=${scene}`, `--gw-idle=${Math.round((options.idleMinutes ?? 15) * 60)}`],
    { cwd: root, detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  const info: SessionInfo = { pid: child.pid ?? 0, port, token, scene, started: new Date(started).toISOString(), logOffset: 0, fps };
  const readLog = () => {
    const buffer = Buffer.alloc(fstatSync(log).size);
    readSync(log, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8");
  };
  // Wait until the scene has loaded and the port answers, or the game says why it cannot.
  let text = "";
  try {
    for (;;) {
      text = readLog();
      if (text.includes(`${SESSION_MARK}_FAILED`) || !alive(info.pid)) {
        const diagnostics = parseGodotLog(text, "session").filter((d) => d.severity === "error");
        throw new PlayError(`the game did not start: ${(/GODOTWRIGHT_SESSION_FAILED (.*)/.exec(text)?.[1] ?? diagnostics[0]?.message ?? "Godot quit").trim()}`);
      }
      if (text.includes(`${SESSION_MARK}_READY`)) break;
      if (Date.now() - started > timeoutMs) {
        try {
          process.kill(info.pid);
        } catch {
          // Already gone.
        }
        throw new PlayError(`the scene did not load within ${Math.round(timeoutMs / 1000)} s`);
      }
      await sleep(100);
    }
  } finally {
    closeSync(log);
  }
  // The log as read when the game said it was ready: what it printed while loading.
  info.logOffset = Buffer.byteLength(text);
  writeFileSync(p.info, JSON.stringify(info, null, 2));
  return { info, loadSeconds: Math.round((Date.now() - started) / 100) / 10, reused: false, diagnostics: parseGodotLog(text, "session") };
}

/** Errors and warnings the game printed since the last call, with their call chains. */
export function newDiagnostics(path: string): Diagnostic[] {
  const root = projectRoot(path);
  const p = paths(root);
  const info = readSession(root);
  if (!info) return [];
  // One open file for the size and the read, so the offset saved is the end of what was read.
  let fd: number;
  try {
    fd = openSync(p.log, "r");
  } catch {
    return [];
  }
  let size = 0;
  let buffer = Buffer.alloc(0);
  try {
    size = fstatSync(fd).size;
    if (size <= info.logOffset) return [];
    buffer = Buffer.alloc(size - info.logOffset);
    readSync(fd, buffer, 0, buffer.length, info.logOffset);
  } finally {
    closeSync(fd);
  }
  writeFileSync(p.info, JSON.stringify({ ...info, logOffset: size }, null, 2));
  return parseGodotLog(buffer.toString("utf8"), "session").filter((d) => !d.message.startsWith(SESSION_MARK));
}

export async function stopSession(path: string): Promise<boolean> {
  const root = projectRoot(path);
  const p = paths(root);
  const info = readSession(root);
  let stopped = false;
  if (info) {
    await request(info, "stop", {}, 5_000).catch(() => undefined);
    for (let i = 0; i < 50 && alive(info.pid); i++) await sleep(100);
    if (alive(info.pid)) {
      try {
        process.kill(info.pid);
      } catch {
        // Gone in the meantime.
      }
    }
    stopped = true;
  }
  rmSync(p.info, { force: true });
  rmSync(p.script, { force: true });
  return stopped;
}

/**
 * Files changed since the session loaded them (or since the last reload): the scripts a reload picks up, and the scenes
 * and resources it cannot (those need a restart).
 */
export function changedSince(path: string, info: SessionInfo): { scripts: string[]; others: string[] } {
  const root = projectRoot(path);
  const since = Date.parse(info.reloadedAt ?? info.started);
  const scripts: string[] = [];
  const others: string[] = [];
  for (const res of listProjectFiles(root)) {
    if (!/\.(gd|tscn|tres|gdshader|gdshaderinc)$/i.test(res) || res === "res://project.godot") continue;
    let mtime = 0;
    try {
      mtime = statSync(fromResPath(root, res)).mtimeMs;
    } catch {
      continue;
    }
    if (mtime <= since) continue;
    (res.endsWith(".gd") ? scripts : others).push(res);
  }
  return { scripts, others };
}

/** Reloads edited scripts into the running game: the named ones, or every script changed since the last reload. */
export async function reloadScripts(path: string, files?: string[]): Promise<{ reply: Record<string, unknown>; diagnostics: Diagnostic[]; others: string[] }> {
  const root = projectRoot(path);
  const info = readSession(root);
  if (!info) throw new PlayError("no game session is running: start one with godot_session (op start) or `godotwright session start`");
  const at = new Date().toISOString();
  const changed = changedSince(root, info);
  const list = files?.length ? files.map((f) => (f.startsWith("res://") ? f : `res://${f.replace(/^\/+/, "")}`)) : changed.scripts;
  const { reply, diagnostics } = await gameRequest(root, "reload", { files: list });
  const now = readSession(root);
  if (now && reply["ok"]) writeFileSync(paths(root).info, JSON.stringify({ ...now, reloadedAt: at }, null, 2));
  return { reply, diagnostics, others: changed.others };
}

/** What a timeline input becomes for the session script: an action, or the fields of a key, mouse or joypad event. */
export function inputDescriptor(input: string): Record<string, unknown> {
  if (!/^[A-Za-z]+:/.test(input)) return { kind: "action", name: input };
  const value = parseVariant(inputEventText(input));
  if (!isObject(value)) throw new PlayError(`"${input}" is not an input event`);
  const v = value.props;
  switch (value.class) {
    case "InputEventKey":
      return { kind: "key", code: Number(v["physical_keycode"]), ctrl: v["ctrl_pressed"] === true, shift: v["shift_pressed"] === true, alt: v["alt_pressed"] === true };
    case "InputEventMouseButton":
      return { kind: "mouse", button: Number(v["button_index"]) };
    case "InputEventJoypadButton":
      return { kind: "joy_button", button: Number(v["button_index"]) };
    default:
      return { kind: "joy_axis", axis: Number(v["axis"]), value: Number(v["axis_value"]) };
  }
}

/** A session request that needs a running session; says how to start one when there is none. */
export async function gameRequest(path: string, op: string, payload: Record<string, unknown> = {}, timeoutMs?: number): Promise<{ reply: Record<string, unknown>; diagnostics: Diagnostic[]; info: SessionInfo }> {
  const info = readSession(path);
  if (!info) throw new PlayError("no game session is running: start one with godot_session (op start) or `godotwright session start`");
  const reply = await request(info, op, payload, timeoutMs);
  return { reply, diagnostics: newDiagnostics(path), info };
}

/** A step request: frames, a timeline (frames counted from the step's first frame), values to sample, a stop condition. */
export function stepPayload(options: { frames: number; input?: string; watch?: string[]; every?: number; until?: string }): Record<string, unknown> {
  const inputs = parseTimeline(options.input ?? "").map((s) => ({ frame: s.frame, down: s.down, ...inputDescriptor(s.input) }));
  const until = options.until ? parseCondition(options.until) : undefined;
  return {
    frames: options.frames,
    every: options.every ?? Math.max(1, Math.ceil(options.frames / 10)),
    watch: options.watch ?? [],
    inputs,
    until: until ? [until.node, until.prop, until.op, until.value] : [],
  };
}
