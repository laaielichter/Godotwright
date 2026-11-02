import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { formatCi, runCi } from "../ci/ci.js";
import { toJUnit, type JUnitInput } from "../ci/junit.js";
import {
  ScenarioError,
  formatScenarioList,
  formatScenarios,
  loadScenarios,
  pickScenarios,
  runScenario,
  saveScenario,
  scenarioData,
  scenarioJson,
  type ScenarioResult,
} from "../ci/scenario.js";
import { GodotNotFoundError } from "../check/godot.js";
import { PlayError } from "../play/play.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { collect, parseNumber, writeOut } from "./output.js";

interface CiOptions {
  godot?: string;
  godotChecks: boolean;
  includeAddons?: boolean;
  json?: boolean;
  junit?: string;
}

/** Writes JUnit XML to a file (relative to the working directory). */
export function writeJUnit(file: string, input: JUnitInput | string): void {
  const full = resolve(file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof input === "string" ? input : toJUnit(input));
}

function fail(error: unknown): void {
  if (error instanceof GodotNotFoundError) {
    process.exitCode = 2;
    throw error;
  }
  if (!(error instanceof ScenarioError) && !(error instanceof PlayError) && !(error instanceof ProjectNotFoundError)) throw error;
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}

const SCENARIO_HELP = `
A scenario is a JSON file in .godotwright/scenarios/. It runs a scene, plays input into it and checks what the game did:

  {
    "scene": "res://main.tscn",
    "input": "5 hold right 120; 30 tap hurt",
    "frames": 150,
    "expect": ["Hero.position.x >= 100 @ 25", "Hero.health == 2 @ 40", "HUD/HealthBar.value == 2"]
  }

An expectation is <Node.property> <==|!=|>=|<=|>|<> <value> [@ frame]; without a frame it is checked on the last one.
The input timeline is the one of "godotwright play". Optional: "watch" (more values), "until" (stop when a condition
holds; the scenario fails when it never does) and "signals" (record them; a claim on one, "Hero.landed >= 1 @ 60",
counts how often it fired up to that frame).
`;

export function ciCommand(): Command {
  return new Command("ci")
    .description("one receipt for a pull request: review, Godot check, tests and scenarios, as a markdown table (exit code 1 when a step fails)")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--no-godot-checks", "only the review, which needs no Godot (skips check, test and scenarios)")
    .option("--include-addons", "also review and load res://addons/")
    .option("--json", "print the result as JSON")
    .option("--junit <file>", "also write the results as JUnit XML (tests, scenarios, review and check) for a CI test tab")
    .addHelpText("after", SCENARIO_HELP)
    .action(async (path: string, options: CiOptions, command: Command) => {
      try {
        const { results, ...report } = await runCi(path, { godot: options.godot, noGodot: !options.godotChecks, includeAddons: options.includeAddons, keepResults: !!options.junit });
        if (options.junit) writeJUnit(options.junit, { steps: report.steps, ...results });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatCi(report));
        if (!report.ok) process.exitCode = 1;
      } catch (error) {
        fail(error);
      }
    });
}

interface ScenarioOptions {
  godot?: string;
  name?: string;
  import: boolean;
  json?: boolean;
  junit?: string;
  list?: boolean;
  save?: string;
  scene?: string;
  input?: string;
  watch: string[];
  frames?: number;
  until?: string;
  signal: string[];
  expect: string[];
  overwrite?: boolean;
}

export function scenarioCommand(): Command {
  return new Command("scenario")
    .description("run the project's scenarios (.godotwright/scenarios/*.json): play input into a scene and check what the game did; --list them, or --save a new one after one passing run")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--name <text>", "run only the scenario with this name, else those whose name contains this text")
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--json", "print the result as JSON")
    .option("--junit <file>", "also write the results as JUnit XML, one suite per scenario and a case per claim")
    .option("--list", "list the scenarios and their claims without running them")
    .option("--save <name>", "run a new scenario once and save it as .godotwright/scenarios/<name>.json when it passes (use with the options below)")
    .option("--scene <res-path>", "with --save: the scene to run (default: the main scene)")
    .option("--input <timeline>", 'with --save: the input timeline, e.g. "10 tap jump; 20 hold right 30"')
    .option("--watch <node.property>", "with --save: an extra value to sample (repeatable)", collect, [])
    .option("--frames <n>", "with --save: physics frames to run", (v: string) => parseNumber(v))
    .option("--until <condition>", "with --save: stop at the first frame this holds")
    .option("--signal <node.signal>", "with --save: record this signal; a claim on it counts how often it fired (repeatable)", collect, [])
    .option("--expect <claim>", 'with --save: a claim, e.g. "Hero.velocity.y == -400 @ 10" (repeatable, at least one)', collect, [])
    .option("--overwrite", "with --save: replace a scenario with that name")
    .addHelpText("after", SCENARIO_HELP)
    .action(async (path: string, options: ScenarioOptions, command: Command) => {
      try {
        if (options.save) {
          const { result, file } = await saveScenario(path, scenarioData(options.save, options), { godot: options.godot, import: options.import, overwrite: options.overwrite });
          writeOut(command, options.json ? `${JSON.stringify({ file, result }, null, 2)}\n` : `${formatScenarios([result])}${file ? `saved ${file}\n` : "not saved: the run did not pass\n"}`);
          if (!file) process.exitCode = 1;
          return;
        }
        const { root, scenarios } = loadScenarios(path);
        if (options.list) {
          const chosen = pickScenarios(scenarios, options.name);
          writeOut(command, options.json ? `${JSON.stringify(chosen.map((c) => ({ file: c.file, ...scenarioJson(c.scenario) })), null, 2)}\n` : formatScenarioList(chosen));
          return;
        }
        const chosen = pickScenarios(scenarios, options.name);
        if (!chosen.length) throw new ScenarioError(`no scenarios found in ${root}/.godotwright/scenarios${options.name ? ` matching "${options.name}"` : ""}`);
        const results: ScenarioResult[] = [];
        for (const { file, scenario } of chosen) results.push(await runScenario(root, file, scenario, { godot: options.godot, import: options.import }));
        if (options.junit) writeJUnit(options.junit, { scenarios: results });
        writeOut(command, options.json ? `${JSON.stringify(results, null, 2)}\n` : formatScenarios(results));
        if (results.some((r) => !r.ok)) process.exitCode = 1;
      } catch (error) {
        fail(error);
      }
    });
}

