import { Command, Option } from "commander";
import { formatReview } from "../review/format.js";
import { reviewLearning } from "../learn/hooks.js";
import type { Detail } from "../scan/format.js";
import { BASE_FILES_HELP, BASE_HELP, collect, parseNumber, writeOut } from "./output.js";

export function reviewCommand(): Command {
  return new Command("review")
    .description("AAA review without Godot: API correctness, performance, code quality and structure, with scores")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--include-addons", "also review scripts in res://addons/")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .option("--min-score <score>", "exit with code 1 when the overall score is lower", parseNumber)
    .option("--json", "print the report as JSON")
    .action((path: string, options: { detail: Detail; includeAddons?: boolean; base: string[]; baseFiles: string[]; minScore?: number; json?: boolean }, command: Command) => {
      const report = reviewLearning(path, { includeAddons: options.includeAddons, base: options.base, baseFiles: options.baseFiles });
      writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReview(report, options.detail));
      const errors = report.categories.reduce((n, c) => n + c.errors, 0);
      if (errors > 0 || (options.minScore !== undefined && report.overall < options.minScore)) process.exitCode = 1;
    });
}
