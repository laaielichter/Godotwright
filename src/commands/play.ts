import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { PlayError, formatPlay, playScene } from "../play/play.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { collect, writeOut } from "./output.js";

interface Options {
  godot?: string;
  scene?: string;
  input?: string;
  watch: string[];
  frames: number;
  every: number;
  import: boolean;
  json?: boolean;
}

function whole(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("expected a whole number above 0");
  return n;
}

export function playCommand(): Command {
  return new Command("play")
    .description(
      'run a scene headless for a number of physics frames, play an input timeline into it, and print the values you watch per frame: play --input "10 tap jump; 20 hold right 30" --watch Player.position --watch Player.is_on_floor()',
    )
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--scene <res-path>", "the scene to run (default: the main scene)")
    .option("--input <timeline>", 'frame and action, ";" between steps: "10 press jump; 30 release jump; 40 hold right 20; 50 tap Key:Space"')
    .option("--watch <node.property>", "a value to sample, e.g. Player.position, Player.velocity.y, Player.is_on_floor() (repeatable)", collect, [])
    .option("--frames <n>", "physics frames to run (default 120)", whole, 120)
    .option("--every <n>", "sample every n frames (default 10); frames with input and the last frame are always sampled", whole, 10)
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--json", "print the result as JSON")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const report = await playScene(path, {
          godot: options.godot,
          ...(options.scene ? { scene: options.scene } : {}),
          ...(options.input ? { input: options.input } : {}),
          watch: options.watch,
          frames: options.frames,
          every: options.every,
          import: options.import,
        });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatPlay(report));
        if (!report.finished || report.diagnostics.some((d) => d.severity === "error")) process.exitCode = 1;
      } catch (error) {
        if (error instanceof GodotNotFoundError) {
          process.exitCode = 2;
          throw error;
        }
        if (!(error instanceof PlayError) && !(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
