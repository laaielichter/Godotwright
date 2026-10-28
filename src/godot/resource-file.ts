import { parseValue, Reader, type Variant } from "./variant.js";

/**
 * One `[tag attr=value ...]` section of a ConfigFile-style file, with the
 * `key = value` properties that follow it.
 */
export interface Section {
  tag: string;
  attrs: Record<string, Variant>;
  props: Record<string, Variant>;
  /** 1-based line of the section header (0 for properties before any header). */
  line: number;
  /** 1-based line of each property. */
  propLines: Record<string, number>;
}

/**
 * Parses project.godot, .tscn, .tres, .import, .cfg and similar files.
 * Properties that appear before the first header land in a section with tag "".
 */
export function parseResourceFile(text: string): Section[] {
  const r = new Reader(text.replace(/^﻿/, ""));
  const sections: Section[] = [];
  let current: Section = { tag: "", attrs: {}, props: {}, line: 0, propLines: {} };

  for (;;) {
    r.skipSpace();
    if (r.done) break;
    const ch = r.peek();

    if (ch === ";" || ch === "#") {
      r.skipToLineEnd();
      continue;
    }

    if (ch === "[") {
      if (current.tag !== "" || Object.keys(current.props).length > 0) sections.push(current);
      current = parseHeader(r);
      continue;
    }

    const line = r.line;
    const key = ch === '"' ? r.readString() : readBareKey(r);
    r.skipSpace(false);
    r.expect("=");
    current.props[key] = parseValue(r);
    current.propLines[key] = line;
  }

  if (current.tag !== "" || Object.keys(current.props).length > 0) sections.push(current);
  return sections;
}

function parseHeader(r: Reader): Section {
  const line = r.line;
  r.expect("[");
  r.skipSpace();
  const tag = readBareKey(r, "]");
  const attrs: Record<string, Variant> = {};
  for (;;) {
    r.skipSpace();
    if (r.peek() === "]") {
      r.next();
      return { tag, attrs, props: {}, line, propLines: {} };
    }
    const key = r.readIdent();
    r.skipSpace();
    r.expect("=");
    attrs[key] = parseValue(r);
  }
}

/** Reads a property key such as `config/name` or `tracks/0/path`. */
function readBareKey(r: Reader, stop = "="): string {
  let out = "";
  while (!r.done) {
    const ch = r.peek();
    if (ch === stop || ch === "=" || ch === " " || ch === "\t" || ch === "\r" || ch === "\n") break;
    out += r.next();
  }
  if (out === "") r.fail("expected a key");
  return out;
}
