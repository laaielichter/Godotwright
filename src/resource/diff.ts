/** One changed stretch: `line` is the 1-based line in the old text where it starts. */
export interface Hunk {
  line: number;
  removed: string[];
  added: string[];
}

/** Above this many cells the middle part is shown as one hunk instead of a line-by-line diff. */
const MAX_CELLS = 4_000_000;

/** The changed lines between two versions of a file, as compact hunks (common start and end trimmed, LCS between). */
export function lineDiff(a: string[], b: string[]): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (!midA.length && !midB.length) return [];
  if (midA.length * midB.length > MAX_CELLS) return [{ line: start + 1, removed: midA, added: midB }];
  // LCS table from the end, then walk it to emit the hunks.
  const n = midA.length;
  const m = midB.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = table[i] as Uint32Array;
    const below = table[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j--) row[j] = midA[i] === midB[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
  }
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  const flush = () => {
    if (current) hunks.push(current);
    current = undefined;
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || (table[i]?.[j + 1] ?? 0) >= (table[i + 1]?.[j] ?? 0))) {
      current ??= { line: start + i + 1, removed: [], added: [] };
      current.added.push(midB[j++] as string);
    } else {
      current ??= { line: start + i + 1, removed: [], added: [] };
      current.removed.push(midA[i++] as string);
    }
  }
  flush();
  return hunks;
}

/** Hunks as `  line  - old` / `        + new` lines, the way scene edits print them. */
export function formatHunks(hunks: Hunk[], maxLines = 80): string[] {
  const out: string[] = [];
  let shown = 0;
  for (const h of hunks) {
    for (const [sign, list] of [["-", h.removed], ["+", h.added]] as const) {
      list.forEach((l, i) => {
        if (shown++ < maxLines) out.push(`  ${i === 0 && (sign === "-" || !h.removed.length) ? String(h.line).padStart(4) : "    "}  ${sign} ${l.length > 200 ? `${l.slice(0, 200)}...` : l}`);
      });
    }
  }
  if (shown > maxLines) out.push(`  ... ${shown - maxLines} more changed lines`);
  return out;
}
