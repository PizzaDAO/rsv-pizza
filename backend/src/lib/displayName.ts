/**
 * Public display name: first name + last initial ("Jane Doe" -> "Jane D.").
 * Single-word names are kept; the initial comes from the last word
 * ("Mary Smith-Jones" -> "Mary S."). Empty -> "Guest".
 */
export function shortName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Guest';
  if (parts.length === 1) return parts[0];
  const initial = Array.from(parts[parts.length - 1])[0].toUpperCase();
  return `${parts[0]} ${initial}.`;
}
