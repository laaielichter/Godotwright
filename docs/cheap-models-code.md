# Everyday Godot tasks with a small, cheap model

Does a small model (Haiku and the like) get everyday Godot work done more often with Godotwright's newer commands
(`project`, `scene`, `test`, `play`, `rename`, `usages`, `screenshot`) than with just editing files and the older ones
(`review`, `check`, `api`, `scan`)? This page records a small test, what it showed, and what changed because of it.
[cheap-models.md](cheap-models.md) is the same kind of test for 3D models.

## The test

A small 2D platformer ([test/fixtures/agent-tasks](../test/fixtures/agent-tasks)): a hero that walks and jumps, a HUD,
a `health_changed` signal connected in code and in the scene, and two GUT tests, one of which fails on purpose. Six
tasks, word for word in [tasks.json](../test/fixtures/agent-tasks/tasks.json):

1. Add an input action `dash` on the Shift key and joypad button B.
2. Add a Timer `SpawnTimer` (2 s, autostart) to the main scene and connect its `timeout` to a new method that prints `spawn`.
3. Make the hero jump at least 30% higher, and still land on the floor.
4. Fix the bug behind the failing GUT test without changing the test.
5. Rename the signal `health_changed` to `hp_changed` everywhere.
6. Add an autoload `Score` and make the hero score a point per jump.

Twelve Haiku agents each got one task on their own copy of the project, with Godot 4.7.2 and at most 16 tool calls:

- **A** (six agents): edit files by hand, plus `review`, `check`, `api` and `scan`.
- **B** (six agents): every Godotwright command.

Afterwards every copy was graded with real Godot by
[scripts/grade-agent-tasks.mjs](../scripts/grade-agent-tasks.mjs), not by the agent's own word. The grader checks the
result itself: the input map read back from `project.godot`, the scene's nodes and connections and a `spawn` print
while the game runs, the jump height measured with `play`, the GUT result with the test file unchanged, every use of
both signal names, and `Score.points` after one jump. Before the run the grader was checked both ways: the untouched
project fails every task, and a hand-made solution passes every task.

This is one run per task of one model on one tool version: an indication, not a benchmark.

## What came out

| Task | A: older commands | B: every command |
|---|---|---|
| 1 `dash` action | pass, 4 calls | pass, 6 calls |
| 2 SpawnTimer | pass, 8 | pass, 8 |
| 3 higher jump | pass, 7 | pass, 7 |
| 4 failing test | pass, 6 | pass, 4 |
| 5 rename signal | pass, 4 | pass, 6 |
| 6 Score autoload | pass, 7 | pass, 8 |

(Calls are the tool calls the agent made, as counted by the harness.)

- **Every task passed in both groups.** On tasks this size the newer commands did not change whether a small model
  succeeds. The tasks were too easy to show a difference; a harder, multi-step set is needed for that.
- **What differed was how the agents checked their work.** For the jump and the autoload, the A agents wrote their own
  Godot scripts to measure the result, and both first hit a Godot error doing so (a `SceneTree` method with the wrong
  return type; an autoload that is not visible by name in a `-s` script). The B agents measured the same things with
  `play` in one call.
- **The B agents did not use every new command.** One added the timer by editing the scene file by hand instead of with
  `scene`, one ran GUT directly instead of `test`. A short instruction does not make a small model reach for a tool it
  has not seen used.

## What got in their way, and what changed

The agents' logs named five problems in Godotwright itself. All five are fixed (pull request #67):

1. **`check` reported an error in the GUT addon's own scene** (11 of 12 agents saw it and had to work out it was not
   theirs). `check` now skips `res://addons/` unless `--include-addons` is given, as `review` already did.
2. **`check --run` ran frames as fast as a headless Godot can**, so 240 frames were a fraction of a second and a 2 s
   timer never fired; one agent concluded its timer did not work. Runs now use a fixed frame rate (the project's physics
   rate) and say how much game time the frames were.
3. **`review` called GUT test scripts unused.** Test scripts are now recognised.
4. **`review` counted the addon's 23 scenes**, and named files could not narrow the findings. It now counts the
   project's own scenes, and `review a.gd b.gd` shows only those files' findings.
5. **`play --watch Score.points` did not find an autoload by name.** It does now.

## Run it again

Copy `test/fixtures/agent-tasks` once per agent, add `addons/gut` from GUT 9.7.1, give each agent one task from
`tasks.json` with the tool list of its group, and grade each copy:

```
npm run build
GODOT=/path/to/godot node scripts/grade-agent-tasks.mjs 3 /path/to/copy
```
