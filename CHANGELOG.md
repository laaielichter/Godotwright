# Changelog

All notable changes. Versions follow semver; before 1.0 a minor version may change behaviour.

## 0.1.0 (3D models)

Godotwright now builds, views and checks 3D models, not only GDScript.

### Added

- **`test`** (MCP `godot_test`): run a project's GUT or GdUnit4 tests in Godot headless and read their JUnit report,
  so the result is one line of totals and one line per failing test (`res://file:line  test  message`), plus script
  errors from the run. Finds the framework in `res://addons`, uses `.gutconfig.json` when there is one, else
  `res://test` and `res://tests`; `--dir` and (GUT) `--filter` narrow it. Exit code 1 when a test fails. Tested in CI
  against GUT 9.7.1 and GdUnit4 6.2.2 on Godot 4.7.2.

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

- **`building.watchtower`** archetype; `spaceship fighter` and `sci-fi fighter` now mean the spaceship; `model view` draws
  all views at one scale. Found in a second run of the small-model test, written up in `docs/cheap-models.md`.

- **`model brief`** points to the option of a kind that makes the thing: a lake is `terrain --set lakeRadius=60`,
  a river `--set riverWidth=6`, an island `--set relief=island`, a mountain `--set relief=mountains`, with the
  parameters to tune it.

- **`check --scene <res-path>`** and the run's output: `check --run` (MCP `godot_check` with `run_frames` or `scene`)
  now returns what the game printed, engine noise removed, so an agent can read its own `print()` calls back.
- **`migrate`** (CLI and MCP tool `godot_migrate`): rewrites Godot 3 GDScript to Godot 4 where that is mechanical
  (annotations, renamed classes, functions, properties and constants, `yield` to `await`, `connect`/`emit_signal`/`funcref`
  to signals and callables, moved members) with a dry run first, and lists what still needs a hand.
- **`review --sarif`**: the review as SARIF 2.1.0 for GitHub code scanning, so findings show inline on pull requests.
- **`model build --collision convex|trimesh`** (MCP `collision`): names the meshes with Godot's import hints (`-convcol`,
  `-col`), so Godot creates collision shapes when it imports the `.glb`; node names in the scene stay plain.
- **`review --only-new`** (MCP `only_new`): after the first review, only the findings that are new since the last one in
  full, the rest as one short line each, and how many are fixed; made for agents in a fix loop.

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
- `docs/cheap-models.md`: a test of small, cheap models building 3D models, and what it led to.
- A gallery of the models: https://laaielichter.github.io/Godotwright/models.html

### Changed

- The description and keywords mention 3D models.

## 0.0.2

- Find Godot in the usual install folders, Steam and Downloads.
- Godot 4 window property migration hints, from a community contribution.
- Published to npm with provenance and listed in the official MCP Registry.

## Before 0.0.2

- Offline Godot 4.7 API lookup and search, project map, headless checks, AAA review with scores, MCP server with
  cheap and premium profiles, local learning, a benchmark of 168 agent runs.
