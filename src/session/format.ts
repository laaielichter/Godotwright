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
export function formatGame(op: string, reply: Reply, diagnostics: Diagnostic[], watch: string[] = [], detailControls = true): string {
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
      case "layout": {
        const lines = (reply["lines"] as string[]) ?? [];
        out.push(`layout at frame ${reply["frame"]} (global position, size, lowest point and what is below):`, ...(lines.length ? lines : ["no 3D objects with a size here"]));
        break;
      }
      case "ray": {
        const hit = (reply["hit"] ?? {}) as Record<string, unknown>;
        out.push(hit["error"] ? `error: ${hit["error"]}` : hit["hit"] ? `hit ${hit["node"] || "a collider"} at ${hit["position"]}, normal ${hit["normal"]}` : "the ray hits nothing");
        break;
      }
      case "ui": {
        for (const size of (reply["sizes"] ?? []) as { size: string; controls: string[]; count: number; issues: string[] }[]) {
          out.push(`ui at ${size.size}: ${size.count} visible controls, ${size.issues.length} issue${size.issues.length === 1 ? "" : "s"}`);
          for (const issue of size.issues.slice(0, 30)) out.push(`  ${issue}`);
          if (detailControls) for (const c of size.controls) out.push(`    ${c}`);
        }
        break;
      }
      case "reload": {
        const list = (key: string) => ((reply[key] as string[]) ?? []);
        const reloaded = list("reloaded");
        const failed = list("failed");
        const waiting = list("waiting");
        if (!reloaded.length && !failed.length && !waiting.length) out.push(`nothing to reload at frame ${reply["frame"]}: no script changed since the session started or the last reload`);
        else if (reloaded.length) out.push(`reloaded ${reloaded.length} script${reloaded.length === 1 ? "" : "s"} at frame ${reply["frame"]}; every node kept its values and runs the new code from the next step: ${reloaded.join(", ")}`);
        for (const f of failed) out.push(`not reloaded: ${f}`);
        if (waiting.length) out.push(`not loaded by the game yet, so they load with the new code: ${waiting.join(", ")}`);
        if (list("initialized").length) out.push(`new variables got their starting values on the nodes that already exist: ${list("initialized").join(", ")}`);
        if (list("left").length) out.push(`new variables left null on the nodes that already exist (objects, or a script whose _init needs arguments): ${list("left").join(", ")}`);
        const others = list("others");
        if (others.length) out.push(`changed, but a reload only takes scripts: ${others.slice(0, 8).join(", ")}${others.length > 8 ? ` +${others.length - 8} more` : ""}; godot_session start with restart: true loads them`);
        if (reloaded.length) out.push("_ready() and _init() do not run again: what they set up stays as it was (restart the session when that matters).");
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
