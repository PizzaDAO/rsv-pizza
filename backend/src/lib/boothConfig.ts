/**
 * Server-side sanitizer for the photo booth config a host saves (plans/photo-booth.md section 3).
 *
 * Defence in depth only: the booth re-normalizes every config in the browser. The booth package
 * does not export its normalizer for Node, so this is our own light validation:
 *  - plain object, <= 1.8 MB serialized (413 otherwise)
 *  - allowlisted top-level keys only; `version` forced to 1 and `credit` forced to true
 *  - brand.logo: "", a raster data URL whose bytes match its declared type, or an https URL (SVG -> "")
 *  - share.link / brand.website: https only, else ""
 *  - colours must be #RRGGBB, else dropped
 *  - strings lose C0 control characters and bidi overrides
 *  - person.names capped at 5000 entries
 */

export const BOOTH_CONFIG_MAX_BYTES = 1.8 * 1024 * 1024;
export const BOOTH_NAMES_MAX = 5000;

const ALLOWED_KEYS = [
  'version', 'title', 'place', 'dates', 'brand', 'showBrand', 'credit', 'frames', 'packs',
  'person', 'words', 'video', 'share', 'camera', 'maxPhotos',
] as const;

const MAX_DEPTH = 8;
const MAX_STRING = 5000;
const MAX_ARRAY = 5000;
const MAX_KEYS = 500;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// C0 controls (except none: tab/newline are not useful in booth text either) and bidi overrides/isolates.
// eslint-disable-next-line no-control-regex
const CONTROL_AND_BIDI = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

export type SanitizeResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; status: 400 | 413; message: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function cleanString(s: string, max = MAX_STRING): string {
  return s.replace(CONTROL_AND_BIDI, '').slice(0, max);
}

/** Magic-byte check that decoded bytes really are the declared raster type. */
function bytesMatch(type: string, b: Buffer): boolean {
  switch (type) {
    case 'png': return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'jpeg': return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'gif': return b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'webp': return b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
    default: return false;
  }
}

export function sanitizeLogo(v: unknown): string {
  if (typeof v !== 'string' || v === '') return '';
  if (v.startsWith('data:')) {
    const m = DATA_IMAGE.exec(v);
    if (!m) return '';
    let head: Buffer;
    try {
      head = Buffer.from(m[2].slice(0, 64), 'base64');
    } catch {
      return '';
    }
    return bytesMatch(m[1], head) ? v : '';
  }
  return sanitizeHttpsUrl(v);
}

export function sanitizeHttpsUrl(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = cleanString(v.trim(), 2000);
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? s : '';
  } catch {
    return '';
  }
}

/** Generic deep clean: strings cleaned, arrays/objects capped, prototype keys dropped. */
function deepClean(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return cleanString(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean' || v === null) return v;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(v)) {
    return v.slice(0, MAX_ARRAY).map((x) => deepClean(x, depth + 1)).filter((x) => x !== undefined);
  }
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).slice(0, MAX_KEYS)) {
      if (BAD_KEYS.has(k)) continue;
      const c = deepClean(v[k], depth + 1);
      if (c !== undefined) out[cleanString(k, 100)] = c;
    }
    return out;
  }
  return undefined;
}

function cleanColors(v: unknown): Record<string, string> | undefined {
  if (!isPlainObject(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, c] of Object.entries(v)) {
    if (BAD_KEYS.has(k)) continue;
    if (typeof c === 'string' && HEX_COLOR.test(c)) out[cleanString(k, 40)] = c;
  }
  return out;
}

export function sanitizeBoothConfig(input: unknown): SanitizeResult {
  if (!isPlainObject(input)) return { ok: false, status: 400, message: 'config must be an object' };
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(input));
  } catch {
    return { ok: false, status: 400, message: 'config is not valid JSON' };
  }
  if (size > BOOTH_CONFIG_MAX_BYTES) return { ok: false, status: 413, message: 'config is too large' };

  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (!(key in input)) continue;
    // brand.logo is a long data URL: clean it separately, not with the generic 5000-char string cap.
    if (key === 'brand' && isPlainObject(input.brand)) {
      const { logo, colors, website, ...rest } = input.brand;
      const brand = (deepClean(rest, 1) ?? {}) as Record<string, unknown>;
      brand.logo = sanitizeLogo(logo);
      if (website !== undefined) brand.website = sanitizeHttpsUrl(website);
      const cleanedColors = cleanColors(colors);
      if (cleanedColors) brand.colors = cleanedColors;
      out.brand = brand;
      continue;
    }
    const cleaned = deepClean(input[key], 1);
    if (cleaned !== undefined) out[key] = cleaned;
  }

  if (isPlainObject(out.share)) out.share.link = sanitizeHttpsUrl((input.share as Record<string, unknown> | undefined)?.link);
  if (isPlainObject(out.person) && Array.isArray(out.person.names)) {
    out.person.names = out.person.names.slice(0, BOOTH_NAMES_MAX);
  }

  out.version = 1;
  out.credit = true;
  return { ok: true, config: out };
}
