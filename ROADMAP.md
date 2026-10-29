# Godotwright Roadmap

Godotwright is an AAA-focused coding toolkit and agent for **Godot 4**.
It works with any coding agent (Claude, Codex and others) and any LLM, cheap or premium.
The goal: agents build better Godot games with Godotwright than without it, aiming for the quality bar of an established studio.

- **License:** MIT
- **Target engine:** Godot 4.7.x (4.7.2 at time of writing)
- **Stack:** Node.js + TypeScript
- **Distribution:** npm package + official MCP Registry

## Design: two layers

**Layer 1: toolkit for any agent.**
An MCP server plus a CLI. Agents load their project data into it and get Godot knowledge,
real checks (headless Godot runs, script tests, screenshots) and a fixed AAA checklist.

**Layer 2: Godotwright's own agent.**
Built on top of layer 1. It can call any LLM provider.
Cheap models get small, well-scoped tasks and stricter checks.
Premium models handle the big design decisions.

We build layer 1 first, because it makes every existing agent better right away.

## Layer 1 steps

Each step is small and has a clear "done" check.

1. **Skeleton.** Project setup, `AGENTS.md`, tests, CI.
   *Done when:* `godotwright --help` works and tests pass.
2. **Project scan.** Agents load their project in. Godotwright builds a compact map:
   scenes, nodes, scripts, signals, autoloads and key project settings.
   Short output for cheap models, detailed output for premium models.
   *Done when:* the scan of a test project gives a correct map.
3. **Real checks.** Run Godot headless to find errors in scripts and scenes.
   *Done when:* a broken script is reported with file and line number.
4. **API knowledge.** The official Godot 4.7 class reference, searchable offline,
   so models stop inventing functions that do not exist.
   *Done when:* every looked-up class, method and signal matches Godot 4.7.
5. **AAA review.** Fixed rules for performance, code quality and project structure,
   with a score per category.
   *Done when:* a report with scores is produced for a test project.
6. **MCP server.** Everything above exposed as tools, with model-tier profiles
   (cheap vs. premium).
   *Done when:* it works in both Claude Code and Codex.
7. **Benchmark.** A fixed set of Godot tasks, run with and without Godotwright.
   *Done when:* we have before/after numbers.

## Learning

Godotwright gets better with every use, without collecting anything personal.

8. **Local learning.** Remember per machine which rules real Godot confirms or
   contradicts, which findings were false alarms, and what failed API lookups meant.
   *Done when:* tests show reviews and lookups improve from earlier use, and nothing
   leaves the machine.
9. **Opt-in sharing.** Users who say yes send anonymous counters (no code, names or
   paths), and can see exactly what would be sent first.
   *Done when:* tests prove a report holds nothing from the project, and nothing is
   sent without a yes.
10. **Collector.** A small server that accepts reports and aggregates them, keeping
    only what at least 3 installs reported.
11. **Shared knowledge.** Aggregated results ship with each release, so every user
    benefits.

## 3D models

12. **Model inspect and lint.** Read `.glb` and `.gltf` without Godot and review them with
    the same scores and exit codes as `review`: flipped faces, open edges, normals, UVs,
    tangents, textures, node names and budgets.
    *Done when:* every rule has a test with a good and a bad model.
13. **Model contract.** A small file that lists the node names, sizes and triangle budget a
    model must keep, so renamed nodes or drifting sizes are caught.
    *Done when:* a renamed node or a model that grows past its tolerance is reported.
14. **Model builder.** A small mesh kit (boxes, extrusions, roofs, surfaces of revolution, UVs,
    tangents, deterministic GLB writer) and `model build <kind>`, starting with `house`.
    *Done when:* every kind passes `model lint` without errors and loads in Godot.
15. **More kinds** (trees and plants, cars, helicopters, aircraft, ships, engines, infrastructure),
    **MCP tools for models**, and a contact-sheet render.

## After layer 1

- Release on npm and the MCP Registry.
- Layer 2: Godotwright's own agent with model tiers.

## Status

- [x] Name, repository, MIT license
- [x] Design and roadmap
- [x] Step 1: Skeleton
- [x] Step 2: Project scan
- [x] Step 3: Real checks
- [x] Step 4: API knowledge
- [x] Step 5: AAA review
- [x] Step 6: MCP server
- [x] Step 7: Benchmark (see [bench/RESULTS.md](bench/RESULTS.md))
- [x] Step 8: Local learning
- [x] Step 9: Opt-in sharing (sends nothing until a collector is set up)
- [x] Step 10: Collector (reference server; not hosted yet)
- [x] Step 11: Shared knowledge (`data/learned.json`, empty until reports come in)
- [x] Learning from public projects for free (weekly Learn workflow on the official demos)
- [x] Released on npm (`godotwright`)
- [ ] Listed in the MCP Registry
