import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { formatDiagnostic } from "../check/log.js";
import { PlayError } from "../play/play.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { formatGame, formatStart } from "../session/format.js";
import { gameRequest, newDiagnostics, readSession, reloadScripts, startSession, stepPayload, stopSession } from "../session/session.js";
import { collect, writeOut } from "./output.js";

function whole(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("expected a whole number above 0");
  return n;
}

async function guarded(command: Command, run: () => Promise<string>): Promise<void> {
  try {
    writeOut(command, await run());
  } catch (error) {
    if (error instanceof GodotNotFoundError) {
      process.exitCode = 2;
      throw error;
    }
    if (!(error instanceof PlayError) && !(error instanceof ProjectNotFoundError) && !(error instanceof Error && "code" in error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export function sessionCommand(): Command {
  const session = new Command("session").description("a game session that stays up between commands: the scene loads once, paused; `godotwright game` asks it things and steps it");
  session
    .command("start")
    .description("load a scene headless and keep it running, paused at frame 0")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--scene <res-path>", "the scene (default: the main scene)")
    .option("--godot <path>", "Godot binary")
    .option("--idle <minutes>", "quit after this many minutes without a command (default 15)", whole, 15)
    .option("--restart", "stop a running session and load the scene again")
    .option("--no-import", "skip the import step")
    .action((path: string, o: { scene?: string; godot?: string; idle: number; restart?: boolean; import: boolean }, command: Command) =>
      guarded(command, async () => formatStart(await startSession(path, { godot: o.godot, ...(o.scene ? { scene: o.scene } : {}), idleMinutes: o.idle, restart: o.restart, import: o.import }))),
    );
  session
    .command("stop")
    .description("stop the running session")
    .argument("[path]", "project directory", ".")
    .action((path: string, _o: unknown, command: Command) => guarded(command, async () => ((await stopSession(path)) ? "session stopped\n" : "no session was running\n")));
  session
    .command("status")
    .description("is a session running, and where is it")
    .argument("[path]", "project directory", ".")
    .action((path: string, _o: unknown, command: Command) =>
      guarded(command, async () => {
        if (!readSession(path)) return "no session is running\n";
        const { reply, diagnostics } = await gameRequest(path, "status");
        return formatGame("status", reply, diagnostics);
      }),
    );
  return session;
}

export function gameCommand(): Command {
  const game = new Command("game").description("ask the running game session (see `godotwright session start`): tree, get, set, call, eval, step, signals, layout, ray, ui, reload, errors");
  const path = (c: Command) => (c.optsWithGlobals() as { path?: string }).path ?? ".";
  game.option("--path <dir>", "project directory (default: the current one)");
  game
    .command("tree")
    .description("the live node tree: path, class and script per node")
    .option("--root <node>", "start at this node (default: the scene root)")
    .option("--depth <n>", "levels to show (default 3)", whole, 3)
    .option("--limit <n>", "nodes to show (default 80)", whole, 80)
    .action((o: { root?: string; depth: number; limit: number }, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "tree", { root: o.root ?? ".", depth: o.depth, limit: o.limit });
        return formatGame("tree", reply, diagnostics);
      }),
    );
  game
    .command("get")
    .description("read values now: Hero.position, Hero.is_on_floor()")
    .argument("<watch...>", "Node.property or Node.method()")
    .action((watch: string[], _o: unknown, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "get", { watch });
        return formatGame("get", reply, diagnostics);
      }),
    );
  game
    .command("set")
    .description('set a value: set Hero.position "Vector3(0, 30, 0)"')
    .argument("<target>", "Node.property")
    .argument("<value>", "a Godot value as text: 3, true, Vector3(0, 1, 0), \"text\"")
    .action((target: string, value: string, _o: unknown, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "set", { path: target, value });
        return formatGame("set", reply, diagnostics);
      }),
    );
  game
    .command("call")
    .description("call a method on a node: call Hero jump")
    .argument("<node>", "node path from the scene root (. for the root)")
    .argument("<method>", "method name")
    .argument("[args...]", "arguments as Godot values")
    .action((node: string, method: string, args: string[], _o: unknown, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "call", { node, method, args });
        return formatGame("call", reply, diagnostics);
      }),
    );
  game
    .command("eval")
    .description("evaluate a Godot Expression with the scene root as base: get_node(\"Hero\").velocity.length()")
    .argument("<expr>", "the expression (scene and tree are available as names)")
    .action((expr: string, _o: unknown, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "eval", { expr });
        return formatGame("eval", reply, diagnostics);
      }),
    );
  game
    .command("step")
    .description("play frames: input on frames counted from this step, values sampled, stop early when --until holds")
    .argument("<frames>", "physics frames to run", whole)
    .option("--input <timeline>", '"0 press jump; 10 release jump; 20 hold right 30"')
    .option("--watch <node.property>", "a value to sample (repeatable)", collect, [])
    .option("--every <n>", "sample every n frames (default: about 10 samples)", whole)
    .option("--until <condition>", '"Hero.is_on_floor() == true"')
    .action((frames: number, o: { input?: string; watch: string[]; every?: number; until?: string }, c: Command) =>
      guarded(c, async () => {
        const payload = stepPayload({ frames, ...(o.input ? { input: o.input } : {}), watch: o.watch, ...(o.every ? { every: o.every } : {}), ...(o.until ? { until: o.until } : {}) });
        const { reply, diagnostics } = await gameRequest(path(c), "step", payload, Math.max(60_000, frames * 200));
        return formatGame("step", reply, diagnostics, o.watch);
      }),
    );
  game
    .command("signals")
    .description("record these signals from now on; each step lists them with the frame they fired on")
    .argument("<signals...>", "Node.signal")
    .action((signals: string[], _o: unknown, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "signals", { signals });
        return formatGame("signals", reply, diagnostics);
      }),
    );
  game
    .command("layout")
    .description("where 3D things really are: global position, size, lowest point, and whether they rest on, float above or sink into what is below")
    .option("--root <node>", "start at this node (default: the scene root)")
    .option("--limit <n>", "objects to show (default 60)", whole, 60)
    .action((o: { root?: string; limit: number }, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "layout", { root: o.root ?? ".", limit: o.limit });
        return formatGame("layout", reply, diagnostics);
      }),
    );
  game
    .command("ray")
    .description('cast a physics ray: ray "Vector3(0, 10, 0)" "Vector3(0, -10, 0)" (or two Vector2 in 2D)')
    .argument("<from>", "start, as Godot writes a vector")
    .argument("<to>", "end")
    .action((from: string, to: string, _o: unknown, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "ray", { from, to });
        return formatGame("ray", reply, diagnostics);
      }),
    );
  game
    .command("ui")
    .description("visible controls with their rectangles, and clipped text, off-screen panels, overlapping buttons and small targets, at one or more window sizes")
    .option("--size <WxH>", "a window size, e.g. 1280x720 (repeatable; default the project's size)", collect, [])
    .option("--brief", "only the issues, not every control")
    .action((o: { size: string[]; brief?: boolean }, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics } = await gameRequest(path(c), "ui", { sizes: o.size });
        return formatGame("ui", reply, diagnostics, [], !o.brief);
      }),
    );
  game
    .command("reload")
    .description("load edited scripts into the running game: every node keeps its values and runs the new code from the next step")
    .argument("[files...]", "res:// scripts (default: every script changed since the session started or the last reload)")
    .action((files: string[], _o: unknown, c: Command) =>
      guarded(c, async () => {
        const { reply, diagnostics, others } = await reloadScripts(path(c), files);
        return formatGame("reload", { ...reply, others }, diagnostics);
      }),
    );
  game
    .command("errors")
    .description("errors and warnings the game printed since the last command, with their call chains")
    .action((_o: unknown, c: Command) =>
      guarded(c, async () => {
        const diagnostics = newDiagnostics(path(c));
        return diagnostics.length ? `${diagnostics.map(formatDiagnostic).join("\n")}\n` : "no new errors or warnings\n";
      }),
    );
  return game;
}
