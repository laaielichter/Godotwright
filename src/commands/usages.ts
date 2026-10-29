import { Command } from "commander";
import { ProjectNotFoundError } from "../scan/scan.js";
import { findUsages, formatUsages } from "../usages/usages.js";
import { BASE_FILES_HELP, BASE_HELP, collect, writeOut } from "./output.js";

export function usagesCommand(): Command {
  return new Command("usages")
    .description("find every place a name is used, offline: functions, signals, variables, classes, autoloads, input actions, groups, node names, or a res:// path / uid:// (code, scenes and project settings)")
    .argument("<name>", 'what to look for, e.g. take_damage, health_changed, Player, "jump", res://scenes/enemy.tscn')
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--include-addons", "also look in res://addons/")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .option("--json", "print the usages as JSON")
    .action((name: string, path: string, options: { includeAddons?: boolean; base: string[]; baseFiles: string[]; json?: boolean }, command: Command) => {
      try {
        const report = findUsages(path, name, { includeAddons: options.includeAddons, base: options.base, baseFiles: options.baseFiles });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatUsages(report));
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
