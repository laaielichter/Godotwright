import { Command } from "commander";
import { formatFormatReport, formatProjectAll } from "../format/project.js";
import { OptionError } from "../project/options.js";
import { ProtectedPathError } from "../project/protect.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

interface FormatCommandOptions {
  path?: string;
  check?: boolean;
  diff?: boolean;
  write?: boolean;
  includeAddons?: boolean;
  json?: boolean;
}

export function formatCommand(): Command {
  return new Command("format")
    .description(
      "format GDScript the way the official style guide writes it (tabs, spaces around operators and after commas, two blank lines around functions); whitespace only, lines are never joined or wrapped, and a guard compares the tokens before and after so the code cannot change meaning. C# files are formatted by `dotnet format` (the project's .editorconfig) and kept only when their outline is the same and the project still builds. Shows what would change; --write writes it",
    )
    .argument("[files...]", "scripts or folders to format (default: every .gd and .cs file of the project)")
    .option("--path <dir>", "project directory (or any path inside it; default: the first file, else the current directory)")
    .option("--check", "write nothing; list the files that would change and exit with 1 when there are any")
    .option("--diff", "print a unified diff of every change")
    .option("--write", "write the formatted files (default: only show what would change)")
    .option("--include-addons", "also format res://addons/")
    .option("--json", "print the result as JSON")
    .action(async (files: string[], options: FormatCommandOptions, command: Command) => {
      try {
        if (options.check && options.write) throw new OptionError("--check and --write cannot be used together");
        const report = await formatProjectAll(options.path ?? files[0] ?? ".", {
          ...(files.length ? { files } : {}),
          write: options.write === true,
          includeAddons: options.includeAddons,
          diff: options.diff,
        });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatFormatReport(report));
        if (options.check && report.changed.length) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError) && !(error instanceof OptionError) && !(error instanceof ProtectedPathError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
