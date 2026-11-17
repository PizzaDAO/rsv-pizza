/**
 * "Link your rsv.pizza account" for pizzadao.org.
 *
 * A pizzadao.org member lands on /link/pizzadao on rsv.pizza, signs in with the normal
 * email login, confirms, and is sent back to an allowlisted return URL carrying a
 * short-lived ES256 token. The token proves "this browser controls the rsv.pizza account
 * whose email hashes to X" without ever carrying the address.
 *
 * Token (compact JWS, signed with the same key as /.well-known/jwks.json, so pizzadao.org
 * verifies it offline against the published JWKS: no shared secret, no callback):
 *   header {"alg":"ES256","kid":<kid>,"typ":"pizzadao-link+jwt"}
 *   claims {iss, aud, iat, exp = iat + 300, jti, use:"pizzadao_link", v:1,
 *           email_sha256: sha256 hex of lower(trim(email)), state}
 *   NO sub, email, scope or azp.
 * Returned to the app as `<returnUrl>?rsv_link=<token>&state=<state>`.
 */
import crypto from 'node:crypto';
import { pizzaMcpIssuer, signEs256 } from './pizzaMcpToken.js';

export const PIZZADAO_LINK_TYP = 'pizzadao-link+jwt';
export const PIZZADAO_LINK_USE = 'pizzadao_link';
export const PIZZADAO_LINK_TTL_S = 300;
export const DEFAULT_RETURN_ORIGINS = ['https://pizzadao.org', 'https://www.pizzadao.org'];
const STATE_RE = /^[A-Za-z0-9._~-]{16,128}$/;

export class LinkInputError extends Error {}

export function linkAudience(): string {
  return (process.env.PIZZADAO_LINK_AUDIENCE || 'pizzadao.org').trim();
}

export function emailSha256(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** Allowed return origins from PIZZADAO_LINK_RETURN_ORIGINS (comma separated), else the defaults. */
export function returnOriginPatterns(): string[] {
  const raw = (process.env.PIZZADAO_LINK_RETURN_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean);
  return raw.length ? raw : DEFAULT_RETURN_ORIGINS;
}

/**
 * Entries are exact origins ("https://pizzadao.org"); a `*` inside the host stands for one or
 * more [a-z0-9-] characters within a single label ("https://pizzadao-*.vercel.app").
 */
function originMatches(origin: string, pattern: string): boolean {
  if (!pattern.includes('*')) return origin === pattern;
  const re = new RegExp(
    '^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+') + '$',
  );
  return re.test(origin);
}

/** Validate the return URL against the allowlist. Returns the parsed URL or throws. */
export function parseReturnUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) throw new LinkInputError('Invalid returnUrl');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new LinkInputError('Invalid returnUrl');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.username || u.password || u.hash || (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))) {
    throw new LinkInputError('Invalid returnUrl');
  }
  const origin = u.origin.toLowerCase();
  if (!returnOriginPatterns().some((p) => originMatches(origin, p))) throw new LinkInputError('returnUrl not allowed');
  return u;
}

export function parseState(raw: unknown): string {
  if (typeof raw !== 'string' || !STATE_RE.test(raw)) throw new LinkInputError('Invalid state');
  return raw;
}

/** Build the redirect URL for `email`. Throws LinkInputError on bad input, Error if no signing key. */
export function buildLinkRedirect(input: { email: string; returnUrl: unknown; state: unknown; nowS?: number }): string {
  const target = parseReturnUrl(input.returnUrl);
  const state = parseState(input.state);
  const iat = input.nowS ?? Math.floor(Date.now() / 1000);
  const token = signEs256(
    {
      iss: pizzaMcpIssuer(),
      aud: linkAudience(),
      iat,
      exp: iat + PIZZADAO_LINK_TTL_S,
      jti: crypto.randomUUID(),
      use: PIZZADAO_LINK_USE,
      v: 1,
      email_sha256: emailSha256(input.email),
      state,
    },
    PIZZADAO_LINK_TYP,
  );
  target.searchParams.set('rsv_link', token);
  target.searchParams.set('state', state);
  return target.toString();
}
