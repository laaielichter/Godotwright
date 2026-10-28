#!/usr/bin/env node
/**
 * Turns graded runs into a before/after table.
 *
 *   node bench/summarize.mjs <runs-dir>      reads grades.json and every run.json
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** "claude-haiku-5-5-with-r2" -> { model: "claude-haiku-5-5", mode: "with" } */
export function parseLabel(label) {
  const m = /^(.*)-(with|without)(?:-r\d+)?$/.exec(label);
  return m ? { model: m[1], mode: m[2] } : { model: label, mode: "?" };
}

export function loadRuns(root) {
  const runs = new Map();
  for (const label of readdirSync(root)) {
    const dir = join(root, label);
    if (!statSync(dir).isDirectory()) continue;
    for (const task of readdirSync(dir)) {
      const file = join(dir, task, "run.json");
      if (existsSync(file)) runs.set(`${label}/${task}`, JSON.parse(readFileSync(file, "utf8")));
    }
  }
  return runs;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => `${Math.round(100 * x)}%`;

export function summarize(grades, runs) {
  const groups = new Map();
  for (const g of grades) {
    const { model, mode } = parseLabel(g.label);
    const run = runs.get(`${g.label}/${g.task}`) ?? {};
    const key = `${model}|${mode}`;
    const list = groups.get(key) ?? [];
    list.push({ ...g, run });
    groups.set(key, list);
  }
  const rows = [];
  for (const [key, list] of [...groups].sort()) {
    const [model, mode] = key.split("|");
    const godotwrightCalls = list.map((x) => Object.entries(x.run.toolCalls ?? {}).filter(([k]) => k.startsWith("mcp__godotwright")).reduce((n, [, v]) => n + v, 0));
    rows.push({
      model,
      mode,
      runs: list.length,
      passRate: avg(list.map((x) => (x.pass ? 1 : 0))),
      checkRate: avg(list.map((x) => (x.total ? x.passed / x.total : 0))),
      cleanRate: avg(list.map((x) => (x.godotErrors === 0 ? 1 : 0))),
      godotErrors: avg(list.map((x) => x.godotErrors ?? 0)),
      reviewErrors: avg(list.map((x) => x.review?.errors ?? 0)),
      seconds: avg(list.map((x) => x.run.seconds ?? 0)),
      costUsd: avg(list.map((x) => x.run.costUsd ?? 0)),
      godotwrightCalls: avg(godotwrightCalls),
      perTask: Object.fromEntries(
        [...new Set(list.map((x) => x.task))].sort().map((task) => {
          const mine = list.filter((x) => x.task === task);
          return [task, `${mine.filter((x) => x.pass).length}/${mine.length}`];
        }),
      ),
    });
  }
  return rows;
}

export function table(rows) {
  const lines = [
    "| Model | Godotwright | Runs | Tasks passed | Checks passed | No Godot errors | Godot errors / run | Review errors / run | Godotwright calls / run | Time / run | Cost / run |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.model} | ${r.mode === "with" ? "yes" : "no"} | ${r.runs} | ${pct(r.passRate)} | ${pct(r.checkRate)} | ${pct(r.cleanRate)} | ${r.godotErrors.toFixed(2)} | ${r.reviewErrors.toFixed(2)} | ${r.godotwrightCalls.toFixed(1)} | ${Math.round(r.seconds)} s | $${r.costUsd.toFixed(3)} |`,
    );
  }
  const tasks = [...new Set(rows.flatMap((r) => Object.keys(r.perTask)))].sort();
  lines.push("", `| Model | Godotwright | ${tasks.join(" | ")} |`, `| --- | --- |${tasks.map(() => " ---: |").join("")}`);
  for (const r of rows) lines.push(`| ${r.model} | ${r.mode === "with" ? "yes" : "no"} | ${tasks.map((t) => r.perTask[t] ?? "-").join(" | ")} |`);
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  const grades = JSON.parse(readFileSync(join(root, "grades.json"), "utf8"));
  console.log(table(summarize(grades, loadRuns(root))));
}
