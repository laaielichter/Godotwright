# AGENTS.md

Guide for coding agents working on this repository.

## What this is

Godotwright is a coding toolkit for Godot 4.7.x: a CLI and (later) an MCP server
that make any coding agent better at Godot. See `ROADMAP.md` for the plan and the
"done" check of each step.

## Commands

```sh
npm ci              # install exact dependencies
npm run typecheck   # tsc, no output files
npm test            # vitest
npm run build       # compile src/ to dist/
npm run check       # all of the above, run this before every commit
node dist/cli.js --help
```

## Layout

- `src/cli.ts`: executable entry point (`godotwright` bin). Keep it tiny.
- `src/program.ts`: builds the commander program. Commands are added here.
- `src/commands/`: one file per CLI command.
- `src/godot/`: readers for Godot file formats (Variant text, project.godot,
  .tscn/.tres, GDScript outline). No I/O in here.
- `src/project/`: finding the project root and listing its files.
- `src/scan/`: builds the project map and formats it (brief, full, JSON).
- `src/check/`: runs Godot headless (import, checker script, optional run) and
  turns its output into diagnostics.
- `src/version.ts`: package version and the Godot target version.
- `src/index.ts`: public library exports.
- `test/`: vitest tests, one file per area. `test/fixtures/demo` is a small,
  valid Godot 4.7 project; keep it error-free. `test/fixtures/broken` has known errors.
- `test/integration/`: tests that need a real Godot binary in `$GODOT`
  (and `$GODOT_DEMOS` for the official demo projects). CI runs them.

## Conventions

- Node.js >= 22.12, TypeScript in strict mode, ES modules only.
- Relative imports use the `.js` extension (`./program.js`), as NodeNext requires.
- Prefer Node built-ins over new dependencies. Add a dependency only when it
  clearly pays for itself.
- Every new feature comes with tests. Tests must not need a Godot install unless
  they are marked as integration tests.
- Output meant for agents is compact and stable, so it is cheap to read and easy
  to parse.

## Commits and content

- Small commits with a short imperative subject (`Add project scan`).
- No trailers, chat or session links, or personal information in commits or files.
- Update the status list in `ROADMAP.md` when a step is done.
