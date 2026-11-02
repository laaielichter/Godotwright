import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { ScreenshotError, VIEWS, formatScreenshot, takeScreenshot, type View } from "../screenshot/screenshot.js";
import { writeOut } from "./output.js";

interface Options {
  godot?: string;
  scene?: string;
  model?: string;
  view?: View[];
  size?: { width: number; height: number };
  frames?: number;
  out?: string;
  json?: boolean;
  baseline?: string;
  update?: boolean;
  baselineDir?: string;
  tolerance?: number;
  maxChanged?: number;
}

function parseNumber(min: number, max: number) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new InvalidArgumentError(`expected a number from ${min} to ${max}`);
    return n;
  };
}

function parseSize(value: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(value);
  if (!m) throw new InvalidArgumentError("expected WIDTHxHEIGHT, e.g. 640x360");
  return { width: Number(m[1]), height: Number(m[2]) };
}

function parseViews(value: string): View[] {
  const views = value.split(",").map((v) => v.trim()) as View[];
  for (const v of views) if (!VIEWS.includes(v)) throw new InvalidArgumentError(`expected views from ${VIEWS.join(", ")}`);
  return views;
}

export function screenshotCommand(): Command {
  return new Command("screenshot")
    .description("render a scene, or a .glb model framed by a camera, to a PNG with Godot, and say how much of the picture is drawn")
    .argument("[path]", "project directory (or any path inside it); for --model, where relative paths start", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--scene <res-path>", "the scene to render (default: the main scene)")
    .option("--model <file>", "a .glb or .gltf model to look at instead of a scene")
    .option("--view <views>", `camera views for a model or a 3D scene without a camera, comma-separated: ${VIEWS.join(", ")} (default iso; several make a grid)`, parseViews)
    .option("--size <WxH>", "size of one view (default 640x360)", parseSize)
    .option("--frames <n>", "frames to run before the picture (default 10)", (v: string) => Number.parseInt(v, 10))
    .option("-o, --out <file>", "where to write the PNG (default: .godot/godotwright/screenshot.png, or the model name with .png)")
    .option("--baseline <name>", "compare with the baseline of this name in .godotwright/baselines (made when missing; its settings are used), exit code 1 when it changed")
    .option("--update", "with --baseline: replace the baseline with this picture")
    .option("--baseline-dir <dir>", "folder for baselines (default .godotwright/baselines)")
    .option("--tolerance <0-255>", "per-channel difference that still counts as the same pixel (default 16, or the baseline's)", parseNumber(0, 255))
    .option("--max-changed <percent>", "largest share of changed pixels that still passes (default 0.1, or the baseline's)", parseNumber(0, 100))
    .option("--json", "print the result as JSON")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const report = await takeScreenshot(path, {
          godot: options.godot,
          ...(options.scene ? { scene: options.scene } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.view ? { views: options.view } : {}),
          ...(options.size ? { width: options.size.width, height: options.size.height } : {}),
          ...(options.frames !== undefined ? { frames: options.frames } : {}),
          ...(options.out ? { out: options.out } : {}),
          ...(options.baseline ? { baseline: options.baseline } : {}),
          ...(options.update ? { update: true } : {}),
          ...(options.baselineDir ? { baselineDir: options.baselineDir } : {}),
          ...(options.tolerance !== undefined ? { tolerance: options.tolerance } : {}),
          ...(options.maxChanged !== undefined ? { maxChanged: options.maxChanged } : {}),
        });
        if (options.update && !options.baseline) process.stderr.write("--update does nothing without --baseline <name>\n");
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatScreenshot(report, "run again with --update"));
        if (report.baseline && !report.baseline.ok) process.exitCode = 1;
      } catch (error) {
        if (error instanceof GodotNotFoundError) {
          process.exitCode = 2;
          throw error;
        }
        if (!(error instanceof ScreenshotError) && !(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
