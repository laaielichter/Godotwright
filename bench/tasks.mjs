/** Shared helpers for the benchmark: task list and project setup. */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TASKS_DIR = join(HERE, "tasks");
export const BASE_PROJECT = join(HERE, "..", "test", "fixtures", "demo");

export const tasks = () => readdirSync(TASKS_DIR).filter((t) => existsSync(join(TASKS_DIR, t, "test.gd"))).sort();

/** Copies the base project plus the task's starting files (and optionally its reference solution). */
export function makeProject(task, dir, withSolution = false) {
  cpSync(BASE_PROJECT, dir, { recursive: true });
  const files = join(TASKS_DIR, task, "files");
  if (existsSync(files)) cpSync(files, dir, { recursive: true });
  if (withSolution) cpSync(join(TASKS_DIR, task, "solution"), dir, { recursive: true });
  return dir;
}

/** Rebuilds an agent's result: the task's starting project plus the files the agent changed. */
export function makeRunProject(task, runDir, dir) {
  makeProject(task, dir);
  const files = join(runDir, "files");
  if (existsSync(files)) cpSync(files, dir, { recursive: true });
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  for (const file of run.deleted ?? []) rmSync(join(dir, file), { force: true });
  return dir;
}
