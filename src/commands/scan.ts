import { Command, Option } from "commander";
import { formatProjectMap, type Detail } from "../scan/format.js";
import { scanProject } from "../scan/scan.js";
import { BASE_FILES_HELP, BASE_HELP, collect, writeOut } from "./output.js";

export function scanCommand(): Command {
  return new Command("scan")
    .description("map a Godot project: scenes, nodes, scripts, signals, autoloads and key settings")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--json", "print the full map as JSON")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .action((path: string, options: { detail: Detail; json?: boolean; base: string[]; baseFiles: string[] }, command: Command) => {
      const map = scanProject(path, { base: options.base, baseFiles: options.baseFiles });
      const out = options.json ? `${JSON.stringify(map, null, 2)}\n` : formatProjectMap(map, options.detail);
      writeOut(command, out);
    });
}
