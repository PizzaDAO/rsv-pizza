const EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'mail.com', 'email.com',
  'protonmail.com', 'proton.me', 'zoho.com', 'yandex.com', 'yandex.ru',
  'gmx.com', 'gmx.net', 'fastmail.com', 'tutanota.com', 'tuta.com',
  'hey.com', 'pm.me', 'inbox.com', 'mail.ru', 'qq.com', '163.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
  'charter.net', 'earthlink.net', 'optonline.net', 'frontier.com',
]);

export function isEmailProvider(domain: string): boolean {
  return EMAIL_PROVIDERS.has(domain.toLowerCase());
}

export function extractEmailDomain(email: string, hideProviders = false): string | null {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase();
  if (hideProviders && isEmailProvider(domain)) return null;
  return domain;
}

export function getDomainFaviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

export function extractEmailLocalPart(email: string): string {
  if (!email) return '';
  const parts = email.split('@');
  return parts[0] || email;
}
