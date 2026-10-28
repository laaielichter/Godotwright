#!/usr/bin/env node
import { createProgram } from "./program.js";

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  if (!process.exitCode) process.exitCode = 1;
}
