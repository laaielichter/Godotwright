import { Command, InvalidArgumentError } from "commander";
import { checkLearning } from "../learn/hooks.js";
import { GodotNotFoundError } from "../check/godot.js";
import { formatDiagnostic } from "../check/log.js";
import { collect, parseNumber, writeOut } from "./output.js";

interface Options {
  godot?: string;
  import: boolean;
  instantiate: boolean;
  run?: number | true;
  scene?: string;
  exclude: string[];
  includeAddons?: boolean;
  timeout: number;
  json?: boolean;
  verbose?: boolean;
}

/** `--run [frames]` takes a positive whole number. A project path given here is refused, not read as a frame count. */
function parseFrames(value: string): number {
  const frames = Number(value);
  if (!Number.isInteger(frames) || frames <= 0) {
    throw new InvalidArgumentError("expected a whole number of frames; give the project path before --run");
  }
  return frames;
}

function parseSeconds(value: string): number {
  const seconds = parseNumber(value);
  if (seconds <= 0) throw new InvalidArgumentError("expected a number above 0");
  return seconds;
}

export function checkCommand(): Command {
  return new Command("check")
    .description("run Godot headless and report script and scene errors with file and line")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--no-instantiate", "only load scenes, do not instantiate them")
    .option("--run [frames]", "also run the main scene for a number of frames (default 120), and show what it printed", parseFrames)
    .option("--scene <res-path>", "run this scene instead of the main scene (implies --run)")
    .option("--exclude <dir>", "directory to skip, e.g. levels/old (repeatable); res://addons/ is skipped already", collect, [])
    .option("--include-addons", "also load res://addons/ (third-party code; its errors are not your project's)")
    .option("--timeout <seconds>", "timeout per Godot run", parseSeconds, 600)
    .option("--json", "print the result as JSON")
    .option("--verbose", "also print the raw Godot output")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const result = await checkLearning(path, {
          godot: options.godot,
          import: options.import,
          instantiate: options.instantiate,
          runFrames: options.run === undefined ? (options.scene ? 120 : 0) : options.run === true ? 120 : options.run,
          ...(options.scene ? { scene: options.scene } : {}),
          exclude: options.exclude,
          includeAddons: options.includeAddons,
          timeoutMs: options.timeout * 1000,
          keepLogs: options.verbose,
        });
        if (options.json) {
          writeOut(command, `${JSON.stringify(result, null, 2)}\n`);
        } else {
          const lines = Object.entries(result.logs ?? {}).map(([step, log]) => `--- godot ${step} ---\n${log.trim()}`);
          if (result.output !== undefined) {
            const ran = result.ran ? ` (${result.ran.frames} frames = ${result.ran.seconds} s of game time)` : "";
            lines.push(`--- output of the run${ran} ---\n${result.output || "(the game printed nothing)"}\n---`);
          }
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
