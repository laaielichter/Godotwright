import { isCall, type Variant } from "../godot/variant.js";

/**
 * The cells of a TileMapLayer as Godot stores them in `tile_map_data`.
 *
 * Layout, read from Godot's scene/2d/tile_map_layer.cpp (set_tile_map_data_from_array and
 * get_tile_map_data_as_array, checked in the 4.3-stable and 4.4-stable sources; the file is no longer at that path on
 * master, so later versions were not read): a little-endian u16 format version, then 12 bytes per cell:
 * i16 x, i16 y, u16 source_id, u16 atlas_x, u16 atlas_y, u16 alternative_tile. The only format is 0
 * (TILE_MAP_LAYER_DATA_FORMAT_0); any other version is refused here. A layer without cells stores no bytes at all.
 *
 * Order: Godot writes the cells in the order of its HashMap, which is the order they were first set, and a cell set
 * again keeps its place. So cells are not sorted: edits keep the order and add new cells at the end.
 */
export const TILE_MAP_DATA_FORMAT = 0;
const CELL_SIZE = 12;

export interface TileCell {
  x: number;
  y: number;
  source: number;
  atlas: [number, number];
  alternative: number;
}

export class TileDataError extends Error {}

export const cellKey = (x: number, y: number): string => `${x},${y}`;

/** Reads the bytes of `tile_map_data`. A cell that is there twice keeps its first place and its last tile, as in Godot. */
export function decodeTileMapData(bytes: Uint8Array): TileCell[] {
  if (bytes.length === 0) return [];
  if (bytes.length < 2) throw new TileDataError("tile_map_data is corrupted: not enough bytes");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = view.getUint16(0, true);
  if (format !== TILE_MAP_DATA_FORMAT) throw new TileDataError(`tile_map_data has format version ${format}; only version ${TILE_MAP_DATA_FORMAT} (Godot 4.3 and later) is known here`);
  if ((bytes.length - 2) % CELL_SIZE !== 0) throw new TileDataError(`tile_map_data is corrupted: ${bytes.length - 2} bytes is not a whole number of ${CELL_SIZE}-byte cells`);
  const cells = new Map<string, TileCell>();
  for (let at = 2; at < bytes.length; at += CELL_SIZE) {
    const cell: TileCell = {
      x: view.getInt16(at, true),
      y: view.getInt16(at + 2, true),
      source: view.getUint16(at + 4, true),
      atlas: [view.getUint16(at + 6, true), view.getUint16(at + 8, true)],
      alternative: view.getUint16(at + 10, true),
    };
    cells.set(cellKey(cell.x, cell.y), cell);
  }
  return [...cells.values()];
}

/** Writes cells as `tile_map_data` bytes, in the order given. No cells: no bytes. */
export function encodeTileMapData(cells: readonly TileCell[]): Uint8Array {
  if (!cells.length) return new Uint8Array(0);
  const bytes = new Uint8Array(2 + cells.length * CELL_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, TILE_MAP_DATA_FORMAT, true);
  cells.forEach((cell, i) => {
    const at = 2 + i * CELL_SIZE;
    view.setInt16(at, cell.x, true);
    view.setInt16(at + 2, cell.y, true);
    view.setUint16(at + 4, cell.source, true);
    view.setUint16(at + 6, cell.atlas[0], true);
    view.setUint16(at + 8, cell.atlas[1], true);
    view.setUint16(at + 10, cell.alternative, true);
  });
  return bytes;
}

/** How the file writes the bytes: `PackedByteArray("<base64>")` or `PackedByteArray(1, 0, ...)`. */
export type TileDataEncoding = "base64" | "numbers";

/** The bytes of a parsed `tile_map_data` value and the style it was written in (undefined for an empty or missing one). */
export function readTileMapDataValue(value: Variant | undefined): { bytes: Uint8Array; encoding?: TileDataEncoding } {
  if (value === undefined || value === null) return { bytes: new Uint8Array(0) };
  if (!isCall(value, "PackedByteArray")) throw new TileDataError("tile_map_data is not a PackedByteArray");
  if (value.args.length === 0) return { bytes: new Uint8Array(0) };
  if (value.args.length === 1 && typeof value.args[0] === "string") {
    const text = value.args[0];
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new TileDataError("tile_map_data is not valid base64");
    return { bytes: new Uint8Array(Buffer.from(text, "base64")), encoding: "base64" };
  }
  const bytes = new Uint8Array(value.args.length);
  value.args.forEach((v, i) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) throw new TileDataError(`tile_map_data holds ${JSON.stringify(v)}, which is not a byte`);
    bytes[i] = v;
  });
  return { bytes, encoding: "numbers" };
}

/** The value text of `tile_map_data` in the given style. */
export function formatTileMapDataValue(bytes: Uint8Array, encoding: TileDataEncoding): string {
  return encoding === "base64" ? `PackedByteArray("${Buffer.from(bytes).toString("base64")}")` : `PackedByteArray(${[...bytes].join(", ")})`;
}
