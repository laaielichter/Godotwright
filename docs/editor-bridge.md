# The editor bridge

Godotwright works on files and on headless Godot runs. The editor bridge is the optional part that reaches the **open**
editor: which scenes are open and unsaved, the selection, the edited scene tree, the editor's errors, save, reload, run,
stop, a screenshot, a filesystem scan. Without the addon every other tool works as before.

> **Run in a real Godot 4.7.2 editor, headless.** `test/integration/editor-bridge-godot.test.ts` starts
> `godot --editor --headless` with the addon on a copy of `test/fixtures/demo` and checks status, tree, inspect, select,
> selection, is_scanning, open_scene, close_scene, reload_scene, reimport, errors, the four edit ops (each one an undo
> step named in its answer) and save_scene (the saved .tscn holds the edits). save_all, filesystem_scan and edit_node
> were also run by hand there. In an editor with a window (Godot 4.7.2 on Linux, Compatibility renderer, Xvfb) `play`
> (main and a named scene) started the game, `status` showed it playing, `stop` closed it, and `screenshot` wrote the
> editor (1600x900) and the 3D viewport; a wrong token got no answer. Not proven: Windows and macOS, and Ctrl+Z
> pressed by a person (the answers show the step is in the scene's undo history). Every engine method the addon uses is also checked against
> the bundled class reference by a test, and the Node client is tested against a fake editor.

## Parts

| Part | Where |
| --- | --- |
| The addon (typed GDScript, Godot 4.4+, `errors` needs 4.5+) | `data/editor-bridge/addons/godotwright_bridge/` |
| The client: `editorCall(project, op, args)` | `src/editor/bridge.ts` |
| Install and uninstall | `src/editor/install.ts` |
| Text output | `src/editor/format.ts` |
| CLI: `godotwright editor ...` | `src/commands/editor.ts` |

## How it talks

- The addon listens on `127.0.0.1` only, on port 6510 or the next free one up to 6529, with `TCPServer` polled in
  `_process` (no threads; every op runs on the editor's main thread).
- When it starts it writes `res://.godot/godotwright_bridge.json`: `{port, token, pid, godot_version, project,
  bridge_version}`. It removes the file when the plugin is disabled or the editor closes. The token is 32 random hex
  characters, new at every start.
- A request is one line of JSON: `{"id", "token", "op", "args"}`. The answer is one line: `{"id", "ok": true,
  "result"}` or `{"id", "ok": false, "error": "text"}`.
- The token is compared in constant time (`Crypto.constant_time_compare`). A line that is not JSON, has no token or
  the wrong one gets **no answer**: the connection is closed.
- A message is at most 1 MiB in either direction. Screenshots are written to `res://.godot/godotwright/` and only the
  path is sent.
- At most 8 connections at a time; one that sends nothing for 15 s is closed.

## Ops

`kind` says what an op touches: `read` nothing; `view` only what the editor shows; `write` project files or unsaved
editor changes; `run` starts or stops the game. A read-only server should allow `read` only (`editorOpChanges(op)`).

| Op | Args | Kind | Result |
| --- | --- | --- | --- |
| `status` | `{}` | read | `godot_version`, `project`, `scenes: [{path, current, unsaved?}]`, `current_scene`, `has_scene`, `current_root: {name, class}`, `unsaved_known`, `playing`, `playing_scene`, `main_screen`, `errors_supported`, `scanning` |
| `open_scene` | `{path}` | view | `{opened, current_scene}` |
| `save_scene` | `{}` | write | `{saved}` |
| `save_all` | `{}` | write | `{saved: "all", unsaved: [...]}` |
| `reload_scene` | `{path?, discard?}` | write | `{reloaded}`; refuses a scene with unsaved editor changes unless `discard: true` |
| `close_scene` | `{discard?}` | write | `{closed}`; refuses unsaved changes unless `discard: true` |
| `selection` | `{}` | read | `{scene, nodes: [{path, name, class, script?}]}` |
| `select` | `{paths: [...]}` | view | as `selection` |
| `edit_node` | `{path}` | view | `{editing: {path, name, class, script?}}` |
| `inspect` | `{path?, limit?}` | read | node info plus `properties: [{name, type, value}]`, `more` |
| `tree` | `{depth?, limit?}` | read | `{scene, depth, nodes: [{path, name, class, script?, scene?, depth, children}], truncated}` |
| `play` | `{mode?: "main"\|"current"\|"scene", scene?}` | run | `{mode, scene, playing}` |
| `stop` | `{}` | run | `{stopped}` |
| `screenshot` | `{target?: "editor"\|"viewport_2d"\|"viewport_3d", index?}` | view | `{path, res_path, width, height, target}` |
| `filesystem_scan` | `{}` | write | `{started, scanning, importing, progress}` |
| `reimport` | `{paths: [...]}` | write | `{reimported: [...]}` |
| `is_scanning` | `{}` | read | `{scanning, importing, progress}` |
| `set_property` | `{path, property, value}` (value: a JSON number or bool, or Variant text such as `"Vector2(1, 2)"`) | write | node info, `property`, `before`, `after`, `undo` (the undo step) |
| `add_node` | `{parent?, type? \| scene?, name?, properties?}` | write | node info, `undo` |
| `remove_node` | `{path}` | write | `{removed, undo}`; refuses the scene root |
| `rename_node` | `{path, name}` | write | node info, `before`, `undo`; refuses a name a sibling has |
| `errors` | `{since?, limit?}` | read | `{supported, errors: [{seq, type, file, line, function, message, code?, engine_source?, msec}], next, more, dropped, total, restarted, game_errors}` |

Node paths start at the root of the edited scene (`.` is the root), as `tree` prints them.

Left out on purpose:

- **No op runs code** (no `eval`, no script execution).
- **Scene edits only as editor actions.** `set_property`, `add_node`, `remove_node` and `rename_node` edit the open
  scene through `EditorUndoRedoManager` (`create_action` ... `commit_action`), the way the editor's own docks do: each
  is one step in the scene's undo history, so Ctrl+Z in the editor takes it back, and the scene is unsaved until
  `save_scene`. Edits to scenes that are not open stay file edits (`godot_scene_edit`; `reload_scene` shows them).
- **No `undo_redo`.** `EditorUndoRedoManager` has no public `undo` or `redo` in the 4.7 class reference. It can hand
  out the scene's `UndoRedo` (`get_history_undo_redo`), but the reference itself warns that using it directly can
  make the editor unstable, so the bridge does not.

### `errors`: what is captured, and what is not

- Captured: errors and warnings of the **editor process**, through a `Logger` registered with `OS.add_logger` (Godot
  4.5+): script parse errors when a script is loaded or saved, errors of `@tool` scripts and plugins, import errors,
  `push_error` / `push_warning`, and what is printed to stderr (type `stderr`). The last 500 are kept. Each has a
  sequence number; pass the `next` of one answer as `since` of the following call to get only new ones.
- Not captured: errors of a **game started from the editor**. The game is another process. The editor receives its
  errors as the debugger message `error`, and `EditorDebuggerPlugin._capture` is only given messages with a
  `prefix:` that a plugin registered (`_has_capture`), so there is no supported way to read them. The answer says so
  in `game_errors`. Use `godot_session`, `godot_play` or `godot_check` for the game's errors.
- Not captured: errors the script editor shows only while typing, before the file is saved.
- On Godot 4.4 the answer is `{supported: false, reason}` and points to `godot_check`.

## Install

```sh
godotwright editor install [path]      # copy the addon, enable it in project.godot
godotwright editor install --no-enable # only copy the files
godotwright editor uninstall [path]
```

- The files go to `res://addons/godotwright_bridge/`. A folder of that name whose `plugin.cfg` has no
  `; godotwright-editor-bridge <version>` line is someone else's: install and uninstall refuse it.
- Enabling adds `res://addons/godotwright_bridge/plugin.cfg` to `[editor_plugins] enabled=PackedStringArray(...)` with
  the settings writer of `godot_project_edit`; other plugins in the list stay.
- Both writes are journaled, as two entries (the files, then project.godot): `godotwright undo --steps 2` takes an
  install back.
- An open editor does not read project.godot again. With the project open, enable "Godotwright Bridge" in Project
  Settings > Plugins, or restart the editor.
- Uninstall also removes the `.uid` files Godot wrote next to the scripts. Files in the folder that are not ours stay.

## Manual test (Godot 4.7.2)

Use a project with a main scene, a second scene, and at least one script. `P` below is the project folder.

### 1. Install and start

1. Close the editor. Run `godotwright editor install P`.
   Expect: `installed the editor bridge (version 2): 5 files in res://addons/godotwright_bridge/` and
   `enabled it in project.godot`. `P/project.godot` has
   `enabled=PackedStringArray("res://addons/godotwright_bridge/plugin.cfg")` under `[editor_plugins]`.
2. Open `P` in Godot 4.7.2. Expect: **no errors in the Output panel**, and Project Settings > Plugins shows
   "Godotwright Bridge" enabled. If the Output shows a parse error in `plugin.gd`, `bridge_ops.gd` or `error_log.gd`,
   that is the first thing to report (file and line).
3. Expect a file `P/.godot/godotwright_bridge.json` such as
   `{"bridge_version":"2","godot_version":"4.7.2-stable (official)","pid":12345,"port":6510,"project":"...","token":"<32 hex>"}`.
   On Linux and macOS: `ls -l` shows `-rw-------`.
4. `godotwright editor status P`. Expect:

   ```
   addon: installed, version 2; enabled in project.godot
   editor: Godot 4.7.2-stable (official), project "<name>"
   open scenes (1):
     * res://main.tscn
   current root: Main (Node2D)
   game: not playing
   ```

   `main screen` appears on the first line only after you switch between 2D, 3D and Script once.

### 2. Each op

Every command is `godotwright editor <op> P [--args '<json>']`; add `--json` to see the raw answer.

| # | Do | Expect |
| --- | --- | --- |
| 1 | Move a node in the editor, do not save. `status` | the scene line ends in `[unsaved]` |
| 2 | `tree --args '{"depth": 2}'` | the nodes as the editor shows them, the moved node included; `+N below` where depth cuts off |
| 3 | `inspect --args '{"path": "."}'` | stored properties of the root; the moved node's `position` shows the unsaved value when you inspect that node |
| 4 | `save_scene`, then `status` | `saved res://main.tscn`; no `[unsaved]` |
| 5 | `open_scene --args '{"path": "res://second.tscn"}'` | the editor switches to that tab; `status` marks it `*` |
| 6 | `open_scene --args '{"path": "res://nope.tscn"}'` | error `res://nope.tscn does not exist`, exit code 1 |
| 7 | `select --args '{"paths": ["."]}'`, then `selection` | the root is selected in the Scene dock; both print `selected (1):` |
| 8 | `edit_node --args '{"path": "<a child>"}'` | the inspector shows that node |
| 9 | Change the open scene's file on disk (`godotwright scene ...` or a text editor), then `reload_scene` | `reloaded res://... from disk`; the editor shows the change, without the "files changed on disk" dialog staying open |
| 10 | Change a node in the editor (unsaved), then `reload_scene` | refused: `... has unsaved changes in the editor; save_scene first, or pass discard: true ...` |
| 11 | `reload_scene --args '{"discard": true}'` | reloaded; the unsaved change is gone |
| 12 | `save_all` | `saved all open scenes` |
| 13 | `play` | the game starts (main scene); `status` says `game: playing res://main.tscn` |
| 14 | `stop` | the game closes; `stop` again says `no game was running` |
| 15 | `play --args '{"mode": "current"}'`, `stop`; `play --args '{"scene": "res://second.tscn"}'`, `stop` | the current scene, then the named scene, runs |
| 16 | `screenshot` | `screenshot of editor: P/.godot/godotwright/editor_editor.png (WxH)`; the PNG shows the whole editor window |
| 17 | `screenshot --args '{"target": "viewport_2d"}'` and `'{"target": "viewport_3d"}'` | PNGs of the 2D and the 3D viewport (the 3D one may be empty until the 3D screen was shown once) |
| 18 | Copy a new PNG into `P`, then `filesystem_scan`, then `is_scanning` until it says `not scanning or importing` | the file appears in the FileSystem dock, with an `.import` file next to it |
| 19 | `reimport --args '{"paths": ["res://<that>.png"]}'` | `imported again: res://<that>.png` |
| 20 | `close_scene` on a saved scene | the tab closes; with unsaved changes it is refused unless `{"discard": true}` |

### 3. Errors

1. `errors`. Expect `no new errors or warnings in the editor` (or what the editor logged at start) and a line
   `next: since N`.
2. Break a script with a text editor outside Godot (for example write `var x: int = "a" +` on a line), go back to the
   editor so it reloads the file. Then `errors --args '{"since": N}'`. Expect an entry like
   `#N+1 script res://that.gd:LINE: Parse Error: ...`.
3. In a `@tool` script, call `push_warning("bridge test")` in `_ready` and reopen its scene. Expect a `warning` entry
   with the message `bridge test`, and `file` / `line` of the script (from the script backtrace) rather than of
   `core/variant/variant_utility.cpp`. If `file` is the .cpp file, note it: the backtrace was empty.
4. Call `errors` again with the new `next`: nothing new.
5. `play` a scene whose script calls `push_error("from the game")`. `errors` must **not** show it (it is the game's
   process), and the last line says so. If it does show up, the note in `error_log.gd` and here is wrong: report it.
6. Check that no entry appears twice (once as `error`, once as `stderr`). If one does, report it.

### 4. Safety

1. `printf '{"id":1,"token":"wrong","op":"status","args":{}}\n' | nc 127.0.0.1 6510`. Expect: no output, the
   connection closes.
2. `printf 'GET / HTTP/1.1\r\n\r\n' | nc 127.0.0.1 6510`. Expect: no output, the connection closes.
3. From another machine on the network, `nc <this-ip> 6510`. Expect: connection refused.
4. Change one character of the token in `.godot/godotwright_bridge.json`, run `godotwright editor status P`. Expect:
   `editor: the editor closed the connection without an answer: the token ... was not accepted ...`. Put it back.
5. Open a second project with the addon. Expect its bridge file to say port 6511.
6. Kill the editor process (not a normal quit). `godotwright editor status P`. Expect:
   `.godot/godotwright_bridge.json is left over from an editor that is gone (...)`.

### 5. Stop and uninstall

1. Disable the plugin in Project Settings > Plugins. Expect: `.godot/godotwright_bridge.json` is gone, no errors in
   the Output, `godotwright editor status P` says `the editor is not running or the addon is not enabled: ...`.
   Enable it again: the file is back with a new token.
2. Quit the editor normally. Expect: the bridge file is gone.
3. `godotwright editor uninstall P`. Expect: `removed the plugin from project.godot`, `removed N files`, the folder
   `addons/godotwright_bridge/` is gone (the `.gd.uid` files too), and opening the project shows no "plugin missing"
   warning.

### 6. Godot 4.4 (optional)

Open a 4.4 project with the addon. Expect: the plugin loads without errors, `status` works with `unsaved` left out if
that version has no `EditorInterface.get_unsaved_scenes`, and `errors` answers
`errors: not supported. This Godot has no Logger class ...`. `error_log.gd` is never loaded there; if the editor
still reports a parse error for it at start, report it.

## What to look at first if something is off

- A parse error at start: the addon is typed GDScript that no Godot has compiled yet.
- `errors` empty after a script error: `OS.add_logger` did not take the script logger, or `_log_error` has the wrong
  parameters for that version.
- `screenshot` of `editor` black or failing: the root window's texture is not readable with the renderer in use.
- `reload_scene` leaves a dialog open: the editor noticed the file change before the op ran.
