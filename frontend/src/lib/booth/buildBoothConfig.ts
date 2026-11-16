import pizzadaoPreset from './pizzadaoPreset.json';

export type BoothConfig = Record<string, any>;

/** The party fields the booth uses. Both PublicEvent and the host Party satisfy this. */
export interface BoothEventInfo {
  name: string;
  city?: string | null;
  address?: string | null;
  date?: string | null;
  timezone?: string | null;
  customUrl?: string | null;
  inviteCode: string;
}

/** Set for white-label builds (BRAND is not the PizzaDAO default). */
export interface BoothWhiteLabel {
  name: string;
  /** Absolute or root-relative PNG/JPEG logo URL. SVG is not accepted by the booth. */
  logo: string;
}

export interface BuildBoothConfigInput {
  /** The host's saved config (already sanitized server-side), or null for the PizzaDAO default. */
  hostConfig?: BoothConfig | null;
  event: BoothEventInfo;
  /** e.g. https://rsv.pizza (no trailing slash). */
  origin: string;
  whiteLabel?: BoothWhiteLabel | null;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Cut to a max number of characters (code points), no ellipsis. */
export function cut(s: string, max: number): string {
  const chars = Array.from(s.trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('').trimEnd();
}

/**
 * Deep merge: objects merge, arrays and scalars replace. With `skipEmpty`, empty strings, null and
 * undefined in `over` never replace a value, so a blank host field lets the party's detail show through.
 */
function merge(base: BoothConfig, over: BoothConfig | null | undefined, skipEmpty: boolean): BoothConfig {
  const out: BoothConfig = { ...base };
  if (!over) return out;
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === undefined) continue;
    if (skipEmpty && (v === null || v === '')) continue;
    if (isObj(v) && isObj(out[k])) out[k] = merge(out[k], v, skipEmpty);
    else if (isObj(v)) out[k] = merge({}, v, skipEmpty);
    else out[k] = v;
  }
  return out;
}

/**
 * What the host actually changed: `edited` minus everything equal to `defaults` (the effective config
 * with no host overrides). Saving only this keeps the party's name, date and link live (a later rename
 * still shows in the booth) instead of freezing today's values into the saved config.
 */
export function diffFromDefault(edited: BoothConfig, defaults: BoothConfig): BoothConfig {
  const out: BoothConfig = {};
  for (const [k, v] of Object.entries(edited)) {
    const d = defaults[k];
    if (isObj(v) && isObj(d)) {
      const sub = diffFromDefault(v, d);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (JSON.stringify(v) !== JSON.stringify(d)) {
      out[k] = v;
    }
  }
  return out;
}

/** "Sat 22 May 2027" in the party's timezone. Empty when there is no valid date. */
export function formatBoothDate(iso: string | null | undefined, timezone: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const fmt = (timeZone?: string) =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone }).formatToParts(d);
  let parts;
  try {
    parts = fmt(timezone || undefined);
  } catch {
    parts = fmt(undefined);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return cut([get('weekday'), get('day'), get('month'), get('year')].filter(Boolean).join(' '), 40);
}

function placeOf(event: BoothEventInfo): string {
  const city = (event.city ?? '').trim();
  if (city) return cut(city, 30);
  const first = (event.address ?? '').split(',')[0]?.trim() ?? '';
  return cut(first, 30);
}

function absoluteUrl(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

/**
 * Pure. Merge order: the PizzaDAO preset (or the white-label brand), then the party's details,
 * then the host's saved values (non-empty host values win; a blank host field keeps the party detail).
 */
export function buildBoothConfig({ hostConfig, event, origin, whiteLabel }: BuildBoothConfigInput): BoothConfig {
  const base: BoothConfig = JSON.parse(JSON.stringify(pizzadaoPreset));
  if (whiteLabel) {
    // No "Pizza the Planet" copy or PizzaDAO links; keep the preset colours and frames.
    delete base.words;
    delete base.person?.suggest;
    delete base.brand.website;
    base.brand.name = whiteLabel.name;
  }

  const link = origin.startsWith('https://') ? `${origin}/${event.customUrl || event.inviteCode}` : '';
  const name = cut(event.name, 40);
  const shareText = whiteLabel
    ? `${event.name}${link ? ' {link}' : ''}`
    : `Pizza the Planet at ${event.name}${link ? ' {link}' : ''}`;
  const logo = whiteLabel
    ? (/\.svg(\?|#|$)/i.test(whiteLabel.logo) ? '' : absoluteUrl(origin, whiteLabel.logo))
    : `${origin}/logo.png`;

  const party: BoothConfig = {
    title: name,
    place: placeOf(event),
    dates: formatBoothDate(event.date, event.timezone),
    brand: { logo },
    share: { link, text: shareText },
  };

  const merged = merge(merge(base, party, false), hostConfig, true);
  // Not up to the host or the preset.
  merged.version = 1;
  merged.credit = true;
  merged.packs = ['pizza'];
  // https only, even if a stored value says otherwise.
  if (isObj(merged.share) && typeof merged.share.link === 'string' && !merged.share.link.startsWith('https://')) {
    merged.share.link = '';
  }
  return merged;
}
