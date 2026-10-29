import { Command } from "commander";
import { ProjectNotFoundError } from "../scan/scan.js";
import { SettingsError, editProjectSettings, formatSettingsPlan, type SettingsEdit } from "../settings/edit.js";
import { collect, parseNumber, writeOut } from "./output.js";

interface Common {
  write?: boolean;
  json?: boolean;
}

function run(command: Command, path: string, edit: SettingsEdit, options: Common): void {
  try {
    const plan = editProjectSettings(path, edit, { write: options.write });
    writeOut(command, options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatSettingsPlan(plan));
    if (plan.review && plan.review.after > plan.review.before) process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof SettingsError) && !(error instanceof ProjectNotFoundError)) throw error;
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

const common = (c: Command): Command =>
  c.option("--write", "apply the change (default: only show what would change)").option("--json", "print the plan as JSON");

export function projectCommand(): Command {
  const project = new Command("project").description(
    "change project.godot safely: settings, the input map and autoloads, checked against the Godot 4.7 reference; only the lines of that entry change, and nothing is written without --write",
  );

  project.addCommand(
    common(
      new Command("set")
        .description("set a project setting, e.g. display/window/size/viewport_width 1920 (the type is checked)")
        .argument("<key>", "setting path, e.g. application/run/max_fps")
        .argument("<value>", "the value: true, 60, 1.5, a text, res://path, or Godot text such as Vector2i(1920, 1080)")
        .argument("[path]", "project directory (or any path inside it)", "."),
    ).action((key: string, value: string, path: string, options: Common, command: Command) => run(command, path, { op: "set", key, value }, options)),
  );

  project.addCommand(
    common(
      new Command("unset")
        .description("remove a setting from project.godot, so Godot uses its default")
        .argument("<key>", "setting path")
        .argument("[path]", "project directory (or any path inside it)", "."),
    ).action((key: string, path: string, options: Common, command: Command) => run(command, path, { op: "unset", key }, options)),
  );

  const input = new Command("input").description("add or remove input actions");
  input.addCommand(
    common(
      new Command("add")
        .description("add an input action, or more events to one: --key Space --key Ctrl+S --mouse Left --joy-button A --joy-axis left_y-")
        .argument("<action>", "action name, e.g. jump")
        .argument("[path]", "project directory (or any path inside it)", ".")
        .option("--key <key>", "a key, with modifiers if needed: Space, W, Escape, F5, Ctrl+S (repeatable)", collect, [])
        .option("--mouse <button>", "a mouse button: Left, Right, Middle, WheelUp, WheelDown (repeatable)", collect, [])
        .option("--joy-button <button>", "a joypad button: 0-127 or A, B, X, Y, Start, LeftShoulder, DpadUp (repeatable)", collect, [])
        .option("--joy-axis <axis>", "a joypad axis and direction: 0+, 1-, left_x-, trigger_right+ (repeatable)", collect, [])
        .option("--event <event>", "an event in the notation scan prints: Key:Space, Mouse:Left, JoyButton:0, JoyAxis:1- (repeatable)", collect, [])
        .option("--deadzone <n>", "deadzone of a new action (default 0.2)", parseNumber),
    ).action(
      (
        action: string,
        path: string,
        options: Common & { key: string[]; mouse: string[]; joyButton: string[]; joyAxis: string[]; event: string[]; deadzone?: number },
        command: Command,
      ) => {
        const events = [
          ...options.key.map((k) => `Key:${k}`),
          ...options.mouse.map((m) => `Mouse:${m}`),
          ...options.joyButton.map((b) => `JoyButton:${b}`),
          ...options.joyAxis.map((a) => `JoyAxis:${a}`),
          ...options.event,
        ];
        run(command, path, { op: "input_add", action, events, ...(options.deadzone !== undefined ? { deadzone: options.deadzone } : {}) }, options);
      },
    ),
  );
  input.addCommand(
    common(
      new Command("remove")
        .description("remove an input action (warns when code still uses it)")
        .argument("<action>", "action name")
        .argument("[path]", "project directory (or any path inside it)", "."),
    ).action((action: string, path: string, options: Common, command: Command) => run(command, path, { op: "input_remove", action }, options)),
  );
  project.addCommand(input);

  const autoload = new Command("autoload").description("add or remove autoloads (global singletons)");
  autoload.addCommand(
    common(
      new Command("add")
        .description("add an autoload; the file must exist and be a Node script or a scene, and the name must be free")
        .argument("<name>", "the global name, e.g. Game")
        .argument("<file>", "res:// path of the script or scene")
        .argument("[path]", "project directory (or any path inside it)", ".")
        .option("--no-global", "load it without a global variable (no * in project.godot)"),
    ).action((name: string, file: string, path: string, options: Common & { global: boolean }, command: Command) =>
      run(command, path, { op: "autoload_add", name, file, global: options.global }, options),
    ),
  );
  autoload.addCommand(
    common(
      new Command("remove")
        .description("remove an autoload (warns when code still uses it)")
        .argument("<name>", "the autoload name")
        .argument("[path]", "project directory (or any path inside it)", "."),
    ).action((name: string, path: string, options: Common, command: Command) => run(command, path, { op: "autoload_remove", name }, options)),
  );
  project.addCommand(autoload);
  return project;
}
