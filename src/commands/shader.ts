import { Command, Option } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { formatShaderReport, shaderReport } from "../shader/shader.js";
import { BASE_FILES_HELP, BASE_HELP, collect, parseNumber, writeOut } from "./output.js";

interface Options {
  file: string[];
  compile?: boolean;
  godot?: string;
  timeout: number;
  includeAddons?: boolean;
  gpu?: boolean;
  base: string[];
  baseFiles: string[];
  detail: "brief" | "full";
  json?: boolean;
}

export function shaderCommand(): Command {
  return new Command("shader")
    .description(
      "review every shader (.gdshader, .gdshaderinc, Shader resources in scenes) against Godot 4.7's shader tables, and compile them with Godot headless (--gpu also draws them); errors as file:line",
    )
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--file <res-path>", "only this shader, include or scene (repeatable)", collect, [])
    .option("--compile", "require the Godot compile (fail when Godot is not found)")
    .option("--no-compile", "static review only, without Godot")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--timeout <seconds>", "timeout of the Godot run", parseNumber, 300)
    .option("--include-addons", "also shaders in res://addons/")
    .option("--gpu", "also draw them on the Compatibility renderer (needs a display or xvfb-run), for what only the GPU driver rejects; `godotwright shaders` is this pass alone")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .addOption(new Option("-d, --detail <level>", "output detail (full adds performance hints and the fix of each rule)").choices(["brief", "full"]).default("brief"))
    .option("--json", "print the result as JSON")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const report = await shaderReport(path, {
          ...(options.file.length ? { files: options.file.map((f) => (f.startsWith("res://") ? f : `res://${f.replace(/^\.?\/+/, "")}`)) } : {}),
          ...(options.compile !== undefined ? { compile: options.compile } : {}),
          godot: options.godot,
          timeoutMs: options.timeout * 1000,
          includeAddons: options.includeAddons,
          ...(options.gpu ? { gpu: true } : {}),
          base: options.base,
          baseFiles: options.baseFiles,
        });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatShaderReport(report, options.detail));
        if (report.errors > 0) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError) && !(error instanceof GodotNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
