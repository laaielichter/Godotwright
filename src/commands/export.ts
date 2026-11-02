import { Command } from "commander";
import { checkExport, formatExportCheck } from "../export/export.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

export function exportCommand(): Command {
  return new Command("export")
    .description("check what the exported game will hold against what the code and scenes load: files exclude_filter leaves out, plain data files (JSON, CSV, text) missing from include_filter, paths built under an excluded folder, and whether export templates are installed")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--preset <name>", "only this preset (its name or number)")
    .option("--json", "print the result as JSON")
    .action((path: string, options: { preset?: string; json?: boolean }, command: Command) => {
      try {
        const result = checkExport(path, options.preset ? { preset: options.preset } : {});
        writeOut(command, options.json ? `${JSON.stringify(result, null, 2)}\n` : formatExportCheck(result));
        if (result.problems.some((p) => p.severity === "error")) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
