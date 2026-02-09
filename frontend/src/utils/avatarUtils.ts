/**
 * Generate an avatar URL from an X/Twitter username using unavatar.io
 */
export function getXAvatarUrl(username: string): string | null {
  const cleaned = username.replace(/^@/, '').trim();
  if (!cleaned) return null;
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(cleaned)) return null;
  return `https://unavatar.io/x/${cleaned}`;
}
