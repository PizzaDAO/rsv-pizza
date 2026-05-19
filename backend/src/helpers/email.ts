/**
 * Canonical email normalization for User.email lookups + writes.
 * Lowercases and trims. RFC 5321 says the local-part is case-sensitive,
 * but no consumer mail provider preserves case, and we MUST collapse case
 * for identity to work across iOS auto-capitalization. See mushroom-48468.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}
