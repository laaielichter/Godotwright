/**
 * Parser for Godot's console output. Turns engine and script errors into
 * diagnostics with a project file and line number where possible.
 */

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** `res://` path of the project file, when known. */
  file?: string;
  line?: number;
  message: string;
  /** Which check produced it: "script", "scene", "import", "run" or "engine". */
  source: string;
  /** The GDScript call chain Godot printed with a runtime error, most recent call first (project frames only). */
  stack?: StackFrame[];
  /** How many times the same error was printed (a runtime error in _process repeats every frame). */
  count?: number;
  /** The review rule that predicts this message, when one does (so the static finding and Godot's agree). */
  rule?: string;
}

/** Godot messages a review rule predicts statically. */
const RULE_OF: [RegExp, string][] = [
  [/^UID duplicate detected between /, "structure/duplicate-uid"],
  [/ext_resource, invalid UID: /, "structure/unknown-uid"],
];

export interface StackFrame {
  function: string;
  file: string;
  line: number;
}

/** Frames shown under an error: the place itself and the callers above it. */
const STACK_SHOWN = 4;

/** Marker lines printed by the checker script around each file it loads. */
export const MARKER = "GODOTWRIGHT";

const HEADS: [RegExp, Severity, string][] = [
  [/^SCRIPT ERROR:\s*(.*)$/, "error", "script"],
  [/^USER ERROR:\s*(.*)$/, "error", "script"],
  [/^ERROR:\s*(.*)$/, "error", "engine"],
  [/^SCRIPT WARNING:\s*(.*)$/, "warning", "script"],
  [/^USER WARNING:\s*(.*)$/, "warning", "script"],
  [/^WARNING:\s*(.*)$/, "warning", "engine"],
];

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const AT = /^at:\s*(.*?)\s*\((.+):(\d+)\)\s*$/;
const FRAME = /^\[\d+\]\s*(.*?)\s*\((.+):(\d+)\)\s*$/;
const RES_LINE = /(res:\/\/[^\s'"()]+?):(\d+)\b/;
const RES_PATH = /(res:\/\/[^\s'"()]+[^\s'"().,:;])/;

interface Pending {
  diag: Diagnostic;
  hasProjectLocation: boolean;
}

/**
 * Parses Godot output into diagnostics. `currentFile` markers from the checker
 * attribute engine errors that do not name a project file.
 */
export function parseGodotLog(text: string, source = "engine"): Diagnostic[] {
  const out: Diagnostic[] = [];
  let pending: Pending | undefined;
  let current: string | undefined;
  const flush = () => {
    if (pending) {
      if (!pending.diag.file && current) pending.diag.file = current;
      out.push(pending.diag);
    }
    pending = undefined;
  };

  for (const rawLine of text.replace(ANSI, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    if (line.startsWith(`${MARKER}_BEGIN `)) {
      flush();
      current = line.slice(MARKER.length + 7).trim();
      continue;
    }
    if (line.startsWith(`${MARKER}_END`)) {
      flush();
      current = undefined;
      continue;
    }
    if (line.startsWith(MARKER)) continue;

    const head = HEADS.find(([re]) => re.test(line));
    if (head) {
      flush();
      const message = head[0].exec(line)![1]!.trim();
      const diag: Diagnostic = { severity: head[1], message, source: head[2] === "script" ? "script" : source };
      const inMessage = RES_LINE.exec(message);
      if (inMessage) {
        diag.file = inMessage[1];
        diag.line = Number(inMessage[2]);
        diag.message = message.replace(`${inMessage[0]} - `, "").replace(inMessage[0], "").trim() || message;
      } else {
        // Inside a checker block the file being loaded is the one to fix.
        const path = RES_PATH.exec(message);
        if (path && !current) diag.file = path[1];
      }
      const rule = RULE_OF.find(([re]) => re.test(message))?.[1];
      if (rule) diag.rule = rule;
      pending = { diag, hasProjectLocation: inMessage !== null };
      continue;
    }

    if (!pending) continue;
    const frame = FRAME.exec(line);
    if (frame) {
      const file = frame[2]!;
      // Frames in res://.godot/ belong to Godotwright's own runners, not the project.
      if (file.startsWith("res://") && !file.startsWith("res://.godot/")) {
        (pending.diag.stack ??= []).push({ function: frame[1]!, file, line: Number(frame[3]) });
      }
    }
    const location = AT.exec(line) ?? frame;
    if (location) {
      const file = location[2]!;
      // Frames in res://.godot/ belong to Godotwright's own checker, not the project.
      if (file.startsWith("res://") && !file.startsWith("res://.godot/") && !pending.hasProjectLocation) {
        pending.diag.file = file;
        pending.diag.line = Number(location[3]);
        pending.hasProjectLocation = true;
      }
      continue;
    }
    if (/^GDScript backtrace/i.test(line)) continue;
    // Any other line ends the current entry.
    flush();
  }
  flush();
  return dedupe(out);
}

/** One entry per error: a repeat (the same error from the same call chain) is counted, not listed again. */
function dedupe(diags: Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();
  const out: Diagnostic[] = [];
  for (const d of diags) {
    const chain = (d.stack ?? []).map((f) => `${f.file}:${f.line}`).join(">");
    const key = `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${d.message}|${chain}`;
    const first = seen.get(key);
    if (first) {
      first.count = (first.count ?? 1) + 1;
      continue;
    }
    seen.set(key, d);
    out.push(d);
  }
  return out;
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ` : "";
  const lines = [`${where}${d.severity}: ${d.message}${d.count && d.count > 1 ? ` (x${d.count})` : ""}${d.rule ? ` [${d.rule}]` : ""}`];
  // The call chain says how the code got there: the frames after the place of the error, the callers.
  const callers = (d.stack ?? []).filter((f, i) => i > 0 || f.file !== d.file || f.line !== d.line);
  for (const f of callers.slice(0, STACK_SHOWN)) lines.push(`    called from ${f.file}:${f.line} ${f.function}()`);
  if (callers.length > STACK_SHOWN) lines.push(`    ... ${callers.length - STACK_SHOWN} more frames`);
  return lines.join("\n");
}
