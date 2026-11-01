/** Shapes of data/lessons.json and of the lessons learned on this machine. */

export const LESSON_TOPICS = [
  "gdscript",
  "physics",
  "rendering",
  "import",
  "models",
  "world",
  "performance",
  "gameplay",
  "ui",
  "audio",
  "tooling",
  "process",
] as const;

export type LessonTopic = (typeof LESSON_TOPICS)[number];

export interface Lesson {
  /** Stable id, `topic/short-name`; lessons learned on this machine start with `local/`. */
  id: string;
  topic: LessonTopic;
  /** One line: the lesson itself. */
  title: string;
  /** What went wrong, as it shows in the game or in Godot. */
  symptom: string;
  /** Why, in Godot terms. */
  cause: string;
  /** What to do instead. */
  fix: string;
  /** Review or model rules that catch it (`quality/time-scale-not-restored`, `model/floating-part`). */
  rules?: string[];
  /** How to test it when no rule catches it. */
  test?: string;
  /** Words people use for it, for search. */
  tags: string[];
  /** Fragments of Godot messages that point to it (matched without case). Local lessons keep message templates. */
  errors?: string[];
  /** Archetype ids (or their start, `vehicle`, `aircraft.rotorcraft`) the lesson is about, for the model brief. */
  archetypes?: string[];
}

export interface LessonLibrary {
  version: 1;
  lessons: Lesson[];
}

/** How often a lesson was shown, and whether it helped. Kept per lesson id in the learning file. */
export interface LessonStats {
  shown: number;
  helped: number;
  wrong: number;
}

/** A lesson learned on this machine: the same fields, scrubbed of names, paths and code, plus when it was added. */
export interface LocalLesson extends Lesson {
  added: string;
}
