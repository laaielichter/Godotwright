import { Command } from "commander";
import { formatJournal, formatUndo, readJournal, undoJournal } from "../journal/journal.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

export function undoCommand(): Command {
  return new Command("undo")
    .description("undo the last Godotwright writes (scene and project edits, renames, migrations, fixes, model builds), newest first; a file changed by hand since is left alone unless --force")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--steps <n>", "how many writes to undo (default 1)", (v) => Number.parseInt(v, 10), 1)
    .option("--list", "only list the writes that can be undone")
    .option("--force", "undo even when a file changed after the write (those changes are lost)")
    .action((path: string, options: { steps: number; list?: boolean; force?: boolean }, command: Command) => {
      try {
        if (options.list) {
          writeOut(command, formatJournal(readJournal(path).entries));
          return;
        }
        const result = undoJournal(path, { steps: options.steps, ...(options.force ? { force: true } : {}) });
        writeOut(command, formatUndo(result));
        if (result.blocked) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
