import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { lessonHintsForMessages } from "../lessons/hints.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { checkShaders, formatShaderCheck, ShaderCheckError } from "../shaders/shaders.js";
import { collect, parseNumber, writeOut } from "./output.js";

interface Options {
  godot?: string;
  file: string[];
  exclude: string[];
  includeAddons?: boolean;
  import: boolean;
  frames: number;
  timeout: number;
  json?: boolean;
  verbose?: boolean;
}

function parseFrames(value: string): number {
  const frames = Number(value);
  if (!Number.isInteger(frames) || frames < 1 || frames > 60) throw new InvalidArgumentError("expected a whole number from 1 to 60");
  return frames;
}

function parseSeconds(value: string): number {
  const seconds = parseNumber(value);
  if (seconds <= 0) throw new InvalidArgumentError("expected a number above 0");
  return seconds;
}

export function shadersCommand(): Command {
  return new Command("shaders")
    .description("compile every shader with real Godot (Compatibility renderer, xvfb-run on Linux without a display) and report errors at the line in the .gdshader, .gdshaderinc or .tres/.tscn")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--file <path>", "only this shader file (repeatable); a .gdshaderinc checks every shader that includes it", collect, [])
    .option("--exclude <dir>", "directory to skip (repeatable); res://addons/ is skipped already", collect, [])
    .option("--include-addons", "also compile the shaders in res://addons/")
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--frames <n>", "frames each shader is drawn", parseFrames, 2)
    .option("--timeout <seconds>", "timeout per Godot run", parseSeconds, 600)
    .option("--json", "print the result as JSON")
    .option("--verbose", "also print the raw Godot output")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const result = await checkShaders(path, {
          ...(options.godot ? { godot: options.godot } : {}),
          files: options.file,
          exclude: options.exclude,
          includeAddons: Boolean(options.includeAddons),
          import: options.import,
          frames: options.frames,
          timeoutMs: options.timeout * 1000,
          keepLogs: Boolean(options.verbose),
        });
        if (options.json) {
          writeOut(command, `${JSON.stringify(result, null, 2)}\n`);
        } else {
          const logs = Object.entries(result.logs ?? {}).map(([step, log]) => `--- godot ${step} ---\n${log.trim()}\n`).join("");
          const lessons = lessonHintsForMessages(result.diagnostics.map((d) => d.message));
          writeOut(command, logs + formatShaderCheck(result) + (lessons.length ? `${lessons.join("\n")}\n` : ""));
        }
        if (result.errors > 0) process.exitCode = 1;
      } catch (error) {
        if (error instanceof ShaderCheckError || error instanceof ProjectNotFoundError) {
          process.stderr.write(`${error.message}\n`);
          process.exitCode = 2;
          return;
        }
        if (error instanceof GodotNotFoundError) process.exitCode = 2;
        throw error;
      }
    });
}
