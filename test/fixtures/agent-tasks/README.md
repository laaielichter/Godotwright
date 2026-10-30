# Agent tasks

A small 2D platformer used to measure how well a small model does everyday Godot work with Godotwright. The measurement
and its results are in [docs/cheap-models-code.md](../../../docs/cheap-models-code.md).

- `tasks.json` holds the six tasks, word for word as the agents got them.
- `test/test_hero.gd` is a GUT test that fails on purpose: task 4 is to find the bug in `hero.gd`.
- The GUT addon is not included. Copy `addons/gut` from [GUT](https://github.com/bitwes/Gut) 9.7.1 into this folder
  before a run.

Grade a finished copy with real Godot:

```
GODOT=/path/to/godot node scripts/grade-agent-tasks.mjs <task 1-6> <copy of this folder>
```
