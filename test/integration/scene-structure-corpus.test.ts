import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseResourceText, type ResourceFile, type SceneNode } from "../../src/godot/scene.js";
import { editScene, type SceneEdit } from "../../src/scene/edit.js";
import { tempFolder } from "../helpers.js";

/**
 * The scene-structure ops on every .tscn of a real project ($GODOTWRIGHT_CORPUS: a folder; nothing is written there).
 * Each scene is copied alone into a temp project, and every op is done and undone again: rename and rename back, move
 * a leaf and move it back, duplicate and remove the copy, add a group and remove it. After each step the file must
 * still be a scene Godot can read in order, and after each pair it must be the original text.
 */
const CORPUS = process.env["GODOTWRIGHT_CORPUS"];

function scenesIn(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) scenesIn(full, out);
    else if (entry.name.endsWith(".tscn")) out.push(full);
  }
  return out;
}

const parentOf = (path: string): string | undefined => (path === "." ? undefined : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");
const own = (n: SceneNode): boolean => n.path !== "." && (n.type !== undefined || n.instanceRef !== undefined);

/** What is wrong with a scene's shape; compared against the original, because a real file may start with some. */
function problems(parsed: ResourceFile): { misplaced: number; refs: number; order: number; wires: number; twice: number } {
  const ext = new Set(parsed.extResources.map((e) => e.id));
  const sub = new Set(parsed.subResources.map((e) => e.id));
  const seen = new Set<string>();
  const all = new Set(parsed.nodes.map((n) => n.path));
  let order = 0;
  let twice = 0;
  for (const n of parsed.nodes) {
    const parent = parentOf(n.path);
    // A parent this file writes must come first; one that only exists through an instance is not in the file at all.
    if (parent !== undefined && !seen.has(parent) && (all.has(parent) || !parsed.nodes.some((m) => m.instanceRef && (m.path === "." || parent.startsWith(`${m.path}/`) || parent === m.path)))) order++;
    if (seen.has(n.path)) twice++;
    seen.add(n.path);
  }
  const reachable = (path: string): boolean => all.has(path) || parsed.nodes.some((m) => m.instanceRef && (m.path === "." || path.startsWith(`${m.path}/`)));
  return {
    misplaced: parsed.misplaced.length,
    refs: parsed.refs.filter((r) => !(r.kind === "ExtResource" ? ext : sub).has(r.id)).length,
    order,
    wires: parsed.connections.filter((c) => !reachable(c.from) || !reachable(c.to)).length,
    twice,
  };
}

describe.skipIf(!CORPUS)("scene structure ops on a corpus of real scenes", () => {
  it("renames, moves, duplicates and groups nodes in every scene, and gets the original back", () => {
    const files = scenesIn(CORPUS!).sort();
    const failures: string[] = [];
    const stats = { scenes: files.length, unreadable: 0, tried: 0, steps: 0, passed: 0, skipped: {} as Record<string, number> };
    const skip = (why: string) => (stats.skipped[why] = (stats.skipped[why] ?? 0) + 1);
    for (const file of files) {
      const name = relative(CORPUS!, file);
      const original = readFileSync(file, "utf8");
      let parsed: ResourceFile;
      try {
        parsed = parseResourceText(original);
      } catch {
        stats.unreadable++;
        continue;
      }
      if (!parsed.nodes.length) {
        skip("no nodes");
        continue;
      }
      stats.tried++;
      const root = tempFolder("godotwright-corpus-");
      writeFileSync(join(root, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="Corpus"\n');
      const copy = join(root, "scene.tscn");
      mkdirSync(dirname(copy), { recursive: true });
      writeFileSync(copy, original);
      const base = problems(parsed);
      const text = () => readFileSync(copy, "utf8");
      /** One op; false when it failed (the failure is recorded). */
      const step = (label: string, edit: SceneEdit): boolean => {
        stats.steps++;
        try {
          editScene(copy, edit, { write: true });
          const now = problems(parseResourceText(text()));
          const worse = (Object.keys(base) as (keyof typeof base)[]).filter((k) => now[k] > base[k]);
          if (worse.length) {
            failures.push(`${name}: ${label}: more problems after it: ${worse.map((k) => `${k} ${base[k]} -> ${now[k]}`).join(", ")}`);
            return false;
          }
          stats.passed++;
          return true;
        } catch (error) {
          failures.push(`${name}: ${label}: ${(error as Error).message.slice(0, 300)}`);
          return false;
        }
      };
      const restored = (label: string): void => {
        stats.steps++;
        if (text() === original) stats.passed++;
        else {
          const a = original.split("\n");
          const b = text().split("\n");
          const at = a.findIndex((l, i) => l !== b[i]);
          failures.push(`${name}: ${label}: not the original text again, from line ${at + 1}: ${JSON.stringify(a[at])} became ${JSON.stringify(b[at])}`);
          writeFileSync(copy, original);
        }
      };
      const nodes = parsed.nodes;
      const children = (path: string) => nodes.filter((n) => parentOf(n.path) === path);
      const free = (parent: string, child: string) => !children(parent).some((n) => n.name === child);

      // rename and back
      const target = nodes.find((n) => own(n) && free(parentOf(n.path)!, `${n.name}Zq`));
      if (!target) skip("rename: no node of its own besides the root");
      else if (step("rename", { op: "rename_node", node: target.path, name: `${target.name}Zq` })) {
        const renamed = target.path.replace(/[^/]+$/, `${target.name}Zq`);
        if (step("rename back", { op: "rename_node", node: renamed, name: target.name })) restored("rename and back");
      }
      writeFileSync(copy, original);

      // move a leaf to another parent and back
      const leaf = nodes.find((n) => own(n) && !nodes.some((m) => m.path.startsWith(`${n.path}/`)) && nodes.some((p) => p.type && p.path !== n.path && p.path !== parentOf(n.path) && free(p.path, n.name)));
      if (!leaf) skip("move: no leaf with another parent to go to");
      else {
        const from = parentOf(leaf.path)!;
        const to = nodes.find((p) => p.type && p.path !== leaf.path && p.path !== from && free(p.path, leaf.name))!;
        const next = children(from)[children(from).indexOf(leaf) + 1];
        if (step("move", { op: "move_node", node: leaf.path, parent: to.path })) {
          const moved = to.path === "." ? leaf.name : `${to.path}/${leaf.name}`;
          // Back before the sibling it stood before; a parent with inherited children only takes "last".
          const fromNode = nodes.find((n) => n.path === from)!;
          const place = next && fromNode.type ? { before: next.path } : {};
          if (step("move back", { op: "move_node", node: moved, parent: from, ...place })) {
            if (next && !fromNode.type) skip("move: back as last child only (inherited siblings), text not compared");
            else restored("move and back");
          }
        }
      }
      writeFileSync(copy, original);

      // duplicate and remove the copy
      const source = nodes.find((n) => own(n) && free(parentOf(n.path)!, `${n.name}Copy`));
      if (!source) skip("duplicate: no node of its own besides the root");
      else if (step("duplicate", { op: "duplicate_node", node: source.path, name: `${source.name}Copy`, connections: true })) {
        const after = parseResourceText(text());
        const size = nodes.filter((n) => n.path === source.path || n.path.startsWith(`${source.path}/`)).length;
        stats.steps++;
        if (after.nodes.length === nodes.length + size) stats.passed++;
        else failures.push(`${name}: duplicate: ${after.nodes.length - nodes.length} new nodes, expected ${size}`);
        if (step("remove the copy", { op: "remove_node", node: source.path.replace(/[^/]+$/, `${source.name}Copy`) })) {
          // What remove_node does besides taking the copy out is not held against duplicate_node: it sets load_steps
          // right, drops resources nothing uses, and takes the blank lines after the file's last section along.
          const swept = parseResourceText(text());
          const count = (f: ResourceFile) => f.extResources.length + f.subResources.length;
          const steps = /\bload_steps=(\d+)/.exec(original.split("\n")[0] ?? "")?.[1];
          const now = steps ? text().replace(/\bload_steps=\d+/, `load_steps=${steps}`) : text();
          if (text() === original) restored("duplicate and remove");
          else if (count(swept) < count(parsed)) {
            skip("duplicate: remove_node dropped a resource the file never used, text not compared");
            stats.steps++;
            if (swept.nodes.map((n) => n.path).join("\n") === nodes.map((n) => n.path).join("\n")) stats.passed++;
            else failures.push(`${name}: duplicate and remove: not the original nodes again`);
          } else {
            if (now !== text()) skip("duplicate: load_steps was wrong in the file and remove_node corrected it");
            if (now !== original && now.trimEnd() === original.trimEnd()) skip("duplicate: remove_node left other blank lines at the end of the file");
            stats.steps++;
            if (now === original || (now.trimEnd() === original.trimEnd() && now.endsWith("\n"))) stats.passed++;
            else {
              const a = original.split("\n");
              const b = now.split("\n");
              const at = a.findIndex((l, i) => l !== b[i]);
              failures.push(`${name}: duplicate and remove: not the original text again, from line ${at + 1}: ${JSON.stringify(a[at])} became ${JSON.stringify(b[at])}`);
            }
          }
        }
      }
      writeFileSync(copy, original);

      // groups: add and remove
      const grouped = nodes.find(own) ?? nodes[0]!;
      if (step("add a group", { op: "set_groups", node: grouped.path, add: ["zq_corpus"] })) {
        stats.steps++;
        if (parseResourceText(text()).nodes.find((n) => n.path === grouped.path)?.groups.includes("zq_corpus")) stats.passed++;
        else failures.push(`${name}: add a group: the group is not read back`);
        if (step("remove the group", { op: "set_groups", node: grouped.path, remove: ["zq_corpus"] })) restored("group and back");
      }
    }
    const kinds = new Map<string, number>();
    for (const f of failures) {
      const kind = f.split(": ").slice(1, 3).join(": ").replace(/"[^"]*"/g, '"..."').replace(/\d+/g, "N").slice(0, 110);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    console.log(`corpus: ${stats.scenes} scenes, ${stats.unreadable} unreadable, ${stats.tried} tried; ${stats.steps} steps, ${stats.passed} passed, ${failures.length} failed`);
    console.log(`skipped: ${JSON.stringify(stats.skipped)}`);
    for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${String(count).padStart(5)}  ${kind}`);
    for (const f of failures.slice(0, 25)) console.log(f.slice(0, 600));
    expect(failures).toEqual([]);
  }, 1_800_000);
});
