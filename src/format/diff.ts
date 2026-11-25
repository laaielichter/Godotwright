import { lineDiff } from "../resource/diff.js";

/** A unified diff of two versions of a text file (3 lines of context), or "" when they are the same. */
export function unifiedDiff(name: string, before: string, after: string, context = 3): string {
  if (before === after) return "";
  const split = (text: string): string[] => {
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  };
  const a = split(before);
  const b = split(after);
  const hunks = lineDiff(a, b);
  const out = [`--- a/${name}`, `+++ b/${name}`];
  // Text that differs only in its last newline has no changed line to show.
  if (!hunks.length) return `${out.join("\n")}\n\\ the newline at the end of the file changed\n`;
  let shift = 0;
  const shifts = hunks.map((h) => {
    const s = shift;
    shift += h.added.length - h.removed.length;
    return s;
  });
  let i = 0;
  while (i < hunks.length) {
    // Hunks whose context touches are printed as one.
    let j = i;
    while (j + 1 < hunks.length && hunks[j + 1]!.line - (hunks[j]!.line + hunks[j]!.removed.length) <= context * 2) j++;
    const first = hunks[i]!;
    const last = hunks[j]!;
    const start = Math.max(1, first.line - context);
    const end = Math.min(a.length, last.line + last.removed.length - 1 + context);
    const body: string[] = [];
    let line = start;
    let added = 0;
    let removed = 0;
    for (let k = i; k <= j; k++) {
      const h = hunks[k]!;
      for (; line < h.line; line++) body.push(` ${a[line - 1]}`);
      for (const l of h.removed) body.push(`-${l}`);
      for (const l of h.added) body.push(`+${l}`);
      line += h.removed.length;
      added += h.added.length;
      removed += h.removed.length;
    }
    for (; line <= end; line++) body.push(` ${a[line - 1]}`);
    const oldCount = end - start + 1;
    const newCount = oldCount - removed + added;
    out.push(`@@ -${oldCount === 0 ? start - 1 : start},${oldCount} +${newCount === 0 ? start + shifts[i]! - 1 : start + shifts[i]!},${newCount} @@`, ...body);
    i = j + 1;
  }
  return `${out.join("\n")}\n`;
}

/** How many lines of the old text a change removes or replaces, plus the lines it adds. */
export function changedLineCount(before: string, after: string): number {
  return lineDiff(before.split("\n"), after.split("\n")).reduce((n, h) => n + Math.max(h.removed.length, h.added.length), 0);
}
