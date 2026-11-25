# Godotwright Bridge (editor addon)

Lets [Godotwright](https://github.com/laaielichter/godotwright) see and drive the **open** Godot editor: which scenes
are open and unsaved, the selection, the edited scene tree, the editor's errors, save, reload, run, stop, an editor
screenshot, a filesystem scan. It is optional: every other Godotwright tool works without it.

> Not yet run in Godot. This addon was written and checked against the Godot 4.7.2 class reference (every engine
> method it calls is looked up in a test), reviewed and formatted with Godotwright, but the machine it was written on
> had no Godot. The manual test steps are in `docs/editor-bridge.md` of the Godotwright repository.

## Install

```sh
godotwright editor install      # copies this folder to res://addons/ and enables the plugin in project.godot
godotwright editor status       # is the addon there, is it enabled, does the editor answer
godotwright editor uninstall
```

Install with the editor closed, or enable "Godotwright Bridge" yourself in Project Settings > Plugins: an open editor
does not read project.godot again.

## What it does

- Godot 4.4 or newer. The `errors` op needs Godot 4.5+ (the `Logger` class).
- A TCP server on `127.0.0.1` only, on port 6510 or the next free one (up to 6529), polled in `_process`: no threads.
- On start it writes `res://.godot/godotwright_bridge.json` with `port`, `token`, `pid`, `godot_version` and `project`,
  and removes it on exit. The token is 32 random hex characters, new at every start, compared in constant time. A
  request without it gets no answer: the connection is closed.
- One request is one line of JSON, `{"id", "token", "op", "args"}`; one answer is one line, `{"id", "ok", "result"}` or
  `{"id", "ok": false, "error"}`. A message is at most 1 MiB. Screenshots are written to `res://.godot/godotwright/`
  and only the path is sent.
- Ops: `status`, `open_scene`, `save_scene`, `save_all`, `reload_scene`, `close_scene`, `selection`, `select`,
  `edit_node`, `inspect`, `tree`, `play`, `stop`, `screenshot`, `filesystem_scan`, `reimport`, `is_scanning`, `errors`.
- There is no op that runs code, and none that edits a scene: scene edits are file edits (`godot_scene_edit`), and
  `reload_scene` makes the editor show them.
- `errors` holds the last 500 errors and warnings of the editor process (script parse errors, tool scripts, imports).
  Errors of a game started from the editor happen in another process and are not captured: use `godot_session`,
  `godot_play` or `godot_check` for those.

## Files

- `plugin.cfg`, `plugin.gd`: the plugin, the server, the token check.
- `bridge_ops.gd`: the ops.
- `error_log.gd`: the `Logger` that keeps the errors (loaded only on Godot 4.5+).
