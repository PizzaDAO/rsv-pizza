/**
 * Generate a UUID with fallback for browsers that don't support crypto.randomUUID().
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Extract a social media handle from a URL or @-prefixed string.
 * Handles formats like:
 *   https://twitter.com/handle, https://x.com/handle,
 *   https://instagram.com/handle, @handle, handle
 */
export function stripToHandle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  // Strip URL — match twitter.com, x.com, instagram.com paths
  const urlMatch = trimmed.match(/(?:twitter\.com|x\.com|instagram\.com)\/(?:@)?([A-Za-z0-9_.]+)/i);
  if (urlMatch) return urlMatch[1];
  // Strip leading @
  return trimmed.replace(/^@/, '');
}

/**
 * Normalise a URL by prepending `https://` if no protocol is present.
 * Applied on blur so it doesn't interfere with typing.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Strips markdown formatting from a string, returning plain text.
 * Useful for meta descriptions and other contexts where markdown syntax
 * should not be visible.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // Remove images ![alt](url) -> alt
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Remove links [text](url) -> text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Remove bold/italic (order matters: bold first, then italic)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      // Remove strikethrough
      .replace(/~~(.+?)~~/g, '$1')
      // Remove headers (# at start of line)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove blockquote markers
      .replace(/^>\s+/gm, '')
      // Remove unordered list markers (-, *, +)
      .replace(/^[\s]*[-*+]\s+/gm, '')
      // Remove ordered list markers (1., 2., etc.)
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Remove inline code backticks
      .replace(/`([^`]*)`/g, '$1')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Collapse multiple whitespace/newlines into single spaces
      .replace(/\s+/g, ' ')
      .trim()
  );
}
