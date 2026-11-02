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
 * - Files changed on disk are seen at the next analysis, but a new class_name (or a changed project.godot) is not:
 *   the headless editor does not rescan. So the server is restarted when those change.
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

/** What makes a warm server stale: the project settings and the global class names. */
export class ProjectStamp {
  private readonly classes = new Map<string, { mtime: number; name: string }>();
  private settings = 0;
  private initialized = false;

  constructor(private readonly root: string) {}

  /** Reads the project again; true when something the server cannot see changed since the last call. */
  refresh(): boolean {
    const first = !this.initialized;
    this.initialized = true;
    let changed = false;
    const settings = mtime(join(this.root, "project.godot"));
    if (!first && settings !== this.settings) changed = true;
    this.settings = settings;
    const seen = new Set<string>();
    for (const res of listProjectFiles(this.root)) {
      if (!res.endsWith(".gd")) continue;
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
      if (known ? known.name !== name : !first && name !== "") changed = true;
      this.classes.set(res, { mtime: time, name });
    }
    for (const [res, known] of this.classes) {
      if (seen.has(res)) continue;
      this.classes.delete(res);
      if (known.name) changed = true;
    }
    return changed;
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
  readonly stamp: ProjectStamp;
  lastUsed = Date.now();
  /** How long the start took, in ms. */
  startMs = 0;

  private constructor(
    readonly root: string,
    readonly rpc: RpcConnection,
    readonly child: ChildProcess | undefined,
    private readonly log: () => string,
  ) {
    this.stamp = new ProjectStamp(root);
  }

  static async start(options: StartOptions): Promise<GodotLanguageServer> {
    const started = Date.now();
    const port = options.port ?? (await freePort());
    let child: ChildProcess | undefined;
    let output = "";
    let exited: string | undefined;
    if (options.godot) {
      child = spawn(options.godot, ["--editor", "--headless", "--path", options.root, "--lsp-port", String(port)], {
        cwd: options.root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const keep = (chunk: Buffer) => {
        output = (output + chunk.toString("utf8")).slice(-8000);
      };
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      child.on("error", (error) => (exited = `could not start Godot: ${error.message}`));
      child.on("exit", (code, signal) => (exited ??= `Godot exited (${signal ?? `code ${code}`})`));
      // A warm server must not keep this process alive (an MCP server ends when its client goes): the exit handler
      // of the pool stops it.
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
    const server = new GodotLanguageServer(options.root, rpc, child, log);
    try {
      await rpc.request("initialize", { processId: process.pid, rootUri: uriOf(options.root), rootPath: options.root, capabilities: {} }, Math.max(10_000, deadline - Date.now()));
      rpc.notify("initialized", {});
    } catch (error) {
      server.stop();
      throw new LanguageServerError(`the language server on port ${port} did not initialize: ${error instanceof Error ? error.message : String(error)}${tail()}`);
    }
    server.stamp.refresh();
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
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
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
    this.rpc.notify("textDocument/didOpen", { textDocument: { uri, languageId: "gdscript", version: 1, text } });
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
}

const pools = new Set<LanguageServerPool>();
let hooked = false;

/** Never leave a Godot editor running after this process: stop every pool's servers on exit and on the usual signals. */
function hookProcess(): void {
  if (hooked) return;
  hooked = true;
  const stopAll = () => {
    for (const pool of pools) pool.stopLive();
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

/** Warm language servers per project, for the lifetime of this process. */
export class LanguageServerPool {
  private readonly servers = new Map<string, Promise<GodotLanguageServer>>();
  private timer: NodeJS.Timeout | undefined;
  private readonly idleMs: number;
  private readonly startServer: (root: string, godot: string | undefined) => Promise<GodotLanguageServer>;
  private readonly live = new Set<GodotLanguageServer>();

  constructor(options: PoolOptions = {}) {
    this.idleMs = options.idleMs ?? 10 * 60_000;
    this.startServer = options.start ?? ((root, godot) => GodotLanguageServer.start({ root, godot: findGodot(godot) }));
  }

  /**
   * The warm server for the project, started on first use (`godot` is the binary, or undefined to find it).
   * `restarted` says why a server was started again: it died, or a class_name or project.godot changed, which a
   * running server does not see.
   */
  async get(root: string, godot?: string): Promise<{ server: GodotLanguageServer; fresh: boolean; restarted?: string }> {
    const existing = this.servers.get(root);
    let restarted: string | undefined;
    if (existing) {
      let server: GodotLanguageServer | undefined;
      try {
        server = await existing;
      } catch {
        server = undefined;
      }
      if (server && server.alive) {
        if (!server.stamp.refresh()) {
          server.lastUsed = Date.now();
          return { server, fresh: false };
        }
        restarted = "a class_name or project.godot changed since it started";
      } else if (server) restarted = "the previous language server had stopped";
      if (server) this.drop(server);
      this.servers.delete(root);
    }
    const starting = this.startServer(root, godot);
    this.servers.set(root, starting);
    starting.catch(() => this.servers.delete(root));
    const server = await starting;
    this.live.add(server);
    this.watch();
    return { server, fresh: true, ...(restarted ? { restarted } : {}) };
  }

  get size(): number {
    return this.servers.size;
  }

  /** Stops every server. */
  stopAll(): void {
    for (const p of this.servers.values()) p.then((s) => s.stop(), () => undefined);
    this.servers.clear();
    this.stopLive();
    pools.delete(this);
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private drop(server: GodotLanguageServer): void {
    server.stop();
    this.live.delete(server);
  }

  /** Stops servers unused for longer than the idle time; called by a timer, exposed for tests. */
  async sweep(now = Date.now()): Promise<void> {
    for (const [root, p] of [...this.servers]) {
      let server: GodotLanguageServer;
      try {
        server = await p;
      } catch {
        continue;
      }
      if (!server.alive || now - server.lastUsed >= this.idleMs) {
        this.drop(server);
        if (this.servers.get(root) === p) this.servers.delete(root);
      }
    }
    if (!this.servers.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private watch(): void {
    if (!this.timer) {
      this.timer = setInterval(() => void this.sweep(), Math.max(1000, Math.min(60_000, this.idleMs / 4)));
      this.timer.unref();
    }
    hookProcess();
    pools.add(this);
  }

  /** Synchronous, for the exit handler: stops every server that has started. */
  stopLive(): void {
    for (const s of this.live) s.stop();
    this.live.clear();
  }
}
