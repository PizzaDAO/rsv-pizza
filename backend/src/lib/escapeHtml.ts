/**
 * suppli-58533: minimal HTML escape for values interpolated into a Telegram
 * `parse_mode: 'HTML'` message (or any HTML body).
 *
 * Telegram's HTML mode only requires `<`, `>` and `&` to be escaped inside text
 * and `"` inside attribute values, so we cover all four. Kept as a tiny shared
 * helper so the per-type reminder builders (and any future HTML Telegram copy)
 * don't each hand-roll their own.
 */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
