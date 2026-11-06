# Review rules

This page lists every rule used by `godotwright review`. It is generated from the source of truth in `src/review/rules.ts`.

To regenerate after adding or changing a rule:

```sh
npm run build
node scripts/build-rules-doc.mjs
```

Rules are grouped by category. Severity is `error`, `warning` or `info`. The fix is the one-sentence guidance shown with each finding.

## Api

| ID | Severity | Title | Fix |
| --- | --- | --- | --- |
| `api/bind-swaps-arguments` | error | bind() puts the tweened value first | bind() adds its arguments after the caller's; use tween_property(object, "shader_parameter/name", ...) or a lambda. |
| `api/coroutine-without-await` | error | Coroutine result used without await | Call the function with `await` where its result is used; a function that awaits is a coroutine. |
| `api/debug-only-monitor` | info | Debug-only monitor read in every build | Read orphan-node and static-memory monitors only when OS.is_debug_build() is true; they are 0 in release exports. |
| `api/duplicate-declaration` | error | Declared twice | Remove the second declaration (a merge or a patch often adds the same code twice), or rename one. |
| `api/export-without-type` | error | Export without type or default | Give it a type (`@export var speed: float`) or a default value (`@export var speed := 200.0`). |
| `api/freed-check-order` | warning | Type test before the freed check | Check is_instance_valid(x) first and test `x is T` after it: a type test on a freed object is itself an error. |
| `api/get-meta-null-default` | warning | get_meta() with a null default | Check has_meta() first, or pass a default that is not null: with null, Godot prints an error when the entry is missing. |
| `api/godot3-syntax` | error | Godot 3 syntax | Use the Godot 4 form shown in the message. |
| `api/image-load-res` | warning | Image read from a res:// source file | Use load("res://...") as Texture2D: an exported game ships the imported texture, not the source image. |
| `api/image-unit-bool` | error | Bool passed as RichTextLabel image unit | Pass RichTextLabel.IMAGE_UNIT_PIXEL or IMAGE_UNIT_PERCENT: width_unit and height_unit are an enum in Godot 4.7. |
| `api/impossible-type-test` | error | Type test that can never be true | Test or cast against a type the value can be: a parent or child class of its static type. |
| `api/infer-variant` | error | Type inferred from a Variant | Give the variable a type (`var x: float = abs(v)`), or use the typed function (`absf`, `maxi`, `clampf`, ...). |
| `api/input-device-zero` | warning | Input device compared with 0 | Test the event type, or compare with InputEvent.DEVICE_ID_KEYBOARD or DEVICE_ID_MOUSE: in Godot 4.7 keyboard and mouse events are not device 0. |
| `api/multimesh-format-after-count` | warning | MultiMesh format set after instance_count | Set use_custom_data, use_colors and transform_format while instance_count is 0, then set instance_count. |
| `api/open-compressed-gzip` | error | Plain .gz file opened with open_compressed() | Read the bytes and unpack them: FileAccess.get_file_as_bytes(path).decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP). |
| `api/override-missing-return` | error | Override that returns no value | Return a value of the parent method's type on every path: Godot 4.7 gives an override without a return type the parent's. |
| `api/override-signature` | error | Override does not match its parent | Give the override the parent's parameters; parameters it adds need a default value. |
| `api/packed-element-write` | error | Packed array element written through an engine property | Copy the array, change the copy and assign it back (var p := line.points; p[0] = v; line.points = p): in Godot 4.7 the element write is lost. |
| `api/parse-into-typed` | warning | Parsed data put straight into a typed variable | Parse into a Variant, check it with `is Dictionary` or `is Array`, then use it: a missing or broken input gives null and stops the function. |
| `api/physics-change-in-callback` | warning | Physics change while Godot reports overlaps | In a body/area entered or exited handler, add physics nodes with add_child.call_deferred() and change monitoring or disabled with set_deferred(). |
| `api/shader-builtin-misplaced` | error | Shader built-in not available here | Use the built-in in a shader type and processor function that has it (godot_api shader:<type>.<function> lists them); pass it to your own functions as a parameter. |
| `api/shader-read-only-builtin` | error | Shader built-in written where it is read-only | Write the output built-in of this function instead (ALBEDO in a spatial fragment(), not COLOR), or change the value in the function where it is writable. |
| `api/shader-removed-builtin` | error | Removed shader built-in | Declare a sampler uniform with the hint instead, e.g. `uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;` (godot_fix adds it). |
| `api/unknown-function` | error | Unknown function | Call a function that exists on this class, its parents or the global scope. |
| `api/unknown-input-action` | error | Unknown input action | Add the action to Project Settings > Input Map, or fix the name. |
| `api/unknown-member` | error | Unknown member | Use a member that exists on this type in Godot 4.7 (check with godotwright api). |
| `api/unknown-signal` | error | Unknown signal | Declare the signal, or use one that exists on this class. |
| `api/unknown-type` | error | Unknown type | Use a class that exists in Godot 4.7 or a class_name from this project. |
| `api/unsafe-member` | warning | Member not on the static type | Give the variable the right type (or cast with `as`) so the member can be checked. |
| `api/wrong-arguments` | error | Wrong number of arguments | Pass the arguments the Godot 4.7 signature expects (check with godotwright api). |

## Performance

| ID | Severity | Title | Fix |
| --- | --- | --- | --- |
| `performance/load-per-frame` | warning | load() in a frame | Load once in _ready() and keep the result; load() reads from disk. |
| `performance/print-per-frame` | warning | print() in a frame | Remove the print, or guard it with OS.is_debug_build(). |
| `performance/get-node-per-frame` | warning | get_node() in a frame | Cache the node in _ready() with @onready or get_node(). |
| `performance/string-concat-per-frame` | warning | String concatenation in a frame | Build the string once, or use a StringBuilder / format. |
| `performance/allocate-per-frame` | warning | Allocation in a frame | Reuse arrays, dictionaries and objects; allocate in _ready(). |

## Quality

| ID | Severity | Title | Fix |
| --- | --- | --- | --- |
| `quality/long-function` | warning | Function longer than 50 lines | Split it into smaller functions with clear names. |
| `quality/too-many-params` | warning | Function with more than 5 parameters | Group related parameters in a dictionary or a custom type. |
| `quality/magic-number` | info | Magic number | Name the constant and use the name. |
| `quality/empty-catch` | warning | Empty catch | Log the error or rethrow it; an empty catch hides problems. |
| `quality/todo` | info | TODO comment | Resolve the TODO or turn it into an issue. |

## Structure

| ID | Severity | Title | Fix |
| --- | --- | --- | --- |
| `structure/unused-script` | info | Script not used | Attach, reference or remove the script. |
| `structure/deep-tree` | info | Deep node tree | Flatten the tree or move branches into sub-scenes. |
| `structure/engine-version` | info | Engine version | Open and save the project in Godot 4.7. |

