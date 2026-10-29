// Writes docs/models.html: the gallery of everything `godotwright model build` can make.
//
//   npm run build && node scripts/build-gallery.mjs
//
// The kinds, their descriptions and parameters come from the code, so the page cannot drift from what the tool does.
// The pictures in docs/gallery/<kind>.jpg are renders of the default model of each kind (400 x 300 JPEG); a kind
// without a picture is listed without one. Styles are taken from docs/index.html so the pages look the same.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { allKinds } from "../dist/build/generators/index.js";

const docs = (name) => fileURLToPath(new URL(`../docs/${name}`, import.meta.url));
const index = readFileSync(docs("index.html"), "utf8");
const style = index.slice(index.indexOf("<style>"), index.indexOf("</style>") + "</style>".length);

const FAMILIES = [
  ["Vehicles", /^vehicle\./],
  ["Aircraft", /^aircraft\./],
  ["Boats and ships", /^vessel\./],
  ["Machines", /^machine\./],
  ["Buildings", /^building\./],
  ["Roads, rails and bridges", /^infrastructure\./],
  ["Plants", /^plant\./],
  ["Terrain and water", /^world\./],
  ["Props", /^prop\./],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const title = (kind) => kind.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const kinds = allKinds();
// Short, plain first sentence of the description for the caption.
const short = (text) => text.split(/(?<=\.)\s/)[0] ?? text;

const sections = FAMILIES.map(([name, pattern]) => {
  const members = kinds.filter((k) => pattern.test(k.archetype ?? "")).sort((a, b) => a.kind.localeCompare(b.kind));
  return { name, members };
}).filter((s) => s.members.length > 0);
const placed = new Set(sections.flatMap((s) => s.members.map((m) => m.kind)));
const rest = kinds.filter((k) => !placed.has(k.kind));
if (rest.length) sections.push({ name: "More", members: rest });

const extras = [
  { kind: "terrain-mountains", of: "terrain", title: "Mountains", cmd: "godotwright model build terrain --set relief=mountains --set maxHeight=90 -o mountains.glb", text: "The same terrain kind with ridged mountains. Neighbouring tiles continue each other exactly." },
  { kind: "terrain-island", of: "terrain", title: "Island", cmd: "godotwright model build terrain --set relief=island -o island.glb", text: "One landmass with the sea floor around it." },
  { kind: "terrain-lake", of: "terrain", title: "Lake", cmd: "godotwright model build terrain --set lakeRadius=45 --set lakeDepth=8 -o lake.glb", text: "A lake carved into the ground, with the water level just under the lowest point of its shore." },
];

const card = (kind, heading, text, cmd) => {
  const picture = existsSync(docs(`gallery/${kind}.jpg`));
  return `        <figure class="model">
          ${picture ? `<img src="gallery/${kind}.jpg" width="400" height="300" loading="lazy" alt="${esc(heading)}: a 3D model built by Godotwright">` : ""}
          <figcaption>
            <h3>${esc(heading)}</h3>
            <p>${esc(text)}</p>
            <code>${esc(cmd)}</code>
          </figcaption>
        </figure>`;
};

const body = sections
  .map((s) => {
    const cards = s.members.map((m) => card(m.kind, title(m.kind), short(m.description), `npx -y godotwright model build ${m.kind} -o ${m.kind}.glb`));
    if (s.name === "Terrain and water") for (const e of extras) cards.push(card(e.kind, e.title, e.text, `npx -y ${e.cmd}`));
    return `  <section id="${s.name.toLowerCase().replace(/[^a-z]+/g, "-")}">
    <div class="wrap">
      <h2>${esc(s.name)}</h2>
      <div class="models">
${cards.join("\n")}
      </div>
    </div>
  </section>`;
  })
  .join("\n\n");

const count = kinds.length;
const nav = sections.map((s) => `<a href="#${s.name.toLowerCase().replace(/[^a-z]+/g, "-")}">${esc(s.name)}</a>`).join("\n      ");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${count} ready-made 3D models for Godot, built from code | Godotwright</title>
<meta name="description" content="Cars, aircraft, ships, buildings, trees, terrain with lakes and rivers and more: ${count} parametric 3D models that a coding agent can build, view and check for Godot 4 with Godotwright. Clean .glb files, no Blender needed.">
<link rel="canonical" href="https://laaielichter.github.io/Godotwright/models.html">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#1d2229">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Godotwright">
<meta property="og:title" content="${count} ready-made 3D models for Godot, built from code">
<meta property="og:description" content="Parametric .glb models a coding agent can build, view and check: vehicles, aircraft, ships, buildings, plants, terrain. MIT, no Blender.">
<meta property="og:url" content="https://laaielichter.github.io/Godotwright/models.html">
<meta property="og:image" content="https://laaielichter.github.io/Godotwright/gallery/overview.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${count} ready-made 3D models for Godot, built from code">
<meta name="twitter:description" content="Parametric .glb models a coding agent can build, view and check. MIT, no Blender.">
<meta name="twitter:image" content="https://laaielichter.github.io/Godotwright/gallery/overview.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;600&display=swap">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "Ready-made 3D models for Godot, built from code",
  "url": "https://laaielichter.github.io/Godotwright/models.html",
  "isPartOf": { "@type": "WebSite", "name": "Godotwright", "url": "https://laaielichter.github.io/Godotwright/" },
  "description": "Parametric 3D models (.glb) that a coding agent can build, view and check with Godotwright."
}
</script>
${style.replace("</style>", `
.models { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); gap: 1rem; }
.model { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; display: grid; grid-template-rows: auto 1fr; }
.model img { display: block; width: 100%; height: auto; background: var(--panel-2); aspect-ratio: 4 / 3; object-fit: cover; }
.model figcaption { padding: .8rem 1rem 1rem; display: grid; gap: .4rem; align-content: start; }
.model h3 { font-size: 1.05rem; }
.model p { color: var(--muted); font-size: .92rem; margin: 0; }
.model code { font-size: .74rem; color: var(--muted); overflow-wrap: anywhere; }
.how { display: grid; gap: .6rem; counter-reset: step; padding: 0; list-style: none; max-width: 70ch; }
.how li { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: .7rem 1rem; }
</style>`)}
</head>
<body>
<header class="bar">
  <div class="wrap">
    <a class="brand" href="./"><img src="logo.svg" alt="" width="28" height="28">Godotwright</a>
    <nav aria-label="Main">
      <a href="./">Home</a>
      ${nav}
      <a href="https://github.com/laaielichter/Godotwright">GitHub</a>
    </nav>
  </div>
</header>

<main>
  <div class="wrap hero">
    <p class="eyebrow">3D models from code</p>
    <h1>${count} ready-made models for <em>Godot&nbsp;4</em>.</h1>
    <p class="lede">A coding agent can build every model on this page with one command, change its size and parts, look at it as text, and check it: clean <code>.glb</code> files with UVs, tangents, a node per moving part and the pivots Godot scripts expect. No Blender, no art tool, the same bytes every time.</p>
    <div class="cta">
      <a class="btn primary" href="https://github.com/laaielichter/Godotwright#readme">Install in 1 minute</a>
      <a class="btn" href="https://github.com/laaielichter/Godotwright/blob/main/docs/cheap-models.md">Works with small, cheap models too</a>
    </div>
    <img src="gallery/overview.jpg" width="1200" height="600" alt="A sheet of models built by Godotwright: cars, aircraft, boats, buildings, trees and terrain" style="width:100%;height:auto;border-radius:8px;border:1px solid var(--line)">
    <p class="caption">Real renders of the default model of each kind, with a simple three.js viewer. They are clean base models, meant to be refined, not hand-sculpted art.</p>
  </div>

  <section id="how">
    <div class="wrap">
      <h2>How an agent builds a model</h2>
      <ol class="how">
        <li><strong>Identify.</strong> <code>godotwright model identify "a tractor"</code> says what a thing is: its parts, typical size, variants, pivots and what to anticipate. English or Dutch, typos and descriptions work.</li>
        <li><strong>Build.</strong> <code>godotwright model build car --set width=1.9 -o car.glb</code> from a ready-made kind, or from your own JSON spec of named parts.</li>
        <li><strong>View.</strong> <code>godotwright model view car.glb</code> draws front, side and top views as text, with a table of the parts, for agents that cannot see a picture.</li>
        <li><strong>Check.</strong> <code>godotwright model lint car.glb --archetype car</code> scores geometry, materials and performance, and checks it is what it should be: required parts, pivots, wheel axes, size, direction.</li>
      </ol>
    </div>
  </section>

${body}

  <section id="faq">
    <div class="wrap">
      <h2>FAQ</h2>
      <div class="faq">
        <details><summary>Do I need Blender or Godot installed?</summary><p>No. Models are built and checked by Godotwright itself. Godot only loads the result when you open the <code>.glb</code> in your project.</p></details>
        <details><summary>Can I change the models?</summary><p>Yes. Every kind has parameters with ranges (<code>godotwright model kinds</code> lists them), and every recipe is a JSON spec you can copy and edit.</p></details>
        <details><summary>Can a cheap model like Haiku or a Flash model do this?</summary><p>Yes, with limits. In a small test, six Haiku agents each built a recognisable model, but they worked blind; that is why <code>model view</code> and a check for loose parts exist. See <a href="https://github.com/laaielichter/Godotwright/blob/main/docs/cheap-models.md">the write-up</a>.</p></details>
        <details><summary>How good are they?</summary><p>They are clean, correctly scaled base models with the right parts and pivots, not sculpted art. The point is a solid start that an agent can refine, and models that load and animate in Godot without fixing.</p></details>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="wrap">
    <span>Godotwright · MIT licensed · not affiliated with the Godot Engine project</span>
    <span><a href="./">Home</a> · <a href="https://github.com/laaielichter/Godotwright">GitHub</a> · <a href="https://github.com/laaielichter/Godotwright/blob/main/ROADMAP.md">Roadmap</a> · <a href="https://github.com/laaielichter/Godotwright/issues">Issues</a></span>
  </div>
</footer>
</body>
</html>
`;

writeFileSync(docs("models.html"), page);
console.log(`docs/models.html: ${count} kinds in ${sections.length} groups, ${kinds.filter((k) => existsSync(docs(`gallery/${k.kind}.jpg`))).length} with a picture`);
