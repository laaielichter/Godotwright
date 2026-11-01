# Security

## Report a vulnerability

Report it privately through
[GitHub security advisories](https://github.com/laaielichter/Godotwright/security/advisories/new).
Please do not open a public issue for it. A fix for a confirmed problem goes out in a new release on npm.

Only the latest release is supported.

## What Godotwright does on your machine

- It reads Godot projects. `check`, `test`, `play` and `screenshot` run Godot headless on them, which runs the
  project's own scripts: treat projects from people you do not trust like any other code you run.
- The MCP tools only write inside the project. `rename`, `scene`, `project` and `migrate` show the change first and
  write only with `write: true`; `model build` writes the `.glb` you name.
- Nothing leaves your machine unless you turn on opt-in sharing; see [PRIVACY.md](PRIVACY.md).

## How releases are made

- npm releases are published by GitHub Actions with
  [trusted publishing](https://docs.npmjs.com/trusted-publishers) and carry a
  [provenance statement](https://docs.npmjs.com/generating-provenance-statements), so you can check that a version
  was built from this repository: `npm audit signatures`.
- Every GitHub Action the workflows use is pinned to a commit, and checkouts do not keep git credentials.
- CodeQL scans the code and the workflows; Dependabot proposes dependency updates every week.
