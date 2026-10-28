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
- `src/version.ts`: package version and the Godot target version.
- `src/index.ts`: public library exports.
- `test/`: vitest tests, one file per area.

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
