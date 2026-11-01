import { describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { loadLibrary } from "../src/archetype/library.js";
import { aggregate, validateReport } from "../src/collector/collector.js";
import { adjustFindings, DISMISSED_AFTER, parseFindingLine, recordFeedback } from "../src/learn/learn.js";
import { buildReport } from "../src/learn/share.js";
import { emptyLearning, readLearning, resetLearning, saveLearning } from "../src/learn/store.js";
import { placeholderShare, scrubText } from "../src/lessons/anonymize.js";
import { findGaps, formatGaps } from "../src/lessons/format.js";
import { bundledLessons, parseLessons } from "../src/lessons/library.js";
import { addLocalLesson, exportLocalLessons, LessonError, prepareLesson, recordLessonFeedback, recordShown, removeLocalLesson } from "../src/lessons/local.js";
import { lessonsForArchetype, lessonsForError, lessonsForRule, searchLessons } from "../src/lessons/search.js";
import { LESSON_TOPICS } from "../src/lessons/types.js";
import { MODEL_RULES } from "../src/model/rules.js";
import { RULES, type Finding } from "../src/review/rules.js";
import { makeProject, runCli } from "./helpers.js";

const api = GodotApi.load();
const scrub = (text: string, projectNames?: string[]) => scrubText(text, { api, projectNames }).text;

describe("bundled lessons", () => {
  const lessons = bundledLessons();

  it("load, with unique ids and known topics", () => {
    expect(lessons.length).toBeGreaterThanOrEqual(60);
    expect(new Set(lessons.map((l) => l.id)).size).toBe(lessons.length);
    for (const l of lessons) expect(LESSON_TOPICS, l.id).toContain(l.topic);
  });

  it("name only rules and archetypes that exist", () => {
    const library = loadLibrary();
    for (const l of lessons) {
      for (const r of l.rules ?? []) expect(Boolean(RULES[r] ?? MODEL_RULES[r]), `${l.id}: ${r}`).toBe(true);
      for (const a of l.archetypes ?? []) expect(library.get(a), `${l.id}: ${a}`).toBeDefined();
    }
  });

  it("hold nothing the anonymizer would remove: no names, paths, codes or source code", () => {
    const changed: string[] = [];
    for (const l of lessons) {
      for (const field of [l.title, l.symptom, l.cause, l.fix, l.test ?? "", ...l.tags]) {
        const out = scrub(field);
        if (out !== field.trim()) changed.push(`${l.id}: ${out}`);
      }
      for (const e of l.errors ?? []) expect(e, l.id).not.toMatch(/[\\/]|res:\/\/|@/);
    }
    expect(changed).toEqual([]);
  });

  it("explain every rule that came from a lesson", () => {
    const explained = new Set(lessons.flatMap((l) => l.rules ?? []));
    for (const rule of [
      "api/infer-variant",
      "api/freed-check-order",
      "api/get-meta-null-default",
      "api/parse-into-typed",
      "api/duplicate-declaration",
      "api/image-load-res",
      "performance/runtime-gltf-mipmaps",
      "performance/small-light-cube-shadow",
      "quality/mojibake",
      "quality/interpolation-reset-every-tick",
      "quality/platform-layers-not-restored",
      "quality/time-scale-not-restored",
      "model/opaque-glass",
      "model/renamed-on-import",
    ])
      expect(explained, rule).toContain(rule);
  });

  it("ignores broken entries instead of failing", () => {
    expect(parseLessons({ version: 2, lessons: [] })).toEqual([]);
    expect(parseLessons({ version: 1, lessons: [{ id: "x" }, null, { id: "gdscript/ok", topic: "gdscript", title: "t", symptom: "s", cause: "c", fix: "f", tags: [] }] })).toHaveLength(1);
  });
});

describe("finding lessons", () => {
  it("by words, best first", () => {
    expect(searchLessons("helicopter slides off a moving ship deck")[0]?.lesson.id).toBe("physics/moving-platform-velocity");
    expect(searchLessons("textures shimmer far away mipmaps")[0]?.lesson.id).toBe("import/runtime-textures-no-mipmaps");
    expect(searchLessons("float precision far from origin")[0]?.lesson.id).toBe("world/float32-far-from-origin");
    expect(searchLessons("zzzz qqqq")).toEqual([]);
  });

  it("by topic, and all of them with no words", () => {
    const physics = searchLessons("", { topic: "physics", limit: 100 });
    expect(physics.length).toBeGreaterThan(5);
    expect(physics.every((h) => h.lesson.topic === "physics")).toBe(true);
  });

  it("by a Godot message", () => {
    const hits = lessonsForError('Parse Error: Cannot infer the type of "ox" variable because the value doesn\'t have a set type.');
    expect(hits[0]?.lesson.id).toBe("gdscript/variant-loop-inference");
    expect(lessonsForError("E 0:00:01:0123   Left operand of 'is' is a previously freed instance.")[0]?.lesson.id).toBe("gdscript/freed-check-order");
    expect(lessonsForError("something else entirely")).toEqual([]);
  });

  it("by rule and by archetype", () => {
    expect(lessonsForRule("quality/time-scale-not-restored")[0]?.lesson.id).toBe("gameplay/time-scale");
    const ship = lessonsForArchetype(["thing", "vessel", "vessel.ship"], { limit: 10 }).map((h) => h.lesson.id);
    expect(ship).toContain("physics/moving-platform-velocity");
    expect(ship).toContain("physics/collider-through-deck");
  });
});

describe("the anonymizer", () => {
  it("keeps Godot's words and plain sentences", () => {
    const text = "Call is_instance_valid() before Node3D.global_position, and set Engine.time_scale back in _exit_tree(). Use 4K textures and 120 Hz.";
    expect(scrub(text)).toBe(text);
  });

  it("removes paths, links, e-mail addresses, dates, keys and long numbers", () => {
    const out = scrub(
      "Broke in res://levels/dock.gd and C:\\Users\\someone\\game\\main.tscn, see https://example.com/x and /home/someone/project/a.gd, mail someone@example.com, on 2024-01-15, key ghp_abcdefghijklmnopqrstuvwx1234, uuid 123e4567-e89b-12d3-a456-426614174000, ticket 4815162342.",
    );
    expect(out).not.toMatch(/levels|dock|Users|someone|example|ghp_|123e4567|2024|4815162342/);
    expect(out).toContain("<path>");
    expect(out).toContain("<url>");
    expect(out).toContain("<email>");
    expect(out).toContain("<date>");
  });

  it("removes names: people, places, products and the project's own identifiers", () => {
    const out = scrub("When Marta landed the X9 on the Seahorse near Brightwater, lock_state stayed false in PlatformLockController.");
    expect(out).toBe("When <name> landed the <code> on the <name> near <name>, <name> stayed false in <name>.");
    expect(scrub("The heli bounced on the deck.", ["Kestrel Rescue", "Deck"])).toBe("The heli bounced on the deck.");
    expect(scrub("Kestrel rescue crashes on start.", ["Kestrel Rescue"])).toBe("<name> crashes on start.");
  });

  it("removes source code but keeps Godot names in backticks", () => {
    expect(scrub("Use `move_and_slide()` instead of `velocity = speed * dir`.")).toBe("Use `move_and_slide()` instead of <code>.");
    expect(scrub("Wrote func _on_hit(body: Node) -> void: pass and it failed.")).not.toMatch(/_on_hit|body: Node/);
    expect(scrub("```\nvar x := 1\n```")).toBe("<code>");
  });

  it("measures how much of a text was replaced", () => {
    expect(placeholderShare("<name> <path> <code> works")).toBe(0.75);
  });
});

describe("lessons learned on this machine", () => {
  const input = {
    title: "Wheels sink when the vehicle spawns on a slope",
    symptom: "The truck in res://levels/farm.tscn sank 20 cm into the hill at spawn.",
    cause: "The spawn code set the position before the terrain collider existed.",
    fix: "Wait one physics frame after adding the terrain, then place the vehicle.",
    topic: "physics",
    tags: ["spawn", "terrain", "FarmLevel"],
    error: 'Node not found: "Wheels/FrontLeft" (relative to "/root/Main/Truck").',
  };

  it("are kept scrubbed, found again, and count whether they helped", () => {
    resetLearning();
    const added = addLocalLesson(input);
    expect(added.lesson.id).toBe("local/wheels-sink-when-the-vehicle-spawns-on-a-slope");
    expect(added.lesson.symptom).not.toMatch(/levels|farm\.tscn/);
    expect(added.lesson.tags).toEqual(["spawn", "terrain"]);
    expect(added.lesson.errors?.[0]).not.toMatch(/Wheels|FrontLeft|root|Truck/);
    expect(added.replaced["path"]).toBeGreaterThan(0);

    const data = readLearning();
    expect(searchLessons("vehicle sinks into terrain at spawn", { learning: data })[0]?.lesson.id).toBe(added.lesson.id);
    expect(lessonsForError('Node not found: "Body/RearAxle" (relative to "/root/Level/Car").', { learning: data })[0]?.lesson.id).toBe(added.lesson.id);

    recordShown([added.lesson.id]);
    recordLessonFeedback(added.lesson.id, "helped");
    expect(readLearning().lessons[added.lesson.id]).toEqual({ shown: 1, helped: 1, wrong: 0 });

    // The same title again updates the lesson.
    expect(addLocalLesson({ ...input, fix: "Place the vehicle after the terrain's first physics frame." }).updated).toBe(true);
    expect(readLearning().localLessons).toHaveLength(1);

    expect(exportLocalLessons()[0]?.id).toBe("physics/wheels-sink-when-the-vehicle-spawns-on-a-slope");
    expect(removeLocalLesson(added.lesson.id)).toBe(true);
    expect(readLearning().localLessons).toEqual([]);
  });

  it("are refused when too little is left once names and code are gone", () => {
    expect(() => prepareLesson({ title: "PlatformLock fix", fix: "Set lock_state in PlatformLockController.apply_lock()" })).toThrow(LessonError);
    expect(() => prepareLesson({ title: "A good title", fix: "" })).toThrow(/fix is required/);
    expect(() => prepareLesson({ title: "A real lesson here", fix: "Do the right thing always.", topic: "nonsense" })).toThrow(/unknown topic/);
  });

  it("replace the project's own names", () => {
    const { lesson } = prepareLesson({ title: "The Kestrel menu freezes", fix: "Load the Kestrel hangar on a thread." }, { projectNames: ["Kestrel"] });
    expect(lesson.title).toBe("The <name> menu freezes");
  });

  it("are not kept when learning is off", () => {
    resetLearning();
    saveLearning((d) => (d.enabled = false));
    expect(() => addLocalLesson(input)).toThrow(/learning is off/);
    resetLearning();
  });

  it("a lesson marked wrong more often than it helped is no longer offered unasked", () => {
    resetLearning();
    for (let i = 0; i < 3; i++) recordLessonFeedback("gameplay/time-scale", "wrong");
    expect(lessonsForRule("quality/time-scale-not-restored", { learning: readLearning() })).toEqual([]);
    expect(searchLessons("slow motion time scale", { learning: readLearning() })[0]?.lesson.id).toBe("gameplay/time-scale");
    expect(() => recordLessonFeedback("nope/nothing", "helped")).toThrow(/no lesson/);
    resetLearning();
  });
});

describe("sharing lesson counts", () => {
  it("sends counts for built-in lessons only, never a local lesson, and the collector checks it", () => {
    resetLearning();
    addLocalLesson({ title: "Local lesson about spawning", fix: "Wait one physics frame before placing vehicles." });
    recordShown(["gameplay/time-scale", "local/local-lesson-about-spawning"]);
    recordLessonFeedback("gameplay/time-scale", "helped");
    const built = buildReport(readLearning(), api, "00000000-0000-4000-8000-000000000001")!;
    expect(built.report.lessons).toEqual({ "gameplay/time-scale": { shown: 1, helped: 1, wrong: 0 } });
    expect(JSON.stringify(built.report)).not.toContain("spawning");
    expect(validateReport(JSON.parse(JSON.stringify(built.report)))).toBeDefined();
    expect(validateReport({ ...built.report, lessons: { "local/x": { shown: 1, helped: 0, wrong: 0 } } })).toBeUndefined();
    expect(validateReport({ ...built.report, lessons: { "gameplay/time-scale": { shown: 1, helped: 0, wrong: 0, text: "x" } } })).toBeUndefined();
    resetLearning();
  });

  it("aggregates lessons only when enough installs reported them", () => {
    const base = { schema: 1 as const, godotwright: "0.2.0", godot: "4.7", platform: "linux" as const, rules: {}, apiMisses: {}, missedByReview: {}, unparsed: {} };
    const r = (n: number, lessons: Record<string, { shown: number; helped: number; wrong: number }>) => ({ ...base, install: `00000000-0000-4000-8000-00000000000${n}`, lessons });
    const one = { "gameplay/time-scale": { shown: 2, helped: 1, wrong: 0 } };
    expect(aggregate([r(1, one), r(2, one)]).lessons).toBeUndefined();
    expect(aggregate([r(1, one), r(2, one), r(3, one)]).lessons).toEqual({ "gameplay/time-scale": { shown: 6, helped: 3, wrong: 0, installs: 3 } });
    // Reports from older versions have no lessons at all.
    expect(aggregate([{ ...base, install: "00000000-0000-4000-8000-000000000009" }]).installs).toBe(1);
  });
});

describe("rules that learn from false alarms", () => {
  const f: Finding = { rule: "api/unsafe-member", category: "api", severity: "warning", file: "res://a.gd", line: 3, message: "Member x is not on Node." };

  it("drop one level after being marked wrong far more often than right", () => {
    const data = emptyLearning();
    data.rules["api/unsafe-member"] = { reported: 9, confirmed: 0, contradicted: 0, dismissed: DISMISSED_AFTER, verified: 1 };
    const out = adjustFindings([f], data);
    expect(out.findings[0]?.severity).toBe("info");
    expect(out.findings[0]?.message).toContain(`marked as a false alarm ${DISMISSED_AFTER} times`);
    expect(out.softened).toEqual(["api/unsafe-member"]);
  });

  it("stay when they were also right often, and follow other installs only without local feedback", () => {
    const data = emptyLearning();
    data.rules["api/unsafe-member"] = { reported: 9, confirmed: 0, contradicted: 0, dismissed: DISMISSED_AFTER, verified: 2 };
    expect(adjustFindings([f], data).findings[0]?.severity).toBe("warning");
    const shared = { version: 1 as const, installs: 5, apiHints: {}, missedByReview: {}, rules: { "api/unsafe-member": { reported: 90, confirmed: 0, contradicted: 0, dismissed: 40, installs: 5 } } };
    expect(adjustFindings([f], emptyLearning(), shared).findings[0]?.message).toContain("by other installs");
    expect(adjustFindings([f], data, shared).findings[0]?.severity).toBe("warning");
  });

  it("keep the same fingerprint when a softened finding is marked again", () => {
    resetLearning();
    const line = "res://a.gd:3: warning [api/unsafe-member] Member x is not on Node. (marked as a false alarm 5 times; treat it as a hint.)";
    recordFeedback(parseFindingLine(line)!, "wrong");
    expect(adjustFindings([f], readLearning()).hidden).toBe(1);
    resetLearning();
  });
});

describe("gaps: what to teach Godotwright next", () => {
  it("lists Godot messages the review missed, those without a lesson first", () => {
    const data = emptyLearning();
    data.missedByReview['Identifier "<s>" not declared in the current scope.'] = 4;
    data.missedByReview['Cannot infer the type of "<s>" variable because the value doesn\'t have a set type.'] = 9;
    const gaps = findGaps(data);
    expect(gaps[0]?.template).toContain("Identifier");
    expect(gaps[0]?.lessons).toEqual([]);
    expect(gaps[1]?.lessons).toContain("gdscript/variant-loop-inference");
    expect(formatGaps(gaps)).toContain("godot_lesson_add");
    expect(formatGaps([])).toContain("no gaps yet");
  });
});

describe("the lessons command", () => {
  it("searches, shows one in full, adds, gives feedback, exports and removes", async () => {
    resetLearning();
    expect((await runCli(["lessons", "moving", "ship", "deck"])).output.split("\n")[0]).toContain("physics/moving-platform-velocity");
    expect((await runCli(["lessons", "physics/collider-through-deck", "--detail", "full"])).output).toContain("cause:");
    expect((await runCli(["lessons", "--rule", "api/infer-variant"])).output).toContain("gdscript/variant-loop-inference");
    expect((await runCli(["lessons", "topics"])).output).toMatch(/physics\s+\d+/);
    const root = makeProject({ "project.godot": '[application]\nconfig/name="Kestrel Rescue"\n' });
    const added = await runCli(["lessons", "add", "--title", "Kestrel rescue hoist cable snaps at spawn", "--fix", "Create the cable joint one physics frame after both bodies exist.", "--topic", "physics", "--project", root]);
    expect(added.output).toContain("kept local/");
    expect(added.output).not.toMatch(/Kestrel rescue/i);
    expect((await runCli(["lessons", "--local"])).output).toContain("[learned here]");
    expect((await runCli(["lessons", "feedback", "gameplay/time-scale", "helped"])).output).toContain("helped");
    const exported = JSON.parse((await runCli(["lessons", "export"])).output) as { id: string }[];
    expect(exported[0]?.id).toMatch(/^physics\//);
    const id = readLearning().localLessons[0]!.id;
    expect((await runCli(["lessons", "remove", id])).output).toContain("removed");
    await expect(runCli(["lessons", "--topic", "nope"])).rejects.toThrow(/unknown topic/);
    resetLearning();
  });

  it("learn gaps and learn status show what to teach next", async () => {
    resetLearning();
    saveLearning((d) => (d.missedByReview['Identifier "<s>" not declared in the current scope.'] = 2));
    expect((await runCli(["learn", "gaps"])).output).toContain('Identifier "<s>" not declared');
    expect((await runCli(["learn", "status"])).output).toContain("lessons learned here: 0");
    resetLearning();
  });
});
