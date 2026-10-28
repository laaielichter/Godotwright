import { Command, Option } from "commander";
import { formatReview } from "../review/format.js";
import { reviewLearning } from "../learn/hooks.js";
import type { Detail } from "../scan/format.js";
import { writeOut } from "./output.js";

export function reviewCommand(): Command {
  return new Command("review")
    .description("AAA review without Godot: API correctness, performance, code quality and structure, with scores")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--include-addons", "also review scripts in res://addons/")
    .option("--min-score <score>", "exit with code 1 when the overall score is lower")
    .option("--json", "print the report as JSON")
    .action((path: string, options: { detail: Detail; includeAddons?: boolean; minScore?: string; json?: boolean }, command: Command) => {
      const report = reviewLearning(path, { includeAddons: options.includeAddons });
      writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReview(report, options.detail));
      const errors = report.categories.reduce((n, c) => n + c.errors, 0);
      if (errors > 0 || (options.minScore !== undefined && report.overall < Number(options.minScore))) process.exitCode = 1;
    });
}
