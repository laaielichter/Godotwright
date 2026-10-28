# Contributing to Godotwright

Thanks for helping. Small fixes and big ideas are both welcome.

## Ways to help

- Report a wrong review finding with the "Wrong review finding" form. False alarms
  and missed problems are the most useful reports.
- Suggest a rule for a mistake coding agents keep making in Godot.
- Pick an issue labeled `good first issue`.
- Improve the docs or the site in `docs/`.

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
