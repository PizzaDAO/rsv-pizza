/** Escape text for an HTML body or a double-quoted attribute. Brand-controlled strings must pass through this in emails. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Collapse CR/LF (and other line separators) so user text can't inject headers/lines into subjects or plain-text parts. */
export function oneLine(s: unknown): string {
  return String(s ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ');
}
