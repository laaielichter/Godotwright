// Grades one finished copy of test/fixtures/agent-tasks with real Godot, the way docs/cheap-models-code.md describes.
// Usage: GODOT=/path/to/godot node scripts/grade-agent-tasks.mjs <task 1-6> <dir>   (run `npm run build` first)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(repo, "dist", "cli.js");
const BASE = join(repo, "test", "fixtures", "agent-tasks");
const GODOT = process.env.GODOT ?? "godot";
const [task, dir] = [Number(process.argv[2]), process.argv[3]];
if (!(task >= 1 && task <= 6) || !dir) {
  console.error("usage: GODOT=/path/to/godot node scripts/grade-agent-tasks.mjs <task 1-6> <dir>");
  process.exit(2);
}

const run = (args) => {
  try {
    return execFileSync("node", [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240000 });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
};
const json = (args) => {
  try {
    return JSON.parse(run([...args, "--json"]));
  } catch {
    return undefined;
  }
};
const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
const { parseProjectSettings } = await import(join(repo, "dist", "godot", "project-settings.js"));
const { parseResourceText } = await import(join(repo, "dist", "godot", "scene.js"));
const settings = () => parseProjectSettings(read("project.godot"));
const play = (input, watch, frames) => json(["play", dir, "--godot", GODOT, "--input", input, ...watch.flatMap((w) => ["--watch", w]), "--frames", String(frames), "--every", "1", "--no-import"]);

const notes = [];
const checks = {};
// Every task: the project still loads without errors (addons are third-party code and not checked).
const check = json(["check", dir, "--godot", GODOT, "--exclude", "addons"]);
checks.loads = check !== undefined && check.errors === 0;

if (task === 1) {
  // An input action `dash` on Shift and joypad button B (index 1).
  const dash = settings().inputActions.find((a) => a.name === "dash");
  checks.action = Boolean(dash);
  checks.shift = Boolean(dash?.events.includes("Key:Shift"));
  checks.joyB = Boolean(dash?.events.includes("JoyButton:1"));
  if (dash) notes.push(`dash events: ${dash.events.join(", ") || "none"}`);
}
if (task === 2) {
  // A Timer SpawnTimer (2 s, autostart) whose timeout prints "spawn" while the game runs.
  const scene = parseResourceText(read("main.tscn"));
  const timer = scene.nodes.find((n) => n.name === "SpawnTimer");
  checks.timer = timer?.type === "Timer";
  checks.settings = timer?.props.wait_time === 2 && timer?.props.autostart === true;
  checks.connected = scene.connections.some((c) => c.signal === "timeout" && c.from === "SpawnTimer") || /SpawnTimer.*timeout\.connect\(/.test(read("main.gd"));
  checks.printsSpawn = Boolean(play("", [], 150)?.output?.includes("spawn"));
}
if (task === 3) {
  // The jump is at least 30% higher than the 85.1 px of the original, and the hero lands again.
  const p = play("10 tap jump", ["Hero.position.y", "Hero.is_on_floor()"], 150);
  const ys = (p?.samples ?? []).map((s) => Number(s.values["Hero.position.y"]));
  const last = p?.samples.at(-1)?.values ?? {};
  const height = 490 - Math.min(...ys);
  checks.higher = height >= 1.3 * 85.05;
  checks.lands = last["Hero.is_on_floor()"] === "true" && Number(last["Hero.position.y"]) > 485;
  notes.push(`jump height ${height.toFixed(1)} px (original 85.1)`);
}
if (task === 4) {
  // All GUT tests pass, and the test file is unchanged.
  const t = json(["test", dir, "--godot", GODOT]);
  checks.green = Boolean(t && t.failed === 0 && t.errors === 0 && t.tests === 2);
  checks.testUnchanged = read("test/test_hero.gd") === readFileSync(join(BASE, "test", "test_hero.gd"), "utf8");
  notes.push(`tests: ${t ? `${t.passed}/${t.tests} passed` : "no report"}`);
}
if (task === 5) {
  // No health_changed left; hp_changed defined, used and connected in the scene; the game still runs.
  const old = json(["usages", "health_changed", dir]);
  const now = json(["usages", "hp_changed", dir]);
  checks.oldGone = (old?.usages ?? []).length === 0;
  const kinds = new Set((now?.usages ?? []).map((u) => u.kind));
  checks.renamedEverywhere = kinds.has("definition") && kinds.has("signal connection") && (now?.usages ?? []).length >= 4;
  const p = play("", [], 5);
  checks.runs = Boolean(p?.finished) && (p?.diagnostics ?? []).every((d) => d.severity !== "error");
}
if (task === 6) {
  // An autoload Score whose points go to 1 after one jump.
  const auto = settings().autoloads.find((a) => a.name === "Score");
  checks.autoload = Boolean(auto) && existsSync(join(dir, (auto?.path ?? "").replace("res://", "")));
  const end = play("10 tap jump", ["/root/Score.points"], 40)?.samples.at(-1)?.values["/root/Score.points"];
  checks.countsJump = end === "1";
  notes.push(`Score.points after one jump: ${end}`);
}

// The task's own checks decide pass or partial. Gates (still loads, still runs, test left alone) are needed for a pass
// but do not count as progress on their own.
const GATES = ["loads", "runs", "testUnchanged"];
const goal = Object.entries(checks).filter(([k]) => !GATES.includes(k)).map(([, v]) => v);
const gates = Object.entries(checks).filter(([k]) => GATES.includes(k)).every(([, v]) => v);
const verdict = goal.every(Boolean) && gates ? "pass" : goal.some(Boolean) ? "partial" : "fail";
console.log(JSON.stringify({ task, dir, verdict, checks, notes }));
