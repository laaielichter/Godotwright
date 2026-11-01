// Renders the pictures of the model gallery: docs/gallery/<kind>.jpg (400 x 300) for every kind `model build` can make,
// a few terrain variants, and docs/gallery/overview.jpg (a 6 x 4 sheet). Then run scripts/build-gallery.mjs for the page.
//
//   npm run build
//   npm install --no-save three@0.170.0 playwright && npx playwright install chromium
//   node scripts/render-gallery.mjs [kind ...]
//
// Each picture is the default model of its kind, rendered with three.js in headless Chromium: a sky for light and
// reflections, one sun with soft shadows, ACES tone mapping, a grass ground (water for boats and ships), and a camera
// that frames the model's bounding box from the front left. Rendered at twice the size and scaled down, for clean edges.
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allKinds, buildKind } from "../dist/build/generators/index.js";
import { buildGlb } from "../dist/build/glb.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
// "three" resolves to build/three.cjs; the files the page loads sit next to it and under examples/.
const threeRoot = dirname(dirname(require.resolve("three")));
const docs = (name) => fileURLToPath(new URL(`../docs/${name}`, import.meta.url));

const W = 400, H = 300;

/** Variants shown in the gallery next to the default kinds (see `extras` in build-gallery.mjs). */
const EXTRAS = [
  { file: "terrain-mountains", kind: "terrain", params: { relief: "mountains", maxHeight: 90 } },
  { file: "terrain-island", kind: "terrain", params: { relief: "island" } },
  { file: "terrain-lake", kind: "terrain", params: { lakeRadius: 45, lakeDepth: 8 } },
];

/** The 24 pictures of the overview sheet, in reading order. */
const OVERVIEW = [
  "car", "helicopter", "airliner", "ship", "tree", "windmill",
  "tank", "train", "church", "house", "sailboat", "drone",
  "terrain-mountains", "terrain-lake", "fighter", "motorcycle", "castle", "barn",
  "bicycle", "truck", "horse", "conifer", "tractor", "dragon",
];

const page = `<!doctype html><html><head><style>html,body{margin:0;background:#000}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head>
<body><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const W = ${W}, H = ${H};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(2);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Light and reflections come from a sky: blue above, a bright horizon, dark ground, and a sun.
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  vertexShader: "varying vec3 d; void main() { d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "varying vec3 d; void main() { vec3 top = vec3(0.18, 0.32, 0.62), hor = vec3(0.75, 0.8, 0.85), gnd = vec3(0.16, 0.17, 0.12);" +
    " vec3 c = d.y > 0.0 ? mix(hor, top, pow(d.y, 0.6)) : mix(hor, gnd, pow(-d.y, 0.4));" +
    " c += vec3(6.0, 5.5, 4.8) * pow(max(dot(d, normalize(vec3(0.45, 0.75, 0.5))), 0.0), 600.0); gl_FragColor = vec4(c, 1.0); }",
})));
const env = pmrem.fromScene(skyScene, 0).texture;
const background = (() => {
  const c = document.createElement("canvas"); c.width = 2; c.height = 256;
  const g = c.getContext("2d"), grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#5f8fc4"); grad.addColorStop(0.55, "#a9c6e2"); grad.addColorStop(1, "#dfe7ec");
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

window.render = async (b64, family) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const model = (await new GLTFLoader().parseAsync(bin.buffer, "")).scene;
  const scene = new THREE.Scene();
  scene.background = background; scene.environment = env; scene.environmentIntensity = 0.9;
  scene.add(model);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !o.material.transparent; o.receiveShadow = true;
    if (o.material.transparent) o.material.depthWrite = false;
  });
  const box = new THREE.Box3().setFromObject(model), center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  if (family !== "world") {
    const water = family === "vessel";
    const ground = new THREE.Mesh(new THREE.CircleGeometry(radius * 6, 96), new THREE.MeshStandardMaterial(water ? { color: 0x1d4a5e, roughness: 0.12 } : { color: 0x6f8a55, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = water ? 0 : box.min.y - 0.002; ground.receiveShadow = true;
    scene.add(ground);
  }
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x55603f, 0.35));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(center.x + radius * 1.6, center.y + radius * 3.2, center.z + radius * 2.2);
  sun.target.position.copy(center);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -radius * 1.6, right: radius * 1.6, top: radius * 1.6, bottom: -radius * 1.6, near: radius * 0.01, far: radius * 10 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02 * Math.max(0.05, radius / 10); sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // From the front left and above, as far away as the bounding box needs to fill about 85 % of the picture.
  const cam = new THREE.PerspectiveCamera(32, W / H, radius / 100, radius * 50);
  const back = new THREE.Vector3(1, 0.55, 1.35).normalize();
  cam.position.copy(center).add(back); cam.lookAt(center); cam.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * 0.85, tanH = tanV * cam.aspect;
  let dist = 0;
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    dist = Math.max(dist, c.dot(back) + Math.abs(c.dot(right)) / tanH, c.dot(back) + Math.abs(c.dot(up)) / tanV);
  }
  cam.position.copy(center).addScaledVector(back, dist); cam.lookAt(center);
  scene.fog = new THREE.Fog(0xdfe7ec, dist * 2.2, dist * 6);
  renderer.render(scene, cam);
  // Scale the double-size render down for clean edges.
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const g = out.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(renderer.domElement, 0, 0, W, H);
  scene.traverse((o) => { o.geometry?.dispose(); });
  return out.toDataURL("image/jpeg", 0.86);
};

window.sheet = async (urls, cols, cw, ch) => {
  const out = document.createElement("canvas"); out.width = cols * cw; out.height = Math.ceil(urls.length / cols) * ch;
  const g = out.getContext("2d"); g.imageSmoothingQuality = "high";
  await Promise.all(urls.map((url, i) => new Promise((done) => {
    const img = new Image(); img.onload = () => { g.drawImage(img, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch); done(); }; img.src = url;
  })));
  return out.toDataURL("image/jpeg", 0.88);
};
window.ready = true;
</script></body></html>`;

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(page);
  if (url.startsWith("/three/")) {
    try {
      return res.writeHead(200, { "content-type": extname(url) === ".js" ? "text/javascript" : "application/octet-stream" }).end(readFileSync(join(threeRoot, url.slice(7))));
    } catch {
      // fall through to 404
    }
  }
  res.writeHead(404).end();
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const tab = await browser.newPage({ viewport: { width: W, height: H } });
tab.on("pageerror", (error) => console.error(`page: ${error.message}`));
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
await tab.waitForFunction(() => window.ready === true);

const kinds = allKinds();
const only = process.argv.slice(2);
const jobs = [...kinds.map((k) => ({ file: k.kind, kind: k.kind, params: {} })), ...EXTRAS].filter((j) => !only.length || only.includes(j.file));
const pictures = new Map();
for (const job of jobs) {
  const family = (kinds.find((k) => k.kind === job.kind)?.archetype ?? "").split(".")[0];
  const glb = buildGlb(buildKind(job.kind, job.params));
  const url = await tab.evaluate(([b64, f]) => window.render(b64, f), [glb.toString("base64"), family]);
  pictures.set(job.file, url);
  writeFileSync(docs(`gallery/${job.file}.jpg`), Buffer.from(url.split(",")[1], "base64"));
  console.log(`docs/gallery/${job.file}.jpg`);
}
if (OVERVIEW.every((f) => pictures.has(f))) {
  const url = await tab.evaluate(([urls]) => window.sheet(urls, 6, 200, 150), [OVERVIEW.map((f) => pictures.get(f))]);
  writeFileSync(docs("gallery/overview.jpg"), Buffer.from(url.split(",")[1], "base64"));
  console.log("docs/gallery/overview.jpg");
}
await browser.close();
server.close();
