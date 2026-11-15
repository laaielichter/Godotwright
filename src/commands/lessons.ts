import { Command, InvalidArgumentError } from "commander";
import { bundledLearning } from "../learn/bundled.js";
import { currentLearning } from "../learn/learn.js";
import { readLearning } from "../learn/store.js";
import { formatLesson, formatLessons } from "../lessons/format.js";
import { isTopic } from "../lessons/library.js";
import { addLocalLesson, exportLocalLessons, recordLessonFeedback, recordShown, removeLocalLesson } from "../lessons/local.js";
import { projectNames } from "../lessons/names.js";
import { allLessons, findLesson, lessonsForError, lessonsForRule, searchLessons, type LessonHit } from "../lessons/search.js";
import { LESSON_TOPICS } from "../lessons/types.js";
import { collect, writeOut } from "./output.js";

interface SearchOptions {
  topic?: string;
  error?: string;
  rule?: string;
  local?: boolean;
  limit: number;
  detail: "brief" | "full";
  json?: boolean;
}

function parseLimit(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 200) throw new InvalidArgumentError("expected a whole number from 1 to 200");
  return n;
}

/** Finds lessons the way the MCP tool does: by id, a Godot message, a rule, or words. */
export function findLessons(query: string, options: Omit<SearchOptions, "json" | "detail">): LessonHit[] {
  const learning = currentLearning();
  const shared = bundledLearning();
  const common = { learning, shared, limit: options.limit };
  if (options.topic !== undefined && !isTopic(options.topic)) throw new Error(`unknown topic "${options.topic}" (topics: ${LESSON_TOPICS.join(", ")})`);
  const topic = isTopic(options.topic) ? options.topic : undefined;
  let hits: LessonHit[];
  const byId = query && findLesson(query.trim(), learning);
  if (byId) hits = [{ ...byId, score: 1, helped: 0, wrong: 0 }];
  else if (options.error) hits = lessonsForError(options.error, common);
  else if (options.rule) hits = lessonsForRule(options.rule, common);
  else hits = searchLessons(query, { ...common, topic });
  if (options.local) hits = hits.filter((h) => h.local);
  return hits;
}

export function lessonsCommand(): Command {
  const lessons = new Command("lessons").description("lessons from real Godot projects, and the ones learned on this machine");

  lessons
    .command("search", { isDefault: true })
    .description("find lessons by words, a Godot message, a rule or an id (no words lists them all)")
    .argument("[words...]", "what went wrong, e.g. helicopter slides off moving ship; or a lesson id")
    .option("--topic <topic>", `only this topic (${LESSON_TOPICS.join(", ")})`)
    .option("--error <message>", "a Godot message as it was printed: lessons that explain it")
    .option("--rule <id>", "lessons behind a review or model rule, e.g. api/infer-variant")
    .option("--local", "only lessons learned on this machine")
    .option("--limit <n>", "at most this many (default 10)", parseLimit, 10)
    .option("--detail <level>", "brief (title and fix) or full (symptom, cause, fix, test)", "brief")
    .option("--json", "print the lessons as JSON")
    .action((words: string[], options: SearchOptions, command: Command) => {
      if (options.detail !== "brief" && options.detail !== "full") throw new Error("detail must be brief or full");
      const query = words.join(" ");
      const limit = !query && !options.error && !options.rule ? Math.max(options.limit, options.local ? 300 : 10) : options.limit;
      const hits = findLessons(query, { ...options, limit });
      if (currentLearning()) recordShown(hits.map((h) => h.lesson.id));
      if (options.json) writeOut(command, `${JSON.stringify(hits.map((h) => ({ ...h.lesson, local: h.local })), null, 2)}\n`);
      else writeOut(command, formatLessons(hits, options.detail, query || options.error || options.rule || ""));
    });

  lessons
    .command("add")
    .description("keep a lesson learned here; names, paths and code are taken out first, and it never leaves this machine")
    .requiredOption("--title <text>", "the lesson in one line, in general words")
    .requiredOption("--fix <text>", "what to do instead")
    .option("--symptom <text>", "what went wrong, as it showed")
    .option("--cause <text>", "why, in Godot terms")
    .option("--topic <topic>", `one of ${LESSON_TOPICS.join(", ")} (default gdscript)`)
    .option("--tag <word>", "a word to find it by (repeatable)", collect, [])
    .option("--error <message>", "the Godot message it explains, as printed; kept without names or paths")
    .option("--rule <id>", "a review or model rule it belongs to (repeatable)", collect, [])
    .option("--test <text>", "how to test it")
    .option("--project <path>", "the project, so its own names are taken out too", ".")
    .action(
      (
        options: { title: string; fix: string; symptom?: string; cause?: string; topic?: string; tag: string[]; error?: string; rule: string[]; test?: string; project: string },
        command: Command,
      ) => {
        const { lesson, replaced, updated } = addLocalLesson(
          { title: options.title, fix: options.fix, symptom: options.symptom, cause: options.cause, topic: options.topic, tags: options.tag, error: options.error, rules: options.rule, test: options.test },
          { projectNames: projectNames(options.project), project: options.project },
        );
        const removed = Object.entries(replaced).map(([k, n]) => `${n} ${k}`).join(", ");
        writeOut(
          command,
          `${updated ? "updated" : "kept"} ${lesson.id} (on this machine only)${removed ? `; replaced: ${removed}` : ""}\n` +
            `${formatLesson({ lesson, local: true, helped: 0, wrong: 0 }, "full")}\n`,
        );
      },
    );

  lessons
    .command("feedback")
    .description("say whether a lesson helped; lessons that help rank higher, ones marked wrong are offered less")
    .argument("<id>", "the lesson id")
    .argument("<verdict>", "helped or wrong")
    .action((id: string, verdict: string, _o: unknown, command: Command) => {
      if (verdict !== "helped" && verdict !== "wrong") throw new Error("verdict must be helped or wrong");
      recordLessonFeedback(id, verdict);
      writeOut(command, `noted: ${id} ${verdict === "helped" ? "helped" : "was wrong"}\n`);
    });

  lessons
    .command("remove")
    .description("forget a lesson learned on this machine")
    .argument("<id>", "a local/... id")
    .action((id: string, _o: unknown, command: Command) => {
      if (!removeLocalLesson(id)) throw new Error(`no local lesson "${id}"`);
      writeOut(command, `removed ${id}\n`);
    });

  lessons
    .command("export")
    .description("print the lessons learned here as entries for data/lessons.json, to propose them for everyone (nothing is sent)")
    .action((_o: unknown, command: Command) => {
      const out = exportLocalLessons(readLearning());
      writeOut(command, `${JSON.stringify(out, null, 2)}\n`);
    });

  lessons
    .command("topics")
    .description("list the topics and how many lessons each has")
    .action((_o: unknown, command: Command) => {
      const all = allLessons(currentLearning());
      const lines = LESSON_TOPICS.map((t) => `${t.padEnd(12)} ${all.filter((l) => l.lesson.topic === t).length}`);
      writeOut(command, `${lines.join("\n")}\n`);
    });

  return lessons;
}
