import { bundledLearning } from "../learn/bundled.js";
import { currentLearning } from "../learn/learn.js";
import { formatErrorLessons } from "./format.js";
import { recordShown } from "./local.js";
import { lessonsForError, lessonsForRule } from "./search.js";

/** Lessons that explain Godot's messages, as lines to print under a check; counted as shown. Never throws. */
export function lessonHintsForMessages(messages: string[]): string[] {
  try {
    const learning = currentLearning();
    const shared = bundledLearning();
    const found = [...new Set(messages)].slice(0, 50).map((message) => ({ message, hits: lessonsForError(message, { learning, shared, limit: 2 }) }));
    const lines = formatErrorLessons(found);
    if (learning && lines.length) recordShown(found.flatMap((f) => f.hits.map((h) => h.lesson.id)));
    return lines;
  } catch {
    // Lessons are a help, never a reason for a check to fail.
    return [];
  }
}

/** One line naming the lessons behind the rules in a review, so an agent can read why a finding matters. */
export function lessonHintsForRules(rules: string[]): string[] {
  try {
    const learning = currentLearning();
    const shared = bundledLearning();
    const pairs: string[] = [];
    for (const rule of [...new Set(rules)]) {
      const hit = lessonsForRule(rule, { learning, shared, limit: 1 })[0];
      if (hit) pairs.push(`${rule} -> ${hit.lesson.id}`);
    }
    return pairs.length ? [`lessons behind these findings (godot_lessons <id>): ${pairs.slice(0, 6).join("; ")}`] : [];
  } catch {
    return [];
  }
}
