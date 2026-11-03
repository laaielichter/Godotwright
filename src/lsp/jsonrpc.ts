import type { Socket } from "node:net";

/**
 * JSON-RPC 2.0 over a byte stream with LSP framing (`Content-Length: N\r\n\r\n` and N bytes of JSON), as Godot's
 * GDScript language server speaks it over TCP.
 */

export interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export class RpcTimeoutError extends Error {
  constructor(method: string, ms: number) {
    super(`the language server did not answer ${method} within ${Math.round(ms / 100) / 10} s`);
    this.name = "RpcTimeoutError";
  }
}

export function encodeMessage(message: RpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Splits a byte stream into messages; bytes may arrive in any chunks. */
export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);

  /** Adds bytes and returns the messages they complete. A message that is not JSON is skipped. */
  push(chunk: Buffer): RpcMessage[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: RpcMessage[] = [];
    for (;;) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) break;
      const header = this.buffer.subarray(0, end).toString("ascii");
      const length = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(header);
      if (!length) {
        // A header without a length cannot be framed: drop it and look for the next one.
        this.buffer = this.buffer.subarray(end + 4);
        continue;
      }
      const size = Number(length[1]);
      if (this.buffer.length < end + 4 + size) break;
      const body = this.buffer.subarray(end + 4, end + 4 + size).toString("utf8");
      this.buffer = this.buffer.subarray(end + 4 + size);
      try {
        out.push(JSON.parse(body) as RpcMessage);
      } catch {
        // Not JSON: skip it.
      }
    }
    return out;
  }
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** A JSON-RPC connection: requests matched to responses by id, notifications to listeners. */
export class RpcConnection {
  private readonly reader = new MessageReader();
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(method: string, params: unknown) => void>();
  private readonly closeWaiters = new Set<(error: Error) => void>();
  private nextId = 1;
  private closedError: Error | undefined;

  constructor(
    private readonly socket: Socket,
    private readonly defaultTimeoutMs = 30_000,
  ) {
    socket.on("data", (chunk: Buffer) => {
      for (const message of this.reader.push(chunk)) this.dispatch(message);
    });
    socket.on("error", (error) => this.close(new Error(`language server connection failed: ${error.message}`)));
    socket.on("close", () => this.close(new Error("the language server closed the connection")));
  }

  get closed(): boolean {
    return this.closedError !== undefined;
  }

  /** Calls `fn` with every notification; returns a function that stops it. */
  onNotification(fn: (method: string, params: unknown) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = this.defaultTimeoutMs): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcTimeoutError(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      this.socket.write(encodeMessage({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    if (this.closedError) throw this.closedError;
    this.socket.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  /** Waits for the first notification `match` accepts, for at most `timeoutMs`. Register it before causing it. */
  waitFor<T>(match: (method: string, params: unknown) => T | undefined, timeoutMs: number, what: string): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise<T>((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        off();
        this.closeWaiters.delete(onClose);
      };
      const onClose = (error: Error) => {
        stop();
        reject(error);
      };
      const timer = setTimeout(() => {
        stop();
        reject(new RpcTimeoutError(what, timeoutMs));
      }, timeoutMs);
      const off = this.onNotification((method, params) => {
        const value = match(method, params);
        if (value === undefined) return;
        stop();
        resolve(value);
      });
      this.closeWaiters.add(onClose);
    });
  }

  close(error = new Error("the language server connection was closed")): void {
    if (this.closedError) return;
    this.closedError = error;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    for (const w of [...this.closeWaiters]) w(error);
    this.socket.destroy();
  }

  private dispatch(message: RpcMessage): void {
    if (message.method !== undefined) {
      // A request from the server (it has an id): answer it so the server does not wait. Godot sends none we need.
      if (message.id !== undefined && message.id !== null) {
        this.socket.write(encodeMessage({ jsonrpc: "2.0", id: message.id, result: null }));
      }
      for (const fn of [...this.listeners]) fn(message.method, message.params);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new RpcError(`${pending.method}: ${message.error.message}`, message.error.code));
    else pending.resolve(message.result);
  }
}
