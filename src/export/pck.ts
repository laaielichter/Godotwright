import { closeSync, fstatSync, openSync, readSync, writeSync } from "node:fs";

/**
 * Reads and writes Godot's .pck packs without Godot: the header and the file directory of format 2 (Godot 4.0-4.3),
 * 3 (4.4) and 4 (4.5 and later, what 4.7.2 writes), in a .pck of its own or appended to an exported executable.
 * The layout follows core/io/file_access_pack.cpp and editor/export/editor_export_platform.cpp of Godot 4.7.2, and
 * the tests check it against packs Godot 4.7.2 exported.
 */

export const PCK_MAGIC = 0x43504447; // "GDPC"
/** Pack flags. */
export const PACK_DIR_ENCRYPTED = 1;
export const PACK_REL_FILEBASE = 2;
export const PACK_SPARSE_BUNDLE = 4;
/** File flags. */
export const PACK_FILE_ENCRYPTED = 1;
export const PACK_FILE_REMOVAL = 2;
export const PACK_FILE_DELTA = 4;
/** Godot aligns every file in a pack to 16 bytes. */
const PADDING = 16;
/** Bytes before the first file in a format 4 pack: 24 of header, two offsets, 64 reserved, padded to 16. */
const HEADER_V4 = 112;

export class PckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PckError";
  }
}

export interface PckEntry {
  /** The path as stored, without res://, e.g. "main.gdc" or ".godot/exported/133200997/export-...-main.scn". */
  path: string;
  /** Where the data starts in the file (absolute). */
  offset: number;
  size: number;
  /** MD5 of the file's data, hex; zeros for a removal. */
  md5: string;
  flags: number;
}

export interface Pck {
  file: string;
  /** Where the pack starts in the file: 0 for a .pck, later when it is appended to an executable. */
  start: number;
  /** The file's size (for an executable: all of it). */
  bytes: number;
  formatVersion: number;
  /** The Godot version that wrote it. */
  engine: [number, number, number];
  flags: number;
  /** The directory is encrypted: the file count is known, the names are not. */
  encryptedDirectory: boolean;
  /** A sparse bundle keeps the files' data outside the pack. */
  sparse: boolean;
  fileBase: number;
  /** Where the files' data ends: the directory (format 3 and 4) or the end of the file (format 2). */
  dataEnd: number;
  fileCount: number;
  entries: PckEntry[];
}

/** Reads a part of an open file; fewer bytes at the end of the file. */
function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, position + done);
    if (n === 0) break;
    done += n;
  }
  return buf.subarray(0, done);
}

const u64 = (buf: Buffer, at: number): number => {
  const v = buf.readBigUInt64LE(at);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new PckError("an offset in the pack is out of range");
  return Number(v);
};

/** Where the pack starts: at 0, or (for an exported executable with the pack inside) from the trailer at its end. */
function findStart(fd: number, size: number): number | undefined {
  if (size >= 4 && readAt(fd, 0, 4).readUInt32LE(0) === PCK_MAGIC) return 0;
  if (size < 16) return undefined;
  const tail = readAt(fd, size - 12, 12);
  if (tail.readUInt32LE(8) !== PCK_MAGIC) return undefined;
  const packSize = u64(tail, 0);
  const start = size - 12 - packSize;
  if (start < 0 || readAt(fd, start, 4).readUInt32LE(0) !== PCK_MAGIC) return undefined;
  return start;
}

/** Reads a pack's header and directory (not the files' data), from a .pck or an executable with the pack inside. */
export function readPck(file: string): Pck {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch (error) {
    throw new PckError(`cannot open ${file}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
  }
  try {
    const size = fstatSync(fd).size;
    const start = findStart(fd, size);
    if (start === undefined) throw new PckError(`${file} is not a Godot pack: no GDPC header at its start and no pack at its end`);
    const head = readAt(fd, start, 40);
    if (head.length < 32) throw new PckError(`${file}: the pack header is cut off`);
    const formatVersion = head.readUInt32LE(4);
    if (formatVersion < 2 || formatVersion > 4) {
      throw new PckError(`${file}: pack format ${formatVersion} is not supported (Godot 4 writes 2 to 4${formatVersion < 2 ? "; format 1 is Godot 3" : ""})`);
    }
    const engine: [number, number, number] = [head.readUInt32LE(8), head.readUInt32LE(12), head.readUInt32LE(16)];
    const flags = head.readUInt32LE(20);
    let fileBase = u64(head, 24);
    if (formatVersion >= 3 || flags & PACK_REL_FILEBASE) fileBase += start;
    // Format 3 and 4 name where the directory is; format 2 has it right after the header, before the files.
    const dirAt = formatVersion >= 3 ? (head.length < 40 ? -1 : u64(head, 32) + start) : start + 96;
    if (dirAt < 0 || dirAt + 4 > size) throw new PckError(`${file}: the pack directory lies outside the file (cut off?)`);
    const dirEnd = formatVersion >= 3 ? size : Math.min(size, fileBase);
    const dir = readAt(fd, dirAt, dirEnd - dirAt);
    const fileCount = dir.readUInt32LE(0);
    const pck: Pck = {
      file,
      start,
      bytes: size,
      formatVersion,
      engine,
      flags,
      encryptedDirectory: (flags & PACK_DIR_ENCRYPTED) !== 0,
      sparse: (flags & PACK_SPARSE_BUNDLE) !== 0,
      fileBase,
      dataEnd: formatVersion >= 3 ? dirAt : size,
      fileCount,
      entries: [],
    };
    if (pck.encryptedDirectory) return pck;
    let at = 4;
    const need = (n: number) => {
      if (at + n > dir.length) throw new PckError(`${file}: the pack directory is cut off after ${pck.entries.length} of ${fileCount} files`);
    };
    for (let i = 0; i < fileCount; i++) {
      need(4);
      const length = dir.readUInt32LE(at);
      at += 4;
      if (length > 4096) throw new PckError(`${file}: a file name in the pack directory is ${length} bytes long: not a valid pack`);
      need(length + 36);
      const path = dir.subarray(at, at + length).toString("utf8").replace(/\0+$/, "");
      at += length;
      const offset = u64(dir, at) + fileBase;
      const entrySize = u64(dir, at + 8);
      const md5 = dir.subarray(at + 16, at + 32).toString("hex");
      const entryFlags = dir.readUInt32LE(at + 32);
      at += 36;
      if (!pck.sparse && !(entryFlags & PACK_FILE_REMOVAL) && offset + entrySize > size) {
        throw new PckError(`${file}: ${path} lies outside the file (cut off?)`);
      }
      pck.entries.push({ path, offset, size: entrySize, md5, flags: entryFlags });
    }
    return pck;
  } finally {
    closeSync(fd);
  }
}

/** A file to write into a new pack: its data is copied from another pack (or any file) as it is stored there. */
export interface PckSource {
  path: string;
  md5: string;
  /** The size Godot records (for an encrypted file: the size before encryption). */
  size: number;
  flags: number;
  /** Where the stored data is; length 0 for a removal. */
  from: { file: string; offset: number; length: number };
}

/**
 * How many bytes each entry takes in its pack: its size, or for an encrypted file (stored with a header and
 * padding, so larger than its size) up to the next file's data.
 */
export function storedLengths(pck: Pck): Map<PckEntry, number> {
  const out = new Map<PckEntry, number>();
  const sorted = [...pck.entries].filter((e) => !(e.flags & PACK_FILE_REMOVAL)).sort((a, b) => a.offset - b.offset);
  sorted.forEach((e, i) => {
    if (!(e.flags & PACK_FILE_ENCRYPTED)) return out.set(e, e.size);
    const next = sorted[i + 1]?.offset ?? pck.dataEnd;
    return out.set(e, Math.max(e.size, next - e.offset));
  });
  for (const e of pck.entries) if (e.flags & PACK_FILE_REMOVAL) out.set(e, 0);
  return out;
}

/** The entries of a pack as sources for writePck. */
export function sourcesOf(pck: Pck): PckSource[] {
  if (pck.encryptedDirectory) throw new PckError(`${pck.file}: the directory is encrypted, so its files cannot be copied`);
  if (pck.sparse) throw new PckError(`${pck.file}: a sparse bundle keeps its data outside the pack, so its files cannot be copied`);
  const lengths = storedLengths(pck);
  return pck.entries.map((e) => ({ path: e.path, md5: e.md5, size: e.size, flags: e.flags, from: { file: pck.file, offset: e.offset, length: lengths.get(e) ?? e.size } }));
}

/**
 * Writes a format 4 pack the way Godot 4.7.2 does (relative file base, files aligned to 16 bytes, the directory
 * after the files, sorted by path), copying each file's stored data. Returns the bytes written.
 */
export function writePck(out: string, files: PckSource[], engine: [number, number, number]): number {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fd = openSync(out, "w");
  const handles = new Map<string, number>();
  try {
    let pos = 0;
    const put = (buf: Buffer) => {
      let done = 0;
      while (done < buf.length) done += writeSync(fd, buf, done, buf.length - done, pos + done);
      pos += buf.length;
    };
    const pad = () => {
      const rest = pos % PADDING;
      if (rest) put(Buffer.alloc(PADDING - rest));
    };
    const header = Buffer.alloc(HEADER_V4);
    header.writeUInt32LE(PCK_MAGIC, 0);
    header.writeUInt32LE(4, 4);
    engine.forEach((v, i) => header.writeUInt32LE(v, 8 + i * 4));
    header.writeUInt32LE(PACK_REL_FILEBASE, 20);
    header.writeBigUInt64LE(BigInt(HEADER_V4), 24);
    put(header);
    const offsets: number[] = [];
    const chunk = Buffer.alloc(1 << 20);
    for (const f of sorted) {
      offsets.push(pos - HEADER_V4);
      if (f.from.length === 0) continue;
      let src = handles.get(f.from.file);
      if (src === undefined) {
        src = openSync(f.from.file, "r");
        handles.set(f.from.file, src);
      }
      let left = f.from.length;
      let at = f.from.offset;
      while (left > 0) {
        const n = readSync(src, chunk, 0, Math.min(chunk.length, left), at);
        if (n === 0) throw new PckError(`${f.from.file}: ${f.path} is cut off`);
        put(chunk.subarray(0, n));
        left -= n;
        at += n;
      }
      pad();
    }
    pad();
    const dirOffset = pos;
    const count = Buffer.alloc(4);
    count.writeUInt32LE(sorted.length, 0);
    put(count);
    sorted.forEach((f, i) => {
      const name = Buffer.from(f.path, "utf8");
      const padded = name.length + ((4 - (name.length % 4)) % 4);
      const entry = Buffer.alloc(4 + padded + 36);
      entry.writeUInt32LE(padded, 0);
      name.copy(entry, 4);
      entry.writeBigUInt64LE(BigInt(offsets[i]!), 4 + padded);
      entry.writeBigUInt64LE(BigInt(f.size), 12 + padded);
      Buffer.from(f.md5.padEnd(32, "0").slice(0, 32), "hex").copy(entry, 20 + padded);
      entry.writeUInt32LE(f.flags, 36 + padded);
      put(entry);
    });
    const dirAt = Buffer.alloc(8);
    dirAt.writeBigUInt64LE(BigInt(dirOffset), 0);
    writeSync(fd, dirAt, 0, 8, 32);
    return pos;
  } finally {
    for (const h of handles.values()) closeSync(h);
    closeSync(fd);
  }
}

/**
 * The files a game sees after loading packs in order (a base, then patches): a later file replaces an earlier one
 * with the same path, and a removal takes it out. Delta-encoded files need Godot to apply them: they are returned
 * apart.
 */
export function overlay(packs: Pck[]): { files: Map<string, { entry: PckEntry; pck: Pck }>; delta: string[] } {
  const files = new Map<string, { entry: PckEntry; pck: Pck }>();
  const delta: string[] = [];
  for (const pck of packs) {
    for (const entry of pck.entries) {
      if (entry.flags & PACK_FILE_REMOVAL) files.delete(entry.path);
      else if (entry.flags & PACK_FILE_DELTA) delta.push(entry.path);
      else files.set(entry.path, { entry, pck });
    }
  }
  return { files, delta };
}
