import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findGodot } from "../check/godot.js";
import { fromResPath, listProjectFiles } from "../project/files.js";
import { RpcConnection } from "./jsonrpc.js";

/**
 * Godot's own GDScript language server, kept warm per project. Observed with Godot 4.7.2:
 * - `godot --editor --headless --path <project> --lsp-port <port>` serves the language server; it answers after
 *   4-7 s on the official demos (also on a project that was never imported: it imports while it serves).
 * - Only file:// URIs work ("The language server only supports the file protocol" for res://); Godot sends them
 *   percent-encoded.
 * - didOpen and didChange of text that is not on disk are analysed; publishDiagnostics follows for every one, also
 *   when it is empty. The project's warning levels apply (debug/gdscript/warnings/...).
 * - It has no `shutdown` method ("Method not found"), so it is stopped by ending the process.
 * - Files changed on disk are seen at the next analysis, and so are new and removed scenes and deleted files, but a new
 *   class_name, a changed project.godot and a new file that needs an import (png, ogg, glb...) are not: the headless
 *   editor does not rescan, so `preload` of a new png stays "has no resource loaders". So the server is restarted when
 *   those change.
 */

export class LanguageServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanguageServerError";
  }
}

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  code?: number | string;
  message: string;
  source?: string;
}

export interface StartOptions {
  root: string;
  /** The Godot binary; without it, nothing is started and `port` must already serve (tests). */
  godot?: string;
  port?: number;
  /** How long to wait for the language server to answer after starting Godot (default 120 s). */
  startTimeoutMs?: number;
  /** Timeout of each request (default 30 s). */
  requestTimeoutMs?: number;
}

/** A free TCP port on 127.0.0.1. */
export function freePort(): Promise<number> {
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

function tryConnect(port: number): Promise<Socket | undefined> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function uriOf(path: string): string {
  return pathToFileURL(path).href;
}

/** The file path of a file:// URI, or undefined for any other URI. */
export function pathOfUri(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/** Whether two paths name one file: Godot may answer with the real path (a linked folder, /tmp on macOS). */
export function samePath(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  const norm = (p: string) => {
    let real = p;
    try {
      real = realpathSync(p);
    } catch {
      // Not on disk (unsaved code): compare as given.
    }
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  return a === b || norm(a) === norm(b);
}

/**
 * Files the language server takes as they are on disk (scripts, text scenes and resources), text nobody preloads, and
 * the files Godot writes itself next to others (.uid, .import). Every other new file needs an import first.
 */
const NOT_IMPORTED = /(?:^|\/)\.[^/]*$|\.(?:gd|tscn|tres|uid|import|godot|md|txt|cs)$/i;

/**
 * What makes a warm server stale: the project settings, the global class names, and new files that need an import
 * (a png, ogg or glb added after the start is never imported by the running editor, so preloading it is an error).
 */
export class ProjectStamp {
  private readonly classes = new Map<string, { mtime: number; name: string }>();
  private assets = new Set<string>();
  private settings = 0;
  private initialized = false;

  constructor(private readonly root: string) {}

  /** Reads the project again; says what the server cannot see that changed since the last call, if anything. */
  refresh(): string | undefined {
    const first = !this.initialized;
    this.initialized = true;
    let reason: string | undefined;
    const settings = mtime(join(this.root, "project.godot"));
    if (!first && settings !== this.settings) reason ??= "project.godot changed";
    this.settings = settings;
    const seen = new Set<string>();
    const assets = new Set<string>();
    for (const res of listProjectFiles(this.root)) {
      if (!res.endsWith(".gd")) {
        if (NOT_IMPORTED.test(res)) continue;
        assets.add(res);
        if (!first && !this.assets.has(res)) reason ??= `${res} was added, which the running editor does not import`;
        continue;
      }
      seen.add(res);
      const file = fromResPath(this.root, res);
      const time = mtime(file);
      const known = this.classes.get(res);
      if (known && known.mtime === time) continue;
      let name = "";
      try {
        name = /^\s*class_name\s+([A-Za-z_]\w*)/m.exec(readFileSync(file, "utf8"))?.[1] ?? "";
      } catch {
        // Unreadable: no class name.
      }
      if (known ? known.name !== name : !first && name !== "") reason ??= `the class_name in ${res} changed`;
      this.classes.set(res, { mtime: time, name });
    }
    for (const [res, known] of this.classes) {
      if (seen.has(res)) continue;
      this.classes.delete(res);
      if (known.name) reason ??= `${res} with class_name ${known.name} was removed`;
    }
    this.assets = assets;
    return reason;
  }
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}

/** One running language server for one project, with a single connection. Calls are run one at a time. */
export class GodotLanguageServer {
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  lastUsed = Date.now();
  /** How long the start took, in ms. */
  startMs = 0;

  private constructor(
    readonly root: string,
    readonly rpc: RpcConnection,
    readonly child: ChildProcess | undefined,
    private readonly log: () => string,
    /** The project as it was when Godot started (and scanned it). */
    readonly stamp: ProjectStamp,
  ) {}

  static async start(options: StartOptions): Promise<GodotLanguageServer> {
    const started = Date.now();
    // Taken before Godot scans the project: a file added during the start counts as new.
    const stamp = new ProjectStamp(options.root);
    stamp.refresh();
    const port = options.port ?? (await freePort());
    let child: ChildProcess | undefined;
    let output = "";
    let exited: string | undefined;
    if (options.godot) {
      // The editor also serves the GDScript debug adapter, on 6006 unless told otherwise: a free port keeps 6006 for
      // the editor the user opens (and for their debugger to attach to it, not to this hidden one).
      let dap = await freePort();
      while (dap === port) dap = await freePort();
      // Before the spawn: a signal during the start (seconds, on a first import minutes) must stop this Godot too.
      hookProcess();
      child = spawn(options.godot, ["--editor", "--headless", "--path", options.root, "--lsp-port", String(port), "--dap-port", String(dap)], {
        cwd: options.root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const spawned = child;
      godots.add(spawned);
      spawned.on("exit", () => godots.delete(spawned));
      spawned.on("error", () => godots.delete(spawned));
      const keep = (chunk: Buffer) => {
        output = (output + chunk.toString("utf8")).slice(-8000);
      };
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      child.on("error", (error) => (exited = `could not start Godot: ${error.message}`));
      child.on("exit", (code, signal) => (exited ??= `Godot exited (${signal ?? `code ${code}`})`));
      // A warm server must not keep this process alive (an MCP server ends when its client goes): the exit handler
      // stops it.
      child.unref();
      for (const pipe of [child.stdout, child.stderr]) (pipe as unknown as { unref?: () => void } | null)?.unref?.();
    }
    const log = () => output;
    const tail = () => {
      const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).filter((l) => l.trim() && !/^\[\s*\d+% \]/.test(l));
      return lines.length ? `\nlast output:\n${lines.slice(-8).join("\n")}` : "";
    };
    const deadline = started + (options.startTimeoutMs ?? 120_000);
    let socket: Socket | undefined;
    for (;;) {
      if (exited) throw new LanguageServerError(`${exited} before its language server answered${tail()}`);
      socket = await tryConnect(port);
      if (socket) break;
      if (Date.now() > deadline) {
        child?.kill("SIGKILL");
        throw new LanguageServerError(`the GDScript language server did not answer on port ${port} within ${Math.round((options.startTimeoutMs ?? 120_000) / 100) / 10} s${tail()}`);
      }
      await sleep(150);
    }
    socket.unref();
    const rpc = new RpcConnection(socket, options.requestTimeoutMs ?? 30_000);
    const server = new GodotLanguageServer(options.root, rpc, child, log, stamp);
    try {
      await rpc.request("initialize", { processId: process.pid, rootUri: uriOf(options.root), rootPath: options.root, capabilities: {} }, Math.max(10_000, deadline - Date.now()));
      rpc.notify("initialized", {});
    } catch (error) {
      server.stop();
      throw new LanguageServerError(`the language server on port ${port} did not initialize: ${error instanceof Error ? error.message : String(error)}${tail()}`);
    }
    server.startMs = Date.now() - started;
    return server;
  }

  get alive(): boolean {
    return !this.rpc.closed && (!this.child || (this.child.exitCode === null && this.child.signalCode === null));
  }

  /** Godot's output so far (the last 8000 characters). */
  output(): string {
    return this.log();
  }

  /** Runs `fn` after every earlier call has finished. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.waiting++;
    const call = async () => {
      try {
        return await fn();
      } finally {
        this.waiting--;
        this.lastUsed = Date.now();
      }
    };
    const run = this.queue.then(call, call);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Whether a call is running or waiting its turn. */
  get busy(): boolean {
    return this.waiting > 0;
  }

  /**
   * Opens the text as the document at `path`, returns the diagnostics Godot publishes for it, and leaves it open;
   * call `close` when done.
   */
  async open(path: string, text: string, timeoutMs = 30_000): Promise<LspDiagnostic[]> {
    this.lastUsed = Date.now();
    const uri = uriOf(path);
    const wait = this.rpc.waitFor(
      (method, params) => {
        if (method !== "textDocument/publishDiagnostics") return undefined;
        const p = params as { uri?: string; diagnostics?: LspDiagnostic[] };
        return p.uri && samePath(pathOfUri(p.uri), path) ? (p.diagnostics ?? []) : undefined;
      },
      timeoutMs,
      `diagnostics for ${path}`,
    );
    try {
      this.rpc.notify("textDocument/didOpen", { textDocument: { uri, languageId: "gdscript", version: 1, text } });
    } catch (error) {
      // The connection is gone (Godot died, or the server was stopped while this call waited its turn): nobody awaits
      // `wait` now, and an unhandled rejection would end the whole process (the MCP server with every tool).
      wait.catch(() => undefined);
      throw error;
    }
    return wait;
  }

  close(path: string): void {
    if (!this.rpc.closed) this.rpc.notify("textDocument/didClose", { textDocument: { uri: uriOf(path) } });
  }

  request<T>(method: string, params: unknown): Promise<T> {
    this.lastUsed = Date.now();
    return this.rpc.request<T>(method, params);
  }

  stop(): void {
    this.rpc.close();
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
  }
}

export interface PoolOptions {
  /** Stop a server unused this long (default 10 minutes). */
  idleMs?: number;
  start?: (root: string, godot: string | undefined) => Promise<GodotLanguageServer>;
  /** False when the owner stops the servers right after its call (the CLI), so nothing stays warm (default true). */
  keepWarm?: boolean;
}

const pools = new Set<LanguageServerPool>();
/** Every Godot this process started that has not exited, also those still starting. */
const godots = new Set<ChildProcess>();
let hooked = false;

/** Kills every Godot language server this process started (synchronous, for exit handlers). */
export function killGodots(): void {
  for (const child of godots) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

/** Never leave a Godot editor running after this process: stop every server on exit and on the usual signals. */
function hookProcess(): void {
  if (hooked) return;
  hooked = true;
  const stopAll = () => {
    for (const pool of pools) pool.stopLive();
    killGodots();
  };
  process.once("exit", stopAll);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const onSignal = () => {
      stopAll();
      process.removeListener(signal, onSignal);
      // When nothing else handles the signal, end the process as the signal would have.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
}

const RETRY = Symbol("retry");

/** What `LanguageServerPool.run` tells the call about the server it got. */
export interface ServerInfo {
  /** Started for this call (else it was warm). */
  fresh: boolean;
  /** Why it was started again: the old one stopped, or the project changed in a way a running server cannot see. */
  restarted?: string;
}

/**
 * Warm language servers per project, for the lifetime of this process. Every decision about a project's server
 * (reuse, restart, idle stop) is made in one queue per project, so parallel calls never start two editors for one
 * project, and a restart lets the calls already queued on the old server finish first.
 */
export class LanguageServerPool {
  private readonly servers = new Map<string, Promise<GodotLanguageServer>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private timer: NodeJS.Timeout | undefined;
  private readonly idleMs: number;
  private readonly startServer: (root: string, godot: string | undefined) => Promise<GodotLanguageServer>;
  private readonly live = new Set<GodotLanguageServer>();

  /** Whether a server outlives the call that started it (false in the CLI). */
  readonly keepsWarm: boolean;

  constructor(options: PoolOptions = {}) {
    this.idleMs = options.idleMs ?? 10 * 60_000;
    this.keepsWarm = options.keepWarm ?? true;
    this.startServer = options.start ?? ((root, godot) => GodotLanguageServer.start({ root, godot: findGodot(godot) }));
  }

  /**
   * Runs `fn` on the project's warm server, after the calls queued on it before; the server is started on first use
   * (`godot` is the binary, or undefined to find it), and started again when it died or the project changed in a way
   * a running server does not see.
   */
  async run<T>(root: string, godot: string | undefined, fn: (server: GodotLanguageServer, info: ServerInfo) => Promise<T>, retried = false): Promise<T> {
    let job: Promise<T | typeof RETRY> | undefined;
    await this.locked(root, async () => {
      const { server, info } = await this.acquire(root, godot);
      // Queued while the project's lock is held: a restart decided after this waits for it.
      job = server.exclusive(async () => {
        // The server died while this call waited its turn (Godot crashed during an earlier call): it never reached
        // Godot, so it can run on a new server, once.
        if (!server.alive && !retried) return RETRY;
        return fn(server, info);
      });
      job.catch(() => undefined);
    });
    const out = await job!;
    return out === RETRY ? this.run(root, godot, fn, true) : out;
  }

  get size(): number {
    return this.servers.size;
  }

  /** Stops every server at once, also those still working (the CLI at its end, the exit handler). */
  stopAll(): void {
    for (const p of this.servers.values()) p.then((s) => s.stop(), () => undefined);
    this.servers.clear();
    this.stopLive();
    pools.delete(this);
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Stops servers unused for longer than the idle time, and dead ones; called by a timer, exposed for tests. */
  async sweep(now = Date.now()): Promise<void> {
    for (const root of [...this.servers.keys()]) {
      await this.locked(root, async () => {
        const p = this.servers.get(root);
        if (!p) return;
        const server = await p.catch(() => undefined);
        if (!server) {
          this.servers.delete(root);
          return;
        }
        if (server.alive && (server.busy || now - server.lastUsed < this.idleMs)) return;
        this.drop(server);
        this.servers.delete(root);
      });
    }
    if (!this.servers.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Synchronous, for the exit handler: stops every server that has started. */
  stopLive(): void {
    for (const s of this.live) s.stop();
    this.live.clear();
  }

  /** Runs `fn` after the earlier decisions about this project's server. */
  private locked<T>(root: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(root) ?? Promise.resolve()).then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(root, tail);
    void tail.then(() => {
      if (this.locks.get(root) === tail) this.locks.delete(root);
    });
    return run;
  }

  /** Only inside `locked(root)`. */
  private async acquire(root: string, godot: string | undefined): Promise<{ server: GodotLanguageServer; info: ServerInfo }> {
    const existing = this.servers.get(root);
    let restarted: string | undefined;
    if (existing) {
      const old = await existing.catch(() => undefined);
      if (old && old.alive) {
        restarted = old.stamp.refresh();
        if (!restarted) {
          old.lastUsed = Date.now();
          return { server: old, info: { fresh: false } };
        }
        // Let the calls already queued on it finish (they were asked before the change), then stop it.
        await old.exclusive(async () => this.drop(old));
      } else if (old) {
        restarted = "the previous language server had stopped";
        this.drop(old);
      }
      this.servers.delete(root);
    }
    const starting = this.startServer(root, godot);
    this.servers.set(root, starting);
    let server: GodotLanguageServer;
    try {
      server = await starting;
    } catch (error) {
      if (this.servers.get(root) === starting) this.servers.delete(root);
      throw error;
    }
    this.live.add(server);
    this.watch();
    return { server, info: { fresh: true, ...(restarted ? { restarted } : {}) } };
  }

  private drop(server: GodotLanguageServer): void {
    server.stop();
    this.live.delete(server);
  }

  private watch(): void {
    if (!this.timer) {
      this.timer = setInterval(() => void this.sweep(), Math.max(1000, Math.min(60_000, this.idleMs / 4)));
      this.timer.unref();
    }
    hookProcess();
    pools.add(this);
  }
}
