import { basename } from "node:path";
import { findProjectRoot } from "../project/files.js";
import { scanProject } from "../scan/scan.js";

/**
 * The names a project uses for itself: its title, classes, autoloads, files, nodes, groups and input actions.
 * The anonymizer replaces them wherever they appear in a lesson. Empty when there is no project (or it cannot be read).
 */
export function projectNames(path: string): string[] {
  try {
    const root = findProjectRoot(path);
    if (!root) return [];
    const map = scanProject(root);
    const names = new Set<string>();
    const add = (n: string | undefined) => {
      if (n && n.trim().length >= 3) names.add(n.trim());
    };
    add(map.project.name);
    for (const a of map.autoloads) add(a.name);
    for (const a of map.inputActions) add(a.name);
    for (const s of map.scripts) {
      if (s.external) continue;
      add(s.className);
      add(basename(s.path).replace(/\.\w+$/, ""));
    }
    for (const sc of map.scenes) {
      if (sc.external) continue;
      add(basename(sc.path).replace(/\.\w+$/, ""));
      for (const n of sc.nodes) {
        add(n.name);
        for (const g of n.groups) add(g);
      }
    }
    return [...names];
  } catch {
    return [];
  }
}
