import { extension } from "../../project/files.js";
import { isUidText, SIDECAR_EXTENSIONS } from "../../scene/uid.js";
import type { ResourceFile } from "../../godot/scene.js";
import type { SceneInfo } from "../../scan/types.js";
import type { ProjectData, UidClaim } from "../../scan/scan.js";
import { finding, type Finding } from "../rules.js";

/**
 * Scene and resource integrity: the uid and resource-id mistakes that make Godot load the wrong file, warn on every
 * load, fail to load a scene, or drop edits on the next editor save. Each was reproduced with Godot 4.7.2.
 */
export function checkIntegrity(data: ProjectData): Finding[] {
  const out: Finding[] = [];
  const own = (file: string) => !data.external.has(file);
  const fileSet = new Set(data.files);

  // Uids several files claim, and uids Godot cannot read.
  const claims = claimsByUid(data.uidClaims);
  const duplicated = new Set<string>();
  for (const [uid, list] of claims) {
    const files = [...new Set(list.map((c) => c.file))];
    if (files.length < 2 || !isUidText(uid)) continue;
    duplicated.add(uid);
    for (const c of list) {
      if (!own(c.file) || list.some((o) => o !== c && o.file === c.file && o.from === "header" && c.from !== "header")) continue;
      const others = files.filter((f) => f !== c.file).map((f) => `${f}${own(f) ? "" : " (base)"}`);
      out.push(
        finding(
          "structure/duplicate-uid",
          c.file,
          c.from === "header" ? data.resources.get(c.file)?.headerLine : undefined,
          `${uid} (${where(c)}) is also the uid of ${others.join(", ")}: Godot gives it to one of them ("UID duplicate detected"), so a reference by uid can load the wrong file. A copied file keeps its uid.`,
        ),
      );
    }
  }
  for (const c of data.uidClaims) {
    if (!own(c.file) || isUidText(c.uid)) continue;
    const line = c.from === "header" ? data.resources.get(c.file)?.headerLine : undefined;
    out.push(finding("structure/invalid-uid", c.file, line, `"${c.uid}" (${where(c)}) is not a uid Godot can read, so Godot ignores it and the file has no uid; references to it by uid fail.`));
  }

  // Per file: references by uid, resource ids, section order.
  for (const [file, parsed] of data.resources) {
    if (!own(file)) continue;
    for (const ext of parsed.extResources) {
      if (!ext.uid || !ext.path || ext.path.startsWith("uid://") || duplicated.has(ext.uid)) continue;
      const target = fileSet.has(ext.path) ? ext.path : undefined;
      if (!target) continue;
      const byUid = isUidText(ext.uid) ? data.uids.get(ext.uid) : undefined;
      if (byUid === target) continue;
      if (byUid) {
        out.push(
          finding(
            "structure/uid-path-mismatch",
            file,
            ext.line,
            `ext_resource "${ext.id}": ${ext.uid} is the uid of ${byUid}, but the path says ${target}. Godot loads ${byUid} (the uid wins) and says nothing.`,
          ),
        );
      } else if (uidKnowable(data, target)) {
        out.push(
          finding(
            "structure/unknown-uid",
            file,
            ext.line,
            `ext_resource "${ext.id}": no file has ${ext.uid}, so Godot warns on every load ("invalid UID ... using text path instead") and loads ${target} by its path.`,
          ),
        );
      }
    }
    out.push(...resourceIds(file, parsed));
  }

  // Edits inside instanced scenes that are not editable: Godot applies them, then drops them on the next editor save.
  const scenes = new Map(data.map.scenes.map((s) => [s.path, s]));
  for (const scene of data.map.scenes) {
    const parsed = data.resources.get(scene.path);
    if (!parsed || scene.external) continue;
    for (const l of lockedInstances(scene, parsed, scenes).locked) {
      out.push(
        finding(
          "structure/locked-instance-edit",
          scene.path,
          l.line,
          `${l.count} edit${l.count === 1 ? "" : "s"} inside the instanced scene at "${l.root}", which has no [editable path="${l.root}"]: Godot applies ${l.count === 1 ? "it" : "them"} when loading, but drops ${l.count === 1 ? "it" : "them"} on the next save from the editor.`,
        ),
      );
    }
  }
  return out;
}

function claimsByUid(claims: UidClaim[]): Map<string, UidClaim[]> {
  const out = new Map<string, UidClaim[]>();
  for (const c of claims) out.set(c.uid, [...(out.get(c.uid) ?? []), c]);
  return out;
}

function where(c: UidClaim): string {
  return c.from === "header" ? "header" : c.from === "uid" ? `${c.file.slice(c.file.lastIndexOf("/") + 1)}.uid` : `${c.file.slice(c.file.lastIndexOf("/") + 1)}.import`;
}

/**
 * Whether the uid of a file is known from the files alone: a text scene or resource (its header), a file with a .uid or
 * .import file, or a script or shader (Godot gives it a new random uid on import when the .uid file is missing). Other
 * files (binary .scn/.res, assets whose .import file is not here) may have a uid the scan cannot see.
 */
function uidKnowable(data: ProjectData, target: string): boolean {
  const ext = extension(target);
  if (ext === "tscn" || ext === "tres") return data.resources.has(target);
  return SIDECAR_EXTENSIONS.includes(ext) || data.uidClaims.some((c) => c.file === target);
}

function resourceIds(file: string, parsed: ResourceFile): Finding[] {
  const out: Finding[] = [];
  for (const m of parsed.misplaced) {
    out.push(
      finding(
        "structure/section-order",
        file,
        m.line,
        `[${m.tag}] comes after ${m.tag === "ext_resource" ? "a sub_resource or node" : "a node or [resource]"}: Godot stops reading the file there ("Parse Error"), so it does not load. Order: ext_resource, sub_resource, then nodes.`,
      ),
    );
  }
  for (const [kind, list] of [
    ["ext_resource", parsed.extResources],
    ["sub_resource", parsed.subResources],
  ] as const) {
    const seen = new Map<string, number>();
    for (const r of list) {
      const first = seen.get(r.id);
      if (first === undefined) seen.set(r.id, r.line);
      else
        out.push(
          finding(
            "structure/duplicate-resource-id",
            file,
            r.line,
            `${kind} id "${r.id}" is already used on line ${first}: Godot keeps only one of them (the ${kind === "ext_resource" ? "last ext_resource" : "first sub_resource"}), so references meant for the other get the wrong resource.`,
          ),
        );
    }
  }
  const ext = new Set(parsed.extResources.map((e) => e.id));
  const subLine = new Map<string, number>();
  for (const s of parsed.subResources) if (!subLine.has(s.id)) subLine.set(s.id, s.line);
  const used = { ExtResource: new Set<string>(), SubResource: new Set<string>() };
  for (const ref of parsed.refs) {
    used[ref.kind].add(ref.id);
    if (ref.kind === "ExtResource" && !ext.has(ref.id)) {
      out.push(finding("structure/missing-resource-id", file, ref.line, `ExtResource("${ref.id}") has no [ext_resource] with that id: Godot fails to load the file ("Parse Error"). Ids here: ${listIds([...ext])}.`));
    } else if (ref.kind === "SubResource") {
      const defined = subLine.get(ref.id);
      if (defined === undefined) {
        out.push(finding("structure/missing-resource-id", file, ref.line, `SubResource("${ref.id}") has no [sub_resource] with that id: Godot fails to load the file ("Parse Error"). Ids here: ${listIds([...subLine.keys()])}.`));
      } else if (defined > ref.line) {
        out.push(finding("structure/missing-resource-id", file, ref.line, `SubResource("${ref.id}") is used before its [sub_resource] on line ${defined}: Godot reads the file top down and fails ("Parse Error"). Move that sub_resource up.`));
      }
    }
  }
  for (const e of parsed.extResources) {
    if (!used.ExtResource.has(e.id)) out.push(finding("structure/unused-resource", file, e.line, `ext_resource "${e.id}" (${e.path ?? e.uid ?? "?"}) is never used, but Godot still loads it with the file.`));
  }
  for (const s of parsed.subResources) {
    if (!used.SubResource.has(s.id) && s.type !== "GDScript") out.push(finding("structure/unused-resource", file, s.line, `sub_resource "${s.id}" (${s.type}) is never used.`));
  }
  return out;
}

function listIds(ids: string[]): string {
  return ids.length ? ids.slice(0, 6).map((i) => `"${i}"`).join(", ") + (ids.length > 6 ? ", ..." : "") : "none";
}

/** Whether `path` is `base` or below it. */
function within(path: string, base: string): boolean {
  return base === "." || path === base || path.startsWith(`${base}/`);
}

export interface LockedInstance {
  /** Path of the instanced scene (or of an instance inside it) that is not editable. */
  root: string;
  /** Line of the first edit inside it, and how many there are. */
  line: number;
  count: number;
}

/**
 * The instanced scenes in a scene (and the instances inside those), and the ones this scene changes inside without an
 * [editable] entry. Checked with Godot 4.7.2: an override of a node inside an instance, a node added below one, and a
 * connection to one survive an editor save only when every instance on the way is editable; a node added directly
 * under the instance, and changes to the instance node itself, always do.
 */
export function lockedInstances(scene: SceneInfo, parsed: ResourceFile, scenes: Map<string, SceneInfo>): { roots: string[]; locked: LockedInstance[] } {
  // Instanced scenes in this scene, with the instances inside them (an edit below those needs both editable).
  const roots: string[] = [];
  const addNested = (prefix: string, path: string | undefined, depth: number) => {
    const sub = path ? scenes.get(path) : undefined;
    if (!sub || depth > 8) return;
    for (const n of sub.nodes) {
      if (n.path === ".") {
        if (n.instance) addNested(prefix, n.instance, depth + 1);
        continue;
      }
      if (!n.instance) continue;
      const full = prefix === "." ? n.path : `${prefix}/${n.path}`;
      roots.push(full);
      addNested(full, n.instance, depth + 1);
    }
  };
  const own = new Set<string>();
  for (let i = 0; i < scene.nodes.length; i++) {
    const n = scene.nodes[i]!;
    const p = parsed.nodes[i];
    if (n.path === ".") {
      if (p?.instanceRef) addNested(".", n.instance, 0);
      continue;
    }
    if (p && (p.type || p.instanceRef)) own.add(n.path);
    if (p?.instanceRef) {
      roots.push(n.path);
      addNested(n.path, n.instance, 0);
    }
  }
  if (!roots.length) return { roots, locked: [] };
  const editable = new Set(parsed.editable.map((e) => e.path));
  /** The instance roots whose internals a path reaches, outermost first; a node this scene adds stops the walk. */
  const reaches = (path: string, overrideOfPath: boolean): string[] => {
    const hit: string[] = [];
    for (const root of roots) {
      if (!within(path, root) || root === ".") continue;
      if (path === root && !overrideOfPath) continue;
      // Below a node this scene adds itself (not part of the instance), nothing is locked.
      const below = path.slice(root.length + 1).split("/");
      let ownBetween = false;
      for (let k = 1; k <= below.length && path !== root; k++) {
        const step = `${root}/${below.slice(0, k).join("/")}`;
        if (own.has(step)) ownBetween = true;
      }
      if (!ownBetween) hit.push(root);
    }
    return hit.sort((a, b) => a.length - b.length);
  };
  const byRoot = new Map<string, { line: number; count: number }>();
  const note = (root: string, line: number) => {
    const have = byRoot.get(root);
    if (have) have.count++;
    else byRoot.set(root, { line, count: 1 });
  };
  for (let i = 0; i < scene.nodes.length; i++) {
    const n = scene.nodes[i]!;
    const p = parsed.nodes[i];
    if (n.path === "." || !p) continue;
    const parent = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : ".";
    const override = !p.type && !p.instanceRef;
    // An override block changes a node of the instance; a new node is the instance's only when its parent is inside it.
    for (const locked of reaches(override ? n.path : parent, override).filter((r) => r !== n.path && !editable.has(r))) note(locked, n.line);
  }
  for (const c of scene.connections) {
    const locked = new Set([c.from, c.to].flatMap((end) => reaches(end, true).filter((r) => r !== end && !editable.has(r))));
    for (const root of locked) note(root, c.line);
  }
  return { roots, locked: [...byRoot].map(([root, { line, count }]) => ({ root, line, count })) };
}
