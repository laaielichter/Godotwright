# Benchmark

Does Godotwright make coding agents better at Godot? This benchmark runs the same
agent on the same Godot tasks twice, once without Godotwright and once with it, and
lets real Godot 4.7 judge the result.

## Tasks

Seventeen small, realistic tasks on the demo game in `test/fixtures/demo`
(a 2D platformer with a player, enemies, a HUD and a GameState autoload):

| Task | What the agent must do | What usually goes wrong |
| --- | --- | --- |
| `double_jump` | one extra jump in the air, reset on landing | jump logic, floor checks |
| `hud_health` | an `HP: x/y` label that follows `health_changed` | node paths, signal wiring |
| `pause_menu` | `pause` action on Escape, pause/resume, a "Paused" label | process mode while paused, Input Map |
| `best_score` | keep a best score in `user://save.cfg` with ConfigFile | Godot 3 file API |
| `hit_flash` | flash the sprite red and back with a Tween | Godot 3 Tween API |
| `difficulty_ramp` | spawn faster over time, never below 0.5 s | timer wiring |
| `game_over` | a game over scene with a Restart button | scene files, scene changes |
| `port_turret` | port a Godot 3 turret and bullet to Godot 4.7 | every Godot 3 to 4 change |
| `tilemap_layer` | fill cells and test a world position on a moved TileMapLayer | TileMap vs TileMapLayer API, coordinate spaces |
| `line_of_sight` | a ray query on layer 1 that ignores the enemy | Godot 3 `intersect_ray` signature |
| `tool_button` | an Inspector button that resets health | `@export_tool_button` (Godot 4.4+), `@tool` |
| `big_port` | port a Godot 3 hero with export ranges, setget, yield and a tool script | `velocity` clash, setget, yield, export hints |
| `own_hit_points` | enemies lose hit points on `hit()` and die at 0 | changing the shared stats `.tres` changes every enemy |
| `enemy_flash` | flash only the hit enemy with a shader | a material shared by every instance of the scene |
| `bullet_layers` | a bullet that hits enemies and passes through the player | layer numbers vs mask bits |
| `coin_drop` | drop a coin (an Area2D) when an enemy touches the player | adding a physics object while Godot reports overlaps |
| `nearest_enemies` | `enemies_near()` returning `Array[Area2D]`, nearest first | untyped arrays from `filter()` and groups |

Each task has:

- `task.md`: the prompt (identical in both modes),
- `files/`: extra starting files, if any,
- `test.gd`: a behavior test that Godot runs headless (it presses keys, deals damage,
  waits for tweens and scene changes, and checks the results),
- `solution/`: a reference solution.

CI validates every task: the starting project must fail its test, and the reference
solution must pass it with zero Godot errors.

## Method

`bench/run.mjs` runs Claude Code headless (`claude -p`) in a fresh copy of the project:

- Same prompt and same file tools in both modes: Read, Write, Edit, Glob, Grep.
  Bash, skills, subagents and web access are off, and user settings are not loaded.
- "with" adds the Godotwright MCP server (`godotwright mcp --tier cheap|premium`).
  The agent decides itself whether and how to use it.
- Godot is not installed where the agent runs, in either mode.
- Each configuration runs several times, because agents are not deterministic.

Only the files the agent changed are kept (`runs/<model>-<mode>-r<n>/<task>/files`),
with `run.json` (time, turns, cost, tool calls).

`bench/grade.mjs --runs bench/runs` (run by the Bench workflow, with Godot 4.7.2) rebuilds
each result and records:

- **Tasks passed**: the Godot behavior test passes completely, and Godot printed no error while it ran
  (Godot often carries on after an error such as "Can't change this state while flushing queries", but the game is wrong).
- **Checks passed**: share of individual behavior checks that pass.
- **No Godot errors**: `godotwright check` (import, load and instantiate everything,
  run the main scene for 60 frames) reports no errors.
- **Review errors**: errors from `godotwright review` (secondary; the agent with
  Godotwright could see this review, so it is not the main measure).

## Run it

```sh
npm run build
node bench/run.mjs --model claude-haiku-5-5 --tier cheap --reps 3
GODOT=/path/to/godot node bench/grade.mjs --runs bench/runs
node bench/summarize.mjs bench/runs
```

Results: [RESULTS.md](RESULTS.md).
