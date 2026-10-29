import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { aggregate, createCollector, K_ANONYMITY, readReports } from "../collector/collector.js";
import { learnFromProjects } from "../collector/public.js";
import { parseNumber, writeOut } from "./output.js";

export function collectorCommand(): Command {
  const collector = new Command("collector").description("run the collector for opt-in reports, and aggregate them (for maintainers)");

  collector
    .command("serve")
    .description("accept reports on POST /v1/report and store them without IP addresses")
    .option("--port <port>", "port to listen on", parseNumber, 8787)
    .option("--host <host>", "address to listen on", "127.0.0.1")
    .option("--dir <dir>", "directory for the report files", "reports")
    .action((options: { port: number; host: string; dir: string }) => {
      createCollector({ dir: options.dir }).listen(options.port, options.host, () => {
        process.stderr.write(`collector listening on http://${options.host}:${options.port}/v1/report, storing in ${options.dir}\n`);
      });
    });

  collector
    .command("aggregate")
    .description(`sum stored reports into data/learned.json, keeping what at least ${K_ANONYMITY} installs reported`)
    .argument("<dir>", "directory with the report files")
    .option("--out <file>", "where to write the result (default: print it)")
    .option("--min-installs <n>", "installs needed before anything is kept", parseNumber, K_ANONYMITY)
    .action((dir: string, options: { out?: string; minInstalls: number }, command: Command) => {
      const k = Math.max(K_ANONYMITY, options.minInstalls);
      const json = `${JSON.stringify(aggregate(readReports(dir), k), null, 2)}\n`;
      if (options.out) writeFileSync(options.out, json);
      else writeOut(command, json);
    });

  collector
    .command("projects")
    .description("learn from public Godot projects (review + real Godot check) into data/learned.json")
    .argument("<dirs...>", "project directories, e.g. the official demos")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--out <file>", "where to write the result (default: print it)")
    .action(async (dirs: string[], options: { godot?: string; out?: string }, command: Command) => {
      const learned = await learnFromProjects(dirs, { godot: options.godot, timeoutMs: 5 * 60_000, log: (line) => process.stderr.write(`${line}\n`) });
      const json = `${JSON.stringify(learned, null, 2)}\n`;
      if (options.out) writeFileSync(options.out, json);
      else writeOut(command, json);
    });

  return collector;
}
