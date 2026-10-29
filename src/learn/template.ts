/**
 * Turns an engine message into a template without project details:
 * paths, quoted names and numbers are replaced by placeholders.
 *
 *   Identifier "jump_hieght" not declared in the current scope.
 *   -> Identifier "<s>" not declared in the current scope.
 */
export function messageTemplate(message: string): string {
  return message
    .replace(/"[^"]*"/g, '"<s>"')
    .replace(/'[^']*'/g, "'<s>'")
    // An unquoted path may hold spaces ("C:\Users\John Smith"), so everything from its start is part of it.
    .replace(/(?:res|user|uid):\/\/[\s\S]*$|(?:[A-Za-z]:)?[\\/][\s\S]*$/, "<path>")
    .replace(/\b0x[0-9a-fA-F]+\b/g, "<n>")
    .replace(/-?\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** True when a template is safe to share: no paths or long free text left. */
export function shareableTemplate(template: string): boolean {
  // A path is the last thing in a template: anything after it may be the rest of a path with spaces.
  const at = template.indexOf("<path>");
  if (at >= 0 && template.slice(at + "<path>".length).trim() !== "") return false;
  return !/[\\/]/.test(template.replace(/<path>/g, "")) && template.length >= 8 && !/[@\w.-]+@[\w-]+\.\w+/.test(template);
}
