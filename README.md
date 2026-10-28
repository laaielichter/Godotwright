# Godotwright

AAA coding toolkit for **Godot 4**. It makes any coding agent (Claude, Codex and
others) better at building Godot games.

> Layer 1 (toolkit and MCP server) is done; see [ROADMAP.md](ROADMAP.md).
> Not on npm yet.

## Usage

```sh
godotwright scan [path]               # compact project map, cheap to read
godotwright scan [path] --detail full # node trees, signatures, line numbers
godotwright scan [path] --json        # the full map as JSON
godotwright check [path]              # run Godot headless, report errors as file:line
godotwright check [path] --run        # also run the main scene for 120 frames
godotwright api Node2D.look_at        # offline Godot 4.7 API: classes, methods, signals
godotwright api --search "is on floor"
godotwright review [path]             # AAA review with a score per category
godotwright review [path] --detail full --min-score 90
godotwright learn                     # what Godotwright learned on this machine
```

`scan` reads `project.godot`, scenes, resources and scripts without starting Godot.
It lists scenes with their node trees, scripts with signals, functions and exports,
autoloads, input actions and key settings, and warns about broken references
(missing files, a missing main scene or autoload, bad `preload()` paths).

`check` needs Godot 4.7 (`--godot <path>`, `$GODOT`, or `godot` on your PATH). It imports
the project, loads and instantiates every script and scene, and can run the main scene.
Each problem comes back once, as `res://path/file.gd:12: error: ...`.
The exit code is 1 when there are errors.

`api` answers from the official Godot 4.7 class reference, bundled offline
(1078 classes). It accepts `Class`, `Class.member`, `Class.Enum.VALUE`, `@annotation`
or a global function, follows inheritance, and explains Godot 3 names
(`KinematicBody2D` is `CharacterBody2D` in Godot 4). See [data/README.md](data/README.md).

`review` needs no Godot install. It scores four categories from 0 to 100 and lists
each finding as `res://file.gd:12: error [rule] message`:

| Category | What it checks |
| --- | --- |
| api | Godot 3 code, unknown classes, functions, members and signals, wrong argument counts, input actions missing from the Input Map |
| performance | node lookups, `load()`, prints and physics calls in per-frame callbacks, empty callbacks, shadow-casting lights |
| quality | static typing coverage, long or deeply nested functions, signals never emitted, string-based signals, naming, TODOs |
| structure | broken references, scene connections to missing methods or signals, `$Node` paths missing from the scene, unknown groups, file naming |

The checks follow Godot's own rules (inheritance, scripts on more specific nodes,
inherited scenes, built-in scripts, duck typing with `has_method()`), and are tuned
on the official demo projects so they report real problems, not noise.
The exit code is 1 when there are errors, or when the score is below `--min-score`.

## Use with coding agents (MCP)

`godotwright mcp` runs an MCP server over stdio with seven tools:

| Tool | What it does |
| --- | --- |
| `godot_scan` | Map the project: scenes and node trees, scripts, signals, autoloads, input map |
| `godot_api` | Exact Godot 4.7 lookup: signatures, inheritance, Godot 3 names |
| `godot_api_search` | Search the Godot 4.7 class reference |
| `godot_review` | AAA review with scores; also reviews unsaved code (`code` + `file`) |
| `godot_check` | Run Godot headless and report errors as file:line |
| `godot_checklist` | Every AAA rule with its fix |
| `godot_feedback` | Mark a review finding as wrong or right, so later reviews learn from it |

Pick a profile with `--tier`:

- `cheap` (default): short output, and server instructions that walk the model
  through small checked steps (scan, look up, review before saving, review after each edit).
- `premium`: full detail, all findings with fixes.

**Claude Code**

```sh
claude mcp add godotwright -- npx -y godotwright mcp --tier premium
```

**Codex**

```sh
codex mcp add godotwright -- npx -y godotwright mcp --tier premium
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.godotwright]
command = "npx"
args = ["-y", "godotwright", "mcp", "--tier", "premium"]
```

Run the agent from the Godot project folder (or pass `--project <path>`).
Until the npm release, use `node /path/to/godotwright/dist/cli.js mcp` as the command.
CI connects both Claude Code and Codex to the server on every push.

## Learning

Godotwright learns from every use, on your machine:

- **Rules Godot keeps contradicting.** After each `check`, it compares the review with
  what real Godot reported. When an error rule is contradicted 3 times here and never
  confirmed, its findings become warnings, marked as hints.
- **False alarms.** `godotwright learn feedback wrong "<finding line>"` (or the
  `godot_feedback` MCP tool) hides that finding in later reviews.
- **API lookups.** When a lookup finds nothing and the next one does, the next failed
  lookup of the same name says what it usually means.

Nothing leaves your machine unless you say yes. The learning file (`godotwright learn` shows where) holds
counters, rule names, API names and message templates without names or paths; findings
marked as wrong are stored as hashes.

```sh
godotwright learn          # status: what was learned, where the file is
godotwright learn off      # stop learning (or set GODOTWRIGHT_LEARN=0)
godotwright learn on
godotwright learn reset    # forget everything
godotwright learn preview  # the exact report sharing would send
godotwright learn share on # opt in: send anonymous counts once a day
```

Sharing helps every user: what many installs learn ships with later releases.
It is off by default, sends no code, file names, paths or project names, and
respects `DO_NOT_TRACK`. See [PRIVACY.md](PRIVACY.md).
Set `GODOTWRIGHT_HOME` to keep the file somewhere else.

What many installs learned ships in `data/learned.json` (built by the collector,
see below): API hints for common typos, and rules Godot keeps contradicting.
What your own machine saw wins: one confirmation by Godot keeps a rule an error.

For maintainers, `godotwright collector serve` accepts reports (checked again,
stored without IP addresses), and `godotwright collector aggregate <dir> --out
data/learned.json` sums them, keeping only what at least 3 installs reported.

## Benchmark

`bench/` runs coding agents on fixed Godot tasks with and without Godotwright, and lets
real Godot 4.7.2 judge the result with a behavior test per task.
First round (168 runs, Claude Haiku, Sonnet and Opus 5.5, 12 tasks): every run passed,
with and without Godotwright, so these tasks do not separate the setups on correctness.
With Godotwright, all code came out fully statically typed (84 of 84 runs, against
71 of 84 without). Details and limits: [bench/RESULTS.md](bench/RESULTS.md).

## Requirements

- Node.js 22.12 or newer
- Target engine: Godot 4.7.x

## Development

```sh
npm ci
npm run check
node dist/cli.js --help
```

See [AGENTS.md](AGENTS.md) for project conventions.

## License

[MIT](LICENSE)
