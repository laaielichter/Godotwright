---
name: perf
description: Use when a Godot game stutters, hitches, loads slowly, has low or uneven fps, uses too much memory or video memory, or when asked to optimise a Godot project. Measures first, finds the cause with Godotwright's performance review and lessons from real projects, fixes one thing at a time and measures again. Also in Dutch: "het hapert", "haperingen", "laadtijd te lang", "lage fps", "sneller maken", "te veel videogeheugen", "optimaliseren".
argument-hint: "[what is slow, optional]"
---

# Make a Godot game faster, measured

Work on $ARGUMENTS (or what the user named). Never optimise without a number before and after.

1. **Measure first, the right way.** `godot_perf` on the scene (with `input` for what happens in it) gives frame-time
   percentiles against a budget, the slowest frames and what changed on them, and keeps a baseline. Agree on one
   repeatable case (a scene, a start position, a camera path, a time).
   Read frame time, not fps: the worst frames (99th percentile, the longest frame) show a stutter that an average
   hides. Measure an exported build or the export template when you can; editor and debug builds are slower in other
   places. Alternate A and B runs in blocks, so warm caches and heat do not decide the result.
2. **Ask what real projects learned.** `godot_lessons` with topic `performance` and the symptom ("stutter when a model
   loads", "hitch on first explosion", "slow start"). Typical causes: a glTF parsed on the main thread, shaders
   compiled on first use, many nodes made in one frame, textures read back from the GPU, physics ticks catching up,
   heavy `_process` work on things far away.
3. **Let the review point.** `godot_review` and read the `performance` category: per-frame allocations, node lookups
   in `_process`, `get_image()` in loops, runtime glTF without mipmaps, small lights with cube shadows.
4. **One change at a time,** each behind a switch you can turn off, so a change that does not help can be proven
   useless and removed. Spread work over frames instead of doing it in one; pool what is made and freed often; load
   in the background with `ResourceLoader.load_threaded_request()`; warm shaders with the same settings as the real view.
5. **Measure again** with `godot_perf`, the same case and the same method: it shows the change since the last run. Keep the change only when the numbers say so; say how
   much it helped (worst frame, average, load time, memory).
6. Keep lessons with `godot_lesson_add` when a cause was hard to find.

End with a table: change, before, after, kept or dropped.
