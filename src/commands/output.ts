import type { Command } from "commander";

/** Writes command output through commander, so tests can capture it. */
export function writeOut(command: Command, text: string): void {
  let root = command;
  while (root.parent) root = root.parent;
  const write = root.configureOutput().writeOut ?? ((s: string) => process.stdout.write(s));
  write(text);
}
