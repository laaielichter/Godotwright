import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { findGodot } from "../check/godot.js";
import { parseGodotLog } from "../check/log.js";
import { parseProjectSettings } from "../godot/project-settings.js";
import { bundledLearning } from "../learn/bundled.js";
import { currentLearning } from "../learn/learn.js";
import { emptyLearning } from "../learn/store.js";
import { lessonHintsForMessages, lessonHintsForRules } from "../lessons/hints.js";
import { bundledLessons } from "../lessons/library.js";
import { findProjectRoot, listProjectFiles, toResPath } from "../project/files.js";
import { ProtectedPathError, protectionOf } from "../project/protect.js";
import { reviewProject } from "../review/review.js";
import type { Finding } from "../review/rules.js";

/**
 * Hooks for coding agents (Claude Code's hook events): they bring Godotwright into the agent's loop without the agent
 * having to remember a tool. After an edit of a Godot file the file is reviewed and its errors go back to the agent;
 * Godot messages in a command's output get the lessons that explain them; a session does not end quietly while a
 * changed file still has review errors; and a session in a Godot project starts with a few lines about it.
 *
 * Every hook fails open: when anything goes wrong it says nothing, so a hook never stands in the agent's way.
 */

/** What Claude Code sends a command hook on stdin (the fields used here). */
export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  stop_hook_active?: boolean;
  source?: string;
}

/** What a command hook prints on stdout as JSON. */
export interface HookOutput {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
    /** PreToolUse only: deny the tool call, with the reason Claude sees. */
    permissionDecision?: "deny";
    permissionDecisionReason?: string;
  };
}

export const HOOK_EVENTS = ["pre-edit", "post-edit", "post-bash", "stop", "session-start"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Files whose edits are reviewed. */
const GODOT_FILE = /\.(gd|tscn|tres|gdshader|gdshaderinc)$|(^|[\\/])project\.godot$/;
/** At most this many findings are listed in one message; the rest are counted. */
const MAX_LISTED = 8;

interface SessionState {
  /** Changed Godot files (absolute paths) with their project root and how many review errors they had last. */
  files: Record<string, { root: string; errors: number }>;
  /** The open errors the stop hook last asked about, so it asks only once about the same ones. */
  stopAsked?: string;
}

export interface HookContext {
  /** Folder for the per-session state (default: a folder in the system temp dir). */
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
}

function stateDir(context: HookContext): string {
  return context.stateDir ?? join(tmpdir(), "godotwright-hooks");
}

function statePath(context: HookContext, session: string): string {
  const id = createHash("sha1").update(session).digest("hex").slice(0, 16);
  return join(stateDir(context), `${id}.json`);
}

function readState(context: HookContext, session: string | undefined): SessionState {
  if (!session) return { files: {} };
  try {
    const parsed = JSON.parse(readFileSync(statePath(context, session), "utf8")) as SessionState;
    return parsed && typeof parsed.files === "object" ? parsed : { files: {} };
  } catch {
    return { files: {} };
  }
}

function writeState(context: HookContext, session: string | undefined, state: SessionState): void {
  if (!session) return;
  try {
    const dir = stateDir(context);
    mkdirSync(dir, { recursive: true });
    // Sessions end without telling anyone: forget state older than two days.
    const old = Date.now() - 2 * 24 * 3600 * 1000;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      try {
        if (statSync(file).mtimeMs < old) rmSync(file, { force: true });
      } catch {
        // Another session may have removed it.
      }
    }
    writeFileSync(statePath(context, session), JSON.stringify(state));
  } catch {
    // State only sharpens the stop hook; without it nothing breaks.
  }
}

/**
 * Review of the given files of a project, with what this machine and all installs learned applied, without counting it
 * as a review. Focused: the whole project is read, but only these files are checked.
 */
function review(root: string, files: string[]) {
  return reviewProject(root, { learning: currentLearning() ?? emptyLearning(), shared: bundledLearning(), focus: files });
}

function findingLine(f: Finding): string {
  return `  ${f.file}${f.line ? `:${f.line}` : ""} ${f.severity} [${f.rule}] ${f.message}`;
}

function listFindings(findings: Finding[]): string[] {
  const lines = findings.slice(0, MAX_LISTED).map(findingLine);
  if (findings.length > MAX_LISTED) lines.push(`  ... and ${findings.length - MAX_LISTED} more (godot_review with this file shows all)`);
  return lines;
}

function editedFile(input: HookInput): string | undefined {
  const raw = input.tool_input?.["file_path"] ?? input.tool_input?.["notebook_path"] ?? input.tool_input?.["path"];
  if (typeof raw !== "string" || !raw) return undefined;
  return isAbsolute(raw) ? raw : resolve(input.cwd ?? process.cwd(), raw);
}

/** Findings of one file (a scene's findings may name a node after `::`). */
function findingsOf(findings: Finding[], res: string): Finding[] {
  return findings.filter((f) => f.file === res || f.file.startsWith(`${res}::`));
}

/**
 * Before Write, Edit, MultiEdit or NotebookEdit: deny a write into a protected path (godotwright.json "protect" or
 * $GODOTWRIGHT_PROTECT) with the reason. Any file type counts. Bash commands are not parsed.
 */
export function preEdit(input: HookInput, context: HookContext = {}): HookOutput | undefined {
  const file = editedFile(input);
  if (!file) return undefined;
  const env = context.env ?? process.env;
  const protection = protectionOf(file, env, input.cwd ?? process.cwd());
  if (!protection) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: new ProtectedPathError(file, protection).message,
    },
  };
}

/** After Edit, Write or MultiEdit of a Godot file: review it, send errors back, mention warnings. */
export function postEdit(input: HookInput, context: HookContext = {}): HookOutput | undefined {
  const file = editedFile(input);
  if (!file || !GODOT_FILE.test(file) || !existsSync(file)) return undefined;
  const root = findProjectRoot(dirname(file));
  if (!root) return undefined;
  const res = toResPath(root, file);
  if (res.startsWith("res://addons/")) return undefined;
  const report = review(root, [res]);
  const mine = findingsOf(report.findings, res).filter((f) => f.severity !== "info");
  const errors = mine.filter((f) => f.severity === "error");
  const warnings = mine.filter((f) => f.severity === "warning");

  const state = readState(context, input.session_id);
  const before = state.files[file]?.errors ?? 0;
  state.files[file] = { root, errors: errors.length };
  writeState(context, input.session_id, state);

  const lessons = lessonHintsForRules(mine.map((f) => f.rule));
  if (errors.length) {
    return {
      decision: "block",
      reason: [
        `Godotwright reviewed ${res}: ${errors.length} error${errors.length === 1 ? "" : "s"}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}. Godot will report these too:`,
        ...listFindings([...errors, ...warnings]),
        ...lessons,
        "Next: fix the errors now (look up the API with godot_api). If the missing piece comes with your next edit, go on and fix the rest before you finish. If you verified a finding is a false alarm, report it with godot_feedback (verdict wrong).",
      ].join("\n"),
    };
  }
  if (warnings.length) {
    return context_("PostToolUse", [
      `Godotwright reviewed ${res}: no errors, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`,
      ...listFindings(warnings),
      ...lessons,
      "Next: fix the warnings that touch what you are building now; mention the others to the user when you finish.",
    ]);
  }
  if (before > 0) return context_("PostToolUse", [`Godotwright reviewed ${res}: the errors are fixed, no warnings.`]);
  return undefined;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function context_(event: string, lines: string[]): HookOutput {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: lines.join("\n") } };
}

/** The text of a tool's output, whatever shape the agent gives it. */
function outputText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  const r = response as Record<string, unknown>;
  const parts = [r["stdout"], r["stderr"], r["output"], r["content"]].filter((p): p is string => typeof p === "string");
  return parts.join("\n");
}

const GODOT_MESSAGE = /^(?:SCRIPT ERROR|USER ERROR|ERROR|SCRIPT WARNING|WARNING|Parse Error):/m;

/** After a shell command: when its output holds Godot errors, add the lessons that explain them. */
export function postBash(input: HookInput): HookOutput | undefined {
  const text = outputText(input.tool_response).slice(-200_000);
  if (!GODOT_MESSAGE.test(text)) return undefined;
  const messages = parseGodotLog(text)
    .filter((d) => d.severity === "error")
    .map((d) => d.message);
  const parse = [...text.matchAll(/Parse Error:\s*(.+)$/gm)].map((m) => m[1]!.trim());
  const hints = lessonHintsForMessages([...messages, ...parse]);
  if (!hints.length) return undefined;
  return context_("PostToolUse", [`Godotwright: the output above has Godot errors that real projects hit before.`, ...hints]);
}

/** Before the agent stops: changed Godot files that still have review errors are named once, so they are not left. */
export function stop(input: HookInput, context: HookContext = {}): HookOutput | undefined {
  if (input.stop_hook_active) return undefined;
  const state = readState(context, input.session_id);
  const open = Object.entries(state.files).filter(([file, s]) => s.errors > 0 && existsSync(file));
  if (!open.length) return undefined;
  const byRoot = new Map<string, string[]>();
  for (const [file, s] of open) byRoot.set(s.root, [...(byRoot.get(s.root) ?? []), file]);
  const still: Finding[] = [];
  for (const [root, files] of byRoot) {
    const report = review(root, files.map((file) => toResPath(root, file)));
    for (const file of files) {
      const errors = findingsOf(report.findings, toResPath(root, file)).filter((f) => f.severity === "error");
      state.files[file] = { root, errors: errors.length };
      still.push(...errors);
    }
  }
  const signature = createHash("sha1").update(still.map(findingLine).join("\n")).digest("hex");
  const asked = state.stopAsked === signature;
  if (still.length) state.stopAsked = signature;
  writeState(context, input.session_id, state);
  if (!still.length || asked) return undefined;
  return {
    decision: "block",
    reason: [
      `Godotwright: ${still.length} review error${still.length === 1 ? " is" : "s are"} still open in Godot files you changed:`,
      ...listFindings(still),
      "Next: fix them before you finish, or tell the user why they stay (report a verified false alarm with godot_feedback, verdict wrong).",
    ].join("\n"),
  };
}

/** At the start of a session in a Godot project: what the project is, and how Godotwright works here. */
export function sessionStart(input: HookInput, context: HookContext = {}): HookOutput | undefined {
  const env = context.env ?? process.env;
  const start = env["GODOTWRIGHT_PROJECT"] ? resolve(input.cwd ?? process.cwd(), env["GODOTWRIGHT_PROJECT"]) : (input.cwd ?? process.cwd());
  const root = findProjectRoot(start);
  if (!root) return undefined;
  const settings = parseProjectSettings(readFileSync(join(root, "project.godot"), "utf8"));
  const files = listProjectFiles(root);
  const scripts = files.filter((f) => f.endsWith(".gd") && !f.startsWith("res://addons/")).length;
  const scenes = files.filter((f) => f.endsWith(".tscn") && !f.startsWith("res://addons/")).length;
  let godot: string;
  try {
    findGodot(undefined, env);
    godot = "Godot is installed: godot_check, godot_test, godot_play and godot_screenshot run it headless.";
  } catch {
    godot = "Godot was not found (set GODOT to its path): godot_review, godot_api and godot_lessons still work without it.";
  }
  const version = settings.godotVersion ?? settings.features.find((f) => /^\d+\.\d+$/.test(f));
  return context_("SessionStart", [
    `Godotwright: Godot project "${settings.name ?? "(unnamed)"}"${version ? ` (Godot ${version}${settings.renderer ? `, ${settings.renderer}` : ""})` : ""}: ${plural(scripts, "script")}, ${plural(scenes, "scene")}${settings.mainScene ? `, main scene ${settings.mainScene}` : ""}${settings.autoloads.length ? `, autoloads ${settings.autoloads.map((a) => a.name).slice(0, 8).join(", ")}` : ""}.`,
    godot,
    "Every Godot file you edit is reviewed right after the edit; errors come back to you. Next: godot_doctor when something is broken (what is wrong, in which order, why), godot_scan once to map the project, godot_api for engine names (never guess Godot 3 names).",
    `godot_lessons holds ${bundledLessons().length} lessons from real Godot projects: ask it before you build vehicles, moving platforms, large worlds, shaders or runtime-loaded models, and with any Godot error you do not understand.`,
  ]);
}

export function runHook(event: HookEvent, input: HookInput, context: HookContext = {}): HookOutput | undefined {
  switch (event) {
    case "pre-edit":
      return preEdit(input, context);
    case "post-edit":
      return postEdit(input, context);
    case "post-bash":
      return postBash(input);
    case "stop":
      return stop(input, context);
    case "session-start":
      return sessionStart(input, context);
  }
}
