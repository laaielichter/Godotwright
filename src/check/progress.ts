/**
 * Progress and cancellation for long Godot runs. The MCP server opens a run context per tool call (`withRun`);
 * every Godot process started inside it (runGodot) is stopped when the call is cancelled, and reports its phase
 * and the progress lines Godot prints. Code that does not run inside a context behaves as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { basename } from "node:path";

export interface RunContext {
  /** Aborted when the caller gives up (an MCP cancel): the Godot process tree is stopped. */
  signal?: AbortSignal;
  /** Called with a short message per phase and, at most about once a second, with what Godot is doing. */
  onProgress?: (message: string) => void;
}

const store = new AsyncLocalStorage<RunContext>();

/** Runs `fn` with this context for every Godot run it starts. */
export function withRun<T>(context: RunContext, fn: () => Promise<T>): Promise<T> {
  return store.run(context, fn);
}

export function currentRun(): RunContext | undefined {
  return store.getStore();
}

export class CancelledError extends Error {
  constructor() {
    super("cancelled: the Godot process tree was stopped");
    this.name = "CancelledError";
  }
}

/** Throws CancelledError when the current run was cancelled (for waits between Godot runs). */
export function throwIfCancelled(signal: AbortSignal | undefined = currentRun()?.signal): void {
  if (signal?.aborted) throw new CancelledError();
}

/**
 * What a Godot run is for, from its arguments: import, export, a script (checker, play, compile), the version probe
 * or a run. The last `--script`/`-s` with a value counts: a wrapper before Godot (xvfb-run -s "-screen ...") has its own.
 */
export function phaseOf(args: readonly string[]): string {
  if (args.includes("--import")) return "import";
  if (args.some((a) => a.startsWith("--export"))) return "export";
  for (let at = args.length - 2; at >= 0; at--) {
    if ((args[at] === "--script" || args[at] === "-s") && !args[at + 1]!.startsWith("-")) {
      const name = basename(args[at + 1]!).replace(/\.gd$/, "");
      return name === "check" ? "load" : name === "compile" ? "shader compile" : name || "script";
    }
  }
  if (args.includes("--version")) return "version";
  return "run";
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Turns the lines Godot prints into progress messages; keeps the counts a check needs between lines. */
export class ProgressParser {
  private total = 0;
  private done = 0;
  constructor(private readonly phase: string) {}

  /** A message for this line, or undefined when the line says nothing about progress. */
  line(raw: string): string | undefined {
    const line = raw.replace(ANSI, "").trim();
    const percent = /^\[\s*(\d+)% \]\s+(\w+)/.exec(line);
    if (percent) return `${this.phase}: ${percent[2]} ${percent[1]}%`;
    const finished = /^\[ DONE \]\s+(\w+)/.exec(line);
    if (finished) return `${this.phase}: ${finished[1]} done`;
    const total = /^GODOTWRIGHT_TOTAL (\d+)/.exec(line);
    if (total) {
      this.total = Number(total[1]);
      return `${this.phase}: ${this.total} files`;
    }
    if (line.startsWith("GODOTWRIGHT_END ")) {
      this.done++;
      return `${this.phase}: ${this.done}${this.total ? `/${this.total}` : ""} files`;
    }
    const frame = /^GODOTWRIGHT_PLAY_PROGRESS (\d+) (\d+)/.exec(line);
    if (frame) return `${this.phase}: frame ${frame[1]}/${frame[2]}`;
    return undefined;
  }
}

export interface Throttled {
  (message: string, force?: boolean): void;
  /** Sends the message held back, if any (at the end of a run). */
  flush(): void;
  /** Drops the message held back and stops its timer. */
  stop(): void;
}

/**
 * Calls `report` at most once per `ms`, except for messages sent with `force`. A message that comes too soon is held
 * back and sent once the interval has passed, unless a newer one replaces it first; so the last one is never lost.
 */
export function throttle(report: (message: string) => void, ms = 1000): Throttled {
  let last = 0;
  let held: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  const send = (message: string) => {
    last = Date.now();
    report(message);
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    held = undefined;
  };
  const flush = () => {
    const message = held;
    stop();
    if (message !== undefined) send(message);
  };
  const throttled = ((message: string, force = false) => {
    const wait = last + ms - Date.now();
    if (force) {
      flush();
      send(message);
      return;
    }
    if (wait <= 0 && held === undefined) {
      send(message);
      return;
    }
    held = message;
    timer ??= setTimeout(flush, Math.max(0, wait));
    timer.unref?.();
  }) as Throttled;
  throttled.flush = flush;
  throttled.stop = stop;
  return throttled;
}
