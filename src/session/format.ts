import { formatDiagnostic, type Diagnostic } from "../check/log.js";
import type { SessionStart } from "./session.js";

export function formatStart(s: SessionStart): string {
  const lines = [
    s.reused
      ? `session: already running ${s.info.scene} (started ${s.info.started.slice(11, 19)} UTC); pass restart to load it again`
      : `session: ${s.info.scene} loaded in ${s.loadSeconds} s, paused at frame 0 (${s.info.fps} physics frames per second; time moves only on a step)`,
  ];
  for (const d of s.diagnostics.filter((x) => x.severity === "error").slice(0, 10)) lines.push(formatDiagnostic(d));
  lines.push("Next: godot_game tree (what is in the scene), get (read values), step (play frames with input), until a condition holds; godot_session stop when done.");
  return `${lines.join("\n")}\n`;
}

type Reply = Record<string, unknown>;

function table(watch: string[], samples: [number, Record<string, string>][]): string[] {
  if (!watch.length || !samples.length) return [];
  const cols = ["frame", ...watch];
  const rows = samples.map(([frame, values]) => [String(frame), ...watch.map((w) => values[w] ?? "")]);
  const width = cols.map((c, i) => Math.min(40, Math.max(c.length, ...rows.map((r) => (r[i] ?? "").length))));
  const pad = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padStart(width[0] ?? 5) : c.padEnd(width[i] ?? 0))).join("  ").trimEnd();
  return [pad(cols), ...rows.map(pad)];
}

/** One game reply as compact text, with the errors the game printed since the last call under it. */
export function formatGame(op: string, reply: Reply, diagnostics: Diagnostic[], watch: string[] = []): string {
  const out: string[] = [];
  if (!reply["ok"]) out.push(`error: ${String(reply["error"] ?? "the game refused the request")}`);
  else {
    switch (op) {
      case "tree":
        out.push(`tree at frame ${reply["frame"]}:`, ...((reply["lines"] as string[]) ?? []));
        break;
      case "get": {
        const values = (reply["values"] ?? {}) as Record<string, string>;
        out.push(`frame ${reply["frame"]}:`, ...Object.entries(values).map(([k, v]) => `  ${k} = ${v}`));
        break;
      }
      case "set":
        out.push(`set at frame ${reply["frame"]}; it reads back as ${reply["value"]}`);
        break;
      case "call":
      case "eval":
        out.push(`= ${reply["value"]}  (frame ${reply["frame"]})`);
        break;
      case "signals":
        out.push(`recording: ${((reply["recording"] as string[]) ?? []).join(", ") || "nothing (no such signals)"}; steps list them when they fire`);
        break;
      case "step": {
        const samples = (reply["samples"] ?? []) as [number, Record<string, string>][];
        const until = reply["until_met"];
        out.push(`frames ${reply["from"]}-${reply["to"]}${until === true ? `: the condition held at frame ${reply["to"]}` : until === false ? ": the condition never held" : ""}`);
        out.push(...table(watch, samples));
        const signals = (reply["signals"] ?? []) as [number, string, string[]][];
        for (const [frame, name, args] of signals.slice(0, 40)) out.push(`  frame ${frame} ${name}(${args.join(", ")})`);
        if (signals.length > 40) out.push(`  +${signals.length - 40} more signals`);
        break;
      }
      case "status":
        out.push(`running ${reply["scene"]} at frame ${reply["frame"]}, ${reply["nodes"]} nodes`);
        break;
      default:
        out.push(JSON.stringify(reply));
    }
  }
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  if (errors.length || warnings.length) {
    out.push(`the game printed ${errors.length} error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${warnings.length === 1 ? "" : "s"} since the last call:`);
    for (const d of [...errors, ...warnings].slice(0, 12)) out.push(formatDiagnostic(d));
  }
  return `${out.join("\n")}\n`;
}
