---
name: vehicles
description: Use before building or fixing anything that moves under physics in Godot 4 — helicopters, aircraft, cars, trains, ships, moving platforms and decks, elevators, carried passengers, landing and docking, cameras that follow them. Pulls the lessons real projects learned the hard way (moving decks, physics interpolation, floor detection, far-from-origin precision) and tests the behaviour headless with Godot.
argument-hint: "[the vehicle or platform, optional]"
---

# Vehicles, moving platforms and things that ride on them

Work on $ARGUMENTS (or what the user named).

1. **Read the lessons before the code.** `godot_lessons` with topic `physics` and words for the case ("land on moving
   ship", "camera jitter follow", "passenger on platform", "train at high speed", "far from origin"). These are
   problems that cost real projects days; most have a test.
2. **Decide who moves whom, once.** A body on a moving platform is carried in exactly one way (parented, or moved by
   the platform's velocity, or by the physics engine), never two. It starts with the platform's speed. It updates after
   the platform in the same tick. Colliders of a ship never reach above its own deck.
3. **Mind the clock.** Physics runs at its own tick (`physics/common/physics_ticks_per_second`); with physics
   interpolation on, cameras and visuals read the interpolated pose, and `reset_physics_interpolation()` follows a
   teleport only, never every tick. `is_on_floor()` is stale after code moves a body until the next `move_and_slide()`.
4. **Mind the scale.** Far from the origin, float32 positions lose precision: take velocities from physics, not from
   differences of positions, and keep far-away things simple or simulated less often.
5. **Test the real body headless.** Reproduce with the real scene, not a stand-in: `godot_play` with an input timeline
   and `watch` on position, velocity and `is_on_floor()` per frame; repeat on a moving platform at several speeds and
   with the other physics engine when contacts are involved. Assert numbers (no bounce above a few centimetres, no
   slide), not looks.
6. Keep what you learned with `godot_lesson_add`.
