// Grades one finished copy of the round-2 project (test/fixtures/agent-tasks-2) with real Godot. Usage: GODOT=/path/to/godot node scripts/grade-agent-tasks-2.mjs <task 1-6> <dir>   (run `npm run build` first)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [task, dir] = [Number(process.argv[2]), process.argv[3]];
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(REPO, "dist", "cli.js");
const GODOT = process.env.GODOT ?? "godot";
const BUGS = join(REPO, "test", "fixtures", "agent-tasks-2-bugs");
const run = (args) => {
  try {
    return execFileSync("node", [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
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
const { parseProjectSettings } = await import(pathToFileURL(join(REPO, "dist", "godot/project-settings.js")).href);
const { parseResourceText } = await import(pathToFileURL(join(REPO, "dist", "godot/scene.js")).href);
const settings = () => parseProjectSettings(read("project.godot"));
const scene = () => parseResourceText(read("main.tscn"));
const play = (input, watch, frames) => json(["play", dir, "--godot", GODOT, "--input", input, ...watch.flatMap((w) => ["--watch", w]), "--frames", String(frames), "--every", "1", "--no-import"]);
const series = (p, key) => (p?.samples ?? []).map((s) => ({ frame: s.frame, v: s.values[key] }));
const num = (v) => Number(String(v));
const at = (p, key, frame) => num(series(p, key).find((s) => s.frame === frame)?.v);

const notes = [];
const checks = {};
const GATES = ["loads", "runs", "testsUnchanged", "walksFirst", "testsStillGreen"];
const check = json(["check", dir, "--godot", GODOT]);
checks.loads = check !== undefined && check.errors === 0;
if (!checks.loads) notes.push(`check: ${(check?.diagnostics ?? []).filter((d) => d.severity === "error").map((d) => `${d.file ?? ""}:${d.line ?? ""} ${d.message}`).slice(0, 2).join(" | ")}`);

if (task === 1) {
  // A patrolling enemy that hurts the hero.
  const p = play("0 hold right 300", ["Enemy.position.x", "Hero.health"], 300);
  const xs = series(p, "Enemy.position.x").map((s) => num(s.v)).filter((n) => Number.isFinite(n));
  const health = series(p, "Hero.health").at(-1)?.v;
  checks.enemyExists = xs.length > 100;
  checks.patrolsBothWays = xs.length > 0 && Math.min(...xs) <= 315 && Math.max(...xs) >= 485;
  checks.staysInRange = xs.length > 0 && Math.min(...xs) >= 280 && Math.max(...xs) <= 520;
  checks.hurtsHero = num(health) < 3;
  checks.scene = existsSync(join(dir, "enemy.tscn"));
  checks.runs = Boolean(p?.finished) && (p?.diagnostics ?? []).every((d) => d.severity !== "error");
  notes.push(`enemy x ${xs.length ? `${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}` : "none"}, hero health ${health}`);
}
if (task === 2) {
  // Three GUT tests fail because of bugs in the game; fix the game, not the tests.
  const t = json(["test", dir, "--godot", GODOT]);
  checks.testsGreen = Boolean(t && t.failed === 0 && t.errors === 0 && t.tests === 4);
  checks.testsUnchanged = read("test/test_hero.gd") === readFileSync(join(BUGS, "test", "test_hero.gd"), "utf8");
  notes.push(`tests: ${t ? `${t.passed}/${t.tests} passed` : "no report"}${t?.failures?.length ? `; failing: ${t.failures.map((f) => f.test).join(", ")}` : ""}`);
}
if (task === 3) {
  // heal -> restore_health and node HUD -> Interface, everywhere.
  const sc = scene();
  checks.nodeRenamed = sc.nodes.some((n) => n.name === "Interface") && !sc.nodes.some((n) => n.name === "HUD");
  checks.connectionFollows = sc.connections.some((c) => c.to === "Interface") && !sc.connections.some((c) => c.to === "HUD");
  const oldHeal = json(["usages", "heal", dir]);
  const newHeal = json(["usages", "restore_health", dir]);
  checks.healGone = (oldHeal?.usages ?? []).filter((u) => !u.file.startsWith("res://addons/")).length === 0;
  const kinds = (newHeal?.usages ?? []).map((u) => u.kind);
  checks.restoreUsed = kinds.includes("definition") && kinds.filter((k) => k !== "definition").length >= 1;
  const oldNode = json(["usages", "HUD", dir]);
  checks.noHudPaths = (oldNode?.usages ?? []).filter((u) => (u.kind === "scene node" || u.kind === "node path") && !u.file.startsWith("res://addons/")).length === 0;
  const t = json(["test", dir, "--godot", GODOT]);
  checks.testsStillGreen = Boolean(t && t.failed === 0 && t.tests === 2);
  const p = play("", [], 5);
  checks.runs = Boolean(p?.finished) && (p?.diagnostics ?? []).every((d) => d.severity !== "error");
}
if (task === 4) {
  // A pause menu on Escape: hero stops, PauseMenu shows; Escape again resumes.
  checks.action = settings().inputActions.some((a) => a.name === "pause" && a.events.includes("Key:Escape"));
  const p = play("5 hold right 120; 30 tap Key:Escape; 60 tap Key:Escape", ["Hero.position.x", "PauseMenu.visible"], 110);
  const vis = (f) => String(series(p, "PauseMenu.visible").find((s) => s.frame === f)?.v);
  checks.walksFirst = at(p, "Hero.position.x", 25) > at(p, "Hero.position.x", 5) + 20;
  checks.stopsWhilePaused = Math.abs(at(p, "Hero.position.x", 55) - at(p, "Hero.position.x", 35)) < 0.5;
  checks.menuShows = vis(40) === "true" && vis(55) === "true" && vis(10) === "false";
  checks.resumes = at(p, "Hero.position.x", 100) > at(p, "Hero.position.x", 65) + 20 && vis(100) === "false";
  checks.runs = Boolean(p?.finished) && (p?.diagnostics ?? []).every((d) => d.severity !== "error");
  notes.push(`x@5/25/35/55/65/100: ${[5, 25, 35, 55, 65, 100].map((f) => at(p, "Hero.position.x", f).toFixed(0)).join("/")}, menu visible@10/40/55/100: ${[10, 40, 55, 100].map(vis).join("/")}`);
}
if (task === 5) {
  // Window 1280x720, stretch canvas_items, vsync off, 120 fps cap.
  const v = settings().values;
  checks.width = v["display/window/size/viewport_width"] === 1280;
  checks.height = v["display/window/size/viewport_height"] === 720;
  checks.stretch = v["display/window/stretch/mode"] === "canvas_items";
  checks.vsync = v["display/window/vsync/vsync_mode"] === 0;
  checks.maxFps = v["application/run/max_fps"] === 120;
  notes.push(`values: ${JSON.stringify({ w: v["display/window/size/viewport_width"], h: v["display/window/size/viewport_height"], stretch: v["display/window/stretch/mode"], vsync: v["display/window/vsync/vsync_mode"], fps: v["application/run/max_fps"] })}`);
}
if (task === 6) {
  // A ProgressBar HealthBar under HUD, max 3, following the hero's health (press H to take damage).
  const p = play("10 tap hurt; 20 tap hurt", ["HUD/HealthBar.value", "HUD/HealthBar.max_value"], 30);
  checks.exists = series(p, "HUD/HealthBar.value").some((s) => s.v !== "<no node>");
  checks.startsFull = at(p, "HUD/HealthBar.value", 5) === 3;
  checks.dropsToTwo = at(p, "HUD/HealthBar.value", 15) === 2;
  checks.dropsToOne = at(p, "HUD/HealthBar.value", 25) === 1;
  checks.maxIsThree = at(p, "HUD/HealthBar.max_value", 5) === 3;
  checks.isProgressBar = scene().nodes.some((n) => n.name === "HealthBar" && n.type === "ProgressBar");
  checks.runs = Boolean(p?.finished) && (p?.diagnostics ?? []).every((d) => d.severity !== "error");
  notes.push(`bar value@5/15/25: ${[5, 15, 25].map((f) => at(p, "HUD/HealthBar.value", f)).join("/")}`);
}

const goal = Object.entries(checks).filter(([k]) => !GATES.includes(k)).map(([, v]) => v);
const gates = Object.entries(checks).filter(([k]) => GATES.includes(k)).every(([, v]) => v);
const verdict = goal.every(Boolean) && gates ? "pass" : goal.some(Boolean) ? "partial" : "fail";
console.log(JSON.stringify({ task, dir, verdict, passed: `${goal.filter(Boolean).length}/${goal.length}`, checks, notes }));
