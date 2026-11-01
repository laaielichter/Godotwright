import type { LearnedData } from "../collector/collector.js";
import type { LearningData } from "../learn/store.js";
import { allLessons, errorTemplate, type LessonHit } from "./search.js";

/** One lesson: a line in brief, the whole entry in full. */
export function formatLesson(hit: Pick<LessonHit, "lesson" | "local" | "helped" | "wrong">, detail: "brief" | "full"): string {
  const l = hit.lesson;
  const learned = hit.helped || hit.wrong ? ` (helped ${hit.helped}, wrong ${hit.wrong})` : "";
  const head = `${l.id}${hit.local ? " [learned here]" : ""}: ${l.title}${learned}`;
  if (detail === "brief") return `${head}\n  fix: ${l.fix}`;
  const out = [head, `  symptom: ${l.symptom}`, `  cause: ${l.cause}`, `  fix: ${l.fix}`];
  if (l.rules?.length) out.push(`  checked by: ${l.rules.join(", ")}`);
  if (l.test) out.push(`  test: ${l.test}`);
  if (l.errors?.length) out.push(`  Godot says: ${l.errors.map((e) => `"${e}"`).join(", ")}`);
  if (l.tags.length) out.push(`  tags: ${l.tags.join(", ")}`);
  return out.join("\n");
}

export function formatLessons(hits: LessonHit[], detail: "brief" | "full", query = ""): string {
  if (!hits.length) return `no lessons${query ? ` for "${query}"` : ""}. godotwright lessons add (or godot_lesson_add) keeps one you learned.\n`;
  const out = hits.map((h) => formatLesson(h, detail));
  out.push("", "Did one help? godot_feedback with lesson <id> and verdict right (helped) or wrong; Godotwright ranks lessons by it.");
  return `${out.join("\n")}\n`;
}

/** Short lines under check output: the lessons that explain Godot's messages. */
export function formatErrorLessons(found: { message: string; hits: LessonHit[] }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { hits } of found) {
    for (const h of hits) {
      if (seen.has(h.lesson.id)) continue;
      seen.add(h.lesson.id);
      out.push(`  lesson ${h.lesson.id}${h.local ? " [learned here]" : ""}: ${h.lesson.title} Fix: ${h.lesson.fix}`);
    }
  }
  return out.length ? ["lessons for these messages (godot_lessons <id> for more):", ...out.slice(0, 5)] : [];
}

export interface Gap {
  template: string;
  /** Times seen here, and installs that reported it (shared data). */
  here: number;
  installs: number;
  /** Where it was seen: a script error the review missed, or a message not tied to a file. */
  kind: "missed by review" | "not tied to a file";
  /** Lessons that already explain it. */
  lessons: string[];
}

/** The Godot messages Godotwright could not predict yet, most frequent first: what to teach it next. */
export function findGaps(learning: LearningData, shared?: LearnedData, limit = 20): Gap[] {
  const lessons = allLessons(learning);
  const explain = (template: string): string[] =>
    lessons
      .filter(({ lesson, local }) =>
        (lesson.errors ?? []).some((e) => {
          const fragment = e.toLowerCase();
          return local ? e === template : template.toLowerCase().includes(fragment) || errorTemplate(e).toLowerCase() === template.toLowerCase();
        }),
      )
      .map(({ lesson }) => lesson.id);
  const gaps = new Map<string, Gap>();
  const add = (template: string, kind: Gap["kind"], here: number, installs: number) => {
    const g = gaps.get(template) ?? { template, here: 0, installs: 0, kind, lessons: explain(template) };
    g.here += here;
    g.installs = Math.max(g.installs, installs);
    gaps.set(template, g);
  };
  for (const [t, n] of Object.entries(learning.missedByReview)) add(t, "missed by review", n, 0);
  for (const [t, n] of Object.entries(learning.unparsed)) add(t, "not tied to a file", n, 0);
  for (const [t, n] of Object.entries(shared?.missedByReview ?? {})) add(t, "missed by review", 0, n);
  return [...gaps.values()]
    .sort((a, b) => Number(a.lessons.length > 0) - Number(b.lessons.length > 0) || b.installs + b.here - (a.installs + a.here) || a.template.localeCompare(b.template))
    .slice(0, limit);
}

export function formatGaps(gaps: Gap[]): string {
  if (!gaps.length) {
    return "no gaps yet: every Godot error seen with godot_check (or godotwright check) was predicted by the review or explained by a lesson.\n";
  }
  const out = ["Godot messages Godotwright did not predict, most frequent first (no names or paths; <s> is a quoted name):"];
  for (const g of gaps) {
    const seen = [g.here ? `${g.here}x here` : "", g.installs ? `${g.installs} installs` : ""].filter(Boolean).join(", ");
    out.push(`  ${g.template}`, `    ${g.kind}; ${seen}; ${g.lessons.length ? `explained by ${g.lessons.join(", ")}` : "no lesson yet"}`);
  }
  out.push(
    "",
    "Teach Godotwright one: when you have fixed it, keep the lesson with godot_lesson_add (or godotwright lessons add) and pass",
    "the Godot message as `error`. The next time Godot prints it, the check shows your fix. A gap many installs share",
    "is a candidate for a new review rule.",
  );
  return `${out.join("\n")}\n`;
}

/** Counts for `learn status`. */
export function lessonSummary(learning: LearningData): string[] {
  const stats = Object.values(learning.lessons);
  const sum = (k: "shown" | "helped" | "wrong") => stats.reduce((a, s) => a + s[k], 0);
  return [
    `lessons learned here: ${learning.localLessons.length} (godotwright lessons --local)`,
    `lessons shown ${sum("shown")}, helped ${sum("helped")}, marked wrong ${sum("wrong")}`,
  ];
}

