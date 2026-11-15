# godot3-platformer-expected

The Godot 4 text of every script in `examples/godot3-platformer/scripts/`,
as produced by `godotwright migrate --write` on that project. Generated with:

```sh
node dist/cli.js migrate examples/godot3-platformer --write
```

`test/examples.test.ts` runs `migrateScript()` on the example scripts and
compares the result to these files. If a `migrate` rule changes, this folder
must be regenerated (and the example's README checked against the real output)
in the same change.

Note: this folder lives in `test/fixtures/` on purpose, not inside the
example project: `godotwright review` counts every `.gd` file under the
project, so an `expected/` folder inside `examples/godot3-platformer/` would
show up in the review walk-through as extra scripts.
