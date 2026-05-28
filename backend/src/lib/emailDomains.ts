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
  // pecorino-64118 cleanup: personal providers / relays / international
  // variants seen in real avax data but missing from the original list.
  'duck.com', 'mozmail.com', 'passinbox.com', '126.com', '139.com',
  '189.cn', 'sina.com', 'sina.cn', 'foxmail.com', 'web.de', 't-online.de',
  'orange.fr', 'free.fr', 'laposte.net', 'libero.it', 'naver.com',
  'daum.net', 'hanmail.net', 'seznam.cz', 'wp.pl', 'o2.pl', 'bluewin.ch',
  'rediffmail.com', 'live.fr', 'live.it', 'live.de', 'live.ca',
  'live.com.mx', 'live.com.ar', 'live.com.pt', 'live.co.uk',
  'outlook.es', 'outlook.fr', 'outlook.de', 'outlook.com.br',
  // pecorino-64118 follow-up: additional personal providers / Apple Hide-My-Email relay.
  'rocketmail.com', 'privaterelay.appleid.com',
]);

// Internal / host domains that should never surface as "industry orgs"
// (e.g. the PizzaDAO host's own domain). Excluded the same as personal
// providers. pecorino-64118 cleanup.
export const INTERNAL_DOMAINS: Set<string> = new Set([
  'rarepizzas.com',
]);

// Brand stems for major personal email providers. If a domain CONTAINS any
// of these as a substring, treat it as personal — this cleanly catches typos
// (gmail.con, 35gmail.com) and international variants (hotmail.it, yahoo.fr,
// outlook.de) that won't be in the exact set. These brand names don't appear
// in real company domains. pecorino-64118 cleanup.
export const PERSONAL_BRAND_STEMS: string[] = [
  'gmail', 'googlemail', 'hotmail', 'outlook', 'yahoo', 'ymail', 'protonmail',
];

// RFC 2606 / 6761 reserved TLDs + RFC 2606 example second-level domains. These
// are placeholder / test addresses (e.g. example.invalid) that should never be
// counted as a real industry org. pecorino-64118 follow-up.
const RESERVED_TLD_SUFFIXES: string[] = ['.invalid', '.test', '.localhost', '.example'];
const RESERVED_EXAMPLE_DOMAINS: Set<string> = new Set([
  'example.com', 'example.org', 'example.net',
  // pecorino-64118: common placeholder/test domains seen in fake/test RSVPs.
  'test.com', 'test.org', 'test.net',
]);

// Returns the lowercased email domain if it is NOT a personal provider,
// internal/host domain, or personal-brand variant; otherwise null. Also
// returns null for missing / malformed emails.
export function orgDomainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1].trim().toLowerCase();
  if (!domain) return null;
  // Reserved / placeholder domains (RFC 2606/6761): example.invalid, foo.test, etc.
  if (RESERVED_TLD_SUFFIXES.some((suffix) => domain.endsWith(suffix))) return null;
  if (RESERVED_EXAMPLE_DOMAINS.has(domain)) return null;
  if (INTERNAL_DOMAINS.has(domain)) return null;
  if (PERSONAL_EMAIL_PROVIDERS.has(domain)) return null;
  if (PERSONAL_BRAND_STEMS.some((stem) => domain.includes(stem))) return null;
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
