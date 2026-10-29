import { Command } from "commander";
import { ProjectNotFoundError } from "../scan/scan.js";
import { SceneError, editScene, formatScenePlan, type SceneEdit } from "../scene/edit.js";
import { writeOut } from "./output.js";

interface Common {
  write?: boolean;
  json?: boolean;
  project?: string;
}

function run(command: Command, scene: string, edit: SceneEdit, options: Common): void {
  try {
    const plan = editScene(scene, edit, { write: options.write, ...(options.project ? { project: options.project } : {}) });
    writeOut(command, options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatScenePlan(plan));
    if (plan.review && plan.review.after > plan.review.before) process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof SceneError) && !(error instanceof ProjectNotFoundError)) throw error;
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

const common = (c: Command): Command =>
  c
    .option("--write", "apply the change (default: only show what would change)")
    .option("--json", "print the plan as JSON")
    .option("--project <path>", "project directory, for a res:// scene path (default: the current directory)");

const SCENE = "the .tscn file (a file path, or res:// with --project)";

export function sceneCommand(): Command {
  const scene = new Command("scene").description(
    "change a .tscn safely: add or remove nodes, set properties, connect signals, attach scripts; checked against the Godot 4.7 reference and the project, only the lines of that change are touched, and nothing is written without --write",
  );

  scene.addCommand(
    common(
      new Command("add")
        .description("add a node: scene add main.tscn . Music AudioStreamPlayer, or an instance: scene add main.tscn . Enemy res://enemy.tscn")
        .argument("<scene>", SCENE)
        .argument("<parent>", 'path of the parent node ("." is the root)')
        .argument("<name>", "name of the new node")
        .argument("<type>", "a Godot node class, or a res:// scene to instance"),
    ).action((file: string, parent: string, name: string, type: string, options: Common, command: Command) =>
      run(command, file, { op: "add_node", parent, name, ...(type.startsWith("res://") ? { instance: type } : { type }) }, options),
    ),
  );

  scene.addCommand(
    common(
      new Command("remove")
        .description("remove a node with its children, its connections and the resources only it used")
        .argument("<scene>", SCENE)
        .argument("<node>", "path of the node"),
    ).action((file: string, node: string, options: Common, command: Command) => run(command, file, { op: "remove_node", node }, options)),
  );

  scene.addCommand(
    common(
      new Command("set")
        .description("set a property: the name and type are checked (an enum takes its name, a resource a res:// file)")
        .argument("<scene>", SCENE)
        .argument("<node>", 'path of the node ("." is the root)')
        .argument("<property>", "property name, e.g. position or wait_time")
        .argument("<value>", "the value: 3, true, Vector2(10, 20), ALWAYS, res://icon.svg, null"),
    ).action((file: string, node: string, property: string, value: string, options: Common, command: Command) =>
      run(command, file, { op: "set", node, property, value }, options),
    ),
  );

  for (const op of ["connect", "disconnect"] as const) {
    scene.addCommand(
      common(
        new Command(op)
          .description(op === "connect" ? "connect a signal to a method; checks the signal exists and the method takes its arguments" : "remove a signal connection")
          .argument("<scene>", SCENE)
          .argument("<from>", "path of the node that emits")
          .argument("<signal>", "signal name")
          .argument("<to>", "path of the node that receives")
          .argument("<method>", "method name"),
      ).action((file: string, from: string, signal: string, to: string, method: string, options: Common, command: Command) =>
        run(command, file, { op, from, signal, to, method }, options),
      ),
    );
  }

  scene.addCommand(
    common(
      new Command("script")
        .description("attach a script to a node; refuses a script that extends another node type")
        .argument("<scene>", SCENE)
        .argument("<node>", 'path of the node ("." is the root)')
        .argument("<script>", "res:// path of the .gd or .cs file"),
    ).action((file: string, node: string, script: string, options: Common, command: Command) => run(command, file, { op: "attach_script", node, script }, options)),
  );
  return scene;
}
