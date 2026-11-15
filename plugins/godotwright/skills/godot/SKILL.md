---
name: godot
description: Use for any work on a Godot 4 project (project.godot, .gd, .tscn, .tres, GDScript, shaders, 3D models for Godot, or porting Godot 3 code). Maps the project, looks up the exact Godot 4.7 API instead of guessing, reviews code before and after each edit, and checks with Godot before finishing. Also in Dutch: "werk aan mijn Godot-project", "schrijf een GDScript", "maak een scene", "werkt dit in Godot 4".
---

# Working on a Godot project with Godotwright

The Godotwright tools answer from the real Godot 4.7 class reference and from this project's own files.
Use them instead of memory: models learned Godot from years of Godot 3 tutorials, and Godot 3 names
(`KinematicBody2D`, `export var`, `yield`, `instance()`) do not work in Godot 4.

## Every task

0. **Something broken, or a project you do not know?** Call `godot_doctor` first: what is wrong, in which order to
   fix it, why (the lesson), and which fixes `godot_fix` or `godot_migrate` can do for you.
1. **Map first.** Call `godot_scan` once: scenes and node trees, scripts with signatures, signals,
   autoloads and the input map. Node paths and action names come from here, not from guesses.
2. **Look up, do not guess.** Before you use a class, method, property or signal you are not sure about,
   call `godot_api` (exact signature) or `godot_api_search`. It also translates Godot 3 names.
3. **Review before you write.** Pass new GDScript to `godot_review` with `code` and `file` and fix every
   error before saving it.
4. **Review after every edit.** Call `godot_review` with the changed `files`; in a fix loop pass
   `only_new: true` to see only what changed.
5. **Look at the whole change before you finish.** `godot_impact` lists the scenes, tests and saved scenarios your
   edits reach and the checks to run for them; `godot_diff` shows what changed by meaning, and every line marked `!`
   is something the change broke elsewhere (a scene connection to a removed function, a saved `@export` value).
6. **Check with Godot before you finish**, when it is installed: `godot_check`, and `godot_test` when the
   project has GUT or GdUnit4 tests.

## Change the project with the tools, not by hand

- Renaming or moving anything: `godot_usages` first, then `godot_rename` (dry run, then `write: true`).
- Scenes: `godot_scene_edit`. Project settings, input actions, autoloads: `godot_project_edit`. `.tres` resources and import settings (loop, compression, per-animation or per-mesh options): `godot_resource_edit`.
  These keep `.tscn`, `.uid` and `project.godot` valid and touch only the lines of the change.
- Godot 3 code: `godot_migrate` (report, then `write: true`), then fix the listed TO DOs. It ports shaders too.
- Shaders: after writing or changing a `.gdshader` (or a Shader in a scene), run `godot_shader`; it checks the code
  against Godot 4.7's shader tables and compiles it with Godot headless. `godot_api` with `shader:spatial.fragment`
  lists the built-ins of a shader type and function.
- Mechanical findings (a freed check in the wrong order, `get_meta()` with a null default, a lone ternary, garbled
  text, `emit_signal()`, MultiMesh or Timer order): `godot_fix` (report, then `write: true`), not by hand.
- Collision layers and masks: `godot_collisions` before you set one, and when something falls through or is not
  detected; `between: ["Player", "Enemy"]` says who detects whom and the mask value to set (layer 3 is the value 4).
- Before deleting or moving a file: `godot_deps` op `why` (also paths the code builds); `op unused` lists what can go.
- A Godotwright write that made things worse: `godot_undo` puts the files back (newest write first).

## See what you built

- `godot_play` runs a scene with an input timeline and returns the values you watch per frame. `until` stops when a
  condition holds, `signals` records when signals fire, `summary` keeps long runs short, and `expect` turns a run
  into a test.
- When `godot_play` with `expect` proves a fix, keep it: `godot_scenario` op `save` with the same arguments runs it
  once more and writes it to `.godotwright/scenarios/`, where `godotwright ci` runs it on every change. op `run`
  runs the kept scenarios.
- `godot_session` loads a scene once and keeps it running; `godot_game` then shows the live tree, reads and sets
  values and steps frames with input until a condition holds; `reload` puts the scripts you edited into the running
  game with every node's values kept. Use it when a world loads slowly or a state is hard to reach; stop it when done.
- `godot_perf` measures frame times (p50/p95/p99, the slowest frames and their cause) and compares with the last run.
- `godot_leaks` loads, runs and frees a scene in cycles and names what grows per cycle (orphan nodes by class and
  script with where they were made and removed, nodes left behind, objects that are not nodes); 0 per cycle proves a fix.
- `godot_screenshot` renders a scene or a model to a PNG.

## Know what real projects learned

Godotwright holds lessons from large Godot 4 projects (vehicles and moving decks, open worlds tens of kilometres wide,
cockpits, VFX, streaming, shaders, installers for shipped games, headless tests). Before you build any of that, call
`godot_lessons` with a few words about it; with a Godot error you do not understand, call it with the message as
`error`. The skills `debug`, `perf`, `vehicles`, `world`, `model` and `patch` hold the workflow for each of these.

## 3D models

`godot_model_brief` first, then `godot_model_library` (over a thousand ready-made base recipes to start from) or
`godot_model_spec`, `godot_model_build`, `godot_model_view` (look at it as text) and
`godot_model_lint` with the archetype. Models face +Z, +Y is up, units are metres. The `model` skill has the details.

## When the plugin hooks are on

Every `.gd`, `.tscn`, `.tres`, `.gdshader` and `project.godot` you edit is reviewed right after the edit: errors come
back to you at once, warnings as a note. Godot errors in a command's output come with the lessons that explain them.
Before you stop, review errors still open in files you changed are named once. Fix them, or say why they stay.

## Learn from real projects, and teach back

- When Godot shows an error you do not understand, call `godot_lessons` with the message as `error`: lessons from real
  Godot projects say what it usually means and how to fix it. Before you build moving platforms, vehicles, ships,
  large worlds, runtime-loaded models, shaders or headless tests, call `godot_lessons` with a few words about it.
- When a fix took more than one try, keep the lesson with `godot_lesson_add` (general words, the Godot message as
  `error`, no names or code). The next check shows it when the same error comes back.
- Say whether a lesson helped with `godot_feedback` (`lesson`, verdict `right` or `wrong`).
- These tools come with Godotwright 0.3.0 and later; skip this part on an older server.
- For deeper work, hand off to the `godot-reviewer` agent (verified review of a change) or the `godot-debugger` agent
  (root cause of an error or wrong behaviour) so their logs stay out of the main conversation.

If you verified that a review finding is a false alarm, report it with `godot_feedback` (verdict `wrong`).
Keep changes small and use static types (`var speed: float = 200.0`, `func jump() -> void`).
