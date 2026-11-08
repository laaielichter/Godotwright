import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { GodotApi } from "../api/api.js";
import { readUndone, JournalWriter } from "../journal/journal.js";
import {
  learningAllowed,
  lessonHash,
  readLearning,
  saveLearning,
  stateDir,
  type LearningData,
  type LearningUndo,
} from "../learn/store.js";
import { addLocalLesson, LessonError, projectKey, type LessonInput } from "../lessons/local.js";
import { projectNames } from "../lessons/names.js";
import { allLessons, errorTemplate } from "../lessons/search.js";
import type { Lesson, LocalLesson } from "../lessons/types.js";
import { findProjectRoot } from "../project/files.js";
import { ProtectedPathError, protectionOf } from "../project/protect.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { emptyFacts, readTranscripts, sessionFolders, type TranscriptFacts, type TranscriptOptions } from "./transcripts.js";

/**
 * Dreaming: between sessions, Godotwright looks back at what it learned on this machine (the learning file), what was
 * written and undone in this project (the journal) and, only when asked, the project's Claude Code and Codex session
 * transcripts. It finds recurring mistakes, API names the agent keeps guessing, lessons that do not help, duplicates,
 * noisy rules and verdicts that contradict each other, and turns them into numbered proposals with their evidence.
 *
 * Deterministic: no model calls, no network, nothing leaves the machine. Nothing changes until a proposal is applied;
 * an apply goes through the journal, so `godotwright undo` takes it back (lessons in the learning file included).
 */

export class DreamError extends Error {}

export type ProposalKind =
  | "draft-lesson"
  | "api-hint"
  | "undo-lesson"
  | "merge-lessons"
  | "retire-lesson"
  | "rewrite-lesson"
  | "finish-draft"
  | "resolve"
  | "noisy-rule";

const KIND_ORDER: ProposalKind[] = ["draft-lesson", "api-hint", "undo-lesson", "merge-lessons", "retire-lesson", "rewrite-lesson", "finish-draft", "resolve", "noisy-rule"];

const KIND_LABEL: Record<ProposalKind, string> = {
  "draft-lesson": "draft lesson",
  "api-hint": "project hint",
  "undo-lesson": "lesson from undone writes",
  "merge-lessons": "merge lessons",
  "retire-lesson": "retire lesson",
  "rewrite-lesson": "rewrite lesson",
  "finish-draft": "finish draft",
  resolve: "resolve",
  "noisy-rule": "noisy rule",
};

/** Safe details of a proposal: Godot message templates, Godot API names, lesson ids, a rule id, a tool and a file kind. */
export interface ProposalDetail {
  template?: string;
  use?: string;
  not?: string;
  lessons?: string[];
  rule?: string;
  tool?: string;
  fileKind?: string;
  /** How many findings the proposal is about (their fingerprints stay local and are never printed). */
  findings?: number;
}

export interface Proposal {
  /** Number in this list, from 1. */
  n: number;
  /** Stable id: the same proposal has the same key in the next dream. */
  key: string;
  kind: ProposalKind;
  title: string;
  reason: string;
  evidence: Record<string, number>;
  /** What applying it does; absent for a suggestion, which applying only marks as seen. */
  apply?: string;
  /** Only adds or updates lessons or hints (never removes anything), so "auto": "apply" may apply it. */
  auto: boolean;
  detail: ProposalDetail;
}

export interface DreamConfig {
  /** suggest (default): the session-start hook says when a dream is due. apply: it applies lesson and hint changes. off: never. */
  auto: "suggest" | "apply" | "off";
  minHours: number;
  minSessions: number;
}

export const DEFAULT_DREAM: DreamConfig = { auto: "suggest", minHours: 24, minSessions: 5 };

export interface Due {
  due: boolean;
  /** Hours since the last dream (or since the first session counted). */
  hours: number;
  sessions: number;
  config: DreamConfig;
  lastDream?: string;
}

export interface DreamSources {
  learning: boolean;
  /** Undone writes read from the journal. */
  undone: number;
  transcripts?: Omit<TranscriptFacts, "errors" | "apiMisses"> & { errors: number; apiMisses: number };
}

export interface DreamResult {
  root: string;
  proposals: Proposal[];
  sources: DreamSources;
  due: Due;
}

export interface DreamOptions {
  /** Only journal events and transcripts at or after this time (ms since the epoch; default 30 days back). */
  since?: number;
  /** Read the project's Claude Code and Codex session transcripts too. */
  transcripts?: boolean;
  transcriptOptions?: TranscriptOptions;
  now?: Date;
  /** The learning data to use instead of the learning file (tests). */
  learning?: LearningData;
  /** Show proposals that were applied or seen before, too. */
  all?: boolean;
}

/** Evidence a proposal needs before it is made. */
export const MIN_REPEATS = 2;
const DAY = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------------------------------------------
// Settings and state

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The "dream" settings of godotwright.json in the project or a folder above it, with defaults for what is not set. */
export function readDreamConfig(root: string): DreamConfig {
  for (const dir of sessionFolders(root)) {
    const file = join(dir, "godotwright.json");
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const d = parsed?.["dream"];
      if (!isRecord(d)) continue;
      const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
      const auto = d["auto"] === "apply" || d["auto"] === "off" || d["auto"] === "suggest" ? d["auto"] : DEFAULT_DREAM.auto;
      return { auto, minHours: num(d["minHours"], DEFAULT_DREAM.minHours), minSessions: num(d["minSessions"], DEFAULT_DREAM.minSessions) };
    } catch {
      // Not JSON: the defaults hold.
    }
  }
  return { ...DEFAULT_DREAM };
}

/** When this machine last dreamed for a project, and the sessions since. Kept in Godotwright's state folder, not the project. */
interface MachineState {
  firstSeen: string;
  lastDream?: string;
  sessions: number;
  /** Hashes of the last session ids counted, so a resumed session is not counted twice. */
  recent: string[];
}

function machineFile(): string {
  return join(stateDir(), "dreams.json");
}

function readMachine(): Record<string, MachineState> {
  try {
    const parsed = JSON.parse(readFileSync(machineFile(), "utf8")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed["projects"])) return {};
    const out: Record<string, MachineState> = {};
    for (const [k, v] of Object.entries(parsed["projects"])) {
      if (!isRecord(v) || typeof v["firstSeen"] !== "string") continue;
      out[k] = {
        firstSeen: v["firstSeen"],
        ...(typeof v["lastDream"] === "string" ? { lastDream: v["lastDream"] } : {}),
        sessions: typeof v["sessions"] === "number" && v["sessions"] >= 0 ? v["sessions"] : 0,
        recent: Array.isArray(v["recent"]) ? v["recent"].filter((r): r is string => typeof r === "string").slice(-20) : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeMachine(change: (projects: Record<string, MachineState>) => void): void {
  try {
    const projects = readMachine();
    change(projects);
    const file = machineFile();
    mkdirSync(stateDir(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
    renameSync(tmp, file);
  } catch {
    // Bookkeeping only: a dream is never blocked by it.
  }
}

/** Counts a session in the project (the session-start hook calls it). A session id already counted is not counted again. */
export function recordSession(root: string, sessionId?: string, now = new Date()): void {
  // Learning off (by the variable or `godotwright learn off`): nothing is counted.
  if (!learningAllowed(readLearning())) return;
  writeMachine((projects) => {
    const key = projectKey(root);
    const s = (projects[key] ??= { firstSeen: now.toISOString(), sessions: 0, recent: [] });
    if (sessionId) {
      const id = createHash("sha1").update(sessionId).digest("hex").slice(0, 12);
      if (s.recent.includes(id)) return;
      s.recent = [...s.recent, id].slice(-20);
    }
    s.sessions++;
  });
}

/** Marks that the project dreamed now: the hours and sessions start counting again. */
export function markDreamed(root: string, now = new Date()): void {
  writeMachine((projects) => {
    const key = projectKey(root);
    const s = (projects[key] ??= { firstSeen: now.toISOString(), sessions: 0, recent: [] });
    s.lastDream = now.toISOString();
    s.sessions = 0;
  });
}

/** Whether a dream is due: at least minHours since the last one (or the first session counted) and minSessions sessions. */
export function dreamDue(root: string, config = readDreamConfig(root), now = new Date()): Due {
  const s = readMachine()[projectKey(root)];
  const since = s?.lastDream ?? s?.firstSeen;
  const hours = since ? Math.max(0, (now.getTime() - Date.parse(since)) / 3_600_000) : 0;
  const sessions = s?.sessions ?? 0;
  const due = config.auto !== "off" && since !== undefined && hours >= config.minHours && sessions >= config.minSessions;
  return { due, hours: Math.floor(hours), sessions, config, ...(s?.lastDream ? { lastDream: s.lastDream } : {}) };
}

/** What a dream keeps in the project: the hints that were applied, and the proposals already applied or seen. */
export interface ProjectDreamState {
  version: 1;
  hints: { use: string; not: string; count: number }[];
  /** Proposal key: its evidence when it was applied or seen. It comes back once its evidence doubles. */
  acknowledged: Record<string, number>;
}

const DREAM_DIR = [".godot", "godotwright", "dreams"];

export function dreamDir(root: string): string {
  return join(root, ...DREAM_DIR);
}

export function readProjectState(root: string): ProjectDreamState {
  const empty: ProjectDreamState = { version: 1, hints: [], acknowledged: {} };
  try {
    const parsed = JSON.parse(readFileSync(join(dreamDir(root), "state.json"), "utf8")) as unknown;
    if (!isRecord(parsed)) return empty;
    const hints = Array.isArray(parsed["hints"])
      ? parsed["hints"].filter((h): h is ProjectDreamState["hints"][number] => isRecord(h) && typeof h["use"] === "string" && typeof h["not"] === "string" && typeof h["count"] === "number")
      : [];
    const acknowledged: Record<string, number> = {};
    if (isRecord(parsed["acknowledged"])) for (const [k, v] of Object.entries(parsed["acknowledged"])) if (typeof v === "number") acknowledged[k] = v;
    return { version: 1, hints, acknowledged };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Proposals

const keyOf = (kind: ProposalKind, ...parts: string[]) => createHash("sha1").update([kind, ...parts].join("\n")).digest("hex").slice(0, 8);
const total = (evidence: Record<string, number>) => Object.values(evidence).reduce((a, b) => a + b, 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The lessons that explain a Godot message template: a fragment of a bundled lesson, or the template of a local one. */
function explainedBy(template: string, learning: LearningData, api: GodotApi): string[] {
  const lower = template.toLowerCase();
  return allLessons(learning)
    .filter(({ lesson, local }) =>
      (lesson.errors ?? []).some((e) => (local ? e === template : lower.includes(e.toLowerCase()) || errorTemplate(e, api).toLowerCase() === lower)),
    )
    .map(({ lesson }) => lesson.id);
}

const words = (text: string) => new Set(text.toLowerCase().replace(/<\w+>/g, " ").match(/\p{L}{3,}/gu) ?? []);

function similar(a: Lesson, b: Lesson): boolean {
  if ((a.errors ?? []).some((e) => (b.errors ?? []).includes(e))) return true;
  const wa = words(a.title);
  const wb = words(b.title);
  if (wa.size < 3 || wb.size < 3) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared) >= 0.75;
}

/** The fix a dream writes into a draft; a lesson whose fix still starts with it is a draft, whatever its tags. */
const DRAFT_FIX = "Not written yet.";
const isDraft = (l: Lesson) => l.tags.includes("draft") || l.fix.startsWith(DRAFT_FIX);

/** Words for a file kind in a lesson title. */
const KIND_WORDS: Record<string, string> = {
  ".tscn": "scene",
  ".scn": "scene",
  ".gd": "script",
  ".tres": "resource",
  ".res": "resource",
  ".import": "import settings",
  "project.godot": "project settings",
  ".glb": "model",
  ".gltf": "model",
  ".gdshader": "shader",
  ".gdshaderinc": "shader",
  ".json": "data",
  ".png": "picture",
  ".cfg": "settings",
};

function shortTemplate(template: string): string {
  return template.length > 110 ? `${template.slice(0, 107).trimEnd()}...` : template;
}

/** Evidence labels: the learning file counts for the whole machine; transcripts are this project's own. */
const MACHINE = "missed by the review (all projects on this machine)";
const PROJECT_SESSIONS = "in this project's session transcripts";

/** Where an error was seen, said honestly: the learning file is for the whole machine, transcripts are this project's. */
function seenText(evidence: Record<string, number>): string {
  const machine = evidence[MACHINE] ?? 0;
  const here = evidence[PROJECT_SESSIONS] ?? 0;
  const parts = [machine ? `${plural(machine, "time")} in Godot checks on this machine (any project)` : "", here ? `${plural(here, "time")} in this project's sessions` : ""].filter(Boolean);
  return `Godot printed it ${parts.join(" and ")}`;
}

/** The draft lesson for a recurring Godot error: symptom and message, the fix left for the agent or person. */
export function draftLessonInput(template: string, evidence: Record<string, number>): LessonInput {
  return {
    title: `Godot error without a lesson yet: ${shortTemplate(template)}`,
    symptom: `${seenText(evidence)}, and no review rule or lesson explained it.`,
    fix: `${DRAFT_FIX} Find the cause, fix it once, then rewrite this lesson with the cause, the fix and a test.`,
    error: template,
    topic: "gdscript",
    tags: ["draft", "dream"],
  };
}

function undoLessonInput(tool: string, kind: string, count: number): LessonInput {
  const what = KIND_WORDS[kind] ?? "other";
  return {
    title: `Writes by the ${tool} tool to ${what} files were undone repeatedly`,
    symptom: `In this project ${count} writes of ${what} files by the ${tool} tool were taken back with undo.`,
    fix: `${DRAFT_FIX} Look at what the undone writes changed, find what went wrong, and rewrite this lesson with the cause and a check to run before the next write.`,
    topic: "tooling",
    tags: ["draft", "dream", "undo"],
  };
}

function since(options: DreamOptions, now: Date): number {
  return options.since ?? now.getTime() - 30 * DAY;
}

/** Looks back at what was learned and done, and returns the proposals. Reads only; changes nothing. */
export function dream(path: string, options: DreamOptions = {}): DreamResult {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const now = options.now ?? new Date();
  const from = since(options, now);
  const api = GodotApi.load();
  const learning = options.learning ?? readLearning();
  const facts = options.transcripts ? readTranscripts(root, { since: from, ...options.transcriptOptions }) : emptyFacts();
  const state = readProjectState(root);
  const undone = readUndone(root).filter((u) => Date.parse(u.undoneAt) >= from && u.tool !== "dream");
  const raw: Omit<Proposal, "n">[] = [];

  // a. Recurring Godot errors that no rule predicted and no lesson explains.
  const errors = new Map<string, Record<string, number>>();
  for (const [t, n] of Object.entries(learning.missedByReview)) errors.set(t, { ...errors.get(t), [MACHINE]: n });
  for (const [t, n] of Object.entries(facts.errors)) errors.set(t, { ...errors.get(t), [PROJECT_SESSIONS]: n });
  for (const [template, evidence] of errors) {
    if (total(evidence) < MIN_REPEATS || explainedBy(template, learning, api).length) continue;
    raw.push({
      key: keyOf("draft-lesson", template),
      kind: "draft-lesson",
      title: `Godot error without a lesson yet: ${shortTemplate(template)}`,
      reason: `${seenText(evidence)}; no review rule predicted it and no lesson explains it.`,
      evidence,
      apply: "keeps a draft local lesson with the symptom and the message; the cause and fix are left to write (godot_lesson_add with the same title)",
      auto: true,
      detail: { template },
    });
  }

  // b. API names the agent keeps guessing, with what it meant.
  const misses = new Map<string, { count: number; resolved: Record<string, number> }>();
  for (const source of [learning.apiMisses, facts.apiMisses]) {
    for (const [query, miss] of Object.entries(source)) {
      const m = misses.get(query) ?? { count: 0, resolved: {} };
      m.count += miss.count;
      for (const [t, n] of Object.entries(miss.resolved)) m.resolved[t] = (m.resolved[t] ?? 0) + n;
      misses.set(query, m);
    }
  }
  for (const [query, miss] of misses) {
    if (miss.count < MIN_REPEATS) continue;
    const best = Object.entries(miss.resolved)
      .filter(([t]) => t !== query && api.lookup(t).entries.length > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best || state.hints.some((h) => h.not === query && h.use === best[0])) continue;
    raw.push({
      key: keyOf("api-hint", query, best[0]),
      kind: "api-hint",
      title: `Remember: use ${best[0]}, not ${query}`,
      reason: `${query} does not exist in Godot 4.7; it was looked up ${plural(miss.count, "time")} and ${best[0]} was what came next.`,
      evidence: { "failed lookups": miss.count, "then found": best[1] },
      apply: "adds the hint to the project's dream state and the agents-file block",
      auto: true,
      detail: { use: best[0], not: query },
    });
  }

  // e. Writes that were undone again and again, by tool and file kind.
  const undoneBy = new Map<string, number>();
  for (const u of undone) for (const kind of u.kinds) undoneBy.set(`${u.tool}\n${kind}`, (undoneBy.get(`${u.tool}\n${kind}`) ?? 0) + 1);
  for (const [k, count] of undoneBy) {
    if (count < MIN_REPEATS) continue;
    const [tool, kind] = k.split("\n") as [string, string];
    const input = undoLessonInput(tool, kind, count);
    if (learning.localLessons.some((l) => l.title === input.title)) continue;
    raw.push({
      key: keyOf("undo-lesson", tool, kind),
      kind: "undo-lesson",
      title: input.title,
      reason: `${plural(count, "write")} of ${KIND_WORDS[kind] ?? kind} files by ${tool} were undone; something about them keeps going wrong.`,
      evidence: { "undone writes": count },
      apply: "keeps a draft local lesson about it; what went wrong is left to write",
      auto: true,
      detail: { tool, fileKind: kind },
    });
  }

  // c. Duplicate local lessons.
  const local = learning.localLessons;
  const merged = new Set<string>();
  for (let i = 0; i < local.length; i++) {
    for (let j = i + 1; j < local.length; j++) {
      const a = local[i]!;
      const b = local[j]!;
      if (merged.has(a.id) || merged.has(b.id) || !similar(a, b)) continue;
      const [keep, drop] = keepFirst(a, b, learning);
      merged.add(drop.id);
      raw.push({
        key: keyOf("merge-lessons", keep.id, drop.id),
        kind: "merge-lessons",
        title: `Merge ${drop.id} into ${keep.id}`,
        reason: "The two local lessons are about the same thing (the same Godot message, or nearly the same title).",
        evidence: { "shared messages": (keep.errors ?? []).filter((e) => (drop.errors ?? []).includes(e)).length, lessons: 2 },
        apply: `adds the messages, tags and rules of ${drop.id} to ${keep.id} and removes ${drop.id}`,
        auto: false,
        detail: { lessons: [keep.id, drop.id] },
      });
    }
  }

  // c. Lessons shown often that were marked wrong, or never helped.
  for (const [id, s] of Object.entries(learning.lessons)) {
    const lesson = local.find((l) => l.id === id);
    const isLocal = id.startsWith("local/");
    if (isLocal && !lesson) continue;
    const evidence = { shown: s.shown, helped: s.helped, wrong: s.wrong };
    if (s.wrong >= MIN_REPEATS && s.wrong > s.helped) {
      raw.push(
        isLocal
          ? {
              key: keyOf("retire-lesson", id),
              kind: "retire-lesson",
              title: `Retire or rewrite ${id}`,
              reason: `It was marked wrong ${plural(s.wrong, "time")} and helped ${s.helped}; rewrite it with godot_lesson_add (same title) if it can be right, else retire it.`,
              evidence,
              apply: "removes the lesson from this machine (undo puts it back)",
              auto: false,
              detail: { lessons: [id] },
            }
          : {
              key: keyOf("rewrite-lesson", id),
              kind: "rewrite-lesson",
              title: `Rewrite bundled lesson ${id}`,
              reason: `It was marked wrong ${plural(s.wrong, "time")} here and helped ${s.helped}. It already stays out of unasked hints; tell the maintainers what did not fit (an issue with a small example).`,
              evidence,
              auto: false,
              detail: { lessons: [id] },
            },
      );
    } else if (isLocal && lesson && !isDraft(lesson) && s.shown >= 10 && s.helped === 0 && s.wrong === 0) {
      raw.push({
        key: keyOf("rewrite-lesson", id),
        kind: "rewrite-lesson",
        title: `Rewrite ${id}: shown often, never marked as helpful`,
        reason: `It was shown ${plural(s.shown, "time")} without a verdict. Make the fix more concrete (godot_lesson_add with the same title), or retire it.`,
        evidence,
        auto: false,
        detail: { lessons: [id] },
      });
    }
  }

  // Drafts kept by an earlier dream that nobody finished.
  for (const lesson of local.filter(isDraft)) {
    raw.push({
      key: keyOf("finish-draft", lesson.id),
      kind: "finish-draft",
      title: `Finish the draft ${lesson.id}`,
      reason: "A dream kept it as a draft; it still has no cause or fix. Look it up (godot_lessons, godot_api), fix it once, and rewrite it with godot_lesson_add (same title).",
      evidence: { shown: learning.lessons[lesson.id]?.shown ?? 0 },
      auto: false,
      detail: { lessons: [lesson.id] },
    });
  }

  // f. Learned data that contradicts itself.
  const conflicts = Object.keys(learning.dismissed).filter((fp) => learning.verified[fp] !== undefined);
  if (conflicts.length) {
    const newerRight = conflicts.filter((fp) => learning.verified[fp]! > learning.dismissed[fp]!).length;
    raw.push({
      key: keyOf("resolve", "fingerprints"),
      kind: "resolve",
      title: `Resolve ${plural(conflicts.length, "finding")} marked both wrong and right`,
      reason: `A finding was marked as a false alarm, and later marked right or confirmed by Godot (or the other way round). The newest verdict is the likely one: ${newerRight} would show again, ${conflicts.length - newerRight} stay hidden.`,
      evidence: { findings: conflicts.length, "right after wrong": newerRight },
      apply: "keeps the newest verdict of each finding and forgets the older one",
      auto: false,
      detail: { findings: conflicts.length },
    });
  }
  for (const [rule, s] of Object.entries(learning.rules)) {
    if (s.dismissed >= MIN_REPEATS && s.confirmed >= 1) {
      raw.push({
        key: keyOf("resolve", rule),
        kind: "resolve",
        title: `Check the false alarms of ${rule}: Godot confirmed it`,
        reason: `Its findings were marked as false alarms ${plural(s.dismissed, "time")}, but real Godot reported the same error ${plural(s.confirmed, "time")}. Some of those verdicts are probably wrong: review them again.`,
        evidence: { "marked wrong": s.dismissed, "confirmed by Godot": s.confirmed },
        auto: false,
        detail: { rule },
      });
    }
  }

  // d. Rules this project dismisses again and again (a suggestion only).
  for (const [rule, s] of Object.entries(learning.rules)) {
    const right = (s.verified ?? 0) + s.confirmed;
    if (s.dismissed < 3 || s.dismissed < 2 * right || s.confirmed > 0) continue;
    raw.push({
      key: keyOf("noisy-rule", rule),
      kind: "noisy-rule",
      title: `${rule} is noisy here`,
      reason: `Its findings were marked as false alarms ${plural(s.dismissed, "time")} and right ${right}. Check whether the rule misreads this project's code, and tell the maintainers with a small example. (After 5 such marks it is reported one level lower already.)`,
      evidence: { "marked wrong": s.dismissed, "marked right or confirmed": right },
      auto: false,
      detail: { rule },
    });
  }

  const shown = raw.filter((p) => {
    const seen = state.acknowledged[p.key];
    return options.all || seen === undefined || total(p.evidence) >= 2 * Math.max(1, seen);
  });
  shown.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || total(b.evidence) - total(a.evidence) || a.key.localeCompare(b.key));
  const proposals = shown.map((p, i) => ({ n: i + 1, ...p }));
  const sources: DreamSources = {
    learning: learningAllowed(learning),
    undone: undone.length,
    ...(options.transcripts
      ? { transcripts: { sessions: facts.sessions, claude: facts.claude, codex: facts.codex, toolCalls: facts.toolCalls, errors: total(facts.errors), apiMisses: Object.keys(facts.apiMisses).length, dropped: facts.dropped } }
      : {}),
  };
  return { root, proposals, sources, due: dreamDue(root, readDreamConfig(root), now) };
}

/** Of two duplicate lessons, the one to keep first: the one that helped more, else the older, else by id. */
function keepFirst(a: LocalLesson, b: LocalLesson, learning: LearningData): [LocalLesson, LocalLesson] {
  const ha = learning.lessons[a.id]?.helped ?? 0;
  const hb = learning.lessons[b.id]?.helped ?? 0;
  if (ha !== hb) return ha > hb ? [a, b] : [b, a];
  if (a.added !== b.added) return a.added < b.added ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}

// ---------------------------------------------------------------------------------------------------------------
// Apply

export interface ApplyOptions extends DreamOptions {
  /** Only the proposals "auto": "apply" may apply (lesson and hint changes, never a removal). */
  auto?: boolean;
  /** Create AGENTS.md in the project when neither AGENTS.md nor CLAUDE.md exists. */
  writeAgentsFile?: boolean;
}

export interface ApplyResult {
  root: string;
  applied: { proposal: Proposal; result: string }[];
  /** Suggestions marked as seen: they come back when their evidence doubles. */
  seen: Proposal[];
  skipped: { proposal: Proposal; why: string }[];
  /** Files written, as res:// paths (an agents file above the project starts with res://../). */
  files: string[];
  journal?: number;
  /** Proposals that were not selected. */
  left: number;
  /** Files that were not written, and why. */
  notes: string[];
}

/** Picks proposals by number or key ("1,3", "a1b2c3d4", "all"). Unknown ones are an error that lists what there is. */
export function selectProposals(proposals: Proposal[], selection: string | string[]): Proposal[] {
  const items = (Array.isArray(selection) ? selection : [selection]).flatMap((s) => s.split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean);
  if (!items.length) throw new DreamError("name the proposals to apply: numbers or ids from the list, or all");
  if (items.includes("all")) return proposals;
  const out: Proposal[] = [];
  for (const item of items) {
    const p = /^\d+$/.test(item) ? proposals.find((x) => x.n === Number(item)) : proposals.find((x) => x.key === item.toLowerCase());
    if (!p) throw new DreamError(`no proposal "${item}" (there ${proposals.length === 1 ? "is 1" : `are ${proposals.length}`}; run godotwright dream to list them)`);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Applies proposals: lessons through the local-lessons API (scrubbed), hints and the report into the project, all journalled. */
export function applyDream(path: string, selection: string | string[], options: ApplyOptions = {}): ApplyResult {
  const result = dream(path, options);
  const { root } = result;
  const now = options.now ?? new Date();
  let chosen = selectProposals(result.proposals, selection);
  if (options.auto) chosen = chosen.filter((p) => p.auto);
  const learning = options.learning ?? readLearning();
  const canLearn = learningAllowed(learning);
  const state = readProjectState(root);
  const journal = new JournalWriter(root, "dream", `dream: ${plural(chosen.length, "proposal")} applied`);
  const out: ApplyResult = { root, applied: [], seen: [], skipped: [], files: [], left: result.proposals.length - chosen.length, notes: [] };
  const names = chosen.some((p) => p.kind === "draft-lesson" || p.kind === "undo-lesson") ? projectNames(root) : [];
  const api = GodotApi.load();

  const keepLesson = (p: Proposal, input: LessonInput) => {
    if (!canLearn) return out.skipped.push({ proposal: p, why: "learning is off on this machine (godotwright learn on)" });
    try {
      const before = readLearning().localLessons;
      const added = addLocalLesson(input, { projectNames: names, now, project: root });
      const old = before.find((l) => l.id === added.lesson.id);
      journal.recordLearning({ lessons: [{ id: added.lesson.id, ...(old ? { before: old } : {}), after: lessonHash(added.lesson) }] });
      out.applied.push({ proposal: p, result: `${added.updated ? "updated" : "kept"} ${added.lesson.id}` });
      // A draft just kept is known to be a draft: "finish it" comes back once it has been shown twice.
      if (added.lesson.tags.includes("draft")) state.acknowledged[keyOf("finish-draft", added.lesson.id)] = 0;
    } catch (error) {
      out.skipped.push({ proposal: p, why: error instanceof LessonError ? error.message : String(error) });
    }
  };

  const changeLearning = (p: Proposal, change: (d: LearningData, undo: LearningUndo) => string | undefined) => {
    if (!canLearn) return out.skipped.push({ proposal: p, why: "learning is off on this machine (godotwright learn on)" });
    const undo: LearningUndo = { lessons: [] };
    let said: string | undefined;
    const { error } = saveLearning((d) => {
      said = change(d, undo);
    });
    if (error) return out.skipped.push({ proposal: p, why: `the learning file was not saved: ${error}` });
    if (said === undefined) return out.skipped.push({ proposal: p, why: "nothing to change any more" });
    journal.recordLearning(undo);
    out.applied.push({ proposal: p, result: said });
  };

  for (const p of chosen) {
    switch (p.kind) {
      case "draft-lesson":
        keepLesson(p, draftLessonInput(p.detail.template!, p.evidence));
        break;
      case "undo-lesson":
        keepLesson(p, undoLessonInput(p.detail.tool!, p.detail.fileKind!, p.evidence["undone writes"] ?? 0));
        break;
      case "api-hint": {
        const { use, not } = p.detail as { use: string; not: string };
        state.hints = [...state.hints.filter((h) => h.not !== not), { use, not, count: p.evidence["failed lookups"] ?? 0 }];
        out.applied.push({ proposal: p, result: `hint: use ${use}, not ${not}` });
        break;
      }
      case "retire-lesson":
        changeLearning(p, (d, undo) => {
          const id = p.detail.lessons![0]!;
          const at = d.localLessons.findIndex((l) => l.id === id);
          if (at < 0) return undefined;
          undo.lessons.push({ id, before: d.localLessons[at]!, after: "", at });
          d.localLessons.splice(at, 1);
          return `retired ${id}`;
        });
        break;
      case "merge-lessons":
        changeLearning(p, (d, undo) => {
          const [keepId, dropId] = p.detail.lessons as [string, string];
          const keep = d.localLessons.find((l) => l.id === keepId);
          const drop = d.localLessons.find((l) => l.id === dropId);
          if (!keep || !drop) return undefined;
          const before = structuredClone(keep);
          const errors = [...new Set([...(keep.errors ?? []), ...(drop.errors ?? [])])].slice(0, 8);
          const rules = [...new Set([...(keep.rules ?? []), ...(drop.rules ?? [])])].slice(0, 5);
          keep.tags = [...new Set([...keep.tags, ...drop.tags])].slice(0, 12);
          if (errors.length) keep.errors = errors;
          if (rules.length) keep.rules = rules;
          if (!keep.test && drop.test) keep.test = drop.test;
          const at = d.localLessons.indexOf(drop);
          d.localLessons.splice(at, 1);
          undo.lessons.push({ id: keepId, before, after: lessonHash(keep) }, { id: dropId, before: drop, after: "", at });
          return `merged ${dropId} into ${keepId}`;
        });
        break;
      case "resolve":
        if (p.detail.rule) {
          out.seen.push(p);
          break;
        }
        changeLearning(p, (d, undo) => {
          let kept = 0;
          undo.dismissed = {};
          undo.verified = {};
          for (const fp of Object.keys(d.dismissed)) {
            const right = d.verified[fp];
            if (right === undefined) continue;
            if (right > d.dismissed[fp]!) {
              undo.dismissed[fp] = d.dismissed[fp]!;
              delete d.dismissed[fp];
              kept++;
            } else {
              undo.verified[fp] = right;
              delete d.verified[fp];
            }
          }
          return Object.keys(undo.dismissed).length + Object.keys(undo.verified).length ? `kept the newest verdict: ${kept} shown again` : undefined;
        });
        break;
      default:
        out.seen.push(p);
    }
  }

  for (const p of [...out.applied.map((a) => a.proposal), ...out.seen]) state.acknowledged[p.key] = total(p.evidence);

  const write = (full: string, data: string, outside = false) => {
    try {
      if (outside) journal.allowOutside(full);
      const current = existsSync(full) ? readFileSync(full, "utf8") : undefined;
      if (current === data) return;
      // A protected file is skipped before the journal sees it, so the entry is stored once, with what was written.
      if (protectionOf(full)) {
        out.notes.push(`${toRes(root, full)} is protected and was not written`);
        return;
      }
      journal.write(full, data);
      out.files.push(toRes(root, full));
    } catch (error) {
      // One file that cannot be written (protected, read-only, a full disk) never loses what was applied.
      out.notes.push(
        error instanceof ProtectedPathError ? `${toRes(root, full)} is protected and was not written` : `${toRes(root, full)} was not written: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  try {
    writeFiles();
  } finally {
    // What was applied to the learning file is always journalled, so undo can take it back.
    out.journal = journal.commit();
  }
  return out;

  function writeFiles(): void {
    if (!out.applied.length && !out.seen.length) return;
    const dir = dreamDir(root);
    write(join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
    const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    write(join(dir, `${stamp}.md`), formatReport(result, out, now));
    const after = readLearning();
    const block = agentsBlock(after, state, api, projectKey(root));
    for (const file of agentsFiles(root, options.writeAgentsFile === true)) {
      let current: string;
      try {
        current = existsSync(file) ? readFileSync(file, "utf8") : "";
      } catch (error) {
        out.notes.push(`${toRes(root, file)} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      // Only marking suggestions as seen changes nothing an agent needs: an agents file gets a block only from a change.
      if (!out.applied.length && !current.includes(BLOCK_START)) continue;
      write(file, withBlock(current, block), relative(root, file).startsWith(".."));
    }
  }
}

function toRes(root: string, full: string): string {
  return `res://${relative(root, full).split(sep).join("/")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The agents-file block

export const BLOCK_START = "<!-- godotwright:dream:start -->";
export const BLOCK_END = "<!-- godotwright:dream:end -->";

/** The AGENTS.md and CLAUDE.md files the block goes into: those in the project, else those at the repository root above it. */
export function agentsFiles(root: string, create: boolean): string[] {
  for (const dir of sessionFolders(root)) {
    const found = ["AGENTS.md", "CLAUDE.md"].map((f) => join(dir, f)).filter((f) => existsSync(f));
    if (found.length) return found;
  }
  return create ? [join(root, "AGENTS.md")] : [];
}

/**
 * The block: the top recurring mistakes with their fix, and the project's API hints. Short on purpose. Only lessons that
 * ship with Godotwright and local lessons learned in this project (`project`: its key) go in: local lessons from other
 * projects on the machine, or without a project, never do.
 */
export function agentsBlock(learning: LearningData, state: ProjectDreamState, api: GodotApi = GodotApi.load(), project?: string): string {
  const mistakes: { lesson: Lesson; weight: number }[] = [];
  const mine = learning.localLessons.filter((l) => project !== undefined && (l.projects ?? []).includes(project));
  const scoped = { ...learning, localLessons: mine };
  const lessons = allLessons(scoped);
  for (const [template, n] of Object.entries(learning.missedByReview)) {
    for (const id of explainedBy(template, scoped, api)) {
      const l = lessons.find((x) => x.lesson.id === id)?.lesson;
      if (l && !isDraft(l)) mistakes.push({ lesson: l, weight: n * 2 });
    }
  }
  for (const l of mine) {
    const s = learning.lessons[l.id];
    if (!isDraft(l) && !(s && s.wrong > s.helped)) mistakes.push({ lesson: l, weight: 1 + (s?.helped ?? 0) });
  }
  const byId = new Map<string, { lesson: Lesson; weight: number }>();
  for (const m of mistakes) byId.set(m.lesson.id, { lesson: m.lesson, weight: (byId.get(m.lesson.id)?.weight ?? 0) + m.weight });
  const top = [...byId.values()].sort((a, b) => b.weight - a.weight || a.lesson.id.localeCompare(b.lesson.id)).slice(0, 5);
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);
  const out = [
    BLOCK_START,
    "## Godotwright lessons for agents",
    "",
    "Kept by `godotwright dream` from what went wrong in this project; it rewrites this block, so edit outside the markers.",
  ];
  if (top.length) {
    out.push("", "Recurring mistakes:");
    for (const { lesson } of top) out.push(`- ${clip(lesson.title, 120)} Fix: ${clip(lesson.fix, 160)} (\`${lesson.id}\`)`);
  }
  if (state.hints.length) {
    out.push("", "Project hints:");
    for (const h of [...state.hints].sort((a, b) => b.count - a.count || a.not.localeCompare(b.not)).slice(0, 8)) out.push(`- Use \`${h.use}\`, not \`${h.not}\`.`);
  }
  if (!top.length && !state.hints.length) out.push("", "No recurring mistakes yet.");
  out.push(BLOCK_END);
  return out.join("\n");
}

/** Puts the block into a file's text: in place of the old block, else at the end. */
export function withBlock(text: string, block: string): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start >= 0 && end > start) return `${text.slice(0, start)}${block}${text.slice(end + BLOCK_END.length)}`;
  const base = text.replace(/\s*$/, "");
  return base ? `${base}\n\n${block}\n` : `${block}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// Output

function evidenceText(e: Record<string, number>): string {
  return Object.entries(e)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
}

function sourcesText(s: DreamSources): string {
  const parts = [s.learning ? "learning file" : "learning file (learning is off)", `journal: ${plural(s.undone, "undone write")}`];
  if (s.transcripts) parts.push(`transcripts: ${plural(s.transcripts.sessions, "session")} (${s.transcripts.claude} Claude Code, ${s.transcripts.codex} Codex), ${plural(s.transcripts.errors, "Godot error")}`);
  return parts.join("; ");
}

function dueText(d: Due): string {
  if (d.config.auto === "off") return "automatic dreams are off (godotwright.json dream.auto)";
  if (!d.lastDream && d.sessions === 0 && d.hours === 0) return `no sessions counted yet (the session-start hook counts them; due at ${d.config.minHours} h and ${d.config.minSessions} sessions; dream.auto ${d.config.auto})`;
  const counts = `${d.hours} h and ${plural(d.sessions, "session")} since the ${d.lastDream ? "last dream" : "first session counted"}; due at ${d.config.minHours} h and ${d.config.minSessions}`;
  return `${d.due ? "a dream is due" : "no dream due yet"} (${counts}; dream.auto ${d.config.auto})`;
}

export function formatDream(r: DreamResult, detail: "brief" | "full" = "full"): string {
  const out = [`dream: ${plural(r.proposals.length, "proposal")} for this project (${sourcesText(r.sources)})`, dueText(r.due)];
  for (const p of r.proposals) {
    out.push(`#${p.n} [${KIND_LABEL[p.kind]}] ${p.title} (id ${p.key})`);
    out.push(`   evidence: ${evidenceText(p.evidence)}`);
    if (detail === "full") {
      out.push(`   why: ${p.reason}`);
      out.push(`   apply: ${p.apply ?? "a suggestion: applying marks it as seen"}${p.auto ? " (auto)" : ""}`);
    }
  }
  if (!r.proposals.length) out.push("Nothing to propose: no recurring mistakes, guessed names, unhelpful lessons or contradictions since the last dream.");
  else
    out.push(
      "",
      "Nothing changes until you apply. Next: godotwright dream --apply <numbers|ids|all> (godot_dream with apply); godotwright undo takes an apply back. Draft lessons still need their cause and fix: godot_lessons and godot_api, then godot_lesson_add with the same title.",
    );
  return `${out.join("\n")}\n`;
}

export function formatApply(r: ApplyResult): string {
  const out: string[] = [];
  for (const a of r.applied) out.push(`applied #${a.proposal.n} [${KIND_LABEL[a.proposal.kind]}]: ${a.result}`);
  for (const p of r.seen) out.push(`seen #${p.n} [${KIND_LABEL[p.kind]}] ${p.title} (a suggestion; it comes back when its evidence doubles)`);
  for (const s of r.skipped) out.push(`not applied #${s.proposal.n} ${s.proposal.title}: ${s.why}`);
  if (!out.length) out.push("nothing applied");
  if (r.files.length) out.push(`wrote: ${r.files.join(", ")}`);
  for (const note of r.notes) out.push(`note: ${note}`);
  if (r.journal) out.push(`journal #${r.journal}: godotwright undo (godot_undo) takes this apply back, lessons in the learning file included.`);
  if (r.left) out.push(`${plural(r.left, "proposal")} left: godotwright dream lists them.`);
  return `${out.join("\n")}\n`;
}

/** The dated report written next to the dream state: what was applied and why, with the evidence. No names or paths. */
function formatReport(r: DreamResult, a: ApplyResult, now: Date): string {
  const out = [`# Godotwright dream, ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`, "", `Sources: ${sourcesText(r.sources)}.`, ""];
  const section = (title: string, items: { p: Proposal; note: string }[]) => {
    if (!items.length) return;
    out.push(`## ${title}`, "");
    for (const { p, note } of items) out.push(`- **${p.title}** (${KIND_LABEL[p.kind]}, id ${p.key}): ${note}`, `  Evidence: ${evidenceText(p.evidence)}. ${p.reason}`);
    out.push("");
  };
  section("Applied", a.applied.map((x) => ({ p: x.proposal, note: x.result })));
  section("Seen (suggestions)", a.seen.map((p) => ({ p, note: "marked as seen" })));
  section("Not applied", a.skipped.map((s) => ({ p: s.proposal, note: s.why })));
  const chosen = new Set([...a.applied.map((x) => x.proposal.key), ...a.seen.map((p) => p.key), ...a.skipped.map((s) => s.proposal.key)]);
  section("Left for later", r.proposals.filter((p) => !chosen.has(p.key)).map((p) => ({ p, note: "not selected" })));
  out.push("Undo: `godotwright undo` (or `godot_undo`) takes this apply back.");
  return `${out.join("\n")}\n`;
}

/** Parses `7d`, `12h`, `2w` (or a date) into a time in ms. */
export function parseSince(value: string, now = new Date()): number {
  const m = /^(\d+)\s*([hdw])$/i.exec(value.trim());
  if (m) return now.getTime() - Number(m[1]) * { h: 3_600_000, d: DAY, w: 7 * DAY }[m[2]!.toLowerCase() as "h" | "d" | "w"];
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new DreamError(`since must be like 7d, 12h, 2w or a date, got "${value}"`);
  return t;
}
