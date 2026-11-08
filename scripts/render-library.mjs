// Renders the asset library in Godot: contact sheets per family, or the gallery picture of the README (docs/library.png).
//
//   npm run build
//   node scripts/render-library.mjs --gallery                                 # docs/library.png: one asset of every family
//   node scripts/render-library.mjs --out /tmp/sheets [category] [family]     # <out>/<category>--<family>.png, 6 per row
//   node scripts/render-library.mjs --site                                    # docs/library/<category>--<family>.jpg for docs/library.html
//
// Needs Godot 4.7 ($GODOT, or godot on the PATH) and, on Linux without a display, xvfb-run. It builds the assets from
// the current source, imports them into a temporary Godot project and renders them with the Compatibility renderer under
// calibrated light (scripts/library/render_sheets.gd), so the pictures show what a game sees. Option: --cell <px>.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGlb } from "../dist/build/glb.js";
import { buildSpec } from "../dist/build/spec.js";
import { findGodot } from "../dist/check/godot.js";
import { loadAssetLibrary } from "../dist/library/library.js";

/** Pixels per asset on the site's sheets; keep in step with CELL in scripts/build-library-site.mjs. */
const SITE_CELL = 192;

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  return value;
};
const flag = (name) => {
  const at = args.indexOf(name);
  if (at >= 0) args.splice(at, 1);
  return at >= 0;
};
const gallery = flag("--gallery");
const site = flag("--site");
const out = option("--out") ?? fileURLToPath(new URL(site ? "../docs/library/" : "../docs/", import.meta.url));
const cell = Number(option("--cell") ?? (gallery ? 160 : site ? SITE_CELL : 256));
const [category, family] = args;

const godot = findGodot();
const project = mkdtempSync(join(tmpdir(), "godotwright-library-render-"));
writeFileSync(
  join(project, "project.godot"),
  'config_version=5\n\n[application]\nconfig/name="Library render"\nconfig/features=PackedStringArray("4.7")\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\nrenderer/rendering_method.mobile="gl_compatibility"\n',
);
copyFileSync(new URL("./library/render_sheets.gd", import.meta.url), join(project, "render_sheets.gd"));

const seen = new Set();
let n = 0;
for (const a of loadAssetLibrary().values()) {
  if (gallery ? seen.has(a.family) : (category && a.category !== category) || (family && a.family !== family)) continue;
  seen.add(a.family);
  const group = gallery ? "library" : `${a.category}--${a.family}`;
  mkdirSync(join(project, "assets", group), { recursive: true });
  writeFileSync(join(project, "assets", group, `${String(n++).padStart(4, "0")}-${a.id.split("/")[1]}.glb`), buildGlb(buildSpec(a.spec)));
}
if (n === 0) throw new Error(`no library assets match "${category ?? ""} ${family ?? ""}"`);
console.log(`built ${n} assets into ${project}`);

execFileSync(godot, ["--headless", "--path", project, "--import"], { stdio: "ignore" });
const headless = process.platform === "linux" && !process.env["DISPLAY"];
const [bin, pre] = headless ? ["xvfb-run", ["-a", "-s", "-screen 0 1280x1024x24", godot]] : [godot, []];
execFileSync(bin, [...pre, "--path", project, "--script", "res://render_sheets.gd", "--", String(cell), gallery ? "12" : "6", site ? "jpg" : "png"], { stdio: ["ignore", "inherit", "ignore"] });

mkdirSync(out, { recursive: true });
for (const f of readdirSync(join(project, "sheets"))) copyFileSync(join(project, "sheets", f), join(out, f));
rmSync(project, { recursive: true, force: true });
console.log(`sheets in ${out}`);
