import { Command, Option } from "commander";
import { GodotApi } from "../api/api.js";
import { formatLookup, formatSearch } from "../api/format.js";
import { lookupLearning } from "../learn/hooks.js";
import type { Detail } from "../scan/format.js";
import { parseNumber, writeOut } from "./output.js";

export function apiCommand(): Command {
  return new Command("api")
    .description("look up the Godot 4.7 API offline: classes, methods, properties, signals, constants")
    .argument("<query...>", "Class, Class.member, @annotation, a global function, or search words with --search")
    .option("-s, --search", "search names, keywords and descriptions instead of an exact lookup")
    .addOption(new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief"))
    .option("-n, --limit <count>", "max search results", parseNumber, 10)
    .option("--json", "print raw entries as JSON")
    .action((query: string[], options: { search?: boolean; detail: Detail; limit: number; json?: boolean }, command: Command) => {
      const api = GodotApi.load();
      const text = query.join(" ");
      if (options.search) {
        const hits = api.search(text, options.limit);
        writeOut(command, options.json ? `${JSON.stringify(hits, null, 2)}\n` : formatSearch(api, hits));
        return;
      }
      const { result, hints } = lookupLearning(api, text);
      writeOut(command, options.json ? `${JSON.stringify({ ...result, hints }, null, 2)}\n` : formatLookup(api, result, options.detail, hints));
      if (result.entries.length === 0) process.exitCode = 1;
    });
}
