import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { DEFAULT_THRESHOLD, DEFAULT_TOLERANCE, ScreenshotError, VIEWS, formatScreenshot, takeScreenshot, type View } from "../screenshot/screenshot.js";
import { writeOut } from "./output.js";

interface Options {
  godot?: string;
  scene?: string;
  model?: string;
  view?: View[];
  size?: { width: number; height: number };
  frames?: number;
  out?: string;
  baseline?: string | true;
  threshold?: number;
  tolerance?: number;
  updateBaseline?: boolean;
  baselineDir?: string;
  json?: boolean;
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
    .description("render a scene, or a .glb model framed by a camera, to a PNG with Godot, and say how much of the picture is drawn; with --baseline, compare it with the last approved picture")
    .argument("[path]", "project directory (or any path inside it); for --model, where relative paths start", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--scene <res-path>", "the scene to render (default: the main scene)")
    .option("--model <file>", "a .glb or .gltf model to look at instead of a scene")
    .option("--view <views>", `camera views for a model or a 3D scene without a camera, comma-separated: ${VIEWS.join(", ")} (default iso; several make a grid)`, parseViews)
    .option("--size <WxH>", "size of one view (default 640x360)", parseSize)
    .option("--frames <n>", "frames to run before the picture (default 10)", (v: string) => Number.parseInt(v, 10))
    .option("-o, --out <file>", "where to write the PNG (default: .godot/godotwright/screenshot.png, or the model name with .png)")
    .option("--baseline [file-or-name]", "compare with a baseline, saved on the first run: no value is .godotwright/baselines/<scene or model>-<hash>@<size>_<views>.png, a .png is that file, a name (hud) is .godotwright/baselines/hud.png with its scene, size, views and frames in hud.json; exit code 1 when it changed")
    .option("--threshold <percent>", `percent of pixels that may change (default ${DEFAULT_THRESHOLD}, or the named baseline's)`, parseNumber(0, 100))
    .option("--tolerance <0-255>", `how far a pixel's colour may move before it counts as changed (default ${DEFAULT_TOLERANCE}, or the named baseline's)`, parseNumber(0, 255))
    .option("--update-baseline", "write the new picture as the baseline instead of comparing (default file as --baseline)")
    .option("--baseline-dir <dir>", "folder for named baselines (default .godotwright/baselines)")
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
          ...(options.baseline !== undefined ? { baseline: options.baseline === true ? "auto" : options.baseline } : {}),
          ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
          ...(options.tolerance !== undefined ? { tolerance: options.tolerance } : {}),
          ...(options.updateBaseline ? { updateBaseline: true } : {}),
          ...(options.baselineDir ? { baselineDir: options.baselineDir } : {}),
        });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatScreenshot(report, "run again with --update-baseline"));
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
