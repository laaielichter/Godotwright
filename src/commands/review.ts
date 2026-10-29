import { Command, Option } from "commander";
import { toSarif } from "../review/sarif.js";
import { formatDelta, reviewDelta } from "../review/delta.js";
import { formatReview, formatReviewSummary } from "../review/format.js";
import { reviewLearning } from "../learn/hooks.js";
import type { Detail } from "../scan/format.js";
import { BASE_FILES_HELP, BASE_HELP, collect, writeOut } from "./output.js";

export function reviewCommand(): Command {
  return new Command("review")
    .description("AAA review without Godot: API correctness, performance, code quality and structure, with scores")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--include-addons", "also review scripts in res://addons/")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .option("--only-new", "show only findings that are new since the last review of this project, the rest as one line each (the memory is in .godot/godotwright/)")
    .option("--min-score <score>", "exit with code 1 when the overall score is lower")
    .option("--json", "print the report as JSON")
    .option("--sarif", "print the report as SARIF 2.1.0, for GitHub code scanning (findings inline on pull requests)")
    .action((path: string, options: { detail: Detail; includeAddons?: boolean; base: string[]; baseFiles: string[]; onlyNew?: boolean; minScore?: string; json?: boolean; sarif?: boolean }, command: Command) => {
      const report = reviewLearning(path, { includeAddons: options.includeAddons, base: options.base, baseFiles: options.baseFiles });
      const delta = reviewDelta(path, report);
      if (options.sarif) writeOut(command, `${JSON.stringify(toSarif(report), null, 2)}\n`);
      else if (options.json) writeOut(command, `${JSON.stringify(options.onlyNew ? { ...report, delta: { new: delta.fresh, stillOpen: delta.open, fixed: delta.fixed, previous: delta.previous, first: delta.first } } : report, null, 2)}\n`);
      else if (options.onlyNew) writeOut(command, `${formatReviewSummary(report)}\n${formatDelta(delta, { noInfos: options.detail !== "full" })}`);
      else writeOut(command, formatReview(report, options.detail));
      const errors = report.categories.reduce((n, c) => n + c.errors, 0);
      if (errors > 0 || (options.minScore !== undefined && report.overall < Number(options.minScore))) process.exitCode = 1;
    });
}
