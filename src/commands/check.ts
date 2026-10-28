import { Command } from "commander";
import { checkProject } from "../check/check.js";
import { GodotNotFoundError } from "../check/godot.js";
import { formatDiagnostic } from "../check/log.js";
import { writeOut } from "./output.js";

interface Options {
  godot?: string;
  import: boolean;
  instantiate: boolean;
  run?: string | true;
  exclude?: string[];
  timeout: string;
  json?: boolean;
  verbose?: boolean;
}

export function checkCommand(): Command {
  return new Command("check")
    .description("run Godot headless and report script and scene errors with file and line")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH)")
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--no-instantiate", "only load scenes, do not instantiate them")
    .option("--run [frames]", "also run the main scene for a number of frames (default 120)")
    .option("--exclude <dirs...>", "directories to skip, e.g. addons")
    .option("--timeout <seconds>", "timeout per Godot run", "600")
    .option("--json", "print the result as JSON")
    .option("--verbose", "also print the raw Godot output")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const result = await checkProject(path, {
          godot: options.godot,
          import: options.import,
          instantiate: options.instantiate,
          runFrames: options.run === undefined ? 0 : options.run === true ? 120 : Number(options.run),
          exclude: options.exclude,
          timeoutMs: Number(options.timeout) * 1000,
          keepLogs: options.verbose,
        });
        if (options.json) {
          writeOut(command, `${JSON.stringify(result, null, 2)}\n`);
        } else {
          const lines = Object.entries(result.logs ?? {}).map(([step, log]) => `--- godot ${step} ---\n${log.trim()}`);
          lines.push(...result.diagnostics.map(formatDiagnostic));
          lines.push(
            `${result.errors} error${result.errors === 1 ? "" : "s"}, ${result.warnings} warning${result.warnings === 1 ? "" : "s"}` +
              ` (Godot ${result.godotVersion}, ${result.scripts} scripts, ${result.scenes} scenes)`,
          );
          writeOut(command, `${lines.join("\n")}\n`);
        }
        if (result.errors > 0) process.exitCode = 1;
      } catch (error) {
        if (error instanceof GodotNotFoundError) {
          process.exitCode = 2;
        }
        throw error;
      }
    });
}
