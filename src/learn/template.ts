/**
 * Turns an engine message into a template without project details:
 * paths, quoted names and numbers are replaced by placeholders.
 *
 *   Identifier "jump_hieght" not declared in the current scope.
 *   -> Identifier "<s>" not declared in the current scope.
 */
export function messageTemplate(message: string): string {
  return message
    .replace(/(res|user|uid):\/\/[^\s'"()]*/g, "<path>")
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@-]+){2,}/g, "<path>")
    // Whatever still holds a slash is part of a path (e.g. one with spaces).
    .replace(/[^\s"'<>]*[\\/][^\s"'<>]*/g, "<path>")
    .replace(/"[^"]*"/g, '"<s>"')
    .replace(/'[^']*'/g, "'<s>'")
    .replace(/\b0x[0-9a-fA-F]+\b/g, "<n>")
    .replace(/-?\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** True when a template is safe to share: no paths or long free text left. */
export function shareableTemplate(template: string): boolean {
  return !/[\\/]/.test(template.replace(/<path>/g, "")) && template.length >= 8 && !/[@\w.-]+@[\w-]+\.\w+/.test(template);
}
