import { GodotApi } from "../api/api.js";
import { stem } from "../archetype/words.js";
import type { LearnedData } from "../collector/collector.js";
import { scrubTemplate } from "../learn/share.js";
import type { LearningData } from "../learn/store.js";
import { messageTemplate } from "../learn/template.js";
import { bundledLessons } from "./library.js";
import type { Lesson, LessonStats, LessonTopic } from "./types.js";

/**
 * Finding the lessons that fit: by words, by a Godot message, by a rule, or by the kind of thing a model is.
 * What this machine (and every install that shared) learned ranks them: a lesson that helped comes first, one that
 * was marked wrong more often than it helped is no longer offered on its own.
 */

export interface LessonHit {
  lesson: Lesson;
  score: number;
  /** Learned on this machine. */
  local: boolean;
  /** Times it helped and was wrong, here and over all installs that shared. */
  helped: number;
  wrong: number;
}

/** A lesson marked wrong this often, and more often than it helped, is no longer offered unasked. */
export const QUIET_AFTER_WRONG = 3;

/** All lessons: the bundled ones and those learned on this machine. */
export function allLessons(learning?: LearningData): { lesson: Lesson; local: boolean }[] {
  return [...bundledLessons().map((lesson) => ({ lesson, local: false })), ...(learning?.localLessons ?? []).map((lesson) => ({ lesson, local: true }))];
}

function statsOf(id: string, learning?: LearningData, shared?: LearnedData): { helped: number; wrong: number } {
  const here: LessonStats | undefined = learning?.lessons[id];
  const all = shared?.lessons?.[id];
  return { helped: (here?.helped ?? 0) + (all?.helped ?? 0), wrong: (here?.wrong ?? 0) + (all?.wrong ?? 0) };
}

/** Lessons that were marked wrong more than they helped stay out of unasked hints. */
export function quiet(hit: Pick<LessonHit, "helped" | "wrong">): boolean {
  return hit.wrong >= QUIET_AFTER_WRONG && hit.wrong > hit.helped;
}

/** How much what was learned moves a lesson up or down. */
function weight(helped: number, wrong: number): number {
  return (1 + Math.log2(1 + helped) * 0.5) / (1 + Math.log2(1 + wrong) * 0.5);
}

const words = (text: string): string[] =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 3)
    .map(stem);

export interface SearchOptions {
  topic?: LessonTopic;
  limit?: number;
  learning?: LearningData;
  shared?: LearnedData;
}

/** Lessons for a question in words (English, or Dutch words that match tags), best first. Empty text lists them all. */
export function searchLessons(query: string, options: SearchOptions = {}): LessonHit[] {
  const q = [...new Set(words(query))];
  const hits: LessonHit[] = [];
  for (const { lesson, local } of allLessons(options.learning)) {
    if (options.topic && lesson.topic !== options.topic) continue;
    let score = q.length ? 0 : 1;
    if (q.length) {
      const tags = new Set(lesson.tags.flatMap(words));
      const title = new Set(words(lesson.title));
      const id = new Set(words(lesson.id.replace(/[/-]/g, " ")));
      const body = new Set(words(`${lesson.symptom} ${lesson.cause} ${lesson.fix} ${lesson.test ?? ""} ${(lesson.rules ?? []).join(" ")}`));
      let matched = 0;
      for (const w of q) {
        const s = (tags.has(w) ? 3 : 0) + (title.has(w) ? 2 : 0) + (id.has(w) ? 2 : 0) + (body.has(w) ? 1 : 0);
        if (s) matched++;
        score += s;
      }
      if (!matched) continue;
      // Lessons that match more of the question's words win over one that repeats a single word.
      score *= matched / q.length;
    }
    const { helped, wrong } = statsOf(lesson.id, options.learning, options.shared);
    hits.push({ lesson, local, score: score * weight(helped, wrong), helped, wrong });
  }
  return hits.sort((a, b) => b.score - a.score || a.lesson.id.localeCompare(b.lesson.id)).slice(0, options.limit ?? 5);
}

/** The template a Godot message is kept as on this machine (no names, paths or numbers). */
export function errorTemplate(message: string, api: GodotApi = GodotApi.load()): string {
  return scrubTemplate(messageTemplate(message), api);
}

/** Lessons whose Godot messages match this one: a fragment of a bundled lesson, or the template of a local one. */
export function lessonsForError(message: string, options: Omit<SearchOptions, "topic"> = {}): LessonHit[] {
  const lower = message.toLowerCase();
  const template = errorTemplate(message);
  const hits: LessonHit[] = [];
  for (const { lesson, local } of allLessons(options.learning)) {
    const errors = lesson.errors ?? [];
    const match = errors.some((e) => (local ? e === template || lower.includes(e.toLowerCase()) : lower.includes(e.toLowerCase())));
    if (!match) continue;
    const { helped, wrong } = statsOf(lesson.id, options.learning, options.shared);
    const hit = { lesson, local, score: weight(helped, wrong) * (local ? 1.5 : 1), helped, wrong };
    if (!quiet(hit)) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score || a.lesson.id.localeCompare(b.lesson.id)).slice(0, options.limit ?? 3);
}

/** Lessons that explain a review or model rule. */
export function lessonsForRule(rule: string, options: Omit<SearchOptions, "topic"> = {}): LessonHit[] {
  const hits: LessonHit[] = [];
  for (const { lesson, local } of allLessons(options.learning)) {
    if (!lesson.rules?.includes(rule)) continue;
    const { helped, wrong } = statsOf(lesson.id, options.learning, options.shared);
    const hit = { lesson, local, score: weight(helped, wrong), helped, wrong };
    if (!quiet(hit)) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score || a.lesson.id.localeCompare(b.lesson.id)).slice(0, options.limit ?? 3);
}

/** Lessons for the kind of thing a model is: an archetype id and its parents (`vehicle.road.car` -> `vehicle`). */
export function lessonsForArchetype(chain: string[], options: Omit<SearchOptions, "topic"> = {}): LessonHit[] {
  const ids = new Set(chain);
  const hits: LessonHit[] = [];
  for (const { lesson, local } of allLessons(options.learning)) {
    const depth = Math.max(-1, ...(lesson.archetypes ?? []).map((a) => (ids.has(a) ? chain.indexOf(a) : -1)));
    if (depth < 0) continue;
    const { helped, wrong } = statsOf(lesson.id, options.learning, options.shared);
    // The more specific the archetype a lesson names, the closer it is to this thing.
    const hit = { lesson, local, score: (1 + depth) * weight(helped, wrong), helped, wrong };
    if (!quiet(hit)) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score || a.lesson.id.localeCompare(b.lesson.id)).slice(0, options.limit ?? 4);
}

/** A lesson by id (bundled or local). */
export function findLesson(id: string, learning?: LearningData): { lesson: Lesson; local: boolean } | undefined {
  return allLessons(learning).find((l) => l.lesson.id === id);
}
