#!/usr/bin/env node
/**
 * Grades benchmark projects with real Godot (needs $GODOT and `npm run build`).
 *
 *   node bench/grade.mjs --validate          base projects must fail, reference solutions must pass
 *   node bench/grade.mjs --runs <dir>        grade agent runs in <dir>/<label>/<task>/project
 *
 * A project passes a task when its Godot behavior test passes (bench/tasks/<task>/test.gd).
 * It also records Godot errors (godotwright check) and Godotwright review numbers.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProject, reviewProject } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TASKS_DIR = join(HERE, "tasks");
export const BASE_PROJECT = join(HERE, "..", "test", "fixtures", "demo");

export const tasks = () => readdirSync(TASKS_DIR).filter((t) => existsSync(join(TASKS_DIR, t, "test.gd"))).sort();

/** Copies the base project plus the task's starting files (and optionally its solution). */
export function makeProject(task, dir, withSolution = false) {
  cpSync(BASE_PROJECT, dir, { recursive: true });
  const files = join(TASKS_DIR, task, "files");
  if (existsSync(files)) cpSync(files, dir, { recursive: true });
  if (withSolution) cpSync(join(TASKS_DIR, task, "solution"), dir, { recursive: true });
  return dir;
}

function godot(args, cwd, timeout) {
  const result = spawnSync(process.env.GODOT, ["--headless", ...args], { cwd, encoding: "utf8", timeout });
  return { code: result.status, out: `${result.stdout ?? ""}\n${result.stderr ?? ""}`, timedOut: result.error?.code === "ETIMEDOUT" };
}

export async function grade(task, source) {
  const dir = mkdtempSync(join(tmpdir(), `bench-${task}-`));
  cpSync(source, dir, { recursive: true, filter: (p) => !p.includes(`${"/"}.godot`) });
  const benchDir = join(dir, ".godot", "bench");
  mkdirSync(benchDir, { recursive: true });
  cpSync(join(HERE, "harness.gd"), join(benchDir, "harness.gd"));
  cpSync(join(TASKS_DIR, task, "test.gd"), join(benchDir, "test.gd"));

  godot(["--path", dir, "--import"], dir, 300_000);
  const run = godot(["--path", dir, "--script", "res://.godot/bench/test.gd"], dir, 120_000);
  const checks = [...run.out.matchAll(/^BENCH_(PASS|FAIL) (.*)$/gm)].map((m) => ({ pass: m[1] === "PASS", name: m[2] }));
  const done = /^BENCH_DONE (\d+) (\d+)$/m.exec(run.out);
  const passed = checks.filter((c) => c.pass).length;

  let godotErrors = null;
  let godotErrorLines = [];
  try {
    const check = await checkProject(dir, { godot: process.env.GODOT, import: false, runFrames: 60, timeoutMs: 120_000 });
    godotErrors = check.errors;
    godotErrorLines = check.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.file ?? ""}${d.line ? `:${d.line}` : ""} ${d.message}`);
  } catch (error) {
    godotErrorLines = [String(error)];
  }
  let review = null;
  try {
    const r = reviewProject(dir);
    review = { overall: r.overall, apiErrors: r.categories.find((c) => c.category === "api").errors, errors: r.findings.filter((f) => f.severity === "error").length };
  } catch (error) {
    review = { error: String(error) };
  }
  rmSync(dir, { recursive: true, force: true });
  return {
    task,
    pass: Boolean(done) && checks.length > 0 && passed === checks.length,
    passed,
    total: checks.length,
    finished: Boolean(done),
    checks,
    godotErrors,
    godotErrorLines: godotErrorLines.slice(0, 10),
    review,
    log: done ? undefined : run.out.split("\n").slice(-15).join("\n"),
  };
}

async function validate() {
  let ok = true;
  for (const task of tasks()) {
    const base = await grade(task, makeProject(task, mkdtempSync(join(tmpdir(), "base-"))));
    const solved = await grade(task, makeProject(task, mkdtempSync(join(tmpdir(), "solution-")), true));
    const good = !base.pass && solved.pass && solved.godotErrors === 0;
    ok &&= good;
    console.log(`${good ? "OK  " : "BAD "} ${task}: base ${base.passed}/${base.total}, solution ${solved.passed}/${solved.total}, solution godot errors ${solved.godotErrors}`);
    for (const c of solved.checks.filter((x) => !x.pass)) console.log(`       solution FAIL ${c.name}`);
    for (const line of solved.godotErrorLines) console.log(`       solution error ${line}`);
    if (!solved.finished) console.log(`       solution log:\n${solved.log}`);
    if (!base.finished) console.log(`       base did not finish:\n${base.log}`);
  }
  process.exitCode = ok ? 0 : 1;
}

async function gradeRuns(root) {
  const results = [];
  for (const label of readdirSync(root).sort()) {
    const labelDir = join(root, label);
    for (const task of readdirSync(labelDir).sort()) {
      const project = join(labelDir, task, "project");
      if (!existsSync(project)) continue;
      const result = { label, ...(await grade(task, project)) };
      results.push(result);
      console.log(`${result.pass ? "PASS" : "FAIL"} ${label} ${task} ${result.passed}/${result.total} godot errors ${result.godotErrors}`);
      for (const c of result.checks.filter((x) => !x.pass)) console.log(`     FAIL ${c.name}`);
    }
  }
  const out = join(root, "grades.json");
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.GODOT) {
    console.error("Set $GODOT to a Godot 4.7 binary.");
    process.exit(2);
  }
  const args = process.argv.slice(2);
  if (args[0] === "--validate") await validate();
  else if (args[0] === "--runs" && args[1]) await gradeRuns(args[1]);
  else {
    console.error("usage: node bench/grade.mjs --validate | --runs <dir>");
    process.exit(2);
  }
}
