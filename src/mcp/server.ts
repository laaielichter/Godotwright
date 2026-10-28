import { isAbsolute, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GodotApi } from "../api/api.js";
import { formatLookup, formatSearch } from "../api/format.js";
import { checkProject } from "../check/check.js";
import { GodotNotFoundError } from "../check/godot.js";
import { formatDiagnostic } from "../check/log.js";
import { findProjectRoot } from "../project/files.js";
import { formatFinding } from "../review/format.js";
import { reviewProject, type ReviewReport } from "../review/review.js";
import { CATEGORIES, RULES } from "../review/rules.js";
import { formatProjectMap, type Detail } from "../scan/format.js";
import { scanProject } from "../scan/scan.js";
import { GODOT_TARGET, VERSION } from "../version.js";

export type Tier = "cheap" | "premium";

export interface ServerOptions {
  /** Directory the tools work in when no path is given (default: the working directory). */
  root?: string;
  /** cheap: short output and strict step-by-step guidance. premium: full detail. */
  tier?: Tier;
  /** Godot binary for godot_check. */
  godot?: string;
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
      "1. Call godot_scan once to learn the scenes, scripts, signals and input actions.",
      "2. Before you use an engine class, method, property or signal you are not sure about, call godot_api. Never guess API names; Godot 3 names do not work in Godot 4.",
      "3. Before you save new GDScript, pass it to godot_review (code + file) and fix every error.",
      "4. After every edit, call godot_review with the changed files. Fix all errors before the next step.",
      "5. If Godot is installed, call godot_check before you finish.",
      "Keep each change small. Use static types (var x: int, func f() -> void).",
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
      "- godot_checklist lists every AAA rule with its fix.",
      "Work in reviewed steps: plan, look up the API, write, review, then check with Godot before you finish.",
    ].join("\n"),
  },
};

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failure = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: true });

export function createServer(options: ServerOptions = {}): McpServer {
  const tier: Tier = options.tier ?? "cheap";
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
    .describe(`Output detail (default for this ${tier} profile: ${profile.detail}).`);
  const pathParam = z.string().optional().describe("Project directory or a path inside it (default: the current project).");
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "godot_scan",
    {
      title: "Map the Godot project",
      description:
        "Map a Godot 4 project without running Godot: scenes with node trees, scripts with class_name, signals, functions and exports, autoloads, input actions, key settings, and broken references. Call this first.",
      inputSchema: { path: pathParam, detail: detailParam },
      annotations: readOnly,
    },
    async ({ path, detail }) => guard(() => text(formatProjectMap(scanProject(where(path)), detail ?? profile.detail))),
  );

  server.registerTool(
    "godot_api",
    {
      title: "Look up the Godot 4.7 API",
      description:
        "Exact lookup in the official Godot 4.7 class reference (offline): `Class`, `Class.member`, `Class.Enum.VALUE`, `@annotation` or a global function. Follows inheritance, gives the exact signature, and translates Godot 3 names. Use it before calling any engine API you are not sure about.",
      inputSchema: {
        query: z.string().describe("e.g. CharacterBody2D.move_and_slide, Node.ready, @export_range, lerp, Tween"),
        detail: detailParam,
      },
      annotations: readOnly,
    },
    async ({ query, detail }) =>
      guard(() => {
        const api = GodotApi.load();
        const result = api.lookup(query);
        const out = formatLookup(api, result, detail ?? profile.detail);
        return result.entries.length ? text(out) : failure(out);
      }),
  );

  server.registerTool(
    "godot_api_search",
    {
      title: "Search the Godot 4.7 API",
      description: "Search class, method, property and signal names, keywords and descriptions in the Godot 4.7 class reference, best matches first.",
      inputSchema: {
        query: z.string().describe("words, e.g. 'raycast 3d', 'change scene', 'is on floor'"),
        limit: z.number().int().min(1).max(50).optional().describe("max results (default 10)"),
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
        "Static AAA review of the project, no Godot needed: API correctness (Godot 3 code, unknown classes, functions, members, signals, wrong argument counts, missing input actions), performance, code quality and structure, with a 0-100 score per category. Pass `files` to list only findings in files you changed. Pass `code` and `file` to review GDScript before writing it to disk.",
      inputSchema: {
        path: pathParam,
        files: z.array(z.string()).optional().describe("only show findings in these res:// files"),
        code: z.string().optional().describe("unsaved GDScript to review in place of the file on disk"),
        file: z.string().optional().describe("res:// path the code belongs to (required with code)"),
        detail: detailParam,
      },
      annotations: readOnly,
    },
    async ({ path, files, code, file, detail }) =>
      guard(() => {
        if (code !== undefined && !file) return failure("Pass `file` (a res:// path) together with `code`.");
        const target = file && !file.startsWith("res://") ? `res://${file.replace(/^\/+/, "")}` : file;
        const report = reviewProject(where(path), { overrides: code !== undefined && target ? { [target]: code } : undefined });
        const focus = [...(files ?? []), ...(target ? [target] : [])].map((f) => (f.startsWith("res://") ? f : `res://${f.replace(/^\/+/, "")}`));
        return text(formatReviewFor(report, detail ?? profile.detail, profile, focus));
      }),
  );

  server.registerTool(
    "godot_check",
    {
      title: "Check with real Godot",
      description:
        "Run Godot 4.7 headless on the project: import, load and instantiate every script and scene, and optionally run the main scene. Reports engine errors as res://file:line. Needs Godot on this machine; slower than godot_review.",
      inputSchema: {
        path: pathParam,
        run_frames: z.number().int().min(0).max(10_000).optional().describe("also run the main scene for this many frames (default 0)"),
        timeout_seconds: z.number().int().min(10).max(3600).optional().describe("timeout per Godot run (default 600)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path, run_frames, timeout_seconds }) => {
      try {
        const result = await checkProject(where(path), {
          godot: options.godot,
          runFrames: run_frames ?? 0,
          timeoutMs: (timeout_seconds ?? 600) * 1000,
        });
        const lines = result.diagnostics.map(formatDiagnostic);
        lines.push(`${result.errors} errors, ${result.warnings} warnings (Godot ${result.godotVersion}, ${result.scripts} scripts, ${result.scenes} scenes)`);
        return result.errors > 0 ? failure(lines.join("\n")) : text(lines.join("\n"));
      } catch (error) {
        if (error instanceof GodotNotFoundError) {
          return failure(`${error.message}\nUse godot_review for checks without Godot.`);
        }
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    "godot_checklist",
    {
      title: "AAA checklist",
      description: "The fixed AAA checklist Godotwright reviews against: every rule per category with its fix.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => text(checklist(tier)),
  );

  return server;
}

function guard(fn: () => ReturnType<typeof text> | ReturnType<typeof failure>) {
  try {
    return fn();
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

function formatReviewFor(report: ReviewReport, detail: Detail, profile: Profile, focus: string[]): string {
  const out: string[] = [];
  out.push(`AAA review: ${report.project} (Godot ${report.godot}) overall ${report.overall}/100`);
  out.push(report.categories.map((c) => `${c.category} ${c.score}`).join(", ") + `; static typing ${report.typing.percent}%`);
  let list = report.findings;
  if (focus.length) list = list.filter((f) => focus.includes(f.file));
  if (!profile.infos && detail === "brief") list = list.filter((f) => f.severity !== "info");
  const shown = list.slice(0, profile.findings);
  const errors = list.filter((f) => f.severity === "error").length;
  out.push(`${focus.length ? `findings in ${focus.join(", ")}` : "findings"}: ${list.length} (${errors} errors)`);
  for (const f of shown) {
    out.push(formatFinding(f));
    if (detail === "full") out.push(`  fix: ${RULES[f.rule]?.fix ?? ""}`);
  }
  if (list.length > shown.length) out.push(`+${list.length - shown.length} more`);
  if (errors === 0 && focus.length) out.push("No errors in these files.");
  return `${out.join("\n")}\n`;
}

function checklist(tier: Tier): string {
  const out: string[] = [`AAA checklist (Godot ${GODOT_TARGET})`];
  for (const category of CATEGORIES) {
    out.push("", `${category}:`);
    for (const rule of Object.values(RULES).filter((r) => r.category === category)) {
      out.push(tier === "cheap" ? `- ${rule.title}: ${rule.fix}` : `- [${rule.id}] (${rule.severity}) ${rule.title}: ${rule.fix}`);
    }
  }
  return `${out.join("\n")}\n`;
}
