import type { Block } from "../godot/blocks.js";
import type { ResourceFile, SceneNode } from "../godot/scene.js";

/** Changes to the shape of a scene tree: they move or copy whole sections, so they work on the sections, not on splices. */
export type StructureEdit =
  | { op: "rename_node"; node: string; name: string }
  | { op: "move_node"; node: string; parent?: string; index?: number; before?: string; after?: string; makeEditable?: boolean }
  | { op: "duplicate_node"; node: string; name: string; parent?: string; connections?: boolean; makeEditable?: boolean }
  | { op: "set_groups"; node: string; groups?: string[]; add?: string[]; remove?: string[]; makeEditable?: boolean };

export interface StructureResult {
  lines: string[];
  summary: string;
  warnings: string[];
  /** Node paths the change puts something under or on: checked against instances that are not editable. */
  touched: string[];
  /** Set when scripts that reach this node by name or path must be checked by the caller. */
  scripts?: { name: string; from: string; to: string };
}

export interface StructureContext {
  lines: string[];
  blocks: Block[];
  scene: ResourceFile;
  file: string;
  findNode: (path: string) => SceneNode;
  /** Names of the children a node gets from the scene it instances (not written in this file). */
  inheritedNames: (node: SceneNode) => string[];
  fail: (message: string) => Error;
}

export const NODE_NAME = /^[^.:@/"%]+$/;

const quote = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export const parentOf = (path: string): string | undefined => (path === "." ? undefined : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");
export const joinPath = (parent: string, name: string): string => (parent === "." ? name : `${parent}/${name}`);
const inside = (path: string, root: string): boolean => root === "." || path === root || path.startsWith(`${root}/`);
const mapPath = (path: string, from: string, to: string): string => (path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path);
const segments = (path: string): string[] => (path === "." ? [] : path.split("/"));

interface AttrSpan {
  /** Where ` key=value` starts (the space before the key). */
  from: number;
  valueStart: number;
  end: number;
}

/** The attributes of a one-line `[tag key=value ...]` header with their places, and where the closing `]` is. */
function headerAttrs(header: string): { attrs: Map<string, AttrSpan>; close: number } | undefined {
  const attrs = new Map<string, AttrSpan>();
  let i = header.indexOf("[") + 1;
  if (i === 0) return undefined;
  const n = header.length;
  const space = (c: string | undefined) => c === " " || c === "\t";
  while (i < n && !space(header[i]) && header[i] !== "]") i++;
  for (;;) {
    const from = i;
    while (i < n && space(header[i])) i++;
    if (i >= n) return undefined;
    if (header[i] === "]") return header.slice(i + 1).trim() === "" ? { attrs, close: from } : undefined;
    const keyStart = i;
    while (i < n && header[i] !== "=" && !space(header[i])) i++;
    const key = header.slice(keyStart, i);
    while (i < n && space(header[i])) i++;
    if (header[i] !== "=") return undefined;
    i++;
    while (i < n && space(header[i])) i++;
    const valueStart = i;
    let depth = 0;
    for (; i < n; i++) {
      const c = header[i];
      if (c === '"') {
        for (i++; i < n && header[i] !== '"'; i++) if (header[i] === "\\") i++;
        if (i >= n) return undefined;
      } else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "}") depth--;
      else if (c === "]") {
        if (depth === 0) break;
        depth--;
      } else if (space(c) && depth === 0) break;
    }
    attrs.set(key, { from, valueStart, end: i });
  }
}

/** Order Godot writes the attributes of a node header in, as far as this tool adds any. */
const AFTER_GROUPS = ["instance_placeholder", "instance"];

/** A file as its sections, so whole nodes can be moved and copied without touching their bytes. */
interface Piece {
  tag: string;
  lines: string[];
  node?: SceneNode;
  block?: Block;
}

/** Reads a NodePath relative to the node that holds it; undefined when it leaves the scene or is not a plain path. */
function resolveNodePath(holder: string[], raw: string): { target: string; suffix: string } | undefined {
  if (raw === "" || raw.startsWith("/") || raw.includes("%") || raw.includes("\\")) return undefined;
  const colon = raw.indexOf(":");
  const path = colon < 0 ? raw : raw.slice(0, colon);
  const suffix = colon < 0 ? "" : raw.slice(colon);
  if (path === "") return undefined;
  const out = [...holder];
  for (const part of path.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (!out.length) return undefined;
      out.pop();
    } else out.push(part);
  }
  return { target: out.join("/") || ".", suffix };
}

function relativePath(from: string[], to: string[]): string {
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  return [...Array<string>(from.length - common).fill(".."), ...to.slice(common)].join("/") || ".";
}

const NODE_PATH = /NodePath\("((?:[^"\\]|\\.)*)"\)/g;

/** A line diff as hunks against `before` (1-based lines), for the plan of a change that moves sections. */
export function lineHunks(before: string[], after: string[]): { line: number; removed: string[]; added: string[] }[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  if (!a.length && !b.length) return [];
  if (a.length * b.length > 4_000_000) return [{ line: head + 1, removed: a, added: b }];
  // Longest common subsequence, from the end, so the walk below goes forward.
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  }
  const hunks: { line: number; removed: string[]; added: string[] }[] = [];
  let open: { line: number; removed: string[]; added: string[] } | undefined;
  const hunk = (at: number) => (open ??= hunks[hunks.push({ line: head + at + 1, removed: [], added: [] }) - 1]!);
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      open = undefined;
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) hunk(i).added.push(b[j++]!);
    else hunk(i).removed.push(a[i++]!);
  }
  return hunks;
}

/**
 * Renames, moves or copies a node with its subtree, or sets its groups. Every section keeps its bytes except the header
 * attributes and NodePath values that name a node whose path changes.
 */
export function structureEdit(ctx: StructureContext, edit: StructureEdit): StructureResult {
  const { lines, blocks, scene, fail } = ctx;
  const warnings: string[] = [];
  const nodeAt = new Map(scene.nodes.map((n) => [n.line, n]));
  const prefix = lines.slice(0, blocks[0]?.start ?? lines.length);
  // The blank lines after a section belong to its place in the file, not to the section: a moved node takes the gap of
  // the place it lands in, so a file keeps its own spacing and moving a node back gives the same bytes again.
  const gaps: number[] = [];
  let pieces: Piece[] = blocks.map((b) => {
    let end = b.end;
    while (end > b.start + 1 && (lines[end - 1] ?? "").trim() === "") end--;
    gaps.push(b.end - end);
    return { tag: b.tag, lines: lines.slice(b.start, end), block: b, ...(b.tag === "node" && nodeAt.has(b.start + 1) ? { node: nodeAt.get(b.start + 1)! } : {}) };
  });
  const tails = blocks.map((b, i) => lines.slice(b.end - gaps[i]!, b.end));
  /** The gap this file leaves between two nodes (one blank line as Godot writes it). */
  const nodeGap = ((): number => {
    const seen = new Map<number, number>();
    pieces.forEach((p, i) => p.tag === "node" && pieces[i + 1]?.tag === "node" && seen.set(gaps[i]!, (seen.get(gaps[i]!) ?? 0) + 1));
    return [...seen].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
  })();
  /** Puts new sections in at `at`: the section before them gets `gap`, the last new one the gap that was there. */
  const insert = (at: number, added: Piece[], gap: string[]): void => {
    if (!added.length) return;
    const before = at > 0 ? tails[at - 1]! : [];
    if (at > 0) tails[at - 1] = [...gap];
    tails.splice(at, 0, ...added.map((_, i) => (i === added.length - 1 ? before : [...gap])));
    pieces.splice(at, 0, ...added);
  };

  const attrsOf = (piece: Piece) => {
    const parsed = headerAttrs(piece.lines[0] ?? "");
    if (!parsed) throw fail(`the [${piece.tag}] header at line ${(piece.block?.start ?? 0) + 1} of ${ctx.file} runs over several lines, which this change cannot rewrite safely; put it on one line (the editor writes it so) and try again`);
    return parsed;
  };
  /** Sets, adds (before the attributes in `before`, else last) or with undefined removes one header attribute. */
  const setAttr = (piece: Piece, key: string, value: string | undefined, before: string[] = []): void => {
    const header = piece.lines[0] ?? "";
    const { attrs, close } = attrsOf(piece);
    const have = attrs.get(key);
    let next: string;
    if (have) next = value === undefined ? header.slice(0, have.from) + header.slice(have.end) : header.slice(0, have.valueStart) + value + header.slice(have.end);
    else if (value === undefined) return;
    else {
      const at = before.map((k) => attrs.get(k)?.from).find((v) => v !== undefined) ?? close;
      next = `${header.slice(0, at)} ${key}=${value}${header.slice(at)}`;
    }
    piece.lines = [next, ...piece.lines.slice(1)];
  };
  const hasAttr = (piece: Piece, key: string): boolean => attrsOf(piece).attrs.has(key);

  /** Rewrites the NodePath values a node holds, when it or what they point at gets another path. */
  const rewriteNodePaths = (piece: Piece, holderOld: string, holderNew: string, mapTarget: (path: string) => string, unique?: { from: string; to: string }): void => {
    piece.lines = piece.lines.map((line, i) =>
      i === 0 || !line.includes("NodePath(")
        ? line
        : line.replace(NODE_PATH, (all, raw: string) => {
            if (unique && (raw === `%${unique.from}` || raw.startsWith(`%${unique.from}/`) || raw.startsWith(`%${unique.from}:`))) return `NodePath("%${unique.to}${raw.slice(unique.from.length + 1)}")`;
            const found = resolveNodePath(segments(holderOld), raw);
            if (!found) return all;
            const target = mapTarget(found.target);
            if (target === found.target && holderNew === holderOld) return all;
            const next = relativePath(segments(holderNew), segments(target)) + found.suffix;
            return next === raw ? all : `NodePath("${next}")`;
          }),
    );
  };

  /** Gives every section that names a node inside `from` its new path. The node's own header is the caller's. */
  const remap = (from: string, to: string, unique?: { from: string; to: string }): void => {
    for (const piece of pieces) {
      if (piece.node) {
        const parent = parentOf(piece.node.path);
        if (piece.node.path !== from && parent !== undefined && inside(parent, from)) setAttr(piece, "parent", quote(mapPath(parent, from, to)));
        rewriteNodePaths(piece, piece.node.path, mapPath(piece.node.path, from, to), (p) => mapPath(p, from, to), unique);
      } else if (piece.tag === "connection" || piece.tag === "editable") {
        for (const key of piece.tag === "connection" ? ["from", "to"] : ["path"]) {
          const value = piece.block?.attrs[key];
          if (typeof value === "string" && inside(value, from)) setAttr(piece, key, quote(mapPath(value, from, to)));
        }
      }
    }
  };

  /** Animation tracks are relative to the AnimationPlayer's root node, so they are reported, not changed. */
  const warnAnimations = (name: string): void => {
    const track = new RegExp(`NodePath\\("(?:[^"]*/)?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[/:"]`);
    const hit = pieces.find((p) => p.tag === "sub_resource" && p.block?.attrs["type"] === "Animation" && p.lines.some((l) => track.test(l)));
    if (hit) warnings.push(`animation tracks in this scene name "${name}" (from line ${(hit.block?.start ?? 0) + 1}); they are relative to the AnimationPlayer's root node and are not changed: check them`);
  };

  const own = (node: SceneNode, what: string): void => {
    if (node.path !== "." && !node.type && !node.instanceRef)
      throw fail(`${node.path} comes from an instanced scene (this file only overrides it), so it cannot be ${what} here; ${what === "copied" ? "copy" : what === "moved" ? "move" : "rename"} it in the scene it is made in`);
  };
  const checkName = (raw: string): string => {
    const name = raw.trim();
    if (!NODE_NAME.test(name)) throw fail(`"${raw}" is not a usable node name (no . : @ / " or %)`);
    return name;
  };
  const checkFree = (parent: SceneNode, name: string, except?: SceneNode): void => {
    if (scene.nodes.some((n) => n !== except && parentOf(n.path) === parent.path && n.name === name)) throw fail(`${parent.path} already has a child called ${name}; pick another name`);
    if (ctx.inheritedNames(parent).includes(name)) throw fail(`${parent.path} already has a child called ${name} (from the scene it instances); pick another name`);
  };
  /** Where a new last child of `parent` goes in `list`: after the last section of its subtree. */
  const endOfSubtree = (list: Piece[], parent: string): number => {
    let at = -1;
    list.forEach((p, i) => {
      if (p.node && inside(p.node.path, parent)) at = i;
    });
    return at + 1;
  };

  let summary = "";
  let touched: string[] = [];
  let scripts: StructureResult["scripts"];

  switch (edit.op) {
    case "rename_node": {
      const node = ctx.findNode(edit.node);
      own(node, "renamed");
      const name = checkName(edit.name);
      if (name === node.name) throw fail(`nothing to change: ${node.path} is already called ${name}`);
      const piece = pieces.find((p) => p.node === node)!;
      const parentPath = parentOf(node.path);
      if (parentPath !== undefined) {
        checkFree(ctx.findNode(parentPath), name, node);
        const to = joinPath(parentPath, name);
        remap(node.path, to, node.uniqueName ? { from: node.name, to: name } : undefined);
        scripts = { name: node.name, from: node.path, to };
      } else scripts = { name: node.name, from: node.name, to: name };
      setAttr(piece, "name", quote(name));
      warnAnimations(node.name);
      summary = `rename ${node.path === "." ? `the root ${node.name}` : node.path} to ${name}`;
      break;
    }
    case "move_node": {
      const node = ctx.findNode(edit.node);
      if (node.path === ".") throw fail(`the root node cannot be moved; to make another node the root, build the new scene with create_scene and instance this one in it`);
      own(node, "moved");
      const asked = [edit.index !== undefined, edit.before !== undefined, edit.after !== undefined].filter(Boolean).length;
      if (asked > 1) throw fail(`give one of index, before and after, not several`);
      const anchor = edit.before !== undefined ? ctx.findNode(edit.before) : edit.after !== undefined ? ctx.findNode(edit.after) : undefined;
      const oldParent = parentOf(node.path) ?? ".";
      const parent = ctx.findNode(edit.parent ?? (anchor ? (parentOf(anchor.path) ?? ".") : oldParent));
      if (edit.parent === undefined && !asked) throw fail(`move_node needs a parent (to reparent) or index, before or after (to change its place among its siblings)`);
      if (inside(parent.path, node.path)) throw fail(`${node.path} cannot be moved under ${parent.path === node.path ? "itself" : `its own descendant ${parent.path}`}; move ${parent.path === node.path ? "it" : parent.path} somewhere else first`);
      if (anchor) {
        if (anchor === node) throw fail(`${node.path} cannot be placed before or after itself`);
        if (parentOf(anchor.path) !== parent.path) throw fail(`${anchor.path} is not a child of ${parent.path}; before and after take a sibling under the new parent`);
      }
      if (edit.index !== undefined && (!Number.isInteger(edit.index) || edit.index < 0)) throw fail(`index is a whole number from 0 (0 is the first child)`);
      if (asked && (parent.instanceRef || (!parent.type && parent.path !== ".")))
        throw fail(`${parent.path} gets children from the scene it instances, and Godot keeps the place among those as index=, which this tool does not write; leave out index, before and after to make ${node.name} its last child`);
      const reparent = parent.path !== oldParent;
      if (reparent) checkFree(parent, node.name);
      const to = joinPath(parent.path, node.name);
      const piece = pieces.find((p) => p.node === node)!;
      if (reparent) {
        remap(node.path, to);
        setAttr(piece, "parent", quote(parent.path));
        if (hasAttr(piece, "index")) {
          setAttr(piece, "index", undefined);
          warnings.push(`the index= of ${node.name} was its place among inherited children of ${oldParent}; it is dropped`);
        }
        scripts = { name: node.name, from: node.path, to };
        warnAnimations(node.name);
        touched = [parent.path];
      } else if (hasAttr(piece, "index")) throw fail(`${node.path} has index= (its place among inherited children), which this tool does not write; change its place in the editor`);
      const moved = pieces.filter((p) => p.node && inside(p.node.path, node.path));
      const rest = pieces.filter((p) => !moved.includes(p));
      const siblings = rest.filter((p) => p.node && parentOf(p.node.path) === parent.path);
      let at: number;
      let place = "";
      if (anchor) {
        const anchorPiece = rest.find((p) => p.node === anchor)!;
        at = edit.before !== undefined ? rest.indexOf(anchorPiece) : endOfSubtree(rest, anchor.path);
        place = edit.before !== undefined ? `before ${anchor.name}` : `after ${anchor.name}`;
      } else if (edit.index !== undefined) {
        if (edit.index > siblings.length) throw fail(`${parent.path} has ${siblings.length} other child${siblings.length === 1 ? "" : "ren"}, so index goes from 0 to ${siblings.length}`);
        at = edit.index < siblings.length ? rest.indexOf(siblings[edit.index]!) : endOfSubtree(rest, parent.path);
        place = `as child ${edit.index}`;
      } else at = endOfSubtree(rest, parent.path);
      pieces = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
      summary = reparent ? `move ${node.path} under ${parent.path}${place ? ` ${place}` : ""}` : `move ${node.path} ${place}`;
      if (moved.length > 1) summary += ` (with ${moved.length - 1} child node${moved.length > 2 ? "s" : ""})`;
      break;
    }
    case "duplicate_node": {
      const node = ctx.findNode(edit.node);
      if (node.path === ".") throw fail(`the root node cannot be copied inside its own scene; instance the scene instead (add_node with instance)`);
      own(node, "copied");
      const name = checkName(edit.name);
      const oldParent = parentOf(node.path) ?? ".";
      const parent = ctx.findNode(edit.parent ?? oldParent);
      checkFree(parent, name);
      const to = joinPath(parent.path, name);
      const ids = new Set(lines.flatMap((l) => [...l.matchAll(/\bunique_id=(\d+)/g)].map((m) => Number(m[1]))));
      const freshId = (): number => {
        for (;;) {
          const id = 1 + Math.floor(Math.random() * 0x7ffffffe);
          if (!ids.has(id)) return ids.add(id), id;
        }
      };
      const originals = pieces.filter((p) => p.node && inside(p.node.path, node.path));
      const dropped: string[] = [];
      const copies = originals.map((orig): Piece => {
        const from = orig.node!;
        const copy: Piece = { tag: "node", lines: [...orig.lines] };
        if (from === node) {
          setAttr(copy, "name", quote(name));
          setAttr(copy, "parent", quote(parent.path));
          if (hasAttr(copy, "index")) setAttr(copy, "index", undefined);
        } else {
          setAttr(copy, "parent", quote(mapPath(parentOf(from.path) ?? ".", node.path, to)));
          // Two nodes with one unique name in a scene is an error in Godot: the copy below the new node loses it.
          if (from.uniqueName) {
            copy.lines = copy.lines.filter((l, i) => i === 0 || !/^unique_name_in_owner\s*=\s*true\s*$/.test(l));
            dropped.push(from.name);
          }
        }
        if (hasAttr(copy, "unique_id")) setAttr(copy, "unique_id", String(freshId()));
        rewriteNodePaths(copy, from.path, mapPath(from.path, node.path, to), (p) => (inside(p, node.path) ? mapPath(p, node.path, to) : p));
        return copy;
      });
      if (dropped.length) warnings.push(`${dropped.map((d) => `%${d}`).join(", ")} stay${dropped.length === 1 ? "s" : ""} the unique name of the original: the cop${dropped.length === 1 ? "y is" : "ies are"} not unique-named`);
      const at = parent.path === oldParent ? endOfSubtree(pieces, node.path) : endOfSubtree(pieces, parent.path);
      const wires = pieces.filter((p) => p.tag === "connection" && [p.block?.attrs["from"], p.block?.attrs["to"]].some((v) => typeof v === "string" && inside(v, node.path)));
      const editables = pieces.filter((p) => p.tag === "editable" && typeof p.block?.attrs["path"] === "string" && inside(p.block.attrs["path"], node.path));
      const lastWire = pieces.filter((p) => p.tag === "connection").at(-1);
      const newWires = edit.connections
        ? wires.map((w) => {
            const copy: Piece = { tag: "connection", lines: [w.lines[0] ?? ""], block: w.block! };
            for (const key of ["from", "to"]) {
              const value = w.block?.attrs[key];
              if (typeof value === "string") setAttr(copy, key, quote(mapPath(value, node.path, to)));
            }
            return copy.lines[0]!;
          })
        : [];
      const newEditables = editables.map((e): Piece => {
        const copy: Piece = { tag: "editable", lines: [e.lines[0] ?? ""] };
        setAttr(copy, "path", quote(mapPath(String(e.block?.attrs["path"]), node.path, to)));
        return copy;
      });
      // New connections go right under the last one, as the editor writes them: no blank line between.
      if (lastWire && newWires.length) lastWire.lines = [...lastWire.lines, ...newWires];
      // Between two nodes the copy takes the spacing that is there; at the end of the nodes, the file's usual one.
      insert(at, copies, at > 0 && pieces[at]?.tag === "node" ? (tails[at - 1] ?? []) : Array<string>(nodeGap).fill(""));
      insert(pieces.length, newEditables, [""]);
      touched = [parent.path];
      summary = `duplicate ${node.path} as ${to}`;
      if (copies.length > 1) summary += ` (with ${copies.length - 1} child node${copies.length > 2 ? "s" : ""})`;
      if (newWires.length) summary += `, and ${newWires.length} connection${newWires.length === 1 ? "" : "s"}`;
      else if (wires.length && !edit.connections) warnings.push(`${wires.length} connection${wires.length === 1 ? "" : "s"} of ${node.path} ${wires.length === 1 ? "is" : "are"} not copied (as when you duplicate in code); pass connections to copy ${wires.length === 1 ? "it" : "them"}`);
      break;
    }
    case "set_groups": {
      const node = ctx.findNode(edit.node);
      const piece = pieces.find((p) => p.node === node)!;
      const clean = (list: string[] | undefined): string[] => {
        const out = [...new Set((list ?? []).map((g) => g.trim()))];
        const bad = out.find((g) => g === "" || /[\n\r]/.test(g));
        if (bad !== undefined) throw fail(`"${bad}" is not a usable group name`);
        return out;
      };
      const changing = (edit.add?.length ?? 0) + (edit.remove?.length ?? 0) > 0;
      if (edit.groups !== undefined && changing) throw fail(`give groups (the whole list) or add and remove, not both`);
      if (edit.groups === undefined && !changing) throw fail(`set_groups needs groups (the whole list; [] for none), or add and remove`);
      let next: string[];
      if (edit.groups !== undefined) next = clean(edit.groups);
      else {
        const remove = clean(edit.remove);
        const missing = remove.filter((g) => !node.groups.includes(g));
        if (missing.length)
          throw fail(
            `${node.path} is not in ${missing.map((g) => `"${g}"`).join(", ")} in ${ctx.file}${node.groups.length ? ` (its groups here: ${node.groups.join(", ")})` : " (it has no groups here)"}${node.type ? "" : "; groups from the instanced scene are changed in that scene"}`,
          );
        next = [...node.groups.filter((g) => !remove.includes(g)), ...clean(edit.add).filter((g) => !node.groups.includes(g))];
      }
      if (next.length === node.groups.length && next.every((g, i) => g === node.groups[i])) throw fail(`nothing to change: ${node.path} ${next.length ? `is already in ${next.join(", ")}` : "has no groups"}`);
      setAttr(piece, "groups", next.length ? `[${next.map(quote).join(", ")}]` : undefined, AFTER_GROUPS);
      touched = [node.path];
      summary = next.length ? `set the groups of ${node.path} to ${next.join(", ")}` : `remove ${node.path} from all groups`;
      break;
    }
  }

  const out = [...prefix, ...pieces.flatMap((p, i) => [...p.lines, ...(tails[i] ?? [])])];
  return { lines: out, summary, warnings, touched, ...(scripts ? { scripts } : {}) };
}
