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
