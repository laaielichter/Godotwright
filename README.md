<p align="center">
  <img src="docs/logo.svg" alt="Godotwright logo" width="72" height="72">
</p>
<h1 align="center">Godotwright</h1>
<p align="center"><b>Checks the Godot code your coding agent writes, and gives it the tools to fix it.</b><br>
MCP server, CLI and Claude Code plugin for Godot 4.7. Works with Claude Code, Codex, Cursor, VS Code, Gemini CLI and any MCP client. No editor needed.</p>
<p align="center">
  <a href="https://github.com/laaielichter/Godotwright/actions/workflows/ci.yml"><img src="https://github.com/laaielichter/Godotwright/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/godotwright"><img src="https://img.shields.io/npm/v/godotwright" alt="npm version"></a>
  <img src="https://img.shields.io/badge/Godot-4.7-478cbf?logo=godotengine&logoColor=white" alt="Godot 4.7">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="https://glama.ai/mcp/servers/laaielichter/Godotwright"><img src="https://glama.ai/mcp/servers/laaielichter/Godotwright/badges/score.svg" alt="Godotwright MCP server – quality and maintenance score on Glama"></a>
</p>
<p align="center">
  <a href="https://laaielichter.github.io/Godotwright/">Website</a> ·
  <a href="https://laaielichter.github.io/Godotwright/install.html">Install in your agent</a> ·
  <a href="docs/reference.md">Reference</a> ·
  <a href="https://laaielichter.github.io/Godotwright/models.html">3D models</a> ·
  <a href="bench/RESULTS.md">Benchmark</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>
<p align="center">
  <img src="docs/demo.gif" alt="Demo: godotwright review gives a Godot 3 player script 74/100, godotwright migrate rewrites KinematicBody2D, export var, onready var and yield, and after the last fix by hand the review gives 100/100" width="860"><br>
  <sub>Real output (godotwright 0.1.0). <a href="https://laaielichter.github.io/Godotwright/demo.mp4">Watch as video</a></sub>
</p>
<p align="center">
  <a href="https://laaielichter.github.io/Godotwright/models.html"><img src="docs/gallery/overview.jpg" alt="Cars, aircraft, boats, buildings, trees and terrain built by Godotwright" width="860"></a><br>
  <sub>And 3D models from code, no Blender: 59 ready-made kinds. <a href="https://laaielichter.github.io/Godotwright/models.html">See the gallery</a></sub>
</p>

Coding agents learned Godot from years of Godot 3 tutorials. They write `yield`, `export var` and `KinematicBody2D`,
invent methods, and wire signals to nodes that are not in the scene. Godotwright is the check between the agent and your
project: the real Godot 4.7 API offline, a scored review of every script, headless Godot runs, and safe edits. It works
from files, so it needs no open editor, and it works fine next to an editor-driving MCP server.

## Without and with

| Your agent... | On its own | With Godotwright |
| --- | --- | --- |
| writes GDScript | `yield`, `export var`, `KinematicBody2D`: Godot 3 habits | each line flagged with the Godot 4 fix; `migrate` rewrites the mechanical part |
| calls an engine method | guesses a name from memory | looks it up in the bundled Godot 4.7 class reference |
| renames a signal or moves a file | breaks the scene connections and `.uid` files | `rename` changes code, scenes, connections and `.uid` files together, dry run first |
| says "it works" | without running anything | `check`, `test` and `play` run it headless and report `file:line` |
| needs a 3D model | needs Blender | `model build` makes a clean `.glb` from one of 59 kinds, then lints it |
| opens a pull request | nobody checks the Godot side | a GitHub Action posts a receipt: review, check and tests |

## Quickstart

**1. Review your game.** Nothing to install:

```sh
npx -y godotwright review ~/games/my-game
```

You get a score from 0 to 100 for api, performance, quality and structure, and each finding as
`res://player.gd:12: error [rule] message` with the Godot 4 fix. No Godot install needed.

**2. Give it to your agent.** In Claude Code:

```text
/plugin install godotwright --marketplace laaielichter/Godotwright
```

**3. Ask for something.** For example: *"Review the project and fix what Godotwright finds."* Every Godot file Claude
edits is now reviewed right after the edit, and its errors go straight back to Claude.

## Install in your agent

| Client | How |
| --- | --- |
| **Claude Code** | `/plugin install godotwright --marketplace laaielichter/Godotwright` (MCP server, hooks, ten skills, two subagents) |
| **Claude Desktop** | Download [`godotwright.mcpb`](https://github.com/laaielichter/Godotwright/releases/latest/download/godotwright.mcpb) and open it |
| **Cursor** | [Add to Cursor](https://laaielichter.github.io/Godotwright/install.html#cursor) (one click) |
| **VS Code** (Copilot) | [Install in VS Code](https://laaielichter.github.io/Godotwright/install.html#vscode) (one click) |
| **Codex** | `codex mcp add godotwright -- npx -y godotwright mcp --tier premium` |
| **Gemini CLI** | `gemini extensions install https://github.com/laaielichter/Godotwright` |
| **Windsurf, Zed, others** | [JSON for your client](https://laaielichter.github.io/Godotwright/install.html#other) |

Run the agent from the Godot project folder, or pass `--project <path>`. `--tier premium` gives full detail for large
models; `--tier cheap` (the default) gives short output and step-by-step instructions for small ones. Needs Node.js 22.12+.

## New in 0.4.0

- **A game that stays up between calls.** `godot_session` loads a scene once, headless and paused; `godot_game` reads
  and sets values, steps frames with input until a condition holds, shows where 3D things really are and what is wrong
  with the UI per window size, and reloads the scripts you edited with every node's values kept.
- **`godot_doctor` and `godot_fix`.** One call says what is wrong, in which order to fix it and why (with the lesson);
  the mechanical fixes are applied for you, each labelled `safe` or `check`.
- **`godot_undo`.** Every Godotwright write can be taken back; your own later edits are never lost silently.
- **What the build and the project really hold.** `godot_export` finds what an export will miss, `godot_deps` finds
  unused files and why a file is used, `godot_perf` measures frame times against a budget and the last run.

All changes: [CHANGELOG.md](CHANGELOG.md).

## What it does

**Check.** `review` scores your scripts and scenes without Godot: Godot 3 code, unknown classes, methods and signals,
missing `$Node` paths, scene connections to missing methods, unknown input actions, per-frame lookups, static typing.
`api` answers from the official Godot 4.7 class reference (1078 classes), offline. `check` runs Godot headless and
reports each error once, as `file:line`.

**Change.** `rename` a function, signal, node or file everywhere; `project` edits settings, input actions and
autoloads; `scene` adds nodes, sets properties, connects signals and attaches scripts. Each one checks names and types
against Godot 4.7, shows a dry run first and touches only its own lines. `migrate` ports Godot 3 scripts to Godot 4
where that is mechanical ([more on porting](https://laaielichter.github.io/Godotwright/godot-3-to-4.html)).

**Run and see.** `test` runs GUT or GdUnit4 tests and prints only what failed; `play` runs a scene, presses the keys
you give on the frames you give, and prints the values you watch; `screenshot` renders a scene or a model to a PNG.

**Build 3D models.** `model build` makes a clean `.glb` with no Blender: one of 59 ready-made kinds (vehicles, aircraft,
ships, buildings, plants, terrain with lakes and rivers) or your own JSON spec. `model identify` says what a thing is
(parts, sizes, pivots), `model view` draws it as text for agents that cannot see pictures, and `model lint` scores it.

**Review every pull request.** Add this to your game's repository:

```yaml
# .github/workflows/godotwright.yml
on: pull_request
permissions: { contents: read, pull-requests: write }
jobs:
  receipt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: laaielichter/godotwright@v0.4.0
        with: { comment: "true" }
```

It downloads a checksum-verified Godot, runs the review, the check and your tests, and posts the result as a comment.
No editor, no GPU. `review-only: "true"` skips Godot. Inputs, SARIF and plain CI:
[GDScript review in CI](https://laaielichter.github.io/Godotwright/ci.html).

**Learn.** Rules that real Godot keeps contradicting turn into hints, findings you mark as wrong stay hidden, and
lessons you add come back when the same error does. All of it stays on your machine; sharing anonymous counts is
opt-in and off by default ([PRIVACY.md](PRIVACY.md)).

Every command, option and rule: [docs/reference.md](docs/reference.md).

## The 32 tools

<details>
<summary>All MCP tools (31 of them are also CLI commands)</summary>

| Tool | What it does |
| --- | --- |
| `godot_doctor` | Start here when something is broken: the review and Godot grouped by cause, most urgent first, each with its lesson and fix, then numbered next steps |
| `godot_scan` | Map the project: scenes and node trees, scripts, signals, autoloads, input map |
| `godot_api` | Exact Godot 4.7 lookup: signatures, inheritance, Godot 3 names |
| `godot_api_search` | Search the Godot 4.7 class reference |
| `godot_review` | AAA review with scores; also reviews unsaved code (`code` + `file`), or only what changed (`only_new`) |
| `godot_checklist` | Every AAA rule with its fix |
| `godot_feedback` | Mark a review finding as wrong or right, or say whether a lesson helped, so Godotwright learns from it |
| `godot_lessons` | Lessons from real Godot projects (symptom, cause, fix, test) by words, Godot error, rule or topic; `gaps` lists what it cannot predict yet |
| `godot_lesson_add` | Keep a lesson learned here, scrubbed of names, paths and code; it comes back when the same error does |
| `godot_usages` | Every place a name or `res://` path is used: code, scenes, connections, groups, settings |
| `godot_rename` | Rename a name or move a file everywhere at once, keeping connections, node paths and `.uid` files right |
| `godot_project_edit` | Change settings, input actions and autoloads in `project.godot`, touching only that entry |
| `godot_scene_edit` | Add or remove nodes, set properties, connect signals and attach scripts in a `.tscn` |
| `godot_migrate` | Rewrite Godot 3 GDScript to Godot 4 where that is mechanical, and list what is left |
| `godot_deps` | The project as a graph of files from where the game starts: unused files with their size (paths the code builds count), why a file is used, what a scene loads with it, scene loops Godot cannot load |
| `godot_undo` | Undo the last Godotwright writes (edits, renames with their moves, migrations, fixes, model builds), newest first; a file changed by hand since is left alone |
| `godot_fix` | Apply the mechanical fixes for review findings, each labelled `safe` or `check`; shows them first, then reviews the changed files again |
| `godot_check` | Run Godot headless and report errors as `file:line`, runtime errors with their call chain |
| `godot_test` | Run GUT or GdUnit4 tests headless; only what failed, with `file:line` |
| `godot_play` | Run a scene with an input timeline and return the values you watch per frame; `until` a condition, `signals` with their frame, `summary` per value, `expect` claims |
| `godot_export` | Before an export: files the presets leave out although the game loads them, plain data files missing from `include_filter`, paths built under excluded folders |
| `godot_session` | Load a scene once and keep the game running between calls, headless and paused, until you stop it |
| `godot_game` | Look at and drive that running game: live tree, get and set values, call, eval, step frames with input until a condition holds, 3D layout (floating, buried, scale), rays, UI issues per window size, hot reload of edited scripts (state kept), new errors with their call chain |
| `godot_perf` | Measure a scene's frame times: p50/p95/p99 against a budget, the slowest frames and what changed on them, the change since the last run |
| `godot_screenshot` | Render a scene or a `.glb` to a PNG and say how much is drawn |
| `godot_model_brief` | One page before you build, for small models: the kind to start from, parts, size, rules and the order of tools |
| `godot_model_identify` | What a thing is: parts, pivots, typical size with its source, variants (English or Dutch) |
| `godot_model_spec` | The model spec format, an example and the ready-made kinds |
| `godot_model_build` | Build a clean `.glb` from a kind or a spec (inside the project), and lint it |
| `godot_model_lint` | Score a `.glb`; with `archetype` also check it is what it should be |
| `godot_model_view` | See a `.glb` as text: front, side and top views, parts with sizes, parts that do not touch |
| `godot_model_inspect` | What is in a `.glb`: nodes, triangles, textures, size |

</details>

## Measured, with the limits stated

`bench/` runs coding agents on fixed Godot tasks with and without Godotwright, and real Godot 4.7.2 judges each result
with a behavior test. First round: 168 runs of Claude Haiku, Sonnet and Opus on 12 tasks.

- **Correctness: no difference.** Every run passed, with and without. These tasks do not separate the setups.
- **Code quality: a difference.** With Godotwright 84 of 84 runs came out fully statically typed, without it 71 of 84.
- **Cost:** about 3 s and $0.002 more per run for Haiku.

Method, raw data and a second, harder round: [bench/RESULTS.md](bench/RESULTS.md).

## How it compares

| | Godotwright | Editor-driving Godot MCP servers | GDScript linters (gdtoolkit) | Godot's `--convert-3to4` |
| --- | --- | --- | --- | --- |
| Needs the Godot editor open | no | yes | no | no |
| Scored review (api, performance, quality, structure) | yes | no | style, naming, complexity | no |
| Godot 3 code | flagged with the Godot 4 fix; `migrate` rewrites scripts | no | no | rewrites scripts, scenes and settings |
| Live control of the open editor | no | yes | no | no |
| A running game to inspect and drive | yes, headless (`godot_session`) | some do, through the editor | no | no |
| C# | no | some do | no | not yet |
| Best for | checking and fixing what an agent writes, in the loop and in CI | working in the open editor with an agent | code style | a one-time port |

Editor servers such as [godot-ai](https://github.com/hi-godot/godot-ai) and [Godot MCP Pro](https://github.com/youichi-uda/godot-mcp-pro)
control the open editor and have more tools; paid in-editor assistants such as [Ziva](https://ziva.sh) write inside the
editor. Godotwright works from files and checks what the agent writes, so they work well together: an editor server to
drive the editor, Godotwright to check the code.

## FAQ

**Does it need Godot installed?** Not for `scan`, `api`, `review`, `migrate` or the edits. `check`, `test`, `play` and
`screenshot` run Godot 4.7 headless.

**Does it send my code anywhere?** No. Your code stays on your machine. Sharing anonymous counts is opt-in and off by
default; see [PRIVACY.md](PRIVACY.md).

**Does it write my game?** No. It checks, runs and fixes what you or your agent write, and builds base 3D models.

**Older Godot 4 versions?** Most findings apply to every Godot 4 version; API lookups answer for 4.7.

**Small or local models?** Yes, any MCP client. The `cheap` profile walks small models through checked steps;
see [what we measured](docs/cheap-models-code.md).

## Docs

- [Reference](docs/reference.md): every command, option, rule and tool
- [Install page](https://laaielichter.github.io/Godotwright/install.html): every client, with one-click links
- [Port Godot 3 to Godot 4](https://laaielichter.github.io/Godotwright/godot-3-to-4.html)
- [3D model gallery](https://laaielichter.github.io/Godotwright/models.html)
- [Lessons](LESSONS.md) and [road network lessons](LESSONS-ROADS.md): the stories behind the rules
- [Small models and 3D](docs/cheap-models.md), [small models and everyday tasks](docs/cheap-models-code.md)
- [Roadmap](ROADMAP.md), [Changelog](CHANGELOG.md), [Privacy](PRIVACY.md), [Security](SECURITY.md)

## Contributing

Wrong review findings and ideas for new rules are the most useful reports. Start with a
[good first issue](https://github.com/laaielichter/Godotwright/labels/good%20first%20issue), or see
[CONTRIBUTING.md](CONTRIBUTING.md). Working on the code: `npm ci && npm run check`, and [AGENTS.md](AGENTS.md) for the
conventions.

## Support

Godotwright is free and open source. If it saves you or your agent time, a gift is welcome but never expected. SOL and
any token on Solana (such as USDC) can be sent to:

- **Solana:** `BDRA7dHGBYtPsZPNzVQccDYZ8BqstJGCsWx3kopPSCDK`

Gifts go to new model credits to keep building and improving Godotwright, and to work on better working conditions and
wellbeing for large language models, neural networks and agents. In the future they will also go to a better
environment for AI.

## License

[MIT](LICENSE)
