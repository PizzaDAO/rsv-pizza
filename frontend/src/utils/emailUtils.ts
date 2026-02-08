export function extractEmailDomain(email: string): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  return parts[1].toLowerCase();
}

export function extractEmailLocalPart(email: string): string {
  if (!email) return '';
  const parts = email.split('@');
  return parts[0] || email;
}
