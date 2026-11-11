import { Command } from "commander";
import { diffProject, formatDiff } from "../diff/diff.js";
import { GitError } from "../project/git.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { BASE_FILES_HELP, BASE_HELP, collect, writeOut } from "./output.js";

export function diffCommand(): Command {
  return new Command("diff")
    .description("what changed by meaning, against git: scene nodes, properties, connections, script functions, signals and exports, settings, input actions and shader uniforms, and what the change breaks elsewhere")
    .argument("[files...]", "only these res:// files or folders (default: everything that changed)")
    .option("--path <dir>", "project directory (default: the current one)", ".")
    .option("--ref <commit>", "the commit to compare with", "HEAD")
    .option("--to <commit>", "compare two commits instead of a commit with the files on disk")
    .option("--against <file>", "compare the one file given with this file instead of with git")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .option("--json", "print the result as JSON")
    .action((files: string[], o: { path: string; ref: string; to?: string; against?: string; base: string[]; baseFiles: string[]; json?: boolean }, command: Command) => {
      try {
        const report = diffProject(o.path, { files, ref: o.ref, ...(o.to ? { to: o.to } : {}), ...(o.against ? { against: o.against } : {}), base: o.base, baseFiles: o.baseFiles });
        writeOut(command, o.json ? `${JSON.stringify(report, null, 2)}\n` : formatDiff(report, 200));
        if (!report.ok) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError) && !(error instanceof GitError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
