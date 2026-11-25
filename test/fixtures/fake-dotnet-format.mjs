#!/usr/bin/env node
// A dotnet for the format tests. `format whitespace <dir> --folder --include <files>` rewrites `x=1` to `x = 1` in the
// included files; with $FAKE_FORMAT_MORE it also renames `Old` to `New` (more than whitespace). `build` reports an
// error for every file under the cwd that has `x = 1` in it when $FAKE_BUILD_BREAKS is set.
import { readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (process.env.FAKE_DOTNET_LOG) appendFileSync(process.env.FAKE_DOTNET_LOG, `${JSON.stringify(args)}\n`);
if (args[0] === "format") {
  const dir = args[2];
  const files = args.slice(args.indexOf("--include") + 1).filter((a) => !a.startsWith("-") && a !== "q");
  for (const f of files) {
    const p = join(dir, f);
    let t = readFileSync(p, "utf8").replace(/x=1/g, "x = 1");
    if (process.env.FAKE_FORMAT_MORE) t = t.replace(/\bOld\b/g, "New");
    writeFileSync(p, t);
  }
  process.exit(0);
}
if (args[0] === "build") {
  const walk = (d) => readdirSync(d).flatMap((n) => (n.startsWith(".") || n === "obj" ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  let bad = 0;
  for (const f of walk(process.cwd())) {
    if (f.endsWith(".cs") && process.env.FAKE_BUILD_BREAKS && readFileSync(f, "utf8").includes("x = 1") && f.includes(process.env.FAKE_BUILD_BREAKS)) {
      bad++;
      process.stdout.write(`${f}(3,5): error CS1002: ; expected [${process.cwd()}/Cs.csproj]\n`);
    }
  }
  process.exit(bad ? 1 : 0);
}
process.exit(0);
