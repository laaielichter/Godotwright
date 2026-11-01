// Builds the MCP bundle (.mcpb) for Claude Desktop: one file people double-click to install.
// Run after `npm run build`. Output: build/godotwright.mcpb
//
//   node scripts/build-mcpb.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const MCPB = "@anthropic-ai/mcpb@2.1.2";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const stage = join(root, "build", "mcpb");
// A fixed name, so releases/latest/download/godotwright.mcpb always points at the newest bundle.
const out = join(root, "build", "godotwright.mcpb");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const item of ["dist", "data", "package.json", "package-lock.json", "LICENSE", "PRIVACY.md"]) {
  cpSync(join(root, item), join(stage, item), { recursive: true });
}
cpSync(join(root, "mcpb", "icon.png"), join(stage, "icon.png"));
const manifest = JSON.parse(readFileSync(join(root, "mcpb", "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Runtime dependencies only, and no install scripts (the package's own `prepare` would try to build).
execFileSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage, stdio: "inherit" });
rmSync(join(stage, "package-lock.json"));

execFileSync(npx, ["-y", MCPB, "validate", join(stage, "manifest.json")], { stdio: "inherit" });
rmSync(out, { force: true });
execFileSync(npx, ["-y", MCPB, "pack", stage, out], { stdio: "inherit" });
console.log(`\n${out}`);
