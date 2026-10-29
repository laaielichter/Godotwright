# Making 3D models with small, cheap models

Can a small model (Haiku, Flash and the like) build good 3D models for Godot if the tool gives it enough context and
checks? Not as good as the largest models; nobody should claim that. But a tool can raise the floor a lot, because
most of what goes wrong with a small model is not a lack of talent: it is working blind and not knowing the conventions.

This page records a small test, what it showed, and what Godotwright did about it.

## The test

Six Haiku agents each got one thing to model with the Godotwright command line and at most 14 tool calls: a medieval
watchtower with a wooden gallery, a rowing boat, a fantasy dragon, an oak tree with a tree house, a one-person sci-fi
fighter and a campfire with a tripod and seats. They kept a log of every error and every point of confusion. Afterwards
the models were rendered and looked at by a person.

This is six runs of one model on one tool version: an indication, not a benchmark. No larger model was run for comparison.

## What came out

- **The models were better than expected.** All six built and linted at 100/100, mostly in one or two attempts. The
  watchtower, tree house and campfire read clearly; the boat and the fighter are recognisable; the dragon is crude
  (a long-necked four-legged creature with wings) but readable. Having ready-made shapes (loft, lathe, mirror, repeat) and
  a clear spec format does a lot of the work.
- **But every agent worked blind.** None could see its model, so "100/100" only meant "valid", not "looks right". Two
  agents said so in these words.
- **The lint score gave false confidence.** A ladder that floated half a metre away from the trunk, stones that sank into the
  ground and a boat that passed an archetype check for a barn all scored 100/100.
- **The archetype check was silent about what it compared.** `--archetype watchtower` quietly became "tower",
  `--archetype campfire` and `dragon` quietly became the general rules, and a part group named `LandingGear` counted as one
  part while `TailWingLeft` counted as a second `WingLeft`. Nothing said which parts were counted.
- **Missing categories.** The library had no fortification, creature or spacecraft, so these were built from nothing.
- **Documentation gaps.** Which axis a loft width runs along, what `cy` means, the anchor names, the default segment
  counts and the list of materials were hard to find or missing.

## What Godotwright does about it

1. **`model view`** (and the MCP tool `godot_model_view`): the model as text. Three views (front, side, top) drawn with one
   letter per part, a table of the parts with sizes and heights, and the list of parts that do not touch the rest. A model
   that cannot see pictures can now check shape, proportions and attachment.
2. **`model/floating-part`** in `model lint`: a part that does not touch the rest of the model is reported (a warning in the
   air, an info on the ground). It immediately found real gaps in four of the ready-made recipes (wheels without axles on the
   truck and tractor, a motorcycle engine not joined to its frame, pylon crossarms), which are fixed, and a test now keeps
   every ready-made kind in one piece.

3. **`model brief <what>`** (and the MCP tool `godot_model_brief`): one page that hands a small model the context a large one
   would carry in its head. What the thing is, the ready-made kind to start from (and how to print its spec to edit with
   `model recipes <kind>`), the parts to name its nodes after, a typical size with its source, the rules and usual mistakes
   of that thing (the rules every model shares are said once), the order of tools to call, and a short spec cheat sheet
   (`model spec --short`). When nothing is near, it says so instead of offering unrelated kinds.

More is planned: recipes that can be placed inside a spec, an honest account in `lint --archetype` of what was compared, and archetypes for fantasy, creatures, fortifications and
spacecraft. See the roadmap.

## What this does not claim

A text view is a crutch, not eyesight: it shows silhouettes and attachment, not beauty. A tool cannot give a small model a
large model's taste. The aim is narrower and measurable: fewer blind mistakes, faster convergence, a higher floor.
