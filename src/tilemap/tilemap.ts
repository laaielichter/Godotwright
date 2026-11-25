import { existsSync, readFileSync } from "node:fs";
import { closest } from "../api/api.js";
import { parseResourceText, refId, type ResourceFile, type SceneNode } from "../godot/scene.js";
import type { Variant } from "../godot/variant.js";
import { fromResPath } from "../project/files.js";
import { TILE_MAP_DATA_FORMAT, TileDataError, cellKey, decodeTileMapData, encodeTileMapData, formatTileMapDataValue, readTileMapDataValue, type TileCell, type TileDataEncoding } from "./codec.js";
import { TextEditError, blockAt, finishPlan, formatTextPlan, openDoc, removeProp, setProp, type Doc, type OpenOptions, type TextEditPlan } from "./plan.js";

export class TilemapError extends TextEditError {}

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A cell to set: `alternative` is 0 when left out. */
export interface TileCellInput {
  x: number;
  y: number;
  source: number;
  atlas: [number, number];
  alternative?: number;
}

/** One change to the cells of a TileMapLayer. */
export type TilemapEdit =
  | { op: "set"; cells: TileCellInput[] }
  | { op: "fill"; rect: TileRect; source: number; atlas: [number, number]; alternative?: number }
  | { op: "erase"; cells?: { x: number; y: number }[]; rect?: TileRect }
  | { op: "clear" };

/** `node` is the path of the TileMapLayer (the root is "."); it may be left out when the scene has only one. */
export type TilemapEditArgs = TilemapEdit & { node?: string };

export interface TilemapReadArgs {
  node?: string;
  /** How many cells to list (default 200). */
  limit?: number;
}

export interface TilemapOptions extends OpenOptions {
  /** Apply the change (default: only plan it). */
  write?: boolean;
}

export interface TileSetSource {
  id: number;
  kind: "atlas" | "scenes" | "unknown";
  /** Atlas sources: the tiles the atlas has, with their alternative ids. */
  tiles: { atlas: [number, number]; alternatives: number[] }[];
  /** Scene collections: the scene ids (a cell names one as its alternative, at atlas 0,0). */
  scenes: number[];
}

export interface TileSetInfo {
  /** res:// path of the TileSet, or "(in the scene)". */
  path: string;
  sources: TileSetSource[];
}

export interface TileCount {
  /** The character of this tile in the map. */
  char: string;
  source: number;
  atlas: [number, number];
  alternative: number;
  count: number;
}

export interface TilemapReport {
  file: string;
  node: string;
  format: number;
  /** "none" when the layer has no cells. */
  encoding: TileDataEncoding | "none";
  cellCount: number;
  usedRect?: TileRect;
  cells: TileCell[];
  /** True when `cells` was cut at the limit. */
  truncated: boolean;
  counts: TileCount[];
  map?: { x: number; y: number; rows: string[]; cropped: boolean };
  tileSet?: TileSetInfo;
  warnings: string[];
}

export interface TilemapPlan extends TextEditPlan {
  node: string;
  cellsBefore: number;
  cellsAfter: number;
}

const MAP_WIDTH = 80;
const MAP_HEIGHT = 40;
const MAX_FILL = 262144;
/** Flip and transpose bits Godot adds to the alternative id of an atlas tile. */
const TRANSFORM_BITS = 0x7000;
const CHARS = "#ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@%&*+=~";

/** The properties Godot writes after tile_map_data in a TileMapLayer section. */
const AFTER_DATA = /^(enabled|tile_set|y_sort_origin|x_draw_order_reversed|rendering_quadrant_size|collision_enabled|use_kinematic_bodies|collision_visibility_mode|occlusion_enabled|navigation_enabled|navigation_visibility_mode|script|metadata\/.*)$/;

const fail = (message: string) => new TilemapError(message);

/** The sources of a TileSet whose properties are `props`, in the file that holds its sub resources. */
function tileSetSources(file: ResourceFile, props: Record<string, Variant>): TileSetSource[] {
  const sources: TileSetSource[] = [];
  for (const [key, value] of Object.entries(props)) {
    const id = /^sources\/(\d+)$/.exec(key)?.[1];
    if (id === undefined) continue;
    const source: TileSetSource = { id: Number(id), kind: "unknown", tiles: [], scenes: [] };
    const sub = file.subResources.find((s) => s.id === refId(value, "SubResource"));
    if (sub?.type === "TileSetAtlasSource") {
      source.kind = "atlas";
      const tiles = new Map<string, { atlas: [number, number]; alternatives: number[] }>();
      for (const prop of Object.keys(sub.props)) {
        const m = /^(\d+):(\d+)\/(\d+)$/.exec(prop);
        if (!m) continue;
        const atlas: [number, number] = [Number(m[1]), Number(m[2])];
        const tile = tiles.get(atlas.join(",")) ?? { atlas, alternatives: [] };
        tile.alternatives.push(Number(m[3]));
        tiles.set(atlas.join(","), tile);
      }
      source.tiles = [...tiles.values()];
    } else if (sub?.type === "TileSetScenesCollectionSource") {
      source.kind = "scenes";
      source.scenes = [...new Set(Object.keys(sub.props).flatMap((p) => /^scenes\/(\d+)\//.exec(p)?.[1] ?? []).map(Number))];
    }
    sources.push(source);
  }
  return sources.sort((a, b) => a.id - b.id);
}

/** The TileSet of a layer, when `tile_set` names one in the scene or a .tres in the project. */
function tileSetOf(doc: Doc, node: SceneNode, warnings: string[]): TileSetInfo | undefined {
  const value = node.props["tile_set"];
  if (value === undefined || value === null) {
    warnings.push(`${node.path} has no tile_set, so its cells draw nothing`);
    return undefined;
  }
  const subId = refId(value, "SubResource");
  if (subId !== undefined) {
    const sub = doc.file.subResources.find((s) => s.id === subId);
    return sub ? { path: "(in the scene)", sources: tileSetSources(doc.file, sub.props) } : undefined;
  }
  const path = doc.file.extResources.find((e) => e.id === refId(value))?.path;
  if (!path || !path.endsWith(".tres") || !existsSync(fromResPath(doc.root, path))) {
    warnings.push(`the tile_set of ${node.path}${path ? ` (${path})` : ""} could not be read, so sources and atlas coordinates are not checked`);
    return undefined;
  }
  try {
    const file = parseResourceText(readFileSync(fromResPath(doc.root, path), "utf8"));
    return { path, sources: tileSetSources(file, file.resource?.props ?? {}) };
  } catch {
    warnings.push(`${path} could not be read, so sources and atlas coordinates are not checked`);
    return undefined;
  }
}

interface Layer {
  doc: Doc;
  node: SceneNode;
  cells: TileCell[];
  encoding?: TileDataEncoding;
  tileSet?: TileSetInfo;
}

function openLayer(path: string, nodePath: string | undefined, options: OpenOptions): Layer {
  const doc = openDoc(path, options, [".tscn"], fail);
  const layers = doc.file.nodes.filter((n) => n.type === "TileMapLayer");
  let node: SceneNode | undefined;
  if (nodePath === undefined || nodePath.trim() === "") {
    if (layers.length !== 1) throw fail(layers.length ? `${doc.resPath} has ${layers.length} TileMapLayer nodes; name one: ${layers.map((n) => n.path).join(", ")}` : `${doc.resPath} has no TileMapLayer node`);
    node = layers[0];
  } else {
    const wanted = nodePath.replace(/^\.\//, "") || ".";
    node = doc.file.nodes.find((n) => n.path === wanted);
    if (!node) {
      const near = closest(wanted, layers.map((n) => n.path), 3);
      throw fail(`no node "${nodePath}" in ${doc.resPath}${near.length ? `; did you mean ${near.join(", ")}?` : layers.length ? `; TileMapLayer nodes: ${layers.map((n) => n.path).join(", ")}` : ""} (the root is ".")`);
    }
    if (node.type !== "TileMapLayer") {
      throw fail(`${node.path} is ${node.type ? `a ${node.type}` : "an instanced scene"}, not a TileMapLayer${node.type === "TileMap" ? " (the old TileMap node keeps its cells in another format; convert it in the Godot editor first)" : ""}${layers.length ? `; TileMapLayer nodes: ${layers.map((n) => n.path).join(", ")}` : ""}`);
    }
  }
  if (!node) throw fail(`${doc.resPath} has no TileMapLayer node`);
  try {
    const { bytes, encoding } = readTileMapDataValue(node.props["tile_map_data"]);
    return { doc, node, cells: decodeTileMapData(bytes), ...(encoding ? { encoding } : {}), ...optional("tileSet", tileSetOf(doc, node, doc.warnings)) };
  } catch (error) {
    if (error instanceof TileDataError) throw fail(`${node.path}: ${error.message}`);
    throw error;
  }
}

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => (value === undefined ? {} : ({ [key]: value } as { [P in K]?: V }));

function usedRect(cells: readonly TileCell[]): TileRect | undefined {
  if (!cells.length) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cells) {
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x);
    y1 = Math.max(y1, c.y);
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const tileKey = (c: { source: number; atlas: [number, number]; alternative: number }): string => `${c.source}:${c.atlas[0]},${c.atlas[1]}:${c.alternative}`;

/**
 * Reads the cells of a TileMapLayer in a .tscn: the used rect, the cells (up to `limit`), how often each tile is
 * used, a text map of the used rect with one character per tile, and what the layer's TileSet offers.
 */
export function readTilemap(path: string, args: TilemapReadArgs = {}, options: OpenOptions = {}): TilemapReport {
  const { doc, node, cells, encoding, tileSet } = openLayer(path, args.node, options);
  const limit = Math.max(0, Math.floor(args.limit ?? 200));
  const tally = new Map<string, TileCount>();
  for (const c of cells) {
    const entry = tally.get(tileKey(c)) ?? { char: "?", source: c.source, atlas: c.atlas, alternative: c.alternative, count: 0 };
    entry.count++;
    tally.set(tileKey(c), entry);
  }
  const counts = [...tally.values()].sort((a, b) => b.count - a.count || a.source - b.source || a.atlas[1] - b.atlas[1] || a.atlas[0] - b.atlas[0] || a.alternative - b.alternative);
  counts.forEach((c, i) => (c.char = CHARS[i] ?? "?"));
  const rect = usedRect(cells);
  const report: TilemapReport = { file: doc.resPath, node: node.path, format: TILE_MAP_DATA_FORMAT, encoding: encoding ?? "none", cellCount: cells.length, cells: cells.slice(0, limit), truncated: cells.length > limit, counts, warnings: doc.warnings };
  if (rect) {
    report.usedRect = rect;
    const width = Math.min(rect.width, MAP_WIDTH);
    const height = Math.min(rect.height, MAP_HEIGHT);
    const grid = Array.from({ length: height }, () => new Array<string>(width).fill("."));
    for (const c of cells) {
      const row = grid[c.y - rect.y];
      if (row && c.x - rect.x < width) row[c.x - rect.x] = tally.get(tileKey(c))?.char ?? "?";
    }
    report.map = { x: rect.x, y: rect.y, rows: grid.map((r) => r.join("")), cropped: width < rect.width || height < rect.height };
  }
  if (tileSet) {
    report.tileSet = tileSet;
    const unknown = counts.filter((c) => !tileSet.sources.some((s) => s.id === c.source));
    if (unknown.length) report.warnings.push(`cells use source ${[...new Set(unknown.map((c) => c.source))].join(", ")}, which ${tileSet.path} does not have`);
  }
  return report;
}

const tileText = (c: { source: number; atlas: [number, number]; alternative: number }): string => `source ${c.source} atlas ${c.atlas[0]},${c.atlas[1]}${c.alternative ? ` alt ${c.alternative}` : ""}`;

function formatTileSet(tileSet: TileSetInfo): string[] {
  if (!tileSet.sources.length) return [`tile_set ${tileSet.path}: no sources`];
  return tileSet.sources.map((s) => {
    const list = s.kind === "atlas" ? s.tiles.slice(0, 32).map((t) => t.atlas.join(",")).join(" ") + (s.tiles.length > 32 ? ` ... +${s.tiles.length - 32}` : "") : s.kind === "scenes" ? `scene ids ${s.scenes.join(" ")} (as the alternative, at atlas 0,0)` : "not read";
    return `tile_set ${tileSet.path}: source ${s.id} (${s.kind}): ${list || "no tiles"}`;
  });
}

export function formatTilemapReport(report: TilemapReport): string {
  const rect = report.usedRect;
  const out = [`tilemap ${report.file} ${report.node}: ${report.cellCount} cell${report.cellCount === 1 ? "" : "s"}${rect ? `, used rect (${rect.x}, ${rect.y}) ${rect.width}x${rect.height}, ${report.encoding}, format ${report.format}` : ""}`];
  if (report.tileSet) out.push(...formatTileSet(report.tileSet));
  if (report.counts.length) {
    out.push("tiles:");
    for (const c of report.counts.slice(0, CHARS.length)) out.push(`  ${c.char} ${tileText(c)}  x${c.count}`);
    if (report.counts.length > CHARS.length) out.push(`  ? ${report.counts.length - CHARS.length} more tiles`);
  }
  if (report.map) {
    out.push(`map (top left is ${report.map.x}, ${report.map.y}; . is empty${report.map.cropped ? `; cut to ${report.map.rows[0]?.length ?? 0}x${report.map.rows.length}` : ""}):`);
    for (const row of report.map.rows) out.push(`  ${row}`);
  }
  if (report.cells.length) {
    out.push("cells (x,y source atlas [alt]):");
    for (const c of report.cells) out.push(`  ${c.x},${c.y} ${c.source} ${c.atlas[0]},${c.atlas[1]}${c.alternative ? ` ${c.alternative}` : ""}`);
    if (report.truncated) out.push(`  ... ${report.cellCount - report.cells.length} more (raise the limit)`);
  }
  for (const w of report.warnings) out.push(`warning: ${w}`);
  return `${out.join("\n")}\n`;
}

const int = (value: unknown, what: string, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) throw fail(`${what} must be a whole number, not ${JSON.stringify(value)}`);
  if (value < min || value > max) throw fail(`${what} is ${value}; it must be from ${min} to ${max}`);
  return value;
};

function checkRect(rect: TileRect | undefined): TileRect {
  if (!rect || typeof rect !== "object") throw fail(`give a rect: {x, y, width, height}`);
  const out = { x: int(rect.x, "rect x", -32768, 32767), y: int(rect.y, "rect y", -32768, 32767), width: int(rect.width, "rect width", 1, 65536), height: int(rect.height, "rect height", 1, 65536) };
  if (out.x + out.width - 1 > 32767 || out.y + out.height - 1 > 32767) throw fail(`the rect runs past 32767, the last cell coordinate a TileMapLayer can store`);
  if (out.width * out.height > MAX_FILL) throw fail(`the rect holds ${out.width * out.height} cells; at most ${MAX_FILL} in one call`);
  return out;
}

function checkTile(tile: { source: number; atlas: [number, number]; alternative?: number }, what: string): { source: number; atlas: [number, number]; alternative: number } {
  if (typeof tile.source === "number" && tile.source < 0) throw fail(`${what}: source ${tile.source} means "no tile"; use erase to remove cells`);
  if (!Array.isArray(tile.atlas) || tile.atlas.length !== 2) throw fail(`${what}: atlas must be [x, y]`);
  return {
    source: int(tile.source, `${what}: source`, 0, 65535),
    atlas: [int(tile.atlas[0], `${what}: atlas x`, 0, 65535), int(tile.atlas[1], `${what}: atlas y`, 0, 65535)],
    alternative: int(tile.alternative ?? 0, `${what}: alternative`, 0, 65535),
  };
}

/** Refuses a tile the TileSet does not have (source id, atlas coordinate); warns about an unknown alternative. */
function checkAgainstTileSet(tileSet: TileSetInfo | undefined, tiles: { source: number; atlas: [number, number]; alternative: number }[], warnings: string[]): void {
  if (!tileSet) return;
  const seen = new Set<string>();
  for (const tile of tiles) {
    if (seen.has(tileKey(tile))) continue;
    seen.add(tileKey(tile));
    const source = tileSet.sources.find((s) => s.id === tile.source);
    if (!source) throw fail(`the TileSet ${tileSet.path} has no source ${tile.source}${tileSet.sources.length ? `; it has source ${tileSet.sources.map((s) => s.id).join(", ")}` : "; it has no sources yet"}`);
    if (source.kind === "atlas") {
      const found = source.tiles.find((t) => t.atlas[0] === tile.atlas[0] && t.atlas[1] === tile.atlas[1]);
      if (!found) {
        const near = [...source.tiles].sort((a, b) => Math.abs(a.atlas[0] - tile.atlas[0]) + Math.abs(a.atlas[1] - tile.atlas[1]) - (Math.abs(b.atlas[0] - tile.atlas[0]) + Math.abs(b.atlas[1] - tile.atlas[1])));
        throw fail(`source ${source.id} of ${tileSet.path} has no tile at atlas ${tile.atlas.join(",")}${near.length ? `; nearest: ${near.slice(0, 6).map((t) => t.atlas.join(",")).join(" ")}` : "; it has no tiles yet"}`);
      }
      if (!found.alternatives.includes(tile.alternative & ~TRANSFORM_BITS)) warnings.push(`tile ${tile.atlas.join(",")} of source ${source.id} has no alternative ${tile.alternative & ~TRANSFORM_BITS} (it has ${found.alternatives.join(", ")})`);
    } else if (source.kind === "scenes") {
      if (tile.atlas[0] !== 0 || tile.atlas[1] !== 0 || !source.scenes.includes(tile.alternative)) warnings.push(`source ${source.id} is a scene collection: a cell names a scene as atlas 0,0 with the scene id (${source.scenes.join(", ")}) as the alternative`);
    }
  }
}

/**
 * Plans (and with `write`, applies) a change to the cells of a TileMapLayer in a .tscn: set cells, fill or erase a
 * rect, erase cells, or clear the layer. Only the `tile_map_data` line changes, in the style the file had (base64 or
 * a list of numbers); existing cells keep their order and new ones go at the end, as Godot does.
 */
export function editTilemap(path: string, args: TilemapEditArgs, options: TilemapOptions = {}): TilemapPlan {
  const { doc, node, cells: before, encoding, tileSet } = openLayer(path, args.node, options);
  const cells = new Map(before.map((c) => [cellKey(c.x, c.y), c] as const));
  const count = (n: number) => `${n} cell${n === 1 ? "" : "s"}`;
  let summary = "";
  const put = (list: TileCell[]): { added: number; changed: number } => {
    let added = 0;
    let changed = 0;
    for (const c of list) {
      const old = cells.get(cellKey(c.x, c.y));
      if (!old) added++;
      else if (tileKey(old) !== tileKey(c)) changed++;
      cells.set(cellKey(c.x, c.y), c);
    }
    return { added, changed };
  };
  switch (args.op) {
    case "set": {
      if (!Array.isArray(args.cells) || !args.cells.length) throw fail(`set needs cells: [{x, y, source, atlas: [x, y]}]`);
      const list = args.cells.map((c, i) => ({ x: int(c?.x, `cell ${i + 1}: x`, -32768, 32767), y: int(c?.y, `cell ${i + 1}: y`, -32768, 32767), ...checkTile(c, `cell ${i + 1}`) }));
      checkAgainstTileSet(tileSet, list, doc.warnings);
      const { added, changed } = put(list);
      summary = `set ${count(list.length)} on ${node.path} (${added} new, ${changed} changed)`;
      break;
    }
    case "fill": {
      const rect = checkRect(args.rect);
      const tile = checkTile(args, "fill");
      checkAgainstTileSet(tileSet, [tile], doc.warnings);
      const list: TileCell[] = [];
      for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) list.push({ x, y, ...tile, atlas: [tile.atlas[0], tile.atlas[1]] });
      const { added, changed } = put(list);
      summary = `fill (${rect.x}, ${rect.y}) ${rect.width}x${rect.height} on ${node.path} with ${tileText(tile)} (${added} new, ${changed} changed)`;
      break;
    }
    case "erase": {
      if (!args.rect === !args.cells) throw fail(`erase needs cells: [{x, y}] or a rect: {x, y, width, height}`);
      let gone = 0;
      if (args.rect) {
        const rect = checkRect(args.rect);
        for (const c of before) if (c.x >= rect.x && c.x < rect.x + rect.width && c.y >= rect.y && c.y < rect.y + rect.height && cells.delete(cellKey(c.x, c.y))) gone++;
        summary = `erase ${count(gone)} in (${rect.x}, ${rect.y}) ${rect.width}x${rect.height} on ${node.path}`;
      } else {
        if (!Array.isArray(args.cells) || !args.cells.length) throw fail(`erase needs cells: [{x, y}] or a rect: {x, y, width, height}`);
        const missing: string[] = [];
        args.cells.forEach((c, i) => {
          const key = cellKey(int(c?.x, `cell ${i + 1}: x`, -32768, 32767), int(c?.y, `cell ${i + 1}: y`, -32768, 32767));
          if (cells.delete(key)) gone++;
          else missing.push(key);
        });
        if (missing.length && gone) doc.warnings.push(`${count(missing.length)} had no tile: ${missing.slice(0, 8).join(" ")}`);
        summary = `erase ${count(gone)} on ${node.path}`;
      }
      if (!gone) throw fail(`nothing to change: there are no cells to erase there on ${node.path}`);
      break;
    }
    case "clear":
      if (!before.length) throw fail(`nothing to change: ${node.path} has no cells`);
      cells.clear();
      summary = `clear ${node.path} (${count(before.length)})`;
      break;
    default:
      throw fail(`op is one of set, fill, erase, clear`);
  }
  const after = [...cells.values()];
  const block = blockAt(doc, node.line);
  // A layer without cells stores nothing: Godot drops the property.
  if (!after.length) removeProp(doc, block, "tile_map_data");
  // A layer that had no data: base64 where the file is in the format that has it (format=4), numbers elsewhere.
  else setProp(doc, block, "tile_map_data", formatTileMapDataValue(encodeTileMapData(after), encoding ?? ((doc.file.format ?? 3) >= 4 ? "base64" : "numbers")), (k) => AFTER_DATA.test(k));
  return { ...finishPlan(doc, summary, "tilemap edit", options.write), node: node.path, cellsBefore: before.length, cellsAfter: after.length };
}

export function formatTilemapPlan(plan: TilemapPlan): string {
  return formatTextPlan("tilemap", plan).replace(/\n$/, `\ncells: ${plan.cellsBefore} before, ${plan.cellsAfter} after\n`);
}
