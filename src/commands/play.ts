import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { ScenarioError, formatClaims, judgeClaims, parseExpectation } from "../ci/scenario.js";
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
  until?: string;
  signal: string[];
  summary?: boolean;
  expect: string[];
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
    .option("--until <condition>", 'stop at the first frame where this holds, e.g. "Player.is_on_floor() == true"')
    .option("--signal <node.signal>", "record when this signal fires, with its arguments (repeatable)", collect, [])
    .option("--summary", "one line per watched value (start, end, min, max, first change) instead of a table")
    .option("--expect <claim>", 'check a claim, e.g. "Player.health > 0" or "Player.position.y < 1 @ 90" (repeatable; exit 1 when one fails)', collect, [])
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--json", "print the result as JSON")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const claims = options.expect.map(parseExpectation);
        const report = await playScene(path, {
          godot: options.godot,
          ...(options.scene ? { scene: options.scene } : {}),
          ...(options.input ? { input: options.input } : {}),
          watch: [...new Set([...options.watch, ...claims.map((c) => c.watch)])],
          frames: options.frames,
          every: options.summary ? 1 : options.every,
          import: options.import,
          ...(options.until ? { until: options.until } : {}),
          ...(options.signal.length ? { signals: options.signal } : {}),
        });
        const results = judgeClaims(claims, report);
        writeOut(command, options.json ? `${JSON.stringify({ ...report, expect: results }, null, 2)}\n` : formatPlay(report, { summary: options.summary }) + formatClaims(results));
        if (!report.finished || report.diagnostics.some((d) => d.severity === "error") || results.some((r) => !r.ok)) process.exitCode = 1;
      } catch (error) {
        if (error instanceof GodotNotFoundError) {
          process.exitCode = 2;
          throw error;
        }
        if (!(error instanceof PlayError) && !(error instanceof ProjectNotFoundError) && !(error instanceof ScenarioError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
