import { Command, Option } from "commander";
import { FIXABLE_RULES, fixProject, formatFix } from "../fix/fix.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { collect, writeOut } from "./output.js";

export function fixCommand(): Command {
  return new Command("fix")
    .description(
      `apply mechanical fixes for review findings, each labelled safe (only removes the problem) or check (read it); shows the changes first, writes with --write and reviews the changed files again. Rules: ${FIXABLE_RULES.join(", ")}`,
    )
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--file <res-path>", "only this res:// file (repeatable)", collect, [])
    .option("--rule <id>", "only this rule (repeatable)", collect, [])
    .option("--check", "also apply the fixes marked check")
    .option("--from <version>", "release the project comes from, for the upgrade fixes (default: the saved version)")
    .option("--write", "write the fixes (default: only show them)")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--json", "print the result as JSON")
    .action((path: string, options: { file: string[]; rule: string[]; check?: boolean; from?: string; write?: boolean; detail: "brief" | "full"; json?: boolean }, command: Command) => {
      try {
        const result = fixProject(path, {
          ...(options.file.length ? { files: options.file } : {}),
          ...(options.rule.length ? { rules: options.rule } : {}),
          ...(options.from ? { from: options.from } : {}),
          includeCheck: options.check,
          write: options.write,
        });
        writeOut(command, options.json ? `${JSON.stringify(result, null, 2)}\n` : formatFix(result, options.detail));
        if (result.remaining?.some((f) => f.severity === "error")) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
