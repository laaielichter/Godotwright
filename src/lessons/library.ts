import { readFileSync } from "node:fs";
import { LESSON_TOPICS, type Lesson, type LessonLibrary, type LessonTopic } from "./types.js";

const DATA_URL = new URL("../../data/lessons.json", import.meta.url);

let cached: Lesson[] | undefined;

/** The lessons that ship with Godotwright (data/lessons.json). Empty when the file is missing or broken. */
export function bundledLessons(): Lesson[] {
  if (cached) return cached;
  try {
    // A byte order mark (added by some Windows editors) would make JSON.parse fail and empty the whole library.
    cached = parseLessons(JSON.parse(readFileSync(DATA_URL, "utf8").replace(/^﻿/, "")));
  } catch {
    cached = [];
  }
  return cached;
}

export function isTopic(value: unknown): value is LessonTopic {
  return typeof value === "string" && (LESSON_TOPICS as readonly string[]).includes(value);
}

const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
const list = (v: unknown, max: number): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() && x.length <= max) ? (v as string[]).map((x) => x.trim()) : undefined;

/** One lesson in the shape it has, or undefined: a hand edit must not break a tool. */
export function lessonFrom(v: unknown): Lesson | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const id = text(r["id"], 80);
  const title = text(r["title"], 200);
  const symptom = text(r["symptom"], 800);
  const cause = text(r["cause"], 800);
  const fix = text(r["fix"], 800);
  if (!id || !/^[a-z]+\/[a-z0-9-]+$/.test(id) || !isTopic(r["topic"]) || !title || !symptom || !cause || !fix) return undefined;
  const lesson: Lesson = { id, topic: r["topic"], title, symptom, cause, fix, tags: list(r["tags"], 40) ?? [] };
  const rules = list(r["rules"], 80);
  if (rules?.length) lesson.rules = rules;
  const test = text(r["test"], 600);
  if (test) lesson.test = test;
  const errors = list(r["errors"], 200);
  if (errors?.length) lesson.errors = errors;
  const archetypes = list(r["archetypes"], 80);
  if (archetypes?.length) lesson.archetypes = archetypes;
  return lesson;
}

export function parseLessons(value: unknown): Lesson[] {
  const lib = value as Partial<LessonLibrary> | undefined;
  if (!lib || lib.version !== 1 || !Array.isArray(lib.lessons)) return [];
  const seen = new Set<string>();
  const out: Lesson[] = [];
  for (const item of lib.lessons) {
    const lesson = lessonFrom(item);
    if (lesson && !seen.has(lesson.id)) {
      seen.add(lesson.id);
      out.push(lesson);
    }
  }
  return out;
}
