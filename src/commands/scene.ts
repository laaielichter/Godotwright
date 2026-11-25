import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import { ProjectNotFoundError } from "../scan/scan.js";
import { SceneError, editScene, formatScenePlan, type NewNode, type SceneEdit } from "../scene/edit.js";
import { writeOut } from "./output.js";

interface Common {
  write?: boolean;
  makeEditable?: boolean;
  json?: boolean;
  project?: string;
}

function run(command: Command, scene: string, edit: SceneEdit | (() => SceneEdit), options: Common): void {
  try {
    const plan = editScene(scene, typeof edit === "function" ? edit() : edit, { write: options.write, ...(options.project ? { project: options.project } : {}) });
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

/** For changes that may land inside an instanced scene. */
const editableOption = (c: Command): Command => c.option("--make-editable", "when the change is inside an instanced scene, also make it editable");
const make = (options: Common) => (options.makeEditable ? { makeEditable: true } : {});

const SCENE = "the .tscn file (a file path, or res:// with --project)";

export function sceneCommand(): Command {
  const scene = new Command("scene").description(
    "change a .tscn safely: make a scene, add (one or many), remove, rename, move or duplicate nodes, set properties and groups, connect signals, attach scripts; checked against the Godot 4.7 reference and the project, only the lines of that change are touched, and nothing is written without --write",
  );

  scene.addCommand(
    editableOption(common(
      new Command("add")
        .description("add a node: scene add main.tscn . Music AudioStreamPlayer, or an instance: scene add main.tscn . Enemy res://enemy.tscn")
        .argument("<scene>", SCENE)
        .argument("<parent>", 'path of the parent node ("." is the root)')
        .argument("<name>", "name of the new node")
        .argument("<type>", "a Godot node class, or a res:// scene to instance"),
    )).action((file: string, parent: string, name: string, type: string, options: Common, command: Command) =>
      run(command, file, { op: "add_node", parent, name, ...(type.startsWith("res://") ? { instance: type } : { type }), ...make(options) }, options),
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
    editableOption(common(
      new Command("set")
        .description("set a property: the name and type are checked (an enum takes its name, a resource a res:// file)")
        .argument("<scene>", SCENE)
        .argument("<node>", 'path of the node ("." is the root)')
        .argument("<property>", "property name, e.g. position or wait_time")
        .argument("<value>", "the value: 3, true, Vector2(10, 20), ALWAYS, res://icon.svg, null"),
    )).action((file: string, node: string, property: string, value: string, options: Common, command: Command) =>
      run(command, file, { op: "set", node, property, value, ...make(options) }, options),
    ),
  );

  for (const op of ["connect", "disconnect"] as const) {
    scene.addCommand(
      editableOption(common(
        new Command(op)
          .description(op === "connect" ? "connect a signal to a method; checks the signal exists and the method takes its arguments" : "remove a signal connection")
          .argument("<scene>", SCENE)
          .argument("<from>", "path of the node that emits")
          .argument("<signal>", "signal name")
          .argument("<to>", "path of the node that receives")
          .argument("<method>", "method name"),
      )).action((file: string, from: string, signal: string, to: string, method: string, options: Common, command: Command) =>
        run(command, file, op === "connect" ? { op, from, signal, to, method, ...make(options) } : { op, from, signal, to, method }, options),
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
  scene.addCommand(
    common(
      new Command("editable")
        .description("let this scene change the children of an instanced scene ([editable path=...], Editable Children in the editor); --off removes it")
        .argument("<scene>", SCENE)
        .argument("<node>", "path of the instanced scene's node")
        .option("--off", "make it not editable again"),
    ).action((file: string, node: string, options: Common & { off?: boolean }, command: Command) => run(command, file, { op: "set_editable", node, editable: !options.off }, options)),
  );

  scene.addCommand(
    common(
      new Command("create")
        .description("make a new scene with a root node and a fresh uid: scene create levels/cave.tscn Node2D Cave --script res://cave.gd; never overwrites a file")
        .argument("<scene>", "the new .tscn file (a file path, or res:// with --project)")
        .argument("<type>", "the root's Godot node class, or a res:// scene to inherit from")
        .argument("[name]", "name of the root node (default: the file name in PascalCase)")
        .option("--script <file>", "res:// path of a script for the root"),
    ).action((file: string, type: string, name: string | undefined, options: Common & { script?: string }, command: Command) =>
      run(command, file, { op: "create_scene", ...(type.startsWith("res://") ? { instance: type } : { type }), ...(name ? { name } : {}), ...(options.script ? { script: options.script } : {}) }, options),
    ),
  );

  scene.addCommand(
    common(
      new Command("rename")
        .description("rename a node in this scene: its children, connections, [editable] entries and NodePath values follow; scripts that name it are listed, not changed")
        .argument("<scene>", SCENE)
        .argument("<node>", 'path of the node ("." is the root)')
        .argument("<name>", "the new name"),
    ).action((file: string, node: string, name: string, options: Common, command: Command) => run(command, file, { op: "rename_node", node, name }, options)),
  );

  scene.addCommand(
    editableOption(common(
      new Command("move")
        .description("move a node with its children under another parent, or to another place among its siblings: scene move main.tscn Gun Player --index 0, scene move main.tscn HUD --after Player")
        .argument("<scene>", SCENE)
        .argument("<node>", "path of the node")
        .argument("[parent]", 'path of the new parent ("." is the root; default: the parent it has)')
        .option("--index <n>", "place among the children of the parent (0 is the first)")
        .option("--before <sibling>", "path of the sibling it goes before")
        .option("--after <sibling>", "path of the sibling it goes after"),
    )).action((file: string, node: string, parent: string | undefined, options: Common & { index?: string; before?: string; after?: string }, command: Command) =>
      run(
        command,
        file,
        {
          op: "move_node",
          node,
          ...(parent !== undefined ? { parent } : {}),
          ...(options.index !== undefined ? { index: /^\d+$/.test(options.index) ? Number(options.index) : -1 } : {}),
          ...(options.before !== undefined ? { before: options.before } : {}),
          ...(options.after !== undefined ? { after: options.after } : {}),
          ...make(options),
        },
        options,
      ),
    ),
  );

  scene.addCommand(
    editableOption(common(
      new Command("duplicate")
        .description("copy a node with its children under a new name; the copy shares the original's sub-resources, as Duplicate in the editor does")
        .argument("<scene>", SCENE)
        .argument("<node>", "path of the node to copy")
        .argument("<name>", "name of the copy")
        .option("--parent <node>", "path of the parent of the copy (default: the parent of the original)")
        .option("--connections", "also copy the signal connections of the copied nodes"),
    )).action((file: string, node: string, name: string, options: Common & { parent?: string; connections?: boolean }, command: Command) =>
      run(command, file, { op: "duplicate_node", node, name, ...(options.parent !== undefined ? { parent: options.parent } : {}), ...(options.connections ? { connections: true } : {}), ...make(options) }, options),
    ),
  );

  const list = (value: string, all: string[] = []): string[] => [...all, ...value.split(",").map((g) => g.trim()).filter(Boolean)];
  scene.addCommand(
    editableOption(common(
      new Command("groups")
        .description("set the groups of a node: scene groups main.tscn Enemy enemies targets (the whole list; --none for no groups), or --add and --remove")
        .argument("<scene>", SCENE)
        .argument("<node>", 'path of the node ("." is the root)')
        .argument("[groups...]", "the groups the node is in after the change")
        .option("--add <group>", "add a group (repeat, or separate with commas)", list)
        .option("--remove <group>", "remove a group (repeat, or separate with commas)", list)
        .option("--none", "remove the node from all its groups"),
    )).action((file: string, node: string, groups: string[], options: Common & { add?: string[]; remove?: string[]; none?: boolean }, command: Command) =>
      run(
        command,
        file,
        { op: "set_groups", node, ...(groups.length || options.none ? { groups } : {}), ...(options.add ? { add: options.add } : {}), ...(options.remove ? { remove: options.remove } : {}), ...make(options) },
        options,
      ),
    ),
  );

  scene.addCommand(
    editableOption(common(
      new Command("add-many")
        .description(
          'add several nodes at once, all or nothing: a JSON list (or a .json file with one) of {"parent", "name", "type" or "instance", "props", "script"}, in order, so a later node can be the child of an earlier one',
        )
        .argument("<scene>", SCENE)
        .argument("<nodes>", `JSON text or a .json file: [{"parent": ".", "name": "Body", "type": "CharacterBody2D", "props": {"position": "Vector2(10, 20)"}}]`),
    )).action((file: string, nodes: string, options: Common, command: Command) =>
      run(
        command,
        file,
        () => {
          const source = !nodes.trimStart().startsWith("[") && existsSync(nodes) ? readFileSync(nodes, "utf8") : nodes;
          let parsed: unknown;
          try {
            parsed = JSON.parse(source);
          } catch (error) {
            throw new SceneError(`the nodes are not valid JSON (${(error as Error).message}); give a list such as [{"parent": ".", "name": "Body", "type": "Node2D"}]`);
          }
          if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== "object" || n === null)) throw new SceneError(`the nodes must be a JSON list of objects: [{"parent": ".", "name": "Body", "type": "Node2D"}]`);
          return { op: "add_nodes", nodes: parsed as NewNode[], ...make(options) };
        },
        options,
      ),
    ),
  );
  return scene;
}
