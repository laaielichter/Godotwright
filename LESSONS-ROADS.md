# Lessons from building a road network with Godotwright

An anonymised reflection on one long build: a coding agent extended the road network of a large open-world
Godot 4.7 game with a generator. The generator added missing links between towns, bridges, roundabouts, viaducts
over motorways and railways, a ring road and guard rails, and the game installed the result. Like
[LESSONS.md](LESSONS.md), this holds no code, no project names and no paths, only what to do differently next time.
Each lesson says whether Godotwright now checks it.

## The network

1. **A connectivity percentage hides the places that matter.** The road graph was 99.97 % strongly connected, and
   still three villages could not be reached from their neighbours. Measure every pair of neighbouring places
   (route length against the straight line), not only a percentage. *Not checked.*
2. **Scenery and routing can disagree.** A village had streets in the scenery data, but they were missing from the
   routing graph, so it looked unreachable. Bring the two together before you add new roads. *Not checked.*
3. **Gate on "never worse" when you build on live data.** An absolute target ("no unreachable pairs") blocked a whole
   install because of one place behind a railway. Better: everything that was reachable stays reachable, no new
   unreachable pairs, and the report names what is left. *Not checked.*
4. **Small repairs need the same checks as the final check.** Hundreds of short gap fillers passed their own test
   but failed the final one: some touched a mast, some ran past water whose terrain cells may not be lowered, so
   the terrain stayed 0.1 to 0.3 m above the new road. Run the final rules on every repair before you change the
   graph, and skip the repair when it fails. *Not checked.*
5. **Show every failing line.** The installer printed only the last part of the check, and the failing lines fell
   off the screen. Print every FAIL line and keep the full log in a file. *Not checked.*
6. **Plan every part of a change before you build any of it.** A ring road needs a new piece at both of its open
   ends. Building the first end before knowing the second would fit can leave half a change. Plan both dry, then
   build. If only one fits, decide on purpose (here: build that side, so the city still gets a new crossing, and say
   so). *Not checked.*
7. **Automate only the changes the owner approved.** Detection misfired: a ring that was closed by a drawbridge of a
   different road type looked open, and the generator wanted to speed up 11 km of city streets. Keep a list of
   approved changes; report everything else. *Not checked.*

## Geometry

8. **A measured curve is smaller than the curve you drew.** A fillet of radius R, sampled every few metres,
   measured 1 to 2 % below R. With a check at 0.9 R, a fillet at exactly 0.9 R never passed; design at 0.92 R.
   *Not checked.*
9. **An approach that points away from the target makes a hairpin.** When the side towards the other town was
   blocked by buildings, the approach was turned to the far side and the road had to turn back with a 40 m
   bend. Never let an approach point more than about 100 degrees away from where it is going. *Not checked.*
10. **Shallow crossings are the most common reason a link fails.** Report the road and the place with the reason
    (for example "crossing at 22 degrees with the dike road at x, z"); without that, every failure looks the same.
    *Not checked.*

## Bridges, viaducts and clearance

11. **Check the clearance over every road a bridge passes, not only over the water.** A bridge ramp went "over" a
    dike road 1.6 m above it, because the deck test only compared the road with the terrain. Either at least about
    4.6 m clear (plus the deck), or a normal junction at the level of that road. *Not checked.*
12. **Clearances come from the thing below.** Motorway about 4.7 m. Shipping depends on the waterway class. Under
    electrified railways, the overhead line portals rose about 8 m above the rail, so the underside of the deck
    went 8.3 m above the rail plus a margin. Keep piers clear of motorway lanes and away from the track (about
    9 m from its centre line). *Not checked;* the `bridge` recipe and archetype give the shape, not the clearance.
13. **Another system's geometry may only exist at runtime.** The railway heights were computed by the game when it
    loaded, not stored anywhere. The generator recomputed them the same way, with a margin. It refused to cross
    where it could not be sure: near stations, in raised sections, at junctions, near water and at buffer stops.
    Say in the report that the height is estimated, and look at the first crossing in the game. *Not checked.*

## Terrain

14. **Bilinear terrain lifts the road edge between cells.** On a coarse grid (8 to 32 m), a cell next to the road
    can stay high and lift the interpolated surface above the road. Lower the corner cells of every sample along the
    road, and check the result from the centre to 80 % of the half width. Cells you may not change (water, rail) make
    this impossible, so test that before you build. *Not checked.*

## Godot at runtime

15. **Thousands of roadside objects need MultiMesh.** Signs, posts and delineators: one MultiMesh per kind and per
    tile, with a visibility range. Text (street names, speed numbers) only near the camera: Label3D within a few
    hundred metres, or a distance-field shader. *Partly checked:* the new `traffic-sign`, `guard-rail` and
    `delineator` archetypes say so in their pitfalls.
16. **Guard-rail collision needs overlapping boxes.** Boxes that only touch let a fast car slip through the seam.
    Overlap them by a few decimetres, and taper the ends down to the ground. *Partly checked:* the `guard-rail`
    archetype pitfalls.
17. **Do placement in a worker thread.** Walking a 40,000-edge graph to place signs took seconds. A worker thread
    builds the transforms, and the main thread only adds the nodes. *Not checked.*
18. **Route planning on a large graph is cheap when the graph is right.** A* over about 24,000 nodes planned in
    about 9 ms (median), so a GPS can replan whenever the driver leaves the route. The hard part was the graph, not
    the search. *Not checked.*
