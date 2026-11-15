/**
 * Writes LIBRARY.md, the catalogue of the asset library, from the families in src/library/families.
 * Usage: npm run build:library   (builds dist/ first)
 */
import { writeFileSync } from "node:fs";
import { catalogMarkdown } from "../dist/library/format.js";

writeFileSync(new URL("../LIBRARY.md", import.meta.url), catalogMarkdown());
console.log("wrote LIBRARY.md");
