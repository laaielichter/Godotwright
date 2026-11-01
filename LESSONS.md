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
