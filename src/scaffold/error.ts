/** A scaffold request that cannot be done as asked (a file in the way, an unknown template, a bad name). */
export class ScaffoldError extends Error {}

/** A res:// path inside the project, written the one way (`res://dir/file.ext`), or an error that says what is wrong. */
export function cleanResPath(input: string, extensions: string[], what: string): string {
  const raw = input.trim().replace(/\\/g, "/");
  const rel = raw.startsWith("res://") ? raw.slice(6) : raw.replace(/^\.\//, "");
  if (!rel || rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.includes("://")) throw new ScaffoldError(`"${input}" is not a path inside the project; write res://folder/name.${extensions[0]}`);
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) throw new ScaffoldError(`"${input}" is not a path inside the project; write res://folder/name.${extensions[0]}`);
  if (parts.some((p) => /[<>:"|?*\x00-\x1f]/.test(p))) throw new ScaffoldError(`"${input}" has characters a file name cannot hold on every system`);
  if (!extensions.some((e) => rel.toLowerCase().endsWith(`.${e}`))) throw new ScaffoldError(`${what} needs a file name that ends in ${extensions.map((e) => `.${e}`).join(" or ")}; got "${input}"`);
  return `res://${rel}`;
}
