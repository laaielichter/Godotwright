import { Command, Option } from "commander";
import { doctorProject, formatDoctor } from "../doctor/doctor.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { collect, writeOut } from "./output.js";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description(
      "what is wrong in this project and in which order to fix it: the review and Godot (when installed) grouped by cause, the lessons that explain each problem, which ones `fix` can do, and the next steps",
    )
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--file <res-path>", "only problems in this res:// file (repeatable)", collect, [])
    .option("--symptom <words>", "what you see going wrong, e.g. \"helicopter bounces on the ship\": adds the lessons for it")
    .option("--no-godot", "do not run Godot, even when it is installed")
    .option("--godot <path>", "Godot binary (default: $GODOT, PATH or the usual install folders)")
    .option("--limit <n>", "problems shown in full (default 12)", (v) => Number.parseInt(v, 10), 12)
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("--json", "print the report as JSON")
    .action(async (path: string, options: { file: string[]; symptom?: string; godot: boolean | string; limit: number; detail: "brief" | "full"; json?: boolean }, command: Command) => {
      try {
        const report = await doctorProject(path, {
          ...(options.file.length ? { files: options.file } : {}),
          ...(options.symptom ? { symptom: options.symptom } : {}),
          godot: options.godot !== false,
          ...(typeof options.godot === "string" ? { godotPath: options.godot } : {}),
          limit: options.limit,
        });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report, options.detail));
        if (report.problems.some((p) => p.severity === "error")) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
