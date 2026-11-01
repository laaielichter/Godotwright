---
name: model
description: Use when making, improving or checking a 3D model for Godot (.glb or .gltf) — a vehicle, aircraft, ship, building, prop, plant, creature, terrain or road piece — or when a model looks wrong in Godot (wrong size, faces missing, parts floating, a rotor turning about the wrong point, black glass). Builds it from code with Godotwright, looks at it as text and pictures, and lints it against what the thing really is.
argument-hint: "[what to build or check, optional]"
---

# Build or check a 3D model with Godotwright

Godot conventions: a model faces +Z, +Y is up, units are metres, the origin sits where the model touches the ground.

1. **Know the thing first.** `godot_model_brief` with its name (English or Dutch) gives one page: what it is, the
   nearest ready-made kind, the parts that must exist and how they move, a typical size with its source, and the
   mistakes real builds made (`godot_lessons` with topic `models` has more). Find real dimensions before modelling;
   a published overall size can be for another version.
2. **Start from a kind or a spec.** `godot_model_spec` shows the spec (named parts: box, cylinder, ellipsoid, lathe,
   loft, extrude, roof, tube; mirror, repeat, bevels, textured materials). Put every moving part's pivot at its hub or
   hinge. Keep one source of truth for the layout: parts read positions from it, they do not copy numbers.
3. **Build:** `godot_model_build` with the kind or the spec and the `archetype`.
4. **Look at it.** `godot_model_view` draws front, side and top views as letters and lists parts that do not touch the
   rest. Use it after every build. With Godot installed, `godot_screenshot` renders the .glb from several sides;
   compare the silhouette with a reference in the same pose.
5. **Lint against the archetype:** `godot_model_lint` with `archetype` checks parts, pivots, wheel axes, size and
   direction, glass that light cannot pass, names Godot changes on import, and the triangle budget. Fix every error.
6. **Heavy models need levels of detail** that are much lighter than the level before; things scripts move need stable
   node names (a contract), and moving parts must turn the right way, not only about the right point.

End with the lint score, the views you checked, and the size against the reference.
