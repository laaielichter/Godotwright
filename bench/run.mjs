#!/usr/bin/env node
/**
 * Runs Claude Code on every benchmark task, with and without Godotwright.
 *
 *   node bench/run.mjs --model claude-haiku-5-5 [--tier cheap] [--tasks a,b] [--modes without,with]
 *                      [--reps 3] [--out bench/runs] [--jobs 4] [--max-turns 40]
 *
 * Both modes get the same prompt and the same file tools (Read, Write, Edit, Glob, Grep).
 * "with" adds the Godotwright MCP server; nothing else differs. Only files the agent
 * changed are kept, in <out>/<model>-<mode>/<task>/files, plus run.json with metrics.
 * Grade the results with real Godot: node bench/grade.mjs --runs <out>
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_PROJECT, makeProject, TASKS_DIR, tasks as allTasks } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "dist", "cli.js");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((pair) => {
      const [key, ...value] = pair.split(/\s+/);
      return [key, value.join(" ")];
    }),
);
const model = args.model || "claude-haiku-5-5";
const tier = args.tier || "cheap";
const modes = (args.modes || "without,with").split(",");
const taskList = args.tasks ? args.tasks.split(",") : allTasks();
const out = args.out || join(HERE, "runs");
const jobs = Number(args.jobs || 4);
const maxTurns = Number(args["max-turns"] || 40);
const reps = Number(args.reps || 1);

const FILE_TOOLS = ["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep"];
const BLOCKED = ["Bash", "Skill", "Task", "Agent", "WebFetch", "WebSearch", "NotebookEdit", "TodoWrite"];

function prompt(task) {
  return [
    "You are working on a Godot 4.7 game project in the current directory.",
    "",
    readFileSync(join(TASKS_DIR, task, "task.md"), "utf8").trim(),
    "",
    "Edit the project files directly. Godot is not installed here, so you cannot run the game.",
    "When you are done, reply with one short line that says what you changed.",
  ].join("\n");
}

function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === ".godot" || name === ".claude") return [];
    return statSync(full).isDirectory() ? listFiles(full, base) : [relative(base, full)];
  });
}

/** Copies files the agent added or changed into `dest`; returns their paths and the deleted ones. */
function keepChanges(task, workDir, dest) {
  const base = makeProject(task, mkdtempSync(join(tmpdir(), "bench-base-")));
  const before = new Set(listFiles(base));
  const changed = [];
  for (const file of listFiles(workDir)) {
    const now = readFileSync(join(workDir, file));
    if (before.has(file) && Buffer.compare(now, readFileSync(join(base, file))) === 0) continue;
    mkdirSync(dirname(join(dest, file)), { recursive: true });
    cpSync(join(workDir, file), join(dest, file));
    changed.push(file);
  }
  const deleted = [...before].filter((f) => !existsSync(join(workDir, f)));
  rmSync(base, { recursive: true, force: true });
  return { changed, deleted };
}

function runAgent(task, mode, rep) {
  const label = `${model}-${mode}${reps > 1 ? `-r${rep}` : ""}`;
  const taskOut = join(out, label, task);
  rmSync(taskOut, { recursive: true, force: true });
  mkdirSync(taskOut, { recursive: true });
  const work = makeProject(task, mkdtempSync(join(tmpdir(), `agent-${task}-`)));

  const mcpConfig = join(mkdtempSync(join(tmpdir(), "bench-mcp-")), "mcp.json");
  const servers = mode === "with" ? { godotwright: { command: process.execPath, args: [CLI, "mcp", "--tier", tier] } } : {};
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: servers }));
  const allowed = [...FILE_TOOLS, ...(mode === "with" ? ["mcp__godotwright"] : [])];

  const cliArgs = [
    "-p",
    prompt(task),
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(maxTurns),
    "--permission-mode",
    "acceptEdits",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    "--allowedTools",
    allowed.join(","),
    "--disallowedTools",
    BLOCKED.join(","),
    "--no-session-persistence",
  ];
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("claude", cliArgs, { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const events = stdout
        .split("\n")
        .filter((l) => l.trim().startsWith("{"))
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return undefined;
          }
        })
        .filter(Boolean);
      const final = events.filter((e) => e.type === "result").pop() ?? {};
      const toolCalls = {};
      for (const e of events) {
        if (e.type !== "assistant") continue;
        for (const part of e.message?.content ?? []) {
          if (part.type === "tool_use") toolCalls[part.name] = (toolCalls[part.name] ?? 0) + 1;
        }
      }
      const { changed, deleted } = keepChanges(task, work, join(taskOut, "files"));
      const run = {
        task,
        mode,
        model,
        tier: mode === "with" ? tier : null,
        exitCode: code,
        seconds: Math.round((Date.now() - started) / 1000),
        turns: final.num_turns ?? null,
        costUsd: final.total_cost_usd ?? null,
        isError: final.is_error ?? code !== 0,
        result: typeof final.result === "string" ? final.result.slice(0, 500) : null,
        toolCalls,
        changed,
        deleted,
        stderr: stderr.trim().slice(-500) || undefined,
      };
      writeFileSync(join(taskOut, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
      rmSync(work, { recursive: true, force: true });
      console.log(`${label} ${task}: ${run.seconds}s, ${run.turns} turns, $${run.costUsd?.toFixed?.(3) ?? "?"}, changed ${changed.length} files, tools ${JSON.stringify(toolCalls)}`);
      resolve(run);
    });
  });
}

if (!existsSync(CLI)) {
  console.error("Run `npm run build` first.");
  process.exit(2);
}
const queue = [];
for (let rep = 1; rep <= reps; rep++) for (const mode of modes) for (const task of taskList) queue.push([task, mode, rep]);
const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const [task, mode, rep] = queue.shift();
    await runAgent(task, mode, rep);
  }
});
console.log(`base project: ${BASE_PROJECT}`);
await Promise.all(workers);
