import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { formatLeaks, leakScene } from "../perf/leaks.js";
import { PlayError } from "../play/play.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

function count(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("expected a whole number");
  return n;
}

function amount(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError("expected a number of 0 or more");
  return n;
}

export function leaksCommand(): Command {
  return new Command("leaks")
    .description(
      "find leaks headless: load, run and free a scene in cycles, snapshot the live objects after each, and report what grows per cycle (orphan nodes by class, script and scene with where they were removed and made, nodes left in the tree, objects that are not nodes, what Godot still held at exit); exit code 1 when growth passes the budget",
    )
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--scene <res-path>", "the scene to cycle (default: the main scene)")
    .option("--cycles <n>", "cycles to run (default 5)", count, 5)
    .option("--cycle-frames <n>", "frames per cycle (default 60)", count, 60)
    .option("--warmup <n>", "first cycles not counted (default 1)", count, 1)
    .option("--keep", "keep the scene running instead of freeing and remaking it each cycle")
    .option("--input <timeline>", 'input replayed in every cycle, as play takes it: "10 press load_chunk; 40 press unload_chunk"')
    .option("--budget-objects <n>", "objects allowed to grow per cycle (default 0)", amount, 0)
    .option("--budget-orphans <n>", "orphan nodes allowed to grow per cycle (default 0)", amount, 0)
    .option("--no-baseline", "do not compare with or save the last run")
    .option("--json", "print the result as JSON")
    .action(
      async (
        path: string,
        options: { godot?: string; scene?: string; cycles: number; cycleFrames: number; warmup: number; keep?: boolean; input?: string; budgetObjects: number; budgetOrphans: number; baseline: boolean; json?: boolean },
        command: Command,
      ) => {
        try {
          const report = await leakScene(path, {
            godot: options.godot,
            ...(options.scene ? { scene: options.scene } : {}),
            cycles: options.cycles,
            cycleFrames: options.cycleFrames,
            warmupCycles: options.warmup,
            reload: !options.keep,
            ...(options.input ? { input: options.input } : {}),
            budget: { objects: options.budgetObjects, orphans: options.budgetOrphans },
            baseline: options.baseline,
          });
          const { run, ...rest } = report;
          const json = { ...rest, finished: run.finished, warnings: run.warnings, diagnostics: run.diagnostics };
          writeOut(command, options.json ? `${JSON.stringify(json, null, 2)}\n` : formatLeaks(report));
          if (report.verdict !== "ok" || !run.finished) process.exitCode = 1;
        } catch (error) {
          if (error instanceof GodotNotFoundError) {
            process.exitCode = 2;
            throw error;
          }
          if (!(error instanceof PlayError) && !(error instanceof ProjectNotFoundError)) throw error;
          process.stderr.write(`${error.message}\n`);
          process.exitCode = 1;
        }
      },
    );
}
