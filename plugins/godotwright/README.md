# Godotwright for Claude Code

Godotwright makes Claude Code better at Godot 4. It gives Claude the official Godot 4.7 class reference offline, a map
of your project, an AAA review of GDScript with Godot 3 to 4 fixes, safe edits to scenes and project settings, headless
checks, unit tests, play-testing with input, screenshots, and 3D models built and checked from code.

## Install

In Claude Code:

```text
/plugin install godotwright --marketplace laaielichter/Godotwright
```

## What you get

- **The MCP server** with all its tools (`godot_doctor`, `godot_scan`, `godot_api`, `godot_review`, `godot_fix`,
  `godot_check`, `godot_play`, `godot_session`, `godot_game`, `godot_perf`, `godot_scene_edit`, `godot_model_build`, `godot_lessons` and more). See the [full list](https://github.com/laaielichter/Godotwright#the-32-tools).
- **Hooks that put Godotwright in Claude's loop,** so it does not have to remember a tool:
  - before Claude writes or edits a file (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) inside a path a
    `godotwright.json` `"protect"` list or the "Protected paths" setting keeps byte-identical, the edit is denied with
    the reason. Bash commands are not parsed, so a `cp` or `sed -i` into such a folder is not stopped;
  - after every edit of a `.gd`, `.tscn`, `.tres`, `.gdshader` or `project.godot` file, that file is reviewed and its
    errors go straight back to Claude (warnings as a note);
  - when a command prints Godot errors (`SCRIPT ERROR`, `Parse Error`, ...), the lessons from real projects that
    explain them are added;
  - before Claude stops, review errors still open in files it changed are named once;
  - a session in a Godot project starts with a few lines about it: name, Godot version, scripts and scenes, main scene,
    and whether Godot is installed for the tools that run it.

  Turn them off with `GODOTWRIGHT_HOOKS=0`. They use the same godotwright version as the MCP server, say nothing when
  they have nothing to add, and never block on their own failure.
- **Skills Claude uses on its own** when the work calls for them:
  - `godot`: the workflow for any Godot work (map, look up, review before and after each edit, check with Godot);
  - `debug`: from a Godot error or wrong behaviour to the cause, the fix and the proof;
  - `perf`: stutter, load times, fps and memory, measured before and after;
  - `vehicles`: helicopters, aircraft, cars, trains, ships, moving platforms and decks;
  - `world`: terrain, streaming, levels of detail, road, rail and water networks;
  - `model`: 3D models built, viewed and linted against what the thing really is;
  - `patch`: changes to a shipped game (mods, overlays, installers) with preflight, receipts and rollback.
- **Skills you start yourself:** `/godotwright:review` (review and fix, errors first), `/godotwright:port` (Godot 3 to 4)
  and `/godotwright:learn` (teach Godotwright what this session learned, anonymously; nothing is sent).
- **Two subagents** for work that would flood the conversation: `godot-reviewer` (a verified review of a change, with
  Godot when installed) and `godot-debugger` (the root cause of an error or wrong behaviour, proven with a headless run).

Settings (all optional): the Godot project, the Godot 4.7 program, protected paths (comma separated), tool sets
(`core`, `edit`, `run`, `game`, `export`, `model`; empty means all, fewer tools cost less context) and read-only.
See the [reference](https://github.com/laaielichter/Godotwright/blob/main/docs/reference.md#tool-sets-and-read-only-mode).

Start Claude Code in your Godot project folder. The tools that run Godot (`check`, `test`, `play`, `screenshot`) need
Godot 4.7; set `GODOT` to its path if it is not found in the usual install folders.

## What it runs, writes and sends

- **Runs:** `npx -y godotwright@0.4.0 mcp --tier premium`. The first start downloads that exact version of the
  [godotwright npm package](https://www.npmjs.com/package/godotwright) (published from this repository by GitHub
  Actions, with provenance). It needs Node.js 22.12 or newer. The `check`, `test`, `play` and `screenshot` tools run
  your Godot binary headless on your project, which runs the project's own scripts.
- **Hooks:** run `node` with the plugin's `hooks/run.mjs`, which starts the same pinned godotwright version as the MCP
  server. They read the file you edited (and the project it is in) and the output of commands, keep a small state file
  per session (the files with open review errors) in the plugin's data folder, and print hook JSON for Claude.
- **Writes:** only inside your project. Tools that change files (`godot_rename`, `godot_scene_edit`,
  `godot_project_edit`, `godot_migrate`) show the change first and write only with `write: true`; `godot_model_build`
  writes the `.glb` you name. None of them write into a protected path. A local learning file in your user folder counts how review rules work out; it is
  built not to hold code, paths or project names. Turn it off with `GODOTWRIGHT_LEARN=0`.
- **Sends:** nothing. There is no telemetry. Opt-in sharing of anonymous counters is off unless you turn it on with
  `godotwright learn share on`; see [PRIVACY.md](https://github.com/laaielichter/Godotwright/blob/main/PRIVACY.md).

## Links

- [Website](https://laaielichter.github.io/Godotwright/) · [Source](https://github.com/laaielichter/Godotwright) ·
  [Install in other agents](https://laaielichter.github.io/Godotwright/install.html)
- License: MIT
