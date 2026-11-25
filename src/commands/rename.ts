import { Command } from "commander";
import { renameAnywhere } from "../rename/csharp.js";
import { csharpPool } from "../lsp/csharp.js";
import { RenameError, formatRename } from "../rename/rename.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

export function renameCommand(): Command {
  return new Command("rename")
    .description(
      "rename a function, signal, variable, class_name, autoload, input action, group or node everywhere (code, scenes, connections, settings), or move a res:// file with its .uid and .import files and every reference; shows the change first. A C# class, method, property, field or [Signal] is renamed by the C# language server (csharp-ls, which you install), and scenes, resources and GDScript follow",
    )
    .argument("<from>", "the current name, or a res:// path")
    .argument("<to>", "the new name, or the new res:// path")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--write", "apply the rename (default: only show what would change)")
    .option("--file <cs-file>", "for a C# symbol declared in more than one class: the .cs file that declares the one you mean")
    .option("--csharp-ls <path>", "csharp-ls executable (default: $CSHARP_LS, then PATH, then ~/.dotnet/tools)")
    .option("--json", "print the plan as JSON")
    .action(async (from: string, to: string, path: string, options: { write?: boolean; file?: string; csharpLs?: string; json?: boolean }, command: Command) => {
      // Stopped when the command ends: nothing stays warm between CLI calls.
      const pool = csharpPool({ keepWarm: false });
      try {
        const plan = await renameAnywhere(path, from, to, { write: options.write, pool, ...(options.file ? { file: options.file } : {}), ...(options.csharpLs ? { csharpLs: options.csharpLs } : {}) });
        writeOut(command, options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatRename(plan));
        if (plan.review && plan.review.after > plan.review.before) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof RenameError) && !(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${(error as Error).message}\n`);
        process.exitCode = 1;
      } finally {
        pool.stopAll();
      }
    });
}
