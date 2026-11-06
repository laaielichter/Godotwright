// Generates docs/rules.md from the review RULES so the page never drifts.
// Run after `npm run build` (or as part of check if desired).
//
//   node scripts/build-rules-doc.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RULES, CATEGORIES } from "../dist/review/rules.js";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "docs", "rules.md");

const byCategory = {};
for (const cat of CATEGORIES) byCategory[cat] = [];
for (const rule of Object.values(RULES)) {
  byCategory[rule.category].push(rule);
}
for (const cat of CATEGORIES) {
  byCategory[cat].sort((a, b) => a.id.localeCompare(b.id));
}

let md = `# Review rules

This page lists every rule used by \`godotwright review\`. It is generated from the source of truth in \`src/review/rules.ts\`.

To regenerate after adding or changing a rule:

\`\`\`sh
npm run build
node scripts/build-rules-doc.mjs
\`\`\`

Rules are grouped by category. Severity is \`error\`, \`warning\` or \`info\`. The fix is the one-sentence guidance shown with each finding.

`;

for (const cat of CATEGORIES) {
  md += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`;
  md += `| ID | Severity | Title | Fix |\n`;
  md += `| --- | --- | --- | --- |\n`;
  for (const r of byCategory[cat]) {
    const fix = r.fix.replace(/\|/g, "\\|").replace(/\n/g, " ");
    md += `| \`${r.id}\` | ${r.severity} | ${r.title} | ${fix} |\n`;
  }
  md += "\n";
}

writeFileSync(out, md);
console.log(`Wrote ${Object.keys(RULES).length} rules to ${out}`);
