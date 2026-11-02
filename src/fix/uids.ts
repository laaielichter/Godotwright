import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { extension, fromResPath } from "../project/files.js";
import type { ProjectData, UidClaim } from "../scan/scan.js";
import { generateUid, isUidText, SIDECAR_EXTENSIONS, uidText, withExtUid, withHeaderUid } from "../scene/uid.js";

/**
 * Project-wide uid repairs that a single line cannot do: a new uid for the copy of a duplicated file (and the references
 * that name the copy), a valid uid for an unreadable one, the uid a file lost (a missing .uid file) restored from the
 * references to it, and, when asked, a uid stamped on every file that has none. Uids are made like Godot makes them.
 */

export interface UidEdit {
  /** res:// path of the file written: a scene or resource, or a .uid or .import file. */
  file: string;
  /** 0-based line; `count` lines there are replaced with `lines`. A new file has index 0, count 1. */
  index: number;
  count: number;
  lines: string[];
  rule: string;
  note?: string;
  /** "check": the right choice cannot be known from the files (only planned when check fixes are wanted). */
  safety?: "safe" | "check";
}

export interface UidPlan {
  edits: UidEdit[];
  /** Repairs left out because they need a check and check fixes were not wanted. */
  needsCheck: number;
  /** Each file's uid once the plan is applied (undefined: it has none). */
  uidAfter: Map<string, string | undefined>;
}

export interface UidPlanOptions {
  wanted: (rule: string) => boolean;
  /** Only stamp, restore or renumber these res:// files (references elsewhere are still updated). */
  focus?: Set<string>;
  /** Give every scene, resource, script and shader without a uid a new one. */
  stamp?: boolean;
  /** Also plan repairs that need a check. */
  includeCheck?: boolean;
  /** Reads a project file as lines (the fixer's own reader, so edits stay in one place). */
  lines: (file: string) => string[] | undefined;
}

export function planUids(data: ProjectData, options: UidPlanOptions): UidPlan {
  const own = (file: string) => !data.external.has(file);
  const inFocus = (file: string) => own(file) && (!options.focus || options.focus.has(file));
  const taken = new Set(data.uidClaims.map((c) => c.uid));
  const edits: UidEdit[] = [];
  const uidAfter = new Map<string, string | undefined>();
  for (const c of data.uidClaims) if (isUidText(c.uid) && !uidAfter.has(c.file)) uidAfter.set(c.file, c.uid);
  const byFile = new Map<string, UidClaim[]>();
  for (const c of data.uidClaims) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  const claimsOf = (file: string) => byFile.get(file) ?? [];
  const fileSet = new Set(data.files);
  let needsCheck = 0;
  let safety: "safe" | "check" = "safe";

  /** Writes `uid` wherever the file's uid lives (or would live), as edits. */
  const setUid = (file: string, uid: string, rule: string, note: string, claims: UidClaim[]) => {
    uidAfter.set(file, uid);
    taken.add(uid);
    const sources = claims.length ? claims : [{ uid: "", file, from: (/\.(tscn|tres)$/.test(file) ? "header" : "uid") as UidClaim["from"] }];
    for (const c of sources) {
      if (c.from === "header") {
        const index = (data.resources.get(file)?.headerLine ?? 1) - 1;
        const line = options.lines(file)?.[index];
        if (line !== undefined && /^\[gd_(scene|resource)\b/.test(line)) edits.push({ file, index, count: 1, lines: [withHeaderUid(line, uid)], rule, note, safety });
      } else if (c.from === "uid") {
        edits.push({ file: `${file}.uid`, index: 0, count: options.lines(`${file}.uid`)?.length ?? 1, lines: [uid, ""], rule, note, safety });
      } else {
        const text = options.lines(`${file}.import`) ?? [];
        const index = text.findIndex((l) => /^uid="[^"]*"/.test(l));
        if (index >= 0) edits.push({ file: `${file}.import`, index, count: 1, lines: [`uid="${uid}"`], rule, note, safety });
      }
    }
  };

  // References by uid, counted per (uid, path).
  const refCount = new Map<string, number>();
  for (const parsed of data.resources.values()) {
    for (const e of parsed.extResources) if (e.uid && e.path) refCount.set(`${e.uid}|${e.path}`, (refCount.get(`${e.uid}|${e.path}`) ?? 0) + 1);
  }

  // Duplicates: the file most references name with that uid keeps it (a base file always does), the others get a new one.
  // References by uid alone (project.godot, preload("uid://"), path="uid://") cannot say which file they mean: then the
  // file Godot resolves the uid to now (its uid cache) keeps it, and without a cache the choice needs a check.
  if (options.wanted("structure/duplicate-uid")) {
    const byUid = new Map<string, string[]>();
    for (const c of data.uidClaims) if (isUidText(c.uid)) byUid.set(c.uid, [...new Set([...(byUid.get(c.uid) ?? []), c.file])]);
    const duplicated = new Set([...byUid].filter(([, files]) => files.length > 1).map(([uid]) => uid));
    const cache = duplicated.size ? godotUidCache(data.root) : new Map<string, string>();
    const uidOnly = duplicated.size ? uidOnlyReferences(data, duplicated, options.lines) : new Map<string, string[]>();
    for (const [uid, files] of byUid) {
      if (files.length < 2 || !files.some(inFocus)) continue;
      // Only references by uid alone depend on which file Godot resolves the uid to; without them the original keeps it.
      const bare = uidOnly.get(uid) ?? [];
      const resolved = bare.length ? cache.get(uid) : undefined;
      const ranked = [...files].sort(
        (a, b) =>
          Number(own(a)) - Number(own(b)) ||
          Number(b === resolved) - Number(a === resolved) ||
          (refCount.get(`${uid}|${b}`) ?? 0) - (refCount.get(`${uid}|${a}`) ?? 0) ||
          mtime(data, a) - mtime(data, b) ||
          a.localeCompare(b),
      );
      const decided = !own(ranked[0]!) || resolved === ranked[0] || bare.length === 0;
      if (!decided && !options.includeCheck) {
        needsCheck += ranked.slice(1).filter(own).length;
        continue;
      }
      safety = decided ? "safe" : "check";
      const shown = bare.slice(0, 3).join(", ") + (bare.length > 3 ? ` and ${bare.length - 3} more` : "");
      const why = decided ? "" : `; ${bare.length} reference${bare.length === 1 ? "" : "s"} by uid alone (${shown}) will load ${ranked[0]}: make sure it is the file they mean`;
      for (const loser of ranked.slice(1)) {
        if (!own(loser)) continue;
        const fresh = generateUid(taken);
        const refs = refCount.get(`${uid}|${loser}`) ?? 0;
        setUid(loser, fresh, "structure/duplicate-uid", `new uid; ${ranked[0]} keeps ${uid}${refs ? `; ${refs} reference${refs === 1 ? "" : "s"} to this file updated` : ""}${why}`, claimsOf(loser).filter((c) => c.uid === uid));
        // References that name the copy by path, with the shared uid, follow it.
        for (const [file, parsed] of data.resources) {
          if (!own(file)) continue;
          for (const e of parsed.extResources) {
            if (e.uid !== uid || e.path !== loser) continue;
            const line = options.lines(file)?.[e.line - 1];
            if (line !== undefined && line.startsWith("[ext_resource")) edits.push({ file, index: e.line - 1, count: 1, lines: [withExtUid(line, fresh)], rule: "structure/duplicate-uid", note: `${loser} has a new uid`, safety });
          }
        }
      }
      safety = "safe";
    }
  }

  // Uids Godot cannot read: a new valid one.
  if (options.wanted("structure/invalid-uid")) {
    for (const c of data.uidClaims) {
      if (isUidText(c.uid) || !inFocus(c.file)) continue;
      setUid(c.file, uidAfter.get(c.file) ?? generateUid(taken), "structure/invalid-uid", `replaces "${c.uid}"`, [c]);
    }
  }

  // A file that lost its uid (a .uid file not committed, a header written without one) while references still use it:
  // give it back that uid, so every reference is right again.
  if (options.wanted("structure/unknown-uid")) {
    const wantedBy = new Map<string, Map<string, number>>();
    for (const [file, parsed] of data.resources) {
      if (!own(file)) continue;
      for (const e of parsed.extResources) {
        if (!e.uid || !e.path || !isUidText(e.uid) || data.uids.has(e.uid) || uidAfter.get(e.path) !== undefined) continue;
        if (!inFocus(e.path) || !restorable(data, fileSet, e.path)) continue;
        const counts = wantedBy.get(e.path) ?? new Map<string, number>();
        counts.set(e.uid, (counts.get(e.uid) ?? 0) + 1);
        wantedBy.set(e.path, counts);
      }
    }
    for (const [file, counts] of wantedBy) {
      const [uid, n] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
      if (taken.has(uid)) continue;
      setUid(file, uid, "structure/unknown-uid", `restores the uid ${n} reference${n === 1 ? "" : "s"} use`, []);
    }
  }

  // Stamping: every own scene, resource, script and shader without a uid gets one (not addons, unless focused).
  if (options.stamp) {
    for (const file of data.files) {
      if (!own(file) || uidAfter.get(file) !== undefined || !restorable(data, fileSet, file)) continue;
      if (options.focus ? !options.focus.has(file) : file.startsWith("res://addons/")) continue;
      setUid(file, generateUid(taken), "stamp-uid", /\.(tscn|tres)$/.test(file) ? "uid added to the header" : "new .uid file", claimsOf(file).filter((c) => !isUidText(c.uid)));
    }
  }
  return { edits, uidAfter, needsCheck };
}

/** A file whose uid lives in its own header or in a .uid file, so it can be given one: text scenes, resources, scripts, shaders. */
function restorable(data: ProjectData, files: Set<string>, file: string): boolean {
  const ext = extension(file);
  if (ext === "tscn" || ext === "tres") return data.resources.has(file);
  return SIDECAR_EXTENSIONS.includes(ext) && files.has(file);
}

function mtime(data: ProjectData, file: string): number {
  try {
    return statSync(fromResPath(data.root, file)).mtimeMs;
  } catch {
    return 0;
  }
}

/** The uid-to-file table Godot saved at its last scan (res://.godot/uid_cache.bin), as uid text to res:// path. */
export function godotUidCache(root: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const buf = readFileSync(join(root, ".godot", "uid_cache.bin"));
    const count = buf.readUInt32LE(0);
    let at = 4;
    for (let i = 0; i < count; i++) {
      const id = buf.readBigInt64LE(at);
      const length = buf.readUInt32LE(at + 8);
      const path = buf.toString("utf8", at + 12, at + 12 + length);
      at += 12 + length;
      if (id >= 0n) map.set(uidText(id), path);
    }
  } catch {
    // No cache yet, or one this reader does not understand: the choice falls back to the references.
  }
  return map;
}

/**
 * Where each of `uids` is used without a path that names a file: project.godot settings, uid:// strings in scripts and
 * text resources, and ext_resource lines whose path is itself a uid. Uid claims (headers, .uid and .import files) are not
 * references.
 */
function uidOnlyReferences(data: ProjectData, uids: Set<string>, read: (file: string) => string[] | undefined): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const pattern = /uid:\/\/[a-z0-9]+/g;
  for (const file of data.files) {
    if (file !== "res://project.godot" && (data.external.has(file) || !/\.(gd|tscn|tres|cfg|godot)$/.test(file))) continue;
    const lines = read(file) ?? [];
    lines.forEach((line, i) => {
      if (/^\[gd_(scene|resource)\b/.test(line)) return;
      const named = /^\[ext_resource\b/.test(line) && /\bpath="(?!uid:)/.test(line);
      if (named) return;
      for (const m of line.matchAll(pattern)) {
        if (!uids.has(m[0])) continue;
        found.set(m[0], [...(found.get(m[0]) ?? []), `${file}:${i + 1}`]);
      }
    });
  }
  return found;
}
