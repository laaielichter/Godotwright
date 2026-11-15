import { Command } from "commander";
import { applyDream, DreamError, dream, formatApply, formatDream, markDreamed, parseSince, setAutoApplyConsent } from "../dream/dream.js";
import { findProjectRoot } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

interface DreamCommandOptions {
  apply?: string;
  json?: boolean;
  since?: string;
  transcripts?: boolean;
  autoApply?: string;
  all?: boolean;
  detail: string;
}

export function dreamCommand(): Command {
  return new Command("dream")
    .description(
      "look back at what was learned and done in this project (the learning file, the journal and, with --transcripts, the Claude Code and Codex session transcripts) " +
        "and propose lessons, project hints, merges, retirements and fixes for contradictions, with the evidence. No model, no network; nothing changes until --apply, and godotwright undo takes an apply back",
    )
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--apply <ids>", "apply these proposals: numbers or ids from the list, comma separated, or all")
    .option("--since <age>", "only journal events and transcripts this recent: 7d, 12h, 2w or a date (default 30d)")
    .option("--transcripts", "also read this project's Claude Code and Codex session transcripts (only anonymous facts are kept)")
    .option("--auto-apply <yes|no>", 'allow (yes) or stop (no) the session-start hook applying dreams by itself in this project when godotwright.json says "dream": {"auto": "apply"}; kept on this machine only')
    .option("--all", "also list proposals applied or seen before")
    .option("--detail <level>", "brief or full (default full)", "full")
    .option("--json", "print the proposals (or what was applied) as JSON")
    .action((path: string, options: DreamCommandOptions, command: Command) => {
      try {
        if (options.detail !== "brief" && options.detail !== "full") throw new DreamError("detail must be brief or full");
        if (options.autoApply !== undefined) {
          if (options.autoApply !== "yes" && options.autoApply !== "no") throw new DreamError("--auto-apply takes yes or no");
          const root = findProjectRoot(path);
          if (!root) throw new ProjectNotFoundError(path);
          setAutoApplyConsent(root, options.autoApply === "yes");
          writeOut(
            command,
            options.autoApply === "yes"
              ? 'The session-start hook may now apply lesson and hint changes by itself in this project when godotwright.json has "dream": {"auto": "apply"} (never a removal; godotwright undo takes it back). godotwright dream --auto-apply no stops it.\n'
              : "The session-start hook no longer applies dreams by itself in this project; it only says when proposals wait.\n",
          );
          return;
        }
        const common = {
          ...(options.since ? { since: parseSince(options.since) } : {}),
          ...(options.transcripts ? { transcripts: true } : {}),
          ...(options.all ? { all: true } : {}),
        };
        if (options.apply !== undefined) {
          const r = applyDream(path, options.apply, common);
          markDreamed(r.root);
          if (options.json) {
            const { root: _root, ...rest } = r;
            writeOut(command, `${JSON.stringify(rest, null, 2)}\n`);
          } else writeOut(command, formatApply(r));
          return;
        }
        const r = dream(path, common);
        markDreamed(r.root);
        if (options.json) {
          const { root: _root, ...rest } = r;
          writeOut(command, `${JSON.stringify(rest, null, 2)}\n`);
        } else writeOut(command, formatDream(r, options.detail));
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError || error instanceof DreamError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
