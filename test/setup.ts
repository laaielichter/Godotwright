import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests must never read or write the real learning file in the user's home.
process.env["GODOTWRIGHT_HOME"] = mkdtempSync(join(tmpdir(), "godotwright-home-"));
