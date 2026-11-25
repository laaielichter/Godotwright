import { Command } from "commander";
import { renameAnything } from "../rename/csharp.js";
import { RenameError, formatRename } from "../rename/rename.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

export function renameCommand(): Command {
  return new Command("rename")
    .description("rename a function, signal, variable, class_name, autoload, input action, group or node everywhere (code, scenes, connections, settings), or move a res:// file with its .uid and .import files and every reference; shows the change first. A name declared in C# is renamed by the C# language server csharp-ls, then in scenes and GDScript")
    .argument("<from>", "the current name, or a res:// path")
    .argument("<to>", "the new name, or the new res:// path")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--write", "apply the rename (default: only show what would change)")
    .option("--file <file>", "for C#: the .cs file that declares the name, when more than one does")
    .option("--json", "print the plan as JSON")
    .action(async (from: string, to: string, path: string, options: { write?: boolean; json?: boolean; file?: string }, command: Command) => {
      try {
        const plan = await renameAnything(path, from, to, { write: options.write === true, ...(options.file ? { file: options.file } : {}) });
        writeOut(command, options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatRename(plan));
        if (plan.review && plan.review.after > plan.review.before) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof RenameError) && !(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${(error as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}
