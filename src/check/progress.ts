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

/** What a Godot run is for, from its arguments: import, export, a script (checker, play, compile) or a run. */
export function phaseOf(args: readonly string[]): string {
  if (args.includes("--import")) return "import";
  if (args.some((a) => a.startsWith("--export"))) return "export";
  const at = Math.max(args.indexOf("--script"), args.indexOf("-s"));
  if (at >= 0) {
    const name = basename(args[at + 1] ?? "").replace(/\.gd$/, "");
    return name === "check" ? "load" : name === "compile" ? "shader compile" : name || "script";
  }
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

/** Calls `report` at most once per `ms`, except for messages sent with `force`. */
export function throttle(report: (message: string) => void, ms = 1000): (message: string, force?: boolean) => void {
  let last = 0;
  return (message, force = false) => {
    const now = Date.now();
    if (!force && now - last < ms) return;
    last = now;
    report(message);
  };
}
