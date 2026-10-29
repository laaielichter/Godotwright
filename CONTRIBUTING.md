# Contributing to Godotwright

Thanks for helping. Small fixes and big ideas are both welcome.

## Ways to help

- Report a wrong review finding with the "Wrong review finding" form. False alarms
  and missed problems are the most useful reports.
- Suggest a rule for a mistake coding agents keep making in Godot.
- Pick an issue labeled `good first issue`.
- Improve the docs or the site in `docs/`.
- Add or correct a **model archetype** (see below). It is data, not code, and a good first contribution.

## Adding an archetype

`godotwright model identify` knows what things are from `data/archetypes/*.json`. To add one, add an
object to the file of its family (or a new file) and run `npm test`; the tests check the whole library.

- `id` is a dotted path under its parent (`vehicle.wheeled.car`), and `extends` names the parent.
  Parts, sizes, variants and notes are inherited; list only what is new or different.
- `aliases` are lowercase names in English **and Dutch** (and other languages you know). An alias may belong
  to one archetype only, unless two things really share a word (such as the Dutch "windmolen"); then add it to
  `SHARED_ALIASES` in `src/archetype/library.ts`.
- `parts` name the nodes a model should have (`PascalCase`). Give a moving part `moves` and a `pivot`
  (`hub`, `hinge`, `base`, `center` or `mount`).
- `scale` is a typical size range in metres with a **`source`** and a **`confidence`**: `A` official figure or
  standard, `B` manufacturer or public data, `C` general knowledge, `D` derived, `X` unknown. If you are not
  sure, use `C` and say so. Never guess a number and call it `A`.
- Do not put anything from a private project in here, only general knowledge.

## Adding a recipe

A recipe is a model spec (see `godotwright model spec`) saved as `data/recipes/<kind>.json`. Give it a `name`,
a `description`, an `archetype` id, `params` with ranges, and `nodes`. Put the pivot of every moving part at its
hub or hinge (use `offset` to move a shape without moving its pivot). `npm test` builds every recipe, checks it
against its archetype and tries each parameter at its lowest and highest value, so a recipe that only works with
its defaults is caught. Look at it too: `model build <kind>` writes a `.glb` you can open in any viewer.

## Set up

```sh
git clone https://github.com/laaielichter/Godotwright.git
cd Godotwright
npm ci
npm run check
```

Tests need no Godot install. Integration tests in `test/integration/` need Godot 4.7
in `$GODOT`; CI runs them.

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Keep each pull request to one change.
3. Add tests. New review rules need a test in `test/review.test.ts` and must stay
   quiet on the official demo projects.
4. Follow the conventions in [AGENTS.md](AGENTS.md).

## Be kind

We follow the [Code of Conduct](CODE_OF_CONDUCT.md). Be patient and specific; we will do the same.
