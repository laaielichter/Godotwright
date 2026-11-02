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
  /** Which check produced it: "script", "scene", "shader", "import", "run" or "engine". */
  source: string;
  /** The GDScript call chain Godot printed with a runtime error, most recent call first (project frames only). */
  stack?: StackFrame[];
  /** How many times the same error was printed (a runtime error in _process repeats every frame). */
  count?: number;
}

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
  [/^SHADER ERROR:\s*(.*)$/, "error", "shader"],
  [/^SHADER WARNING:\s*(.*)$/, "warning", "shader"],
  [/^SCRIPT ERROR:\s*(.*)$/, "error", "script"],
  [/^USER ERROR:\s*(.*)$/, "error", "script"],
  [/^ERROR:\s*(.*)$/, "error", "engine"],
  [/^SCRIPT WARNING:\s*(.*)$/, "warning", "script"],
  [/^USER WARNING:\s*(.*)$/, "warning", "script"],
  [/^WARNING:\s*(.*)$/, "warning", "engine"],
];

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
// The file may be empty: a shader compiled from code reports `at: (null) (:4)`, a line in the code being compiled.
const AT = /^at:\s*(\(null\)|.*?)\s*\((.*):(\d+)\)\s*$/;
/** Godot echoes the shader code around an error: `--Main Shader--`, `--res://lib.gdshaderinc--`, `    3 | code`, `E   4-> code`. */
const SHADER_ECHO = /^--(?:Main Shader|res:\/\/.*)--$|^E?\s*\d+\s*(?:\||->)/;
const FRAME = /^\[\d+\]\s*(.*?)\s*\((.+):(\d+)\)\s*$/;
const RES_LINE = /(res:\/\/[^\s'"()]+?):(\d+)\b/;
const RES_PATH = /(res:\/\/[^\s'"()]+[^\s'"().,:;])/;

interface Pending {
  diag: Diagnostic;
  hasProjectLocation: boolean;
}

/**
 * Parses Godot output into diagnostics. `currentFile` markers from the checker
 * attribute engine errors that do not name a project file. Inside a `GODOTWRIGHT_SHADER <path>` marker a shader
 * error's line is a line of that shader; elsewhere (a scene that holds a Shader) it is kept in the message.
 */
export function parseGodotLog(text: string, source = "engine"): Diagnostic[] {
  const out: Diagnostic[] = [];
  let pending: Pending | undefined;
  let current: string | undefined;
  let currentShader = false;
  // "Shader compilation failed." follows every SHADER ERROR (or its include's) and says nothing more.
  let afterShaderError = false;
  const flush = () => {
    if (pending) {
      if (!pending.diag.file && current) pending.diag.file = current;
      const followUp = afterShaderError && pending.diag.message === "Shader compilation failed.";
      if (!followUp) out.push(pending.diag);
      afterShaderError = pending.diag.source === "shader" && pending.diag.severity === "error";
    }
    pending = undefined;
  };

  for (const rawLine of text.replace(ANSI, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;

    if (line.startsWith(`${MARKER}_BEGIN `) || line.startsWith(`${MARKER}_SHADER `)) {
      flush();
      currentShader = line.startsWith(`${MARKER}_SHADER `);
      current = line.slice(line.indexOf(" ") + 1).trim();
      continue;
    }
    if (line.startsWith(`${MARKER}_END`)) {
      flush();
      current = undefined;
      currentShader = false;
      continue;
    }
    if (line.startsWith(MARKER)) continue;
    if (SHADER_ECHO.test(line)) {
      flush();
      continue;
    }

    const head = HEADS.find(([re]) => re.test(line));
    if (head) {
      flush();
      const message = head[0].exec(line)![1]!.trim();
      const diag: Diagnostic = { severity: head[1], message, source: head[2] === "script" || head[2] === "shader" ? head[2] : source };
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
    if (location && location[2] === "" && pending.diag.source === "shader") {
      if (!pending.hasProjectLocation) {
        if (currentShader) pending.diag.line = Number(location[3]);
        else pending.diag.message += ` (shader line ${location[3]})`;
        pending.hasProjectLocation = true;
      }
      continue;
    }
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
    // A shader error's message can go on over a second line (SCREEN_TEXTURE: "To continue with minimal code changes ...").
    if (pending.diag.source === "shader" && !pending.hasProjectLocation && !pending.diag.stack) {
      pending.diag.message += ` ${line}`;
      continue;
    }
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
  const lines = [`${where}${d.severity}: ${d.message}${d.count && d.count > 1 ? ` (x${d.count})` : ""}`];
  // The call chain says how the code got there: the frames after the place of the error, the callers.
  const callers = (d.stack ?? []).filter((f, i) => i > 0 || f.file !== d.file || f.line !== d.line);
  for (const f of callers.slice(0, STACK_SHOWN)) lines.push(`    called from ${f.file}:${f.line} ${f.function}()`);
  if (callers.length > STACK_SHOWN) lines.push(`    ... ${callers.length - STACK_SHOWN} more frames`);
  return lines.join("\n");
}
