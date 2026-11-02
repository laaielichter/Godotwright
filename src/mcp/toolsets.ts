/**
 * Tool sets and the read-only policy of the MCP server. Each tool is in exactly one set, so a client can load only
 * what it needs (`godotwright mcp --tools core,run`), which keeps the tool list it pays for in every turn small.
 */

export const TOOLSETS = {
  core: [
    "godot_scan",
    "godot_api",
    "godot_api_search",
    "godot_review",
    "godot_check",
    "godot_doctor",
    "godot_fix",
    "godot_usages",
    "godot_lessons",
    "godot_feedback",
    "godot_undo",
    "godot_checklist",
  ],
  edit: [
    "godot_rename",
    "godot_scene_edit",
    "godot_project_edit",
    "godot_resource_edit",
    "godot_migrate",
    "godot_shader",
    "godot_lesson_add",
  ],
  run: ["godot_test", "godot_play", "godot_scenario", "godot_perf", "godot_leaks", "godot_screenshot"],
  game: ["godot_session", "godot_game"],
  export: ["godot_export", "godot_export_run", "godot_deps"],
  model: [
    "godot_model_brief",
    "godot_model_identify",
    "godot_model_spec",
    "godot_model_build",
    "godot_model_view",
    "godot_model_lint",
    "godot_model_inspect",
  ],
} as const satisfies Record<string, readonly string[]>;

export type Toolset = keyof typeof TOOLSETS;
export const TOOLSET_NAMES = Object.keys(TOOLSETS) as Toolset[];
export const ALL_TOOLS: readonly string[] = TOOLSET_NAMES.flatMap((s) => TOOLSETS[s]);

export class ToolsetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolsetError";
  }
}

/**
 * The tools a `--tools` list enables: set names (core, edit, run, game, export, model, all) and single tool names
 * (`godot_play`), separated by commas or spaces. Empty or unset means all. Unknown names throw, naming the valid ones.
 */
export function enabledTools(list?: string | readonly string[]): Set<string> {
  const items = (typeof list === "string" ? list.split(/[\s,]+/) : (list ?? [])).map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return new Set(ALL_TOOLS);
  const out = new Set<string>();
  for (const item of items) {
    if (item === "all") for (const tool of ALL_TOOLS) out.add(tool);
    else if (Object.hasOwn(TOOLSETS, item)) for (const tool of TOOLSETS[item as Toolset]) out.add(tool);
    else if (ALL_TOOLS.includes(item)) out.add(item);
    else if (ALL_TOOLS.includes(`godot_${item}`)) out.add(`godot_${item}`);
    else throw new ToolsetError(`unknown tool set or tool "${item}"; use ${TOOLSET_NAMES.join(", ")}, all, or tool names such as godot_play`);
  }
  return out;
}

/** Tools a read-only server leaves out: they always change project files. */
export const WRITE_ONLY_TOOLS: readonly string[] = ["godot_undo", "godot_model_build", "godot_export_run"];

const DRY_RUN_TOOLS = new Set(["godot_fix", "godot_rename", "godot_scene_edit", "godot_project_edit", "godot_resource_edit", "godot_migrate"]);

/**
 * Why a read-only server refuses this call, or undefined when it may run. Edit tools still show their dry run;
 * only the options that write are refused.
 */
export function readOnlyRefusal(tool: string, args: Record<string, unknown>): string | undefined {
  const no = (what: string) => `read-only session: ${tool} ${what} is refused (the server was started with --read-only).`;
  if (WRITE_ONLY_TOOLS.includes(tool)) return no("writes files and");
  if (DRY_RUN_TOOLS.has(tool) && args["write"] === true) return no("with write: true") + " Leave write out to see the changes.";
  if (tool === "godot_scenario" && args["op"] === "save") return no("op save");
  if (tool === "godot_game" && ["set", "call", "eval"].includes(String(args["op"]))) return no(`op ${String(args["op"])}`);
  if (tool === "godot_screenshot" && (args["model"] !== undefined || args["baseline"] !== undefined))
    return no("with model or baseline (it writes the picture into the project)");
  return undefined;
}

/** Reads a boolean switch such as GODOTWRIGHT_READ_ONLY: 1, true, yes or on. */
export function envFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}
