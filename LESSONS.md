# Lessons from building a large vehicle asset with Godotwright

> These lessons, and about 250 more from a second, much larger project (an open world with helicopters, jets, ships,
> trains and moving decks, cockpits, streaming terrain, and installers that patch the shipped game), are now data:
> `data/lessons.json`, searchable with `godotwright lessons` and the `godot_lessons` MCP tool, and shown under the
> Godot errors they explain. The last section below says what that second project changed in Godotwright. Lessons you learn yourself can be kept
> with `godot_lesson_add`; see [Learning](README.md#learning). The text below is the story behind the first ones.

An anonymised reflection on one long build: a high-detail military truck with a
working weapon system, built from scratch in Blender scripts and Godot 4.7 by a
coding agent with Godotwright. It holds no code, no project names and no paths;
only what to do differently next time. Each lesson says whether Godotwright now
checks it.

## Shape and dimensions

1. **Measure the real thing before modelling.** A published "overall length"
   was about 12 % off for the configuration being built, and the first model
   followed it. Photos scaled on a part of known size (the tyre), then checked
   against a second known size, gave numbers that matched other sources.
   *Partly checked:* `model lint --archetype` flags a size outside the typical
   range of the kind (a unit error, not a 12 % error).
2. **Keep one source of truth for layout.** Several builders worked in parallel
   and each copied positions; the wheels ended up 0.35 m away from their axles.
   One shared layout file that every part reads fixed it for good.
   *Partly checked:* `model lint` reports parts that float free of the rest
   (`model/floating-part`), and `--archetype` checks wheel pivots.
3. **Compare silhouettes, and compare like with like.** Overlaying a model
   silhouette on a photo mask finds proportion errors quickly, but only when the
   pose matches: a raised launcher in the photo dominated the score.
   *Not checked.* `model view` and `screenshot` give the same views to compare.
4. **Check the real finish before inventing one.** A camouflage pattern looked
   "military" but was wrong; every reference showed a single solid colour with
   wear. *Not checked.*
5. **The width of a module is not the width of its payload.** The container
   size from a manual described only the inner part; the visible module with its
   side housings was twice as wide. *Not checked.*

## Godot import and rendering

6. **Textures loaded from scripts get no 3D detection.** Godot enables
   mipmaps and VRAM compression when it sees a texture used in a 3D material in
   the editor. Textures loaded at runtime by script keep the 2D defaults, so
   they shimmer at a distance and use far more video memory. Set mipmaps (and
   compression) in their import settings. *Checked* for glTF loaded at runtime
   (`performance/runtime-gltf-mipmaps`) and for images read from `res://` source files (`api/image-load-res`).
7. **Glass is opaque until you make it otherwise,** and an interior behind it
   stays black without its own light. Both are needed before a cockpit shows.
   *Checked:* `model lint` reports glass, canopy and window materials that light cannot pass (`model/opaque-glass`).
8. **The Compatibility renderer needs a fill light.** Ambient light alone left
   the shaded side of a vehicle almost black. *Not checked;* `screenshot` adds a
   directional and an ambient light to the models it frames.
9. **A copied project needs its import cache.** Headless render scripts in a
   fresh copy failed on every `class_name` until the project was imported once.
   *Handled:* `check`, `test`, `play` and `screenshot` import first.
10. **Imported node names can change.** An object with the same name as its
    pivot node gets a numbered suffix; look nodes up by the pivot, not the mesh.
    *Checked:* `model lint` reports names Godot changes on import (`model/renamed-on-import`).
11. **Ship levels of detail with heavy models.** A model of well over a million
    triangles with no LOD is fine in a close-up and too heavy as traffic.
    *Checked:* `model lint` warns over the triangle budget (`model/triangle-budget`).

## Gameplay

12. **Slow motion must always be undone.** An impact camera that lowers
    `Engine.time_scale` must restore it when the effect ends and when its node
    leaves the tree, or the whole game stays slow. *Checked:* `review` warns
    when a script changes `Engine.time_scale` and never sets it back to 1.0
    (`quality/time-scale-not-restored`).
13. **Ballistic aiming needs the projectile's own flight model.** Aiming along
    the straight line to the target missed every ground target; solving the
    elevation with the same physics the rocket uses hit within a metre.
    *Not checked;* a scenario (`godotwright scenario`) can test it.
14. **Read positions from marker nodes, not from constants.** Camera and muzzle
    positions hard-coded in scripts broke when the model changed; named markers
    in the model kept them right. *Not checked.*

## Process

15. **Verify with images, not with claims.** Reports from helpers said "looks
    right" more than once when the render said otherwise. Every step ended with
    a render that was actually looked at. *Supported:* `screenshot` and
    `model view` give the picture, with how much of it is drawn.
16. **Long background work can be lost.** A container restart stopped all
    running work; resuming from the recorded results saved most of it. This
    file itself was lost that way once, and recovered from the build's log.

# Lessons from rebuilding a real race circuit and its town from open data

A second anonymised reflection: a real coastal race circuit, its grandstands and
the seaside town next to it, rebuilt at 1:1 in Godot 4.7 by a coding agent
from national open elevation (a 0.5 m laser-scan terrain model) and topography
data (building footprints, road and land-cover polygons). No code, names or
paths; each lesson says whether Godotwright now checks it.

## Data before modelling

17. **Take the track from the asphalt, not from a race-line trace.** A public
    centre line of the circuit was a few metres off in places and polygonal in
    the corners. Cutting cross-sections every 2 m through the official asphalt
    polygons and taking the middle gave a centre line and width per metre.
    *Not checked.*
18. **The terrain model already holds the banking.** Fitting a plane across
    the asphalt in the elevation data gave 17-18° in the banked corners,
    within a degree of the published values, so nothing had to be invented.
    *Not checked.*
19. **Rotate a real place by its coastline, not by north.** The real coast
    runs about 22° off north. Turning the piece by 90° alone left the sea
    diagonal across it; turning it by the fitted coast angle made the beach run
    straight along the game's coast. *Not checked.*
20. **Measure the target world at install time.** Where the game's coastline
    lies was not known from old maps. The installer measures it in the live
    height grid and moves the whole piece so both waterlines meet. *Not checked.*

## Godot rendering

21. **A plain `.gz` file does not open with `open_compressed()`.** That call
    reads Godot's own compressed format; on a gzip file it returns null and
    the terrain silently stayed empty. Read the bytes and use
    `decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP)`. *Checked:* `review`
    reports it (`api/open-compressed-gzip`).
22. **LOD margins without a fade mode leave holes.** With
    `visibility_range_*_margin` and no `visibility_range_fade_mode`, the margin
    is hysteresis: a terrain tile whose distance sat inside the margin showed
    no level at all for a camera that started there. *Checked:* `review` warns
    (`quality/visibility-margin-hysteresis`).
23. **Colours typed into a shader are sRGB; `ALBEDO` is linear.** Every
    hand-picked colour came out washed out until it was converted with
    `pow(c, vec3(2.2))`, and vertex colours on a `StandardMaterial3D` needed
    `vertex_color_is_srgb`. *Not checked.*
24. **A height texture clamps at its edge.** Tiles of 256 m reached past the
    end of the data and drew long streaks of the last row; discard fragments
    outside the data rectangle. *Not checked.*
25. **Carve the ground well under a road mesh.** Grass showed through the
    asphalt where the 2 m terrain grid interpolated between a low node under
    the track and a high one beside it. Lowering the ground to 0.12 m under the
    surface across the full width plus 3 m, with an 8 m blend, fixed it; a
    test now measures terrain against the asphalt at every 7 m. *Not checked.*
26. **Build stands on the outside of tight corners.** Rows that follow a
    hairpin on the inside converge and pile up. *Checked in part:* the
    `grandstand` archetype says so, and the `grandstand` recipe builds a
    straight stand.

## Ready-made kinds added from this build

`grandstand` (stepped rows, seats, walls, roof on columns), `crash-barrier`
(double W-beam on posts with a catch fence) and `race-kerb` (red and white
blocks with a raised outer lip), with the archetypes `building.grandstand`,
`infrastructure.crash-barrier` and `infrastructure.kerb`.

# Lessons from building an inland waterway network on a heightmap terrain

A third anonymised reflection: canals, harbour basins and
locks added across a large open world that stores its ground in several
heightmaps (fine grids near towns, one coarse grid for the rest). Built by a
coding agent with Godotwright, partly without access to the live game data. No
code, names or paths; each lesson says whether Godotwright now checks it.

## Terrain and water

27. **A narrow channel disappears in a coarse heightmap.** A 32 m wide canal on
    a 32 m grid fell between the samples and came out as a shallow dip. Carving
    the coarse grid 0.8 cell wider than the fine one fixed it.
    *Not checked;* the river archetype now lists it as a pitfall.
28. **Carve every grid that covers a place.** With fine and coarse grids over
    the same ground, a channel carved in only one of them shows up or vanishes
    with the level of detail. *Not checked;* listed as a pitfall.
29. **Lower land needs embankments, higher land a cut.** A canal checked only by
    its bed depth stood above the fields where the polder was lower than the
    water. The profile needs a bank above water level on both sides and sloping
    cuts where the ground is higher. *Not checked;* listed as a pitfall.
30. **Hand-built water faces up only with the right winding.** Godot draws
    clockwise faces as the front, so for a surface seen from above the cross
    product (b - a) x (c - a) of each triangle must point down. A test that
    builds one triangle and checks the sign caught it before any render.
    *Not checked;* the water archetype lists it.

## Networks

31. **Test the network as a graph, twice.** "Every waterway reaches every other"
    passed for water but failed for boats: low fixed bridges split routes, and
    a lock joined a canal to a river 300 m away from where the centrelines met.
    One graph for water and one for what a large boat can pass found both.
    *Not checked;* the river archetype suggests the test.
32. **A lock needs two water levels.** A lock between reaches at the same level
    is decoration; boats that steer by an offset also need to aim for the
    centre inside the chamber. *Partly checked:* `model identify` now knows the
    canal lock and the harbour basin, with their parts and pitfalls.
33. **Remove what the water covers, and rebuild the index.** Buildings, trees
    and lamps left standing in a new basin, and a spatial index that still
    pointed at removed records, were the first bugs. *Not checked.*

## Code

34. **`JSON.parse_string()` returns null on bad text.** Hundreds of scripts in
    one project stored its result straight in a `Dictionary` or `Array`
    variable, or called a method on it, so a damaged data file stops the
    script with an error instead of a clear message; a null check on the next
    line is too late. *Checked:* `review` warns (`api/parse-into-typed` for a
    typed variable, `quality/json-parse-unchecked` for a result used before a
    check).

## Process

35. **When the live data is out of reach, test the pipeline on a made-up
    world.** A small synthetic world (a polder, a hill, one building, one road)
    exercised every step and found three bugs that would otherwise have shown
    up only on the real data. *Supported:* `scenario` and `play` do the same
    for game logic.

# What a large open world taught Godotwright

The second project is an open world tens of kilometres wide, built over many weeks by several coding agents: flyable
helicopters and jets with cockpits, ships with decks to land on, trains on a rail network, streamed terrain, weather,
VFX, NPCs, and installers that patch the shipped game. Its work notes, debug reports and changelogs were read in full,
and every problem that had a Godot cause and a verified fix became a lesson: 195 new ones, anonymous like the rest.
The review was also run over all of its scripts, the game itself and every overlay laid over it.

## New review rules

36. **A coroutine's result used without `await`.** A builder that was changed to spread its work over frames
    started to `await`; every caller that read its result now stops the script. *Checked:* `api/coroutine-without-await`.
37. **A Timer started before it is in the tree never fires.** *Checked:* `api/timer-start-outside-tree`.
38. **A MultiMesh takes a new format only while `instance_count` is 0.** Custom data set afterwards is ignored.
    *Checked:* `api/multimesh-format-after-count`.
39. **`world_3d` of the viewport a node is in is null when it uses its parent's world**, so a camera view that copies
    it renders nothing. *Checked:* `api/viewport-world-borrowed`.
40. **`int(t * k) % n == 0` is true for a whole window of frames.** An expensive tree search ran on every frame of
    that window. *Checked:* `quality/time-modulo-window`.
41. **A ternary on its own line throws its value away**, and with void calls the script does not load.
    *Checked:* `quality/standalone-ternary`.
42. **`find_children()` skips nodes without an owner**, such as the ones a script adds itself.
    *Checked:* `quality/find-children-unowned`.
43. **Every WorkerThreadPool task must be waited for**, at the latest when its node leaves the tree.
    *Checked:* `quality/worker-task-not-waited`.
44. **A SubViewport on UPDATE_ALWAYS renders a whole extra view every frame**, also when its screen is out of sight.
    *Checked:* `performance/subviewport-always`.
45. **Orphan-node and static-memory monitors read 0 in a release export.** *Checked:* `api/debug-only-monitor`.

## Fewer false alarms on real code

46. **One cause, one finding.** A broken `preload()` constant used as a type was reported again at every use, and a
    script extending a missing base got errors for every name that could come from that base. Both now stay with the
    one finding that names the cause.
47. **A script only the shipped game holds is not missing.** With a `.pck` file list as `baseFiles`, `extends` of a
    script the game ships (as `.gd.remap`) is no longer an error.
48. **`var a := f(); var b := g()` declares two locals.** Statements joined with `;` are read one by one.

## For agents

49. **Do not rely on the agent remembering a tool.** The Claude Code plugin now runs the review after every edit of a
    Godot file and sends the errors back, adds lessons under Godot errors in command output, and names review errors
    left open before the agent stops. `godotwright hook` does the same for any agent with hooks.

