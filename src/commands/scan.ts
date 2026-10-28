import { Command, Option } from "commander";
import { formatProjectMap, type Detail } from "../scan/format.js";
import { scanProject } from "../scan/scan.js";
import { writeOut } from "./output.js";

export function scanCommand(): Command {
  return new Command("scan")
    .description("map a Godot project: scenes, nodes, scripts, signals, autoloads and key settings")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--json", "print the full map as JSON")
    .action((path: string, options: { detail: Detail; json?: boolean }, command: Command) => {
      const map = scanProject(path);
      const out = options.json ? `${JSON.stringify(map, null, 2)}\n` : formatProjectMap(map, options.detail);
      writeOut(command, out);
    });
}
