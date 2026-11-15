// Writes docs/library.html: every asset of the library on one page, in the look of the rest of the site (the same
// stylesheet and the same model cards as the home page), with filters per category and family and a search in English
// or Dutch words.
//
//   npm run build && node scripts/render-library.mjs --site && node scripts/build-library-site.mjs
//
// The pictures are the Godot renders in docs/library/<category>--<family>.jpg: one sheet per family, 6 cells per row, each
// cell 4:3 like the cards of the site. A card shows its cell as a CSS sprite and loads the sheet only when it comes into
// view, so the page fetches the sheets it needs instead of 1000 pictures. The assets, titles and parameters come from the
// code, so the page cannot drift from what the tool builds; a test checks that every asset is on it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { libraryOverview, loadAssetLibrary } from "../dist/library/library.js";

const COLS = 6;

const docs = (name) => fileURLToPath(new URL(`../docs/${name}`, import.meta.url));
const index = readFileSync(docs("index.html"), "utf8");
const style = index.slice(index.indexOf("<style>"), index.indexOf("</style>") + "</style>".length);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const all = [...loadAssetLibrary().values()];
const overview = libraryOverview();
const total = all.length;
const CATEGORY = { furniture: "Furniture", street: "Street furniture", storage: "Storage and industry", nature: "Nature", buildings: "Buildings", vehicles: "Vehicles", props: "Props" };
const nice = (family) => family.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
/** The first sentence of a description, for the card. */
const short = (text) => (text.split(/(?<=\.)\s/)[0] ?? text).replace(/\s*It faces \+z\.?$/, "");

let pictures = 0;
const cards = [];
for (const c of overview) {
  for (const f of c.families) {
    const members = all.filter((a) => a.family === f.family);
    const sheet = `library/${c.category}--${f.family}.jpg`;
    const hasSheet = existsSync(docs(sheet));
    const rows = Math.ceil(members.length / COLS);
    members.forEach((a, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = ((col / (COLS - 1)) * 100).toFixed(3);
      const y = rows > 1 ? ((row / (rows - 1)) * 100).toFixed(3) : "0";
      if (hasSheet) pictures++;
      const words = `${a.title} ${a.id} ${a.tags.join(" ")} ${a.archetype}`.toLowerCase();
      const picture = hasSheet
        ? `<div class="model-image"><div class="sprite" role="img" aria-label="${esc(a.title)}, rendered in Godot" data-sheet="${sheet}" data-size="${COLS * 100}% ${rows * 100}%" data-pos="${x}% ${y}%"></div></div>`
        : `<div class="model-image"><div class="sprite"></div></div>`;
      cards.push(`      <article class="model-card" data-id="${esc(a.id)}" data-category="${c.category}" data-family="${esc(f.family)}" data-words="${esc(words)}">${picture}<div class="model-info"><span>${esc(CATEGORY[c.category])} · ${esc(nice(f.family))}</span><h3>${esc(a.title)}</h3><p>${esc(short(a.description))}</p><code>model build ${esc(a.id)}</code></div></article>`);
    });
  }
}

const buttons = [`<button type="button" aria-pressed="true" data-filter="all">All ${total}</button>`, ...overview.map((c) => `<button type="button" aria-pressed="false" data-filter="${c.category}">${esc(CATEGORY[c.category])} ${c.count}</button>`)].join("");
const families = Object.fromEntries(overview.map((c) => [c.category, c.families.map((f) => ({ id: f.family, title: nice(f.family), count: f.count }))]));

const page = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${total} 3D base models for Godot, built from code | Godotwright</title>
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
.library-tools { display: grid; gap: 14px; margin-top: 18px; }
.library-tools input[type="search"] { width: 100%; font: inherit; padding: 13px 18px; border-radius: 30px; border: 1px solid #35464e; background: #0d1721; color: var(--fg); }
.library-tools input[type="search"]::placeholder { color: #7f939b; }
.library-tools input[type="search"]:focus-visible { outline: 2px solid #b9f1d3; outline-offset: 2px; }
.family-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.family-chips[hidden] { display: none; }
.family-chips button { background: transparent; border: 1px solid #2b3c46; border-radius: 30px; padding: 5px 13px; color: #9fb2ba; font-size: .72rem; cursor: pointer; }
.family-chips button[aria-pressed="true"] { border-color: #b9f1d3; color: #b9f1d3; }
.model-card { content-visibility: auto; contain-intrinsic-size: auto 420px; }
.model-image .sprite { width: 100%; aspect-ratio: 4 / 3; background-color: #7e9c6c; background-repeat: no-repeat; }
.empty { color: #adbdc3; padding: 40px 0; }
</style>`,
)}
<link rel="stylesheet" href="assets/site.css">
</head>
<body class="home">
<a class="skip-link" href="#main">Skip to content</a>

<header class="bar">
  <div class="wrap">
    <a class="brand" href="./"><img src="logo.svg" alt="" width="28" height="28">Godotwright</a>
    <nav aria-label="Main"><a href="./">Home</a><a href="./#models">3D models</a><a href="models.html">59 kinds</a><a href="library.html" aria-current="page">Asset library</a><a href="install.html">Docs</a><a href="https://github.com/laaielichter/Godotwright">GitHub</a></nav>
  </div>
</header>

<main id="main">
  <section id="models"><div class="wrap">
    <div class="section-heading"><div><p class="eyebrow">The asset library</p><h2>${total} base models.<br>Every one tested in Godot.</h2></div><p class="sub">Parametric specs that build a clean .glb: UVs, tangents, textures, a node per part, pivots on hinges and hubs. An agent builds one by its id, changes its parameters, or copies the spec as the start of its own model. Search in English or Dutch. These are actual renders in Godot 4.7.</p></div>
    <div class="library-tools">
      <input id="q" type="search" placeholder="Search ${total} models: oak chair, rode bank, pine tree, container ..." aria-label="Search the asset library" autocomplete="off">
      <div class="gallery-controls" role="group" aria-label="Filter by category">${buttons}<span id="gallery-count" role="status">${total} models</span></div>
      <div class="family-chips" id="family-chips" role="group" aria-label="Filter by family" hidden></div>
    </div>
    <div class="model-grid" id="grid">
${cards.join("\n")}
    </div>
    <p class="empty" id="empty" hidden>No model matches. Try fewer words, or English ones.</p>
    <div class="cta"><a class="btn primary" href="https://github.com/laaielichter/Godotwright#readme">Install in 1 minute</a><a class="btn" href="https://github.com/laaielichter/Godotwright/blob/main/LIBRARY.md">The list as text (LIBRARY.md)</a><span class="sub">Build one: <code>godotwright model build furniture/dining-chair-oak-ladder -o chair.glb</code>. Its spec: <code>godotwright model library furniture/dining-chair-oak-ladder --spec</code>.</span></div>
  </div></section>
</main>

<footer>
  <div class="wrap">
    <span>Godotwright · MIT licensed · not affiliated with the Godot Engine project</span>
    <span><a href="./">Home</a> · <a href="models.html">59 kinds</a> · <a href="https://github.com/laaielichter/Godotwright/blob/main/LIBRARY.md">LIBRARY.md</a> · <a href="https://github.com/laaielichter/Godotwright">GitHub</a> · <a href="https://github.com/laaielichter/Godotwright/issues">Issues</a></span>
  </div>
</footer>
<script>
(() => {
  const FAMILIES = ${JSON.stringify(families)};
  const DUTCH = { eiken: "oak", stoel: "chair", tafel: "table", kast: "cupboard", bank: "sofa bench", boom: "tree", struik: "bush", rots: "rock", bloem: "flower", huis: "house", schuur: "shed barn", auto: "car", fiets: "bicycle", boot: "boat", kist: "chest crate", ton: "barrel", rood: "red", rode: "red", blauw: "blue", groen: "green", geel: "yellow", wit: "white", zwart: "black", houten: "wood", hout: "wood", bed: "bed", hek: "fence", paal: "post bollard", vrachtwagen: "truck", toren: "tower", kerk: "church", tent: "tent", lamp: "lamp", vuur: "fire", put: "well", ladder: "ladder" };
  const $ = (id) => document.getElementById(id);
  const cards = [...document.querySelectorAll(".model-card")];
  const state = { category: "all", family: "", words: [] };

  // A sheet is fetched when its first card comes near the screen.
  const show = (sprite) => {
    sprite.style.backgroundImage = "url(" + sprite.dataset.sheet + ")";
    sprite.style.backgroundSize = sprite.dataset.size;
    sprite.style.backgroundPosition = sprite.dataset.pos;
  };
  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      show(e.target);
    }
  }, { rootMargin: "600px" }) : null;
  for (const sprite of document.querySelectorAll(".sprite[data-sheet]")) {
    if (io) io.observe(sprite);
    else show(sprite);
  }

  function apply() {
    let shown = 0;
    for (const card of cards) {
      const hit = (state.category === "all" || card.dataset.category === state.category)
        && (!state.family || card.dataset.family === state.family)
        && state.words.every((alts) => alts.some((w) => card.dataset.words.includes(w)));
      card.hidden = !hit;
      if (hit) shown++;
    }
    $("gallery-count").textContent = shown + (shown === 1 ? " model" : " models");
    $("empty").hidden = shown !== 0;
  }

  const chips = $("family-chips");
  function showFamilies() {
    chips.textContent = "";
    const list = FAMILIES[state.category] || [];
    chips.hidden = list.length === 0;
    for (const f of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.family = f.id;
      b.setAttribute("aria-pressed", "false");
      b.textContent = f.title + " " + f.count;
      chips.append(b);
    }
  }
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.family = state.family === b.dataset.family ? "" : b.dataset.family;
    for (const x of chips.children) x.setAttribute("aria-pressed", String(x.dataset.family === state.family));
    apply();
  });
  const buttons = [...document.querySelectorAll("[data-filter]")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      state.category = button.dataset.filter;
      state.family = "";
      for (const x of buttons) x.setAttribute("aria-pressed", String(x === button));
      showFamilies();
      apply();
    });
  }
  $("q").addEventListener("input", (e) => {
    state.words = e.target.value.toLowerCase().split(/\\s+/).filter(Boolean).map((w) => [w, ...(DUTCH[w] ?? "").split(" ").filter(Boolean)]);
    apply();
  });
})();
</script>
</body>
</html>
`;

writeFileSync(docs("library.html"), page);
console.log(`docs/library.html: ${total} assets, ${pictures} with a picture`);
