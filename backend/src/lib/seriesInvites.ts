/**
 * Brand-admin invite tokens (plans/wl-self-serve-brands.md §2.1). The raw token is emailed once and
 * never stored: only its SHA-256 lands in `series_admins.invite_token_hash`. Tokens are 32 random
 * bytes (base64url), expire after 7 days and are consumed atomically on accept.
 */
import { createHash, randomBytes } from 'crypto';
import { escapeHtml } from './escapeHtml.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newInviteToken(now: number = Date.now()): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token), expiresAt: new Date(now + INVITE_TTL_MS) };
}

/** Tokens we mint are 43 base64url chars; reject anything else before touching the DB. */
export function isWellFormedInviteToken(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
}

/** Subject lines can't carry CR/LF; brand names are validated server-side but strip defensively. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function buildInviteEmail(opts: { brandName: string; acceptUrl: string }): { subject: string; html: string } {
  const name = escapeHtml(opts.brandName);
  const url = escapeHtml(opts.acceptUrl);
  return {
    subject: `You're invited to manage ${oneLine(opts.brandName)}`,
    html: `<p>You've been invited to manage the <b>${name}</b> site: its look, host checklist and event approvals.</p>
<p><a href="${url}">Accept the invite</a></p>
<p>Sign in with this email address to accept. The link works once and expires in 7 days.</p>`,
  };
}
