# Growth plan

How Godotwright gets found and used: a strong page first, one launch, then a steady trickle from listings.
No bought stars, no upvote requests, no alt accounts, and "I built this" in every post.

## Status (2 Nov 2026)

- **New today:** a short README (about 240 lines, down from 600) with a without/with table, the 0.3.0 news and an
  honest comparison; the full reference moved to `docs/reference.md`; a site page for the Claude Code plugin
  (`claude-code.html`) with real hook output; 20 topics, including `godot-mcp` (a small topic page where a new repo
  can rank near the top) and `gemini-cli-extension` (the Gemini CLI gallery lists repos with it on its own).
- **Released:** 0.3.0 on npm (trusted publishing, provenance), the official MCP Registry, and the GitHub Marketplace
  ("Godotwright receipt", category Game CI).
- **One-step installs:** Claude Code plugin, Claude Desktop bundle (`godotwright.mcpb` on every release), Gemini CLI
  extension, one-click links for Cursor and VS Code, setups for Codex, Windsurf and Zed on the
  [install page](https://laaielichter.github.io/Godotwright/install.html).
- **Page:** demo video in the README and on the site, all 24 MCP tools listed, Lighthouse accessibility 100 on every
  page, quickstart at the top, Support section.
- **Security:** CodeQL, Dependabot, actions pinned to commits, `main` protected, npm publishes only from GitHub.
- **Community:** good first issues #81, #93, #94 (and #80, being fixed in #91 by the first outside contributor).
- **Glama** already lists Godotwright (picked up from the MCP Registry), without a score yet.

## Readiness gate

- [x] One-command install works everywhere
- [x] Release with notes (0.2.0, 0.3.0)
- [x] Real demo (terminal recording of real output)
- [x] Social preview, site live, 3-5 good first issues
- [ ] Optional: a screen recording of Claude Code using Godotwright on a Godot 3 script
- [x] A launch day in the calendar (Tue 3 Nov, 15:00 Amsterdam = 09:00 New York)

## Before Tuesday (only you can do these)

In this order. Each takes 10 to 30 minutes.

0. **Check that your Hacker News account may post a Show HN.** HN has been restricting Show HNs from new or
   low-karma accounts since March 2026, and the rules are not public. If the submit page refuses it, e-mail
   hn@ycombinator.com before Tuesday.
1. **Anthropic plugin directory** (after PR #96 is merged). At [claude.ai/directory/manage](https://claude.ai/directory/manage):
   *Submit new* > *Plugin bundle*. Repository `laaielichter/Godotwright`, plugin path `plugins/godotwright`, branch
   `main` (submitting needs a paid Claude plan). Select *Validate*. Data handling answers that match what Godotwright does:
   - reads or stores personal data: **no** (a local learning file holds counters, built not to hold code, paths or
     project names);
   - sends data to other services: **no** (opt-in anonymous counters only after `godotwright learn share on`, and
     only when a collector is configured; none is by default);
   - intended for people under 18: **no**.
   Expect *Runs a pinned npx package* to be held for a reviewer; that is normal. If *Validate* stops with
   "Couldn't validate that repository", tell Claude: the `.gitattributes` file is the likely cause.
2. **Glama score.** At [glama.ai/mcp/servers/laaielichter/Godotwright](https://glama.ai/mcp/servers/laaielichter/Godotwright):
   sign in with GitHub, *Claim*, then *Admin* > *Dockerfile* with these values, *Deploy*, wait for the build test,
   *Make Release*:
   - Node.js version: 22
   - Build steps: `npm install -g godotwright@0.3.0`
   - CMD: `godotwright mcp --tier premium`
   - Environment variables: none needed
3. **Write the Show HN text** in your own words from the facts below. The HN guidelines ask for no generated or
   AI-edited text at all, not even to polish it. Never ask anyone to upvote.

## Tuesday 3 November (Amsterdam time)

| Time | What |
| --- | --- |
| 14:00 - 14:45 | Get ready: read your text once more, open the site and the install page |
| **15:00** | **Post the Show HN** |
| 15:10 - 17:30 | Answer comments (most important block) |
| 17:30 - 17:50 | Break |
| 17:50 - 18:15 | Short posts on X, Bluesky and LinkedIn |
| 18:15 - 20:00 | Answer comments; fix small reported bugs together with Claude |
| 20:00 - 20:20 | Break |
| 20:20 - 22:00 | Answer comments (afternoon in the US) |
| 22:00 - 22:40 | Write down what people asked; stop |

Where the time goes: answering comments (about 5 h) matters most, then quick fixes (1.5 h), then getting ready and
wrapping up (1 h), then the short posts (25 min). Stopping early is fine.

## Show HN: facts to use (you write the text)

Title ideas (HN titles are plain; pick one or write your own):
- `Show HN: Godotwright – an MCP server that stops coding agents writing Godot 3 code`
- `Show HN: Godotwright – offline Godot 4 API, review and checks for coding agents`

What it is:
- An MCP server and CLI for Godot 4.7. Works with Claude Code, Codex, Cursor, VS Code, Gemini CLI and any MCP client.
- The official Godot 4.7 class reference, bundled and offline, with Godot 3 names translated.
- A static review of GDScript with a score per category (api, performance, quality, structure); no Godot needed.
- Headless Godot checks, GUT/GdUnit4 tests, play a scene with an input timeline, screenshots.
- Safe edits to scenes, project settings and input maps (dry run first, only the changed lines).
- `migrate` rewrites the mechanical part of a Godot 3 to 4 port.
- A GitHub Action that posts a "receipt" (review, check, tests) on pull requests.
- Builds, views and checks 3D models (.glb) from code: 59 ready-made kinds, heightmap terrain with collision.
- MIT, local, no telemetry. Install: `npx -y godotwright review .` or one command per agent.

Proof, stated honestly:
- 168 runs (Claude Haiku, Sonnet and Opus, 12 tasks, with and without Godotwright), judged by real Godot 4.7.2 in CI.
- Correctness: **no difference**. Every run passed, with and without. Current models already solve those tasks.
- Code quality: with Godotwright 84/84 runs were fully statically typed, without it 71/84.
- Round 2 (five harder tasks, 50 Haiku runs): still 96% in both groups. Both failures were mistakes the review
  should have named; two new rules now catch them.
- Overhead: about 3 s and $0.002 per run for Haiku.

Honest limits (name at least one in the post):
- On these tasks it does not make Claude more correct; it makes the code cleaner and catches Godot 3 habits.
- No C# review. Scenes and project settings are not migrated (Godot's own `--convert-3to4` does those).
- `check`, `test`, `play` and `screenshot` need Godot 4.7 installed.

Questions to ask readers (pick one):
- Which Godot mistakes do your agents keep making?
- What would a benchmark need to show a real difference?

Likely questions, with true answers:
- *How is this different from other Godot MCP servers (godot-mcp, godot-mcp-pro, godot-forge)?* Most drive the
  running editor. Godotwright works without the editor: offline API, static review, checks in CI, and measured results.
- *Does it work with local models?* Yes, any MCP client; the `cheap` profile gives small models step-by-step
  instructions.
- *Does it send my code anywhere?* No. See PRIVACY.md.

Link the repository, not the site.

## Short posts (Tuesday 17:50)

X / Bluesky:
> I built Godotwright: an MCP server that helps Claude Code, Codex and other agents write Godot 4 code instead of
> Godot 3 habits. Offline Godot 4.7 API, a scored review, headless checks, safe scene edits. MIT.
> What Godot mistake does your agent make most? https://github.com/laaielichter/Godotwright

LinkedIn: the same, plus one honest line from the benchmark ("it did not make Claude more correct on my tasks, but
every run with it produced fully typed code").

## Wednesday 4 November: r/godot

Check the subreddit's current rules and the "selfpromo (software)" flair that day. Lead with the problem every Godot dev has seen
(an AI answer with `yield` and `KinematicBody2D`), show the demo GIF, say what it does not do, and ask which mistakes
to add as review rules. Then answer comments for a few hours.

Present it as a tool that checks AI-written code, not one that writes games: since June 2026 the Godot Foundation bans
AI-written contributions to the engine, and many Godot developers are wary of AI. Write the post yourself.

Other subreddits: r/gamedev only in its weekly self-promotion threads; r/ClaudeAI needs 50 karma for a showcase post
(otherwise its megathread); skip r/opensource, which bans AI projects since 24 Oct 2026. The Godot forum has a
"Plugins" category for tools.

## Listings (after the launch)

1. **awesome-mcp-servers** (punkpeye), section Gaming, once Glama shows a score badge:
   `- [laaielichter/Godotwright](https://github.com/laaielichter/Godotwright) [![laaielichter/Godotwright MCP server](https://glama.ai/mcp/servers/laaielichter/Godotwright/badges/score.svg)](https://glama.ai/mcp/servers/laaielichter/Godotwright) 📇 🏠 🍎 🪟 🐧 - Godot 4 toolkit for coding agents: offline Godot 4.7 API, scored GDScript review with Godot 3 to 4 fixes, headless checks, tests, play-testing with input, safe scene edits and 3D models from code.`
2. **awesome-godot** (godotengine), section Other, in alphabetical order:
   `- [Godotwright](https://github.com/laaielichter/Godotwright) - MCP server and CLI that help coding agents with Godot 4: offline API lookup, GDScript review with Godot 3 to 4 fixes, headless checks and tests, and a pull request receipt action.`
   The list's own rules ban crypto or NFT integrations; a gift address in the README is not an integration, but a
   reviewer may ask. Keep the Support section short and at the bottom.
3. **Free directory forms:** [mcp.so](https://mcp.so/submit), [mcpservers.org](https://mcpservers.org/submit) (the
   way into the wong2 list), [MCP Market](https://mcpmarket.com/submit) and cursor.directory. The free queues take
   2 to 6 weeks; the paid fast lanes are not needed.
4. **Cline MCP Marketplace:** a GitHub issue with a 400x400 PNG logo; an `llms-install.md` in the repo helps.
5. **awesome-claude-code:** from 11 Nov (the repo must be 14 days old), through its web form, filled in by you.
6. **Already automatic:** the official MCP Registry also feeds Glama, PulseMCP and others; the Gemini CLI gallery
   picks up the `gemini-cli-extension` topic. Smithery stopped its services on 31 Oct 2026, so skip it.

## Metrics baseline (1 Nov 2026)

Stars 0 · forks 3 · watchers 1 · npm downloads 505 in the first two days (28-29 Oct, partly CI) · repo views
55 (6 unique) in 14 days · top referrer github.com.

Weekly (20 min): stars, forks, npm downloads, top referrers (Insights > Traffic keeps only 14 days), reply to every
issue, label one new good first issue, write down what moved.
