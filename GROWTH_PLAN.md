# Growth plan

How Godotwright gets found and used: fix the page first, launch once, then keep a
steady trickle from listings. No bought stars, no upvote requests, no alt accounts.

## Audit (28 Oct 2026)

| Item | Before | After this change |
| --- | --- | --- |
| Tagline with search words (MCP server, Claude Code, Godot 4) | 1 | 2 |
| Hero demo | 0 | 1 (real output as SVG; a screen recording is still to do) |
| Quickstart with expected output | 1 | 2 |
| Badges (functional only) | 0 | 2 |
| "Why", comparison table, FAQ | 0 | 2 |
| Repo description | 0 | 0, manual step below |
| Topics | 0 | 0, manual step below |
| Website field + site | 0 | 1, site built, needs Pages enabled |
| Social preview | 0 | 1, `docs/og.png` ready, needs upload |
| License | 2 | 2 |
| CONTRIBUTING, CODE_OF_CONDUCT, SECURITY | 0 | 2 |
| Issue forms, PR template | 0 | 2 |
| Good first issues | 0 | 0, manual step below |
| Discussions | 0 | 0, manual step below |
| First release | 0 | 0, manual step below |
| On npm / MCP Registry | 0 | 0, manual step below |

Score: 4 / 32 before, 21 / 32 after this change. The manual steps bring it to about 30.

## Done in this change

- README rewritten: logo, one-line pitch with the words people search for, badges,
  demo, quickstart, "Why", comparison, FAQ, contributing. All existing docs kept.
- Website in `docs/` (one page, dark and light theme, mobile, SEO and Open Graph tags,
  FAQ and SoftwareApplication structured data, sitemap) and a Pages workflow.
- `docs/demo.svg`: animated terminal with real `godotwright review` output.
- `docs/og.png`: 1280x640 image for link previews and the GitHub social preview.
- Community files and issue forms, including a "Wrong review finding" form.
- `package.json`: description, homepage and keywords for npm search.

## Manual to-dos (only you can do these)

1. **About box** (repo page, gear icon next to About):
   - Description: `MCP server and CLI that makes Claude Code, Codex and any coding agent better at Godot 4: offline API, project map, headless checks, AAA GDScript review.`
   - Website: `https://laaielichter.github.io/Godotwright/`
   - Topics: `godot godot4 gdscript gamedev godot-engine mcp mcp-server claude-code codex ai-agents linter static-analysis`
2. ~~**Pages**~~: done, the site is live.
3. **Social preview**: Settings > General > Social preview > upload `docs/og.png`.
4. ~~**Discussions**~~: done, linked from the issue forms.
5. **npm**: `npm publish` (name `godotwright` was free on 28 Oct; check again).
   Then switch README and site to the `npx -y godotwright mcp` commands.
6. **Release v0.1.0** on GitHub with short notes (what each command does).
7. **MCP Registry**: add `"mcpName": "io.github.laaielichter/godotwright"` to
   package.json, then `mcp-publisher init`, `mcp-publisher login github`, `mcp-publisher publish`.
8. ~~**Good first issues**~~: done, issues #2-#5.
9. **Record a real demo**: 20-30 s screen capture of Claude Code fixing a Godot 3 script
   with Godotwright (prompt, `godot_review` call, fixed code, score going up). MP4 for posts,
   GIF or WebP under 5 MB for the README.

## Readiness gate (before any launch post)

- [x] One-command install works (`npx -y github:laaielichter/godotwright`); npm still to do
- [ ] Release v0.1.0
- [ ] Real screen-recorded demo
- [ ] Social preview uploaded
- [x] Site live
- [x] 3-5 good first issues
- [ ] You can be online 6-8 hours on launch day to answer every comment

## Listings (after npm)

1. Official MCP Registry (step 7 above).
2. Glama (glama.ai/mcp/servers, "Add MCP Server"), then a one-line PR to
   punkpeye/awesome-mcp-servers (needs the Glama badge).
3. mcp.so and Smithery.
4. awesome-godot (godotengine/awesome-godot): check its CONTRIBUTING for tools.
5. Godot Asset Library is for addons inside the editor; not a fit until there is an addon.

Check each page's current rules the day you submit.

## Launch drafts

Times are Europe/Amsterdam. Say "I built this" in every post.

### Show HN (you write the final text; HN asks for no AI-written posts)

Facts to use:
- Title idea: `Show HN: Godotwright – make coding agents stop writing Godot 3 code`
- What: MCP server + CLI; offline Godot 4.7 API, project map, headless checks, review.
- Proof: 168-run benchmark. Honest result: correctness was equal (all passed),
  static typing 84/84 with vs 71/84 without.
- Limitation: the tasks were too easy to separate correctness; no C# review.
- Question for readers: which Godot mistakes do your agents keep making?
- Post Tue or Wed, 15:00-16:00. Link the repo, not the site.

### r/godot

Check the current rules and self-promotion flair first. Lead with the problem every
Godot dev has seen (an AI answer with `yield` and `KinematicBody2D`), show the
before/after screenshot, say what it does not do, ask which mistakes to add as rules.

### X / Bluesky / LinkedIn

> I built Godotwright: an MCP server that stops Claude Code and Codex from writing
> Godot 3 code. Offline Godot 4.7 API, project map, headless checks, and a review with
> a score per category. MIT. [demo video] [repo link]
> What Godot mistake does your agent make most?

### dev.to / blog post

"What 168 agent runs taught me about AI and Godot 4": method, the honest null result
on correctness, the typing difference, and why the cheap profile made Haiku call tools.

## Calendar

| Week | Dates | Focus |
| --- | --- | --- |
| 1 | 28 Oct - 3 Nov | Manual to-dos 1-6, record the demo |
| 2 | 4 - 10 Nov | MCP Registry, Glama, good first issues; readiness gate |
| 3 | 11 - 17 Nov | Launch: Show HN (Tue), r/godot (Wed), X/LinkedIn (Wed). Answer everything. |
| 4 | 18 - 24 Nov | awesome-mcp-servers and awesome-godot PRs; fix what launch feedback found |
| 5 | 25 Nov - 1 Dec | dev.to benchmark post; release v0.2.0 with feedback fixes |
| 6 | 2 - 8 Dec | Use-case post (reviewing mods with `--base`); next release note |

## Metrics baseline (28 Oct 2026)

Stars 0 · forks 0 · watchers 0 · open issues 0 · npm downloads n/a (not published).

Weekly (20 min): stars, forks, npm downloads, top referrers from Insights > Traffic
(kept only 14 days), reply to every issue, label one new good first issue, note what moved.
