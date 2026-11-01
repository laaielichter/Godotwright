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

- **The MCP server** with 22 tools (`godot_scan`, `godot_api`, `godot_review`, `godot_check`, `godot_scene_edit`,
  `godot_model_build` and more). See the [full list](https://github.com/laaielichter/Godotwright#the-22-tools).
- **Three skills:**
  - `/godotwright:review` reviews the project and fixes what it finds, errors first.
  - `/godotwright:port` ports Godot 3 code to Godot 4.
  - `godot` is a Godot workflow Claude follows on its own: map the project, look up the API, review before and after
    each edit, check with Godot before finishing.

Start Claude Code in your Godot project folder. The tools that run Godot (`check`, `test`, `play`, `screenshot`) need
Godot 4.7; set `GODOT` to its path if it is not found in the usual install folders.

## What it runs, writes and sends

- **Runs:** `npx -y godotwright@0.2.0 mcp --tier premium`. The first start downloads that exact version of the
  [godotwright npm package](https://www.npmjs.com/package/godotwright) (published from this repository by GitHub
  Actions, with provenance). It needs Node.js 22.12 or newer. The `check`, `test`, `play` and `screenshot` tools run
  your Godot binary headless on your project, which runs the project's own scripts.
- **Writes:** only inside your project. Tools that change files (`godot_rename`, `godot_scene_edit`,
  `godot_project_edit`, `godot_migrate`) show the change first and write only with `write: true`; `godot_model_build`
  writes the `.glb` you name. A local learning file in your user folder counts how review rules work out; it is
  built not to hold code, paths or project names. Turn it off with `GODOTWRIGHT_LEARN=0`.
- **Sends:** nothing. There is no telemetry. Opt-in sharing of anonymous counters is off unless you turn it on with
  `godotwright learn share on`; see [PRIVACY.md](https://github.com/laaielichter/Godotwright/blob/main/PRIVACY.md).

## Links

- [Website](https://laaielichter.github.io/Godotwright/) · [Source](https://github.com/laaielichter/Godotwright) ·
  [Install in other agents](https://laaielichter.github.io/Godotwright/install.html)
- License: MIT
