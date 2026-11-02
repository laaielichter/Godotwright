import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fromResPath } from "../project/files.js";

/**
 * Godot's resource uids in text form, `uid://` plus a 63-bit id in base 34. Checked against Godot 4.7.2:
 * ResourceUID.id_to_text writes the digits a-y then 0-8 (0 is "a", 24 "y", 25 "0", 33 "8", 34 "ba"), most
 * significant first, and create_id() takes a random non-negative 64-bit integer.
 */
const DIGITS = "abcdefghijklmnopqrstuvwxy012345678";
const MAX_ID = 0x7fffffffffffffffn;

/** Files that get a `.uid` file next to them (Godot 4.7.2 writes one on import for these). */
export const SIDECAR_EXTENSIONS = ["gd", "gdshader", "gdshaderinc"];

/** The text form of a uid id, as ResourceUID.id_to_text writes it. */
export function uidText(id: bigint): string {
  if (id < 0n) return "uid://<invalid>";
  let out = "";
  let rest = id;
  do {
    out = DIGITS[Number(rest % 34n)] + out;
    rest /= 34n;
  } while (rest > 0n);
  return `uid://${out}`;
}

/**
 * A new uid that is not in `taken`. Random, like Godot's ResourceUID.create_id(), so two machines
 * do not make the same one.
 */
export function generateUid(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const id = randomBytes(8).readBigUInt64BE() & MAX_ID;
    if (id === 0n) continue;
    const uid = uidText(id);
    if (!taken.has(uid)) return uid;
  }
}

/**
 * Whether Godot can read this uid: `uid://` and lowercase letters and digits only (ResourceUID.text_to_id gives -1
 * for anything else, and Godot then ignores it, so the file gets no uid). Only a-y and 0-8 are ever written.
 */
export function isUidText(text: string): boolean {
  return /^uid:\/\/[a-z0-9]+$/.test(text);
}

/** The uid of a file, from its .uid file, its .import file or its own header. */
export function uidOf(root: string, path: string): string | undefined {
  const full = fromResPath(root, path);
  if (existsSync(`${full}.uid`)) return readFileSync(`${full}.uid`, "utf8").trim() || undefined;
  if (existsSync(`${full}.import`)) return /^uid="([^"]+)"/m.exec(readFileSync(`${full}.import`, "utf8"))?.[1];
  if (/\.(tscn|tres)$/.test(path) && existsSync(full)) return /^\[gd_\w+[^\]]*\buid="([^"]+)"/.exec(readFileSync(full, "utf8"))?.[1];
  return undefined;
}

/** A `[gd_scene ...]` or `[gd_resource ...]` header line with its uid set (added after format=, or replaced). */
export function withHeaderUid(line: string, uid: string): string {
  if (/\buid="[^"]*"/.test(line)) return line.replace(/\buid="[^"]*"/, `uid="${uid}"`);
  if (/\bformat=\d+/.test(line)) return line.replace(/(\bformat=\d+)/, `$1 uid="${uid}"`);
  return line.replace(/\]\s*$/, ` uid="${uid}"]`);
}

/** An `[ext_resource ...]` line with its uid set to `uid`, or removed when `uid` is undefined. */
export function withExtUid(line: string, uid: string | undefined): string {
  if (uid === undefined) return line.replace(/\s+uid="[^"]*"/, "");
  if (/\buid="[^"]*"/.test(line)) return line.replace(/\buid="[^"]*"/, `uid="${uid}"`);
  return line.replace(/(\s+path=)/, ` uid="${uid}"$1`);
}
