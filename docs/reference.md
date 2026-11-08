# Godotwright reference

Everything Godotwright does, in detail. For a quick start, see the [README](../README.md); for one-click
installs, the [install page](https://laaielichter.github.io/Godotwright/install.html).

- [Commands](#commands)
- [Port Godot 3 scripts to Godot 4](#port-godot-3-scripts-to-godot-4)
- [Shaders](#shaders)
- [Review in GitHub Actions](#review-in-github-actions)
- [Export, check and run a build](#export-check-and-run-a-build)
- [Scenarios and JUnit reports](#scenarios-and-junit-reports)
- [Mods and patches over a game](#mods-and-patches-over-a-game)
- [Install in your coding agent (MCP)](#install-in-your-coding-agent-mcp)
- [Tool sets and read-only mode](#tool-sets-and-read-only-mode)
- [Structured results](#structured-results)
- [Progress and cancel](#progress-and-cancel)
- [Protected paths](#protected-paths)
- [Learning](#learning)

## Commands

```sh
godotwright scan [path]               # compact project map, cheap to read
godotwright scan [path] --detail full # node trees, signatures, line numbers
godotwright scan [path] --json        # the full map as JSON
godotwright check [path]              # run Godot headless, report errors as file:line
godotwright check [path] --run        # also run the main scene for 120 frames and show what it printed
godotwright check --scene res://scenes/Test.tscn   # run one scene instead: put print() in the code and read it back here
godotwright test [path]               # run the GUT or GdUnit4 tests headless; prints only what failed, with file:line
godotwright play --input "10 tap jump; 20 hold right 30" --watch Player.position   # play input into a scene, see the values per frame
godotwright ci                                     # one receipt: review, check, tests, scenarios and screenshot baselines (markdown, exit 1 on a failure)
godotwright ci --junit godotwright.xml             # the same, plus JUnit XML for a CI test tab (tests, scenarios, review, check)
godotwright ci --annotations annotations.txt      # GitHub Actions annotations for review findings and Godot diagnostics
godotwright scenario --save jump --input "10 tap jump" --expect "Hero.velocity.y == -400 @ 10"   # run once, keep it as a test when it passes
godotwright scenario --list                        # the kept scenarios and their claims; `scenario` alone runs them all
godotwright doctor --symptom "falls through the floor"   # what is wrong and in which order to fix it: review and Godot grouped by cause, with lessons
godotwright fix --write               # apply the mechanical fixes for review findings (--check for the ones that need a look)
godotwright fix --stamp-uids --write  # also give scenes, resources, scripts and shaders without a uid one, as Godot makes them
godotwright perf --scene res://level.tscn   # frame times p50/p95/p99 against a budget, the slowest frames and their cause, vs the last run
godotwright leaks --scene res://chunk.tscn   # load, run and free a scene 5 times: what grows per cycle, by class, script and scene, and where it is made
godotwright session start             # load the main scene once, headless and paused; it stays up between commands
godotwright game step 120 --input "10 tap jump" --watch Hero.position --until "Hero.is_on_floor() == true"   # play frames in the running game
godotwright game reload               # put the scripts you edited into the running game; every node keeps its values
godotwright game ui --size 1280x720 --size 720x1280   # clipped labels, off-screen panels, overlapping buttons per window size
godotwright export                    # what the build will miss: excluded preloads, data files missing from include_filter
godotwright export run --preset Linux # export headless, check the pack against what the game loads, run it for 120 frames
godotwright export patch --preset Linux --against base.pck   # a patch with only what changed, checked and run over the base
godotwright export pck game.pck       # what a .pck (or a game .exe) holds, against the project; no Godot needed
godotwright deps unused               # files nothing the game starts with reaches, biggest first; `deps why <file>` before deleting one
godotwright code diagnostics res://player.gd   # Godot's own language server: warnings at the project's levels (also hover, definition, completion; --code for unsaved text)
godotwright shaders                   # the GPU pass: draw every shader (Compatibility renderer) for driver errors; errors at the line in the .gdshader
godotwright screenshot --scene res://hud.tscn --baseline   # visual test: compares with .godotwright/baselines/, exit 1 when it changed
godotwright undo                      # take back the last Godotwright write (--steps n, --list)
godotwright dream                     # look back between sessions: proposals for lessons, hints, merges, with evidence (--transcripts, --apply 1,3)
godotwright screenshot --model car.glb --view front,side,top,iso   # a PNG of a model from four sides (or of a scene); says how much is drawn
godotwright screenshot --scene res://hud.tscn --baseline hud   # a named baseline: .godotwright/baselines/hud.png with its settings in hud.json
godotwright api Node2D.look_at        # offline Godot 4.7 API: classes, methods, signals
godotwright api --search "is on floor"
godotwright review [path]             # AAA review with a score per category
godotwright usages take_damage       # every place a name or res:// path is used: code, scenes, connections, groups, settings
godotwright rename take_damage apply_damage --write   # rename everywhere (code, scenes, connections, node paths); dry run without --write
godotwright rename res://a.tscn res://scenes/a.tscn --write   # move a file with its .uid and .import, and every reference
godotwright project set display/window/size/viewport_width 1920 --write   # change a setting; name and type checked against Godot 4.7
godotwright project input add jump --key Space --joy-button A --write   # input map without hand-editing Object(InputEventKey,...)
godotwright project autoload add Game res://game.gd --write   # checks the file is a Node and the name is free
godotwright scene add main.tscn . Music AudioStreamPlayer --write   # add a node (or an instance: res://enemy.tscn); only that line changes
godotwright scene set main.tscn Timer wait_time 0.5 --write   # property name and type checked; enums by name, resources as res:// files
godotwright scene connect main.tscn Timer timeout . _on_timer_timeout   # warns when the method is missing or takes other arguments
godotwright scene editable main.tscn Enemy --write   # [editable path="Enemy"]: this scene may change the instance's children (--off removes it)
godotwright resource set mat.tres roughness 0.8 --write   # .tres: property name and type checked, uids kept, only that line changes
godotwright resource set level.tres data "[0, 1, 255]"   # byte arrays as a plain list or base64:..., written as PackedByteArray
godotwright resource add-sub theme.tres StyleBoxFlat --id hover   # then: resource set theme.tres bg_color "Color(0, 1, 0, 1)" --sub hover
godotwright resource diff car.glb      # import options changed from the importer's defaults, and per-animation/mesh/node options
godotwright resource set music.ogg loop true --write   # import option checked against the importer; reimported headless and verified
godotwright resource set beep.wav edit/loop_mode Forward --write   # enum options by name
godotwright resource set car.glb settings/loop_mode Linear --sub animations/drive --write   # per-animation loop
godotwright resource set car.glb generate/shadow_meshes Disable --sub meshes/car_body --write   # per-mesh (named <scene>_<mesh>)
godotwright resource importer anims.glb animation_library --write   # import a .glb as an AnimationLibrary, uid kept
godotwright migrate --write         # port Godot 3 scripts and shaders to Godot 4 where that is mechanical; lists what is left
godotwright shader                  # review every shader against Godot 4.7's shader tables and compile it headless; file:line
godotwright api shader:spatial.fragment   # the built-ins of a shader type and function; `api ALBEDO` says where one exists
godotwright review --sarif > review.sarif   # for GitHub code scanning: findings inline on pull requests
godotwright review --github                # GitHub Actions annotations, no code-scanning permission needed
godotwright review --only-new       # in a fix loop: only what changed since the last review, the rest as one line each
godotwright review --from 4.5 --target 4.6   # moving between 4.x releases: what changes on the way (default: saved version -> 4.7)
godotwright check --compare-godot ~/Godot_v4.8-beta2   # the same check with a second Godot on a copy: only new and gone errors
godotwright review [path] --detail full --min-score 90
godotwright model car.glb             # what is in a 3D model: nodes, triangles, textures, size
godotwright model lint car.glb        # model review with a score per category
godotwright model contract car.glb    # write a model.contract.json: node names, size, budget
godotwright model contract --archetype car   # the same, from what a car usually is (no model yet)
godotwright model lint car.glb --archetype car   # also check it is what it should be
godotwright model lint car.glb --contract model.contract.json
godotwright model brief "a tractor"    # one page before you build: kind to start from, parts, size, rules, order of work (for small models)
godotwright model identify "a tractor" # what it is: parts, size, variants, what to anticipate
godotwright model archetypes          # the family tree of things Godotwright knows
godotwright model kinds               # what `model build` can make, with parameters
godotwright model view car.glb       # see a model as text: front, side and top views, the parts, what does not touch
godotwright model recipes             # the ready-made recipes and the archetype each one is checked against
godotwright model recipes tractor     # print one recipe as a spec to edit
godotwright model build house -o house.glb --set floors=3 --set roof=hip
godotwright model build house -o house.glb --collision trimesh   # Godot adds collision shapes on import (-col / -convcol names)
godotwright model build tree -o tree.glb --no-textures   # plain colours instead of texture maps: smaller, or for your own materials
godotwright model build terrain -o world/tile.glb --collision heightmap   # terrain: a HeightMapShape3D and a ready tile scene
godotwright learn                     # what Godotwright learned on this machine
godotwright learn gaps                # Godot errors it cannot predict yet: what to teach it next
godotwright lessons moving ship deck  # lessons from real projects: symptom, cause, fix, how to test
godotwright lessons --error "<Godot message>"   # the lessons that explain an error
godotwright lessons add --title "..." --fix "..."  # keep a lesson learned here (scrubbed, never sent)
```

`scan` reads `project.godot`, scenes, resources and scripts without starting Godot.
It lists scenes with their node trees, scripts with signals, functions and exports,
autoloads, input actions and key settings, and warns about broken references
(missing files, a missing main scene or autoload, bad `preload()` paths).

`check` needs Godot 4.7: `--godot <path>`, `$GODOT`, `godot` on your PATH, or a Godot 4 download
it finds by itself (Program Files, Steam, Scoop, Downloads, Desktop). It imports
the project, loads and instantiates every script and scene, and can run the main scene.
Each problem comes back once, as `res://path/file.gd:12: error: ...`.
The exit code is 1 when there are errors.

`api` answers from the official Godot 4.7 class reference, bundled offline
(1078 classes). It accepts `Class`, `Class.member`, `Class.Enum.VALUE`, `@annotation`
or a global function, follows inheritance, and explains Godot 3 names
(`KinematicBody2D` is `CharacterBody2D` in Godot 4). See [data/README.md](../data/README.md).

`review` needs no Godot install. It scores four categories from 0 to 100 and lists
each finding as `res://file.gd:12: error [rule] message`:

| Category | What it checks |
| --- | --- |
| api | Godot 3 code, unknown classes, functions, members and signals, wrong argument counts, input actions missing from the Input Map |
| performance | node lookups, `load()`, prints and physics calls in per-frame callbacks, empty callbacks, shadow-casting lights |
| quality | static typing coverage, long or deeply nested functions, signals never emitted, string-based signals, naming, TODOs |
| structure | broken references, scene connections to missing methods or signals, `$Node` paths missing from the scene, unknown groups, file naming |

The checks follow Godot's own rules (inheritance, scripts on more specific nodes,
inherited scenes, built-in scripts, duck typing with `has_method()`), and are tuned
on the official demo projects so they report real problems, not noise.
The exit code is 1 when there are errors, or when the score is below `--min-score`.

`model` reads a `.glb` or `.gltf` file without Godot. `model` alone shows the node tree,
triangle count, materials, textures (with an estimate of texture memory), size and lowest
point. `model lint` scores four categories from 0 to 100:

| Category | What it checks |
| --- | --- |
| geometry | triangles facing against their own normals (pink backfaces, wrong light), open edges on single-sided surfaces, edges shared by more than two triangles, triangles without area, negative scale, models that are almost but not quite left-right symmetric |
| materials | missing normals, UVs or tangents, UVs outside 0..1, very large or non-power-of-two textures |
| performance | triangle budget (`--max-triangles`), texture memory budget (`--max-texture-mb`), many materials |
| rig | sibling nodes with the same name, unnamed nodes, a model that does not sit on y = 0, an empty file |

Findings are grouped per node, and their severity follows how much of the surface is
affected, so one stray triangle is an info and a flipped panel is an error.
A **model contract** (`model.contract.json`) pins what a model must keep, so a renamed node or a
hull that grows 3 cm wider is caught. `model contract` writes one from the model as it is now;
review it, add a `source` to each size, and keep it next to the model. `model contract --archetype car`
starts instead from what a thing usually is (its single parts by name, the middle of the typical size, a triangle
budget), for a model that does not exist yet. With `--contract`, `model lint`
reports `contract-missing-node`, `contract-order`, `contract-extra-node`, `contract-size`,
`contract-ground` and `contract-triangles`. Sizes default to a 1% tolerance, or set `tolerance` in metres.
The exit code is 1 when there are errors, or when the score is below `--min-score`.

`model build` makes a model from code, with no Blender or other tool: a clean `.glb` with UVs and
tangents, named parts with sensible pivots, standing on y = 0, and the same bytes every time for the
same parameters. Materials look like what they are: brick, roof tiles, slate, wood, bark, leaves, grass, stone,
concrete, asphalt, sand and water get a seamless colour map and normal map at their real size, made by Godotwright
itself and stored in the `.glb`; glass, chrome, steel, paint, plastic and lamps that glow are plain PBR materials. The result goes straight through `model lint`, and `--contract-out` writes a
`model.contract.json` for it. `model kinds` lists the kinds with their parameters, ranges and defaults;
set them with `--set name=value` or `--spec file.json`. These are clean, parametric base models, built
to be refined, not hand-sculpted art. Kinds today: `house`, the open-world kinds `terrain` (a heightmap tile from seeded
noise whose neighbours continue it exactly, with an optional lake and an optional river carved into it) and `sea` (a subdivided water plane at y = 0 with a floor), plus recipes, which are ready-made specs in
`data/recipes/`: `car`, `tractor`, `helicopter`, `airliner`, `ship`, `tree`, `conifer`, `wind-turbine`, `shipping-container`, `truck`, `bus`, `motorcycle`, `bicycle`, `train`, `tank`, `light-aircraft`, `fighter`, `drone`, `boat`, `sailboat`, `piston-engine`, `jet-engine`, `barn`, `tower`, `church`, `windmill`, `apartment`, `bridge`, `road`, `railway-track`, `street-lamp`, `traffic-sign`, `guard-rail`, `delineator`, `fence`, `power-pylon`, `palm`, `bush`, `grass`, `flower`, `crate`, `barrel`, `chair`, `table`, `campfire`, `castle`, `crash-barrier`, `dragon`, `grandstand`, `horse`, `humanoid`, `race-kerb`, `rocket`, `rowing-boat`, `satellite` and `spaceship`. Every recipe names its archetype, so `model build` checks
it as it builds, and every recipe is tested to stay clean at the lowest and highest value of each parameter.

Small, cheap models can work blind: see [docs/cheap-models.md](cheap-models.md) for a test and what `model view` and the
floating-part check do about it.

`model identify` says **what a thing is** before you build it, from its name in English or Dutch (typos,
plurals and Dutch compounds like "vrachtauto" included) or from a description ("something with wheels and
an engine"). It answers with the family it belongs to, the parts a model of it needs (and which move, about
which axis, with the pivot where), a typical size range with its source and a confidence class, the variants
(a car can be a sedan, a hatchback, a pickup), the Godot conventions (+Y up, the front faces +Z), what to
anticipate (collision, LODs, lights) and the usual mistakes. A word that means two things (the Dutch
"windmolen") is reported as ambiguous, and something it does not know gets the nearest family, marked
generic, instead of a made-up answer. The library is data in `data/archetypes/` and grows with pull requests.
It also knows the pieces an **open world** is made of: terrain tiles, mountains, islands, coasts, seas, lakes, rivers,
biomes and settlements, with their own rules (tiles that share border heights, y = 0 as sea level, collision from
the same heights, levels of detail, instanced scatter, a floating origin for very large worlds).

`model lint --archetype <what>` (or `"archetype": "vehicle.wheeled.car"` in a spec, or any built-in kind)
holds a model against what `identify` says that thing is, as a fifth category, `archetype`, worth a fifth
of the score:

| Rule | What it catches |
| --- | --- |
| `archetype/missing-part` | a car without wheels, a helicopter without a rotor (parts are recognised by node name in English or Dutch) |
| `archetype/part-count` | two wheels on a car, five on a bicycle |
| `archetype/pivot` | a wheel not turning about its hub, a door not pivoting on its hinge line, a turret not on its base |
| `archetype/wheel-axis` | a wheel lying the wrong way |
| `archetype/size` | a model about 10 times too big or small, which is nearly always a unit mistake (it only flags a difference of more than 3 times, since the ranges are typical, not exact) |
| `archetype/orientation` | a car that points sideways instead of along z |
| `archetype/optional-part` | the usual parts that are not there (info) |

Anything else is built from a **model spec**: a JSON tree of named parts (box, cylinder, ellipsoid,
lathe, loft, extrude, roof, tube) with `at`, `rotate`, `mirror`, `repeat`, variables and arithmetic
expressions (`"$width / 2 - 0.1"`, never executed as code). Boxes and cylinders can have rounded edges (`bevel`),
ellipsoids an organic, lumpy outline (`lumps`), a tube follows a path (frames, rails, pipes, branches), and a material
of your own can use any of the texture patterns in its own colour (`"texture": "wood"`). `model spec` explains the format and prints a
small car as an example; `model build --spec car.json --set width=1.9` builds it. Every moving part is
its own node with its pivot at its origin (a wheel at its hub), and a spec that goes wrong gets a message
with its path (`nodes[0].children[2].size[1]: unknown variable $x`).

## Find leaks

```sh
godotwright leaks --scene res://chunk.tscn                  # 5 cycles of 60 frames: load, run, free; exit code 1 when anything grows
godotwright leaks --scene res://world.tscn --keep --input "10 press load_chunk; 40 press unload_chunk"   # keep the scene, replay input per cycle
godotwright leaks --cycles 10 --budget-objects 2 --json     # a budget per cycle for CI, JSON for scripts
```

`leaks` (MCP: `godot_leaks`) runs a scene headless in cycles. By default every cycle loads the scene, runs it for
`--cycle-frames` frames and frees it; one frame later, when queued frees have run, it snapshots the live objects.
`--keep` keeps the scene running and snapshots every `--cycle-frames` frames instead. The input timeline (`--input`, as
`play` takes it) replays inside every cycle, so a game that streams chunks on input can be cycled too. The first
`--warmup` cycles (default 1) are not counted: caches and first-time loads fill them.

For the counted cycles it reports the growth per cycle (a least-squares slope, counted as a leak only when it grows in at
least half of the cycles and never drops):

- **orphan nodes** (`Node.get_orphan_node_ids()`, children counted with their top node), grouped by class, script and
  scene, with the parent they were removed from, the code that makes them (`MeshInstance3D.new()`, a class_name or
  preload alias, `instantiate()` of a scene, an exported `PackedScene` property, a scene that instances it) and the
  `remove_child()` that dropped them;
- **nodes left in the tree** after the scene was freed (added to the root or an autoload), with where they hang;
- **objects that are not nodes** (objects minus nodes): Godot is run with `--verbose`, so at exit it names the classes
  still alive (`Object x5`) and the resources still in use, with the code that makes them; growth that is not on that
  list was freed only at exit, so a static var, autoload or cache holds it, and the growing containers are named;
- loaded resources, static memory, and the change since the last run of the same scene with the same mode, cycle length and input (`.godot/godotwright/leaks/`).

The verdict is `LEAKING` (exit code 1, an error result over MCP) when objects or orphan nodes grow more than the budget
per cycle (`--budget-objects`, `--budget-orphans`, default 0). With `--keep`, nodes that pile up in the tree are shown
but not counted, since spawning can be the design. Each kind of leak names its lesson. Not visible to it: objects
GDScript cannot list one by one (they show only as counts and at exit by class), and the call stack that made a node
(Godot does not record it; the creation sites come from the project's code). A site proven by its `remove_child()`
or found in the scene's own scripts is shown as `made at`; a class matched elsewhere in the project, or one of several
`remove_child()` calls, is shown as `maybe made at` / `maybe removed at`.

`check` names leaks too: when the run step ends with `ObjectDB instances were leaked at exit` or `resources still in use`,
it runs once more with `--verbose` and lists the classes (`MeshInstance3D x1, Object x1`) or resource paths.

## Edit resources and import settings

`godotwright resource` (MCP: `godot_resource_edit`) edits text resources and import settings without the editor.
Nothing is written without `--write` (`write: true`); the dry run shows the changed lines. Several changes go in one
call with `resource apply <file> '<JSON list>'` (MCP: the `ops` list), so there is one write and one reimport.

- **`.tres`** (and the sub_resources of a `.tscn`): `set`, `unset`, `add-sub`, `remove-sub`, `get`. Property names
  and types come from the Godot 4.7 reference and the script's exports; enums by name, resources as `res://` files
  (an `ext_resource` with its uid is added) or `SubResource("id")`, packed arrays as a plain list (`[0, 1, 255]`) or,
  for bytes, `base64:...`. Only the changed lines are touched: the uid lines are never rewritten. A sub_resource is
  moved before the first one that uses it (Godot cannot load a forward reference), an `ext_resource` the edit left
  unused is removed, and a sub_resource still in use cannot be removed. Writes report the review errors before and
  after. An open editor keeps its cached copy, so reload the resource there.
- **Import settings**: give the asset (`beep.wav`) or its `.import`. `get` (one option: type, default and choices),
  `diff` (what differs from the defaults), `set`, `unset` (back to the default). Option names are checked against
  what Godot already wrote for the asset and the importer's class reference, because Godot drops unknown options
  without a word. Per-sub-resource options of the scene importer go through `--sub` (`sub`): `animations/<name>`
  (`settings/loop_mode`, `save_to_file/*`, slices), `meshes/<scene>_<mesh>` (`generate/shadow_meshes`,
  `generate/lightmap_uv`, `generate/lods`), `materials/<name>` (`use_external/enabled`, `use_external/path`) and
  `nodes/PATH:<node>` (`mesh_instance/cast_shadow`, `generate/physics`, ...). `<scene>` is the glTF scene's name, or the
  file name when the scene has none or its name starts with "Scene"; `.`, `:`, `@`, `/`, `"` and `%` become `_`. Node
  paths start at the glTF root nodes (below the single root only for a file written with `GODOT_single_root`).
  Animation and material names are checked against the glTF; a mesh or node name that is not found only warns.
  `importer` switches between `scene` and `animation_library`, `texture` and `image`, or to `keep`, keeping the uid.
- **Verified reimport**: after a `.import` write Godotwright runs `godot --headless --import` and reads the result
  back: `changed` (Godot kept every value and the imported output changed, by its `dest_md5`; it also changes for a
  per-item option Godot ignores, so it does not prove the option took effect), `same` (kept, but the
  output is identical), `dropped` (Godot did not keep a value) or `failed`, with the import errors for that asset.
  `--no-reimport` skips it; without Godot the file is written and the result says it was not reimported.
  `resource reimport <asset>` only runs the import. The journal entry is stored after the import, so `godotwright
  undo` still works after Godot rewrote the `.import`; undo restores the settings, and the next import rebuilds the
  output.

## Port Godot 3 scripts to Godot 4

```sh
godotwright migrate                 # shows every change it would make, and what still needs a hand
godotwright migrate --write         # applies them
godotwright review                  # what is still wrong, with line numbers
```

`migrate` rewrites the mechanical part of a port: `export`, `onready` and `tool` become annotations (with `@export_range`,
`@export_enum`, `@export_file`, `@export_flags`, `@export_color_no_alpha`, `@export_exp_easing` and typed arrays where the hint is clear),
network keywords become `@rpc(...)` annotations, simple `setget` becomes Godot 4 property syntax (`set = ...`, `get = ...`),
renamed classes, functions, properties and constants get their Godot 4 names (only when the old name no longer exists in Godot 4 and
is not defined in the script), `yield(x, "sig")` becomes `await x.sig`, `connect("sig", target, "method", [binds])` becomes
`sig.connect(target.method.bind(...))`, `emit_signal` and `funcref` become signals and callables, `update()` becomes
`queue_redraw()` in CanvasItem scripts, and members that moved (`OS.get_ticks_msec()`) move to their new class. Strings,
comments and node paths are left alone. What it cannot do safely it lists with the line: a `setget` it cannot convert,
`move_and_slide(velocity)`, `master`/`mastersync`, `yield()` without arguments, `update()` in scripts with a path base,
export hints it does not know. Scenes and project settings are not touched; Godot's own `--convert-3to4` does those.
Commit first; a second run makes no further changes.

`migrate` also ports `.gdshader` and `.gdshaderinc` files: the names in Godot's own shader rename table (`hint_albedo` and
`hint_color` to `source_color`, `hint_black_albedo` to `source_color, hint_default_black`, `WORLD_MATRIX` to
`MODEL_MATRIX`, `CAMERA_MATRIX` to `INV_VIEW_MATRIX`, `INV_CAMERA_MATRIX` to `VIEW_MATRIX`, `NORMALMAP` to `NORMAL_MAP`,
`TRANSMISSION` to `BACKLIGHT`, `ALPHA_SCISSOR` to `ALPHA_SCISSOR_THRESHOLD`, `hint_aniso` to `hint_anisotropy`,
`depth_draw_alpha_prepass` to `depth_prepass_alpha`, ...), also inside `#define` lines, and `SCREEN_TEXTURE`,
`DEPTH_TEXTURE` and `NORMAL_ROUGHNESS_TEXTURE` get the sampler uniform Godot's own error suggests
(`uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;`). It lists `CLEARCOAT_GLOSS` (now
`CLEARCOAT_ROUGHNESS`, which is 1.0 - gloss), a particle shader's `vertex()` (now `start()` and `process()`) and `COLOR`
written in a spatial `fragment()` as work by hand. Shaders stored inside scenes are not rewritten.

### Cheaper fix loops: only what changed

```sh
godotwright review --only-new
```

Every review remembers its findings in `.godot/godotwright/review-last.json` (Godot projects ignore `.godot/` in git). With
`--only-new` (MCP: `only_new: true`) the next review prints the findings that are new since then in full, the ones you
already saw as one short line each (`file:line [rule]`), and how many are fixed. A finding keeps its identity when its
line moves. An agent fixing a long list reads the list once instead of after every edit.

## Shaders

```sh
godotwright shader                          # every shader: static review, then a headless compile when Godot is found
godotwright shader --file res://fx/water.gdshader   # one shader (an include also compiles the shaders that use it)
godotwright shader --no-compile             # static review only, no Godot needed
godotwright shader --compile --json         # CI: fail when Godot is missing, JSON out, exit 1 on an error
godotwright shader --gpu                    # also draw them on the GPU (Compatibility renderer, xvfb-run on Linux)
```

`shader` (MCP: `godot_shader`) checks every `.gdshader`, every `.gdshaderinc` and every Shader resource stored in a scene
or resource (reported as `res://level.tscn::Shader_id:line`, with the line in the scene file) in two ways:

1. **A static review against Godot 4.7's own tables.** The built-ins of each shader type and processor function, which
   of them are read-only, the stage functions and the render modes come from `servers/rendering/shader_types.cpp` of the
   4.7.2 source, bundled in the API data; an integration test compiles every entry with Godot 4.7.2. The findings are
   ordinary review rules, so `godot_review`, its score, SARIF, the CI receipt, the post-edit hook and `godot_feedback`
   see them too:

   | Rule | What it finds |
   | --- | --- |
   | `api/shader-renamed` | Godot 3 names from Godot's rename table (`hint_color`, `WORLD_MATRIX`, `NORMALMAP`, `depth_draw_alpha_prepass`, ...), `CLEARCOAT_GLOSS`, `EXTRA_MATRIX`, and a particle shader's `vertex()` |
   | `api/shader-removed-builtin` | `SCREEN_TEXTURE`, `DEPTH_TEXTURE` and `NORMAL_ROUGHNESS_TEXTURE`, which are sampler uniforms with a hint now |
   | `api/shader-builtin-misplaced` | A built-in of another shader type (`ALBEDO` in a `canvas_item` shader), another processor function (`COLOR` in a spatial `light()`), or a processor built-in used in your own function (`UV` in a helper); `discard` in `vertex()`; stage functions such as `texture_sdf()` where Godot does not offer them |
   | `api/shader-read-only-builtin` | A read-only built-in written, such as `COLOR` in a spatial `fragment()` (write `ALBEDO`) or `VERTEX` in `fragment()`; `COLOR` in `vertex()` is fine |
   | `api/shader-render-mode` | A render or stencil mode the shader type does not have, with the nearest names |
   | `api/shader-type` | A missing or misspelled `shader_type` |
   | `structure/shader-missing-include` | An `#include` whose file does not exist (Godot only says `Unknown character #35: '#'`) |
   | `quality/shader-color-no-source-color` | A colour uniform (`vec3`/`vec4` named like a colour, or written straight into `ALBEDO`, `EMISSION`, `COLOR` or `FOG`) or albedo texture without `source_color` in a 3D, sky, fog or particle shader; Forward+ and Mobile then use the sRGB value as linear. Quiet on the Compatibility renderer, which does not convert |
   | `performance/shader-discard` | `discard` in an opaque spatial shader: Godot can no longer use its shared depth-only material for the mesh's depth prepass and shadows (info) |
   | `performance/shader-screen-read` | A spatial shader that reads the screen, depth or normal-roughness texture: it draws in the transparent pass and, without `depth_prepass_alpha`, has no depth prepass and casts no shadow; Godot copies the screen or depth buffer for it (info) |
   | `performance/shader-texture-in-loop` | Texture reads in a loop with more than 16 reads per pixel, or an open-ended count (info) |
   | `quality/shader-reads-own-depth` | A shader that reads the depth texture while it writes depth in the alpha prepass |

   Names a shader declares itself (uniforms, locals, structs, `#define`s, and those of the files it includes) are never
   taken for built-ins, and when an include is missing the built-in rules stay quiet rather than guess.

2. **A headless compile by real Godot.** Under `--headless` Godot's dummy renderer still runs the full shader compiler,
   but only when a shader is used: `load()` alone does not compile it, `get_rid()` does. So no display, GPU, `xvfb` or
   rendered frame is needed, and it runs in CI. Unsaved code (`code` + `file`) and Shaders stored in scenes are compiled
   from their code with their own path, so relative `#include`s resolve as in the game. Godot's errors come back as
   `res://file:line: error [godot] message`: the line Godot names (`at: (null) (:4)`), or the line in the include. Godot's
   code echo and the follow-up `Shader compilation failed.` are left out, a two-line message is kept whole, and a Godot
   error on a line the review already reports is shown once. `compile: false` (CLI `--no-compile`) skips this step; without
   Godot it is skipped with a note unless `--compile` requires it.

3. **With `--gpu` (MCP: `gpu: true`), the GPU pass.** Headless, no GPU driver ever sees the code, so what only a driver
   rejects is not found there: a uniform block bigger than the GPU allows (`uniform float big[200000]`), a sampler array
   indexed by a variable, a GLSL compile or link error. The GPU pass (the same as `godotwright shaders`) draws every
   shader on the Compatibility renderer for a few frames, xvfb-run on Linux without a display, and adds those as
   `[gpu]` lines; the language errors it finds again at the same line are shown once. It draws the files on disk, not
   unsaved code, and parses fog shaders only (they need Forward+). On a test project with broken spatial, canvas_item,
   particles, sky and fog shaders, a broken include and a broken shader in a scene, the headless compile found every
   language error at the same line as the GPU pass in under a second; the GPU pass took about 6 s and added the two
   driver errors.

`godot_check` compiles every `.gdshader` headless too, also those no scene uses, and reports them as
`res://file.gdshader:line`; `shaders: true` (CLI `check --shaders`) adds the GPU pass over the whole project, and an
error both find is reported once.
`godot_fix` renames the Godot 3 names and adds the missing texture uniforms (both `safe`). `godot_api` answers shader
questions: `ALBEDO` gives every shader type and function that has it and whether it can be written there,
`shader:canvas_item.fragment` lists a function's built-ins (`shader:spatial` adds the render modes), and `hint_albedo`
gives its Godot 4 name.

## Scene and resource integrity

Agents copy scenes, invent uids and hand-write `.tscn` files. Godot then loads the wrong file, warns on every load,
fails to load a scene, or drops an edit the next time someone saves in the editor. `godotwright review` (and the
post-edit hook) finds these from the files alone, in milliseconds; `godotwright fix` repairs the ones that can be
repaired mechanically, through the undo journal. Each rule was reproduced with Godot 4.7.2.

| Rule | What Godot does | Fix |
| --- | --- | --- |
| `structure/duplicate-uid` | Two files claim one uid (a copied `.tscn`, or a script or asset copied with its `.uid` or `.import` file): "UID duplicate detected" on every import, and a reference by uid can load the other file | `safe`: the file most references name with that uid keeps it (a base project's file always does); the others get a new uid, and references that name them by path follow. When references name the uid alone (`run/main_scene`, `preload("uid://...")`), the file Godot loads for it now (its `.godot/uid_cache.bin`) keeps it, so they keep loading the same file; with no cache that choice is `check` |
| `structure/invalid-uid` | A header, `.uid` or `.import` uid that is not `uid://` plus lowercase letters and digits is ignored: the file has no uid | `safe`: a new valid uid |
| `structure/unknown-uid` | An `ext_resource` uid no file has: "invalid UID ... using text path instead" on every load | `safe`: the uid of the file the path names, or no `uid=`; a script, shader, scene or resource that lost its uid (a `.uid` file not committed) gets back the uid its references use |
| `structure/uid-path-mismatch` | The uid names another file than the path: Godot silently loads the uid's file | `check`: the uid of the path's file |
| `structure/missing-resource-id` | `ExtResource("x")` or `SubResource("x")` with no section of that id, or a sub_resource used above its definition: "Parse Error", the file does not load | by hand; the message lists the ids that exist |
| `structure/duplicate-resource-id` | Two ext_resources or sub_resources with one id: Godot keeps one (the last ext_resource, the first sub_resource) | by hand |
| `structure/section-order` | An ext_resource after a sub_resource or node, or a sub_resource after a node or `[resource]`: "Parse Error" | by hand |
| `structure/unused-resource` (info) | A section nothing uses: still loaded with the file | `safe`: removed |
| `structure/locked-instance-edit` | An override of a node inside an instanced scene, a node added below one, or a connection to one, without `[editable path=...]` for every instance on the way: applied on load, dropped on the next editor save | `check`: adds `[editable path=...]` |

```sh
godotwright review                      # the findings, with file:line
godotwright fix                         # dry run: every change, labelled safe or check, with a count (0 means nothing was done)
godotwright fix --check --write         # apply them; godotwright undo takes them back
godotwright fix --stamp-uids --write    # also give every scene, resource, script and shader without a uid a new one
```

New uids are made the way Godot's `ResourceUID.create_id()` and `id_to_text()` make them (a random 63-bit id in base 34,
digits `a`-`y` and `0`-`8`), and Godot registers them as written. When a uid in a `.uid` or `.import` file changes, the
file it belongs to is touched so that Godot's file cache reads it again. `godotwright check` (MCP: `godot_check`) tags
Godot's own uid warnings with the rule that predicts them (`[structure/duplicate-uid]`, `[structure/unknown-uid]`).
`godotwright scene` (MCP: `godot_scene_edit`) refuses to set a property on, add a node under or connect to a node inside an
instance that is not editable, unless you pass `--make-editable` (MCP: `make_editable`); `scene editable` (MCP: op
`set_editable`) adds or removes the entry by itself. Files in a base project or only in a `.pck` list are context: their
uids count, their own problems are not reported.

## Visual regression: screenshot baselines

`godotwright screenshot --baseline` (MCP: `godot_screenshot` with `baseline`) renders the scene or model and compares
it with the last approved picture. `baseline` is one of:

- nothing (CLI) or `"auto"` (MCP): `.godotwright/baselines/<scene or model>-<hash>@<size>_<views>.png`, named after
  what was rendered, its size and views;
- a `.png` path inside the project (or the model's folder);
- a name (`hud`): `.godotwright/baselines/hud.png` and a `hud.json` next to it with how it was taken (scene or model,
  views, size, frames, threshold and tolerance when given, Godot version, graphics driver). Later runs reuse those
  settings, so `--baseline hud` alone compares like for like; `godotwright ci` compares every named baseline.

The first run saves the picture as the baseline; commit it (Godot does not import `.godotwright/`). Later runs compare
pixel by pixel and say what changed in text:

```text
baseline hud CHANGED: 0.94% of pixels changed (544 px; threshold 0.5%, tolerance 3); largest change at (112, 64) size 64x32, mean shift 88.4
  areas: (117,70)-(170,95) 544 px moved (12,0)
  where: centre 8.5%
  baseline: /game/.godotwright/baselines/hud.png
  new: /game/.godot/godotwright/diff/hud.actual.png
  diff: /game/.godot/godotwright/diff/hud-diff.png (changed pixels in red)
Next: look at the diff; if the change is intended, run again with --update-baseline; if not, fix it and screenshot again.
```

- A pixel counts as changed when its colour moves by more than `--tolerance` (0 to 255, luma-weighted, default 3).
  The picture counts as changed when more than `--threshold` percent of the pixels changed (default 0.5); a change
  within the threshold is still named, with its diff. A named baseline keeps a threshold and tolerance you give it.
- Areas of change are listed biggest first, with `moved (dx,dy)` when a shift of up to 16 px explains one both ways
  (something moved, not removed). A brightness shift of 3 levels or more is named (`darker`, `brighter`).
- A blank picture is named on every screenshot, baseline or not: black, white, fully transparent, the background colour
  only, or one colour over at least 99.9% of the picture.
- The diff picture is the baseline faded to grey with the changed pixels in red, in `.godot/godotwright/` (Godot does
  not import it and version control usually ignores it).
- `--update-baseline` (MCP: `update_baseline: true`) replaces the baseline; `--baseline-dir` keeps named baselines
  elsewhere (over MCP `baseline_dir` must be inside the project). A change beyond the threshold, or a size that differs,
  gives exit code 1 (MCP: an error result with the diff and the new picture); unchanged returns text only.
- Runs are deterministic: a fixed frame rate (`--fixed-fps 60`), fixed random seeds (also for particles), the
  Compatibility renderer and a fixed window size. Two runs on one machine give the same bytes. Another GPU driver or Mesa
  version can shade edges a few levels differently, so make baselines on the machine (or CI image) that compares them; a
  changed compare of a named baseline says when the driver differs. Compatibility does not draw Forward+-only effects
  (SDFGI, volumetric fog), so those are not covered.

### Screenshots in scenarios

A scenario can take pictures during its input run and compare each with its baseline:

```json
{
  "input": "0 hold right 20",
  "frames": 40,
  "expect": ["Hero.position.x >= 60 @ 30"],
  "screenshots": ["walk-start @ 0", { "name": "walk-end", "frame": 30, "tolerance": 8, "threshold": 1 }],
  "size": "640x360"
}
```

The picture of frame N is taken after that frame's physics and process step has been drawn, the same frame the
expectations read. Missing baselines are made on the first run; `godotwright scenario --update` replaces them. A run
with screenshots draws with the Compatibility renderer (xvfb-run on Linux without a display) instead of `--headless`.

### In the CI receipt

`godotwright ci` adds a `visual` step: every baseline made with `godotwright screenshot` is rendered again and compared
(baselines kept elsewhere with `--baseline-dir` need the same `--baseline-dir` on `ci`, or the Action's `baseline-dir` input),
and the screenshot steps of the scenarios are listed with it (the `scenarios` step judges only what the game did). In CI
a missing baseline fails instead of being made, since a baseline made on the runner would be thrown away. The GitHub
Action installs xvfb when it is missing and uploads `.godot/godotwright/diff/*.png` (diffs and new captures) as the
`godotwright-visual-diff` artifact.

## Upgrading between Godot 4 releases

```sh
godotwright review                          # a project saved by 4.5 or 4.6 also gets what changes on the way to 4.7
godotwright review --from 4.6               # the same after the project was re-saved in 4.7 (the saved version is then 4.7)
godotwright review --from 4.5 --target 4.6  # only the changes up to 4.6
godotwright api InputEvent.device           # each member shows what changed in 4.6 and 4.7, and gone names say when they went
godotwright check --compare-godot /path/to/godot-4.8-beta   # or set GODOT_NEXT and pass --compare-godot alone
```

`data/api-changes.json` holds the changes from the official 4.6 and 4.7 upgrade guides that matter to GDScript and
scenes, each checked by running the same project in Godot 4.6.2 and 4.7.2 (or, for rendering, marked as taken from the
guide). Review turns them into rules (MCP: `godot_review` with `from` and `target`):

| Rule | Since | When |
| --- | --- | --- |
| `api/packed-element-write` | 4.7 | `line.points[0] = v`, `poly.polygon[i] += v`, `points[0].x = v`: the element write to an engine property is lost (error) |
| `quality/packed-setter-skipped` | 4.7 | the same on a script variable with a setter: the array changes but `set()` no longer runs |
| `api/override-missing-return` | 4.7 | an override without a return type (also of `_get`, `_set`, `_get_configuration_warnings`) that never returns a value: the script no longer loads |
| `api/image-unit-bool` | 4.7 | `true`/`false` as `width_unit`/`height_unit` of `RichTextLabel.add_image()`/`update_image()`: a parse error, although the guide calls it compatible |
| `api/input-device-zero` | 4.7 | `.device == 0` on a key or mouse event (they are 16 and 32 now); on a plain `InputEvent` only as an upgrade note |
| `api/upgrade-world-boundary-jolt` | 4.7 | a `WorldBoundaryShape3D` with `d != 0` under Jolt: the sign flipped |
| `api/upgrade-area-mask` | 4.7 | a 2D/3D audio player at the default `area_mask` while an area uses `audio_bus_override` (default 1 -> 0) |
| `api/upgrade-mesh-skeleton` | 4.6 | a `MeshInstance3D` under a `Skeleton3D` without a `skeleton` line (default `..` -> empty) |
| `quality/upgrade-note` | 4.6, 4.7 | glow and volumetric fog that will look different (4.6), soft bodies under Jolt (4.7) |

The first five are always on: they describe how Godot 4.7 behaves, whatever version the project came from. The
`upgrade` ones appear only while the project moves: from the version in `config/features` (or `--from`) up to `--target`.
After the project is saved in 4.7 its version reads 4.7, so pass `--from` to keep seeing them. A target older than 4.7
leaves the 4.7 rules out. Gone members say since when (`removed after Godot 4.6`), from `data/api-removed.json`, which now
also covers the 4.6 to 4.7 removals.

`godotwright fix` (MCP: `godot_fix`) does the mechanical part, with `--from` as above: a packed element write becomes
copy, write, assign back (`safe` on an engine property, `check` on a script setter, which now runs again), a bool image
unit becomes `IMAGE_UNIT_PERCENT`/`IMAGE_UNIT_PIXEL`, and `area_mask = 1` or `skeleton = NodePath("..")` is added to the
node (the value before the upgrade). The Jolt plane is left to you: flipping `d` twice would undo it.

For a release review has no rules for yet (a 4.8 beta), `--compare-godot <binary>` (MCP: `godot_check` with
`compare_godot`, or `next` for `$GODOT_NEXT`) runs the same check with both binaries and prints only what differs:
`new in 4.8.beta2` and `gone in 4.8.beta2`, matched by file, line and message (numbers left out). The second binary runs
on a temporary copy of the project without `.godot/` and `.git/`, so a newer engine never re-imports or rewrites your
files; the copy is removed afterwards. The exit code is 1 only for new errors, so it fits a CI job that tries the next
release.

## Review in GitHub Actions

Save this as `.github/workflows/godot-review.yml` in your game repository. It
reviews the project on every push and pull request, failing if there are errors
or the overall score is below 80. The static review needs only Node.js 22.12+
(Node 24 below), not a Godot install, model or API key.

```yaml
name: Review Godot project
on: [push, pull_request]
permissions:
  contents: read
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npx --yes github:laaielichter/godotwright#0dd9ce885df21fafefc09f8ddd6e92745d5ae303 review . --min-score 80
```

The toolkit is pinned to a revision; update that revision deliberately when you
want a newer version. For a game in a subdirectory, set `working-directory` on
the review step to the folder containing `project.godot`.

To see the findings inline on pull requests, upload the review as SARIF to GitHub
code scanning (this needs `security-events: write` and the repository's code
scanning enabled):

```yaml
permissions:
  contents: read
  security-events: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npx --yes godotwright review . --sarif > godotwright.sarif || true
      - uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: godotwright.sarif
```

Run this from the repository root and point `review` at the project folder
(for example `review game --sarif`): SARIF paths are relative to the repository
root, so code scanning can place the findings on the right files.

## Export, check and run a build

"Works in the editor, broken in the build" is found before anyone ships. `godotwright export` (MCP `godot_export`)
checks the presets without exporting. `godotwright export run` (MCP `godot_export_run`) exports for real, headless,
and checks the result instead of trusting it:

```sh
godotwright export run --preset Linux                    # --export-pack: needs no export templates
godotwright export run --preset Linux --mode release     # --export-release: needs the templates of this exact Godot version
godotwright export run --preset 0 --frames 0 --json      # by number, no smoke run, JSON for scripts
```

1. **Before Godot runs:** the preset must exist (a missing one lists the presets there are), `export_presets.cfg` must
   not start with a byte order mark (Godot 4.7.2 then reads no presets at all and says "Invalid export preset name"),
   and a release or debug build needs export templates for the exact version (`4.7.2.stable`); a pack needs none.
2. **The export:** `--import`, then `--export-pack`, `--export-release` or `--export-debug` into
   `.godot/godotwright/export/<preset>/` (the preset's own `export_path` is left alone; `--out` picks another file and
   its folder is made). Godot's exit code is used, and its multi-line errors are kept whole. The file must also be there
   and big enough: Godot can fail and still leave a file behind, which is reported as not to ship.
3. **The contents:** the pack is read without Godot (PCK format 2 to 4; format 4 is what 4.7.2 writes; a pack inside
   an executable is found from its end; an encrypted directory is detected and its file count shown). Every file the
   game loads from where it starts (main scene, autoloads, settings, then `ext_resource`, `preload` and `load` with a
   literal path) must be in it, after mapping exported names back (`x.gdc` and `x.gd.remap` to `x.gd`,
   `x.png.import` to `x.png`); a missing one is an error with the chain that loads it and the preset's reason (an
   `exclude_filter`, or a plain file that `include_filter` does not name). Editor-only scripts (extending an `Editor*`
   class, which export templates do not have) and test code shipped are warnings, one per folder, with the
   `exclude_filter` to add. The static audit's predictions for the preset are checked against the real pack.
4. **The smoke run:** the exported game runs headless for `--frames` (default 120) at the project's physics rate, in an
   empty folder so no project files mix in: the exported binary itself when it runs on this machine, else Godot with
   `--main-pack` (which also opens an executable with the pack inside). Runtime errors come with their call chain, as in
   `godotwright check`, and what the game printed is shown.

The exit code is 1 on any error, so it works as a CI step. In CI, the pack mode needs only the Godot binary:
`godotwright ci --export-preset Linux` adds an export row to the receipt (pack, contents, smoke run), and the GitHub
Action takes it as the input `export-preset`.

`godotwright export pck game.pck` (MCP: `godot_export` with `pck`) reads a pack you already have and compares it with
the project, and `godotwright export smoke game.pck` runs one.

### Patches

`godotwright export patch` (MCP: `godot_export_run` with mode `patch`) makes a patch .pck with only what changed, and
lists every file it carries (`~` changed, `+` new, `-` removed):

```sh
godotwright export patch --preset Linux --against base.pck            # Godot's --export-patch, checked
godotwright export patch --preset Linux --manifest pck-manifest.json  # no base .pck here: cut from a full export
```

- **Against base packs** (`--against`, in load order, or the preset's `patches`): Godot's own `--export-patch`. The
  patch is then checked against a fresh full export of the project: no file in it may be the same as in the base, and
  every file that changed (or is new) must be in it; a file the base has and the project lost should be removed.
  Nothing changed is not an error: no patch is written.
- **Against a list of the base game's files** (`--manifest`, or `baseFiles` in `godotwright.json`), for a mod over a
  shipped game whose multi-gigabyte .pck is not here: JSON with `resource`, `md5` and `bytes` per file (a .pck
  manifest), a list of paths, or one path per line. Godotwright exports the full pack and keeps the files whose md5
  differs from the list or that are new. With paths only, a listed file cannot be told apart from an unchanged copy, and
  the report says so.
- **The smoke run** writes one pack that holds the base with the patch over it (a later file replaces an earlier one, a
  removal takes it out, as Godot loads them) and runs that with `--main-pack`. With only a list, it runs the project's
  full export and says so; a patch with delta-encoded files (`patch_delta_encoding`) is not run.

## Scenarios and JUnit reports

A scenario is a regression test kept in the project, in `.godotwright/scenarios/<name>.json`. It is a `godot_play`
run written down: a scene, an input timeline and claims about what the game did. `godotwright ci` runs every
scenario headless and deterministically, with no editor.

```json
{
  "name": "jump",
  "input": "10 tap jump",
  "frames": 90,
  "signals": ["Hero.jumped", "Hero.landed"],
  "expect": ["Hero.velocity.y == -400 @ 10", "Hero.jumped == 1 @ 10", "Hero.landed == 1", "Hero.is_on_floor() == true"]
}
```

- `expect`: at least one claim, `<Node.property> <==|!=|>=|<=|>|<> <value> [@ frame]`. Without a frame, the claim
  is checked on the last frame. A claim on a recorded signal (`"Hero.landed >= 1 @ 60"`) counts how often the signal
  fired up to that frame.
- Optional: `scene` (default: the main scene), `watch` (more values to sample), `frames` (default 120, or one past
  the last frame a claim names), `until` (stop at the first frame a condition holds; the scenario fails when it never
  does), and `signals` (the signals to record). Files written before `until` and `signals` existed still work.

To keep a proof, an agent calls `godot_scenario` with op `save` and the same arguments as the `godot_play` run.
On the command line, use `godotwright scenario --save <name>` with `--scene`, `--input`, `--watch`, `--frames`,
`--until`, `--signal` and `--expect`. Godotwright runs the scenario once more and writes the file only when every
claim holds, so a scenario that never passed cannot get into the project. An existing file is only replaced with
`overwrite` (`--overwrite`), and `godot_undo` takes a save back. op `list` (`--list`) shows the scenarios and their
claims. op `run` (no flag) runs all of them, or the one you name (else every name that contains it). A passing
scenario takes one line. A failing one shows every failing claim with the value the game had and the frame.

**JUnit XML.** `godotwright ci --junit <file>`, `godotwright test --junit <file>` and
`godotwright scenario --junit <file>` also write the results as JUnit XML, the test report format of GitLab
(`artifacts:reports:junit`), Jenkins, Azure DevOps and the JUnit report actions on GitHub. The printed output does
not change. In the file:

- Each scenario is a suite with one test case per claim. A game error or a run that stopped early is an `<error>`
  case named `run`.
- GUT and GdUnit4 suites are kept exactly as the framework wrote them. A test run that left no report (a crash or a
  timeout) is an `<error>` case, so it cannot pass silently.
- `ci` adds `review` and `check` as test cases of the suite `godotwright`.

The GitHub Action takes `junit: godotwright.xml` and passes the path on as the output `junit`:

```yaml
      - uses: laaielichter/godotwright@<version>
        id: godotwright
        with:
          junit: godotwright.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: godot-tests
          path: ${{ steps.godotwright.outputs.junit }}
```

## Mods and patches over a game

A mod or patch often uses scripts, scenes and models that live in the game, not in
the mod's folder. Point Godotwright at the game so they count as present:

```sh
godotwright review mod/ --base game/                       # the game's source folder
godotwright review mod/ --base-files game/pck-manifest.json # files the shipped .pck holds
```

or put it in `godotwright.json` in the mod's root (paths relative to that root):

```json
{ "base": ["../game"], "baseFiles": ["../manifests/pck-files.json"] }
```

The game's classes, autoloads, input map and scenes are then known, the mod's own
files win where both have the same path, and only the mod's files are reviewed.
A file list is text with one path per line, or JSON (strings, or objects with a
`path`, `resource` or `file` key); exported names such as `x.glb.import` and
`x.gdc` map back to their source.

## Install in your coding agent (MCP)

One step for each client. Every setup and one-click button is on the [install page](https://laaielichter.github.io/Godotwright/install.html).

| Client | How |
| --- | --- |
| **Claude Code** | Plugin with the MCP server, hooks, eleven skills and eight subagents: `/plugin install godotwright --marketplace laaielichter/Godotwright` |
| **Claude Desktop** | Download [`godotwright.mcpb`](https://github.com/laaielichter/Godotwright/releases/latest/download/godotwright.mcpb) and open it (from release 0.2.0) |
| **Cursor** | [Add to Cursor](https://laaielichter.github.io/Godotwright/install.html#cursor) (one click) |
| **VS Code** (Copilot) | [Install in VS Code](https://laaielichter.github.io/Godotwright/install.html#vscode) (one click) |
| **Codex** | `codex mcp add godotwright -- npx -y godotwright mcp --tier premium` |
| **Gemini CLI** | `gemini extensions install https://github.com/laaielichter/Godotwright` |
| **Windsurf, Zed, others** | [JSON for your client](https://laaielichter.github.io/Godotwright/install.html#other) |

The Claude Code plugin puts Godotwright in Claude's loop, so it does not depend on Claude remembering a tool:

- **Hooks:** every Godot file Claude edits is reviewed right after the edit and its errors go straight back to
  Claude; Godot errors in a command's output come with the lessons that explain them; before Claude stops, review
  errors left in files it changed are named once; and a session in a Godot project starts with a few lines about it.
  `GODOTWRIGHT_HOOKS=0` turns them off. Any agent can use them: `godotwright hook <event>` reads Claude Code's hook
  JSON on stdin (`pre-edit`, `post-edit`, `post-bash`, `stop`, `session-start`). `pre-edit` refuses edits into
  [protected paths](#protected-paths).
- **Settings (`userConfig`):** the Godot project, the Godot program, protected paths, tool sets and read-only, all
  optional. They reach the server as `GODOTWRIGHT_PROJECT`, `GODOT`,
  `GODOTWRIGHT_PROTECT`, `GODOTWRIGHT_TOOLS` and `GODOTWRIGHT_READ_ONLY`, and the hooks as
  `CLAUDE_PLUGIN_OPTION_<KEY>`.
- **Skills Claude uses on its own:** the Godot workflow, and `debug`, `perf`, `vehicles`, `world`, `model` and `patch`
  (changes to a shipped game with preflight, receipts and rollback).
- **Skills you start:** `/godotwright:review` (review the project and fix what it finds), `/godotwright:port` (port
  Godot 3 code to Godot 4) and `/godotwright:learn` (teach Godotwright what the session learned).
- **Seven subagents:** `godot-reviewer` (verified review), `godot-debugger` (root cause), `godot-migrator` (Godot 3 to 4),
  `godot-performance` (measurements), `godot-shader-specialist` (shaders and materials), `godot-model-builder` (3D assets)
  and `godot-test-engineer` (unit, gameplay and visual regressions). Delegate a focused task; edits require an
  implementation request. Missing engine and renderer checks are reported, not counted as passes.
On Claude Code older than 2.1.275, run `/plugin marketplace add laaielichter/Godotwright` and then
`/plugin install godotwright@godotwright`. Only the MCP server, without the skills:

```sh
claude mcp add godotwright -- npx -y godotwright mcp --tier premium
```

Codex can also read it from `~/.codex/config.toml`:

```toml
[mcp_servers.godotwright]
command = "npx"
args = ["-y", "godotwright", "mcp", "--tier", "premium"]
startup_timeout_sec = 30 # the first npx run downloads the package
```

Run the agent from the Godot project folder, or pass `--project <path>` (or set `GODOTWRIGHT_PROJECT`).
Pick a profile with `--tier`:

- `premium`: full detail, all findings with fixes. Use it with large models.
- `cheap` (the default): short output, and server instructions that walk a small model
  through checked steps (scan, look up, review before saving, review after each edit).

CI connects both Claude Code and Codex to the server on every push.

### The 39 tools

| Tool | What it does |
| --- | --- |
| `godot_doctor` | Start here when something is broken: the review and Godot grouped by cause, most urgent first, each with its lesson and fix, then numbered next steps |
| `godot_scan` | Map the project: scenes and node trees, scripts, signals, autoloads, input map |
| `godot_api` | Exact Godot 4.7 lookup: signatures, inheritance, Godot 3 names |
| `godot_api_search` | Search the Godot 4.7 class reference |
| `godot_review` | AAA review with scores; also reviews unsaved code (`code` + `file`), or only what changed (`only_new`); `from`/`target` for upgrades between 4.x releases |
| `godot_checklist` | Every AAA rule with its fix |
| `godot_feedback` | Mark a review finding as wrong or right, or say whether a lesson helped, so Godotwright learns from it |
| `godot_lessons` | Lessons from real Godot projects (symptom, cause, fix, test) by words, Godot error, rule or topic; `gaps` lists what it cannot predict yet |
| `godot_lesson_add` | Keep a lesson learned here, scrubbed of names, paths and code; it comes back when the same error does |
| `godot_dream` | Look back between sessions (learning file, journal, optionally session transcripts) and propose draft lessons, project hints, merges, retirements and fixes for contradictions, each with its evidence; nothing changes until `apply` |
| `godot_usages` | Every place a name or `res://` path is used: code, scenes, connections, groups, settings |
| `godot_rename` | Rename a name or move a file everywhere at once, keeping connections, node paths and `.uid` files right |
| `godot_project_edit` | Change settings, input actions and autoloads in `project.godot`, touching only that entry |
| `godot_scene_edit` | Add or remove nodes, set properties, connect signals, attach scripts and make instances editable in a `.tscn`; refuses a change Godot would drop on the next editor save |
| `godot_resource_edit` | Edit a `.tres` (properties, sub_resources, uids kept) and import settings (`.import` options, per-animation, mesh, material and node options, importer switch); a written `.import` is reimported headless and checked |
| `godot_migrate` | Rewrite Godot 3 GDScript and shaders to Godot 4 where that is mechanical, and list what is left |
| `godot_shader` | Review every shader against Godot 4.7's shader tables and compile it with Godot headless; `gpu: true` also draws it for GPU driver errors; errors as `file:line` |
| `godot_code` | Godot's own GDScript language server, kept warm: diagnostics at the project's warning levels, hover (inferred types and signatures), definition and completion, also for unsaved code |
| `godot_deps` | The project as a graph of files from where the game starts: unused files with their size (paths the code builds count), why a file is used, what a scene loads with it, scene loops Godot cannot load |
| `godot_undo` | Undo the last Godotwright writes (edits, renames with their moves, migrations, fixes, model builds), newest first; a file changed by hand since is left alone |
| `godot_fix` | Apply the mechanical fixes for review findings, each labelled `safe` or `check`, uid repairs across files included; shows them first, then reviews the changed files again |
| `godot_check` | Run Godot headless (load every script and scene, compile every shader) and report errors as `file:line`, runtime errors with their call chain; `shaders: true` also draws every shader; `compare_godot` diffs against a second Godot |
| `godot_test` | Run GUT or GdUnit4 tests headless; only what failed, with `file:line` |
| `godot_play` | Run a scene with an input timeline and return the values you watch per frame; `until` a condition, `signals` with their frame, `summary` per value, `expect` claims |
| `godot_export` | Before an export: files the presets leave out although the game loads them, plain data files missing from `include_filter`, paths built under excluded folders; with `pck`, what an exported pack holds |
| `godot_export_run` | Export headless (pack, release, debug or patch), check the file and the pack's contents against what the game loads, then run the build for some frames with runtime errors and call chains |
| `godot_scenario` | Keep a passing `godot_play` run as a regression test in the project (`save` runs it once more first), `list` them, `run` one or all with every failing claim, its value and frame |
| `godot_session` | Load a scene once and keep the game running between calls, headless and paused, until you stop it |
| `godot_game` | Look at and drive that running game: live tree, get and set values, call, eval, step frames with input until a condition holds, 3D layout (floating, buried, scale), rays, UI issues per window size, hot reload of edited scripts (state kept), new errors with their call chain |
| `godot_perf` | Measure a scene's frame times: p50/p95/p99 against a budget, the slowest frames and what changed on them, the change since the last run |
| `godot_leaks` | Load, run and free a scene in cycles and report what grows per cycle: orphan nodes by class, script and scene with where they were made and removed, nodes left behind, objects that are not nodes, what Godot held at exit; fails over a budget |
| `godot_screenshot` | Render a scene or a `.glb` to a PNG and say how much is drawn and whether it is blank; with `baseline`, a visual test: unchanged as text only, or the percent changed, the areas of change and moves, and a diff picture |
| `godot_model_brief` | One page before you build, for small models: the kind to start from, parts, size, rules and the order of tools |
| `godot_model_identify` | What a thing is: parts, pivots, typical size with its source, variants (English or Dutch) |
| `godot_model_spec` | The model spec format, an example and the ready-made kinds |
| `godot_model_build` | Build a clean `.glb` from a kind or a spec (inside the project), and lint it |
| `godot_model_lint` | Score a `.glb`; with `archetype` also check it is what it should be |
| `godot_model_view` | See a `.glb` as text: front, side and top views, parts with sizes, parts that do not touch |
| `godot_model_inspect` | What is in a `.glb`: nodes, triangles, textures, size |

## Tool sets and read-only mode

Every tool definition goes into the agent's context on every turn. All 39 cost about 80,000 characters (about
20,000 tokens); the `core` set about 24,000. Load only what the work needs:

```sh
godotwright mcp --tools core            # or GODOTWRIGHT_TOOLS=core
godotwright mcp --tools core,run,godot_session,godot_game
godotwright mcp --read-only             # or GODOTWRIGHT_READ_ONLY=1
```

| Set | Tools | Size of the tool list |
| --- | --- | --- |
| `core` | scan, api, api_search, review, check, code, doctor, fix, usages, lessons, feedback, undo, checklist | 13 tools, ~23,900 characters |
| `edit` | rename, scene_edit, project_edit, resource_edit, migrate, shader, lesson_add, dream | 8 tools, ~18,600 |
| `run` | test, play, scenario, perf, leaks, screenshot | 6 tools, ~16,500 |
| `game` | session, game | 2 tools, ~5,400 |
| `export` | export, export_run, deps | 3 tools, ~5,500 |
| `model` | model_brief, model_identify, model_spec, model_build, model_view, model_lint, model_inspect | 7 tools, ~10,000 |
| `all` (default) | everything | 39 tools, ~79,900 |

Sets and single tool names mix (`core,godot_play`; the `godot_` prefix may be left out). An unknown name stops the
server with the valid names. The server instructions name only the tools that are enabled, so a small model is never
told to call a tool that is not there. The default stays `all` on both tiers, so nothing changes for existing setups.

`--read-only` means "does not change the project's files":

- left out: `godot_undo`, `godot_model_build` and `godot_export_run`, which always write;
- kept, but `write: true` is refused, so they show their dry run: `godot_fix`, `godot_rename`, `godot_scene_edit`,
  `godot_project_edit`, `godot_resource_edit`, `godot_migrate`;
- refused: `godot_scenario` op `save`, `godot_game` ops `set`, `call` and `eval`, `godot_dream` with `apply`, and
  `godot_screenshot` with `model` or `baseline` (they write the picture into the project);
- kept as they are: the review, API and lessons tools (they write only counters to the local learning file in your
  home folder, which `GODOTWRIGHT_LEARN=0` turns off), and the tools that run Godot.

Read-only does not make an untrusted project safe: `godot_check`, `godot_test`, `godot_play`, `godot_perf`,
`godot_leaks`, `godot_screenshot`, `godot_session` and `godot_doctor` (when Godot is installed) run the project's own
scripts, and Godot rewrites its cache in `.godot/`. For a project you do not trust, also leave out the sets that run
Godot (`--tools core` still has `godot_check` and `godot_doctor`; pass `godot: false` to the doctor) or do not install
Godot where the agent runs.

## Structured results

`godot_review`, `godot_check`, `godot_doctor` and `godot_test` declare an `outputSchema` and return
`structuredContent` next to the same text as before (clients that read only the text see no change). One compact shape:

```json
{
  "ok": false, "errors": 1, "warnings": 3, "truncated": 0,
  "findings": [
    { "file": "res://player.gd", "line": 4, "severity": "error", "rule": "api/wrong-arguments", "message": "..." }
  ]
}
```

Each finding has `severity` and `message`, and when known `file` (`res://`), `line`, `rule`, `source` (where it was
found: script, scene, import, run, review, godot, test) and `count` (how often Godot printed it, or how many places a
doctor problem has). `findings` is capped like the text (15 on the cheap tier, 200 on premium) and `truncated` says how
many were left out. Per tool:

- `godot_review`: `project`, `overall` and `categories` (score per category); the findings are those the text lists
  (same `files` focus; infos left out on the cheap tier with brief detail). With `only_new` the text shows the delta and
  the JSON the current findings.
- `godot_check`: `godotVersion`, `scripts`, `scenes`, `shaders`, `frames` (when it ran the game). With `compare_godot`
  the findings are only what the second Godot reports.
- `godot_doctor`: `godot` (ran, not installed, skipped, failed), `overall`, `next` (the numbered steps); each problem is
  one finding at its first place. It is never an error result.
- `godot_test`: `framework`, `tests`, `passed`, `failed`, `skipped`; failing tests come first with rule `test/failure`
  or `test/error`, then what Godot printed.

An error result (`isError`) still carries `structuredContent` when the tool got that far (a check with errors, failing
tests, a review of a file that is not in the project). MCP clients skip the schema check on error results; the schema
holds there too. When Godot is missing there is only the text.

## Progress and cancel

Every tool call runs Godot inside a run context. When the client sends a `progressToken`, Godotwright sends
`notifications/progress` for each Godot run: the phase when it starts (`import: started`, `load: started`,
`play: started`, `export: started`, `shader compile: started`, `session: loading res://main.tscn`) and, at most about
once a second, what Godot reports: import steps with their percentage, `load: 60/212 files` for a check, and
`play: frame 120/600` for play, perf, leaks and scenarios. `progress` counts up by one; there is no `total`.
SDK clients that pass `resetTimeoutOnProgress` keep a long `godot_check` or `godot_test` alive this way.

When the client cancels the call (`notifications/cancelled`), Godotwright stops the Godot process and every process it
started (its process group on Linux and macOS, `taskkill /T` on Windows), waits for it to exit, and does not start the
next step of that call. `godot_session` op `start` stops the game it was starting. Godot processes still running when
the server exits are stopped too. The CLI is unchanged: there Godot stays in the terminal's process group, so Ctrl+C
reaches it.

## Protected paths

Some folders must stay byte-identical: an installed game, a base project a mod is laid over. Name them in a
`godotwright.json` under `"protect"`:

```json
{ "protect": ["installed-code", "baseline-authoring"] }
```

Entries start at the folder of that `godotwright.json`; `res://...` means the same (the folder is the project), and
`../baseline-authoring` works from a project's own file. Godotwright reads the `protect` lists of every
`godotwright.json` in and above the folder written to, in and above the folder the agent runs in and the server's
default project, and in the direct subfolders of the folder the agent runs in, so the list can live outside what it
protects (changing a file inside a protected folder to add it would break the byte-equality it guards).
`GODOTWRIGHT_PROTECT` (paths separated by commas or the OS path separator; relative to the working folder) and the
Claude Code plugin's "Protected paths" setting add more.

What is refused:

- **Godotwright's own writes**, in every client (the CLI too): `godot_scene_edit`, `godot_project_edit`,
  `godot_resource_edit`, `godot_fix`, `godot_migrate`, `godot_rename` (both ends of a move), `godot_model_build`
  (`out` and `contract_out`), `godot_export_run` (`out`), `godot_screenshot` (a model's picture, `out`, and a baseline
  it would make or update; comparing one still works), `godot_scenario` op `save` and new baselines of its screenshot
  steps, and `godot_undo` (checked for every file before any is put back). The tool returns an error that names the path and the `godotwright.json` that protects
  it; dry runs still work. A call that touches several files stops at the first protected one; what it wrote before
  stays in the journal, so `godot_undo` can revert it.
- **Claude Code's own edits**, with the plugin: a `PreToolUse` hook on `Write`, `Edit`, `MultiEdit` and
  `NotebookEdit` denies the call with the reason (`permissionDecision: "deny"`). It looks only when a `protect` list
  or setting is in reach, so other edits cost nothing extra.
- **The list itself**: a `godotwright.json` that holds a non-empty `protect` list is guarded the same way, so an agent
  cannot edit the list away before its next write; change it by hand. A symlink is followed to its target, also when
  the target does not exist yet.

Not covered: **Bash commands are not parsed** (`cp`, `sed -i`, `>` or `git checkout` into a protected folder go
through), and neither are other MCP servers. Claude Code's own permission rules (`"deny": ["Edit(./installed-code/**)"]`
in `.claude/settings.json`) can add a second line of defence. Godot's cache folder `.godot/`
inside a protected project is not protected: `godot_check` and the other tools that run Godot update it, as Godot
itself does when it opens the project. Like every hook, the hook fails open: when Godotwright cannot run or the input
is not what it expects, it allows the edit and says nothing.

## Learning

Godotwright learns from every use, on your machine:

- **Rules Godot keeps contradicting.** After each `check`, it compares the review with
  what real Godot reported. When an error rule is contradicted 3 times here and never
  confirmed, its findings become warnings, marked as hints.
- **False alarms.** `godotwright learn feedback wrong "<finding line>"` (or the
  `godot_feedback` MCP tool) hides that finding in later reviews.
- **API lookups.** When a lookup finds nothing and the next one does, the next failed
  lookup of the same name says what it usually means.
- **Rules that cry wolf.** A rule whose findings were marked wrong 5 times here, and wrong at least three times as
  often as right, is reported one level lower (an error becomes a warning, a warning an info). One local "right"
  keeps it where it was, whatever other installs said.
- **Lessons.** `godot_lessons` (or `godotwright lessons`) answers from lessons learned in real projects: what went
  wrong, why in Godot terms, the fix and how to test it. `godot_check` prints the lesson under a Godot error it
  explains, and `godot_review` names the lesson behind a finding. Say whether a lesson helped (`godot_feedback` with
  `lesson`): lessons that help rank higher, ones marked wrong more often than right stop showing up unasked.
- **Lessons you teach it.** When a fix took more than one try, keep it with `godot_lesson_add` (or
  `godotwright lessons add`), with the Godot message it explains. Names of the project, paths, links, e-mail
  addresses, codes, keys and source code are replaced before it is stored; a lesson that is mostly names is refused.
  The next time Godot prints that message, the check shows your fix.
- **What to teach next.** `godotwright learn gaps` (or `godot_lessons` with `gaps: true`) lists the Godot errors the
  review did not predict and no lesson explains yet, most frequent first. A gap that many installs share is the next
  review rule.

Nothing leaves your machine unless you say yes. The learning file (`godotwright learn` shows where) holds
counters, rule names, API names and message templates without names or paths; findings
marked as wrong are stored as hashes; lessons you add are stored scrubbed and are never sent.

```sh
godotwright learn          # status: what was learned, where the file is
godotwright learn off      # stop learning (or set GODOTWRIGHT_LEARN=0)
godotwright learn on
godotwright learn reset    # forget everything
godotwright learn preview  # the exact report sharing would send
godotwright learn share on # opt in: send anonymous counts once a day
```

Sharing helps every user: what many installs learn ships with later releases.
It is off by default, sends no code, file names, paths or project names, and
respects `DO_NOT_TRACK`. See [PRIVACY.md](../PRIVACY.md).
Set `GODOTWRIGHT_HOME` to keep the file somewhere else.

Godotwright also learns for free from public projects: every week the Learn
workflow reviews the official Godot demos, and the same demos written for Godot 3,
checks them with real Godot, and records which rules Godot confirmed or
contradicted. That, plus what opted-in installs share, ships in `data/learned.json`:
API hints for common typos, and rules Godot keeps contradicting.
What your own machine saw wins: one confirmation by Godot keeps a rule an error.

Lessons from real builds also become rules. `data/lessons.json` holds 272 anonymised lessons from large Godot 4
projects (helicopters and ships landing on moving decks, open worlds tens of kilometres wide, cockpits and head-up
displays, streaming and levels of detail, VFX and shaders, runtime-loaded models, audio, UI, installers for shipped
games, headless test rigs and frame-time measurement): no code, no names, no paths, and a test runs every one through
the same scrubber that local lessons go through. The ones a review can catch are rules, such as `api/infer-variant`
on loop variables over untyped arrays, `api/override-signature`, `api/freed-check-order`, `api/parse-into-typed`,
`api/duplicate-declaration`, `api/coroutine-without-await`, `api/timer-start-outside-tree`,
`api/multimesh-format-after-count`, `performance/runtime-gltf-mipmaps`, `performance/subviewport-always`,
`quality/shader-reads-own-depth`, `quality/time-modulo-window`, `quality/worker-task-not-waited` and
`model/opaque-glass`.
[LESSONS.md](../LESSONS.md) tells the story behind them, and [LESSONS-ROADS.md](../LESSONS-ROADS.md) does the same for
a road network generator (links, bridges, viaducts over rail and motorways, roundabouts, guard rails). Lessons you keep locally can be proposed for everyone:
`godotwright lessons export` prints them as entries for `data/lessons.json`; nothing is sent.

For maintainers, `godotwright collector serve` accepts reports (checked again,
stored without IP addresses), and `godotwright collector aggregate <dir> --out
data/learned.json` sums them, keeping only what at least 3 installs reported.
`godotwright collector projects <dirs...>` learns from public projects.

## Dreaming: learn from past sessions

`godotwright dream [path]` (MCP: `godot_dream`) looks back at what Godotwright learned and did in a project, between
sessions, and proposes what to keep. It is deterministic (no model, no network) and changes nothing until you apply.

It reads:

- the local learning file: Godot errors the review did not predict (`missedByReview`), failed API lookups and what came
  next, lesson counts (shown, helped, wrong), local lessons, rule counts, and findings marked wrong or right;
- the project's journal (`.godot/godotwright/journal/`): which writes were undone, by tool and file kind (only those;
  the journal keeps no names for this);
- with `--transcripts` (MCP `transcripts: true`) only: this project's Claude Code transcripts
  (`~/.claude/projects/<project folder>/*.jsonl`, also for the repository root above the project; `$CLAUDE_CONFIG_DIR`
  moves it) and Codex transcripts (`~/.codex/sessions`, matched by the folder they ran in; `$CODEX_HOME` moves it).
  The newest 40 changed within `--since` are read, each from its last 4 MB. Kept from them: calls to Godotwright tools by
  name, Godot errors in tool output as message templates (no names, paths or numbers; a template with anything personal
  left is dropped), and failed `godot_api` lookups that are a Godot class with a near-miss member, with what was looked
  up next. Their text, code, names and paths never reach the output, the report or a lesson.

Proposals, numbered, each with an id (stable between runs), its evidence counts and a reason:

| Kind | When | Apply |
| --- | --- | --- |
| draft lesson | a Godot error seen at least twice (review misses plus transcripts) that no rule predicts and no lesson explains | keeps a local lesson tagged `draft` with the symptom and message; cause and fix are left to write |
| project hint | an API name looked up at least twice that does not exist, with what was found next | adds "use X, not Y" to the project's hints and the lessons for agents |
| lesson from undone writes | writes by the same tool to the same kind of file undone at least twice | keeps a draft lesson about it |
| merge lessons | two local lessons with the same Godot message or nearly the same title | adds the messages, tags and rules of one to the other and removes it |
| retire lesson | a local lesson marked wrong at least twice and more often than it helped | removes it |
| rewrite lesson | a bundled lesson marked wrong here, or a local one shown 10 times with no verdict | a suggestion |
| finish draft | a draft lesson that has been shown twice and still has no fix | a suggestion |
| resolve | findings marked wrong and later right or confirmed by Godot (or the other way round); a rule Godot confirmed whose findings were marked wrong | the newest verdict of each finding wins; the rule one is a suggestion |
| noisy rule | a rule this project marked as a false alarm at least 3 times and at least twice as often as right | a suggestion (findings are not hidden by it) |

```sh
godotwright dream                       # proposals (--detail brief for one line each, --json)
godotwright dream --transcripts --since 7d
godotwright dream --apply 1,3           # numbers or ids; --apply all
godotwright dream --auto-apply yes        # once, on this machine: let "auto": "apply" act from the session-start hook
godotwright undo                        # takes the last apply back, lessons in the learning file included
```

An apply writes, through the journal, only on this machine and never into a file of the repository: lessons into the
learning file (through the local-lessons API, so the scrubber applies, and recorded in the journal entry so
`godotwright undo` puts them back; a lesson rewritten since is left alone), and into the dream folder `state.json` (the
hints, and the proposals applied or seen: a suggestion comes back once its evidence doubles), a dated report
`<date>-<time>.md` and `lessons-for-agents.md`. The dream folder is `.godot/godotwright/dreams/` in the project when git
ignores `.godot/` (Godot's own `.gitignore` does) or the project is in no repository; when git would track `.godot/`, it
is a folder in Godotwright's state folder named by a hash of the project folder, and the journal entry of the apply is
kept there too (`godotwright undo` still finds it).

`lessons-for-agents.md` holds the top five recurring mistakes with their fix and up to eight project hints; drafts stay
out of it. Only bundled lessons and local lessons learned in this project go in: a local lesson carries a hash of the
project folder it was kept in (`godot_lesson_add`, `lessons add` and dream applies set it), and one from another
project, or kept before this existed, never does. A line that the scrubber would still change (it looks like code or a
name) is left out. An apply that only marks suggestions as seen does not write it. The session-start hook adds it to the
agent's context, on this machine only. The learning file counts Godot errors for the whole machine, so a draft lesson
says where its evidence came from.

When it is due: the session-start hook counts sessions per project (a resumed session once) in Godotwright's state
folder (`dreams.json`, next to the learning file). Once at least `minHours` passed and `minSessions` sessions started
since the last dream (any `godotwright dream` or `godot_dream` run), it adds one line: "Godotwright has N dream
proposals: run godot_dream". It reads no transcripts. Settings in `godotwright.json` (in the project or a folder above
it):

```json
{ "dream": { "auto": "suggest", "minHours": 24, "minSessions": 5 } }
```

`"auto"`: `"suggest"` (default) only says so; `"apply"` applies the draft lessons, lessons from undone writes and
project hints by itself (never a removal, merge or verdict change) and says what it did, but only once the person has
allowed it on this machine with `godotwright dream --auto-apply yes` (`--auto-apply no` takes that back; an agent
cannot give it through `godot_dream`); until then it only suggests; `"off"` stays quiet. Nothing from dreaming is added
to the opt-in anonymous report.
`GODOTWRIGHT_LEARN=0` stops the counting.
