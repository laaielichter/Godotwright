---
name: godot
description: Use for any work on a Godot 4 project (project.godot, .gd, .tscn, .tres, GDScript, shaders, 3D models for Godot, or porting Godot 3 code). Maps the project, looks up the exact Godot 4.7 API instead of guessing, reviews code before and after each edit, and checks with Godot before finishing.
---

# Working on a Godot project with Godotwright

The Godotwright tools answer from the real Godot 4.7 class reference and from this project's own files.
Use them instead of memory: models learned Godot from years of Godot 3 tutorials, and Godot 3 names
(`KinematicBody2D`, `export var`, `yield`, `instance()`) do not work in Godot 4.

## Every task

1. **Map first.** Call `godot_scan` once: scenes and node trees, scripts with signatures, signals,
   autoloads and the input map. Node paths and action names come from here, not from guesses.
2. **Look up, do not guess.** Before you use a class, method, property or signal you are not sure about,
   call `godot_api` (exact signature) or `godot_api_search`. It also translates Godot 3 names.
3. **Review before you write.** Pass new GDScript to `godot_review` with `code` and `file` and fix every
   error before saving it.
4. **Review after every edit.** Call `godot_review` with the changed `files`; in a fix loop pass
   `only_new: true` to see only what changed.
5. **Check with Godot before you finish**, when it is installed: `godot_check`, and `godot_test` when the
   project has GUT or GdUnit4 tests.

## Change the project with the tools, not by hand

- Renaming or moving anything: `godot_usages` first, then `godot_rename` (dry run, then `write: true`).
- Scenes: `godot_scene_edit`. Project settings, input actions, autoloads: `godot_project_edit`.
  These keep `.tscn`, `.uid` and `project.godot` valid and touch only the lines of the change.
- Godot 3 code: `godot_migrate` (report, then `write: true`), then fix the listed TO DOs.

## See what you built

- `godot_play` runs a scene with an input timeline and returns the values you watch per frame.
- `godot_screenshot` renders a scene or a model to a PNG.

## 3D models

`godot_model_brief` or `godot_model_identify` first, then `godot_model_spec`, `godot_model_build`,
`godot_model_view` (look at it as text) and `godot_model_lint` with the archetype. Models face +Z,
+Y is up, units are metres.

If you verified that a review finding is a false alarm, report it with `godot_feedback` (verdict `wrong`).
Keep changes small and use static types (`var speed: float = 200.0`, `func jump() -> void`).
