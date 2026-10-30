import { Command } from "commander";
import { formatCi, runCi } from "../ci/ci.js";
import { ScenarioError, formatScenario, loadScenarios, runScenario } from "../ci/scenario.js";
import { GodotNotFoundError } from "../check/godot.js";
import { PlayError } from "../play/play.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

interface CiOptions {
  godot?: string;
  godotChecks: boolean;
  includeAddons?: boolean;
  json?: boolean;
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
The input timeline is the one of "godotwright play".
`;

export function ciCommand(): Command {
  return new Command("ci")
    .description("one receipt for a pull request: review, Godot check, tests and scenarios, as a markdown table (exit code 1 when a step fails)")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--no-godot-checks", "only the review, which needs no Godot (skips check, test and scenarios)")
    .option("--include-addons", "also review and load res://addons/")
    .option("--json", "print the result as JSON")
    .addHelpText("after", SCENARIO_HELP)
    .action(async (path: string, options: CiOptions, command: Command) => {
      try {
        const report = await runCi(path, { godot: options.godot, noGodot: !options.godotChecks, includeAddons: options.includeAddons });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatCi(report));
        if (!report.ok) process.exitCode = 1;
      } catch (error) {
        fail(error);
      }
    });
}

export function scenarioCommand(): Command {
  return new Command("scenario")
    .description("run the project's scenarios (.godotwright/scenarios/*.json): play input into a scene and check what the game did")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--name <text>", "run only the scenarios whose name contains this text")
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--json", "print the result as JSON")
    .addHelpText("after", SCENARIO_HELP)
    .action(async (path: string, options: { godot?: string; name?: string; import: boolean; json?: boolean }, command: Command) => {
      try {
        const { root, scenarios } = loadScenarios(path);
        const chosen = scenarios.filter((s) => !options.name || s.scenario.name.includes(options.name));
        if (!chosen.length) throw new ScenarioError(`no scenarios found in ${root}/.godotwright/scenarios${options.name ? ` matching "${options.name}"` : ""}`);
        const results = [];
        for (const { file, scenario } of chosen) results.push(await runScenario(root, file, scenario, { godot: options.godot, import: options.import }));
        writeOut(command, options.json ? `${JSON.stringify(results, null, 2)}\n` : `${results.map(formatScenario).join("\n")}\n`);
        if (results.some((r) => !r.ok)) process.exitCode = 1;
      } catch (error) {
        fail(error);
      }
    });
}
