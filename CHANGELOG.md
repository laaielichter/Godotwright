# Changelog

All notable changes. Versions follow semver; before 1.0 a minor version may change behaviour.

## Unreleased

- **`godot_doctor` (and `godotwright doctor`): what is wrong, in which order to fix it, and why.** One call runs the
  review and, when Godot is installed, loads every script and scene with Godot; it groups the findings by cause
  (twenty findings from one missing file are one problem), puts the most urgent first, and gives each its place, the
  lesson that explains it, the fix, and whether `godot_fix` or `godot_migrate` can do it. `symptom` adds the lessons
  for what you see going wrong. It ends with numbered next steps.
- **`godot_fix` (and `godotwright fix`): mechanical fixes for review findings**, each labelled `safe` (only removes the
  problem) or `check` (read it): a freed check put first, `get_meta()` with `has_meta()`, a lone ternary as if/else,
  text encoded twice decoded, `emit_signal()` as `signal.emit()`, a MultiMesh format moved before `instance_count`,
  `Timer.start()` moved after `add_child()`, `weakref()` typed `WeakRef`, Variant inference typed, and (check) an
  `await` added to a coroutine call. It shows the changes first, writes with `write`, and reviews the changed files
  again so the result says what is left.
- **Runtime errors come with their GDScript call chain.** `godot_check`, `godot_play`, `godot_test` and screenshots
  keep the backtrace Godot prints with a runtime error and show the callers under it; an error that repeats every
  frame is one line with its count (`(x120)`).
- **A game session that stays up: `godot_session` and `godot_game`** (and `godotwright session` / `godotwright game`).
  The scene loads once, headless and paused at frame 0, and keeps running between calls: look at the live tree, read
  and set values, call methods, evaluate Godot Expressions, record signals, and step frames with the same frame-exact
  input as `godot_play`, stopping early when a condition holds. Every answer lists the errors the game printed since
  the last call, with their call chain. Time only moves on a step, so it stays deterministic; a world that takes a
  minute to load loads once. No editor and no add-on: a temporary script in `.godot/godotwright/` on a loopback port
  with a token; the game quits by itself after 15 idle minutes.
- **`godot_perf` (and `godotwright perf`): measure a scene the way a player feels it.** Headless frame-time p50, p95,
  p99 and max against a budget, the physics step apart from the rest, the slowest frames with what changed on them
  (thousands of nodes made in one frame, a heavy physics step, script work), node and orphan counts, the change since
  the last run of the same scene, and the lessons that fit the numbers. An error result when p95 is over budget or more
  than 10% worse than last time.
- **`godot_play` answers "did it happen, and when" in one call:** `until` stops at the first frame a condition holds,
  `signals` records when signals fire with their arguments, `summary` gives one line per watched value (start, end,
  min, max, first change) instead of a table, and `expect` checks claims and makes the run fail when one does not hold.
- **New review rule `structure/connection-arguments` (error):** a signal connection saved in a scene whose method
  cannot take what the signal passes (counting `binds`, `unbinds` and the source object flag). Godot fails on every
  emit with "Method expected 1 argument(s), but called with 0"; the review now says so before the game runs. Quiet on
  the 139 official demos and every project of a large open world.
- **Reviews are 3.5 times faster on large projects, and the edit hook about 20 times faster.** On a game with 800
  scripts a full review took 12.6 s and now takes 3.6 s; the findings are byte for byte the same on 163 projects (the
  139 official demos and every project of a large open world).
  - Godot API lookups are indexed and kept per class instead of scanned each time.
  - Finding scripts that nothing refers to reads the code once instead of once per script.
  - Each check looks up the classes of one script through an index instead of walking all scripts.
  - A long-running MCP server parses only the files that changed since the last call.
  - New review option `focus`: the whole project is read so types resolve, but only the named files are checked. The
    edit and stop hooks use it: 0.6-1.4 s on that game instead of 12.6 s.
- **Fewer false alarms from the new rules**, found by running them over every overlay of the project the lessons came
  from:
  - `quality/standalone-ternary` reads the statement after a match pattern or an `if x:` on the same line, so
    `"key": return a if c else b` is no longer reported (a match branch that only calls `a() if c else b()` still is).
  - `quality/time-modulo-window` only looks at the conditions of `if`, `elif` and `while`, and leaves `% 2` alone: a
    blink value that is true half the time is meant to be.
  - `api/multimesh-format-after-count` knows that a MultiMesh made anew (once per pass of a loop) starts at
    `instance_count` 0.
  - `api/viewport-world-borrowed` is an info: the borrowed world works while the node is in the root viewport.

## 0.3.0 (agents in the loop, lessons from a large open world, prettier models)

- **Godotwright in the agent's loop: hooks.** New command `godotwright hook <event>` reads a Claude Code hook's JSON on
  stdin and prints hook JSON; it prints nothing when it has nothing to add, never fails the agent, and
  `GODOTWRIGHT_HOOKS=0` turns it off.
  - `post-edit`: after an edit of a `.gd`, `.tscn`, `.tres`, `.gdshader` or `project.godot` file, that file is reviewed;
    its errors go back to the agent at once (with the lessons behind them), warnings as a note, and "the errors are
    fixed" once they are.
  - `post-bash`: when a command's output holds Godot errors (`SCRIPT ERROR`, `Parse Error`, ...), the lessons that
    explain them are added.
  - `stop`: before the agent stops, review errors still open in Godot files changed in this session are named once.
  - `session-start`: a session in a Godot project starts with its name, Godot version, renderer, scripts, scenes,
    main scene, autoloads, and whether Godot is installed for the tools that run it.
- **Claude Code plugin, much better for agents.**
  - The four hooks above, wired through `hooks/run.mjs`, which starts the same godotwright version as the plugin's MCP
    server and stays silent when that version is too old to know them.
  - Six new skills Claude uses on its own: `debug` (from a Godot error or wrong behaviour to cause, fix and proof),
    `perf` (stutter, load times, fps, memory, measured before and after), `vehicles` (aircraft, ships, trains, moving
    platforms and decks), `world` (terrain, streaming, levels of detail, networks), `model` (3D models) and `patch`
    (changes to a shipped game with preflight, receipts and rollback).
  - Two subagents: `godot-reviewer` (a verified review of a change, with Godot when installed) and `godot-debugger`
    (the root cause of an error or wrong behaviour, proven with a headless run).
  - A test checks that every skill and agent names only MCP tools the server has.
- **195 new lessons from a large open-world project** (272 in all): physics on moving decks and platforms, physics
  interpolation of assemblies, cockpits and head-up displays, SubViewport screens, streaming and visibility ranges,
  terrain, water and tunnels, frame-time measurement (Performance monitors, probe nodes, percentiles and noise), worker
  threads and loading, runtime resource packs and their UIDs, procedural models and their checks, audio, UI and input,
  headless tests and test budgets, and patches to a shipped game. Every one passes the scrubber; lessons are linked to
  the rules and archetypes they are about.
- **New review rules from those lessons.** None reports an error on the official demo projects.
  - `api/coroutine-without-await` (error): the result of a function that awaits used without `await`; Godot stops
    with "is a coroutine, so it must be called with "await"".
  - `api/timer-start-outside-tree` (warning): `Timer.new()` started before `add_child()`; it never fires.
  - `api/multimesh-format-after-count` (warning): `use_custom_data`, `use_colors` or `transform_format` set after
    `instance_count`; the change is ignored.
  - `api/viewport-world-borrowed` (warning): `world_3d = node.get_viewport().world_3d`, which is null when that
    viewport shows its parent's world; use `find_world_3d()`.
  - `api/debug-only-monitor` (info): orphan-node and static-memory monitors read without `OS.is_debug_build()`; they
    are 0 in a release export.
  - `performance/subviewport-always` (info): a SubViewport set to `UPDATE_ALWAYS` and never switched back.
  - `quality/time-modulo-window` (warning): `int(t * k) % n == 0` as a periodic trigger in `_process`; it stays true
    for a whole window of frames.
  - `quality/standalone-ternary` (warning): a ternary on its own line.
  - `quality/find-children-unowned` (warning): `find_children()` for a type the script itself creates and adds;
    those nodes have no owner and are skipped unless `owned` is false.
  - `quality/worker-task-not-waited` (warning): `WorkerThreadPool` tasks that the script never waits for.
- **Fewer false alarms on real code.** The review ran over every script of that project and every overlay laid over
  it.
  - A broken `preload()` constant used as a type is reported once (the broken path), not again at every use.
  - A script that extends a base that does not resolve no longer gets errors for names that may come from that base.
  - `extends` of a script that only the shipped game holds (listed as `.gd.remap` in `baseFiles`) is not an error.
  - Statements joined with `;` are read one by one, so `var a := f(); var b := g()` declares both locals.
  - A constant that aliases an inner class of another script (`const B = Kit.Box`) works as a type.
- **21 new archetypes** for `model identify`, with English and Dutch names, parts, sizes with their source, and
  pitfalls: tiltrotor, tandem-rotor helicopter, fixed-wing drone, bomber, cruise ship, warship, superyacht, ro-ro ferry,
  aircraft carrier, submarine, helideck, offshore platform, underground station, bascule bridge, overhead power line,
  tunnel, runway, navigation buoy, high-speed train, rack railway car and fire engine. Names such as "fregat",
  "veerboot" and "chinook" now find the specific kind.

- **Every ready-made model rebuilt, better and prettier.** All 53 recipes got truer proportions, far more detail where
  the eye looks, real materials and textures (wood grain along each board, brick, slate, stone, gravel), bevelled edges
  and see-through glass with interiors behind it. Every recipe keeps its parameters, the parts its archetype needs and
  their pivots, and stays 100/100 in `model lint` at every parameter extreme. Most now have 3,000 to 19,000 triangles
  (from a few hundred), for example:
  - **Vehicles:** a car with doors, hood and trunk on hinges, an interior and alloy wheels; a cab-over truck; a city bus
    with seats behind its windows; a tractor with lugged tyres; a motorcycle, a bicycle with laced spokes, a tank with
    track belts and a two-cab railcar with bogies.
  - **Aircraft and space:** a helicopter with a glass cockpit and seats, an airliner with turbofans and winglets, a light
    aircraft, a fighter with a bubble canopy, a drone, a rocket, a satellite, a spaceship and a jet engine on its stand.
  - **Boats and machines:** a container ship, a centre-console boat, a sailboat with a cabin and rigging, a clinker
    rowing boat, an inline piston engine whose pistons, crankshaft and flywheel still move, and a wind turbine.
  - **Buildings:** a barn, a glass office tower, a stone church with a spire, a brick windmill with a stage, an apartment
    block, a castle with a moat and drawbridge, and a grandstand.
  - **Roads and props:** a bridge with girders and piers, a road with kerbs, gutters and pavements (new parameter
    `sidewalk`, so the default road is now 11 m wide), railway track with real rail profiles, a street lamp, fences,
    a power pylon, a crash barrier, a race kerb, a crate, a drum, a chair, a table, a campfire and a shipping container.
  - **Plants and creatures:** trees with branching limbs and lumpy crowns, a conifer, a palm, a bush, grass, a flower, a
    humanoid with a face, hands and clothes, a horse and a dragon with wings and claws.
- **Fresh renders of every model in the gallery** (`docs/models.html`, the overview in the README and on the site): all
  59 kinds and the terrain variants. Terrain tiles are pictured from a little higher, so the camera does not look under
  the open border of a tile. `scripts/render-gallery.mjs` takes `--out`, `--view` (front, back, side, top) and `--set`
  for previews.
- Tests get 15 s each instead of 5 s: one build and lint of the detailed models takes up to about 3 s.
- **Lessons from real projects, and Godotwright learns new ones.** `data/lessons.json` holds 77 lessons from large
  Godot 4 projects (helicopters and ships on moving decks, open worlds tens of kilometres wide, runtime-loaded models,
  shaders, headless tests): symptom, cause in Godot terms, fix, how to test, and the rule that checks it. They are
  anonymous: no code, names or paths, and a test runs every lesson through the scrubber that local lessons go through.
  - New MCP tool `godot_lessons` (and `godotwright lessons`): find lessons by words, by a Godot message, by a rule or
    a topic; `gaps: true` (and `godotwright learn gaps`) lists the Godot errors seen here that no rule predicted and no
    lesson explains yet, most frequent first: what to teach Godotwright next.
  - New MCP tool `godot_lesson_add` (and `godotwright lessons add`): keep a lesson learned in this project, with the
    Godot message it explains. Names of the project (its title, classes, nodes, files, groups, actions), paths, links,
    e-mail addresses, dates, codes, keys and source code are replaced first; a lesson that is mostly names is refused.
    Local lessons never leave the machine; `godotwright lessons export` prints them as entries to propose.
  - `godot_check` (and `godotwright check`) prints the lesson under a Godot error it explains; `godot_review` names the
    lesson behind its findings; `godot_model_brief` lists lessons from real builds of that kind of thing.
  - `godot_feedback` takes a `lesson` id: lessons that helped rank higher, and one marked wrong more often than it
    helped (at least 3 times) is no longer offered unasked.
- **Rules learn from false alarms.** A rule whose findings were marked wrong 5 times on this machine, and wrong at least
  three times as often as right, is reported one level lower. Over all installs that share, the same happens after 30
  false alarms from at least 3 installs, unless this machine said the rule was right.
- **Sharing (opt-in) also counts which built-in lessons helped**: lesson ids with three counts, never the text of a
  lesson and never a local lesson. The collector checks the ids and aggregates them like rules (at least 3 installs).
- **New review rules from those lessons.** On the 139 official demo projects they report no errors; the three
  warnings there are real cases (JSON parsed straight into a typed Dictionary, a glTF loaded at runtime without
  mipmaps).
  - `api/infer-variant` now also catches `:=` from a Variant: a loop variable over a literal or untyped array, an
    untyped parameter, or an element of an untyped Array or Dictionary. Godot 4.7 stops with "Cannot infer the type";
    a real project hit it three times.
  - `api/duplicate-declaration` (error): the same function, variable, constant or signal twice in a class, as a merge
    or a patch leaves it.
  - `api/freed-check-order` (warning): `x is T and is_instance_valid(x)`; the type test on a freed object is the error.
  - `api/get-meta-null-default` (warning): `get_meta(name, null)` prints an error when the entry is missing.
  - `api/parse-into-typed` (warning): `JSON.parse_string()` or `str_to_var()` straight into a typed Array or
    Dictionary stops the function on a missing or broken input.
  - `api/image-load-res` (warning): `Image.load_from_file("res://...png")` fails in an exported game.
  - `performance/runtime-gltf-mipmaps` (warning): a glTF turned into a scene at runtime without
    `generate_mipmaps()`: textures shimmer and take several times the video memory.
  - `performance/small-light-cube-shadow` (info): a small omni light with a cube shadow costs six shadow passes.
  - `quality/mojibake` (warning): text encoded twice ("CafÃ©").
  - `quality/interpolation-reset-every-tick` (warning): `reset_physics_interpolation()` on every tick makes a node jitter.
  - `quality/platform-layers-not-restored` (warning): `platform_floor_layers = 0` that is never set back.
  - `api/override-signature` (error): an override with fewer parameters than the function it overrides (in a script
    it extends, or an engine virtual such as `_process`), or extra ones without a default. Godot stops with "The
    function signature doesn't match the parent"; a base class that gains a parameter does this to every override.
  - `performance/get-image-in-loop` (warning): `get_image()` inside a loop reads a texture back from the GPU on every
    pass. Screenshots and test runners (SceneTree and EditorScript scripts) are left alone.
  - `quality/tree-test-reads-too-early` (warning): a SceneTree test script that reads global transforms in
    `_initialize()` before the scene it added is inside the tree.
  - `quality/shader-reads-own-depth` (warning): a `.gdshader` that reads the depth texture while it writes depth in
    the alpha prepass, so depth-based foam or fog shows everywhere.
  - `api/duplicate-declaration` and `api/override-signature` are errors Godot itself reports, so `check` confirms or
    contradicts them like the other API rules, and learning downgrades them if Godot keeps contradicting them.
  - Checked on all 20 Godot projects of the large project the lessons came from and on the 139 official demos: these
    four report nothing there.
- **New model rules:** `model/opaque-glass` (a light-coloured glass, canopy or window material that light cannot pass;
  dark solid glass, as on a house without rooms, is left alone) and
  `model/renamed-on-import` (a node name with `. : @ / " %` or a `.001` suffix, which Godot changes).
- **Claude Code plugin:** a fourth skill, `/godotwright:learn`, teaches Godotwright what the session learned; the
  `godot` skill uses the lessons when the server has them.
- **Prettier, better 3D models.** Every ready-made kind was rebuilt with more detail, truer proportions and real
  materials, and the gallery was rendered again (`scripts/render-gallery.mjs`):
  - **Textures.** Brick, roof tiles, slate, wood, bark, leaves, grass, stone, concrete, asphalt, plaster, sand and water
    get a seamless colour map and normal map at their real size, made by Godotwright (no files, no network) and stored
    in the `.glb` as PNG, repeated per metre with `KHR_texture_transform`. A custom material can use any pattern in its
    own colour: `"texture": "wood"`.
  - **More presets:** `stone`, `glass_tinted`, `steel`, `chrome`, `aluminium`, `brass`, `plastic`, `plastic_white`,
    `canvas`, `light`, `light_red`, `light_amber` (lamps that glow), `grass`, `soil`, `sand`, `water`.
  - **New in the spec:** `bevel` on boxes and cylinders (rounded edges that catch the light), `lumps` and `seed` on
    ellipsoids (tree crowns, bushes, rocks), and the `tube` shape along a path (frames, rails, pipes, branches).
  - **Terrain** is coloured per vertex: grass in lusher and drier patches, sand at the water, bare earth and rock on
    steep slopes, snow on high mountains. Lakes, rivers and the sea get rippling water.
  - **House:** brick or rendered walls, windows with frames, glazing bars and sills, slate or tile roofs, gutters and
    downpipes, a panelled door with a knob.
  - Roof tiles and other patterns on a sloping face run along the slope.
  - `model build --no-textures` (MCP `textures: false`) keeps plain colours and small files.
  - Tangents follow glTF's normal-map convention (+Y towards the top of the image), so normal maps light the same
    in Godot and other viewers.
- `model lint` reports UVs outside 0..1 only on a texture that does not repeat.
- **Road furniture recipes:** `traffic-sign` (a round sign on a 76 mm pole, plate size and height as parameters),
  `guard-rail` (posts every 2 m, spacers and a corrugated beam, segments that tile) and `delineator` (a roadside post
  with a reflector), each with its archetype (`infrastructure.traffic-sign`, `infrastructure.guard-rail`,
  `infrastructure.delineator`) and English and Dutch names (verkeersbord, vangrail, reflectorpaal).
  A road guard rail (vangrail, geleiderail, w-beam) is `infrastructure.guard-rail`; a motorsport barrier (crash barrier,
  Armco, catch fence) stays `infrastructure.crash-barrier`.
- **[LESSONS-ROADS.md](LESSONS-ROADS.md):** lessons from building a road network with Godotwright: connectivity per pair
  of places, repairs that pass the final check, clearances over roads, water and electrified rail, terrain under the
  road, and MultiMesh for roadside objects.
- **New review rule `quality/json-parse-unchecked`:** warns when the result of `JSON.parse_string()` is used before it
  is checked, used directly (`JSON.parse_string(t)["n"]`), or stored in another typed variable. It is null when the
  text is not valid JSON, so a damaged data file stops the script with an error. A typed `Dictionary` or `Array`
  stays with `api/parse-into-typed`, so each line is reported once.
- **Canal locks and harbour basins** in `model identify` and the archetype library (English and Dutch names, parts,
  sizes with their source), and new pitfalls for rivers, canals and hand-built water surfaces: coarse heightmaps,
  several terrain grids, embankments and cuts, and triangle winding.
- `LESSONS.md`: lessons from building an inland waterway network.
- **Clearer MCP tool descriptions.** Each of the 22 tools now says when to use it and which tool to use instead,
  what its parameters change, what it returns, when it returns an error, and what it writes. The tool list costs
  about 2,500 more tokens.
- `godot_api_search` is marked read-only: it records nothing.
- `godot_feedback` returns an error when local learning is off, instead of saying the finding is hidden.

## 0.2.0 (install in one step everywhere, collision for terrain)

- **Install in one step everywhere.** A Claude Code plugin (`/plugin install godotwright --marketplace
  laaielichter/Godotwright`) with the MCP server and three skills: `/godotwright:review` reviews the project and
  fixes what it finds, `/godotwright:port` ports Godot 3 code to Godot 4, and a Godot workflow Claude follows on its
  own. A Claude Desktop bundle (`godotwright.mcpb`, attached to every release) with a setting for the project folder.
  A Gemini CLI extension (`gemini extensions install https://github.com/laaielichter/Godotwright`). One-click buttons
  for Cursor and VS Code and setups for Codex, Windsurf and Zed on the new
  [install page](https://laaielichter.github.io/Godotwright/install.html).
- `godotwright mcp` reads the default project from `GODOTWRIGHT_PROJECT` when `--project` is not given.
- **Collision for terrain tiles:** `model build terrain --collision heightmap` (and `collision: "heightmap"` in
  `godot_model_build`) writes `<name>.heightmap.tres`, a `HeightMapShape3D` of the tile's own grid, and inside a Godot
  project `<name>.tscn`: the tile with a `StaticBody3D`, ready to place. Faster than a trimesh and the same ground: tested
  in Godot 4.7.2 with GodotPhysics3D and Jolt, rays land within half a millimetre of the mesh. A scene you changed is kept.
- **A real demo** in the README and on the site: 35 seconds of real output, a Godot 3 script reviewed at 74/100,
  migrated, and at 100/100 after the one fix left by hand.
- `funcref()` is reported once (as Godot 3 syntax), not also as an unknown function.
- **Site and README:** the site lists all 22 MCP tools with a CLI example each; Lighthouse accessibility is 100 on every
  page (darker green and amber in the light theme for contrast); the Godot 3 to 4 page has share previews and structured
  data; the README starts with the quickstart and the one-line Claude Code install.
- **Security:** CodeQL scans the code and the workflows on every change and weekly; Dependabot proposes npm and
  GitHub Actions updates weekly; every action in the workflows and in the receipt action is pinned to a commit, and
  checkouts no longer keep git credentials. `SECURITY.md` says how releases are made and checked.

- **Review rule `api/physics-change-in-callback`** (warning): in a `body_entered`/`area_entered` (or exited) handler,
  adding a physics object with `add_child()`, or setting `monitoring`, `monitorable` or `disabled` directly, makes Godot
  print "Can't change this state while flushing queries" and the change is wrong; use `add_child.call_deferred()` and
  `set_deferred()`. Nodes without physics are left alone. Checked against Godot 4.7.2.
- **Review rule `api/bind-swaps-arguments`** (error): `tween_method(material.set_shader_parameter.bind("amount"), ...)`
  calls `set_shader_parameter(value, "amount")`, because `bind()` adds its arguments after the caller's. Also for `set`,
  `set_deferred`, `set_indexed`, `set_meta` and `set_instance_shader_parameter`.

Both rules were found by the benchmark's harder tasks: a small model made each mistake once, and the review did not see it.

- **Review rule `api/open-compressed-gzip`** (error): `FileAccess.open_compressed()` on a plain `.gz` file returns null,
  because it only reads Godot's own compressed format. The fix is `get_file_as_bytes(path).decompress_dynamic(-1,
  FileAccess.COMPRESSION_GZIP)`.
- **Review rule `quality/visibility-margin-hysteresis`** (warning): `visibility_range_*_margin` without
  `visibility_range_fade_mode` is hysteresis, so at a LOD boundary both levels can stay hidden (holes in terrain).
- **Three ready-made kinds:** `grandstand`, `crash-barrier` and `race-kerb`, with the archetypes `building.grandstand`,
  `infrastructure.crash-barrier` and `infrastructure.kerb` (56 kinds now). All three lint 100/100.
- **LESSONS.md:** ten lessons from rebuilding a real race circuit and its town from open elevation and topography data.

The two rules and three kinds come from that build, where each mistake happened once.

- **Review knows what older Godot 4 releases had.** For a member Godot 4.7 removed, the finding now says when ("It was
  removed after Godot 4.0"), so an agent upgrading a project sees it is an upgrade, not a typo. Eight old names Godot 4.7
  still accepts for old projects (such as `NavigationAgent2D.time_horizon` and `TileMap.cell_quadrant_size`) are now an
  info that names the current one, instead of a warning that they do not exist. The list (`data/api-removed.json`) was
  built from Godot 4.0 to 4.5 and checked entry by entry in Godot 4.7.2.

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

- **`ci`**: one receipt for a pull request. It runs the review, the Godot check, the project's GUT or GdUnit4 tests and its scenarios, prints a markdown table (the failing lines with file:line below it) and exits 1 when a step fails. `--no-godot-checks` runs only the review.

- **Scenarios** (`.godotwright/scenarios/*.json`, `godotwright scenario`): play an input timeline into a scene and check what the game did, for example `"Hero.position.x >= 100 @ 25"`. The proof that a change works, written once and run on every pull request.

- **GitHub Action** (`uses: laaielichter/godotwright@v0.1.0`) that runs `godotwright ci` on a pull request: it puts the table in the job summary and, if asked, in a pull request comment, and fails the job when a step fails.

### Review

- **Review rule `api/impossible-type-test`**: `x is T` or `x as T` where the static type of `x` can never be a `T` (two
  classes where neither inherits from the other, a class against a built-in type, or `is` between two different
  built-in types). Godot stops with a parse error on these; every case in the tests was checked against Godot 4.7.2,
  and `as` between built-in types (a conversion, like `float as int`) is left alone. Found while writing `screenshot`.

- **Review rule `quality/time-scale-not-restored`** (warning): a script that changes `Engine.time_scale` and never sets it
  back to 1.0 leaves the whole game slow. From `LESSONS.md` in the repository, lessons from one large build, each marked with
  whether Godotwright checks it.

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

- Three more archetypes: `building.gatehouse` (hinged gate, sliding portcullis), `creature.bird` and `creature.fish`.
- `api` brief descriptions end at a sentence, and name a project setting the cut-off text pointed to (`Engine.max_fps` now says `ProjectSettings.display/window/vsync/vsync_mode`).
- The description and keywords mention 3D models.

## 0.0.2

- Find Godot in the usual install folders, Steam and Downloads.
- Godot 4 window property migration hints, from a community contribution.
- Published to npm with provenance and listed in the official MCP Registry.

## Before 0.0.2

- Offline Godot 4.7 API lookup and search, project map, headless checks, AAA review with scores, MCP server with
  cheap and premium profiles, local learning, a benchmark of 168 agent runs.
