import { z } from "zod";
import { closest } from "../api/api.js";
import { TOOLSET_NAMES, TOOLSETS } from "./toolsets.js";

/**
 * Lean mode (`godotwright mcp --lean`): the server offers two tools instead of all of them. Every tool definition is
 * sent to the model on every turn, so the full list costs about 22,000 tokens before the agent has done anything, and
 * some clients stop at 40 tools. In lean mode the list is a short catalogue inside one tool (`godot`, which runs any
 * tool by name) and the parameters of a tool are read when they are needed (`godot_help`). The tools themselves, their
 * checks, the read-only refusals and the results are the same.
 */

export interface LeanTool {
  name: string;
  title: string;
  description: string;
  shape: Record<string, z.ZodType>;
  run: (args: Record<string, unknown>, extra: never) => Promise<unknown>;
}

export const LEAN_TOOLS = ["godot", "godot_help"] as const;

const short = (name: string) => name.replace(/^godot_/, "");

/** The tool a name means: with or without the `godot_` prefix, in any case, dashes or spaces for underscores. */
export function findTool(tools: ReadonlyMap<string, LeanTool>, name: string): LeanTool | undefined {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return tools.get(key) ?? tools.get(`godot_${key}`);
}

/** What to say for a name that is no tool: the nearest names, then how to list them all. */
export function unknownTool(tools: ReadonlyMap<string, LeanTool>, name: string): string {
  const near = closest(short(name.trim().toLowerCase()), [...tools.keys()].map(short), 4);
  return `no tool "${name}"${near.length ? `; did you mean ${near.join(", ")}?` : ""} Call godot_help without arguments for the list.`;
}

/** One line per tool, grouped by set: the name to pass to `godot`, and what the tool is for. */
export function catalogue(tools: ReadonlyMap<string, LeanTool>): string {
  const out: string[] = [];
  for (const set of TOOLSET_NAMES) {
    const here = TOOLSETS[set].filter((name) => tools.has(name));
    if (!here.length) continue;
    out.push(`${set}: ${here.map((name) => `${short(name)} (${tools.get(name)!.title})`).join("; ")}`);
  }
  return out.join("\n");
}

type Json = { type?: string | string[]; enum?: unknown[]; items?: Json; anyOf?: Json[]; description?: string; properties?: Record<string, Json>; required?: string[]; minimum?: number; maximum?: number; default?: unknown };

function typeText(s: Json | undefined): string {
  if (!s) return "any";
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.anyOf) return [...new Set(s.anyOf.map(typeText))].join(" | ");
  const type = Array.isArray(s.type) ? s.type.join(" | ") : s.type;
  if (type === "array") return `${typeText(s.items)}[]`;
  if (type === "object" && s.properties) return `{${Object.entries(s.properties).map(([k, v]) => `${k}${s.required?.includes(k) ? "" : "?"}: ${typeText(v)}`).join(", ")}}`;
  return type ?? "any";
}

/** The parameters of a tool, one per line: name, `?` when optional, its type and what it is for. */
export function parameters(tool: LeanTool): string[] {
  const schema = z.toJSONSchema(z.object(tool.shape), { io: "input", unrepresentable: "any" }) as Json;
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, prop]) => `  ${name}${required.has(name) ? "" : "?"}: ${typeText(prop)}${prop.description ? `  ${prop.description}` : ""}`);
}

/** Everything about one tool: what it does, its parameters, and the call. */
export function describeTool(tool: LeanTool): string {
  const params = parameters(tool);
  return [`${tool.name}: ${tool.title}`, tool.description, params.length ? "Parameters (? = optional):" : "No parameters.", ...params, `Call it: godot {"tool": "${short(tool.name)}", "args": {...}}`].join("\n");
}

/** The tools that match the words best: name first, then title, then description. */
export function searchTools(tools: ReadonlyMap<string, LeanTool>, query: string, limit = 5): LeanTool[] {
  const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 1);
  const scored = [...tools.values()].map((tool) => {
    const name = tool.name.toLowerCase();
    const title = tool.title.toLowerCase();
    const text = tool.description.toLowerCase();
    let score = 0;
    for (const w of words) score += (name.includes(w) ? 6 : 0) + (title.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0);
    return { tool, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.tool);
}

/** The first sentence of a description, for a search result. */
const firstSentence = (text: string) => {
  const end = text.search(/[.:](\s|$)/);
  return end > 0 && end < 220 ? text.slice(0, end + 1) : `${text.slice(0, 200)}...`;
};

/** The answer of `godot_help`: one tool in full, the best matches for words, or the whole catalogue. */
export function help(tools: ReadonlyMap<string, LeanTool>, input: { tool?: string; query?: string }): { text: string; ok: boolean } {
  if (input.tool) {
    const tool = findTool(tools, input.tool);
    return tool ? { ok: true, text: describeTool(tool) } : { ok: false, text: unknownTool(tools, input.tool) };
  }
  if (input.query) {
    const hits = searchTools(tools, input.query);
    if (!hits.length) return { ok: true, text: `no tool matches "${input.query}". All tools:\n${catalogue(tools)}` };
    // The best match in full (it is usually the one), the others as one line.
    return { ok: true, text: [describeTool(hits[0]!), ...(hits.length > 1 ? ["", "Also:"] : []), ...hits.slice(1).map((t) => `  ${short(t.name)}: ${firstSentence(t.description)}`)].join("\n") };
  }
  return { ok: true, text: `${tools.size} tools, by set (godot_help {"tool": name} gives the parameters):\n${catalogue(tools)}` };
}

/**
 * Checks the arguments of a call against the tool's parameters, as the full server does, but strictly: a name the
 * tool does not have is an error here, because the model has not seen the parameters and a dropped argument would
 * silently change what the call does.
 */
export function checkArgs(tool: LeanTool, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; message: string } {
  let value = args ?? {};
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ok: false, message: `${tool.name}: args must be an object, e.g. {"tool": "${short(tool.name)}", "args": {...}}\nParameters (? = optional):\n${parameters(tool).join("\n")}` };
    }
  }
  const parsed = z.strictObject(tool.shape).safeParse(value);
  if (parsed.success) return { ok: true, args: parsed.data as Record<string, unknown> };
  const issues = parsed.error.issues.map((i) => {
    if (i.code === "unrecognized_keys") return `no parameter ${(i as { keys: string[] }).keys.join(", ")}`;
    return `${i.path.join(".") || "args"}: ${i.message}`;
  });
  return { ok: false, message: `${tool.name}: ${issues.join("; ")}\nParameters (? = optional):\n${parameters(tool).join("\n")}` };
}

/** What a lean server tells the model first, before the usual instructions (which name the tools as `godot_...`). */
export const LEAN_NOTE =
  'This server runs lean: its tools are not in your tool list. Run any tool named below with `godot`, e.g. godot {"tool": "review", "args": {"files": ["res://player.gd"]}} (the name with or without godot_). Before the first call of a tool, read its parameters with godot_help {"tool": "review"}; godot_help {"query": "words"} finds a tool.';
