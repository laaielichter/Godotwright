import { parseResourceFile, type Section } from "./resource-file.js";

/** A section of a resource file with its 0-based first line and the line where the next one starts. */
export interface Block extends Section {
  start: number;
  end: number;
}

/** A change planned against the original lines; all are applied bottom-up so the line numbers stay true. */
export interface Splice {
  start: number;
  count: number;
  added: string[];
  /** Goes after anything else inserted at the same line (an [editable] entry at the end of the file). */
  tail?: boolean;
}

export function blocksOf(lines: string[]): Block[] {
  const sections = parseResourceFile(lines.join("\n")).filter((s) => s.tag !== "");
  return sections.map((s, i) => ({ ...s, start: s.line - 1, end: (sections[i + 1]?.line ?? lines.length + 1) - 1 }));
}

/** The first line after a block's last non-blank line. */
export function contentEnd(lines: string[], block: Block): number {
  let end = block.end;
  while (end > block.start + 1 && (lines[end - 1] ?? "").trim() === "") end--;
  return end;
}

/** The lines `key = value` of one property spans in a block (a value may run over several lines). */
export function propSpan(lines: string[], block: Block, key: string): { start: number; count: number } | undefined {
  const keys = Object.entries(block.propLines).sort((a, b) => a[1] - b[1]);
  const at = keys.findIndex(([k]) => k === key);
  if (at < 0) return undefined;
  const start = (keys[at]?.[1] ?? 0) - 1;
  const next = keys[at + 1];
  return { start, count: (next ? next[1] - 1 : contentEnd(lines, block)) - start };
}

/** Applies splices made against `lines`, bottom-up. */
export function applySplices(lines: string[], splices: Splice[]): string[] {
  const out = [...lines];
  for (const s of [...splices].sort((a, b) => b.start - a.start || b.count - a.count || Number(b.tail ?? false) - Number(a.tail ?? false))) out.splice(s.start, s.count, ...s.added);
  return out;
}
