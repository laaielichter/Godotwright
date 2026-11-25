import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { VariantParseError } from "../godot/variant.js";
import { formatMerge } from "../merge/merge.js";
import { formatMergeReport, installMergeDriver, mergeFiles, mergeProject } from "../merge/project.js";
import { GitError } from "../project/git.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

interface MergeFlags {
  path: string;
  theirs?: string;
  prefer?: string;
  write?: boolean;
  json?: boolean;
  out?: string;
  driver?: boolean;
  name?: string;
  install?: boolean;
  command?: string;
}

export function mergeCommand(): Command {
  return new Command("merge")
    .description(
      "merge scenes, resources and project.godot by meaning: nodes by path, properties one by one, resource ids renumbered so both sides fit. Without arguments: the files a git merge left in conflict. With three files (base ours theirs): merge those. --install makes git do it by itself",
    )
    .argument("[files...]", "three files (base ours theirs), or res:// files to limit a merge in progress to")
    .option("--path <dir>", "project directory (default: the current one)", ".")
    .option("--theirs <commit>", "preview what merging this branch or commit into HEAD does to the Godot files, before you merge")
    .option("--prefer <side>", "the side a conflict takes: ours (default) or theirs")
    .option("--write", "write the merged files into the working tree (a merge in progress)")
    .option("--out <file>", "with three files: write the result here instead of printing it")
    .option("--driver", "with three files: act as a git merge driver (write into the second file, exit 1 on a conflict)")
    .option("--name <path>", "with three files: the real name of the file (git's %P), to know what kind it is")
    .option("--install", "set this up as the git merge driver for *.tscn, *.tres and project.godot (.gitattributes and this clone's git config)")
    .option("--command <cmd>", "with --install: how git starts Godotwright", "npx -y godotwright")
    .option("--json", "print the result as JSON")
    .action((files: string[], o: MergeFlags, command: Command) => {
      const fail = (message: string) => {
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      };
      if (o.prefer !== undefined && o.prefer !== "ours" && o.prefer !== "theirs") return fail(`--prefer must be ours or theirs, not "${o.prefer}"`);
      const prefer = o.prefer ? { prefer: o.prefer as "ours" | "theirs" } : {};
      try {
        if (o.install) {
          const done = installMergeDriver(o.path, o.command);
          writeOut(command, `git now merges *.tscn, *.tres and project.godot with Godotwright in this clone.\n  driver: ${done.driver}\n  ${done.added.length ? `added to ${done.attributes}: ${done.added.join("; ")} (commit this file)` : `${done.attributes} already had the lines`}\nEvery other clone runs "godotwright merge --install" once.\n`);
          return;
        }
        if (o.driver || o.out !== undefined || (files.length === 3 && !files.some((f) => f.startsWith("res://")))) {
          if (files.length !== 3) return fail("give three files: base ours theirs");
          const [base, ours, theirs] = files as [string, string, string];
          const result = mergeFiles(base, ours, theirs, { ...prefer, ...(o.name ? { name: o.name } : {}) });
          const report = formatMerge(o.name ?? ours, result, 200);
          if (o.driver) {
            writeFileSync(ours, result.text);
            if (result.conflicts.length) fail(report.trimEnd());
            return;
          }
          if (o.out !== undefined) writeFileSync(o.out, result.text);
          if (o.json) writeOut(command, `${JSON.stringify(result, null, 2)}\n`);
          else if (o.out !== undefined) writeOut(command, report);
          else {
            writeOut(command, result.text);
            process.stderr.write(report);
          }
          if (result.conflicts.length) process.exitCode = 1;
          return;
        }
        const report = mergeProject(o.path, { ...prefer, ...(files.length ? { files } : {}), ...(o.theirs ? { theirs: o.theirs } : {}), ...(o.write ? { write: true } : {}) });
        writeOut(command, o.json ? `${JSON.stringify(report, null, 2)}\n` : formatMergeReport(report, 200));
        if (!report.ok) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError) && !(error instanceof GitError) && !(error instanceof VariantParseError)) throw error;
        fail(error.message);
      }
    });
}
