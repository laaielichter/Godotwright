import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { GodotApi } from "../api/api.js";
import { findProjectRoot } from "../project/files.js";
import { shareableTemplate } from "../learn/template.js";
import { lessonStats, learningAllowed, readLearning, saveLearning, type LearningData } from "../learn/store.js";
import { placeholderShare, scrubText } from "./anonymize.js";
import { isTopic } from "./library.js";
import { errorTemplate, findLesson } from "./search.js";
import type { Lesson, LessonTopic, LocalLesson } from "./types.js";

/**
 * Lessons learned on this machine. An agent or a person writes down what it learned (symptom, cause, fix, the
 * Godot message), and Godotwright keeps it scrubbed of names, paths and code, finds it again when the same
 * message or question comes back, and counts whether it helped. Nothing here is ever sent.
 */

export const MAX_LOCAL_LESSONS = 300;

export class LessonError extends Error {}

export interface LessonInput {
  title: string;
  fix: string;
  symptom?: string;
  cause?: string;
  topic?: string;
  tags?: string[];
  /** A Godot message this lesson explains, as Godot printed it; kept as a template without names or paths. */
  error?: string;
  rules?: string[];
  test?: string;
}

export interface Added {
  lesson: LocalLesson;
  /** What the scrubber replaced, by kind. */
  replaced: Record<string, number>;
  /** True when a lesson with the same title was updated instead. */
  updated: boolean;
}

const LIMITS = { title: 160, symptom: 600, cause: 600, fix: 600, test: 400 } as const;

function slug(text: string): string {
  return (
    text
      .replace(/<\w+>/g, " ")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 10)
      .join("-")
      .slice(0, 70)
      .replace(/-+$/, "") || "lesson"
  );
}

/**
 * Scrubs and checks a lesson before it is kept. Throws a LessonError that says what to change when too little is
 * left, so the agent can write it again in general words.
 */
export function prepareLesson(input: LessonInput, options: { api?: GodotApi; projectNames?: Iterable<string>; now?: Date } = {}): { lesson: Omit<LocalLesson, "id">; replaced: Record<string, number> } {
  const api = options.api ?? GodotApi.load();
  const replaced: Record<string, number> = {};
  const clean = (field: keyof typeof LIMITS, value: string | undefined, required: boolean): string | undefined => {
    if (value === undefined || !value.trim()) {
      if (required) throw new LessonError(`${field} is required`);
      return undefined;
    }
    if (value.length > LIMITS[field] * 2) throw new LessonError(`${field} is too long (at most ${LIMITS[field]} characters): keep it to the point`);
    const out = scrubText(value, { api, projectNames: options.projectNames });
    for (const [k, n] of Object.entries(out.replaced)) replaced[k] = (replaced[k] ?? 0) + n;
    const text = out.text.slice(0, LIMITS[field]).trim();
    const words = text.replace(/<\w+>/g, " ").match(/\p{L}{2,}/gu) ?? [];
    if (words.length < (field === "title" ? 2 : 3) || placeholderShare(text) > 0.4) {
      throw new LessonError(
        `too little is left of ${field} once names, paths and code are taken out ("${text}"). Write it as a general lesson in plain words, without names of the project, files or code.`,
      );
    }
    return text;
  };

  const title = clean("title", input.title, true)!;
  const fix = clean("fix", input.fix, true)!;
  const symptom = clean("symptom", input.symptom, false);
  const cause = clean("cause", input.cause, false);
  const test = clean("test", input.test, false);
  if (input.topic !== undefined && !isTopic(input.topic)) throw new LessonError(`unknown topic "${input.topic}"`);
  const topic: LessonTopic = isTopic(input.topic) ? input.topic : "gdscript";

  const tags = [
    ...new Set(
      (input.tags ?? [])
        .map((t) => scrubText(t, { api, projectNames: options.projectNames }).text.toLowerCase())
        .filter((t) => /^[\p{L}0-9 +-]{2,30}$/u.test(t) && !/<\w+>/.test(t)),
    ),
  ].slice(0, 12);

  let errors: string[] | undefined;
  if (input.error?.trim()) {
    const template = errorTemplate(input.error.trim(), api);
    if (!shareableTemplate(template)) throw new LessonError("the Godot message still holds a path or a name once scrubbed; pass the message without them");
    errors = [template];
  }
  const rules = (input.rules ?? []).filter((r) => /^[a-z]+\/[a-z0-9-]+$/.test(r)).slice(0, 5);

  const lesson: Omit<LocalLesson, "id"> = {
    topic,
    title,
    symptom: symptom ?? title,
    cause: cause ?? "(not written down)",
    fix,
    tags,
    added: (options.now ?? new Date()).toISOString().slice(0, 10),
    ...(rules.length ? { rules } : {}),
    ...(test ? { test } : {}),
    ...(errors ? { errors } : {}),
  };
  return { lesson, replaced };
}

/** A project's key in the learning file: a hash of its folder, so no path is kept. */
export function projectKey(root: string): string {
  return createHash("sha1").update(resolve(root)).digest("hex").slice(0, 16);
}

/**
 * Keeps a lesson learned here. The same title again updates that lesson (and merges its Godot messages). `project` (a
 * path in the project) tags the lesson with that project's key, so a project's agents file only ever gets its own.
 */
export function addLocalLesson(input: LessonInput, options: { projectNames?: Iterable<string>; now?: Date; project?: string } = {}): Added {
  const data = readLearning();
  if (!learningAllowed(data)) throw new LessonError("learning is off on this machine (godotwright learn on, or unset GODOTWRIGHT_LEARN=0), so nothing was kept");
  const { lesson, replaced } = prepareLesson(input, options);
  const key = options.project ? projectKey(findProjectRoot(options.project) ?? options.project) : undefined;
  let result: Added | undefined;
  const { error } = saveLearning((d) => {
    const base = `local/${slug(lesson.title)}`;
    const existing = d.localLessons.find((l) => l.id === base);
    if (existing) {
      const errors = [...new Set([...(existing.errors ?? []), ...(lesson.errors ?? [])])].slice(0, 8);
      // A draft rewritten without the draft tag (a real cause and fix) is a draft no more.
      const tags = [...new Set([...existing.tags, ...lesson.tags])].filter((t) => t !== "draft" || lesson.tags.includes("draft")).slice(0, 12);
      const projects = [...new Set([...(existing.projects ?? []), ...(key ? [key] : [])])].slice(0, 20);
      Object.assign(existing, lesson, { id: base, tags, ...(errors.length ? { errors } : {}), ...(projects.length ? { projects } : {}) });
      result = { lesson: existing, replaced, updated: true };
      return;
    }
    if (d.localLessons.length >= MAX_LOCAL_LESSONS) throw new LessonError(`there are already ${MAX_LOCAL_LESSONS} local lessons; remove some first (godotwright lessons remove <id>)`);
    const added: LocalLesson = { id: base, ...lesson, ...(key ? { projects: [key] } : {}) };
    d.localLessons.push(added);
    result = { lesson: added, replaced, updated: false };
  });
  if (error) throw new LessonError(`the lesson was not saved: ${error}`);
  return result!;
}

export function removeLocalLesson(id: string): boolean {
  let removed = false;
  const { error } = saveLearning((d) => {
    const before = d.localLessons.length;
    d.localLessons = d.localLessons.filter((l) => l.id !== id);
    removed = d.localLessons.length < before;
    if (removed) delete d.lessons[id];
  });
  if (error) throw new LessonError(`not saved: ${error}`);
  return removed;
}

export type LessonVerdict = "helped" | "wrong";

/** Feedback on a lesson: it helped, or it did not fit. Counts per lesson id; unknown ids are refused. */
export function recordLessonFeedback(id: string, verdict: LessonVerdict): Lesson {
  const data = readLearning();
  if (!learningAllowed(data)) throw new LessonError("learning is off on this machine, so nothing was recorded");
  const found = findLesson(id, data);
  if (!found) throw new LessonError(`no lesson "${id}" (godotwright lessons lists them)`);
  const { error } = saveLearning((d) => {
    const s = lessonStats(d, id);
    if (verdict === "helped") s.helped++;
    else s.wrong++;
  });
  if (error) throw new LessonError(`not saved: ${error}`);
  return found.lesson;
}

/** Counts that lessons were shown. Never throws: learning is a side effect. */
export function recordShown(ids: string[]): void {
  if (!ids.length || process.env["GODOTWRIGHT_LEARN"] === "0") return;
  saveLearning((d: LearningData) => {
    if (!d.enabled) return;
    for (const id of new Set(ids)) lessonStats(d, id).shown++;
  });
}

/**
 * The local lessons as entries for data/lessons.json, to propose for everyone (by a pull request or an issue).
 * Their text was scrubbed when they were kept; the ids get a topic prefix instead of `local/`.
 */
export function exportLocalLessons(data: LearningData = readLearning()): Lesson[] {
  return data.localLessons.map(({ added: _added, projects: _projects, ...lesson }) => ({ ...lesson, id: `${lesson.topic}/${lesson.id.slice("local/".length)}` }));
}
