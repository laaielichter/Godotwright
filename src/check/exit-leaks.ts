/** What Godot lists at exit when it runs with --verbose. */
export interface ExitLeaks {
  /** "Leaked instance: Class:id" lines, counted per class. */
  instances: Record<string, number>;
  /** "Resource still in use: res://x (Type)". */
  resources: { path: string; type: string }[];
  /** RID leaks by type ("RendererSceneCull::Instance"): count. */
  rids: Record<string, number>;
  /** The totals line: "15 ObjectDB instances were leaked at exit". */
  objects?: number;
}

/** "N17RendererSceneCull8InstanceE" as "RendererSceneCull::Instance"; other names as they are. */
export function demangle(name: string): string {
  const m = /^N((?:\d+[A-Za-z_]\w*?)+)E$/.exec(name);
  if (!m) return name;
  const parts: string[] = [];
  let rest = m[1]!;
  while (rest) {
    const len = /^(\d+)/.exec(rest);
    if (!len) return name;
    const n = Number(len[1]);
    parts.push(rest.slice(len[1]!.length, len[1]!.length + n));
    rest = rest.slice(len[1]!.length + n);
  }
  return parts.join("::");
}

/** What Godot lists at exit (the class list needs --verbose): leaked instances per class, resources still in use, leaked RIDs. */
export function parseExitLeaks(text: string): ExitLeaks {
  const out: ExitLeaks = { instances: {}, resources: [], rids: {} };
  for (const m of text.matchAll(/^Leaked instance: (\w+):\d+/gm)) {
    // The GDScript module's own class objects, not the game's.
    if (m[1] === "GDScriptNativeClass") continue;
    out.instances[m[1]!] = (out.instances[m[1]!] ?? 0) + 1;
  }
  for (const m of text.matchAll(/^Resource still in use: (\S+) \((\w+)\)/gm)) out.resources.push({ path: m[1]!, type: m[2]! });
  for (const m of text.matchAll(/(\d+) RID allocations of type '([^']+)' were leaked at exit/g)) out.rids[demangle(m[2]!)] = (out.rids[demangle(m[2]!)] ?? 0) + Number(m[1]);
  for (const m of text.matchAll(/(\d+) RIDs? of type "([^"]+)" (?:were|was) leaked/g)) out.rids[m[2]!] = (out.rids[m[2]!] ?? 0) + Number(m[1]);
  const total = /(\d+) ObjectDB instances? (?:were|was) leaked at exit/.exec(text);
  if (total) out.objects = Number(total[1]);
  return out;
}
