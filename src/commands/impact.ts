import { Command } from "commander";
import { formatImpact, impactOf } from "../impact/impact.js";
import { GitError } from "../project/git.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { BASE_FILES_HELP, BASE_HELP, collect, writeOut } from "./output.js";

export function impactCommand(): Command {
  return new Command("impact")
    .description("what a change reaches: the scenes that load the changed files (default: what differs from git HEAD), the tests and saved scenarios that cover them, whether the change is global, and the checks to run")
    .argument("[files...]", "the changed res:// files (default: what differs from --ref in git)")
    .option("--path <dir>", "project directory (default: the current one)", ".")
    .option("--ref <commit>", "the commit to compare with", "HEAD")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .option("--json", "print the result as JSON")
    .action((files: string[], o: { path: string; ref: string; base: string[]; baseFiles: string[]; json?: boolean }, command: Command) => {
      try {
        const report = impactOf(o.path, { files, ref: o.ref, base: o.base, baseFiles: o.baseFiles });
        writeOut(command, o.json ? `${JSON.stringify(report, null, 2)}\n` : formatImpact(report, 40));
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError) && !(error instanceof GitError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
