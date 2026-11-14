/**
 * Project link validation (plans/hackathon-platform.md §11). Pure, unit-tested.
 * - https only: a bare host ("github.com/x") or http:// is upgraded to https://; any other
 *   scheme (javascript:, data:, ftp:) is rejected.
 * - <= 500 chars (DB CHECK), no credentials, no IP-literal / localhost / single-label hosts.
 * We never fetch these server-side, so this is about safe rendering, not SSRF.
 */
import { isIP } from 'node:net';
import { AppError } from '../../middleware/error.js';

export const MAX_URL_LENGTH = 500;

const bad = (field: string, why = 'must be a valid https:// link') => new AppError(`${field} ${why}`, 400, 'VALIDATION_ERROR');

export function normalizeProjectUrl(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw bad(field);
  if (v.includes('\u0000')) throw bad(field, 'contains an invalid character');
  let s = v.trim();
  if (!s) return null;
  if (/\s/.test(s)) throw bad(field);
  if (/^http:\/\//i.test(s)) s = 'https://' + s.slice(7);
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  if (!/^https:\/\//i.test(s)) throw bad(field);
  if (s.length > MAX_URL_LENGTH) throw bad(field, `must be at most ${MAX_URL_LENGTH} characters`);

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw bad(field);
  }
  if (u.protocol !== 'https:') throw bad(field);
  if (u.username || u.password) throw bad(field, 'must not contain a username or password');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || isIP(host) || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') || host.endsWith('.')) {
    throw bad(field, 'must point to a public website');
  }
  if (u.port && u.port !== '443') throw bad(field, 'must not use a custom port');
  const out = u.toString();
  if (out.length > MAX_URL_LENGTH) throw bad(field, `must be at most ${MAX_URL_LENGTH} characters`);
  return out;
}
