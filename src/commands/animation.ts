import { Command, InvalidArgumentError } from "commander";
import { AnimationError, editAnimation, formatAnimationPlan, formatAnimationReport, readAnimations, type AnimationEdit, type KeyInput } from "../animation/animation.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { parseNumber, writeOut } from "./output.js";

interface Common {
  write?: boolean;
  json?: boolean;
  project?: string;
  player?: string;
  library?: string;
}

function guard(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof AnimationError) && !(error instanceof ProjectNotFoundError)) throw error;
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

const target = (options: Common) => ({ ...(options.player ? { player: options.player } : {}), ...(options.library !== undefined ? { library: options.library } : {}) });

function run(command: Command, file: string, edit: AnimationEdit, options: Common): void {
  guard(() => {
    const plan = editAnimation(file, { ...edit, ...target(options) }, { write: options.write, ...(options.project ? { project: options.project } : {}) });
    writeOut(command, options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatAnimationPlan(plan));
    if (plan.review && plan.review.after > plan.review.before) process.exitCode = 1;
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidArgumentError("expected JSON");
  }
}

/** A value from the command line: JSON where it is JSON (3, true, {"method": ...}), Godot value text otherwise. */
const looseValue = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "string" ? text : value;
  } catch {
    return text;
  }
};

const where = (c: Command): Command =>
  c
    .option("--player <node>", "path of the AnimationPlayer node (not needed when the scene has one)")
    .option("--library <name>", 'the player\'s animation library (default: "")')
    .option("--project <path>", "project directory, for a res:// path (default: the current directory)")
    .option("--json", "print the result as JSON");

const common = (c: Command): Command => where(c).option("--write", "apply the change (default: only show what would change)");

const timing = (c: Command): Command =>
  c.option("--length <seconds>", "length in seconds", parseNumber).option("--loop <mode>", "none, linear or pingpong").option("--step <seconds>", "snap step in seconds", parseNumber);
const timingOf = (o: { length?: number; loop?: string; step?: number }) => ({
  ...(o.length === undefined ? {} : { length: o.length }),
  ...(o.loop === undefined ? {} : { loop_mode: o.loop as "none" }),
  ...(o.step === undefined ? {} : { step: o.step }),
});

const FILE = "a .tscn with an AnimationPlayer, an AnimationLibrary .tres or an Animation .tres (a file path, or res:// with --project)";
const TRACK = "the track's number, or its path";

export function animationCommand(): Command {
  const animation = new Command("animation").description(
    "read and write animations without Godot: the animations of an AnimationPlayer with their tracks and keys, create one, add value and method tracks, set and remove keys; track paths and properties are checked against the scene and Godot 4.7, and nothing is written without --write",
  );

  animation.addCommand(
    where(new Command("read").description("the animations with their length, loop mode, tracks and keys").argument("<file>", FILE).option("--animation <name>", "only this animation")).action(
      (file: string, options: Common & { animation?: string }, command: Command) =>
        guard(() => {
          const report = readAnimations(file, { ...target(options), ...(options.animation ? { animation: options.animation } : {}) }, options.project ? { project: options.project } : {});
          writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatAnimationReport(report));
        }),
    ),
  );

  animation.addCommand(
    timing(common(new Command("create").description("a new animation in the player's library (the library is made when the player has none)").argument("<file>", FILE).argument("<name>", "name of the animation"))).action(
      (file: string, name: string, options: Common & { length?: number; loop?: string; step?: number }, command: Command) => run(command, file, { op: "create", name, ...timingOf(options) }, options),
    ),
  );

  animation.addCommand(
    common(
      new Command("add-track")
        .description(`add a track: animation add-track hero.tscn run Sprite2D:position --keys '[{"time":0,"value":"Vector2(0, 0)"},{"time":0.5,"value":"Vector2(40, 0)"}]'`)
        .argument("<file>", FILE)
        .argument("<animation>", "name of the animation")
        .argument("<path>", "Node:property for a value track, the node for a method track (from the player's root node)")
        .requiredOption("--keys <json>", 'the keys: [{"time": 0, "value": ...}], for a method track [{"time": 0, "method": "name", "args": []}]', parseJson)
        .option("--type <type>", "value or method", "value")
        .option("--interp <mode>", "nearest, linear or cubic (default: linear)")
        .option("--update <mode>", "continuous, discrete or capture"),
    ).action((file: string, name: string, path: string, options: Common & { keys: unknown; type: string; interp?: string; update?: string }, command: Command) =>
      run(command, file, { op: "add_track", animation: name, path, type: options.type as "value", keys: options.keys as KeyInput[], ...(options.interp ? { interp: options.interp } : {}), ...(options.update ? { update: options.update } : {}) }, options),
    ),
  );

  animation.addCommand(
    common(
      new Command("set-key")
        .description("set the key at a time (a new key when there is none): animation set-key hero.tscn run 0 0.25 'Vector2(20, 0)'")
        .argument("<file>", FILE)
        .argument("<animation>", "name of the animation")
        .argument("<track>", TRACK)
        .argument("<time>", "time in seconds", parseNumber)
        .argument("<value>", 'the value: 3, true, "Vector2(10, 20)", or for a method track {"method": "name", "args": []}')
        .option("--transition <n>", "easing of the key (1 is linear)", parseNumber),
    ).action((file: string, name: string, track: string, time: number, value: string, options: Common & { transition?: number }, command: Command) =>
      run(command, file, { op: "set_key", animation: name, track, time, value: looseValue(value), ...(options.transition === undefined ? {} : { transition: options.transition }) }, options),
    ),
  );

  animation.addCommand(
    common(new Command("remove-key").description("remove the key at a time").argument("<file>", FILE).argument("<animation>", "name of the animation").argument("<track>", TRACK).argument("<time>", "time in seconds", parseNumber)).action(
      (file: string, name: string, track: string, time: number, options: Common, command: Command) => run(command, file, { op: "remove_key", animation: name, track, time }, options),
    ),
  );

  animation.addCommand(
    common(new Command("remove-track").description("remove a track; the tracks after it move up one number").argument("<file>", FILE).argument("<animation>", "name of the animation").argument("<track>", TRACK)).action(
      (file: string, name: string, track: string, options: Common, command: Command) => run(command, file, { op: "remove_track", animation: name, track }, options),
    ),
  );

  animation.addCommand(
    common(new Command("remove").description("remove an animation from the library").argument("<file>", FILE).argument("<animation>", "name of the animation")).action(
      (file: string, name: string, options: Common, command: Command) => run(command, file, { op: "remove", animation: name }, options),
    ),
  );

  animation.addCommand(
    timing(common(new Command("set").description("set the length, loop mode or step of an animation").argument("<file>", FILE).argument("<animation>", "name of the animation"))).action(
      (file: string, name: string, options: Common & { length?: number; loop?: string; step?: number }, command: Command) => run(command, file, { op: "set", animation: name, ...timingOf(options) }, options),
    ),
  );
  return animation;
}
