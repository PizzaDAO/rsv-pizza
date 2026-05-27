// pecorino-64118: shared server-side helper for deriving organization email
// domains (TLDs) from guest email addresses for the "Industry RSVPs" report
// section. Personal email providers are excluded so only org domains surface.
// Port of the frontend EMAIL_PROVIDERS set from frontend/src/utils/emailUtils.ts.

export const PERSONAL_EMAIL_PROVIDERS: Set<string> = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'mail.com', 'email.com',
  'protonmail.com', 'proton.me', 'zoho.com', 'yandex.com', 'yandex.ru',
  'gmx.com', 'gmx.net', 'fastmail.com', 'tutanota.com', 'tuta.com',
  'hey.com', 'pm.me', 'inbox.com', 'mail.ru', 'qq.com', '163.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
  'charter.net', 'earthlink.net', 'optonline.net', 'frontier.com',
]);

// Returns the lowercased email domain if it is NOT a personal provider,
// otherwise null. Also returns null for missing / malformed emails.
export function orgDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1].trim().toLowerCase();
  if (!domain) return null;
  if (PERSONAL_EMAIL_PROVIDERS.has(domain)) return null;
  return domain;
}

// Maps a list of emails to org domains, counts occurrences per domain, and
// returns them sorted by count desc then domain asc. Personal providers and
// malformed/empty emails are dropped.
export function buildIndustryOrgs(
  emails: (string | null | undefined)[],
): { domain: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const email of emails) {
    const domain = orgDomainFromEmail(email);
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}
