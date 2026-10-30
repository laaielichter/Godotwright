# Changelog

All notable changes. Versions follow semver; before 1.0 a minor version may change behaviour.

## 0.1.0 (work on your project without the editor, and 3D models)

Until now Godotwright read a project and told the agent what was wrong. Now an agent can also **change** a project
(rename, settings, input map, autoloads, scenes), **run** it (unit tests, a scene with input, screenshots) and **look**
at what it made, all checked against Godot 4.7 and without the editor. It also builds, views and checks 3D models.

### Change a project safely

- **`scene add|remove|set|connect|disconnect|script`** (MCP `godot_scene_edit`): change a `.tscn` without the editor.
  Node classes, properties (with enums by name and resources as `res://` files) and signals are checked against
  Godot 4.7 and the node's script; a connection warns when the method is missing or takes other arguments and gives the
  `func` line to add; removing a node takes its children, connections and the resources only it used; a script that
  extends another node type is refused. Only the lines of that change are touched, plus a new `ext_resource` (with its
  uid) and `load_steps`.

- **`project set|unset`, `project input add|remove`, `project autoload add|remove`** (MCP `godot_project_edit`): change
  project.godot without the editor. Settings are checked against the Godot 4.7 reference (name, type, `res://` files),
  input events are written in the Godot 4 format from short names (`Key:Ctrl+S`, `Mouse:Left`, `JoyButton:A`,
  `JoyAxis:left_y-`), and autoloads must be a Node script or a scene whose name clashes with no class. Only the lines of
  that entry change; dry run first, review errors before and after.

- **`rename`** (MCP `godot_rename`): rename a function, signal, variable, class, autoload, input action, group or node
  everywhere, or move a `res://` file with its `.uid` and `.import` files and every reference. Dry run first, refuses a
  name that is taken, and reports the review errors before and after.

- **`usages`** (MCP `godot_usages`): find every place a function, signal, variable, class, autoload, input action, group,
  node or `res://` path / `uid://` is used, offline and without the editor: GDScript code (not comments), names Godot looks
  up in strings (connect, emit_signal, actions, groups, get_node, load), scene connections, node names and groups, project
  settings. A resource also says whether the file exists.

- **`migrate`** (CLI and MCP tool `godot_migrate`): rewrites Godot 3 GDScript to Godot 4 where that is mechanical
  (annotations, renamed classes, functions, properties and constants, `yield` to `await`, `connect`/`emit_signal`/`funcref`
  to signals and callables, moved members) with a dry run first, and lists what still needs a hand.

### Run it and see it

- **`screenshot`** (MCP `godot_screenshot`, which returns the image): render a scene, or a `.glb`/`.gltf` model, to a
  PNG with Godot's Compatibility renderer, which also runs on software OpenGL; on Linux without a display it uses
  `xvfb-run`. A model (or a 3D scene without a camera) gets a camera that fits it exactly, a light and ambient light, in
  the views `front` (from +Z, where models face), `back`, `side`, `top` and `iso`; several make a grid. It also says,
  per view, how much of the picture is drawn and where, so an empty or off-screen picture shows even to a model that
  cannot read images.

- **`play`** (MCP `godot_play`): run a scene headless for a number of physics frames, play an input timeline into it
  (`10 press jump; 30 release jump; 40 hold right 20; 50 tap Key:Space`; actions, keys, mouse and joypad buttons and
  axes), and print a table of the values you watch (`Player.position`, `Player.velocity.y`, `Player.is_on_floor()`)
  per frame, with errors and prints. The game sees each input on exactly that physics frame
  (`is_action_just_pressed()` included), and runs are deterministic (fixed frame rate). Warns about actions that are not
  in the input map and watched nodes that are not in the scene.

- **`test`** (MCP `godot_test`): run a project's GUT or GdUnit4 tests in Godot headless and read their JUnit report,
  so the result is one line of totals and one line per failing test (`res://file:line  test  message`), plus script
  errors from the run. Finds the framework in `res://addons`, uses `.gutconfig.json` when there is one, else
  `res://test` and `res://tests`; `--dir` and (GUT) `--filter` narrow it. Exit code 1 when a test fails. Tested in CI
  against GUT 9.7.1 and GdUnit4 6.2.2 on Godot 4.7.2.

- **`check --scene <res-path>`** and the run's output: `check --run` (MCP `godot_check` with `run_frames` or `scene`)
  now returns what the game printed, engine noise removed, so an agent can read its own `print()` calls back.

### Review

- **Review rule `api/impossible-type-test`**: `x is T` or `x as T` where the static type of `x` can never be a `T` (two
  classes where neither inherits from the other, a class against a built-in type, or `is` between two different
  built-in types). Godot stops with a parse error on these; every case in the tests was checked against Godot 4.7.2,
  and `as` between built-in types (a conversion, like `float as int`) is left alone. Found while writing `screenshot`.

- **`review --sarif`**: the review as SARIF 2.1.0 for GitHub code scanning, so findings show inline on pull requests.

- **`review --only-new`** (MCP `only_new`): after the first review, only the findings that are new since the last one in
  full, the rest as one short line each, and how many are fixed; made for agents in a fix loop.

### 3D models

- **`building.watchtower`** archetype; `spaceship fighter` and `sci-fi fighter` now mean the spaceship; `model view` draws
  all views at one scale. Found in a second run of the small-model test, written up in `docs/cheap-models.md`.

- **`model brief`** points to the option of a kind that makes the thing: a lake is `terrain --set lakeRadius=60`,
  a river `--set riverWidth=6`, an island `--set relief=island`, a mountain `--set relief=mountains`, with the
  parameters to tune it.

- **`model build --collision convex|trimesh`** (MCP `collision`): names the meshes with Godot's import hints (`-convcol`,
  `-col`), so Godot creates collision shapes when it imports the `.glb`; node names in the scene stay plain.

- **Model tools** (CLI and MCP): `model inspect` and `model lint` for `.glb`/`.gltf` (flipped faces, open edges, normals, UVs,
  tangents, textures, node names, budgets, with a score), `model contract` (pin node names, size and triangle budget,
  or start one from what a thing usually is with `--archetype`), `model identify` and `model archetypes` (what a thing
  is: parts, pivots, typical size with its source and confidence, variants, what to anticipate; English and Dutch),
  `model spec` and `model build` (a JSON tree of named parts to a clean `.glb`, deterministic), `model kinds`,
  `model recipes` (also `model recipes <kind>` to print a recipe's spec), `model view` (front, side and top views as text, a table of the parts, parts that do not touch), and `model brief` (one page for small models before they build: the kind to start from, parts, size, rules, mistakes, the order of tools and a short spec cheat sheet; MCP tool `godot_model_brief`).

- **53 ready-made, parametric kinds**: house, car, truck, bus, motorcycle, bicycle, tractor, tank, train, airliner, light
  aircraft, fighter, helicopter, drone, ship, boat, sailboat, piston and jet engine, wind turbine, barn, tower, church,
  windmill, apartment, bridge, road, railway track, street lamp, fence, power pylon, trees, palm, bush, grass, flower,
  crate, barrel, chair, table, shipping container, campfire, rowing boat, rocket, satellite, castle, humanoid, horse, dragon,
  spaceship, and open-world
  terrain and sea.

- **Terrain** with plains, hills, mountains or an island, tiles that continue each other exactly, an optional lake and an
  optional river that always runs downhill, and a water plane at sea level.

- **80 archetypes**, including an open-world family (terrain, mountain, island, coast, sea, lake, river, biome, settlement),
  fortifications, creatures (quadruped, humanoid, dragon), spacecraft (rocket, spaceship, satellite), a rowing boat and a
  campfire, and a check of a model against its archetype: missing parts, pivots, wheel axes, size (unit mistakes), direction.

- **`model lint --archetype` says what it compared**: required parts found, nodes that matched no part, and whether the size was
  checked; for a guess or an unknown thing it says that only the general rules ran, so a high score is not read as more than it is.

- **A check for parts that do not touch the rest** of a model (a ladder away from its tree, a wheel without an axle).

- MCP tools `godot_model_identify`, `godot_model_spec`, `godot_model_build`, `godot_model_lint`, `godot_model_inspect`
  and `godot_model_view`, with the workflow in the server instructions.

- Spec language: shapes (box, cylinder, ellipsoid, lathe, loft, extrude, roof), expressions, mirror, repeat in rows and
  rings, parameters with ranges, emissive materials.

- A gallery of the models: https://laaielichter.github.io/Godotwright/models.html

### Made for small models

- **Fixes from watching small models work.** Twelve Haiku agents did six everyday Godot tasks with Godotwright; their
  logs showed five things that got in their way, now fixed:
  - `check` skips `res://addons/` by default (third-party code; the GUT addon's own scene raised an error that was not
    the project's). `--include-addons` loads it anyway.
  - `check --run` and `--scene` run at a fixed frame rate (the project's physics rate), so N frames are N/60 s of game
    time and a 2 s timer fires within 120+ frames. The output says how much game time the frames were.
  - `review` no longer calls unit test scripts (GUT, GdUnit4) unused: the test runner loads them.
  - `review` counts only the project's own scenes, and `review a.gd b.gd` shows only the findings of those files (the
    scores stay for the whole project).
  - `play --watch Score.points` finds an autoload by name.

- `docs/cheap-models.md`: a test of small, cheap models building 3D models, and what it led to.

### Changed

- The description and keywords mention 3D models.

## 0.0.2

- Find Godot in the usual install folders, Steam and Downloads.
- Godot 4 window property migration hints, from a community contribution.
- Published to npm with provenance and listed in the official MCP Registry.

## Before 0.0.2

- Offline Godot 4.7 API lookup and search, project map, headless checks, AAA review with scores, MCP server with
  cheap and premium profiles, local learning, a benchmark of 168 agent runs.
