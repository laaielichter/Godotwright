import { Command } from "commander";
import { apiCommand } from "./commands/api.js";
import { checkCommand } from "./commands/check.js";
import { collectorCommand } from "./commands/collector.js";
import { learnCommand } from "./commands/learn.js";
import { mcpCommand } from "./commands/mcp.js";
import { modelCommand } from "./commands/model.js";
import { reviewCommand } from "./commands/review.js";
import { migrateCommand } from "./commands/migrate.js";
import { usagesCommand } from "./commands/usages.js";
import { renameCommand } from "./commands/rename.js";
import { projectCommand } from "./commands/project.js";
import { scanCommand } from "./commands/scan.js";
import { maybeShare, takeShareNotice } from "./learn/share.js";
import { GODOT_TARGET, VERSION } from "./version.js";

export function createProgram(): Command {
  return new Command()
    .name("godotwright")
    .description(
      `AAA coding toolkit for Godot ${GODOT_TARGET}. Makes any coding agent better at Godot.`,
    )
    .version(VERSION, "-v, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError()
    .addCommand(scanCommand())
    .addCommand(checkCommand())
    .addCommand(apiCommand())
    .addCommand(reviewCommand())
    .addCommand(migrateCommand())
    .addCommand(usagesCommand())
    .addCommand(renameCommand())
    .addCommand(projectCommand())
    .addCommand(modelCommand())
    .addCommand(mcpCommand())
    .addCommand(learnCommand())
    .addCommand(collectorCommand())
    .hook("postAction", async (_program, action) => {
      // The MCP server keeps running and shares on its own; learn commands manage sharing.
      if (action.name() === "mcp" || ["learn", "collector"].includes(action.parent?.name() ?? "")) return;
      const notice = takeShareNotice();
      if (notice) process.stderr.write(`\n${notice}\n`);
      await maybeShare();
    });
}
