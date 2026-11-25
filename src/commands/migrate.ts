import { Command, Option } from "commander";
import { formatMigration, migrateProjectChecked } from "../migrate/migrate.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { OptionError } from "../project/options.js";
import { collect, writeOut } from "./output.js";

export function migrateCommand(): Command {
  return new Command("migrate")
    .description("rewrite Godot 3 GDScript, shaders and C# to Godot 4 where that is mechanical (annotations, renames, yield, connect, moved members, shader renames and SCREEN_TEXTURE; for C#: partial, signal delegates, Connect to a Callable, RPC attributes, renamed types and members, the .csproj and .sln), and list what is left to do by hand; C# is built on a copy afterwards and each compiler error left is a TO DO")
    .argument("[path]", "project directory, or one .gd, .gdshader or .cs file", ".")
    .option("--write", "write the migrated scripts (default: only show what would change)")
    .option("--file <res-path>", "only this res:// script or shader (repeatable)", collect, [])
    .option("--include-addons", "also migrate scripts in res://addons/")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--json", "print the result as JSON")
    .action(async (path: string, options: { write?: boolean; file: string[]; includeAddons?: boolean; detail: "brief" | "full"; json?: boolean }, command: Command) => {
      try {
        const result = await migrateProjectChecked(path, { write: options.write, includeAddons: options.includeAddons, ...(options.file.length ? { files: options.file } : {}) });
        writeOut(command, options.json ? `${JSON.stringify(result, null, 2)}\n` : formatMigration(result, options.detail));
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError) && !(error instanceof OptionError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
