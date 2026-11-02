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
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { withRun, type RunContext } from "../check/progress.js";
import { protectFrom } from "../project/protect.js";
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
import { formatShaderReport, shaderReport } from "../shader/shader.js";
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
import { compareGodot, formatCompare } from "../check/compare.js";
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
import { formatLeaks, leakScene } from "../perf/leaks.js";
import { formatPerf, perfScene } from "../perf/perf.js";
import { formatGame, formatStart } from "../session/format.js";
import { checkExport, formatExportCheck } from "../export/export.js";
import { patchExport } from "../export/patch.js";
import { formatExportRun, inspectPack, runExport, smokePack } from "../export/run.js";
import { formatJournal, formatUndo, readJournal, undoJournal } from "../journal/journal.js";
import { depsOf, formatCycles, formatDepsOf, formatUnused, formatWhy, sceneCycles, unusedFiles, whyUsed } from "../deps/deps.js";
import { gameRequest, newDiagnostics, readSession, reloadScripts, startSession, stepPayload, stopSession } from "../session/session.js";
import {
  ScenarioError,
  formatClaims,
  formatScenarioList,
  formatScenarios,
  judgeClaims,
  loadScenarios,
  parseExpectation,
  pickScenarios,
  runScenario,
  sampledWatches,
  saveScenario,
  scenarioData,
} from "../ci/scenario.js";
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
  ResourceEditError,
  editResource,
  formatResourcePlan,
  planFailed,
} from "../resource/edit.js";
import { OPS as RESOURCE_OPS, toOps } from "../resource/types.js";
import {
  SettingsError,
  editProjectSettings,
  formatSettingsPlan,
  type SettingsEdit,
} from "../settings/edit.js";
import { GODOT_TARGET, VERSION } from "../version.js";
import { renderInstructions } from "./instructions.js";
import { CheckOutput, DoctorOutput, ReviewOutput, TestOutput, checkData, compareData, doctorData, reviewData, testData } from "./structured.js";
import { ALL_TOOLS, WRITE_ONLY_TOOLS, enabledTools, readOnlyRefusal } from "./toolsets.js";

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
  /** Tool sets and tool names to offer (see TOOLSETS; default all). */
  tools?: string | readonly string[];
  /** Leave out the tools that always write, and refuse the write options of the others. */
  readOnly?: boolean;
}

interface Profile {
  detail: Detail;
  /** Max review findings shown. */
  findings: number;
  /** Include info-level findings. */
  infos: boolean;
}

const PROFILES: Record<Tier, Profile> = {
  cheap: { detail: "brief", findings: 15, infos: false },
  premium: { detail: "full", findings: 200, infos: true },
};

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
});
const failure = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  isError: true,
});
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The run context of a tool call: its cancel signal, and progress notifications when the client asked for them. */
function runContext(extra: Extra): RunContext {
  const token = extra._meta?.progressToken;
  if (token === undefined) return { signal: extra.signal };
  let progress = 0;
  return {
    signal: extra.signal,
    onProgress: (message) => {
      if (extra.signal.aborted) return;
      extra
        .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++progress, message } })
        .catch(() => undefined);
    },
  };
}

/** A result with its structured form next to the text; an error result when `ok` is false. */
const result = <T extends { ok: boolean }>(value: string, data: T, error = !data.ok) => ({
  content: [{ type: "text" as const, text: value }],
  structuredContent: data as T & Record<string, unknown>,
  ...(error ? { isError: true } : {}),
});

export function createServer(options: ServerOptions = {}): McpServer {
  const tier: Tier = options.tier ?? "cheap";
  if (!Object.hasOwn(PROFILES, tier))
    throw new Error(`tier must be cheap or premium, got "${tier}"`);
  const profile = PROFILES[tier];
  const base = resolve(options.root ?? process.cwd());
  // The "protect" lists of the default project's godotwright.json count for every write the tools make.
  protectFrom(base);

  /** Resolves a tool path: absolute, `res://...` (inside the project) or relative to the root. */
  const where = (path?: string): string => {
    if (!path) return base;
    if (path.startsWith("res://")) {
      const project = findProjectRoot(base) ?? base;
      return join(project, path.slice("res://".length));
    }
    return isAbsolute(path) ? path : resolve(base, path);
  };

  const enabled = enabledTools(options.tools);
  if (options.readOnly) for (const name of WRITE_ONLY_TOOLS) enabled.delete(name);
  const server = new McpServer(
    { name: "godotwright", title: "Godotwright", version: VERSION },
    { instructions: renderInstructions(tier, enabled, options.readOnly === true) },
  );
  // Registers a tool only when its set is enabled; a read-only server refuses the options that write. Every call
  // runs in a run context: Godot runs it starts report progress (when the client sent a progressToken) and are
  // stopped, with what they started, when the client cancels the call.
  const registerTool = server.registerTool.bind(server);
  const tool = ((name: string, config: never, cb: (args: Record<string, unknown>, extra: Extra) => unknown) => {
    if (!ALL_TOOLS.includes(name)) throw new Error(`${name} is in no tool set (src/mcp/toolsets.ts)`);
    if (!enabled.has(name)) return undefined;
    const run = async (args: Record<string, unknown>, extra: Extra) => {
      const why = options.readOnly ? readOnlyRefusal(name, args ?? {}) : undefined;
      if (why) return failure(why);
      return withRun(runContext(extra), async () => cb(args, extra));
    };
    return registerTool(name, config, run as never);
  }) as typeof server.registerTool;

  const detailParam = z
    .enum(["brief", "full"])
    .optional()
    .describe(
      `brief (capped lists) or full (everything); default ${profile.detail}`,
    );
  const pathParam = z
    .string()
    .optional()
    .describe(
      "project folder, or a file or folder inside it (relative to the server's folder; default: the current project)",
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

  tool(
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

  tool(
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

  tool(
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

  tool(
    "godot_review",
    {
      title: "AAA review",
      description:
        "Static AAA review of the project, no Godot needed: API correctness (Godot 3 code, unknown classes, members and signals, wrong argument counts, missing input actions), performance, code quality and structure. Returns a 0-100 score per category, then one line per finding, `res://file.gd:12: error [rule] message`, and the same as JSON (structuredContent); `detail` full adds each fix. `files` lists only findings in files you changed. `code` + `file` reviews GDScript before you write it. `only_new: true` while fixing: new findings in full, ones you saw as one short line, and how many are fixed. An older 4.x project also gets what changes on the way to 4.7; `from`/`target` set that range. It never changes your code (it keeps the last review in .godot/godotwright/ for only_new and counts rule hits in the local learning file). For errors only the engine finds, run godot_check; godot_checklist lists every rule.",
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
        target: z
          .string()
          .optional()
          .describe('Godot release the project moves to, "4.1" to "4.7" (default 4.7)'),
        from: z
          .string()
          .optional()
          .describe("release it comes from (default: the version saved in project.godot)"),
        detail: detailParam,
      },
      outputSchema: ReviewOutput,
      annotations: writesLearning,
    },
    async ({ path, files, code, file, only_new, target: targetVersion, from, detail }) =>
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
          ...(targetVersion ? { target: targetVersion } : {}),
          ...(from ? { from } : {}),
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
          ? `AAA review: ${report.project} (Godot ${report.godot}) overall ${report.overall}/100${upgradeNote(report)}\n${report.categories.map((c) => `${c.category} ${c.score}`).join(", ")}; static typing ${report.typing.percent}%\n` +
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
        const noInfos = !profile.infos && (detail ?? profile.detail) === "brief";
        const list = report.findings.filter((f) => (!focus.length || focus.includes(f.file)) && !(noInfos && f.severity === "info"));
        const data = reviewData(report, list, profile.findings);
        return result(body, data, missing.length > 0);
      }),
  );

  tool(
    "godot_usages",
    {
      title: "Find usages",
      description:
        "Find every place a name is used in the project, offline: a function, signal, variable, constant, class_name, autoload, input action, group or node name, or a res:// path / uid:// (which files refer to it, and whether it exists). Looks in GDScript (not comments), in strings where Godot looks names up (connect, emit_signal, is_action_pressed, add_to_group, get_node, load), in scene connections, node names and groups, and in project settings. Returns the definition, then each use with file, line, kind and the line itself (very common names are capped). Call it before you rename, move or delete anything; godot_rename makes the change everywhere. Read-only.",
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

  tool(
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

  tool(
    "godot_project_edit",
    {
      title: "Change project settings, input map or autoloads",
      description:
        "Change project.godot safely without the editor, touching only the lines of that entry. `op` and its fields: set (key, value; name and type checked against the Godot 4.7 reference), unset (key), input_add (action, events, deadzone), input_remove (action), autoload_add (name, file, global; the file must be a Node script or a scene, the name must not clash with a class), autoload_remove (name). Events: Key:Space, Key:Ctrl+S, Mouse:Left, JoyButton:A, JoyAxis:left_y-. Without `write` it returns the diff and warnings; with `write: true` it writes and reports the review errors before and after (an error result when there are more after). A missing field or a refused change (bad event, unknown action, name clash) is an error and writes nothing. Use it instead of editing project.godot by hand. For .tscn files use godot_scene_edit; to rename an action or autoload everywhere, godot_rename.",
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

  tool(
    "godot_scene_edit",
    {
      title: "Change a scene",
      description:
        "Change a .tscn safely without the editor, touching only the lines of that change. `op` and its fields: add_node (parent, name, and type or instance), remove_node (node; with its children, connections and the resources only it used), set (node, property, value; checked against Godot 4.7, enums by name, resources as res:// files), connect and disconnect (from, signal, to, method; checks the signal exists, warns when the method is missing or takes the wrong number of arguments, with the func line to add), attach_script (node, script; refuses a script that extends another node type), set_editable (node, editable). A change inside an instance that is not editable is refused, because Godot drops it on the next editor save; make_editable adds [editable] with it. Node paths are relative to the scene root \".\". Without `write` it returns the diff and warnings; with `write: true` it writes and reports the review errors before and after (an error result when there are more after). A missing field or a refused change is an error and writes nothing. For project.godot use godot_project_edit; to rename a node everywhere, godot_rename.",
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
            "set_editable",
          ])
          .describe("what to change"),
        node: z
          .string()
          .optional()
          .describe(
            'remove_node/set/attach_script/set_editable: path of the node ("." is the root)',
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
        editable: z.boolean().optional().describe("set_editable: false to make it not editable (default true)"),
        make_editable: z.boolean().optional().describe("add_node/set/connect: also make the instance editable when the change is inside one"),
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
        const make = args.make_editable ? { makeEditable: true } : {};
        const edit: SceneEdit =
          op === "add_node"
            ? {
                op,
                parent: need("parent"),
                name: need("name"),
                ...(args.instance
                  ? { instance: args.instance }
                  : { type: need("type") }),
                ...make,
              }
            : op === "remove_node"
              ? { op, node: need("node") }
              : op === "set"
                ? {
                    op,
                    node: need("node"),
                    property: need("property"),
                    value: need("value"),
                    ...make,
                  }
                : op === "attach_script"
                  ? { op, node: need("node"), script: need("script") }
                  : op === "set_editable"
                    ? { op, node: need("node"), editable: args.editable !== false }
                    : op === "connect"
                      ? { op, from: need("from"), signal: need("signal"), to: need("to"), method: need("method"), ...make }
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

  tool(
    "godot_shader",
    {
      title: "Review and compile shaders",
      description:
        "Check every shader (.gdshader, .gdshaderinc, Shader resources in scenes) two ways: a static review against Godot 4.7's own shader tables (Godot 3 names such as hint_albedo, SCREEN_TEXTURE or WORLD_MATRIX; built-ins in the wrong shader_type or function; read-only built-ins written, such as COLOR in a spatial fragment(); unknown render modes; missing includes; colour uniforms without source_color; performance hints), then a headless compile by real Godot when it is installed (no GPU needed) that adds Godot's own errors. Every line is `res://file:line: severity [rule] message`; [godot] marks the compiler's. Pass `code` + `file` to check a shader before you save it, `files` for some shaders (an include also compiles the shaders that use it), `compile: false` to skip Godot. godot_migrate rewrites the Godot 3 names; godot_api `shader:spatial.fragment` lists built-ins.",
      inputSchema: {
        path: pathParam,
        files: z.array(z.string()).optional().describe("only these res:// shaders, includes or scenes"),
        code: z.string().optional().describe("unsaved shader code, checked in place of the file on disk"),
        file: z.string().optional().describe("res:// path the code belongs to (required with code)"),
        compile: z.boolean().optional().describe("compile with Godot (default: when Godot is found; true fails without it)"),
        detail: detailParam,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, files, code, file, compile, detail }) => {
      try {
        if (code !== undefined && !file) return failure("Pass `file` (a res:// path) together with `code`.");
        const target = file ? resPath(file) : undefined;
        const overrides = code !== undefined && target ? { [target]: code } : undefined;
        const focus = [...(files ?? []), ...(target ? [target] : [])].map(resPath);
        const report = await shaderReport(where(path), {
          ...(focus.length ? { files: focus } : {}),
          ...(overrides ? { overrides } : {}),
          ...(compile !== undefined ? { compile } : {}),
          godot: options.godot,
          base: options.base,
          baseFiles: options.baseFiles,
        });
        const body = formatShaderReport(report, detail ?? profile.detail);
        return report.errors > 0 ? failure(body) : text(body);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );

  tool(
    "godot_resource_edit",
    {
      title: "Change a resource or import settings",
      description:
        'Edit a .tres (or the sub_resources of a .tscn) and import settings, without the editor. .tres: set/unset properties on [resource] or a sub_resource (`sub`: its id), add_sub (type, optional id), remove_sub; names and types checked against Godot 4.7 (enums by name, resources as res:// or SubResource("id"), byte arrays as [0, 255] or base64:...); uids kept, only changed lines touched. Import (give the asset or its .import): get (key: type, default, choices), diff (options changed from default), set/unset an option (names checked against what the importer reads, enums by name: Forward, VRAM Compressed), per sub-resource with `sub` animations/<name>, meshes/<name>, materials/<name>, nodes/PATH:<node> (loop_mode, shadow meshes, external materials, cast shadow), importer (as: animation_library, scene, image, texture, keep), reimport. Ops run in order; one write. Without `write` it returns the diff. With write a .import is reimported headless and checked: Godot kept each value, output changed or not (an error result when Godot dropped a value or the import failed). godot_undo reverts.',
      inputSchema: {
        file: z.string().describe("res://path or a path: .tres, .tscn, an asset or its .import"),
        ops: z
          .array(
            z.object({
              op: z.enum(RESOURCE_OPS),
              key: z.string().optional().describe("property or import option"),
              value: z
                .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.number(), z.string()]))])
                .optional()
                .describe("set: the value"),
              sub: z.string().optional().describe("sub_resource id, or kind/name in a .import"),
              type: z.string().optional().describe("add_sub: Resource class"),
              id: z.string().optional().describe("add_sub: id to give it"),
              as: z.string().optional().describe("importer: the new importer"),
            }),
          )
          .min(1)
          .describe("changes or questions, applied in order"),
        write: z.boolean().optional().describe("write (default false: diff only)"),
        reimport: z.boolean().optional().describe("after a .import write, reimport with Godot and verify (default true)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const file = args.file.startsWith("res://") ? args.file : where(args.file);
        const plan = await editResource(file, toOps(args.ops), {
          write: args.write === true,
          project: base,
          ...(options.godot ? { godot: options.godot } : {}),
          ...(args.reimport === false ? { reimport: false } : {}),
        });
        const body = formatResourcePlan(plan);
        return planFailed(plan) ? failure(body) : text(body);
      } catch (error) {
        if (error instanceof ResourceEditError || error instanceof ProjectNotFoundError) return failure(error.message);
        throw error;
      }
    },
  );

  tool(
    "godot_migrate",
    {
      title: "Port Godot 3 scripts to Godot 4",
      description:
        "Rewrite Godot 3 GDScript and shaders to Godot 4 where that is mechanical: @export/@onready/@tool, renamed classes, functions, properties and constants, yield() to await, connect()/emit_signal() to signals, funcref() to callables, moved members (OS.get_ticks_msec() to Time), shader renames (hint_albedo to source_color, WORLD_MATRIX to MODEL_MATRIX, ...) and SCREEN_TEXTURE/DEPTH_TEXTURE to a hint uniform. Strings, comments and node paths are left alone. Without `write` it only reports; with `write: true` it rewrites the scripts. It lists what still needs a hand (setget, move_and_slide arguments, rpc keywords, unknown export hints). Scenes and project settings are not migrated (Godot's --convert-3to4 does those). `files` limits it to some scripts; `detail` brief shows up to 12 changes per file. Running it twice changes nothing more. Use it before fixing Godot 3 findings one by one, then run godot_review.",
      inputSchema: {
        path: pathParam,
        write: z
          .boolean()
          .optional()
          .describe("rewrite the scripts on disk (default false: report only)"),
        files: z
          .array(z.string())
          .optional()
          .describe("only these res:// scripts or shaders"),
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

  tool(
    "godot_export",
    {
      title: "Check what the exported game will hold",
      description:
        "Compare the export presets (export_presets.cfg) with what the scripts and scenes load, without exporting: files that exclude_filter leaves out although they are preloaded or loaded (Godot leaves them out even when something needs them, so the build fails there), plain data files (text, binary, GeoJSON, cfg, XML, YAML; JSON and imported CSV are fine) that Godot only exports when include_filter names them, paths built at run time under an excluded folder, a BOM that makes Godot read no presets; plus whether export templates are installed. `preset` limits it to one preset (name or number). `pck`: read an exported .pck (or a game executable with the pack inside) instead, without Godot, and compare it with the project: files the game loads that are missing, editor-only and test files shipped. Read-only. Run it before an export and after changing what the game loads; godot_export_run exports for real.",
      inputSchema: {
        path: pathParam,
        preset: z.string().optional().describe("only this preset (its name or number)"),
        pck: z.string().optional().describe("an exported .pck or game executable to read and compare"),
      },
      annotations: readOnly,
    },
    async ({ path, preset, pck }) =>
      guard(() => {
        if (pck) {
          const r = inspectPack(where(pck), { path: where(path), ...(preset ? { preset } : {}) });
          return r.errors ? failure(formatExportRun(r)) : text(formatExportRun(r));
        }
        const result = checkExport(where(path), preset ? { preset } : {});
        const body = formatExportCheck(result);
        return result.problems.some((p) => p.severity === "error") ? failure(body) : text(body);
      }),
  );

  tool(
    "godot_export_run",
    {
      title: "Export headless, check the build and run it",
      description:
        "Export a preset with Godot 4.7 headless and check the result instead of trusting it. mode `pack` (default; needs no templates), `release` or `debug` (need export templates), `patch` (only what changed: Godot's --export-patch against `against` base packs or the preset's patches, or cut from a full export by `manifest`, the base game's file list with md5, default godotwright.json baseFiles; it never ships an unchanged base file nor misses a changed one, and lists every file), or `smoke` (run an existing `pck`). Stops early on an unknown preset, a BOM in export_presets.cfg or missing templates; checks the file is there; compares the pack with what the game loads (missing files with their load chain, editor-only and test files shipped); runs the exported game headless for `frames` (default 120, 0 = none) and reports runtime errors with call chains. Writes to .godot/godotwright/export/<preset>/ unless `out` is given. An error result on any error.",
      inputSchema: {
        path: pathParam,
        preset: z.string().optional().describe("the preset (name or number); not needed for smoke"),
        mode: z.enum(["pack", "release", "debug", "patch", "smoke"]).optional().describe("default pack"),
        out: z.string().optional().describe("output file inside the project (.pck for pack and patch)"),
        frames: z.number().int().min(0).max(100_000).optional().describe("frames to run the exported game (default 120, 0 = no run)"),
        against: z.array(z.string()).optional().describe("patch: base .pck files in load order"),
        manifest: z.array(z.string()).optional().describe("patch: lists of the base game's files (JSON with md5, or paths)"),
        pck: z.string().optional().describe("smoke: the .pck or exported game to run"),
        timeout_seconds: z.number().int().min(10).max(7200).optional().describe("timeout per Godot run (default 600)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ path, preset, mode, out, frames, against, manifest, pck, timeout_seconds }) => {
      try {
        const dir = where(path);
        const common = { godot: options.godot, timeoutMs: (timeout_seconds ?? 600) * 1000, ...(frames !== undefined ? { frames } : {}) };
        let r;
        if (mode === "smoke") {
          if (!pck && !out) return failure("smoke needs pck: the .pck or exported game to run");
          r = await smokePack(where(pck ?? out), { path: dir, ...common });
        } else {
          if (!preset) return failure(`${mode ?? "pack"} needs preset (its name or number)`);
          r =
            mode === "patch"
              ? await patchExport(dir, { preset, ...common, ...(out ? { out: output(out) } : {}), ...(against ? { against: against.map(where) } : {}), ...(manifest ? { manifest: manifest.map(where) } : {}) })
              : await runExport(dir, { preset, mode: mode ?? "pack", ...common, ...(out ? { out: output(out) } : {}) });
        }
        const body = formatExportRun(r, { files: profile.detail === "full" || mode === "patch" });
        return r.errors ? failure(body) : text(body);
      } catch (error) {
        if (error instanceof GodotNotFoundError) return failure(`${error.message}\nUse godot_export for the checks without Godot.`);
        if (error instanceof ProjectNotFoundError) return failure(error.message);
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );

  tool(
    "godot_deps",
    {
      title: "The project's files as a graph: unused, why used, what a scene loads",
      description:
        "Follow what loads what, from where the game starts (main scene, autoloads, every res:// path in project.godot, export include filters, the shipped file list from godotwright.json, add-ons, tests, editor scripts), through ext_resource, preload, load, class_name, folders and file names the code builds paths from, textures next to models and import settings. op `unused`: files nothing reaches, biggest first, whole folders as one line (when in doubt a file counts as used, so the list can be trusted). op `why` (file): the chain from the game to the file, before you delete or move it. op `of` (file): what a scene or resource loads with it, biggest first, what it can load later, and paths that do not exist. op `cycles`: scenes or resources that load each other through ext_resource, which Godot cannot load (it reports \"[ext_resource] referenced non-existent resource\" for a file that is there). Read-only.",
      inputSchema: {
        path: pathParam,
        op: z.enum(["unused", "why", "of", "cycles"]).describe("unused, why, of or cycles"),
        file: z.string().optional().describe("why and of: the res:// file"),
      },
      annotations: readOnly,
    },
    async ({ path, op, file }) =>
      guard(() => {
        const dir = where(path);
        if (op === "unused") return text(formatUnused(unusedFiles(dir), profile.detail === "full" ? 60 : 25));
        if (op === "cycles") {
          const cycles = sceneCycles(dir);
          return cycles.length ? failure(formatCycles(cycles)) : text(formatCycles(cycles));
        }
        if (!file) return failure(`${op} needs file (a res:// path)`);
        if (op === "why") return text(formatWhy(whyUsed(dir, file)));
        const d = depsOf(dir, file);
        return d.missing.length ? failure(formatDepsOf(d)) : text(formatDepsOf(d));
      }),
  );

  tool(
    "godot_undo",
    {
      title: "Undo the last Godotwright writes",
      description:
        "Undo what Godotwright wrote, newest first: scene and project edits, renames (moved files go back), migrations, fixes and model builds each keep the files as they were, in .godot/godotwright/journal/ (the last 40 writes). `steps` undoes that many writes (default 1); `list` only shows them. A file changed after the write (by hand or by another tool) stops the undo there, so your later edits are never lost silently; `force` undoes anyway. Use it when a write made things worse, instead of repairing by hand.",
      inputSchema: {
        path: pathParam,
        steps: z.number().int().min(1).max(40).optional().describe("how many writes to undo (default 1)"),
        list: z.boolean().optional().describe("only list the writes that can be undone"),
        force: z.boolean().optional().describe("undo even when a file changed after the write; those changes are lost"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ path, steps, list, force }) =>
      guard(() => {
        if (list) return text(formatJournal(readJournal(where(path)).entries));
        const result = undoJournal(where(path), { ...(steps ? { steps } : {}), ...(force ? { force: true } : {}) });
        const body = formatUndo(result);
        return result.blocked ? failure(body) : text(body);
      }),
  );

  tool(
    "godot_session",
    {
      title: "Start or stop a game session that stays up",
      description:
        "Load a scene in Godot 4.7 headless once and keep it running between calls, paused at frame 0, so godot_game can look at the live game and move it frame by frame without loading the world again (a big world can take a minute to load; godot_play loads it on every call). op `start` (scene: default the main scene; restart: true loads it again), `status`, or `stop`. Only this machine can reach it (a loopback port with a token), the project is not changed (the script lives in .godot/godotwright/), and the game quits by itself after `idle_minutes` without a request (default 15). Stop it when you are done.",
      inputSchema: {
        path: pathParam,
        op: z.enum(["start", "status", "stop"]).describe("start, status or stop"),
        scene: z.string().optional().describe("the res:// scene to load (default: the main scene)"),
        restart: z.boolean().optional().describe("stop a running session and load the scene again"),
        idle_minutes: z.number().int().min(1).max(240).optional().describe("quit after this many minutes without a request (default 15)"),
        timeout_seconds: z.number().int().min(10).max(3600).optional().describe("how long the scene may take to load (default 300)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ path, op, scene, restart, idle_minutes, timeout_seconds }) => {
      try {
        const dir = where(path);
        if (op === "stop") return text((await stopSession(dir)) ? "session stopped\n" : "no session was running\n");
        if (op === "status") {
          if (!readSession(dir)) return text("no session is running; start one with op start\n");
          const { reply, diagnostics } = await gameRequest(dir, "status");
          return text(formatGame("status", reply, diagnostics));
        }
        const started = await startSession(dir, {
          godot: options.godot,
          ...(scene ? { scene } : {}),
          restart: restart === true,
          ...(idle_minutes ? { idleMinutes: idle_minutes } : {}),
          timeoutMs: (timeout_seconds ?? 300) * 1000,
        });
        return text(formatStart(started));
      } catch (error) {
        if (error instanceof GodotNotFoundError) return failure(`${error.message}\nUse godot_review for checks without Godot.`);
        if (error instanceof PlayError || error instanceof ProjectNotFoundError) return failure(error.message);
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );

  tool(
    "godot_game",
    {
      title: "Look at and drive the running game session",
      description:
        "Ask the game godot_session started. op: tree (the live node tree), get (values now), set (a Node.property), call (a method), eval (a Godot Expression on the scene root), step (run `frames` with an `input` timeline counted from this step, sample `watch`, stop early `until` a condition holds; the same frame-exact input as godot_play), signals (record them; later steps list when they fired), layout (3D objects: position, size, and whether each rests on, floats above or sinks into what is below, plus scale mistakes), ray (what a physics ray from-to hits), ui (visible controls at window `sizes`: clipped text, off-screen panels, overlapping buttons, small targets), errors (what the game printed since the last call), reload (load edited scripts into the running game: nodes keep their values and run the new code from the next step; a script that does not compile stays as it was). Every answer ends with the new errors and warnings, runtime errors with their call chain. Time only moves on a step, so the session is deterministic. Use it to try a fix live, reach a state that is hard to reach, or watch a long scenario in parts.",
      inputSchema: {
        path: pathParam,
        op: z.enum(["tree", "get", "set", "call", "eval", "step", "signals", "layout", "ray", "ui", "errors", "reload"]).describe("what to do"),
        files: z.array(z.string()).optional().describe("reload: res:// scripts to reload (default: every script changed since the session started or the last reload)"),
        from: z.string().optional().describe("ray: start, Vector3(...) or Vector2(...)"),
        to: z.string().optional().describe("ray: end"),
        sizes: z.array(z.string()).optional().describe("ui: window sizes such as 1280x720 or 720x1280 (default the size the project sets)"),
        root: z.string().optional().describe("tree and layout: start at this node (default the scene root)"),
        depth: z.number().int().min(0).max(20).optional().describe("tree: levels to show (default 3)"),
        limit: z.number().int().min(1).max(1000).optional().describe("tree: nodes to show (default 80)"),
        watch: z.array(z.string()).optional().describe('get and step: values to read, e.g. "Hero.position", "Hero.is_on_floor()"'),
        target: z.string().optional().describe("set: Node.property"),
        value: z.string().optional().describe("set: the new value as Godot writes it, e.g. Vector3(0, 30, 0)"),
        node: z.string().optional().describe("call: node path from the scene root"),
        method: z.string().optional().describe("call: method name"),
        args: z.array(z.string()).optional().describe("call: arguments as Godot values"),
        expr: z.string().optional().describe('eval: the expression, e.g. get_node("Hero").velocity.length()'),
        frames: z.number().int().min(1).max(100_000).optional().describe("step: frames to run (default 60)"),
        input: z.string().optional().describe('step: "0 press jump; 10 release jump; 20 hold right 30"'),
        every: z.number().int().min(1).optional().describe("step: sample every n frames (default: about 10 samples)"),
        until: z.string().optional().describe('step: stop at the first frame where this holds, "Hero.is_on_floor() == true"'),
        signals: z.array(z.string()).optional().describe("signals: Node.signal to record"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (a) => {
      try {
        const dir = where(a.path);
        if (a.op === "errors") {
          const d = newDiagnostics(dir);
          return text(d.length ? `${d.map(formatDiagnostic).join("\n")}\n` : "no new errors or warnings\n");
        }
        if (a.op === "reload") {
          const { reply, diagnostics, others } = await reloadScripts(dir, a.files);
          const body = formatGame("reload", { ...reply, others }, diagnostics);
          return reply["ok"] && !((reply["failed"] as string[] | undefined)?.length) ? text(body) : failure(body);
        }
        let payload: Record<string, unknown> = {};
        let timeout: number | undefined;
        if (a.op === "tree") payload = { root: a.root ?? ".", depth: a.depth ?? 3, limit: a.limit ?? 80 };
        else if (a.op === "get") payload = { watch: a.watch ?? [] };
        else if (a.op === "set") {
          if (!a.target || a.value === undefined) return failure("set needs target (Node.property) and value");
          payload = { path: a.target, value: a.value };
        } else if (a.op === "call") {
          if (!a.method) return failure("call needs node and method");
          payload = { node: a.node ?? ".", method: a.method, args: a.args ?? [] };
        } else if (a.op === "eval") {
          if (!a.expr) return failure("eval needs expr");
          payload = { expr: a.expr };
        } else if (a.op === "signals") payload = { signals: a.signals ?? [] };
        else if (a.op === "layout") payload = { root: a.root ?? ".", limit: a.limit ?? 60 };
        else if (a.op === "ray") {
          if (!a.from || !a.to) return failure("ray needs from and to, e.g. Vector3(0, 10, 0) and Vector3(0, -10, 0)");
          payload = { from: a.from, to: a.to };
        } else if (a.op === "ui") payload = { sizes: a.sizes ?? [] };
        else if (a.op === "step") {
          const frames = a.frames ?? 60;
          payload = stepPayload({ frames, ...(a.input ? { input: a.input } : {}), watch: a.watch ?? [], ...(a.every ? { every: a.every } : {}), ...(a.until ? { until: a.until } : {}) });
          timeout = Math.max(60_000, frames * 200);
        }
        const { reply, diagnostics } = await gameRequest(dir, a.op, payload, timeout);
        const body = formatGame(a.op, reply, diagnostics, a.watch ?? [], profile.detail === "full");
        return reply["ok"] ? text(body) : failure(body);
      } catch (error) {
        if (error instanceof PlayError || error instanceof ProjectNotFoundError) return failure(error.message);
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );

  tool(
    "godot_perf",
    {
      title: "Measure a scene's frame times",
      description:
        "Run a scene in Godot 4.7 headless and measure it the way a player feels it: frame-time p50, p95, p99 and max against a budget (default 16.6 ms), the physics step apart from the rest of the frame, the slowest frames with what changed on them (nodes made or freed in one frame, a heavy physics step, script work), node and orphan counts, and the change since the last run of the same scene (kept in .godot/godotwright/perf/). Headless measures the CPU side (scripts, physics, scene work), not the GPU. `input` plays a timeline as godot_play does, to measure while something happens. An error result when p95 is over budget or more than 10% worse than last time. Lessons that fit the numbers are named. Measure before and after every performance change.",
      inputSchema: {
        path: pathParam,
        scene: z.string().optional().describe("the res:// scene to measure (default: the main scene)"),
        frames: z.number().int().min(10).max(50_000).optional().describe("frames to measure (default 600)"),
        warmup: z.number().int().min(0).max(10_000).optional().describe("frames to run first without measuring (default 60)"),
        input: z.string().optional().describe('input while measuring: "10 hold right 300"'),
        budget_ms: z.number().positive().optional().describe("frame budget in ms (default 16.6)"),
        baseline: z.boolean().optional().describe("compare with and save the last run of this scene (default true)"),
        timeout_seconds: z.number().int().min(10).max(3600).optional().describe("timeout of the run (default 300)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ path, scene, frames, warmup, input, budget_ms, baseline, timeout_seconds }) => {
      try {
        const report = await perfScene(where(path), {
          godot: options.godot,
          ...(scene ? { scene } : {}),
          ...(frames ? { frames } : {}),
          ...(warmup !== undefined ? { warmup } : {}),
          ...(input ? { input } : {}),
          ...(budget_ms ? { budgetMs: budget_ms } : {}),
          baseline: baseline !== false,
          timeoutMs: (timeout_seconds ?? 300) * 1000,
        });
        const body = formatPerf(report);
        return report.verdict === "ok" && report.run.finished ? text(body) : failure(body);
      } catch (error) {
        if (error instanceof GodotNotFoundError) return failure(`${error.message}\nUse godot_review for the static performance checks without Godot.`);
        if (error instanceof PlayError || error instanceof ProjectNotFoundError) return failure(error.message);
        throw error;
      }
    },
  );

  tool(
    "godot_leaks",
    {
      title: "Find what leaks per scene reload",
      description:
        "Run a scene in Godot 4.7 headless in cycles (load, run cycle_frames frames, free; or keep: true to keep it running), snapshot the live objects after each cycle and report what grows per cycle after the warm-up: orphan nodes by class, script and scene with the parent they were removed from, the code that makes them and the remove_child() that dropped them; nodes left in the tree; objects that are not nodes, with the classes Godot still held at exit (--verbose) and the static or autoload containers that grow. `input` replays a timeline in every cycle. An error result when objects or orphan nodes grow more than the budget per cycle (default 0). Compares with the last run with the same mode, cycle_frames and input (.godot/godotwright/leaks/).",
      inputSchema: {
        path: pathParam,
        scene: z.string().optional().describe("the res:// scene to cycle (default: the main scene)"),
        cycles: z.number().int().min(2).max(1000).optional().describe("cycles (default 5)"),
        cycle_frames: z.number().int().min(1).max(100_000).optional().describe("frames per cycle (default 60)"),
        warmup: z.number().int().min(0).optional().describe("first cycles not counted (default 1)"),
        keep: z.boolean().optional().describe("keep the scene running instead of freeing it each cycle"),
        input: z.string().optional().describe('timeline replayed each cycle: "10 press load; 40 press unload"'),
        objects_per_cycle: z.number().min(0).optional().describe("allowed object growth per cycle (default 0)"),
        orphans_per_cycle: z.number().min(0).optional().describe("allowed orphan-node growth per cycle (default 0)"),
        timeout_seconds: z.number().int().min(10).max(3600).optional().describe("timeout of the run (default 300)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ path, scene, cycles, cycle_frames, warmup, keep, input, objects_per_cycle, orphans_per_cycle, timeout_seconds }) => {
      try {
        const report = await leakScene(where(path), {
          godot: options.godot,
          ...(scene ? { scene } : {}),
          ...(cycles ? { cycles } : {}),
          ...(cycle_frames ? { cycleFrames: cycle_frames } : {}),
          ...(warmup !== undefined ? { warmupCycles: warmup } : {}),
          reload: keep !== true,
          ...(input ? { input } : {}),
          budget: { ...(objects_per_cycle !== undefined ? { objects: objects_per_cycle } : {}), ...(orphans_per_cycle !== undefined ? { orphans: orphans_per_cycle } : {}) },
          timeoutMs: (timeout_seconds ?? 300) * 1000,
        });
        const body = formatLeaks(report);
        return report.verdict === "ok" && report.run.finished ? text(body) : failure(body);
      } catch (error) {
        if (error instanceof GodotNotFoundError) return failure(`${error.message}\nUse godot_review for the static checks without Godot.`);
        if (error instanceof PlayError || error instanceof ProjectNotFoundError) return failure(error.message);
        throw error;
      }
    },
  );

  tool(
    "godot_doctor",
    {
      title: "What is wrong, and in which order to fix it",
      description:
        "One call for a project you do not know yet, or when something is broken and you do not know where to start: runs the review and, when Godot is installed, loads every script and scene with Godot; groups the findings by cause (twenty findings from one missing file are one problem), most urgent first, each with its place, the lesson that explains it, the fix, and whether godot_fix or godot_migrate can do it; then numbered next steps. Also returns the problems as JSON. `symptom` (\"helicopter bounces on the moving deck\") adds the lessons for what you see. It changes no project files (Godot updates its cache in .godot/). For the full list use godot_review; for Godot's raw output godot_check.",
      inputSchema: {
        path: pathParam,
        files: z.array(z.string()).optional().describe("only problems in these res:// files"),
        symptom: z.string().optional().describe("what you see going wrong, in plain words"),
        godot: z.boolean().optional().describe("run Godot too when it is installed (default true)"),
        limit: z.number().int().min(1).max(100).optional().describe("problems shown in full (default 12)"),
        detail: detailParam,
      },
      outputSchema: DoctorOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
        return result(formatDoctor(report, detail ?? profile.detail), doctorData(report, profile.findings), false);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );

  tool(
    "godot_fix",
    {
      title: "Fix review findings mechanically",
      description:
        `Apply the mechanical fixes for review findings instead of editing them one by one: ${FIXABLE_RULES.join(", ")}. Each fix rewrites only the line a finding points to, only when it looks exactly as expected, and is labelled \`safe\` (it only removes the problem, e.g. a freed check put first, emit_signal() as signal.emit(), Timer.start() after add_child(), a stale uid set from its path, a lost .uid restored, an unused resource section removed) or \`check\` (it changes more: an await that makes the caller a coroutine, a guessed type, a uid that named another file, [editable] added, a setter that runs again). Without \`write\` it shows the changes; with \`write: true\` it applies them and reviews the changed files again, returning what is left. Only safe fixes unless \`include_check: true\`. Lines it cannot fix are listed with the reason. Run godot_review first and godot_check after writing.`,
      inputSchema: {
        path: pathParam,
        files: z.array(z.string()).optional().describe("only these res:// files"),
        rules: z.array(z.string()).optional().describe("only these rules (the fixable ones are listed above)"),
        include_check: z.boolean().optional().describe("also apply fixes labelled check (default false)"),
        stamp_uids: z.boolean().optional().describe("also give scenes, resources, scripts and shaders without a uid a new one (header or .uid file)"),
        from: z.string().optional().describe("release the project comes from, as in godot_review"),
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
    async ({ path, files, rules, include_check, stamp_uids, from, write, detail }) =>
      guard(() => {
        const result = fixProject(where(path), {
          ...(files?.length ? { files: files.map(resPath) } : {}),
          ...(rules?.length ? { rules } : {}),
          ...(from ? { from } : {}),
          includeCheck: include_check === true,
          stampUids: stamp_uids === true,
          write: write === true,
        });
        return text(formatFix(result, detail ?? profile.detail));
      }),
  );

  tool(
    "godot_check",
    {
      title: "Check with real Godot",
      description:
        "Run Godot 4.7 headless on the project: import, load and instantiate every script and scene, compile every .gdshader, and optionally run the main scene (or `scene`) for `run_frames` frames and return what it printed (put print() calls in the code you test). Returns the errors and warnings as res://file:line, the totals and the printed output; an error result when Godot reports an error or is not installed. Scenes and scripts are not changed: Godot updates its cache in .godot/, where the checker script also goes. Sends progress when the client asks for it; cancelling the call stops Godot. Slower than godot_review, so review first. `compare_godot` (a second binary, or `next` for $GODOT_NEXT) runs the same check on a temporary copy and returns only the errors and warnings that differ, e.g. what breaks in a 4.8 beta. To drive input use godot_play; for unit tests godot_test.",
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
        compare_godot: z
          .string()
          .optional()
          .describe('second Godot binary to diff against, or "next" for $GODOT_NEXT'),
      },
      outputSchema: CheckOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, run_frames, scene, timeout_seconds, compare_godot }) => {
      try {
        if (compare_godot) {
          const compared = await compareGodot(where(path), {
            godot: options.godot,
            compareGodot: compare_godot === "next" ? undefined : compare_godot,
            runFrames: run_frames ?? (scene ? 120 : 0),
            ...(scene ? { scene } : {}),
            timeoutMs: (timeout_seconds ?? 600) * 1000,
          });
          const hints = lessonHintsForMessages(compared.onlyOther.map((d) => d.message));
          const body = formatCompare(compared, profile.findings) + hints.join("\n");
          return result(body, compareData(compared, profile.findings));
        }
        const checked = await checkLearning(where(path), {
          godot: options.godot,
          runFrames: run_frames ?? (scene ? 120 : 0),
          ...(scene ? { scene } : {}),
          timeoutMs: (timeout_seconds ?? 600) * 1000,
        });
        const lines = checked.diagnostics.map(formatDiagnostic);
        lines.push(
          `${checked.errors} errors, ${checked.warnings} warnings (Godot ${checked.godotVersion}, ${checked.scripts} scripts, ${checked.scenes} scenes${checked.shaders ? `, ${checked.shaders} shaders` : ""})`,
        );
        lines.push(...lessonHintsForMessages(checked.diagnostics.map((d) => d.message)));
        if (checked.output !== undefined)
          lines.push(
            `output of the run (${checked.ran ? `${checked.ran.frames} frames = ${checked.ran.seconds} s of game time, ` : ""}what the game printed):\n${checked.output || "(nothing)"}`,
          );
        return result(lines.join("\n"), checkData(checked, profile.findings));
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

  tool(
    "godot_screenshot",
    {
      title: "Screenshot a scene or model",
      description:
        "Render a scene, or a .glb/.gltf model framed by a camera and lit, to a PNG with Godot 4.7 (Compatibility renderer; works on software OpenGL and uses xvfb-run on Linux without a display). Returns the picture and how much of each view is drawn and where, and warns when it is blank (black, transparent, one colour). Model views: front (from +Z, where models face), back, side, top, iso; several make a grid. The PNG goes next to the model (car.glb gives car.png) or, for a scene, to .godot/godotwright/screenshot.png. `baseline` (a name) compares with .godotwright/baselines/<name>.png (made when missing; its scene, size, views and frames are reused): changed pixels, boxes of change and how far a box moved, pass/fail by `tolerance` and `max_changed`; a change returns the diff picture (changed pixels magenta) and is not an error; `update: true` replaces the baseline. Runs are deterministic; Forward+-only effects differ from the game. An error result when Godot is missing or the scene cannot run. Without Godot, godot_model_view shows a model as text; to check behaviour, use godot_play.",
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
        baseline: z
          .string()
          .optional()
          .describe("compare with the baseline of this name (made when missing)"),
        update: z
          .boolean()
          .optional()
          .describe("with baseline: replace it with this picture"),
        tolerance: z
          .number()
          .min(0)
          .max(255)
          .optional()
          .describe("per-channel difference still the same pixel (default 16)"),
        max_changed: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("% of pixels that may change and still pass (default 0.1)"),
        baseline_dir: z
          .string()
          .optional()
          .describe("baseline folder inside the project (default .godotwright/baselines; godotwright ci needs --baseline-dir for another one)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ path, scene, model, views, width, height, frames, baseline, update, tolerance, max_changed, baseline_dir }) => {
      try {
        const report = await takeScreenshot(where(path), {
          godot: options.godot,
          ...(scene ? { scene } : {}),
          ...(model ? { model: where(model) } : {}),
          ...(views ? { views: views as View[] } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(frames ? { frames } : {}),
          ...(baseline ? { baseline } : {}),
          ...(update ? { update } : {}),
          ...(tolerance !== undefined ? { tolerance } : {}),
          ...(max_changed !== undefined ? { maxChanged: max_changed } : {}),
          // The baseline folder is written to, so it must stay inside the project like every other output.
          ...(baseline_dir ? { baselineDir: output(baseline_dir) } : {}),
        });
        // A baseline that did not change needs no picture; a changed one shows the diff, not the render.
        const status = report.baseline?.status;
        const picture =
          status === "same"
            ? undefined
            : status === "changed" && report.baseline?.diffPath
              ? report.baseline.diffPath
              : report.file;
        return {
          content: [
            { type: "text" as const, text: formatScreenshot(report) },
            ...(picture
              ? [
                  {
                    type: "image" as const,
                    data: readFileSync(picture).toString("base64"),
                    mimeType: "image/png",
                  },
                ]
              : []),
          ],
        };
      } catch (error) {
        if (error instanceof GodotNotFoundError) return failure(error.message);
        if (
          error instanceof ScreenshotError ||
          error instanceof ProjectNotFoundError ||
          error instanceof ModelError
        )
          return failure(error.message);
        throw error;
      }
    },
  );

  tool(
    "godot_play",
    {
      title: "Play a scene with input",
      description:
        "Run a scene in Godot 4.7 headless for some physics frames with an input timeline, and return a table of the watched values per frame plus errors and prints. Each input lands on exactly that physics frame and runs are deterministic. `input` steps: a frame, a verb (press, release, tap, or hold with a frame count) and an action or event such as Key:Space. `watch`: a node path from the scene root, a dot, then a property or method call. `until` stops at the first frame a condition holds; `signals` records when signals fire, with their arguments; `summary: true` gives one line per watched value (start, end, min, max, first change), cheaper on long runs; `expect` claims (\"Heli.health > 0\", \"Heli.position.y < 1 @ 90\", or how often a recorded signal fired) make the result an error when one fails, so a run doubles as a test; keep a passing run with godot_scenario op save and the same arguments. An error result when the run does not finish or Godot reports an error; an unknown input action is a warning. Project files are not changed (it runs a temporary script in .godot/godotwright/). For tests kept in the project use godot_test; for load errors godot_check.",
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
        until: z.string().optional().describe('stop at the first frame where this holds: "Heli.is_on_floor() == true"'),
        signals: z.array(z.string()).optional().describe('signals to record: "Heli.landed", "Deck.body_entered"'),
        summary: z.boolean().optional().describe("one line per watched value instead of a table (samples every frame)"),
        expect: z
          .array(z.string())
          .optional()
          .describe('claims to check: "Heli.health > 0" (last frame) or "Heli.position.y < 1 @ 90"; their values are watched; on a recorded signal, "Heli.landed >= 1" counts how often it fired'),
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
    async ({ path, scene, input, watch, frames, every, until, signals, summary, expect, timeout_seconds }) => {
      try {
        const claims = (expect ?? []).map(parseExpectation);
        const watched = [...new Set([...(watch ?? []), ...sampledWatches(claims, signals)])];
        const report = await playScene(where(path), {
          godot: options.godot,
          ...(scene ? { scene } : {}),
          ...(input ? { input } : {}),
          ...(watched.length ? { watch: watched } : {}),
          ...(frames ? { frames } : {}),
          ...(summary ? { every: 1 } : every ? { every } : {}),
          ...(until ? { until } : {}),
          ...(signals?.length ? { signals } : {}),
          timeoutMs: (timeout_seconds ?? 300) * 1000,
        });
        const results = judgeClaims(claims, report, undefined, signals);
        const body = formatPlay(report, { summary: summary === true }) + formatClaims(results);
        return !report.finished ||
          report.diagnostics.some((d) => d.severity === "error") ||
          results.some((r) => !r.ok)
          ? failure(body)
          : text(body);
      } catch (error) {
        if (error instanceof GodotNotFoundError)
          return failure(
            `${error.message}\nUse godot_review for checks without Godot.`,
          );
        if (error instanceof PlayError || error instanceof ProjectNotFoundError || error instanceof ScenarioError)
          return failure(error.message);
        throw error;
      }
    },
  );

  tool(
    "godot_scenario",
    {
      title: "Keep and run scenario tests",
      description:
        "Scenarios are regression tests kept in the project (.godotwright/scenarios/<name>.json) that godotwright ci runs: a scene, an input timeline and claims about what the game did, run headless in Godot 4.7 and deterministic. op `save` takes the arguments of a godot_play run (scene, input, watch, frames, until, signals, expect: at least one claim), runs it once more and writes it only when every claim holds (undo with godot_undo); `overwrite` replaces one. op `list` shows each scenario and its claims; op `run` runs all, or the one called `name` (else those whose name contains it), and returns PASS per scenario and every failing claim with the value the game had and the frame. An error result when a run fails or Godot is missing. After godot_play with `expect` proves a fix, save it so the next change cannot break it unnoticed.",
      inputSchema: {
        path: pathParam,
        op: z.enum(["list", "run", "save"]).describe("list, run or save"),
        name: z.string().optional().describe("save: the new scenario's name (letters, digits, _ or -); run and list: which ones (default all)"),
        scene: z.string().optional().describe("save: the res:// scene (default: the main scene)"),
        input: z.string().optional().describe('save: timeline, "10 tap jump; 40 hold right 20"'),
        watch: z.array(z.string()).optional().describe("save: extra values to sample"),
        frames: z.number().int().min(1).max(100_000).optional().describe("save: physics frames to run"),
        until: z.string().optional().describe("save: stop when this holds; the scenario fails when it never does"),
        signals: z.array(z.string()).optional().describe('save: signals to record, "Hero.landed"'),
        expect: z.array(z.string()).optional().describe('save: claims, "Hero.velocity.y == -400 @ 10", "Hero.landed >= 1"'),
        overwrite: z.boolean().optional().describe("save: replace a scenario with that name"),
        timeout_seconds: z.number().int().min(10).max(3600).optional().describe("timeout of each run (default 300)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path, op, name, scene, input, watch, frames, until, signals, expect, overwrite, timeout_seconds }) => {
      const run = { godot: options.godot, timeoutMs: (timeout_seconds ?? 300) * 1000 };
      try {
        if (op === "save") {
          if (!name) return failure("save needs name");
          const { result, file } = await saveScenario(where(path), scenarioData(name, { scene, input, watch, frames, until, signals, expect }), { ...run, overwrite });
          const body = formatScenarios([result]);
          return file ? text(`${body}saved ${file}\n`) : failure(`${body}not saved: fix the claims or the game, then save again\n`);
        }
        const { root, scenarios } = loadScenarios(where(path));
        const chosen = pickScenarios(scenarios, name);
        if (op === "list") return text(formatScenarioList(chosen));
        if (!chosen.length) return failure(`no scenarios${name ? ` matching "${name}"` : ""} in .godotwright/scenarios; make one with op save`);
        const results = [];
        for (const { file, scenario } of chosen) results.push(await runScenario(root, file, scenario, run));
        const body = formatScenarios(results, { brief: true });
        return results.every((r) => r.ok) ? text(body) : failure(body);
      } catch (error) {
        if (error instanceof GodotNotFoundError) return failure(`${error.message}\nUse godot_review for checks without Godot.`);
        if (error instanceof PlayError || error instanceof ProjectNotFoundError || error instanceof ScenarioError) return failure(error.message);
        throw error;
      }
    },
  );

  tool(
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
      outputSchema: TestOutput,
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
        return result(formatTests(report), testData(report, testsPassed(report), profile.findings));
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

  tool(
    "godot_feedback",
    {
      title: "Feedback on a review finding",
      description:
        "Tell Godotwright that a godot_review finding was wrong (a false alarm you verified) or right, or whether a lesson from godot_lessons helped. Pass `finding` (the line as godot_review printed it) or `lesson` (its id), not both. A finding marked wrong is hidden in later reviews on this machine, and a rule marked wrong far more often than right is reported one level lower; a lesson marked right ranks higher, wrong lower. Only use it after checking the code (godot_api, godot_check); fix real findings instead. It writes only to the local learning file (`godotwright learn reset` forgets it). An error when the line is not a finding, the lesson does not exist, or learning is off.",
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

  tool(
    "godot_lessons",
    {
      title: "Lessons from real Godot projects",
      description:
        `Answer from lessons learned in real Godot 4 projects and on this machine: what went wrong, why, the fix and how to test it. Find them by \`query\` (words such as 'helicopter slides off moving ship', or a lesson id), \`error\` (a Godot message as printed), \`rule\` (a review or model rule), or narrow by \`topic\` (${LESSON_TOPICS.join(", ")}); with none of them it lists the lessons. \`gaps: true\` lists the Godot errors seen here (and by other installs) that no rule predicts and no lesson explains yet. Use it when Godot shows an error you do not understand, and before you build moving platforms, vehicles, ships, large worlds, runtime-loaded models, shaders or headless tests. \`detail\` brief gives title and fix; full adds symptom, cause, test, rules and the message. Lessons learned here are marked. It counts shown lessons in the local learning file (GODOTWRIGHT_LEARN=0 turns that off); say whether one helped with godot_feedback (\`lesson\`).`,
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

  tool(
    "godot_lesson_add",
    {
      title: "Keep a lesson learned here",
      description:
        "Keep a lesson learned in this project, so the next session knows it: when the same Godot message or question comes back, godot_check and godot_lessons show your fix. Write it in general words: `title` in one line, `fix` what to do; add `symptom`, `cause`, `error` (the Godot message as printed), `topic`, `tags`, `rules` and `test` when you can. Project names, paths, links, e-mail addresses, codes, keys and source code are replaced before anything is stored; a lesson that is mostly names is refused with what to change. The same title again updates that lesson. It writes only to the local learning file and is never sent. Add one whenever a fix took more than one try, not for what a review rule already reports. Returns the stored lesson and what was replaced; an error when it is refused or learning is off.",
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

  tool(
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

  tool(
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

  tool(
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

  tool(
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

  tool(
    "godot_model_build",
    {
      title: "Build a 3D model from code",
      description:
        "Build a clean .glb (UVs, tangents, one node per part, same bytes every time) from a ready-made `kind` (with `params`), a model `spec` or a `spec_file`, write it to `out` (replaced if it exists) and lint it. If the spec or kind has an \"archetype\", the result is also checked against what that thing should be. Pass `collision`: most models need one. `contract_out` also writes a model.contract.json that godot_model_lint can hold later versions to. Returns the size, triangle and node count, then the lint report; an error result when the lint finds errors, though the file is still written. Call godot_model_identify first and godot_model_spec for the format; to check a .glb not built here, use godot_model_lint.",
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

  tool(
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

  tool(
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

  tool(
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

function guard<T>(fn: () => T): T | ReturnType<typeof failure> {
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

/** "; upgrade 4.5 -> 4.7" when the review looked at an upgrade. */
function upgradeNote(report: ReviewReport): string {
  return report.upgrade?.from ? `; upgrade ${report.upgrade.from} -> ${report.upgrade.target}` : "";
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
    `AAA review: ${report.project} (Godot ${report.godot}) overall ${report.overall}/100${upgradeNote(report)}`,
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
