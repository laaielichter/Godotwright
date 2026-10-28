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

## After layer 1

- Release on npm and the MCP Registry.
- Layer 2: Godotwright's own agent with model tiers.

## Status

- [x] Name, repository, MIT license
- [x] Design and roadmap
- [x] Step 1: Skeleton
- [x] Step 2: Project scan
- [x] Step 3: Real checks
- [ ] Step 4: API knowledge
- [ ] Step 5: AAA review
- [ ] Step 6: MCP server
- [ ] Step 7: Benchmark
