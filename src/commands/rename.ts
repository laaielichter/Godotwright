import { Command } from "commander";
import { RenameError, formatRename, renameInProject } from "../rename/rename.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

export function renameCommand(): Command {
  return new Command("rename")
    .description("rename a function, signal, variable, class_name, autoload, input action, group or node everywhere (code, scenes, connections, settings), or move a res:// file with its .uid and .import files and every reference; shows the change first")
    .argument("<from>", "the current name, or a res:// path")
    .argument("<to>", "the new name, or the new res:// path")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--write", "apply the rename (default: only show what would change)")
    .option("--json", "print the plan as JSON")
    .action((from: string, to: string, path: string, options: { write?: boolean; json?: boolean }, command: Command) => {
      try {
        const plan = renameInProject(path, from, to, { write: options.write });
        writeOut(command, options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatRename(plan));
        if (plan.review && plan.review.after > plan.review.before) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof RenameError) && !(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${(error as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}
