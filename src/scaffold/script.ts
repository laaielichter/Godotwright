import { existsSync } from "node:fs";
import { GodotApi } from "../api/api.js";
import { JournalWriter } from "../journal/journal.js";
import { fromResPath } from "../project/files.js";
import { reviewProject } from "../review/review.js";
import { loadProject, projectRootOf } from "../scan/scan.js";
import { generateUid } from "../scene/uid.js";
import { ScaffoldError, cleanResPath } from "./error.js";

/**
 * New GDScript and shader files from templates. Every template is fully typed and passes this repository's own review
 * with no errors or warnings (test/scaffold.test.ts keeps that true). Written through the journal, so godot_undo
 * removes them again; a file that is there is never overwritten.
 */

export const SCRIPT_TEMPLATES = ["node", "character_2d", "character_3d", "area_trigger", "state_machine", "autoload", "resource", "ui_control", "test_gut", "test_gdunit4"] as const;
export type ScriptTemplate = (typeof SCRIPT_TEMPLATES)[number];

/** The templates that have a C# form: used when the new file ends in .cs. */
export const CSHARP_TEMPLATES = ["node", "character_2d", "character_3d", "area_trigger", "autoload", "resource", "ui_control"] as const satisfies readonly ScriptTemplate[];
export type CSharpTemplate = (typeof CSHARP_TEMPLATES)[number];

export const SHADER_KINDS = ["canvas_item", "spatial", "particles", "sky", "fog"] as const;
export type ShaderKind = (typeof SHADER_KINDS)[number];

export interface NewScriptOptions {
  /** Default node. */
  template?: ScriptTemplate;
  /** `class_name` to give the script (optional; the resource template is far more useful with one). A C# class always has the name of its file. */
  className?: string;
  /** For the node template: the class to extend. Default Node. */
  base?: string;
  /** For area_trigger: 2d (Area2D, the default) or 3d (Area3D). */
  dimension?: "2d" | "3d";
  /** Default true. With false nothing is written and the result holds the text. */
  write?: boolean;
}

/** An input action a template reads, with an event to give it (the notation of godot_project_edit input_add). */
export interface TemplateAction {
  name: string;
  event: string;
  /** Whether project.godot has the action already. */
  defined: boolean;
}

export interface NewFileResult {
  /** res:// path. */
  file: string;
  /** The template or shader kind. */
  template: string;
  text: string;
  /** The uid written to the `.uid` file next to it. */
  uid: string;
  written: boolean;
  journal?: number;
  notes: string[];
  /** Review findings in the new file, counted after the write. */
  review?: { errors: number; warnings: number };
}

export interface NewScriptResult extends NewFileResult {
  extends: string;
  className?: string;
  /** Input actions the script reads; add the ones that are not defined yet. */
  inputActions: TemplateAction[];
}

interface Built {
  extends: string;
  body: string[];
  actions?: [string, string][];
  notes?: string[];
}

const MOVE_2D: [string, string][] = [
  ["move_left", "Key:A"],
  ["move_right", "Key:D"],
  ["jump", "Key:Space"],
];
const MOVE_3D: [string, string][] = [
  ["move_left", "Key:A"],
  ["move_right", "Key:D"],
  ["move_forward", "Key:W"],
  ["move_back", "Key:S"],
  ["jump", "Key:Space"],
];

function build(template: ScriptTemplate, options: NewScriptOptions): Built {
  switch (template) {
    case "node":
      return { extends: options.base ?? "Node", body: ["func _ready() -> void:", "\tpass"] };
    case "character_2d":
      return {
        extends: "CharacterBody2D",
        actions: MOVE_2D,
        body: [
          "@export var speed: float = 300.0",
          "@export var jump_velocity: float = -400.0",
          "",
          'var _gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity")',
          "",
          "",
          "func _physics_process(delta: float) -> void:",
          "\tif not is_on_floor():",
          "\t\tvelocity.y += _gravity * delta",
          '\telif Input.is_action_just_pressed(&"jump"):',
          "\t\tvelocity.y = jump_velocity",
          '\tvar direction: float = Input.get_axis(&"move_left", &"move_right")',
          "\tif is_zero_approx(direction):",
          "\t\tvelocity.x = move_toward(velocity.x, 0.0, speed)",
          "\telse:",
          "\t\tvelocity.x = direction * speed",
          "\tmove_and_slide()",
        ],
      };
    case "character_3d":
      return {
        extends: "CharacterBody3D",
        actions: MOVE_3D,
        body: [
          "@export var speed: float = 5.0",
          "@export var jump_velocity: float = 4.5",
          "",
          'var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")',
          "",
          "",
          "func _physics_process(delta: float) -> void:",
          "\tif not is_on_floor():",
          "\t\tvelocity.y -= _gravity * delta",
          '\telif Input.is_action_just_pressed(&"jump"):',
          "\t\tvelocity.y = jump_velocity",
          '\tvar input: Vector2 = Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")',
          "\tvar direction: Vector3 = (transform.basis * Vector3(input.x, 0.0, input.y)).normalized()",
          "\tif direction.is_zero_approx():",
          "\t\tvelocity.x = move_toward(velocity.x, 0.0, speed)",
          "\t\tvelocity.z = move_toward(velocity.z, 0.0, speed)",
          "\telse:",
          "\t\tvelocity.x = direction.x * speed",
          "\t\tvelocity.z = direction.z * speed",
          "\tmove_and_slide()",
        ],
      };
    case "area_trigger": {
      const d = options.dimension === "3d" ? "3D" : "2D";
      return {
        extends: `Area${d}`,
        notes: [`the area needs a CollisionShape${d} child, and a collision mask that holds the layer of the bodies it should see`],
        body: [
          "## Emits `triggered` when a body in `target_group` enters the area.",
          "",
          `signal triggered(body: Node${d})`,
          "",
          '@export var target_group: StringName = &"player"',
          "@export var one_shot: bool = false",
          "",
          "",
          "func _ready() -> void:",
          "\tbody_entered.connect(_on_body_entered)",
          "",
          "",
          `func _on_body_entered(body: Node${d}) -> void:`,
          "\tif not body.is_in_group(target_group):",
          "\t\treturn",
          "\ttriggered.emit(body)",
          "\tif one_shot:",
          '\t\tset_deferred(&"monitoring", false)',
        ],
      };
    }
    case "state_machine":
      return {
        extends: "Node",
        notes: ["make states by extending the inner State class, register them with add_state(), then call transition_to() with the first one"],
        body: [
          "## A small state machine. States extend `State`; register them with add_state()",
          "## and switch with transition_to().",
          "",
          "signal state_changed(previous: StringName, current: StringName)",
          "",
          'var current: StringName = &""',
          "",
          "var _states: Dictionary[StringName, State] = {}",
          "",
          "",
          "func _process(delta: float) -> void:",
          "\tvar state: State = _states.get(current)",
          "\tif state != null:",
          "\t\tstate.update(delta)",
          "",
          "",
          "func _physics_process(delta: float) -> void:",
          "\tvar state: State = _states.get(current)",
          "\tif state != null:",
          "\t\tstate.physics_update(delta)",
          "",
          "",
          "func add_state(id: StringName, state: State) -> void:",
          "\tstate.machine = self",
          "\t_states[id] = state",
          "",
          "",
          "func transition_to(id: StringName) -> void:",
          "\tvar next: State = _states.get(id)",
          "\tif next == null:",
          '\t\tpush_error("unknown state: %s" % id)',
          "\t\treturn",
          "\tvar previous: StringName = current",
          "\tvar last: State = _states.get(previous)",
          "\tif last != null:",
          "\t\tlast.exit(id)",
          "\tcurrent = id",
          "\tnext.enter(previous)",
          "\tstate_changed.emit(previous, id)",
          "",
          "",
          "## The base class of every state: override what the state needs.",
          "class State extends RefCounted:",
          "\t## The machine this state belongs to (set by add_state).",
          "\tvar machine: Node",
          "",
          "\tfunc enter(_previous: StringName) -> void:",
          "\t\tpass",
          "",
          "\tfunc exit(_next: StringName) -> void:",
          "\t\tpass",
          "",
          "\tfunc update(_delta: float) -> void:",
          "\t\tpass",
          "",
          "\tfunc physics_update(_delta: float) -> void:",
          "\t\tpass",
        ],
      };
    case "autoload":
      return {
        extends: "Node",
        notes: ["register it with godot_project_edit (autoload_add <Name> <this file>); the autoload name must differ from any class_name"],
        body: [
          "## Autoload: shared state that lives for the whole run.",
          "",
          "signal value_changed(key: StringName, value: Variant)",
          "",
          "var _values: Dictionary[StringName, Variant] = {}",
          "",
          "",
          "func set_value(key: StringName, value: Variant) -> void:",
          "\t_values[key] = value",
          "\tvalue_changed.emit(key, value)",
          "",
          "",
          "func get_value(key: StringName, fallback: Variant = null) -> Variant:",
          "\treturn _values.get(key, fallback)",
        ],
      };
    case "resource":
      return {
        extends: "Resource",
        notes: options.className ? [] : ["without a class_name the resource does not show in the editor's New Resource list; pass className to give it one"],
        body: ['@export var display_name: String = ""', '@export_multiline var description: String = ""', "@export var icon: Texture2D", "@export_range(0, 999, 1) var amount: int = 1"],
      };
    case "ui_control":
      return {
        extends: "Control",
        body: [
          "## A screen or panel: open() shows it, ui_cancel closes it.",
          "",
          "signal closed",
          "",
          "",
          "func _unhandled_input(event: InputEvent) -> void:",
          '\tif visible and event.is_action_pressed(&"ui_cancel"):',
          "\t\tget_viewport().set_input_as_handled()",
          "\t\tclose()",
          "",
          "",
          "func open() -> void:",
          "\tshow()",
          "\tvar first: Control = find_next_valid_focus()",
          "\tif first != null:",
          "\t\tfirst.grab_focus()",
          "",
          "",
          "func close() -> void:",
          "\thide()",
          "\tclosed.emit()",
        ],
      };
    case "test_gut":
      return {
        extends: "GutTest",
        body: ["func before_each() -> void:", "\tpass", "", "", "func after_each() -> void:", "\tpass", "", "", "func test_example() -> void:", '\tassert_eq(1 + 1, 2, "replace this with a real check")'],
      };
    case "test_gdunit4":
      return {
        extends: "GdUnitTestSuite",
        body: ["func before_test() -> void:", "\tpass", "", "", "func after_test() -> void:", "\tpass", "", "", "func test_example() -> void:", "\tassert_int(1 + 1).is_equal(2)"],
      };
  }
}

/** A C# class body as lines, indented with tabs like the scripts Godot makes. */
function buildCSharp(template: CSharpTemplate, options: NewScriptOptions): Built & { usings?: string[]; attributes?: string[]; doc?: string } {
  switch (template) {
    case "node":
      return { extends: options.base ?? "Node", body: ["public override void _Ready()", "{", "}"] };
    case "character_2d":
      return {
        extends: "CharacterBody2D",
        actions: MOVE_2D,
        body: [
          "[Export]",
          "public float Speed { get; set; } = 300.0f;",
          "",
          "[Export]",
          "public float JumpVelocity { get; set; } = -400.0f;",
          "",
          "public override void _PhysicsProcess(double delta)",
          "{",
          "\tVector2 velocity = Velocity;",
          "",
          "\tif (!IsOnFloor())",
          "\t{",
          "\t\tvelocity += GetGravity() * (float)delta;",
          "\t}",
          '\telse if (Input.IsActionJustPressed("jump"))',
          "\t{",
          "\t\tvelocity.Y = JumpVelocity;",
          "\t}",
          "",
          '\tfloat direction = Input.GetAxis("move_left", "move_right");',
          "\tif (Mathf.IsZeroApprox(direction))",
          "\t{",
          "\t\tvelocity.X = Mathf.MoveToward(velocity.X, 0.0f, Speed);",
          "\t}",
          "\telse",
          "\t{",
          "\t\tvelocity.X = direction * Speed;",
          "\t}",
          "",
          "\tVelocity = velocity;",
          "\tMoveAndSlide();",
          "}",
        ],
      };
    case "character_3d":
      return {
        extends: "CharacterBody3D",
        actions: MOVE_3D,
        body: [
          "[Export]",
          "public float Speed { get; set; } = 5.0f;",
          "",
          "[Export]",
          "public float JumpVelocity { get; set; } = 4.5f;",
          "",
          "public override void _PhysicsProcess(double delta)",
          "{",
          "\tVector3 velocity = Velocity;",
          "",
          "\tif (!IsOnFloor())",
          "\t{",
          "\t\tvelocity += GetGravity() * (float)delta;",
          "\t}",
          '\telse if (Input.IsActionJustPressed("jump"))',
          "\t{",
          "\t\tvelocity.Y = JumpVelocity;",
          "\t}",
          "",
          '\tVector2 input = Input.GetVector("move_left", "move_right", "move_forward", "move_back");',
          "\tVector3 direction = (Transform.Basis * new Vector3(input.X, 0.0f, input.Y)).Normalized();",
          "\tif (direction != Vector3.Zero)",
          "\t{",
          "\t\tvelocity.X = direction.X * Speed;",
          "\t\tvelocity.Z = direction.Z * Speed;",
          "\t}",
          "\telse",
          "\t{",
          "\t\tvelocity.X = Mathf.MoveToward(velocity.X, 0.0f, Speed);",
          "\t\tvelocity.Z = Mathf.MoveToward(velocity.Z, 0.0f, Speed);",
          "\t}",
          "",
          "\tVelocity = velocity;",
          "\tMoveAndSlide();",
          "}",
        ],
      };
    case "area_trigger": {
      const d = options.dimension === "3d" ? "3D" : "2D";
      return {
        extends: `Area${d}`,
        doc: "Emits Triggered when a body in TargetGroup enters the area.",
        notes: [`the area needs a CollisionShape${d} child, and a collision mask that holds the layer of the bodies it should see`, "in a scene the signal is Triggered: a C# [Signal] keeps its C# name, without EventHandler"],
        body: [
          "[Signal]",
          `public delegate void TriggeredEventHandler(Node${d} body);`,
          "",
          "[Export]",
          'public StringName TargetGroup { get; set; } = "player";',
          "",
          "[Export]",
          "public bool OneShot { get; set; }",
          "",
          "public override void _Ready()",
          "{",
          "\tBodyEntered += OnBodyEntered;",
          "}",
          "",
          `private void OnBodyEntered(Node${d} body)`,
          "{",
          "\tif (!body.IsInGroup(TargetGroup))",
          "\t{",
          "\t\treturn;",
          "\t}",
          "",
          "\tEmitSignal(SignalName.Triggered, body);",
          "\tif (OneShot)",
          "\t{",
          `\t\tSetDeferred(Area${d}.PropertyName.Monitoring, false);`,
          "\t}",
          "}",
        ],
      };
    }
    case "autoload":
      return {
        extends: "Node",
        usings: ["Godot.Collections"],
        doc: "Autoload: shared state that lives for the whole run.",
        notes: ["register it with godot_project_edit (autoload_add <Name> <this file>); from other C# code reach it with GetNode<T>(\"/root/<Name>\")"],
        body: [
          "[Signal]",
          "public delegate void ValueChangedEventHandler(StringName key, Variant value);",
          "",
          "private readonly Dictionary<StringName, Variant> _values = new();",
          "",
          "public void SetValue(StringName key, Variant value)",
          "{",
          "\t_values[key] = value;",
          "\tEmitSignal(SignalName.ValueChanged, key, value);",
          "}",
          "",
          "public Variant GetValue(StringName key, Variant fallback = default)",
          "{",
          "\treturn _values.TryGetValue(key, out Variant value) ? value : fallback;",
          "}",
        ],
      };
    case "resource":
      return {
        extends: "Resource",
        attributes: ["[GlobalClass]"],
        notes: ["[GlobalClass] puts the resource in the editor's New Resource list once the project is built"],
        body: [
          "[Export]",
          'public string DisplayName { get; set; } = "";',
          "",
          "[Export(PropertyHint.MultilineText)]",
          'public string Description { get; set; } = "";',
          "",
          "[Export]",
          "public Texture2D Icon { get; set; }",
          "",
          '[Export(PropertyHint.Range, "0,999,1")]',
          "public int Amount { get; set; } = 1;",
        ],
      };
    case "ui_control":
      return {
        extends: "Control",
        doc: "A screen or panel: Open() shows it, ui_cancel closes it.",
        body: [
          "[Signal]",
          "public delegate void ClosedEventHandler();",
          "",
          "public override void _UnhandledInput(InputEvent @event)",
          "{",
          '\tif (Visible && @event.IsActionPressed("ui_cancel"))',
          "\t{",
          "\t\tGetViewport().SetInputAsHandled();",
          "\t\tClose();",
          "\t}",
          "}",
          "",
          "public void Open()",
          "{",
          "\tShow();",
          "\tControl first = FindNextValidFocus();",
          "\tfirst?.GrabFocus();",
          "}",
          "",
          "public void Close()",
          "{",
          "\tHide();",
          "\tEmitSignal(SignalName.Closed);",
          "}",
        ],
      };
  }
}

/**
 * The text of a C# script template: a partial class with the given name (Godot needs the name of the file), `using
 * Godot`, typed members, and [Export] and [Signal] where the template has them. Written from Godot 4's C# API; nothing
 * here was compiled, so `godot_check` (dotnet build) has the last word.
 */
export function csharpTemplateText(template: CSharpTemplate, className: string, options: NewScriptOptions = {}): string {
  const built = buildCSharp(template, options);
  const out = ["using Godot;", ...(built.usings ?? []).map((u) => `using ${u};`), ""];
  if (built.doc) out.push("/// <summary>", `/// ${built.doc}`, "/// </summary>");
  out.push(...(built.attributes ?? []), `public partial class ${className} : ${built.extends}`, "{", ...built.body.map((l) => (l ? `\t${l}` : "")), "}");
  return `${out.join("\n")}\n`;
}

/** The text of a script template, without touching a project. */
export function scriptTemplateText(template: ScriptTemplate, options: NewScriptOptions = {}): string {
  const built = build(template, options);
  const head = [...(options.className ? [`class_name ${options.className}`] : []), `extends ${built.extends}`];
  // A doc comment sits right under extends; code is set off by a blank line (two before a function).
  const first = built.body[0] ?? "";
  const gap = first.startsWith("##") ? [] : first.startsWith("func ") ? ["", ""] : [""];
  return `${[...head, ...gap, ...built.body].join("\n")}\n`;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function refuseExisting(root: string, file: string): void {
  if (existsSync(fromResPath(root, file))) throw new ScaffoldError(`${file} already exists; nothing was written (pick another name, or edit the file)`);
}

function countReview(root: string, file: string): { errors: number; warnings: number } {
  const findings = reviewProject(root, { focus: [file] }).findings.filter((f) => f.file === file);
  return { errors: findings.filter((f) => f.severity === "error").length, warnings: findings.filter((f) => f.severity === "warning").length };
}

export function newScript(project: string, resPath: string, options: NewScriptOptions = {}): NewScriptResult {
  const root = projectRootOf(project);
  const template = options.template ?? "node";
  if (!SCRIPT_TEMPLATES.includes(template)) throw new ScaffoldError(`"${template}" is not a script template; use one of ${SCRIPT_TEMPLATES.join(", ")}`);
  const file = cleanResPath(resPath, ["gd", "cs"], "a script");
  refuseExisting(root, file);
  const api = GodotApi.load();
  const data = loadProject(root);
  const notes: string[] = [];
  if (file.toLowerCase().endsWith(".cs")) return newCSharpScript(root, file, template, options);

  const className = options.className?.trim() || undefined;
  if (className !== undefined) {
    if (!IDENT.test(className)) throw new ScaffoldError(`"${className}" is not a usable class_name (letters, digits and _, not starting with a digit)`);
    if (api.getClass(className)?.name === className) throw new ScaffoldError(`${className} is a Godot class; a class_name with that name would hide it`);
    const taken = [...data.scripts].find(([, outline]) => outline.className === className);
    if (taken) throw new ScaffoldError(`class_name ${className} is already used by ${taken[0]}`);
    if (data.map.autoloads.some((a) => a.name === className)) throw new ScaffoldError(`${className} is the name of an autoload; Godot refuses a class_name with the same name`);
    if (!/^[A-Z]/.test(className)) notes.push(`class names are PascalCase by convention: ${className}`);
  }
  if (options.base !== undefined) {
    if (template !== "node") throw new ScaffoldError(`base is only for the node template; ${template} extends a fixed class`);
    const known = api.getClass(options.base)?.name === options.base || [...data.scripts.values()].some((o) => o.className === options.base);
    if (!IDENT.test(options.base) || !known) throw new ScaffoldError(`${options.base} is not a Godot ${api.version} class or a class_name in this project`);
  }
  if (options.dimension !== undefined && options.dimension !== "2d" && options.dimension !== "3d") throw new ScaffoldError(`dimension is 2d or 3d`);

  const built = build(template, { ...options, className });
  notes.push(...(built.notes ?? []));
  if (template === "test_gut" || template === "test_gdunit4") {
    const wanted = template === "test_gut" ? "gut" : "gdunit";
    const folder = (f: "gut" | "gdunit") => existsSync(fromResPath(root, f === "gut" ? "res://addons/gut" : "res://addons/gdUnit4"));
    const other = wanted === "gut" ? "gdunit" : "gut";
    const label = wanted === "gut" ? "GUT (res://addons/gut)" : "GdUnit4 (res://addons/gdUnit4)";
    if (!folder(wanted)) notes.push(`${label} is not installed in this project${folder(other) ? `, but ${other === "gut" ? "GUT" : "GdUnit4"} is: use the ${other === "gut" ? "test_gut" : "test_gdunit4"} template` : ""}; the script does not load until it is`);
    const name = file.slice(file.lastIndexOf("/") + 1);
    if (wanted === "gut" && !/^test_/.test(name)) notes.push(`GUT only collects files that start with test_ (unless .gutconfig.json says otherwise); this one is ${name}`);
  }
  const defined = new Set(data.map.inputActions.map((a) => a.name));
  const inputActions = (built.actions ?? []).map(([name, event]) => ({ name, event, defined: defined.has(name) }));

  const text = scriptTemplateText(template, { ...options, className });
  const uid = generateUid(new Set(data.uids.keys()));
  const result: NewScriptResult = { file, template, text, uid, written: false, notes, extends: built.extends, ...(className ? { className } : {}), inputActions };
  if (options.write === false) return result;
  const journal = new JournalWriter(root, "new script", `new ${template} script ${file}`);
  const full = fromResPath(root, file);
  journal.write(full, text);
  journal.write(`${full}.uid`, `${uid}\n`);
  const id = journal.commit();
  return { ...result, written: true, ...(id ? { journal: id } : {}), review: countReview(root, file) };
}

/** A new C# script: the class has the name of the file, as Godot needs. */
function newCSharpScript(root: string, file: string, template: ScriptTemplate, options: NewScriptOptions): NewScriptResult {
  const api = GodotApi.load();
  const data = loadProject(root);
  const notes: string[] = [];
  if (!(CSHARP_TEMPLATES as readonly string[]).includes(template)) throw new ScaffoldError(`the ${template} template is GDScript only; C# templates: ${CSHARP_TEMPLATES.join(", ")}`);
  const className = file.slice(file.lastIndexOf("/") + 1).replace(/\.cs$/i, "");
  if (!IDENT.test(className)) throw new ScaffoldError(`a C# script's class has the name of its file, and "${className}" is not a usable class name (letters, digits and _, not starting with a digit); name the file like Player.cs`);
  if (options.className !== undefined && options.className.trim() !== className) throw new ScaffoldError(`a C# script's class must have the name of its file: ${file} holds class ${className}, not ${options.className.trim()} (rename the file instead)`);
  if (api.getClass(className)?.name === className) throw new ScaffoldError(`${className} is a Godot class; a C# class with that name would clash with it`);
  const taken = [...data.csharp].find(([, c]) => c.outline.classes.some((k) => k.name === className && !k.namespace));
  if (taken) throw new ScaffoldError(`class ${className} is already declared in ${taken[0]}`);
  if (!/^[A-Z]/.test(className)) notes.push(`C# classes and their files are PascalCase by convention: ${className[0]!.toUpperCase()}${className.slice(1)}.cs`);
  if (options.base !== undefined) {
    if (template !== "node") throw new ScaffoldError(`base is only for the node template; ${template} extends a fixed class`);
    const known = api.getClass(options.base)?.name === options.base || [...data.csharp.values()].some((c) => c.outline.classes.some((k) => k.name === options.base));
    if (!IDENT.test(options.base) || !known) throw new ScaffoldError(`${options.base} is not a Godot ${api.version} class or a C# class in this project`);
  }
  if (options.dimension !== undefined && options.dimension !== "2d" && options.dimension !== "3d") throw new ScaffoldError(`dimension is 2d or 3d`);
  const csTemplate = template as CSharpTemplate;
  const built = buildCSharp(csTemplate, options);
  notes.push(...(built.notes ?? []));
  if (!data.files.some((f) => /^res:\/\/[^/]+\.csproj$/i.test(f))) notes.push("the project has no .csproj yet: make one in Godot (Project > Tools > C# > Create C# solution), or start projects with godot_new op project and dotnet true");
  notes.push("build the project before Godot can use the script (the editor's Build button, or godot_check, which runs dotnet build)");
  const defined = new Set(data.map.inputActions.map((a) => a.name));
  const inputActions = (built.actions ?? []).map(([name, event]) => ({ name, event, defined: defined.has(name) }));
  const text = csharpTemplateText(csTemplate, className, options);
  const uid = generateUid(new Set(data.uids.keys()));
  const result: NewScriptResult = { file, template, text, uid, written: false, notes, extends: built.extends, className, inputActions };
  if (options.write === false) return result;
  const journal = new JournalWriter(root, "new script", `new ${template} C# script ${file}`);
  const full = fromResPath(root, file);
  journal.write(full, text);
  journal.write(`${full}.uid`, `${uid}\n`);
  const id = journal.commit();
  return { ...result, written: true, ...(id ? { journal: id } : {}), review: countReview(root, file) };
}

const SHADERS: Record<ShaderKind, { body: string[]; note: string }> = {
  canvas_item: {
    note: "for 2D and UI: put it in a ShaderMaterial on a CanvasItem (Sprite2D, Control, ...)",
    body: ["uniform vec4 tint : source_color = vec4(1.0);", "", "void fragment() {", "\tCOLOR = texture(TEXTURE, UV) * tint;", "}"],
  },
  spatial: {
    note: "for 3D: put it in a ShaderMaterial on a mesh surface or as a material override",
    body: [
      "uniform vec4 albedo : source_color = vec4(1.0);",
      "uniform float roughness : hint_range(0.0, 1.0) = 0.5;",
      "uniform float metallic : hint_range(0.0, 1.0) = 0.0;",
      "",
      "void fragment() {",
      "\tALBEDO = albedo.rgb;",
      "\tROUGHNESS = roughness;",
      "\tMETALLIC = metallic;",
      "}",
    ],
  },
  particles: {
    note: "for GPUParticles2D / GPUParticles3D: put it in a ShaderMaterial as the process material",
    body: [
      "uniform vec3 direction = vec3(0.0, 1.0, 0.0);",
      "uniform float initial_speed = 2.0;",
      "uniform vec3 gravity = vec3(0.0, -9.8, 0.0);",
      "",
      "void start() {",
      "\tif (RESTART_POSITION) {",
      "\t\tTRANSFORM = EMISSION_TRANSFORM;",
      "\t}",
      "\tif (RESTART_VELOCITY) {",
      "\t\tVELOCITY = normalize(direction) * initial_speed;",
      "\t}",
      "}",
      "",
      "void process() {",
      "\tVELOCITY += gravity * DELTA;",
      "}",
    ],
  },
  sky: {
    note: "for a Sky resource: put it in a ShaderMaterial as the sky material of the WorldEnvironment's sky",
    body: [
      "uniform vec3 top_color : source_color = vec3(0.1, 0.3, 0.7);",
      "uniform vec3 horizon_color : source_color = vec3(0.6, 0.75, 0.9);",
      "uniform vec3 ground_color : source_color = vec3(0.2, 0.17, 0.13);",
      "",
      "void sky() {",
      "\tfloat up = clamp(EYEDIR.y, 0.0, 1.0);",
      "\tfloat down = clamp(-EYEDIR.y * 8.0, 0.0, 1.0);",
      "\tCOLOR = mix(mix(horizon_color, top_color, up), ground_color, down);",
      "}",
    ],
  },
  fog: {
    note: "for a FogVolume (Forward+ with volumetric fog enabled in the Environment): put it in a ShaderMaterial as the volume's material",
    body: ["uniform float density : hint_range(0.0, 8.0) = 1.0;", "uniform vec4 albedo : source_color = vec4(1.0);", "", "void fog() {", "\tDENSITY = density;", "\tALBEDO = albedo.rgb;", "}"],
  },
};

/** The text of a shader template, without touching a project. */
export function shaderTemplateText(kind: ShaderKind): string {
  return `${[`shader_type ${kind};`, "", ...SHADERS[kind].body].join("\n")}\n`;
}

export function newShader(project: string, resPath: string, kind: ShaderKind = "canvas_item", options: { write?: boolean } = {}): NewFileResult {
  const root = projectRootOf(project);
  if (!SHADER_KINDS.includes(kind)) throw new ScaffoldError(`"${kind}" is not a shader kind; use one of ${SHADER_KINDS.join(", ")}`);
  const file = cleanResPath(resPath, ["gdshader"], "a shader");
  refuseExisting(root, file);
  const text = shaderTemplateText(kind);
  const uid = generateUid(new Set(loadProject(root).uids.keys()));
  const result: NewFileResult = { file, template: kind, text, uid, written: false, notes: [SHADERS[kind].note] };
  if (options.write === false) return result;
  const journal = new JournalWriter(root, "new shader", `new ${kind} shader ${file}`);
  const full = fromResPath(root, file);
  journal.write(full, text);
  journal.write(`${full}.uid`, `${uid}\n`);
  const id = journal.commit();
  return { ...result, written: true, ...(id ? { journal: id } : {}), review: countReview(root, file) };
}

function formatFile(what: string, r: NewFileResult): string[] {
  const out = [`new ${what} ${r.file} (${r.template})${r.written ? ` written${r.journal ? `, journal #${r.journal}: godot_undo removes it` : ""}` : " (dry run: nothing written)"}`];
  if (r.review) out.push(`review: ${r.review.errors} error${r.review.errors === 1 ? "" : "s"}, ${r.review.warnings} warning${r.review.warnings === 1 ? "" : "s"}${r.review.errors + r.review.warnings ? "  <- run godot_review on the file" : ""}`);
  return out;
}

export function formatNewScript(r: NewScriptResult): string {
  const out = formatFile("script", r);
  out[0] += r.file.endsWith(".cs") ? `: partial class ${r.className} : ${r.extends}` : `: extends ${r.extends}${r.className ? `, class_name ${r.className}` : ""}`;
  if (r.inputActions.length) {
    out.push(`input actions it reads: ${r.inputActions.map((a) => `${a.name}${a.defined ? "" : " (missing)"}`).join(", ")}`);
    for (const a of r.inputActions.filter((x) => !x.defined)) out.push(`  add: godot_project_edit input_add ${a.name} ${a.event}`);
  }
  for (const n of r.notes) out.push(`note: ${n}`);
  if (!r.written) out.push("", r.text.trimEnd());
  return `${out.join("\n")}\n`;
}

export function formatNewShader(r: NewFileResult): string {
  const out = formatFile("shader", r);
  for (const n of r.notes) out.push(`note: ${n}`);
  if (!r.written) out.push("", r.text.trimEnd());
  return `${out.join("\n")}\n`;
}
