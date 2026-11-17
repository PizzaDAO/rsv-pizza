/**
 * Validators for the white-label sender / custom-domain fields on `event_series`
 * (plans/wl-custom-domain-email.md §2.6). Pure functions, shared by the admin routes.
 *
 * Every validator throws AppError(400, VALIDATION_ERROR) on bad input and returns the normalized
 * value (or null for "unset"). `email_domain_verified_at` and `resend_domain_id` are server-written
 * only and are intentionally NOT handled here: routes must never copy them from a request body.
 */
import { AppError } from '../middleware/error.js';

function bad(msg: string): never {
  throw new AppError(msg, 400, 'VALIDATION_ERROR');
}

function trimmed(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

const EMAIL_RE = /^[^\s@<>"',;()[\]\\]+@([a-z0-9-]+\.)+[a-z]{2,}$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A plain mailbox (`events@mail.partner.com`), lowercased. No display name, no angle brackets. */
export function emailOrNull(v: unknown, field: string): string | null {
  const s = trimmed(v);
  if (!s) return null;
  const e = s.toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) bad(`${field} must be a plain email address (e.g. events@mail.example.com)`);
  return e;
}

/**
 * Multi-label public suffixes we know about, so `partner.co.uk` counts as an apex. Not the full
 * public-suffix list: a deliberately small, conservative set (anything else is treated as a
 * single-label TLD).
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.kr',
  'co.in', 'co.za', 'com.br', 'com.mx', 'com.ar', 'com.sg', 'com.hk', 'com.tr', 'com.cn', 'com.tw',
]);

/** True when the host is a registrable domain itself (`partner.com`, `partner.co.uk`), not a subdomain of one. */
export function isApexHost(host: string): boolean {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  const suffixLen = MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 2 : 1;
  return labels.length <= suffixLen + 1;
}

/** Decision 11: partner sites and senders use subdomains only (no apex). */
export function assertSubdomainHost(host: string, field: string): void {
  if (isApexHost(host)) bad(`${field} must be a subdomain such as events.example.com, not an apex domain (${host})`);
}

/** A DNS hostname (`mail.partner.com`): lowercase, 2+ labels, no wildcard, no IP, no scheme/path. */
export function hostnameOrNull(v: unknown, field: string, opts: { subdomainOnly?: boolean } = {}): string | null {
  const s = trimmed(v);
  if (!s) return null;
  const h = s.toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(h) || /^\d+(\.\d+){3}$/.test(h)) bad(`${field} must be a hostname like mail.example.com (no scheme, path or wildcard)`);
  if (opts.subdomainOnly) assertSubdomainHost(h, field);
  return h;
}

/**
 * Sender display name. We STRIP, never quote: control chars and every RFC 5322 special
 * (`" < > , ; : @ ( ) [ ] \\`) are removed, so the name can neither break out of the From header nor
 * carry a lookalike address (`support@paypal.com` -> `supportpaypal.com`, `Acme, Inc` -> `Acme Inc`).
 * Max 100 chars. Null when nothing is left. siteBrand.headerName applies the same rule at send time.
 */
export const HEADER_NAME_STRIP = /[\u0000-\u001f\u007f"<>,;:@()[\]\\]/g;
export function senderNameOrNull(v: unknown): string | null {
  const s = trimmed(v);
  if (!s) return null;
  const cleaned = s.replace(HEADER_NAME_STRIP, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length > 100) bad('emailFromName must be at most 100 characters');
  return cleaned;
}

/** True when `address`'s domain equals `domain` or is a subdomain of it. */
export function addressUnderDomain(address: string, domain: string): boolean {
  const at = address.lastIndexOf('@');
  if (at < 0) return false;
  const host = address.slice(at + 1).toLowerCase();
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

/**
 * The from-address must live on the Resend sending domain (equal or a subdomain). Either both are
 * unset (default sender) or `emailDomain` must be set alongside a from-address.
 */
export function assertSenderConsistent(fromAddress: string | null, emailDomain: string | null): void {
  if (!fromAddress) return;
  if (!emailDomain) bad('emailDomain is required when emailFromAddress is set');
  if (!addressUnderDomain(fromAddress, emailDomain)) {
    bad('emailFromAddress must be on the email sending domain (the same domain or a subdomain of it)');
  }
  assertSubdomainHost(fromAddress.slice(fromAddress.lastIndexOf('@') + 1), 'emailFromAddress domain');
}

/** Max aliases per series (CORS / siteForOrigin entries). */
export const MAX_SITE_ALIASES = 10;

/**
 * Extra origins for a series (the old brand-subdomain host after a cutover, or a staged new domain). Each must
 * be an https origin with no path: pass the same validator the route uses for `siteUrl`.
 * Duplicates are dropped; the canonical `siteUrl` is not allowed as its own alias.
 */
export function siteAliasesOrNull(
  v: unknown,
  parseOrigin: (x: unknown) => string | null,
  canonicalSiteUrl: string | null,
): string[] {
  if (v === null) return [];
  if (!Array.isArray(v)) bad('siteAliases must be an array of https origins');
  const out: string[] = [];
  for (const raw of v) {
    const o = parseOrigin(raw);
    if (!o) continue;
    const n = o.toLowerCase();
    if (canonicalSiteUrl && n === canonicalSiteUrl.toLowerCase()) bad('siteAliases must not repeat the site URL');
    if (!out.includes(n)) out.push(n);
  }
  if (out.length > MAX_SITE_ALIASES) bad(`siteAliases allows at most ${MAX_SITE_ALIASES} origins`);
  return out;
}
