import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { formatPerf, perfScene } from "../perf/perf.js";
import { PlayError } from "../play/play.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

function count(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("expected a whole number");
  return n;
}

export function perfCommand(): Command {
  return new Command("perf")
    .description(
      "measure a scene headless: frame-time percentiles against a budget, the physics step apart from the rest, the slowest frames and what changed on them, node and orphan counts, and the change since the last run of the same scene",
    )
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--scene <res-path>", "the scene to measure (default: the main scene)")
    .option("--frames <n>", "frames to measure (default 600)", count, 600)
    .option("--warmup <n>", "frames to run first without measuring (default 60)", count, 60)
    .option("--input <timeline>", 'input while measuring, as play takes it: "10 hold right 300"')
    .option("--budget <ms>", "frame budget in milliseconds (default 16.6)", (v) => Number(v), 16.6)
    .option("--no-baseline", "do not compare with or save a baseline")
    .option("--json", "print the result as JSON")
    .action(async (path: string, options: { godot?: string; scene?: string; frames: number; warmup: number; input?: string; budget: number; baseline: boolean; json?: boolean }, command: Command) => {
      try {
        const report = await perfScene(path, {
          godot: options.godot,
          ...(options.scene ? { scene: options.scene } : {}),
          frames: options.frames,
          warmup: options.warmup,
          ...(options.input ? { input: options.input } : {}),
          budgetMs: options.budget,
          baseline: options.baseline,
        });
        const { run: _run, ...rest } = report;
        writeOut(command, options.json ? `${JSON.stringify(rest, null, 2)}\n` : formatPerf(report));
        if (report.verdict !== "ok") process.exitCode = 1;
      } catch (error) {
        if (error instanceof GodotNotFoundError) {
          process.exitCode = 2;
          throw error;
        }
        if (!(error instanceof PlayError) && !(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
