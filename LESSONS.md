# Lessons from building a large vehicle asset with Godotwright

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
   compression) in their import settings. *Not checked yet.*
7. **Glass is opaque until you make it otherwise,** and an interior behind it
   stays black without its own light. Both are needed before a cockpit shows.
   *Not checked.*
8. **The Compatibility renderer needs a fill light.** Ambient light alone left
   the shaded side of a vehicle almost black. *Not checked;* `screenshot` adds a
   directional and an ambient light to the models it frames.
9. **A copied project needs its import cache.** Headless render scripts in a
   fresh copy failed on every `class_name` until the project was imported once.
   *Handled:* `check`, `test`, `play` and `screenshot` import first.
10. **Imported node names can change.** An object with the same name as its
    pivot node gets a numbered suffix; look nodes up by the pivot, not the mesh.
    *Not checked.*
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

# Lessons from building an inland waterway network on a heightmap terrain

An anonymised reflection on a second long build: canals, harbour basins and
locks added across a large open world that stores its ground in several
heightmaps (fine grids near towns, one coarse grid for the rest). Built by a
coding agent with Godotwright, partly without access to the live game data. No
code, names or paths; each lesson says whether Godotwright now checks it.

## Terrain and water

17. **A narrow channel disappears in a coarse heightmap.** A 32 m wide canal on
    a 32 m grid fell between the samples and came out as a shallow dip. Carving
    the coarse grid 0.8 cell wider than the fine one fixed it.
    *Not checked;* the river archetype now lists it as a pitfall.
18. **Carve every grid that covers a place.** With fine and coarse grids over
    the same ground, a channel carved in only one of them shows up or vanishes
    with the level of detail. *Not checked;* listed as a pitfall.
19. **Lower land needs embankments, higher land a cut.** A canal checked only by
    its bed depth stood above the fields where the polder was lower than the
    water. The profile needs a bank above water level on both sides and sloping
    cuts where the ground is higher. *Not checked;* listed as a pitfall.
20. **Hand-built water faces up only with the right winding.** Godot draws
    clockwise faces as the front, so for a surface seen from above the cross
    product (b - a) x (c - a) of each triangle must point down. A test that
    builds one triangle and checks the sign caught it before any render.
    *Not checked;* the water archetype lists it.

## Networks

21. **Test the network as a graph, twice.** "Every waterway reaches every other"
    passed for water but failed for boats: low fixed bridges split routes, and
    a lock joined a canal to a river 300 m away from where the centrelines met.
    One graph for water and one for what a large boat can pass found both.
    *Not checked;* the river archetype suggests the test.
22. **A lock needs two water levels.** A lock between reaches at the same level
    is decoration; boats that steer by an offset also need to aim for the
    centre inside the chamber. *Partly checked:* `model identify` now knows the
    canal lock and the harbour basin, with their parts and pitfalls.
23. **Remove what the water covers, and rebuild the index.** Buildings, trees
    and lamps left standing in a new basin, and a spatial index that still
    pointed at removed records, were the first bugs. *Not checked.*

## Code

24. **`JSON.parse_string()` returns null on bad text.** Hundreds of scripts in
    one project stored its result straight in a `Dictionary` or `Array`
    variable, or called a method on it, so a damaged data file stops the
    script with an error instead of a clear message; a null check on the next
    line is too late. *Checked:* `review` warns
    (`quality/json-parse-unchecked`).

## Process

25. **When the live data is out of reach, test the pipeline on a made-up
    world.** A small synthetic world (a polder, a hill, one building, one road)
    exercised every step and found three bugs that would otherwise have shown
    up only on the real data. *Supported:* `scenario` and `play` do the same
    for game logic.
