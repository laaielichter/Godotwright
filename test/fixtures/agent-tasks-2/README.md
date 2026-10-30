# Agent tasks, round 2

The harder second set of the small-model measurement in [docs/cheap-models-code.md](../../../docs/cheap-models-code.md).
The same small platformer as [agent-tasks](../agent-tasks), with a `hurt` action, a `health_changed(hp)` signal, a
`heal` function and a HUD label; `tasks.json` holds the six multi-step tasks, word for word.

- Task 2 starts from [agent-tasks-2-bugs](../agent-tasks-2-bugs) (three bugs in the game, four GUT tests). Every other
  task starts from this folder.
- The GUT addon is not included. Copy `addons/gut` from [GUT](https://github.com/bitwes/Gut) 9.7.1 into the copy.

```
GODOT=/path/to/godot node scripts/grade-agent-tasks-2.mjs <task 1-6> <copy>
```
