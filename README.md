# Godotwright

AAA coding toolkit for **Godot 4**. It makes any coding agent (Claude, Codex and
others) better at building Godot games.

> Early work in progress. See [ROADMAP.md](ROADMAP.md) for the plan.

## Usage

```sh
godotwright scan [path]               # compact project map, cheap to read
godotwright scan [path] --detail full # node trees, signatures, line numbers
godotwright scan [path] --json        # the full map as JSON
godotwright check [path]              # run Godot headless, report errors as file:line
godotwright check [path] --run        # also run the main scene for 120 frames
```

`scan` reads `project.godot`, scenes, resources and scripts without starting Godot.
It lists scenes with their node trees, scripts with signals, functions and exports,
autoloads, input actions and key settings, and warns about broken references
(missing files, a missing main scene or autoload, bad `preload()` paths).

`check` needs Godot 4.7 (`--godot <path>`, `$GODOT`, or `godot` on your PATH). It imports
the project, loads and instantiates every script and scene, and can run the main scene.
Each problem comes back once, as `res://path/file.gd:12: error: ...`.
The exit code is 1 when there are errors.

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
