import { Command } from "commander";
import { parseFindingLine, recordFeedback, type Verdict } from "../learn/learn.js";
import { learningFile, readLearning, resetLearning, updateLearning } from "../learn/store.js";
import { writeOut } from "./output.js";

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
        `sharing: ${data.sharing.enabled ? "on" : "off"} (opt-in)`,
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
      updateLearning((d) => (d.enabled = true));
      writeOut(command, "local learning is on\n");
    });

  learn
    .command("off")
    .description("turn local learning off (nothing is recorded)")
    .action((_o: unknown, command: Command) => {
      updateLearning((d) => (d.enabled = false));
      writeOut(command, "local learning is off\n");
    });

  learn
    .command("reset")
    .description("forget everything learned on this machine")
    .action((_o: unknown, command: Command) => {
      resetLearning();
      writeOut(command, `deleted ${learningFile()}\n`);
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
