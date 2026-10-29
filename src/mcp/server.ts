import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chooseArchetype } from "../archetype/check.js";
import { briefFor } from "../archetype/brief.js";
import { formatChecked, formatIdentify } from "../archetype/format.js";
import { identify } from "../archetype/identify.js";
import { loadLibrary } from "../archetype/library.js";
import { GodotApi } from "../api/api.js";
import { formatLookup, formatSearch } from "../api/format.js";
import { checkLearning, lookupLearning, reviewLearning } from "../learn/hooks.js";
import { parseFindingLine, recordFeedback } from "../learn/learn.js";
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
import { findProjectRoot } from "../project/files.js";
import { formatFinding } from "../review/format.js";
import type { ReviewReport } from "../review/review.js";
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
      "1. Call godot_scan once to learn the scenes, scripts, signals and input actions.",
      "2. Before you use an engine class, method, property or signal you are not sure about, call godot_api. Never guess API names; Godot 3 names do not work in Godot 4.",
      "3. Before you save new GDScript, pass it to godot_review (code + file) and fix every error.",
      "4. After every edit, call godot_review with the changed files. Fix all errors before the next step.",
      "5. If Godot is installed, call godot_check before you finish.",
      "6. If you verified that a review finding is a false alarm, pass its line to godot_feedback with verdict wrong.",
      "Keep each change small. Use static types (var x: int, func f() -> void).",
      "To make or check a 3D model (.glb): 0) godot_model_brief gives one page with everything to start (use it first if you are a small model). 1) godot_model_identify says what the thing is: its parts, size, pivots and what to anticipate. 2) godot_model_spec shows the spec format. 3) godot_model_build builds it (put \"archetype\" in the spec). 4) godot_model_view shows it as text (front, side, top views and what does not touch) so you can check the shape. 5) godot_model_lint with archetype checks it. Fix every error. Models face +Z, +Y is up, units are metres.",
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
      "- godot_feedback marks a review finding as wrong (a verified false alarm) or right; Godotwright learns from it on this machine.",
      "- godot_model_brief is one page before you build: what the thing is, the nearest ready-made kind, parts, size, rules, mistakes, the order of tools and a spec cheat sheet. Start here.",
      "- godot_model_identify says what a thing is (English or Dutch, typos and descriptions work): the family, the parts that must exist and how they move, a typical size with its source, variants, Godot conventions (models face +Z, +Y is up, units are metres), what to anticipate and the usual mistakes. Call it before you build or check any 3D model.",
      "- godot_model_spec explains the model spec (a JSON tree of named parts: box, cylinder, ellipsoid, lathe, loft, extrude, roof, with expressions, mirror and repeat) and lists the ready-made kinds.",
      "- godot_model_build makes a clean .glb from a kind or a spec (UVs, tangents, a node per part, deterministic) and lints it.",
      "- godot_model_view draws a .glb as text: front, side and top views made of letters (one letter per part), a table of the parts with sizes, and the parts that do not touch the rest (a ladder away from its tree, a wheel without an axle). You cannot see a picture, so use it after every build to check shape, proportions and that everything is attached.",
      "- godot_model_lint scores a .glb (geometry, materials, performance, rig), and with `archetype` also checks it is what it should be: parts, pivots, wheel axes, size, direction. godot_model_inspect shows what is in a .glb.",
      "Work in reviewed steps: plan, look up the API, write, review, then check with Godot before you finish. For models: identify, spec, build, view, lint with the archetype, fix, repeat.",
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
    async ({ path, detail }) => guard(() => text(formatProjectMap(scanProject(where(path), { base: options.base, baseFiles: options.baseFiles }), detail ?? profile.detail))),
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
        const { result, hints } = lookupLearning(api, query);
        const out = formatLookup(api, result, detail ?? profile.detail, hints);
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
        const report = reviewLearning(where(path), { base: options.base, baseFiles: options.baseFiles, overrides: code !== undefined && target ? { [target]: code } : undefined });
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
        const result = await checkLearning(where(path), {
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
    "godot_feedback",
    {
      title: "Feedback on a review finding",
      description:
        "Tell Godotwright that a godot_review finding was wrong (a false alarm you verified) or right. Pass the finding line exactly as godot_review printed it. Wrong findings are hidden in later reviews on this machine, and Godotwright learns which rules to trust.",
      inputSchema: {
        finding: z.string().describe("the finding line, e.g. res://player.gd:12: error [api/unknown-member] ..."),
        verdict: z.enum(["wrong", "right"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ finding, verdict }) => {
      const parsed = parseFindingLine(finding);
      if (!parsed) return failure("Pass the finding line exactly as godot_review printed it.");
      recordFeedback(parsed, verdict);
      return text(verdict === "wrong" ? `Noted: ${parsed.rule} at ${parsed.file} is hidden from now on.` : `Noted: ${parsed.rule} was right.`);
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

  /** A path the tools may read or write: inside the project (or the root when there is no project). */
  const inside = (path: string): string => {
    const full = where(path);
    const root = findProjectRoot(base) ?? base;
    const rel = relative(root, full);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new ModelError(`${path} is outside the project (${root}); use a path inside it`);
    return full;
  };
  const fileParam = z.string().describe("Path to a .glb or .gltf file, inside the project.");
  const modelDetail = detailParam;

  server.registerTool(
    "godot_model_identify",
    {
      title: "What is this thing?",
      description:
        "Say what a thing is before you build or check a 3D model of it: its family, the parts a model needs (and which move, about which axis, with the pivot where), a typical size range with its source and a confidence class, variants, Godot conventions (+Y up, front faces +Z), what to anticipate and the usual mistakes. Works from a name in English or Dutch (plurals, typos, compounds like 'vrachtauto') or a description ('something with wheels and an engine'). A word that means two things is reported as ambiguous; something unknown gets the nearest family, marked generic.",
      inputSchema: { text: z.string().describe("what you want to make or check, e.g. 'a tractor', 'helikopter', 'wind turbine'") },
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
        "One page to read before building a 3D model, made for small models: what the thing is, the ready-made kind to start from (with its build command), the parts to name your nodes after, typical size, rules, the usual mistakes, the order of tools to call, and a short spec cheat sheet. Replaces calling godot_model_identify and godot_model_spec separately when you just want to start.",
      inputSchema: { text: z.string().describe("what you want to make, e.g. 'a rowing boat', 'dragon', 'castle wall'") },
      annotations: readOnly,
    },
    async ({ text: query }) => guard(() => text(briefFor(query).text)),
  );

  server.registerTool(
    "godot_model_spec",
    {
      title: "Model spec format",
      description: "Explain the model spec: a JSON tree of named parts that godot_model_build turns into a .glb. Includes an example (a small car) and the ready-made kinds with their parameters.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const kinds = allKinds().map((g) => `${g.kind}: ${g.description} Parameters: ${g.params.map((p) => `${p.name}=${String(p.default)}`).join(", ")}`);
      return text(`${SPEC_HELP}\n${JSON.stringify(EXAMPLE_SPEC, null, 2)}\n\nReady-made kinds (godot_model_build with \`kind\`):\n${kinds.join("\n")}\n`);
    },
  );

  server.registerTool(
    "godot_model_build",
    {
      title: "Build a 3D model from code",
      description:
        "Build a clean .glb (UVs, tangents, one node per part, same bytes every time) from a ready-made `kind` or a model `spec`, write it to `out`, and lint it. If the spec has an \"archetype\" (or the kind has one), the result is also checked against what that thing should be. Call godot_model_identify first and godot_model_spec for the format.",
      inputSchema: {
        out: z.string().describe("where to write the .glb, inside the project, e.g. models/car.glb"),
        kind: z.string().optional().describe(`a ready-made kind: ${allKinds().map((k) => k.kind).join(", ")}`),
        spec: z.record(z.string(), z.unknown()).optional().describe("a full model spec as a JSON object"),
        spec_file: z.string().optional().describe("or a path to a spec JSON file inside the project"),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("parameter values, e.g. { width: 9, roof: 'hip' }"),
        contract_out: z.string().optional().describe("also write a model.contract.json here (inside the project)"),
        detail: modelDetail,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ out, kind, spec, spec_file, params, contract_out, detail }) =>
      guard(() => {
        if (!out.toLowerCase().endsWith(".glb")) return failure("`out` must end in .glb");
        if (contract_out && !contract_out.toLowerCase().endsWith(".json")) return failure("`contract_out` must end in .json");
        let source: unknown = spec;
        if (spec_file) {
          try {
            source = JSON.parse(readFileSync(inside(spec_file), "utf8"));
          } catch (error) {
            if (error instanceof ModelError) throw error;
            return failure(`${spec_file}: cannot read the spec (${(error as Error).message})`);
          }
        }
        const outcome = buildModel({ ...(kind ? { kind } : {}), ...(source === undefined ? {} : { spec: source }), ...(params ? { params } : {}), out: inside(out), ...(contract_out ? { contractOut: inside(contract_out) } : {}) });
        const errors = outcome.report.categories.reduce((n, c) => n + c.errors, 0);
        const body = `${outcome.summary}\n${formatModelReport(outcome.report, detail ?? profile.detail)}`;
        return errors > 0 ? failure(body) : text(body);
      }),
  );

  server.registerTool(
    "godot_model_lint",
    {
      title: "Review a 3D model",
      description:
        "Score a .glb or .gltf without Godot: flipped faces, open edges, missing normals, UVs or tangents, textures, node names, budgets. Pass `archetype` (a name such as 'car' or 'helikopter', or an id) to also check it is what it should be: required parts, pivots, wheel axes, size (unit mistakes), direction. Pass `contract` to hold it to a model.contract.json.",
      inputSchema: {
        file: fileParam,
        archetype: z.string().optional().describe("what the model should be, e.g. car, helikopter, vehicle.wheeled.car"),
        contract: z.string().optional().describe("a model.contract.json inside the project"),
        max_triangles: z.number().int().min(1).optional().describe("flag a model with more triangles than this"),
        detail: modelDetail,
      },
      annotations: readOnly,
    },
    async ({ file, archetype, contract, max_triangles, detail }) =>
      guard(() => {
        const choice = archetype === undefined ? undefined : chooseArchetype(archetype);
        const report = lintModelFile(inside(file), {
          ...(choice ? { archetype: choice.archetype } : {}),
          ...(contract ? { contract: loadContract(inside(contract)) } : {}),
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
        "Look at a .glb or .gltf without Godot or a picture: three views (front, side, top) drawn with letters, one letter per part, then a list of the parts with their sizes and heights, and which parts do not touch the rest of the model (a ladder away from its tree, a wheel without an axle, something floating). Use it after building to check the shape, proportions and that everything is attached.",
      inputSchema: {
        file: fileParam,
        only: z.enum(["front", "side", "top"]).optional().describe("show one view only"),
        width: z.number().int().min(20).max(120).optional().describe("width of the views in characters (default 48)"),
      },
      annotations: readOnly,
    },
    async ({ file, only, width }) => guard(() => text(viewModel(inspectModel(inside(file)), { ...(width ? { width } : {}), ...(only ? { only } : {}) }))),
  );

  server.registerTool(
    "godot_model_inspect",
    {
      title: "Inspect a 3D model",
      description: "Show what is in a .glb or .gltf: the node tree, triangles, materials, textures with a memory estimate, size and lowest point. No Godot needed.",
      inputSchema: { file: fileParam, detail: modelDetail },
      annotations: readOnly,
    },
    async ({ file, detail }) => guard(() => text(formatModelInfo(inspectModel(inside(file)), detail ?? profile.detail))),
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
  if (report.learning?.hidden) out.push(`${report.learning.hidden} ${report.learning.hidden === 1 ? "finding" : "findings"} hidden: marked as wrong earlier.`);
  if (report.learning?.downgraded.length) out.push(`Learned: ${report.learning.downgraded.join(", ")} shown as warnings; Godot did not confirm them.`);
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
