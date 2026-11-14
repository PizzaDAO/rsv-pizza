/**
 * Team invite codes and project slugs (plans/hackathon-platform.md §5, §11). Pure, unit-tested.
 */
import crypto from 'node:crypto';

// RFC 4648 base32 without padding; lowercased for links. 10 chars = 50 bits.
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export const INVITE_CODE_LENGTH = 10;
export const INVITE_CODE_RE = /^[a-z2-7]{10}$/;

export function generateInviteCode(): string {
  const bytes = crypto.randomBytes(INVITE_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += B32[bytes[i] & 31];
  return out;
}

/** Trim + lowercase; null when the shape can't be a code (never hits the DB). */
export function normalizeInviteCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.trim().toLowerCase();
  return INVITE_CODE_RE.test(c) ? c : null;
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_BASE_MAX = 60;

/** "My Cool App!" -> "my-cool-app". Always matches SLUG_RE (falls back to "project"). */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/g, '');
  return s || 'project';
}

/** First free slug: base, base-2, base-3, ... (then a random suffix). */
export function pickSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const s = `${base}-${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}
