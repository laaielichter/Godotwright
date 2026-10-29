import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests must never read or write the real learning file in the user's home.
const home = mkdtempSync(join(tmpdir(), "godotwright-home-"));
process.env["GODOTWRIGHT_HOME"] = home;
afterAll(() => rmSync(home, { recursive: true, force: true }));
