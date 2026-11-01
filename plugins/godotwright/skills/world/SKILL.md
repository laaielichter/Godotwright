---
name: world
description: Use when building or fixing a large Godot world — terrain and heightmaps, streaming and chunks, levels of detail and visibility ranges, roads, railways, waterways and their networks, towns, vegetation, water, sky and weather — or when a big world stutters while moving, shows holes or pop-in, or loses precision far from the origin. Brings in the lessons real open-world projects learned and checks them with tests.
argument-hint: "[what part of the world, optional]"
---

# Large worlds

Work on $ARGUMENTS (or what the user named).

1. **Read the lessons first.** `godot_lessons` with topic `world`, `rendering` or `performance` and words for the case
   ("visibility range holes", "terrain streaks at tile edge", "canal disappears in heightmap", "road graph connected",
   "stutter while flying"). `godot_model_identify` knows roads, bridges, railway, locks, harbours, terrain and water.
2. **Plan data before meshes.** Take shapes from real data where possible; keep one graph per network (roads, rail,
   water) and test it as a graph for what really moves on it (a boat needs clearance, a train a gradient), not only for
   connectivity.
3. **Every grid that covers a place must agree.** Carve terrain under roads and water in every heightmap and every
   level of detail; carve wider than the grid cell, and blend the edges.
4. **Streaming without hitches.** Build, load and free chunks over several frames; load in the background; keep chunks
   small enough that their visibility range (measured from the chunk's centre) works; use `visibility_range_fade_mode`
   with margins; MultiMesh for many repeated objects.
5. **Precision.** Past a few kilometres from the origin, float32 rounding shows in physics and in velocities computed
   from positions. Keep the active area near the origin or derive motion from physics.
6. **Test with numbers.** A headless script that walks the network graph, measures terrain against roads every few
   metres, and counts frame times on a fixed flight path. When the live data is out of reach, run the pipeline on a
   small synthetic world first.
