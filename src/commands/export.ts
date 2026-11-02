import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { checkExport, formatExportCheck } from "../export/export.js";
import { patchExport } from "../export/patch.js";
import { formatExportRun, inspectPack, runExport, smokePack, type ExportRun } from "../export/run.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { collect, parseNumber, writeOut } from "./output.js";

function parseFrames(value: string): number {
  const n = parseNumber(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("expected a whole number of frames (0 = no smoke run)");
  return n;
}

function parseSeconds(value: string): number {
  const n = parseNumber(value);
  if (n <= 0) throw new InvalidArgumentError("expected a number above 0");
  return n;
}

function parseMode(value: string): "pack" | "release" | "debug" {
  if (value !== "pack" && value !== "release" && value !== "debug") throw new InvalidArgumentError("expected pack, release or debug");
  return value;
}

/** Prints a run's result and sets the exit code; reports a missing project or Godot as a plain error. */
async function report(command: Command, json: boolean | undefined, work: () => Promise<ExportRun> | ExportRun): Promise<void> {
  try {
    const result = await work();
    writeOut(command, json ? `${JSON.stringify(result, null, 2)}\n` : formatExportRun(result));
    if (result.errors > 0) process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof ProjectNotFoundError) && !(error instanceof GodotNotFoundError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

const GODOT_HELP = "Godot binary (default: $GODOT, then PATH, then the usual install folders)";

export function exportCommand(): Command {
  const command = new Command("export")
    .enablePositionalOptions()
    .description("check what the exported game will hold against what the code and scenes load: files exclude_filter leaves out, plain data files (JSON, CSV, text) missing from include_filter, paths built under an excluded folder, and whether export templates are installed; `export run`, `patch`, `smoke` and `pck` export for real and check the result")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--preset <name>", "only this preset (its name or number)")
    .option("--json", "print the result as JSON")
    .action((path: string, options: { preset?: string; json?: boolean }, cmd: Command) => {
      try {
        const result = checkExport(path, options.preset ? { preset: options.preset } : {});
        writeOut(cmd, options.json ? `${JSON.stringify(result, null, 2)}\n` : formatExportCheck(result));
        if (result.problems.some((p) => p.severity === "error")) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });

  command
    .command("run")
    .description("export a preset headless (pack needs no templates; release and debug do), check the file is there, compare the pack with what the game loads (missing files with their chain, editor-only and test files shipped), then run the exported game headless for some frames and report its errors with call chains; exit 1 on any error")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .requiredOption("--preset <name>", "the preset (its name or number)")
    .option("--mode <mode>", "pack, release or debug", parseMode, "pack")
    .option("--out <file>", "output file (default .godot/godotwright/export/<preset>/..., so the preset's own export_path is left alone)")
    .option("--frames <n>", "frames to run the exported game for (0 = no smoke run)", parseFrames, 120)
    .option("--no-import", "skip the import step")
    .option("--godot <path>", GODOT_HELP)
    .option("--timeout <seconds>", "timeout per Godot run", parseSeconds, 600)
    .option("--json", "print the result as JSON")
    .action(async (path: string, o: { preset: string; mode: "pack" | "release" | "debug"; out?: string; frames: number; import: boolean; godot?: string; timeout: number; json?: boolean }, cmd: Command) =>
      report(cmd, o.json, () =>
        runExport(path, { preset: o.preset, mode: o.mode, ...(o.out ? { out: o.out } : {}), frames: o.frames, import: o.import, ...(o.godot ? { godot: o.godot } : {}), timeoutMs: o.timeout * 1000 }),
      ),
    );

  command
    .command("patch")
    .description("export a patch .pck with only what changed: Godot's --export-patch against base packs (--against, or the preset's patches), or cut from a full export by a list of the base game's files with md5 (--manifest, or godotwright.json baseFiles); checks the patch never ships an unchanged base file and never misses a changed one, lists every file it carries, and runs base + patch headless")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .requiredOption("--preset <name>", "the preset (its name or number)")
    .option("--against <pck>", "a base .pck, in load order (repeatable)", collect, [])
    .option("--manifest <file>", "a list of the base game's files: JSON with resource/path and md5, or one path per line (repeatable)", collect, [])
    .option("--out <file>", "output .pck (default .godot/godotwright/export/<preset>/<preset>-patch.pck)")
    .option("--frames <n>", "frames to run the patched game for (0 = no smoke run)", parseFrames, 120)
    .option("--no-import", "skip the import step")
    .option("--godot <path>", GODOT_HELP)
    .option("--timeout <seconds>", "timeout per Godot run", parseSeconds, 600)
    .option("--json", "print the result as JSON")
    .action(async (path: string, o: { preset: string; against: string[]; manifest: string[]; out?: string; frames: number; import: boolean; godot?: string; timeout: number; json?: boolean }, cmd: Command) =>
      report(cmd, o.json, () =>
        patchExport(path, { preset: o.preset, against: o.against, manifest: o.manifest, ...(o.out ? { out: o.out } : {}), frames: o.frames, import: o.import, ...(o.godot ? { godot: o.godot } : {}), timeoutMs: o.timeout * 1000 }),
      ),
    );

  command
    .command("smoke")
    .description("run an exported .pck (or a game executable with the pack inside) headless for some frames with --main-pack, and report its errors with call chains")
    .argument("<pck>", "the .pck or exported executable")
    .option("--path <dir>", "the project (for its physics rate; default: found from the pack's folder)")
    .option("--frames <n>", "frames to run", parseFrames, 120)
    .option("--godot <path>", GODOT_HELP)
    .option("--timeout <seconds>", "timeout of the run", parseSeconds, 600)
    .option("--json", "print the result as JSON")
    .action(async (pck: string, o: { path?: string; frames: number; godot?: string; timeout: number; json?: boolean }, cmd: Command) =>
      report(cmd, o.json, () => smokePack(pck, { ...(o.path ? { path: o.path } : {}), frames: o.frames, ...(o.godot ? { godot: o.godot } : {}), timeoutMs: o.timeout * 1000 })),
    );

  command
    .command("pck")
    .description("list what a .pck (or a game executable with the pack inside) holds and compare it with the project, without Godot: files the game loads that are missing, editor-only and test files shipped; format 2 to 4, encrypted directories detected")
    .argument("<file>", "the .pck or exported executable")
    .option("--path <dir>", "the project it was exported from (default: the current folder)")
    .option("--preset <name>", "the preset it was exported with (for the causes of missing files)")
    .option("--json", "print the result as JSON")
    .action(async (file: string, o: { path?: string; preset?: string; json?: boolean }, cmd: Command) =>
      report(cmd, o.json, () => inspectPack(file, { ...(o.path ? { path: o.path } : {}), ...(o.preset ? { preset: o.preset } : {}) })),
    );
  return command;
}
