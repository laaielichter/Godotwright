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

## Round 2: harder, multi-step tasks

Round 1 was too easy, so a second set was made ([test/fixtures/agent-tasks-2](../test/fixtures/agent-tasks-2), tasks in
[tasks.json](../test/fixtures/agent-tasks-2/tasks.json)), run on the tool version that includes the five fixes above:

1. An enemy: a new scene, an instance in `main.tscn`, patrol between two x values at a set speed, and 1 damage to the hero on touch.
2. Three bugs behind failing GUT tests (in code and in a scene connection), without changing the tests.
3. Rename a function and a scene node everywhere (code, scene, connection), so the game and the tests still work.
4. A pause menu on Escape: new input action, hero stops, menu shows, Escape again resumes.
5. Five project settings (window size, stretch mode, vsync, frame cap).
6. A `ProgressBar` under the HUD that follows the hero's health.

Same set-up as round 1: twelve Haiku agents (A: older commands and hand edits, B: every command), Godot 4.7.2, graded
with real Godot by [scripts/grade-agent-tasks-2.mjs](../scripts/grade-agent-tasks-2.mjs). That grader measures
behaviour (patrol range and hero health over a `play` timeline, the pause timeline, the bar's value per frame), and the
untouched project fails every task.

| Task | A: older commands | B: every command |
|---|---|---|
| 1 enemy | pass, 11 calls | pass, 5 |
| 2 three bugs | pass, 2 | pass, 5 |
| 3 renames | pass, 3 | pass, 5 |
| 4 pause menu | pass, 6 | pass, 5 |
| 5 settings | pass, 8 | pass, 6 |
| 6 health bar | pass, 6 | pass, 4 |

- **Again 12 of 12 passed.** Even these tasks did not separate the groups on success. The honest reading is that for
  Haiku on a project this small, the tasks are still within reach with plain file edits.
- **Calls: B used fewer on four of six tasks, A fewer on two** (bugs, renames), where reading the files and editing
  by hand was enough. A's total was 36 calls, B's 30. With one run per cell, that is a hint, not a result.
- **How they checked differed again.** On the enemy and the pause menu the A agents wrote throwaway Godot scripts to
  test their work (one hit a `SceneTree` signature error doing so); the B agents used `play` with an input timeline.
  One B agent first handled Escape in `_unhandled_input`, saw in `play` that nothing happened, and fixed it.
- **The renames used `rename` in group B** (task 3); the A agent edited the three files by hand, in fewer calls.

### Small things the agents ran into

- `review` and `api` did not accept `--godot` while the instructions said commands that run Godot take it; `project set`
  has the same issue. (An unknown option is a fair error, but the agents lost a call each.)
- `api` for a property name such as `max_fps` cut the description in the brief view and did not point to the matching
  project setting.
- GUT output contains colour codes when it is run by hand.

These are listed, not yet changed.

## Run it again

Copy `test/fixtures/agent-tasks` once per agent, add `addons/gut` from GUT 9.7.1, give each agent one task from
`tasks.json` with the tool list of its group, and grade each copy:

```
npm run build
GODOT=/path/to/godot node scripts/grade-agent-tasks.mjs 3 /path/to/copy
```

Round 2 works the same way with `test/fixtures/agent-tasks-2` and `scripts/grade-agent-tasks-2.mjs`.
