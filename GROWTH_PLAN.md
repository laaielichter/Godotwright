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

1. ~~**About box**~~: done (description, website, 12 topics).
   Original text, for reference:
   - Description: `MCP server and CLI that makes Claude Code, Codex and any coding agent better at Godot 4: offline API, project map, headless checks, AAA GDScript review.`
   - Website: `https://laaielichter.github.io/Godotwright/`
   - Topics: `godot godot4 gdscript gamedev godot-engine mcp mcp-server claude-code codex ai-agents linter static-analysis`
2. ~~**Pages**~~: done, the site is live.
3. ~~**Social preview**~~: done, custom image is live.
4. ~~**Discussions**~~: done, linked from the issue forms.
5. ~~**npm**~~: done, `godotwright` is live (0.0.2 on 29 Oct, published by GitHub with trusted publishing and provenance).
6. **Release v0.1.0** on GitHub with short notes (what each command does).
7. ~~**MCP Registry**~~: done, the Publish workflow listed 0.0.2. Every next version is
   listed by the same workflow.
8. **Good first issues**: #2 and #4 are done, only #3 and #5 are left. Add 1-3 new ones.
9. **Record a real demo**: 20-30 s screen capture of Claude Code fixing a Godot 3 script
   with Godotwright (prompt, `godot_review` call, fixed code, score going up). MP4 for posts,
   GIF or WebP under 5 MB for the README.

## Readiness gate (before any launch post)

- [x] One-command install works (`npx -y godotwright`)
- [ ] Release v0.1.0 (prepared: changelog, version bump and a release workflow are in the repo; push the tag)
- [ ] Real screen-recorded demo
- [x] Social preview uploaded
- [x] Site live
- [x] 3-5 good first issues (see the update below)
- [ ] You can be online 6-8 hours on launch day to answer every comment

## Listings (after npm)

1. ~~Official MCP Registry~~: done.
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

## Status 29 Oct 2026

Stars 1 · forks 1 · npm 0.0.2 live · MCP Registry listed · 0 releases · 2 open good first issues.
Since the audit the repo grew 3D model tools (inspect, lint, contract, build, spec, recipes).
Left before launch: release v0.1.0, 1-3 good first issues, real screen-recorded demo, a launch day.

## Update 29 Oct 2026: 3D models are the second story

Godotwright now also builds, views and checks 3D models (44 ready-made kinds, terrain with lakes and rivers, a text
viewer, a loose-part check) and has a written test of how small models cope with it. That gives two audiences and two
stories, which should be told one at a time and not mixed in a single post:

1. **Godot 4 correctness for coding agents** (existing): benchmark, review, API. Audience: Godot devs who use agents.
2. **3D models from code, also for cheap models** (new): gallery, `docs/cheap-models.md`. Audience: people who build with
   agents and want assets without Blender; people who care about cheap models.

### Done in the repo (free)

- Site: `docs/models.html` gallery (44 kinds plus 3 terrain variants, each with the command that builds it), a 3D section on
  the home page, sitemap, structured data, `docs/llms.txt` for AI crawlers. `scripts/build-gallery.mjs` regenerates the page.
- README: a 3D section with the overview image; description and keywords (npm, MCP Registry) mention 3D models.
- Release prep: `CHANGELOG.md` (0.1.0), version bump to 0.1.0 in `package.json` and `server.json`, `release.yml`
  (creates the GitHub release from the changelog when a `v*` tag is pushed; the Publish workflow publishes to npm and the
  MCP Registry on the same tag).
- New good first issues with exact specs (archetypes for fantasy, creatures, fortifications and spacecraft, recipes).

### Only you can do these (needs your accounts; none of it is automated, on purpose)

1. **Release**: after the pull request with the release prep is merged, push the tag: `git tag v0.1.0 && git push origin v0.1.0`
   (or create the release in the GitHub web UI with the tag `v0.1.0`). That publishes to npm, lists the version in the MCP
   Registry and creates the GitHub release.
2. **Topics** (Settings, About, the gear icon): add `3d-models`, `glb`, `gltf`, `procedural-generation`, `model-generator`,
   `blender-alternative`. There is no API route available here, so this is a click.
3. **Listings**: Glama (glama.ai/mcp/servers, Add MCP Server), mcp.so (Submit), PulseMCP and Smithery. Text to paste:
   - Name: Godotwright. Short: `MCP server and CLI for Godot 4.7: offline API, project map, headless checks, AAA GDScript
     review, and 3D models built, viewed and checked from code.`
   - Install: `npx -y godotwright mcp` (Node 22.12+). Repo: https://github.com/laaielichter/Godotwright. License: MIT.
   - Tools: godot_scan, godot_api, godot_api_search, godot_review, godot_check, godot_checklist, godot_feedback,
     godot_model_identify, godot_model_spec, godot_model_build, godot_model_lint, godot_model_inspect, godot_model_view.
   Then the one-line pull request to a list such as punkpeye/awesome-mcp-servers, as that list's own rules describe
   (it asks for the Glama badge). Do not open pull requests to unrelated lists.
4. **awesome-godot** (godotengine/awesome-godot): read its CONTRIBUTING first; it may only list addons and tools of a certain kind.
5. **A real demo**: a 30 second screen recording of an agent asking `model identify`, `model build`, `model view`, fixing
   what the check says, and opening the `.glb` in Godot. MP4 for posts, GIF or WebP under 5 MB for the README.
6. **Launch day**: be online 6 to 8 hours and answer every comment.

### Drafts (the posts are yours to publish; say "I built this" in every one)

**Hacker News (you write the text; HN asks for no AI-written posts).** Facts, two possible angles:

- Angle A, `Show HN: Godotwright, an MCP server so coding agents stop writing Godot 3 code`. Facts: offline Godot 4.7 API,
  project map, headless checks, review with scores; a 168-run benchmark whose honest result is that correctness was equal
  (all passed) and static typing was 84/84 with it and 71/84 without; limitation: the tasks were too easy to separate correctness.
  Question: which Godot mistakes do your agents keep making?
- Angle B (a write-up, not a Show HN): "We asked six Haiku agents to model a dragon". Facts: six small-model agents, one
  thing each, 14 tool calls, all reached 100/100 lint, none could see its model, lint missed a floating ladder and stones
  sunk in the ground, the archetype check silently fell back to general rules; what was built (a text viewer and a
  loose-part check) and that it found real loose parts (wheels without axles, a tree crown 4.8 m above its trunk) in our own
  ready-made models. Limits: six runs, one model, an indication and not a benchmark. Question: what do you give a small model so it
  stops working blind? Link `docs/cheap-models.md`.
- Post Tuesday or Wednesday, 15:00 to 16:00 Europe/Amsterdam. Link the repo, not the site.

**r/godot, r/gamedev, r/aigamedev and similar.** Read each subreddit's current rules and its stance on AI tools the day you
post (several game dev communities restrict AI content or self-promotion; some want a flair). Do not post the same text in
several places. Lead with a concrete before and after, say what it does not do, ask one question.

> I built a small open source tool (MIT) that lets a coding agent build and check 3D models for Godot without Blender:
> 44 ready-made parametric kinds (cars, aircraft, ships, buildings, trees, terrain with a lake and a river), a text viewer
> so an agent without eyes can check the shape, and a lint that scores the .glb. They are clean base models, not sculpted
> art. Gallery: https://laaielichter.github.io/Godotwright/models.html. What would you want it to build next?

**X / Bluesky / Mastodon** (attach `docs/gallery/overview.jpg`):

> I built Godotwright: an MCP server + CLI that lets Claude Code, Codex or a cheap model build, view and check 3D models for
> Godot 4 from code. 44 kinds, a text viewer for agents that can't see, MIT. Gallery + install: [link]
> What should it build next?

**LinkedIn (Dutch audience, write it in Dutch):** a story post about the test with six small models: what broke, what
the tool does about it, honest limits, link to the write-up.

**dev.to article:** "We asked six Haiku agents to model a dragon: what broke, and what we built" (outline = angle B above,
with the six renders side by side and the verbatim error and confusion notes).

### Calendar from here

| Week | Dates | Focus |
| --- | --- | --- |
| 1 | 29 Oct to 3 Nov | Merge the growth and release prep pull requests, push the v0.1.0 tag, topics, listings (Glama, mcp.so, Smithery, PulseMCP), record the demo |
| 2 | 4 to 10 Nov | Good first issues get answered; fix what the first real users report; readiness gate |
| 3 | 11 to 17 Nov | Launch: Show HN (Tue), r/godot (Wed) and X/Bluesky (Wed); answer everything |
| 4 | 18 to 24 Nov | awesome-mcp-servers PR; dev.to write-up of the small-model test |
| 5 | 25 Nov to 1 Dec | v0.2.0 with launch feedback (briefing tool for small models, recipes inside specs, fantasy archetypes) |
| 6 | 2 to 8 Dec | Use-case post (agents building a village scene from the recipes, or reviewing mods with `--base`) |

### Metrics baseline (29 Oct 2026, after the 3D work)

Stars 1 · forks 1 · open issues 4 (before the new ones) · npm 0.0.2 · releases 0. Check weekly: stars, forks, npm downloads,
top referrers (Insights, Traffic: kept only 14 days), and reply to every issue.
