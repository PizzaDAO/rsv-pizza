/**
 * Strict hostname validation for partner custom domains and sending domains
 * (plans/wl-self-serve-brands.md PR 16, Snax decision 11: subdomains only).
 *
 * `normalizePartnerHost` is the single gate for a host a partner types: it punycode-normalizes,
 * lowercases and rejects schemes, paths, ports, wildcards, IP addresses, apex domains and anything
 * on (or under) a domain we operate. Pure functions; no I/O.
 */
import { domainToASCII } from 'node:url';
import { getDomain, getPublicSuffix } from 'tldts';
import { AppError } from '../middleware/error.js';
import { brand } from '../config/brand.js';
import { hostnameOrNull } from './seriesEmailFields.js';

/** Domains (and everything under them) a partner can never claim: ours, our infrastructure, loopback names. */
const BASE_RESERVED = [
  'rsv.pizza', // brand-check-ignore-line
  'globalpizza.party', // brand-check-ignore-line
  'pizzadao.org', // brand-check-ignore-line
  'vercel.app', 'vercel.com', 'vercel.dev', 'vercel-dns.com',
  'supabase.co', 'supabase.com', 'resend.com', 'resend.dev', 'amazonses.com',
  'localhost', 'local', 'internal', 'invalid',
];

/** Reserved apex names: the deploy brand's own domain, the static list, and `RESERVED_DOMAINS` (comma list). */
export function reservedDomains(): string[] {
  const extra = (process.env.RESERVED_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean);
  return [...new Set([brand.domain.toLowerCase(), ...BASE_RESERVED, ...extra])];
}

/** True when `host` equals or is under a reserved domain. */
export function isReservedHost(host: string): boolean {
  const h = host.toLowerCase();
  return reservedDomains().some((d) => h === d || h.endsWith(`.${d}`));
}

function bad(msg: string): never {
  throw new AppError(msg, 400, 'VALIDATION_ERROR');
}

/**
 * Validate and normalize a hostname a partner submitted (web domain or sending domain).
 * Returns the lowercase ASCII (punycode) host. Throws 400 on anything else.
 */
export function normalizePartnerHost(input: unknown, field = 'domain'): string {
  if (typeof input !== 'string' || !input.trim()) bad(`${field} is required`);
  const raw = (input as string).trim();
  if (raw.length > 253) bad(`${field} is too long`);
  if (/[\s*\/\\@:?#%]/.test(raw)) bad(`${field} must be a bare hostname like events.example.com (no scheme, port, path or wildcard)`);
  const ascii = domainToASCII(raw.toLowerCase().replace(/\.$/, ''));
  if (!ascii) bad(`${field} is not a valid hostname`);
  if (/^[0-9.]+$/.test(ascii) || /^0x[0-9a-f.]+$/i.test(ascii)) bad(`${field} must be a hostname, not an IP address`);
  // hostnameOrNull enforces label rules and the apex (subdomains-only) rule.
  const host = hostnameOrNull(ascii, field, { subdomainOnly: true });
  if (!host) bad(`${field} is required`);
  // Public-suffix list check (tldts): the host must be a real subdomain of a registrable domain,
  // never an apex (`partner.co.uk`) or a public suffix itself (`co.uk`).
  const h = host as string;
  const registrable = getDomain(h);
  if (!registrable || registrable === h || getPublicSuffix(h) === h) bad(`${field} must be a subdomain such as events.example.com, not a bare domain (${h})`);
  if (isReservedHost(host as string)) bad(`${field} can't be on a domain operated by PizzaDAO or its providers`);
  return host as string;
}

/** True when two hosts are the same or one is a subdomain of the other (overlapping DNS zones). */
export function hostsOverlap(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/** The https origin for a validated host. */
export const originOf = (host: string): string => `https://${host}`;

/** Host of an `https://host` origin, or null. */
export function hostOfOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
