/** Shape + size guard for `event_series.flyer_art` (pure; shared by uploads and /api/brand-config). */
const BESPOKE_RE = /^[a-z][a-z0-9-]{0,39}$/;
const FLYER_ART_MAX_BYTES = 2048;
const SAFE_ART_URL = /^(\/(?!\/)[A-Za-z0-9._~/%-]{1,260}|https:\/\/[^\s"'<>\\]{1,260})$/;

/**
 * `{ poster?: url, rollup?: url, bespokeKey?: string }`
 * and nothing else (unknown keys and bad values are dropped; an oversized value becomes null).
 * Applied to what we store AND to what /api/brand-config serves.
 */
export function sanitizeFlyerArt(v: unknown): { poster?: string; rollup?: string; bespokeKey?: string } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: { poster?: string; rollup?: string; bespokeKey?: string } = {};
  for (const k of ['poster', 'rollup'] as const) {
    const u = o[k];
    if (typeof u === 'string' && SAFE_ART_URL.test(u) && !u.includes('..')) out[k] = u;
  }
  if (typeof o.bespokeKey === 'string' && BESPOKE_RE.test(o.bespokeKey)) out.bespokeKey = o.bespokeKey;
  if (JSON.stringify(out).length > FLYER_ART_MAX_BYTES) return null;
  return Object.keys(out).length ? out : null;
}
