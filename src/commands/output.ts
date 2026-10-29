import { InvalidArgumentError, type Command } from "commander";

/**
 * Parses a number option. Text such as "8O" is a usage error: as NaN it would silently
 * switch off a gate, budget or limit, and a CI job would stay green.
 */
export function parseNumber(value: string): number {
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n)) throw new InvalidArgumentError("expected a number");
  return n;
}

/** Writes command output through commander, so tests can capture it. */
export function writeOut(command: Command, text: string): void {
  let root = command;
  while (root.parent) root = root.parent;
  const write = root.configureOutput().writeOut ?? ((s: string) => process.stdout.write(s));
  write(text);
}

/** Collects a repeatable option, e.g. `--base a --base b`. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const BASE_HELP = "base project this one is laid over, like a mod over a game (repeatable; also from godotwright.json)";

export const BASE_FILES_HELP = "list of files the shipped game holds, e.g. a .pck manifest (repeatable; also from godotwright.json)";
