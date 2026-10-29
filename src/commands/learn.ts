import { Command } from "commander";
import { GodotApi } from "../api/api.js";
import { parseFindingLine, recordFeedback, type Verdict } from "../learn/learn.js";
import { buildReport, setSharing, shareBlocked, shareEndpoint } from "../learn/share.js";
import { learningFile, readLearning, resetLearning, saveLearning, type LearningData } from "../learn/store.js";
import { writeOut } from "./output.js";

/** Saves the local learning switch, or fails with the reason: a choice that did not stick must not be reported as made. */
function setEnabled(enabled: boolean): LearningData {
  const { data, error } = saveLearning((d) => (d.enabled = enabled));
  if (error) throw new Error(`local learning not saved (${learningFile()}): ${error}`);
  return data;
}

export function learnCommand(): Command {
  const learn = new Command("learn").description("what Godotwright learned on this machine, and sharing it (opt-in)");

  learn
    .command("status", { isDefault: true })
    .description("show what was learned and whether sharing is on")
    .action((_options: unknown, command: Command) => {
      const data = readLearning();
      const rules = Object.entries(data.rules).sort(([a], [b]) => a.localeCompare(b));
      const lines = [
        `learning file: ${learningFile()}`,
        `local learning: ${data.enabled && process.env["GODOTWRIGHT_LEARN"] !== "0" ? "on" : "off"} (stays on this machine)`,
        `sharing: ${data.sharing.enabled ? "on" : "off"} (opt-in; godotwright learn share on|off)`,
        ...(data.sharing.enabled ? [`  collector: ${shareEndpoint(data) || "none set up yet, nothing is sent"}`, `  last report: ${data.sharing.lastSentAt ?? "never"}`] : []),
        "",
        `rules seen: ${rules.length}`,
        ...rules.map(([rule, s]) => `  ${rule}: reported ${s.reported}, confirmed by Godot ${s.confirmed}, contradicted ${s.contradicted}, marked wrong ${s.dismissed}`),
        `API lookups that found nothing: ${Object.keys(data.apiMisses).length}`,
        `Godot errors the review missed: ${Object.values(data.missedByReview).reduce((a, b) => a + b, 0)}`,
        `Godot messages not tied to a file: ${Object.values(data.unparsed).reduce((a, b) => a + b, 0)}`,
        `findings marked as wrong: ${Object.keys(data.dismissed).length}`,
      ];
      writeOut(command, `${lines.join("\n")}\n`);
    });

  learn
    .command("on")
    .description("turn local learning on")
    .action((_o: unknown, command: Command) => {
      setEnabled(true);
      const note = process.env["GODOTWRIGHT_LEARN"] === "0" ? " (GODOTWRIGHT_LEARN=0 still turns it off in this shell)" : "";
      writeOut(command, `local learning is on${note}\n`);
    });

  learn
    .command("off")
    .description("turn local learning off (nothing is recorded)")
    .action((_o: unknown, command: Command) => {
      setEnabled(false);
      writeOut(command, "local learning is off\n");
    });

  learn
    .command("share")
    .description("turn anonymous sharing on or off (default off)")
    .argument("<state>", "on or off")
    .action((state: string, _o: unknown, command: Command) => {
      if (state !== "on" && state !== "off") throw new Error("state must be on or off");
      const data = setSharing(state === "on");
      if (state === "off") {
        writeOut(command, "sharing is off; nothing is sent\n");
        return;
      }
      const endpoint = shareEndpoint(data);
      writeOut(
        command,
        [
          "sharing is on. Thank you!",
          "Once a day, Godotwright sends anonymous counts: which review rules Godot confirmed or",
          "contradicted, mistyped Godot API names and what they meant, and Godot error templates",
          "without names. Never code, file names, paths or project names.",
          "See the next report with: godotwright learn preview",
          endpoint ? `collector: ${endpoint}` : "No collector is set up in this version yet, so nothing is sent until one is.",
          "",
        ].join("\n"),
      );
    });

  learn
    .command("preview")
    .description("show exactly what sharing would send next")
    .action((_o: unknown, command: Command) => {
      const data = readLearning();
      const built = buildReport(data, GodotApi.load());
      const blocked = shareBlocked(data);
      const lines = [blocked ? `not sent now: ${blocked}` : `next report goes to ${shareEndpoint(data)}`];
      lines.push(built ? JSON.stringify(built.report, null, 2) : "nothing new to send");
      writeOut(command, `${lines.join("\n")}\n`);
    });

  learn
    .command("reset")
    .description("forget everything learned on this machine (sharing goes back to off; local learning stays on or off)")
    .action((_o: unknown, command: Command) => {
      const wasOn = readLearning().enabled;
      resetLearning();
      // A reset forgets what was learned, not the choice to stop learning.
      if (wasOn) {
        writeOut(command, `deleted ${learningFile()}\n`);
        return;
      }
      setEnabled(false);
      writeOut(command, `deleted ${learningFile()}\nlocal learning stays off (learn on turns it back on)\n`);
    });

  learn
    .command("feedback")
    .description("mark a review finding as wrong (hidden from now on) or right")
    .argument("<verdict>", "wrong or right")
    .argument("<finding...>", "the finding line as godotwright review printed it")
    .action((verdict: string, finding: string[], _o: unknown, command: Command) => {
      if (verdict !== "wrong" && verdict !== "right") throw new Error("verdict must be wrong or right");
      const parsed = parseFindingLine(finding.join(" "));
      if (!parsed) throw new Error("pass the finding line exactly as godotwright review printed it");
      recordFeedback(parsed, verdict as Verdict);
      writeOut(command, `noted: ${parsed.rule} at ${parsed.file} is ${verdict}\n`);
    });

  return learn;
}
