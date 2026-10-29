import { Command } from "commander";
import { checkLearning } from "../learn/hooks.js";
import { GodotNotFoundError } from "../check/godot.js";
import { formatDiagnostic } from "../check/log.js";
import { writeOut } from "./output.js";

interface Options {
  godot?: string;
  import: boolean;
  instantiate: boolean;
  run?: string | true;
  scene?: string;
  exclude?: string[];
  timeout: string;
  json?: boolean;
  verbose?: boolean;
}

export function checkCommand(): Command {
  return new Command("check")
    .description("run Godot headless and report script and scene errors with file and line")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--no-instantiate", "only load scenes, do not instantiate them")
    .option("--run [frames]", "also run the main scene for a number of frames (default 120), and show what it printed")
    .option("--scene <res-path>", "run this scene instead of the main scene (implies --run)")
    .option("--exclude <dirs...>", "directories to skip, e.g. addons")
    .option("--timeout <seconds>", "timeout per Godot run", "600")
    .option("--json", "print the result as JSON")
    .option("--verbose", "also print the raw Godot output")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const result = await checkLearning(path, {
          godot: options.godot,
          import: options.import,
          instantiate: options.instantiate,
          runFrames: options.run === undefined ? (options.scene ? 120 : 0) : options.run === true ? 120 : Number(options.run),
          ...(options.scene ? { scene: options.scene } : {}),
          exclude: options.exclude,
          timeoutMs: Number(options.timeout) * 1000,
          keepLogs: options.verbose,
        });
        if (options.json) {
          writeOut(command, `${JSON.stringify(result, null, 2)}\n`);
        } else {
          const lines = Object.entries(result.logs ?? {}).map(([step, log]) => `--- godot ${step} ---\n${log.trim()}`);
          if (result.output !== undefined) lines.push(`--- output of the run ---\n${result.output || "(the game printed nothing)"}\n---`);
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
