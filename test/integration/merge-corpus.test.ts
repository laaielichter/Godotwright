import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseResourceText } from "../../src/godot/scene.js";
import { mergeKindOf, mergeText } from "../../src/merge/merge.js";

/**
 * The merge on real files: set GODOTWRIGHT_CORPUS to a folder with Godot projects. Nothing is written there.
 * For every .tscn, .tres and project.godot: two sides that each make a different change must merge without a
 * conflict into a file that still parses, with every reference resolving and every parent before its children.
 */
const CORPUS = process.env["GODOTWRIGHT_CORPUS"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === ".godot" || name === "node_modules") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (mergeKindOf(full)) out.push(full);
  }
  return out;
}

function sound(text: string): string | undefined {
  const scene = parseResourceText(text);
  if (scene.misplaced.length) return `misplaced ${scene.misplaced[0]!.tag}`;
  const ids = new Set([...scene.extResources.map((e) => e.id), ...scene.subResources.map((s) => s.id)]);
  for (const ref of scene.refs) if (!ids.has(ref.id)) return `dangling ${ref.kind} ${ref.id}`;
  const seen = new Set<string>();
  for (const node of scene.nodes) {
    const parent = node.path === "." ? undefined : node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : ".";
    // A parent that only exists inside an instanced scene is not in this file.
    if (parent !== undefined && !seen.has(parent) && scene.nodes.some((n) => n.path === parent)) return `node ${node.path} before its parent`;
    seen.add(node.path);
  }
  return undefined;
}

describe.skipIf(!CORPUS)("merge on a corpus of real files", () => {
  it("merges two different changes into a sound file, for every scene and resource", () => {
    const files = walk(CORPUS!);
    const problems: string[] = [];
    let merged = 0, skipped = 0;
    for (const file of files) {
      const kind = mergeKindOf(file)!;
      const base = readFileSync(file, "utf8");
      if (kind === "settings") {
        const ours = `${base.trimEnd()}\n\n[zz_ours]\n\na=1\n`;
        const theirs = `${base.trimEnd()}\n\n[zz_theirs]\n\nb=2\n`;
        const r = mergeText(base, ours, theirs, kind);
        if (r.conflicts.length || !r.text.includes("[zz_ours]") || !r.text.includes("[zz_theirs]")) problems.push(`${file}: settings`);
        merged++;
        continue;
      }
      let scene;
      try {
        scene = parseResourceText(base);
      } catch {
        skipped++;
        continue;
      }
      if (sound(base) !== undefined) {
        skipped++; // already unsound before any merge
        continue;
      }
      const root = scene.nodes[0];
      const isScene = kind === "scene" && root !== undefined;
      // Ours adds a node (or a property on a resource), theirs adds another one with a new ext_resource.
      const ours = isScene ? `${base.trimEnd()}\n\n[node name="ZzOurs" type="Node" parent="."]\n` : base.replace(/\n\[resource\]\n/, "\n[resource]\nzz_ours = 1\n");
      const ext = `[ext_resource type="Script" path="res://zz_theirs.gd" id="zz_1"]`;
      const header = base.slice(0, base.indexOf("\n"));
      const theirsBase = base.replace(header, `${header}\n\n${ext}`);
      const theirs = isScene ? `${theirsBase.trimEnd()}\n\n[node name="ZzTheirs" type="Node" parent="."]\nscript = ExtResource("zz_1")\n` : theirsBase.replace(/\n\[resource\]\n/, '\n[resource]\nzz_theirs = ExtResource("zz_1")\n');
      if (ours === base || theirs === theirsBase) {
        skipped++;
        continue;
      }
      try {
        const r = mergeText(base, ours, theirs, kind);
        const bad = sound(r.text);
        const out = parseResourceText(r.text);
        if (r.conflicts.length) problems.push(`${file}: ${r.conflicts.length} conflicts (${r.conflicts[0]!.where}: ${r.conflicts[0]!.what})`);
        else if (bad) problems.push(`${file}: ${bad}`);
        else if (isScene && out.nodes.length !== scene.nodes.length + 2) problems.push(`${file}: ${out.nodes.length} nodes, expected ${scene.nodes.length + 2}`);
        else if (out.extResources.length !== scene.extResources.length + 1) problems.push(`${file}: ext_resources`);
        else if (out.subResources.length !== scene.subResources.length || out.connections.length !== scene.connections.length) problems.push(`${file}: lost a sub_resource or connection`);
        // The same merge from the other side keeps the same things.
        const back = parseResourceText(mergeText(base, theirs, ours, kind).text);
        if (back.nodes.length !== out.nodes.length || back.extResources.length !== out.extResources.length) problems.push(`${file}: not symmetric`);
        merged++;
      } catch (error) {
        problems.push(`${file}: threw ${(error as Error).message}`);
      }
    }
    process.stderr.write(`merge corpus: ${files.length} files, ${merged} merged, ${skipped} skipped, ${problems.length} problems\n${problems.slice(0, 15).join("\n")}\n`);
    expect(problems).toEqual([]);
    expect(merged).toBeGreaterThan(0);
  }, 600_000);
});
