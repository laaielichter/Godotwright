import { Command, Option } from "commander";
import { formatMigration, migrateProject } from "../migrate/migrate.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { collect, writeOut } from "./output.js";

export function migrateCommand(): Command {
  return new Command("migrate")
    .description("rewrite Godot 3 GDScript to Godot 4 where that is mechanical (annotations, renames, yield, connect, moved members), and list what is left to do by hand")
    .argument("[path]", "project directory, or one .gd file", ".")
    .option("--write", "write the migrated scripts (default: only show what would change)")
    .option("--file <res-path>", "only this res:// script (repeatable)", collect, [])
    .option("--include-addons", "also migrate scripts in res://addons/")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--json", "print the result as JSON")
    .action((path: string, options: { write?: boolean; file: string[]; includeAddons?: boolean; detail: "brief" | "full"; json?: boolean }, command: Command) => {
      try {
        const result = migrateProject(path, { write: options.write, includeAddons: options.includeAddons, ...(options.file.length ? { files: options.file } : {}) });
        writeOut(command, options.json ? `${JSON.stringify(result, null, 2)}\n` : formatMigration(result, options.detail));
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
