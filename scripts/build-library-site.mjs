// Writes docs/library.html: every asset of the library on one page, with its picture, parameters and build command,
// searchable in English or Dutch words.
//
//   npm run build && node scripts/render-library.mjs --site && node scripts/build-library-site.mjs
//
// The pictures are the Godot renders in docs/library/<category>--<family>.jpg (6 per row, CELL pixels each, in the order of
// the family), shown as sprites, so the page loads 69 images instead of 1000. The assets, titles and parameters come from
// the code, so the page cannot drift from what the tool builds; a test checks that every asset is on it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { libraryOverview, loadAssetLibrary } from "../dist/library/library.js";

/** Pixels per asset on the sheets; keep in step with SITE_CELL in scripts/render-library.mjs. */
const CELL = 192;
const COLS = 6;
/** Shown size of a picture on the page. */
const SHOW = 160;

const docs = (name) => fileURLToPath(new URL(`../docs/${name}`, import.meta.url));
const index = readFileSync(docs("index.html"), "utf8");
const style = index.slice(index.indexOf("<style>"), index.indexOf("</style>") + "</style>".length);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const all = [...loadAssetLibrary().values()];
const overview = libraryOverview();
const total = all.length;
const scale = SHOW / CELL;
const CATEGORY_TITLE = { furniture: "Furniture", street: "Street furniture", storage: "Storage and industry", nature: "Nature", buildings: "Buildings", vehicles: "Vehicles", props: "Props" };

let pictures = 0;
const sections = overview
  .map((c) => {
    const families = c.families
      .map((f) => {
        const sheet = `library/${c.category}--${f.family}.jpg`;
        const hasSheet = existsSync(docs(sheet));
        const members = all.filter((a) => a.family === f.family);
        const params = members[0].spec.params.map((p) => p.name).join(", ");
        const cards = members
          .map((a, i) => {
            const x = (i % COLS) * SHOW, y = Math.floor(i / COLS) * SHOW;
            if (hasSheet) pictures++;
            const words = `${a.title} ${a.id} ${a.tags.join(" ")} ${a.archetype}`.toLowerCase();
            const thumb = hasSheet
              ? `<div class="thumb" role="img" aria-label="${esc(a.title)}" style="background-image:url(${sheet});background-position:-${x}px -${y}px"></div>`
              : `<div class="thumb"></div>`;
            return `          <figure class="asset" data-words="${esc(words)}">
            ${thumb}
            <figcaption><h4>${esc(a.title)}</h4><code>${esc(a.id)}</code></figcaption>
          </figure>`;
          })
          .join("\n");
        return `      <section class="family" id="${esc(f.family)}">
        <h3>${esc(f.family.replace(/-/g, " "))} <span>${f.count} assets · <code>${esc(f.archetype)}</code> · parameters: ${esc(params)}</span></h3>
        <div class="assets">
${cards}
        </div>
      </section>`;
      })
      .join("\n");
    return `  <section class="category" id="${c.category}">
    <div class="wrap">
      <h2>${esc(CATEGORY_TITLE[c.category] ?? c.category)} <span>${c.count}</span></h2>
${families}
    </div>
  </section>`;
  })
  .join("\n\n");

const nav = overview.map((c) => `<a href="#${c.category}">${esc(CATEGORY_TITLE[c.category] ?? c.category)}</a>`).join("\n      ");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${total} 3D base models for Godot: the Godotwright asset library</title>
<meta name="description" content="${total} ready-made, parametric 3D base models for Godot 4: furniture, street furniture, storage, nature, buildings, vehicles and props. Every one builds a clean .glb, passes the model lint and loads in Godot; agents build them by id or start their own from the spec.">
<link rel="canonical" href="https://laaielichter.github.io/Godotwright/library.html">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#1d2229">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Godotwright">
<meta property="og:title" content="${total} 3D base models for Godot, built from code">
<meta property="og:description" content="The Godotwright asset library: parametric .glb base models a coding agent can build, change and check. Rendered in Godot 4.7.">
<meta property="og:url" content="https://laaielichter.github.io/Godotwright/library.html">
<meta property="og:image" content="https://laaielichter.github.io/Godotwright/library.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://laaielichter.github.io/Godotwright/library.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;600&display=swap">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "The Godotwright asset library",
  "url": "https://laaielichter.github.io/Godotwright/library.html",
  "isPartOf": { "@type": "WebSite", "name": "Godotwright", "url": "https://laaielichter.github.io/Godotwright/" },
  "description": "${total} parametric 3D base models (.glb) for Godot 4 that a coding agent can build and change."
}
</script>
${style.replace(
  "</style>",
  `
.category h2 span, .family h3 span { color: var(--muted); font-weight: 400; font-size: .8em; }
.family { margin: 1.6rem 0 0; scroll-margin-top: 6rem; }
.category { scroll-margin-top: 5rem; }
.family h3 { text-transform: capitalize; font-size: 1.1rem; margin-bottom: .6rem; }
.family h3 span { text-transform: none; font-size: .78rem; }
.assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(${SHOW}px, 1fr)); gap: .6rem; }
.asset { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.asset .thumb { width: ${SHOW}px; height: ${SHOW}px; margin: 0 auto; background-color: var(--panel-2); background-size: ${COLS * SHOW}px auto; background-repeat: no-repeat; }
.asset figcaption { padding: .45rem .6rem .6rem; display: grid; gap: .2rem; }
.asset h4 { font-size: .86rem; margin: 0; }
.asset code { font-size: .66rem; color: var(--muted); overflow-wrap: anywhere; }
.asset.hidden, .family.hidden, .category.hidden { display: none; }
.search { position: sticky; top: 0; z-index: 2; background: var(--bg); padding-block: .8rem; }
.search input { width: 100%; font: inherit; padding: .7rem .9rem; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); }
.search p { margin: .4rem 0 0; color: var(--muted); font-size: .85rem; }
</style>`,
)}
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
    <p class="eyebrow">Asset library</p>
    <h1>${total} base models for <em>Godot&nbsp;4</em>, built from code.</h1>
    <p class="lede">Every model below is a parametric spec that builds a clean <code>.glb</code> (UVs, tangents, textures with normal maps, a node per part, pivots on hinges and hubs), passes the model lint and the check against what the thing is, and loads in Godot 4.7, all tested. A coding agent builds one by its id, changes its parameters, or copies its spec as the start of its own model.</p>
    <pre><code>godotwright model library "eiken stoel"                      # search, English or Dutch
godotwright model build furniture/dining-chair-oak-ladder -o chair.glb --collision convex
godotwright model library furniture/dining-chair-oak-ladder --spec > my-chair.json</code></pre>
    <p class="caption">Pictures: rendered in Godot 4.7 (Compatibility renderer, AgX, one sun), the model as built, nothing added. ${pictures} of ${total} shown with a picture.</p>
  </div>

  <div class="wrap search">
    <input id="q" type="search" placeholder="Search ${total} assets: oak chair, red bench, pine, container, boot ..." aria-label="Search the asset library">
    <p id="count">${total} assets</p>
  </div>

${sections}
</main>

<footer>
  <div class="wrap">
    <span>Godotwright · MIT licensed · not affiliated with the Godot Engine project</span>
    <span><a href="./">Home</a> · <a href="models.html">Model kinds</a> · <a href="https://github.com/laaielichter/Godotwright/blob/main/LIBRARY.md">LIBRARY.md</a> · <a href="https://github.com/laaielichter/Godotwright">GitHub</a></span>
  </div>
</footer>
<script>
const DUTCH = { eiken: "oak", stoel: "chair", tafel: "table", kast: "cupboard", bank: "sofa bench", boom: "tree", struik: "bush", rots: "rock", bloem: "flower", huis: "house", schuur: "shed barn", auto: "car", fiets: "bicycle", boot: "boat", kist: "chest crate", ton: "barrel", rood: "red", rode: "red", blauw: "blue", groen: "green", geel: "yellow", wit: "white", zwart: "black", houten: "wood", hout: "wood", lamp: "lamp", bed: "bed", hek: "fence", paal: "post bollard", vrachtwagen: "truck", toren: "tower", kerk: "church", tent: "tent" };
const q = document.getElementById("q"), count = document.getElementById("count");
const assets = [...document.querySelectorAll(".asset")];
q.addEventListener("input", () => {
  const words = q.value.toLowerCase().split(/\\s+/).filter(Boolean).map((w) => [w, ...(DUTCH[w] ?? "").split(" ").filter(Boolean)]);
  let shown = 0;
  for (const a of assets) {
    const hit = words.every((alts) => alts.some((w) => a.dataset.words.includes(w)));
    a.classList.toggle("hidden", !hit);
    if (hit) shown++;
  }
  for (const f of document.querySelectorAll(".family")) f.classList.toggle("hidden", !f.querySelector(".asset:not(.hidden)"));
  for (const c of document.querySelectorAll(".category")) c.classList.toggle("hidden", !c.querySelector(".family:not(.hidden)"));
  count.textContent = shown + " of ${total} assets";
});
</script>
</body>
</html>
`;

writeFileSync(docs("library.html"), page);
console.log(`docs/library.html: ${total} assets, ${pictures} with a picture`);
