# Benchmark results

168 agent runs: 3 Claude models, 12 tasks, each run with and without Godotwright.
Every result was judged by real Godot 4.7.2 in CI (Bench workflow): a behavior test per
task, plus `godotwright check` for engine errors. Method: [README.md](README.md).
Raw data: `runs/*/*/run.json` (what the agent did) and `runs/grades.json` (the grades from
Bench workflow run 7 on commit `0b0ed36`; every run passed with zero Godot errors).

## Summary

- **Correctness: no difference.** Every run passed its Godot behavior test, with and
  without Godotwright, with zero Godot errors. Claude Haiku, Sonnet and Opus 5.5 already
  solve these twelve tasks on their own, including the Godot 3 ports and the Godot 4.4+
  APIs (`@export_tool_button`, `TileMapLayer`, ray queries).
- **Code quality: Godotwright helps.** With Godotwright, all 84 runs produced fully
  statically typed GDScript. Without it, 13 of 84 runs left untyped code, all of them in
  the Godot 3 ports, where models keep the old untyped style.
  This came from the server's instructions ("Use static types"), even for models that
  never called a tool.
- **Tool use depends on the profile.** With the `cheap` profile (step-by-step
  instructions), Haiku called Godotwright 2.4 times per run, mostly `godot_review`.
  With the `premium` profile (descriptive instructions), Sonnet and Opus never called a tool.
- **Overhead is small.** Haiku took 15 s instead of 12 s per run and about $0.002 more.

## Correctness

| Model | Godotwright | Runs | Tasks passed | Checks passed | No Godot errors | Godot errors / run | Review errors / run | Godotwright calls / run | Time / run | Cost / run |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| claude-haiku-5-5 | yes | 36 | 100% | 100% | 100% | 0.00 | 0.00 | 2.4 | 15 s | $0.005 |
| claude-haiku-5-5 | no | 36 | 100% | 100% | 100% | 0.00 | 0.00 | 0.0 | 12 s | $0.003 |
| claude-opus-5-5 | yes | 12 | 100% | 100% | 100% | 0.00 | 0.00 | 0.0 | 16 s | $0.086 |
| claude-opus-5-5 | no | 12 | 100% | 100% | 100% | 0.00 | 0.00 | 0.0 | 16 s | $0.221 |
| claude-sonnet-5-5 | yes | 36 | 100% | 100% | 100% | 0.00 | 0.00 | 0.0 | 10 s | $0.037 |
| claude-sonnet-5-5 | no | 36 | 100% | 100% | 100% | 0.00 | 0.00 | 0.0 | 10 s | $0.059 |

Per task (passed / runs):

| Model | Godotwright | best_score | big_port | difficulty_ramp | double_jump | game_over | hit_flash | hud_health | line_of_sight | pause_menu | port_turret | tilemap_layer | tool_button |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| claude-haiku-5-5 | yes | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| claude-haiku-5-5 | no | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| claude-opus-5-5 | yes | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| claude-opus-5-5 | no | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| claude-sonnet-5-5 | yes | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| claude-sonnet-5-5 | no | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

## Code quality

Static typing in the final projects (`godotwright review`):

| Model | Godotwright | Declarations typed | Runs fully typed | Quality score |
| --- | --- | ---: | ---: | ---: |
| claude-haiku-5-5 | yes | 100.0% | 36/36 | 100.0 |
| claude-haiku-5-5 | no | 95.3% | 30/36 | 98.4 |
| claude-sonnet-5-5 | yes | 100.0% | 36/36 | 100.0 |
| claude-sonnet-5-5 | no | 96.5% | 31/36 | 98.8 |
| claude-opus-5-5 | yes | 100.0% | 12/12 | 100.0 |
| claude-opus-5-5 | no | 96.2% | 10/12 | 98.8 |

In the two Godot 3 ports (`big_port`, `port_turret`), runs without Godotwright left
untyped declarations in 13 of 14 cases; runs with Godotwright did so in 0 of 14.

## What this does and does not show

- The tasks are too easy to separate the setups on correctness: every setup scored 100%.
  This benchmark cannot show that Godotwright makes these models more *correct*.
  It shows that it does not make them worse, and that it makes their code cleaner.
- Only Claude models were tested, on a small 2D project, without Godot available to the
  agent. Cheaper or older models, other agents, larger projects and multi-step features
  are where API lookups, scans and reviews should matter more. That is the next round.
- Cost per run is not a fair comparison between modes: runs without Godotwright ran first,
  and later runs were cheaper because of prompt caching. Only the Haiku time difference
  (+3 s, with 2.4 tool calls) reflects Godotwright itself.
- Review errors are 0 everywhere, so the review gives no hidden advantage in the grades.

## Also measured: the review on real projects

On the official Godot demo projects (pinned commit `b761b4c`), which all load and run
without errors in Godot 4.7.2, `godotwright review` still finds real bugs that only show
up when a code path runs, for example:

- `2d/finite_state_machine`: `$States/Stagger` and `$Health` do not exist in `Player.tscn`
  (the node is `StateMachine/Stagger`), so taking damage fails with a script error.
- `xr/openxr_hand_tracking_demo`: `pickup_handler.tscn` connects `body_entered` and
  `body_exited` to methods that `PickupHandler3D` does not have.
- `3d/material_testers`: a scene connection to `_on_use_reflection_probes_toggled()`,
  which `tester.gd` does not define.
- `xr/openxr_origin_centric_movement`: `get_gravity()` is called on an `XROrigin3D`,
  which has no such method.

## Round 2: five harder tasks

Five tasks built around Godot mistakes that only show when the game runs: a shared stats resource, a material shared
by every instance of a scene, physics layers versus mask bits, adding a physics object while Godot reports overlaps,
and typed arrays. Before any agent ran, a deliberately naive solution of each task was graded: all five failed, and
every reference solution passed with zero Godot errors. From this round on, an engine error printed while the test
runs also fails a task.

50 runs of Claude Haiku 5.5 (`cheap` profile), 5 per task with and 5 without Godotwright, graded with Godot 4.7.2
(raw data in `runs-hard/`):

| Godotwright | Runs | Tasks passed | Godotwright calls / run | Time / run | Cost / run |
| --- | ---: | ---: | ---: | ---: | ---: |
| yes | 25 | 24 (96%) | 0.8 | 15 s | $0.005 |
| no | 25 | 24 (96%) | 0.0 | 12 s | $0.005 |

- **Still no difference in correctness.** Each group failed one run, on a different task.
- **Both failures were mistakes the review could have named, and did not.** With Godotwright, one run added the coin
  in the `body_entered` handler, and Godot printed "Can't change this state while flushing queries". Without it, one
  run tweened `set_shader_parameter.bind("amount")`, which calls the setter with its arguments the wrong way round.
  The agent with Godotwright had run the review and got no warning. Two review rules now catch both
  (`api/physics-change-in-callback`, `api/bind-swaps-arguments`), with no findings on the demo projects or on the runs
  that passed.
- **Haiku solves 96% of even these tasks.** A benchmark that separates the groups needs tasks that take many steps, or
  models weaker than Haiku.

## Next round

1. Harder tasks: multi-scene features, larger projects, and engine areas with less
   training data (navigation, animation trees, shaders, multiplayer).
2. More models: cheap open-weight models and other agents (Codex), where gaps are larger.
3. A premium profile that gets premium models to use the tools, then measure if it matters.
4. Randomized run order, so cost can be compared too.
