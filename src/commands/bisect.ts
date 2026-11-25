import { Command } from "commander";
import { bisectProject, formatBisect } from "../bisect/bisect.js";
import { GitError } from "../project/git.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { BASE_FILES_HELP, BASE_HELP, collect, parseNumber, writeOut } from "./output.js";

export function bisectCommand(): Command {
  return new Command("bisect")
    .description("which commit broke it: reviews the project as it was at each commit (copies from git, nothing in your working tree changes) and halves the range down to the first commit with the problem. No Godot needed")
    .option("--path <dir>", "project directory (default: the current one)", ".")
    .option("--bad <commit>", "a commit that has the problem", "HEAD")
    .option("--good <commit>", "a commit known to be without it (default: search backwards in growing steps)")
    .option("--rule <id>", "the problem is a finding of this review rule, e.g. api/unknown-member")
    .option("--file <res-path>", "the problem is a finding in this file")
    .option("--text <words>", "the problem is a finding whose message holds this text")
    .option("--max <commits>", "how far back to look when no good commit is given", parseNumber, 200)
    .option("--include-addons", "also review res://addons/")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .option("--json", "print the result as JSON")
    .action((o: { path: string; bad: string; good?: string; rule?: string; file?: string; text?: string; max: number; includeAddons?: boolean; base: string[]; baseFiles: string[]; json?: boolean }, command: Command) => {
      try {
        const report = bisectProject(o.path, {
          bad: o.bad,
          max: o.max,
          base: o.base,
          baseFiles: o.baseFiles,
          ...(o.good ? { good: o.good } : {}),
          ...(o.rule ? { rule: o.rule } : {}),
          ...(o.file ? { file: o.file } : {}),
          ...(o.text ? { text: o.text } : {}),
          ...(o.includeAddons ? { includeAddons: true } : {}),
        });
        writeOut(command, o.json ? `${JSON.stringify(report, null, 2)}\n` : formatBisect(report, 40));
        if (!report.ok) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError) && !(error instanceof GitError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
