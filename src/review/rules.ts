export type Category = "api" | "performance" | "quality" | "structure";
export type Severity = "error" | "warning" | "info";

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  /** How to fix it, in one sentence. */
  fix: string;
}

export const CATEGORIES: Category[] = ["api", "performance", "quality", "structure"];

/** Share of each category in the overall score. */
export const CATEGORY_WEIGHTS: Record<Category, number> = {
  api: 0.3,
  performance: 0.25,
  quality: 0.25,
  structure: 0.2,
};

const list: Rule[] = [
  // API correctness: things that do not exist in Godot 4.7 or will fail at runtime.
  { id: "api/godot3-syntax", category: "api", severity: "error", title: "Godot 3 syntax", fix: "Use the Godot 4 form shown in the message." },
  { id: "api/unknown-type", category: "api", severity: "error", title: "Unknown type", fix: "Use a class that exists in Godot 4.7 or a class_name from this project." },
  { id: "api/unknown-function", category: "api", severity: "error", title: "Unknown function", fix: "Call a function that exists on this class, its parents or the global scope." },
  { id: "api/unknown-member", category: "api", severity: "error", title: "Unknown member", fix: "Use a member that exists on this type in Godot 4.7 (check with godotwright api)." },
  { id: "api/wrong-arguments", category: "api", severity: "error", title: "Wrong number of arguments", fix: "Pass the arguments the Godot 4.7 signature expects (check with godotwright api)." },
  { id: "api/impossible-type-test", category: "api", severity: "error", title: "Type test that can never be true", fix: "Test or cast against a type the value can be: a parent or child class of its static type." },
  { id: "api/infer-variant", category: "api", severity: "error", title: "Type inferred from a Variant", fix: "Give the variable a type (`var x: float = abs(v)`), or use the typed function (`absf`, `maxi`, `clampf`, ...)." },
  { id: "api/unsafe-member", category: "api", severity: "warning", title: "Member not on the static type", fix: "Give the variable the right type (or cast with `as`) so the member can be checked." },
  { id: "api/unknown-input-action", category: "api", severity: "error", title: "Unknown input action", fix: "Add the action to Project Settings > Input Map, or fix the name." },
  { id: "api/unknown-signal", category: "api", severity: "error", title: "Unknown signal", fix: "Declare the signal, or use one that exists on this class." },
  // Performance.
  { id: "performance/node-lookup-per-frame", category: "performance", severity: "warning", title: "Node lookup every frame", fix: "Look the node up once in an @onready var and reuse it." },
  { id: "performance/load-per-frame", category: "performance", severity: "warning", title: "Resource load every frame", fix: "Use preload() or load once and keep the result." },
  { id: "performance/physics-in-process", category: "performance", severity: "warning", title: "Physics in _process()", fix: "Move physics calls to _physics_process()." },
  { id: "performance/print-per-frame", category: "performance", severity: "info", title: "Print every frame", fix: "Remove the print or guard it behind a debug flag." },
  { id: "performance/instantiate-per-frame", category: "performance", severity: "info", title: "Instantiate every frame", fix: "Spawn on a timer or event, or reuse objects from a pool." },
  { id: "performance/empty-callback", category: "performance", severity: "info", title: "Empty per-frame callback", fix: "Delete the empty function; Godot calls it every frame." },
  { id: "performance/many-shadow-lights", category: "performance", severity: "warning", title: "Many shadow-casting lights", fix: "Turn off shadows on lights that do not need them." },
  { id: "performance/huge-scene", category: "performance", severity: "info", title: "Very large scene", fix: "Split the scene into sub-scenes, or use MultiMesh/GridMap for repeated objects." },
  // Code quality.
  { id: "quality/untyped", category: "quality", severity: "info", title: "Missing static types", fix: "Add types to variables, parameters and return values (or use :=)." },
  { id: "quality/long-function", category: "quality", severity: "info", title: "Long function", fix: "Split the function into smaller named steps." },
  { id: "quality/long-file", category: "quality", severity: "info", title: "Long script", fix: "Split the script by responsibility (components or child nodes)." },
  { id: "quality/deep-nesting", category: "quality", severity: "info", title: "Deep nesting", fix: "Return early or extract the inner block into a function." },
  { id: "quality/unused-signal", category: "quality", severity: "warning", title: "Signal never emitted", fix: "Emit the signal where the event happens, or remove it." },
  { id: "quality/string-signal", category: "quality", severity: "info", title: "Signal by string name", fix: "Use the signal object: my_signal.emit() and my_signal.connect(callable)." },
  { id: "quality/fragile-path", category: "quality", severity: "info", title: "Fragile node path", fix: "Use an @export var, a %UniqueName or a signal instead of ../.. paths." },
  { id: "quality/naming", category: "quality", severity: "info", title: "Naming style", fix: "Follow the GDScript style guide: snake_case, PascalCase classes, CONSTANT_CASE constants." },
  { id: "quality/time-scale-not-restored", category: "quality", severity: "warning", title: "Slow motion never undone", fix: "Set Engine.time_scale back to 1.0 when the effect ends and in _exit_tree(), so the game does not stay slow." },
  { id: "quality/todo", category: "quality", severity: "info", title: "TODO left in code", fix: "Do the TODO, or track it outside the code." },
  // Project structure.
  { id: "structure/broken-reference", category: "structure", severity: "error", title: "Broken reference", fix: "Fix the path or uid, or restore the missing file." },
  { id: "structure/parse-error", category: "structure", severity: "error", title: "File does not parse", fix: "Fix the syntax error at the line shown, or re-save the file from the Godot editor." },
  { id: "structure/missing-node", category: "structure", severity: "warning", title: "Node path not in scene", fix: "Fix the node path, or add the node to the scene." },
  { id: "structure/bad-connection", category: "structure", severity: "error", title: "Broken signal connection", fix: "Fix the connection in the scene, or add the missing method or signal." },
  { id: "structure/unknown-group", category: "structure", severity: "warning", title: "Group never assigned", fix: "Add nodes to the group (in the scene or with add_to_group()), or fix the name." },
  { id: "structure/file-naming", category: "structure", severity: "info", title: "File naming", fix: "Use snake_case for files and folders, as the Godot docs recommend." },
  { id: "structure/root-clutter", category: "structure", severity: "info", title: "Cluttered project root", fix: "Move scenes, scripts and assets into folders." },
  { id: "structure/many-autoloads", category: "structure", severity: "info", title: "Many autoloads", fix: "Keep global state small; prefer scene-owned nodes and signals." },
  { id: "structure/no-gitignore", category: "structure", severity: "info", title: ".godot/ not ignored", fix: "Add .godot/ to .gitignore." },
  { id: "structure/unused-script", category: "structure", severity: "info", title: "Script not used", fix: "Attach, reference or remove the script." },
  { id: "structure/deep-tree", category: "structure", severity: "info", title: "Deep node tree", fix: "Flatten the tree or move branches into sub-scenes." },
  { id: "structure/engine-version", category: "structure", severity: "info", title: "Engine version", fix: "Open and save the project in Godot 4.7." },
];

export const RULES: Record<string, Rule> = Object.fromEntries(list.map((r) => [r.id, r]));

export interface Finding {
  rule: string;
  category: Category;
  severity: Severity;
  file: string;
  line?: number;
  message: string;
}

export function finding(rule: string, file: string, line: number | undefined, message: string, severity?: Severity): Finding {
  const meta = RULES[rule];
  if (!meta) throw new Error(`unknown rule ${rule}`);
  return { rule, category: meta.category, severity: severity ?? meta.severity, file, line, message };
}
