import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chooseArchetype } from "../archetype/check.js";
import { briefFor } from "../archetype/brief.js";
import { formatChecked, formatIdentify } from "../archetype/format.js";
import { identify } from "../archetype/identify.js";
import { loadLibrary } from "../archetype/library.js";
import { GodotApi } from "../api/api.js";
import { formatLookup, formatSearch } from "../api/format.js";
import {
  checkLearning,
  lookupLearning,
  reviewLearning,
} from "../learn/hooks.js";
import { formatMigration, migrateProject } from "../migrate/migrate.js";
import { FIXABLE_RULES, fixProject, formatFix } from "../fix/fix.js";
import { doctorProject, formatDoctor } from "../doctor/doctor.js";
import { findUsages, formatUsages } from "../usages/usages.js";
import {
  RenameError,
  formatRename,
  renameInProject,
} from "../rename/rename.js";
import { formatDelta, reviewDelta } from "../review/delta.js";
import {
  currentLearning,
  parseFindingLine,
  recordFeedback,
} from "../learn/learn.js";
import { bundledLearning } from "../learn/bundled.js";
import { readLearning } from "../learn/store.js";
import {
  findGaps,
  formatGaps,
  formatLesson,
  formatLessons,
} from "../lessons/format.js";
import { lessonHintsForMessages, lessonHintsForRules } from "../lessons/hints.js";
import { isTopic } from "../lessons/library.js";
import {
  addLocalLesson,
  LessonError,
  recordLessonFeedback,
  recordShown,
} from "../lessons/local.js";
import { projectNames } from "../lessons/names.js";
import {
  findLesson,
  lessonsForError,
  lessonsForRule,
  searchLessons,
  type LessonHit,
} from "../lessons/search.js";
import { LESSON_TOPICS } from "../lessons/types.js";
import { allKinds } from "../build/generators/index.js";
import { buildModel } from "../build/run.js";
import { EXAMPLE_SPEC, SPEC_HELP } from "../build/spec-help.js";
import { loadContract } from "../model/contract.js";
import { formatModelInfo, formatModelReport } from "../model/format.js";
import { ModelError } from "../model/gltf.js";
import { inspectModel } from "../model/inspect.js";
import { lintModelFile } from "../model/lint.js";
import { viewModel } from "../model/view.js";
import { GodotNotFoundError } from "../check/godot.js";
import { formatDiagnostic } from "../check/log.js";
import { findProjectRoot, listProjectFiles } from "../project/files.js";
import { formatFinding } from "../review/format.js";
import type { ReviewReport } from "../review/review.js";
import { CATEGORIES, RULES } from "../review/rules.js";
import { formatProjectMap, type Detail } from "../scan/format.js";
import { ProjectNotFoundError, scanProject } from "../scan/scan.js";
import {
  ScreenshotError,
  VIEWS,
  formatScreenshot,
  takeScreenshot,
  type View,
} from "../screenshot/screenshot.js";
import { PlayError, formatPlay, playScene } from "../play/play.js";
import {
  TestRunError,
  formatTests,
  runTests,
  testsPassed,
} from "../test/run.js";
import {
  SceneError,
  editScene,
  formatScenePlan,
  type SceneEdit,
} from "../scene/edit.js";
import {
  SettingsError,
  editProjectSettings,
  formatSettingsPlan,
  type SettingsEdit,
} from "../settings/edit.js";
import { GODOT_TARGET, VERSION } from "../version.js";

export type Tier = "cheap" | "premium";

export interface ServerOptions {
  /** Directory the tools work in when no path is given (default: the working directory). */
  root?: string;
  /** cheap: short output and strict step-by-step guidance. premium: full detail. */
  tier?: Tier;
  /** Godot binary for godot_check. */
  godot?: string;
  /** Base projects the project is laid over (a mod over a game). */
  base?: string[];
  /** File lists of the shipped game (e.g. a .pck manifest). */
  baseFiles?: string[];
}

interface Profile {
  detail: Detail;
  /** Max review findings shown. */
  findings: number;
  /** Include info-level findings. */
  infos: boolean;
  instructions: string;
}

const PROFILES: Record<Tier, Profile> = {
  cheap: {
    detail: "brief",
    findings: 15,
    infos: false,
    instructions: [
      `Godotwright gives you checked Godot ${GODOT_TARGET} knowledge for this project. Follow these steps:`,
      "0. In a project you do not know yet, or when something is broken and you do not know where to start, call godot_doctor: what is wrong, in which order to fix it, and why.",
      "1. Call godot_scan once to learn the scenes, scripts, signals and input actions.",
      "2. Before you use an engine class, method, property or signal you are not sure about, call godot_api. Never guess API names; Godot 3 names do not work in Godot 4.",
      "3. Before you save new GDScript, pass it to godot_review (code + file) and fix every error.",
      "4. After every edit, call godot_review with the changed files. Fix all errors before the next step.",
      "5. If Godot is installed, call godot_check before you finish.",
      "Before you rename, move or delete a function, signal, node or file, call godot_usages to see everything that uses it.",
      "If the review reports Godot 3 code, call godot_migrate (report first, then write: true) instead of fixing the renames by hand.",
      "For findings godot_fix can do (freed checks, get_meta defaults, lone ternaries, garbled text, emit_signal, MultiMesh and Timer order), call godot_fix (report, then write: true) instead of editing them by hand.",
      "6. If you verified that a review finding is a false alarm, pass its line to godot_feedback with verdict wrong.",
      "7. When Godot shows an error you do not understand, call godot_lessons with the message as `error`: lessons from real projects say what it usually means. When you fixed something that took more than one try, keep the lesson with godot_lesson_add (general words, no names or code).",
      "Keep each change small. Use static types (var x: int, func f() -> void).",
      'To make or check a 3D model (.glb): 0) godot_model_brief gives one page with everything to start (use it first if you are a small model). 1) godot_model_identify says what the thing is: its parts, size, pivots and what to anticipate. 2) godot_model_spec shows the spec format. 3) godot_model_build builds it (put "archetype" in the spec). 4) godot_model_view shows it as text (front, side, top views and what does not touch) so you can check the shape. 5) godot_model_lint with archetype checks it. Fix every error. Models face +Z, +Y is up, units are metres.',
    ].join("\n"),
  },
  premium: {
    detail: "full",
    findings: 200,
    infos: true,
    instructions: [
      `Godotwright gives you checked Godot ${GODOT_TARGET} knowledge for this project.`,
      "- godot_scan maps the project (scenes and node trees, scripts with signatures, autoloads, input map, key settings).",
      "- godot_api and godot_api_search answer from the official Godot 4.7 class reference, offline. Use them instead of memory for exact signatures, and to translate Godot 3 names.",
      "- godot_review is a static AAA review with scores (api, performance, quality, structure). It needs no Godot. Pass code + file to review code before you write it, or files to focus on what you changed.",
      "- godot_check runs Godot headless (import, load every script and scene, optionally run the main scene) and reports errors as file:line.",
      "- godot_doctor answers \"what is wrong here, and in which order do I fix it\": the review and Godot grouped by cause, most urgent first, each with the lesson that explains it and whether godot_fix or godot_migrate can do it, then numbered next steps. Start here in a project you do not know or when something is broken.",
      "- godot_fix applies the mechanical fixes for review findings (each labelled safe or check), shows them first, writes with write: true and reviews the changed files again.",
      "- godot_checklist lists every AAA rule with its fix.",
      "- godot_usages finds every place a name or res:// path is used (code, scenes, connections, groups, settings). Call it before you rename, move or delete anything.",
      "- godot_rename renames a name or moves a res:// file everywhere at once (dry run first, then write: true), keeping scene connections, node paths and .uid files right. Use it instead of editing references by hand.",
      "- godot_project_edit changes project.godot (settings, input actions, autoloads) with checks, touching only that entry. Use it instead of editing project.godot by hand.",
      "- godot_screenshot renders a scene, or a .glb model from several sides, to a PNG and says how much is drawn. Use it to look at what you built.",
      "- godot_play runs a scene with an input timeline (press jump on frame 10, hold right for 20 frames) and returns the values you watch per frame. Use it to see the game do something without a screen.",
      "- godot_test runs the project's GUT or GdUnit4 tests headless and returns only what failed, with file:line.",
      "- godot_scene_edit changes a .tscn (add or remove nodes, set properties, connect signals, attach scripts) with checks against Godot 4.7, touching only those lines. Use it instead of editing .tscn files by hand.",
      "- godot_migrate rewrites Godot 3 GDScript to Godot 4 where that is mechanical (report first, then write: true) and lists what still needs a hand. Use it before fixing Godot 3 findings one by one.",
      "- godot_feedback marks a review finding as wrong (a verified false alarm) or right, or says whether a lesson helped; Godotwright learns from it on this machine.",
      "- godot_lessons answers from lessons learned in real Godot projects (symptom, cause, fix, how to test): by words, by a Godot error message, by a rule, or `gaps: true` for the errors Godotwright cannot predict yet. Use it when Godot shows an error you do not understand and before you build moving platforms, vehicles, large worlds, runtime-loaded models or shaders.",
      "- godot_lesson_add keeps a lesson you learned here (title, symptom, cause, fix, the Godot message), scrubbed of names, paths and code, on this machine only. The next godot_check or godot_lessons shows it when the same problem comes back. Add one whenever a fix took more than one try.",
      "- godot_model_brief is one page before you build: what the thing is, the nearest ready-made kind, parts, size, rules, mistakes, the order of tools and a spec cheat sheet. Start here.",
      "- godot_model_identify says what a thing is (English or Dutch, typos and descriptions work): the family, the parts that must exist and how they move, a typical size with its source, variants, Godot conventions (models face +Z, +Y is up, units are metres), what to anticipate and the usual mistakes. Call it before you build or check any 3D model.",
      "- godot_model_spec explains the model spec (a JSON tree of named parts: box, cylinder, ellipsoid, lathe, loft, extrude, roof, tube, with expressions, mirror, repeat, bevels and textured materials) and lists the ready-made kinds.",
      "- godot_model_build makes a clean .glb from a kind or a spec (UVs, tangents, a node per part, deterministic) and lints it.",
      "- godot_model_view draws a .glb as text: front, side and top views made of letters (one letter per part), a table of the parts with sizes, and the parts that do not touch the rest (a ladder away from its tree, a wheel without an axle). You cannot see a picture, so use it after every build to check shape, proportions and that everything is attached.",
      "- godot_model_lint scores a .glb (geometry, materials, performance, rig), and with `archetype` also checks it is what it should be: parts, pivots, wheel axes, size, direction. godot_model_inspect shows what is in a .glb.",
      "Work in reviewed steps: plan, look up the API, write, review, then check with Godot before you finish. For models: identify, spec, build, view, lint with the archetype, fix, repeat. When a fix was hard, keep the lesson (godot_lesson_add) so the next session starts smarter.",
    ].join("\n"),
  },
};

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
});
const failure = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  isError: true,
});

export function createServer(options: ServerOptions = {}): McpServer {
  const tier: Tier = options.tier ?? "cheap";
  if (!Object.hasOwn(PROFILES, tier))
    throw new Error(`tier must be cheap or premium, got "${tier}"`);
  const profile = PROFILES[tier];
  const base = resolve(options.root ?? process.cwd());

  /** Resolves a tool path: absolute, `res://...` (inside the project) or relative to the root. */
  const where = (path?: string): string => {
    if (!path) return base;
    if (path.startsWith("res://")) {
      const project = findProjectRoot(base) ?? base;
      return join(project, path.slice("res://".length));
    }
    return isAbsolute(path) ? path : resolve(base, path);
  };

  const server = new McpServer(
    { name: "godotwright", title: "Godotwright", version: VERSION },
    { instructions: profile.instructions },
  );

  const detailParam = z
    .enum(["brief", "full"])
    .optional()
    .describe(
      `brief: short output with capped lists; full: everything (default for this ${tier} profile: ${profile.detail}).`,
    );
  const pathParam = z
    .string()
    .optional()
    .describe(
      "The project folder, or any file or folder inside it (Godotwright walks up to project.godot). Relative paths start at the server's folder. Default: the current project.",
    );
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  // These tools answer from the project but record counters in the local learning file.
  const writesLearning = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  };

  server.registerTool(
    "godot_scan",
    {
      title: "Map the Godot project",
      description:
        "Map a Godot 4 project from its files, without running Godot: scenes with node trees, scripts with class_name, signals, functions and exports, autoloads, input actions, key settings, and broken references. Call this first in a project, and again after large changes. For one name use godot_usages; for engine classes use godot_api. `detail` brief gives one line per scene and script; full adds node trees with line numbers, signal connections, input events and settings. Read-only. Returns an error when there is no project.godot at or above `path`.",
      inputSchema: { path: pathParam, detail: detailParam },
      annotations: readOnly,
    },
    async ({ path, detail }) =>
      guard(() =>
        text(
          formatProjectMap(
            scanProject(where(path), {
              base: options.base,
              baseFiles: options.baseFiles,
            }),
            detail ?? profile.detail,
          ),
        ),
      ),
  );

  server.registerTool(
    "godot_api",
    {
      title: "Look up the Godot 4.7 API",
      description:
        "Exact lookup in the official Godot 4.7 class reference, offline: `Class`, `Class.member`, `Class.Enum.VALUE`, `@annotation` or a global function. A class gives its parents, properties with defaults, methods, signals and enums; a member gives its exact signature and description, found through inheritance. Use it before calling any engine API you are not sure about; when you do not know the exact name, use godot_api_search first. `detail` brief gives the signature and the first paragraph; full gives the whole entry. An unknown name returns an error with close matches, and a Godot 3 name with its Godot 4 name. It changes no project files; when learning is on, it counts the lookup in Godotwright's local learning file so later misses get better hints (GODOTWRIGHT_LEARN=0 turns that off).",
      inputSchema: {
        query: z
          .string()
          .describe(
            "e.g. CharacterBody2D.move_and_slide, Node.ready, @export_range, lerp, Tween",
          ),
        detail: detailParam,
      },
      annotations: writesLearning,
    },
    async ({ query, detail }) =>
      guard(() => {
        const api = GodotApi.load();
        const { result, hints } = lookupLearning(api, query);
        const out = formatLookup(api, result, detail ?? profile.detail, hints);
        return result.entries.length ? text(out) : failure(out);
      }),
  );

  server.registerTool(
    "godot_api_search",
    {
      title: "Search the Godot 4.7 API",
      description:
        "Search the Godot 4.7 class reference offline by words: class, method, property and signal names, keywords and descriptions, best matches first. Use it when you know what you need but not its name ('raycast 3d', 'change scene'), then call godot_api on the best match for its full entry. For where your own project uses a name, use godot_usages. Returns one line per match with its kind and signature, e.g. `method CharacterBody2D.is_on_floor() -> bool const`, or 'no matches'. `limit` caps the list (default 10, at most 50). Read-only.",
      inputSchema: {
        query: z
          .string()
          .describe("words, e.g. 'raycast 3d', 'change scene', 'is on floor'"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("max results (default 10)"),
      },
      annotations: readOnly,
    },
    async ({ query, limit }) =>
      guard(() => {
        const api = GodotApi.load();
        return text(formatSearch(api, api.search(query, limit ?? 10)));
      }),
  );

  server.registerTool(
    "godot_review",
    {
      title: "AAA review",
      description:
        "Static AAA review of the project, no Godot needed: API correctness (Godot 3 code, unknown classes, functions, members, signals, wrong argument counts, missing input actions), performance, code quality and structure. Returns a 0-100 score per category, then one line per finding: `res://file.gd:12: error [rule] message`; `detail` full adds the fix under each finding. Pass `files` to list only findings in files you changed. Pass `code` and `file` to review GDScript before writing it to disk. Pass `only_new: true` while you are fixing: new findings in full, the ones you already saw as one short line each, and how many are fixed. It never changes your code; it keeps the last review in .godot/godotwright/ for `only_new` and counts rule hits in the local learning file. For errors only the engine finds, run godot_check after it; godot_checklist lists every rule.",
      inputSchema: {
        path: pathParam,
        files: z
          .array(z.string())
          .optional()
          .describe("only show findings in these res:// files"),
        code: z
          .string()
          .optional()
          .describe("unsaved GDScript to review in place of the file on disk"),
        file: z
          .string()
          .optional()
          .describe("res:// path the code belongs to (required with code)"),
        only_new: z
          .boolean()
          .optional()
          .describe(
            "show only what changed since the last review of this project (saves tokens in a fix loop)",
          ),
        detail: detailParam,
      },
      annotations: writesLearning,
    },
    async ({ path, files, code, file, only_new, detail }) =>
      guard(() => {
        if (code !== undefined && !file)
          return failure("Pass `file` (a res:// path) together with `code`.");
        const target = file ? resPath(file) : undefined;
        const overrides =
          code !== undefined && target ? { [target]: code } : undefined;
        const dir = where(path);
        const report = reviewLearning(dir, {
          base: options.base,
          baseFiles: options.baseFiles,
          overrides,
        });
        const focus = [...(files ?? []), ...(target ? [target] : [])].map(
          resPath,
        );
        const missing = focus.length
          ? unknownFiles(dir, focus, overrides ?? {})
          : [];
        // Unsaved code is a what-if: it does not become the memory the next delta compares with.
        const delta = reviewDelta(dir, report, {
          remember: code === undefined,
        });
        const body = only_new
          ? `AAA review: ${report.project} (Godot ${report.godot}) overall ${report.overall}/100\n${report.categories.map((c) => `${c.category} ${c.score}`).join(", ")}; static typing ${report.typing.percent}%\n` +
            formatDelta(delta, {
              cap: profile.findings,
              focus,
              noInfos: !profile.infos && (detail ?? profile.detail) === "brief",
            })
          : formatReviewFor(
              report,
              detail ?? profile.detail,
              profile,
              focus,
              missing,
            );
        return missing.length ? failure(body) : text(body);
      }),
  );

  server.registerTool(
    "godot_usages",
    {
      title: "Find usages",
      description:
        "Find every place a name is used in the project, offline and without the editor: a function, signal, variable, constant, class_name, autoload, input action, group or node name, or a res:// path / uid:// (which files refer to it, and whether it exists). Looks in GDScript code (not comments), in strings where Godot looks names up (connect, emit_signal, is_action_pressed, add_to_group, get_node, load), in scene connections, node names and groups, and in project settings. Call it before you rename, move or delete anything; to make the change everywhere, use godot_rename. For engine API names use godot_api. Returns where the name is defined, then each file with the line number, the kind of use and the line itself (very common names are capped). Read-only.",
      inputSchema: {
        name: z
          .string()
          .describe(
            "what to look for, e.g. take_damage, health_changed, Player, jump, res://scenes/enemy.tscn",
          ),
        path: pathParam,
      },
      annotations: readOnly,
    },
    async ({ name, path }) =>
      guard(() =>
        text(
          formatUsages(
            findUsages(where(path), name, {
              base: options.base,
              baseFiles: options.baseFiles,
            }),
            profile.findings * 4,
          ),
        ),
      ),
  );

  server.registerTool(
    "godot_rename",
    {
      title: "Rename everywhere",
      description:
        "Rename a function, signal, variable, class_name, autoload, input action, group or node name everywhere it is used (GDScript, scene connections, node paths, groups, project settings), or move a res:// file together with its .uid and .import files and every reference to it. `from` and `to` are both names or both res:// paths. Without `write` it changes nothing and returns the exact lines it would change and what it could not change; with `write: true` it applies them and reports the review errors before and after (an error result when there are more after). Refuses, with an error, when the new name is already taken. Call godot_usages first to see what it will touch. For a setting value, an input event or a node property, use godot_project_edit or godot_scene_edit instead.",
      inputSchema: {
        from: z.string().describe("the current name, or a res:// path"),
        to: z.string().describe("the new name, or the new res:// path"),
        write: z
          .boolean()
          .optional()
          .describe("apply the rename (default false: show the plan only)"),
        path: pathParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ from, to, write, path }) => {
      try {
        const plan = renameInProject(where(path), from, to, {
          write: write === true,
        });
        const body = formatRename(plan);
        return plan.review && plan.review.after > plan.review.before
          ? failure(body)
          : text(body);
      } catch (error) {
        if (
          error instanceof RenameError ||
          error instanceof ProjectNotFoundError
        )
          return failure(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "godot_project_edit",
    {
      title: "Change project settings, input map or autoloads",
      description:
        "Change project.godot safely, without the editor: set or unset a setting (name and type checked against the Godot 4.7 reference), add events to an input action or remove it, add or remove an autoload (the file must exist and be a Node script or a scene; the name must not clash with a class). Only the lines of that entry change. Events: Key:Space, Key:Ctrl+S, Mouse:Left, JoyButton:A, JoyAxis:left_y-. `op` picks the change and which fields it needs: set (key, value), unset (key), input_add (action, events, deadzone), input_remove (action), autoload_add (name, file, global), autoload_remove (name). Without `write` it changes nothing and returns the diff and warnings; with `write: true` it writes and reports the review errors before and after (an error result when there are more after). A missing field or a change it refuses (bad event, unknown action, name clash) returns an error and writes nothing. Use it instead of editing project.godot by hand: the input map format is easy to break. For .tscn files use godot_scene_edit; to rename an action or autoload everywhere, use godot_rename.",
      inputSchema: {
        op: z
          .enum([
            "set",
            "unset",
            "input_add",
            "input_remove",
            "autoload_add",
            "autoload_remove",
          ])
          .describe("what to change"),
        key: z
          .string()
          .optional()
          .describe(
            "set/unset: the setting path, e.g. display/window/size/viewport_width",
          ),
        value: z
          .string()
          .optional()
          .describe(
            "set: the value, e.g. 1920, true, 1.5, a text, res://main.tscn or Vector2i(1920, 1080)",
          ),
        action: z
          .string()
          .optional()
          .describe("input_add/input_remove: the action name, e.g. jump"),
        events: z
          .array(z.string())
          .optional()
          .describe(
            "input_add: events such as Key:Space, Mouse:Left, JoyButton:0, JoyAxis:1-",
          ),
        deadzone: z
          .number()
          .optional()
          .describe("input_add: deadzone of a new action (default 0.2)"),
        name: z
          .string()
          .optional()
          .describe(
            "autoload_add/autoload_remove: the autoload name, e.g. Game",
          ),
        file: z
          .string()
          .optional()
          .describe("autoload_add: res:// path of the script or scene"),
        global: z
          .boolean()
          .optional()
          .describe("autoload_add: make a global variable (default true)"),
        write: z
          .boolean()
          .optional()
          .describe("write the change (default false: show the diff only)"),
        path: pathParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      op,
      key,
      value,
      action,
      events,
      deadzone,
      name,
      file,
      global,
      write,
      path,
    }) => {
      const need = (field: string, v: string | undefined): string => {
        if (v === undefined || v === "")
          throw new SettingsError(`${op} needs ${field}`);
        return v;
      };
      try {
        const edit: SettingsEdit =
          op === "set"
            ? { op, key: need("key", key), value: need("value", value) }
            : op === "unset"
              ? { op, key: need("key", key) }
              : op === "input_add"
                ? {
                    op,
                    action: need("action", action),
                    events: events ?? [],
                    ...(deadzone !== undefined ? { deadzone } : {}),
                  }
                : op === "input_remove"
                  ? { op, action: need("action", action) }
                  : op === "autoload_add"
                    ? {
                        op,
                        name: need("name", name),
                        file: need("file", file),
                        ...(global !== undefined ? { global } : {}),
                      }
                    : { op, name: need("name", name) };
        const plan = editProjectSettings(where(path), edit, {
          write: write === true,
        });
        const body = formatSettingsPlan(plan);
        return plan.review && plan.review.after > plan.review.before
          ? failure(body)
          : text(body);
      } catch (error) {
        if (
          error instanceof SettingsError ||
          error instanceof ProjectNotFoundError
        )
          return failure(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "godot_scene_edit",
    {
      title: "Change a scene",
      description:
        'Change a .tscn safely, without the editor: add a node (a Godot class or an instanced scene), remove a node (with its children, connections and the resources only it used), set a property (name and type checked against Godot 4.7; enums by name, resources as res:// files), connect or disconnect a signal (checks the signal exists, and warns when the method is missing or takes the wrong number of arguments, with the func line to add), or attach a script (refuses one that extends another node type). Node paths are relative to the scene root, which is ".". `op` picks the change and which fields it needs: add_node (parent, name, and type or instance), remove_node (node), set (node, property, value), connect and disconnect (from, signal, to, method), attach_script (node, script). Only the lines of that change are touched. Without `write` it changes nothing and returns the diff and warnings; with `write: true` it writes and reports the review errors before and after (an error result when there are more after). A missing field or a change it refuses returns an error and writes nothing. Use it instead of editing .tscn files by hand. For project.godot use godot_project_edit; to rename a node everywhere, use godot_rename.',
      inputSchema: {
        scene: z.string().describe("the scene: res://main.tscn, or a path"),
        op: z
          .enum([
            "add_node",
            "remove_node",
            "set",
            "connect",
            "disconnect",
            "attach_script",
          ])
          .describe("what to change"),
        node: z
          .string()
          .optional()
          .describe(
            'remove_node/set/attach_script: path of the node ("." is the root)',
          ),
        parent: z
          .string()
          .optional()
          .describe('add_node: path of the parent ("." is the root)'),
        name: z.string().optional().describe("add_node: name of the new node"),
        type: z
          .string()
          .optional()
          .describe("add_node: a Godot node class, e.g. Sprite2D"),
        instance: z
          .string()
          .optional()
          .describe("add_node: a res:// scene to instance instead of a type"),
        property: z
          .string()
          .optional()
          .describe("set: property name, e.g. position"),
        value: z
          .string()
          .optional()
          .describe(
            "set: the value, e.g. Vector2(10, 20), 3, true, ALWAYS, res://icon.svg, null",
          ),
        from: z
          .string()
          .optional()
          .describe("connect/disconnect: path of the node that emits"),
        signal: z
          .string()
          .optional()
          .describe("connect/disconnect: signal name"),
        to: z
          .string()
          .optional()
          .describe("connect/disconnect: path of the node that receives"),
        method: z
          .string()
          .optional()
          .describe("connect/disconnect: method name"),
        script: z
          .string()
          .optional()
          .describe("attach_script: res:// path of the script"),
        write: z
          .boolean()
          .optional()
          .describe("write the change (default false: show the diff only)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const need = (field: keyof typeof args): string => {
        const v = args[field];
        if (typeof v !== "string" || v === "")
          throw new SceneError(`${args.op} needs ${field}`);
        return v;
      };
      try {
        const { op } = args;
        const edit: SceneEdit =
          op === "add_node"
            ? {
                op,
                parent: need("parent"),
                name: need("name"),
                ...(args.instance
                  ? { instance: args.instance }
                  : { type: need("type") }),
              }
            : op === "remove_node"
              ? { op, node: need("node") }
              : op === "set"
                ? {
                    op,
                    node: need("node"),
                    property: need("property"),
                    value: need("value"),
                  }
                : op === "attach_script"
                  ? { op, node: need("node"), script: need("script") }
                  : {
                      op,
                      from: need("from"),
                      signal: need("signal"),
                      to: need("to"),
                      method: need("method"),
                    };
        const scene = args.scene.startsWith("res://")
          ? args.scene
          : where(args.scene);
        const plan = editScene(scene, edit, {
          write: args.write === true,
          project: base,
        });
        const body = formatScenePlan(plan);
        return plan.review && plan.review.after > plan.review.before
          ? failure(body)
          : text(body);
      } catch (error) {
        if (
          error instanceof SceneError ||
          error instanceof ProjectNotFoundError
        )
          return failure(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "godot_migrate",
    {
      title: "Port Godot 3 scripts to Godot 4",
      description:
        "Rewrite Godot 3 GDScript to Godot 4 where that is mechanical: @export/@onready/@tool, renamed classes, functions, properties and constants, yield() to await, connect()/emit_signal() to signals, funcref() to callables, members that moved (OS.get_ticks_msec() to Time). Strings, comments and node paths are left alone. Without `write` it only reports the changes; with `write: true` it rewrites the scripts. It also lists what still needs a hand (setget, move_and_slide arguments, rpc keywords, export hints it does not know). Scenes and project settings are not migrated; Godot's --convert-3to4 does those. `files` limits it to some res:// scripts; `detail` brief shows up to 12 changes per file, full shows every change. Running it twice changes nothing more. Use it before fixing Godot 3 findings from godot_review one by one, and run godot_review afterwards.",
      inputSchema: {
        path: pathParam,
        write: z
          .boolean()
          .optional()
          .describe("rewrite the scripts on disk (default false: report only)"),
        files: z
          .array(z.string())
          .optional()
          .describe("only these res:// scripts"),
        detail: detailParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, write, files, detail }) =>
      guard(() => {
        const result = migrateProject(where(path), {
          write: write === true,
          ...(files
            ? {
                files: files.map((f) =>
                  f.startsWith("res://") ? f : `res://${f.replace(/^\/+/, "")}`,
                ),
              }
            : {}),
        });
        return text(formatMigration(result, detail ?? profile.detail));
      }),
  );

  server.registerTool(
    "godot_doctor",
    {
      title: "What is wrong, and in which order to fix it",
      description:
        "One call for a project you do not know yet, or when something is broken and you do not know where to start: runs the review and, when Godot is installed, loads every script and scene with Godot; groups the findings by cause (twenty findings from one missing file are one problem), puts the most urgent first (Godot's errors, then the review's), and gives each the place, the lesson from real projects that explains it, the fix, and whether godot_fix or godot_migrate can do it. Pass `symptom` with what you see going wrong (\"helicopter bounces on the moving deck\") to add the lessons for it. Ends with numbered next steps. Read-only. Use godot_review for the full list and godot_check for Godot's raw output.",
      inputSchema: {
        path: pathParam,
        files: z.array(z.string()).optional().describe("only problems in these res:// files"),
        symptom: z.string().optional().describe("what you see going wrong, in plain words"),
        godot: z.boolean().optional().describe("run Godot too when it is installed (default true)"),
        limit: z.number().int().min(1).max(100).optional().describe("problems shown in full (default 12)"),
        detail: detailParam,
      },
      annotations: readOnly,
    },
    async ({ path, files, symptom, godot, limit, detail }) => {
      try {
        const report = await doctorProject(where(path), {
          ...(files?.length ? { files: files.map(resPath) } : {}),
          ...(symptom ? { symptom } : {}),
          godot: godot !== false,
          godotPath: options.godot,
          limit: limit ?? (profile.detail === "brief" ? 8 : 12),
        });
        return text(formatDoctor(report, detail ?? profile.detail));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "godot_fix",
    {
      title: "Fix review findings mechanically",
      description:
        `Apply the mechanical fixes for review findings instead of editing them one by one: ${FIXABLE_RULES.join(", ")}. Each fix rewrites only the line a finding points to, only when it looks exactly as expected, and is labelled \`safe\` (it only removes the problem: a freed check put first, get_meta() with has_meta(), a lone ternary as if/else, text encoded twice decoded, emit_signal() as signal.emit(), a MultiMesh format moved before instance_count, Timer.start() moved after add_child(), weakref() typed WeakRef) or \`check\` (it changes more: an await added to a coroutine call makes its caller a coroutine; a guessed type). Without \`write\` it shows the changes; with \`write: true\` it applies them and reviews the changed files again, returning what is left. Only safe fixes unless \`include_check: true\`. Lines it cannot fix are listed with the reason. Run godot_review first to see the findings, and godot_check after writing.`,
      inputSchema: {
        path: pathParam,
        files: z.array(z.string()).optional().describe("only these res:// files"),
        rules: z.array(z.string()).optional().describe(`only these rules (fixable: ${FIXABLE_RULES.join(", ")})`),
        include_check: z.boolean().optional().describe("also apply fixes labelled check (default false)"),
        write: z.boolean().optional().describe("write the fixes (default false: show them only)"),
        detail: detailParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, files, rules, include_check, write, detail }) =>
      guard(() => {
        const result = fixProject(where(path), {
          ...(files?.length ? { files: files.map(resPath) } : {}),
          ...(rules?.length ? { rules } : {}),
          includeCheck: include_check === true,
          write: write === true,
        });
        return text(formatFix(result, detail ?? profile.detail));
      }),
  );

  server.registerTool(
    "godot_check",
    {
      title: "Check with real Godot",
      description:
        "Run Godot 4.7 headless on the project: import, load and instantiate every script and scene, and optionally run the main scene (or the `scene` you name) for `run_frames` frames and return what it printed. Reports engine errors as res://file:line. Put print() calls in the code you are testing and read them back here. `run_frames` defaults to 0 (load only), or 120 when you pass `scene`; `timeout_seconds` caps each Godot run. Returns the errors and warnings with file:line, the totals and the printed output; an error result when Godot reports an error or is not installed. Your scenes and scripts are not changed: Godot updates its import cache in .godot/, where Godotwright also puts its checker script. Needs Godot on this machine and is slower than godot_review, so review first. To drive input and watch values use godot_play; for unit tests use godot_test.",
      inputSchema: {
        path: pathParam,
        run_frames: z
          .number()
          .int()
          .min(0)
          .max(10_000)
          .optional()
          .describe(
            "also run the main scene for this many frames and return its output (default 0; 120 when scene is given)",
          ),
        scene: z
          .string()
          .optional()
          .describe("run this scene (a res:// path) instead of the main scene"),
        timeout_seconds: z
          .number()
          .int()
          .min(10)
          .max(3600)
          .optional()
          .describe("timeout per Godot run (default 600)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, run_frames, scene, timeout_seconds }) => {
      try {
        const result = await checkLearning(where(path), {
          godot: options.godot,
          runFrames: run_frames ?? (scene ? 120 : 0),
          ...(scene ? { scene } : {}),
          timeoutMs: (timeout_seconds ?? 600) * 1000,
        });
        const lines = result.diagnostics.map(formatDiagnostic);
        lines.push(
          `${result.errors} errors, ${result.warnings} warnings (Godot ${result.godotVersion}, ${result.scripts} scripts, ${result.scenes} scenes)`,
        );
        lines.push(...lessonHintsForMessages(result.diagnostics.map((d) => d.message)));
        if (result.output !== undefined)
          lines.push(
            `output of the run (${result.ran ? `${result.ran.frames} frames = ${result.ran.seconds} s of game time, ` : ""}what the game printed):\n${result.output || "(nothing)"}`,
          );
        return result.errors > 0
          ? failure(lines.join("\n"))
          : text(lines.join("\n"));
      } catch (error) {
        if (error instanceof GodotNotFoundError) {
          return failure(
            `${error.message}\nUse godot_review for checks without Godot.`,
          );
        }
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "godot_screenshot",
    {
      title: "Screenshot a scene or model",
      description:
        "Render a scene, or a .glb/.gltf model framed by a camera and lit, to a PNG with Godot 4.7 (Compatibility renderer, works on software OpenGL; on Linux without a display it uses xvfb-run). Returns the picture and a short text: how much of each view is drawn and where, so you can tell an empty or off-screen picture even without reading the image. For a model, views front (from +Z, where models face), back, side, top and iso; several make a grid. `width` and `height` are per view; `frames` lets the scene settle before the picture. The PNG is written next to the model (car.glb gives car.png) or, for a scene, to .godot/godotwright/screenshot.png. An error result when Godot is missing or the scene cannot run. Use it to look at what you built. Without Godot, godot_model_view shows a model as text; to check behaviour rather than looks, use godot_play.",
      inputSchema: {
        path: pathParam,
        scene: z
          .string()
          .optional()
          .describe("the res:// scene to render (default: the main scene)"),
        model: z
          .string()
          .optional()
          .describe("a .glb or .gltf file to look at instead of a scene"),
        views: z
          .array(z.enum(VIEWS as [string, ...string[]]))
          .optional()
          .describe(
            "camera views for a model or a 3D scene without a camera (default [iso])",
          ),
        width: z
          .number()
          .int()
          .min(16)
          .max(3840)
          .optional()
          .describe("width of one view (default 640)"),
        height: z
          .number()
          .int()
          .min(16)
          .max(2160)
          .optional()
          .describe("height of one view (default 360)"),
        frames: z
          .number()
          .int()
          .min(3)
          .max(10_000)
          .optional()
          .describe("frames to run before the picture (default 10)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, scene, model, views, width, height, frames }) => {
      try {
        const report = await takeScreenshot(where(path), {
          godot: options.godot,
          ...(scene ? { scene } : {}),
          ...(model ? { model: where(model) } : {}),
          ...(views ? { views: views as View[] } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(frames ? { frames } : {}),
        });
        return {
          content: [
            { type: "text" as const, text: formatScreenshot(report) },
            {
              type: "image" as const,
              data: readFileSync(report.file).toString("base64"),
              mimeType: "image/png",
            },
          ],
        };
      } catch (error) {
        if (error instanceof GodotNotFoundError) return failure(error.message);
        if (
          error instanceof ScreenshotError ||
          error instanceof ProjectNotFoundError
        )
          return failure(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "godot_play",
    {
      title: "Play a scene with input",
      description:
        "Run a scene in Godot 4.7 headless for a number of physics frames, press and release input actions (or keys, mouse and joypad buttons) on the frames you give, and return a table of the values you watch per frame, plus errors and prints. The game sees each input on exactly that physics frame, and runs are deterministic. `input` steps are a frame, a verb (press, release, tap, or hold with a frame count) and an action or an event such as Key:Space; `watch` entries are a node path from the scene root, a dot, then a property or a method call; `every` sets how often values are sampled. Use it to check that the player jumps, moves, takes damage or that a timer fires, without a screen. An error result when the run does not finish or Godot reports an error; an unknown input action gives a warning. Your scenes and scripts are not changed: Godotwright runs it through a temporary script in .godot/godotwright/ and removes it afterwards. For assertions kept in the project use godot_test; for load errors use godot_check.",
      inputSchema: {
        path: pathParam,
        scene: z
          .string()
          .optional()
          .describe("the res:// scene to run (default: the main scene)"),
        input: z
          .string()
          .optional()
          .describe(
            'timeline: "10 press jump; 30 release jump; 40 hold right 20; 50 tap Key:Space"',
          ),
        watch: z
          .array(z.string())
          .optional()
          .describe(
            "values to sample: Player.position, Player.velocity.y, Player.is_on_floor()",
          ),
        frames: z
          .number()
          .int()
          .min(1)
          .max(100_000)
          .optional()
          .describe("physics frames to run (default 120)"),
        every: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "sample every n frames (default 10); frames with input and the last frame are always sampled",
          ),
        timeout_seconds: z
          .number()
          .int()
          .min(10)
          .max(3600)
          .optional()
          .describe("timeout of the run (default 300)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, scene, input, watch, frames, every, timeout_seconds }) => {
      try {
        const report = await playScene(where(path), {
          godot: options.godot,
          ...(scene ? { scene } : {}),
          ...(input ? { input } : {}),
          ...(watch ? { watch } : {}),
          ...(frames ? { frames } : {}),
          ...(every ? { every } : {}),
          timeoutMs: (timeout_seconds ?? 300) * 1000,
        });
        const body = formatPlay(report);
        return !report.finished ||
          report.diagnostics.some((d) => d.severity === "error")
          ? failure(body)
          : text(body);
      } catch (error) {
        if (error instanceof GodotNotFoundError)
          return failure(
            `${error.message}\nUse godot_review for checks without Godot.`,
          );
        if (error instanceof PlayError || error instanceof ProjectNotFoundError)
          return failure(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "godot_test",
    {
      title: "Run the unit tests",
      description:
        "Run the project's GUT or GdUnit4 tests in Godot 4.7 headless and return only the totals and the failing tests, each with res://file:line and the failure message, plus script errors from the run. Use it after a change to see whether the tests still pass. Needs Godot on this machine and GUT (res://addons/gut) or GdUnit4 (res://addons/gdUnit4) in the project. `framework` picks one when both are installed; `dirs` chooses the test folders or scripts (default: the framework's config, else res://test and res://tests); `filter` runs only matching GUT tests. An error result when a test fails, or when Godot or a framework is missing. Test files are not changed; reports go to a temporary folder or .godot/godotwright/. To try input without writing tests use godot_play; for load errors only use godot_check.",
      inputSchema: {
        path: pathParam,
        framework: z
          .enum(["gut", "gdunit"])
          .optional()
          .describe("which framework (default: whichever is installed)"),
        dirs: z
          .array(z.string())
          .optional()
          .describe(
            "test folders or scripts as res:// paths (default: the framework's config, else res://test and res://tests)",
          ),
        filter: z
          .string()
          .optional()
          .describe("GUT only: run only tests whose name contains this text"),
        timeout_seconds: z
          .number()
          .int()
          .min(10)
          .max(3600)
          .optional()
          .describe("timeout of the run (default 600)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, framework, dirs, filter, timeout_seconds }) => {
      try {
        const report = await runTests(where(path), {
          godot: options.godot,
          ...(framework ? { framework } : {}),
          ...(dirs?.length ? { paths: dirs } : {}),
          ...(filter ? { filter } : {}),
          timeoutMs: (timeout_seconds ?? 600) * 1000,
        });
        const body = formatTests(report);
        return testsPassed(report) ? text(body) : failure(body);
      } catch (error) {
        if (error instanceof GodotNotFoundError)
          return failure(
            `${error.message}\nUse godot_review for checks without Godot.`,
          );
        if (
          error instanceof TestRunError ||
          error instanceof ProjectNotFoundError
        )
          return failure(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "godot_feedback",
    {
      title: "Feedback on a review finding",
      description:
        "Tell Godotwright that a godot_review finding was wrong (a false alarm you verified) or right, or whether a lesson from godot_lessons helped. Pass `finding` (the line exactly as godot_review printed it) or `lesson` (its id), not both. For a finding, `verdict` wrong hides it in later reviews on this machine and right counts it as confirmed; a rule marked wrong far more often than right is then reported one level lower. For a lesson, right means it helped and ranks it higher; wrong makes it show up less. Only use it after checking the code (godot_api, godot_check); fix real findings instead of marking them. It writes to the local learning file only (`godotwright learn reset` forgets everything). Returns a one-line confirmation; an error when the line is not a finding, the lesson does not exist, or learning is off.",
      inputSchema: {
        finding: z
          .string()
          .optional()
          .describe(
            "the finding line, e.g. res://player.gd:12: error [api/unknown-member] ...",
          ),
        lesson: z
          .string()
          .optional()
          .describe("a lesson id from godot_lessons, e.g. physics/moving-platform-velocity"),
        verdict: z.enum(["wrong", "right"]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ finding, lesson, verdict }) => {
      if ((finding === undefined) === (lesson === undefined))
        return failure("Pass either `finding` or `lesson`.");
      if (lesson !== undefined) {
        try {
          recordLessonFeedback(lesson.trim(), verdict === "right" ? "helped" : "wrong");
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
        return text(
          verdict === "right"
            ? `Noted: ${lesson} helped; it ranks higher from now on.`
            : `Noted: ${lesson} did not fit; it is offered less from now on.`,
        );
      }
      const parsed = parseFindingLine(finding!);
      if (!parsed)
        return failure(
          "Pass the finding line exactly as godot_review printed it.",
        );
      if (!currentLearning())
        return failure(
          "Learning is off on this machine (godotwright learn on, or unset GODOTWRIGHT_LEARN=0), so nothing was recorded.",
        );
      recordFeedback(parsed, verdict);
      return text(
        verdict === "wrong"
          ? `Noted: ${parsed.rule} at ${parsed.file} is hidden from now on.`
          : `Noted: ${parsed.rule} was right.`,
      );
    },
  );

  server.registerTool(
    "godot_lessons",
    {
      title: "Lessons from real Godot projects",
      description:
        `Answer from lessons learned in real Godot 4 projects and on this machine: what went wrong, why in Godot terms, the fix, and how to test it. Find them by \`query\` (words such as 'helicopter slides off moving ship', or a lesson id), by \`error\` (a Godot message exactly as printed: the lessons that explain it), by \`rule\` (the lessons behind a review or model rule), or narrow by \`topic\` (${LESSON_TOPICS.join(", ")}). Without any of them it lists the lessons. \`gaps: true\` instead lists the Godot errors seen on this machine (and by other installs) that no review rule predicted and no lesson explains yet: what to teach Godotwright next. Use it when Godot shows an error you do not understand, and before you build moving platforms, vehicles, ships, large worlds, runtime-loaded models, shaders or headless tests. \`detail\` brief gives the title and fix; full adds symptom, cause, test, rules and the Godot message. Returns plain text; lessons learned here are marked. It counts which lessons were shown in the local learning file (GODOTWRIGHT_LEARN=0 turns that off). Say whether one helped with godot_feedback (\`lesson\`).`,
      inputSchema: {
        query: z.string().optional().describe("words, or a lesson id"),
        error: z.string().optional().describe("a Godot error or warning message, as printed"),
        rule: z.string().optional().describe("a rule id from godot_review or godot_model_lint, e.g. api/infer-variant"),
        topic: z.enum(LESSON_TOPICS).optional().describe("only lessons of this topic"),
        gaps: z.boolean().optional().describe("list what Godotwright cannot predict yet instead of lessons"),
        limit: z.number().int().min(1).max(50).optional().describe("max lessons (default 5; 20 when listing)"),
        detail: detailParam,
      },
      annotations: writesLearning,
    },
    async ({ query, error, rule, topic, gaps, limit, detail }) =>
      guard(() => {
        const learning = currentLearning();
        const shared = bundledLearning();
        if (gaps) return text(formatGaps(findGaps(learning ?? readLearning(), shared, limit ?? 20)));
        const listing = !query?.trim() && !error && !rule;
        const common = { learning, shared, limit: limit ?? (listing ? 20 : 5) };
        let hits: LessonHit[];
        const byId = query ? findLesson(query.trim(), learning) : undefined;
        if (byId) hits = [{ ...byId, score: 1, helped: 0, wrong: 0 }];
        else if (error) hits = lessonsForError(error, common);
        else if (rule) hits = lessonsForRule(rule, common);
        else hits = searchLessons(query ?? "", { ...common, topic: isTopic(topic) ? topic : undefined });
        if (learning) recordShown(hits.map((h) => h.lesson.id));
        const out = formatLessons(hits, byId ? "full" : (detail ?? profile.detail), query ?? error ?? rule ?? "");
        return hits.length ? text(out) : failure(out);
      }),
  );

  server.registerTool(
    "godot_lesson_add",
    {
      title: "Keep a lesson learned here",
      description:
        "Keep a lesson you learned in this project, so Godotwright (and the next session) knows it: when the same Godot message or question comes back, godot_check and godot_lessons show your fix. Write it in general words: `title` is the lesson in one line, `fix` what to do; add `symptom`, `cause`, `error` (the Godot message as printed, kept as a template), `topic`, `tags`, `rules` and `test` when you can. Names of this project (classes, nodes, files, its title), paths, links, e-mail addresses, codes, keys and source code are replaced before anything is stored; a lesson that is mostly names is refused with what to change. The same title again updates that lesson. It writes only to the local learning file and is never sent; `godotwright lessons export` prints these lessons for a person to propose for everyone. Add one whenever a fix took more than one try, and not for what a review rule already reports. Returns the stored lesson and what was replaced; an error when it is refused or learning is off.",
      inputSchema: {
        title: z.string().describe("the lesson in one line, e.g. 'A body placed on a moving deck must start at the deck speed'"),
        fix: z.string().describe("what to do instead"),
        symptom: z.string().optional().describe("what went wrong, as it showed"),
        cause: z.string().optional().describe("why, in Godot terms"),
        error: z.string().optional().describe("the Godot message it explains, as printed"),
        topic: z.enum(LESSON_TOPICS).optional().describe("default gdscript"),
        tags: z.array(z.string()).max(12).optional().describe("words to find it by"),
        rules: z.array(z.string()).max(5).optional().describe("review or model rule ids it belongs to"),
        test: z.string().optional().describe("how to test it"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      try {
        const { lesson, replaced, updated } = addLocalLesson(input, { projectNames: projectNames(base) });
        const removed = Object.entries(replaced).map(([k, n]) => `${n} ${k}`).join(", ");
        return text(
          `${updated ? "Updated" : "Kept"} ${lesson.id} on this machine${removed ? ` (replaced: ${removed})` : ""}.\n` +
            `${formatLesson({ lesson, local: true, helped: 0, wrong: 0 }, "full")}\n`,
        );
      } catch (error) {
        return failure(error instanceof LessonError || error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "godot_checklist",
    {
      title: "AAA checklist",
      description:
        "List the fixed AAA checklist that godot_review applies: plain text grouped by category (api, performance, quality, structure), one line per rule with its fix (on the premium profile also its id and severity). Read it before writing code to know the rules, or to look up a rule id from a finding. It does not look at the project; to check the project against these rules, use godot_review. Read-only.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => text(checklist(tier)),
  );

  /** A path the tools may read: its real place (links followed) must be inside the project, or the root when there is no project. */
  const inside = (path: string): string => {
    const full = where(path);
    const root = findProjectRoot(base) ?? base;
    const real = realLocation(full);
    const rel =
      real === undefined ? ".." : relative(realLocation(root) ?? root, real);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new ModelError(
        `${path} is outside the project (${root}); use a path inside it`,
      );
    return full;
  };
  /** A path the tools write: inside the project, and not a link, since writing through one changes the file it points to. */
  const output = (path: string): string => {
    const full = inside(path);
    if (isSymlink(full))
      throw new ModelError(
        `${path} is a symbolic link; write a regular file inside the project`,
      );
    return full;
  };
  /** A model contract inside the project. Its syntax is checked first, because loadContract quotes the text around an error. */
  const loadContractIn = (path: string) => {
    const full = inside(path);
    if (existsSync(full)) parseJsonFile(full, path);
    return loadContract(full);
  };
  const fileParam = z
    .string()
    .describe("Path to a .glb or .gltf file, inside the project.");
  const modelDetail = detailParam;

  server.registerTool(
    "godot_model_identify",
    {
      title: "What is this thing?",
      description:
        "Say what a thing is before you build or check a 3D model of it: its family, the parts a model needs (and which move, about which axis, with the pivot where), a typical size range with its source and a confidence class, variants, Godot conventions (+Y up, front faces +Z), what to anticipate and the usual mistakes. Works from a name in English or Dutch (plurals, typos, compounds like 'vrachtauto') or a description ('something with wheels and an engine'). A word that means two things is reported as ambiguous; something unknown gets the nearest family, marked generic. Use it for the full facts about a thing, and its archetype name for godot_model_lint; for one short page that also names the ready-made kind and the spec format, use godot_model_brief instead. Read-only.",
      inputSchema: {
        text: z
          .string()
          .describe(
            "what you want to make or check, e.g. 'a tractor', 'helikopter', 'wind turbine'",
          ),
      },
      annotations: readOnly,
    },
    async ({ text: query }) =>
      guard(() => {
        const library = loadLibrary();
        return text(formatIdentify(identify(query, library), library));
      }),
  );

  server.registerTool(
    "godot_model_brief",
    {
      title: "Briefing before you build a model",
      description:
        "One page to read before building a 3D model, made for small models: what the thing is, the ready-made kind to start from (with its build command), the parts to name your nodes after, typical size, rules, the usual mistakes, the order of tools to call, and a short spec cheat sheet. `text` is a name or a short description in English or Dutch; typos and plurals work. Replaces calling godot_model_identify and godot_model_spec separately when you just want to start; call those instead when you need every detail (all variants and sizes, or the full spec). Returns plain text. Read-only.",
      inputSchema: {
        text: z
          .string()
          .describe(
            "what you want to make, e.g. 'a rowing boat', 'dragon', 'castle wall'",
          ),
      },
      annotations: readOnly,
    },
    async ({ text: query }) => guard(() => text(briefFor(query).text)),
  );

  server.registerTool(
    "godot_model_spec",
    {
      title: "Model spec format",
      description:
        "Explain the model spec: a JSON tree of named parts that godot_model_build turns into a .glb. Returns plain text: the spec rules, a JSON example (a small car), then one line per ready-made kind with its parameters and their defaults. Read it before you write a `spec` or pass `params` to godot_model_build; skip it when a ready-made `kind` with its defaults is enough. godot_model_brief has a shorter cheat sheet. Read-only.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const kinds = allKinds().map(
        (g) =>
          `${g.kind}: ${g.description} Parameters: ${g.params.map((p) => `${p.name}=${String(p.default)}`).join(", ")}`,
      );
      return text(
        `${SPEC_HELP}\n${JSON.stringify(EXAMPLE_SPEC, null, 2)}\n\nReady-made kinds (godot_model_build with \`kind\`):\n${kinds.join("\n")}\n`,
      );
    },
  );

  server.registerTool(
    "godot_model_build",
    {
      title: "Build a 3D model from code",
      description:
        'Build a clean .glb (UVs, tangents, one node per part, same bytes every time) from a ready-made `kind` or a model `spec`, write it to `out`, and lint it. Pass `collision` so Godot adds collision shapes when it imports the file (most models need one; nobody remembers to add it by hand). If the spec has an "archetype" (or the kind has one), the result is also checked against what that thing should be. Give `kind` (with optional `params`), `spec` or `spec_file`; `contract_out` also writes a model.contract.json that godot_model_lint can hold later versions to. `out` is replaced if it exists. Returns the size, triangle and node count, then the lint report (`detail` full lists every finding with its fix); an error result when the lint finds errors, though the file is still written. Call godot_model_identify first and godot_model_spec for the format. To check a .glb you did not build here, use godot_model_lint.',
      inputSchema: {
        out: z
          .string()
          .describe(
            "where to write the .glb, inside the project, e.g. models/car.glb",
          ),
        kind: z
          .string()
          .optional()
          .describe(
            `a ready-made kind: ${allKinds()
              .map((k) => k.kind)
              .join(", ")}`,
          ),
        spec: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("a full model spec as a JSON object"),
        spec_file: z
          .string()
          .optional()
          .describe("or a path to a spec JSON file inside the project"),
        params: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("parameter values, e.g. { width: 9, roof: 'hip' }"),
        contract_out: z
          .string()
          .optional()
          .describe(
            "also write a model.contract.json here (inside the project)",
          ),
        collision: z
          .enum(["convex", "trimesh", "heightmap"])
          .optional()
          .describe(
            "collision for Godot: convex (a hull per mesh on import, for props and vehicles), trimesh (exact triangles on import, for buildings), or heightmap (terrain tiles: writes <name>.heightmap.tres and <name>.tscn with a StaticBody3D, faster than trimesh)",
          ),
        textures: z
          .boolean()
          .optional()
          .describe(
            "false writes plain colours instead of the texture maps of brick, wood, leaves and the like (smaller files, or for materials of your own); default true",
          ),
        detail: modelDetail,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      out,
      kind,
      spec,
      spec_file,
      params,
      contract_out,
      collision,
      textures,
      detail,
    }) =>
      guard(() => {
        if (!out.toLowerCase().endsWith(".glb"))
          return failure("`out` must end in .glb");
        if (contract_out && !contract_out.toLowerCase().endsWith(".json"))
          return failure("`contract_out` must end in .json");
        let source: unknown = spec;
        if (spec_file) {
          try {
            source = parseJsonFile(inside(spec_file), spec_file);
          } catch (error) {
            if (error instanceof ModelError) throw error;
            return failure(
              `${spec_file}: cannot read the spec (${(error as Error).message})`,
            );
          }
        }
        const outcome = buildModel({
          ...(kind ? { kind } : {}),
          ...(source === undefined ? {} : { spec: source }),
          ...(params ? { params } : {}),
          out: output(out),
          ...(contract_out ? { contractOut: output(contract_out) } : {}),
          ...(collision ? { collision } : {}),
          ...(textures === false ? { textures: false } : {}),
        });
        const errors = outcome.report.categories.reduce(
          (n, c) => n + c.errors,
          0,
        );
        const body = `${outcome.summary}\n${formatModelReport(outcome.report, detail ?? profile.detail)}`;
        return errors > 0 ? failure(body) : text(body);
      }),
  );

  server.registerTool(
    "godot_model_lint",
    {
      title: "Review a 3D model",
      description:
        "Score a .glb or .gltf without Godot: flipped faces, open edges, missing normals, UVs or tangents, textures, node names, budgets. Pass `archetype` (a name such as 'car' or 'helikopter', or an id) to also check it is what it should be: required parts, pivots, wheel axes, size (unit mistakes), direction. Pass `contract` to hold it to a model.contract.json, and `max_triangles` to flag a heavy model. Returns an overall score, a score per category (geometry, materials, performance, rig, and archetype when given) and the findings: `detail` brief shows up to 25 errors and warnings, full shows every finding with its fix. An error result when there are errors. Read-only. godot_model_build already lints what it builds; to see the shape use godot_model_view, for the raw contents godot_model_inspect.",
      inputSchema: {
        file: fileParam,
        archetype: z
          .string()
          .optional()
          .describe(
            "what the model should be, e.g. car, helikopter, vehicle.wheeled.car",
          ),
        contract: z
          .string()
          .optional()
          .describe("a model.contract.json inside the project"),
        max_triangles: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("flag a model with more triangles than this"),
        detail: modelDetail,
      },
      annotations: readOnly,
    },
    async ({ file, archetype, contract, max_triangles, detail }) =>
      guard(() => {
        const choice =
          archetype === undefined ? undefined : chooseArchetype(archetype);
        const report = lintModelFile(inside(file), {
          ...(choice ? { archetype: choice.archetype } : {}),
          ...(contract ? { contract: loadContractIn(contract) } : {}),
          ...(max_triangles ? { maxTriangles: max_triangles } : {}),
        });
        const head = choice ? formatChecked(choice, report.compared) : "";
        const errors = report.categories.reduce((n, c) => n + c.errors, 0);
        const body = `${head}${formatModelReport(report, detail ?? profile.detail)}`;
        return errors > 0 ? failure(body) : text(body);
      }),
  );

  server.registerTool(
    "godot_model_view",
    {
      title: "See a 3D model as text",
      description:
        "Look at a .glb or .gltf without Godot or a picture: three views (front, side, top) drawn with letters, one letter per part, then a list of the parts with their sizes and heights, and which parts do not touch the rest of the model (a ladder away from its tree, a wheel without an axle, something floating). `only` shows one of the views; `width` sets the characters per view (default 48). Use it after building to check the shape, proportions and that everything is attached. Read-only. For a rendered picture use godot_screenshot (needs Godot); for triangles, materials and textures use godot_model_inspect; for problems use godot_model_lint.",
      inputSchema: {
        file: fileParam,
        only: z
          .enum(["front", "side", "top"])
          .optional()
          .describe("show one view only"),
        width: z
          .number()
          .int()
          .min(20)
          .max(120)
          .optional()
          .describe("width of the views in characters (default 48)"),
      },
      annotations: readOnly,
    },
    async ({ file, only, width }) =>
      guard(() =>
        text(
          viewModel(inspectModel(inside(file)), {
            ...(width ? { width } : {}),
            ...(only ? { only } : {}),
          }),
        ),
      ),
  );

  server.registerTool(
    "godot_model_inspect",
    {
      title: "Inspect a 3D model",
      description:
        "Show what is in a .glb or .gltf, without Godot: file size, triangles, nodes, materials, textures with a memory estimate, the size in metres and the lowest point, then the node tree with triangles per mesh. `detail` brief lists the first 40 nodes; full lists every node, the materials and the textures. Use it for the numbers, for example to check a triangle budget or why a model floats. Read-only. To see the shape use godot_model_view; to find problems use godot_model_lint.",
      inputSchema: { file: fileParam, detail: modelDetail },
      annotations: readOnly,
    },
    async ({ file, detail }) =>
      guard(() =>
        text(
          formatModelInfo(inspectModel(inside(file)), detail ?? profile.detail),
        ),
      ),
  );

  return server;
}

/**
 * Where a path really is: symbolic links are followed in the part that exists, and the rest is kept as written.
 * Undefined for a link whose target does not exist, since its real place cannot be known.
 */
function realLocation(path: string): string | undefined {
  const rest: string[] = [];
  let dir = path;
  for (;;) {
    try {
      return join(realpathSync(dir), ...rest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (isSymlink(dir)) return undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return path;
    rest.unshift(basename(dir));
    dir = parent;
  }
}

/** Reads and parses a JSON file. A syntax error names the file only: V8's message quotes the text around the error. */
function parseJsonFile(full: string, path: string): unknown {
  const text = readFileSync(full, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelError(`${path}: not valid JSON`);
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function guard(fn: () => ReturnType<typeof text> | ReturnType<typeof failure>) {
  try {
    return fn();
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

/** A file the tools name, as the res:// path the review uses: no leading ./ or /, no .. segments. */
function resPath(file: string): string {
  return `res://${posix.normalize(file.replace(/^res:\/\//, "").replace(/^\/+/, ""))}`;
}

/** The focus paths that are not files of the project or unsaved code under review (a typo, or a path outside the project). */
function unknownFiles(
  dir: string,
  focus: string[],
  unsaved: Record<string, string>,
): string[] {
  const known = new Set([
    ...listProjectFiles(findProjectRoot(dir) ?? dir),
    ...Object.keys(unsaved),
  ]);
  return focus.filter((f) => !known.has(f));
}

function formatReviewFor(
  report: ReviewReport,
  detail: Detail,
  profile: Profile,
  focus: string[],
  missing: string[],
): string {
  const out: string[] = [];
  out.push(
    `AAA review: ${report.project} (Godot ${report.godot}) overall ${report.overall}/100`,
  );
  out.push(
    report.categories.map((c) => `${c.category} ${c.score}`).join(", ") +
      `; static typing ${report.typing.percent}%`,
  );
  let list = report.findings;
  if (focus.length) list = list.filter((f) => focus.includes(f.file));
  if (!profile.infos && detail === "brief")
    list = list.filter((f) => f.severity !== "info");
  const shown = list.slice(0, profile.findings);
  const errors = list.filter((f) => f.severity === "error").length;
  out.push(
    `${focus.length ? `findings in ${focus.join(", ")}` : "findings"}: ${list.length} (${errors} errors)`,
  );
  for (const f of shown) {
    out.push(formatFinding(f));
    if (detail === "full") out.push(`  fix: ${RULES[f.rule]?.fix ?? ""}`);
  }
  if (list.length > shown.length)
    out.push(`+${list.length - shown.length} more`);
  if (errors === 0 && focus.length && missing.length === 0)
    out.push("No errors in these files.");
  for (const file of missing) out.push(`no such file in the project: ${file}`);
  if (report.learning?.hidden)
    out.push(
      `${report.learning.hidden} ${report.learning.hidden === 1 ? "finding" : "findings"} hidden: marked as wrong earlier.`,
    );
  if (report.learning?.downgraded.length)
    out.push(
      `Learned: ${report.learning.downgraded.join(", ")} shown as warnings; Godot did not confirm them.`,
    );
  if (report.learning?.softened?.length)
    out.push(
      `Learned: ${report.learning.softened.join(", ")} shown one level lower; marked as false alarms far more often than right.`,
    );
  out.push(...lessonHintsForRules(shown.map((f) => f.rule)));
  return `${out.join("\n")}\n`;
}

function checklist(tier: Tier): string {
  const out: string[] = [`AAA checklist (Godot ${GODOT_TARGET})`];
  for (const category of CATEGORIES) {
    out.push("", `${category}:`);
    for (const rule of Object.values(RULES).filter(
      (r) => r.category === category,
    )) {
      out.push(
        tier === "cheap"
          ? `- ${rule.title}: ${rule.fix}`
          : `- [${rule.id}] (${rule.severity}) ${rule.title}: ${rule.fix}`,
      );
    }
  }
  return `${out.join("\n")}\n`;
}
