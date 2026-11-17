// Pure form logic for the brand settings page (PR 14): field validation that mirrors the backend
// allowlist validators (lib/seriesBrandSettings.ts; the server stays the authority), diffing a
// draft against saved settings into a PATCH body, and the theme editor's draft / contrast helpers.
import {
  FONT_KEYS,
  checkThemeContrast,
  parseThemeTokens,
  type ContrastFailure,
  type FontKey,
  type ThemeMode,
  type ThemeRadius,
  type ThemeTokens,
} from '../config/themeTokens';
import type { BrandSettings } from './brandAdminApi';

// ---------------------------------------------------------------- text fields

export interface IdentityDraft {
  brandName: string;
  displayName: string;
  tagline: string;
  metaDescription: string;
  supportEmail: string;
  description: string;
  nameTemplate: string;
  emailFromName: string;
  emailReplyTo: string;
  hideGuests: boolean;
  photosEnabled: boolean;
  photosPublic: boolean;
  eventDate: string;
  eventStartTime: string;
  eventEndTime: string;
}

export const TEXT_LIMITS = {
  brandName: 40,
  displayName: 40,
  tagline: 80,
  metaDescription: 200,
  description: 2000,
  nameTemplate: 120,
  emailFromName: 100,
} as const;

const NAME_RE = /^[\p{L}\p{N} .&'!-]+$/u;
const EMAIL_RE = /^[^\s@<>"',;()[\]\\]+@([a-z0-9-]+\.)+[a-z]{2,}$/;
const RESERVED = ['pizzadao', 'rsvpizza'];
const SENDER_STRIP = /[\u0000-\u001f\u007f"<>,;:@()[\]\\]/g;

export function draftFromSettings(s: BrandSettings): IdentityDraft {
  return {
    brandName: s.brandName ?? '',
    displayName: s.displayName ?? '',
    tagline: s.tagline ?? '',
    metaDescription: s.metaDescription ?? '',
    supportEmail: s.supportEmail ?? '',
    description: s.description ?? '',
    nameTemplate: s.nameTemplate ?? '',
    emailFromName: s.emailFromName ?? '',
    emailReplyTo: s.emailReplyTo ?? '',
    hideGuests: !!s.hideGuests,
    photosEnabled: !!s.photosEnabled,
    photosPublic: !!s.photosPublic,
    eventDate: s.eventDate ? String(s.eventDate).slice(0, 10) : '',
    eventStartTime: s.eventStartTime ?? '',
    eventEndTime: s.eventEndTime ?? '',
  };
}

function reserved(v: string): boolean {
  const flat = v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return RESERVED.some((r) => flat.includes(r));
}

function plainText(v: string, label: string, max: number, multiline = false): string | null {
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) return `${label} must be at most ${max} characters`;
  if (/[<>]/.test(s)) return `${label} can't contain < or >`;
  const ctl = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/ : /[\u0000-\u001f\u007f\u2028\u2029]/;
  if (ctl.test(s)) return `${label} contains invalid characters`;
  return null;
}

function nameField(v: string, label: string): string | null {
  const e = plainText(v, label, TEXT_LIMITS.brandName);
  if (e) return e;
  const s = v.trim();
  if (!s) return null;
  if (!NAME_RE.test(s)) return `${label} can only use letters, digits, spaces and . & ' ! -`;
  if (reserved(s)) return `${label} can't use a reserved name`;
  return null;
}

function emailField(v: string, label: string): string | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (s.length > 254 || !EMAIL_RE.test(s)) return `${label} must be a plain email address (e.g. help@example.org)`;
  return null;
}

export type IdentityErrors = Partial<Record<keyof IdentityDraft, string>>;

export function validateIdentity(d: IdentityDraft): IdentityErrors {
  const e: IdentityErrors = {};
  const put = (k: keyof IdentityDraft, msg: string | null) => { if (msg) e[k] = msg; };
  put('brandName', nameField(d.brandName, 'Brand name'));
  if (!d.displayName.trim()) e.displayName = "Display name can't be empty";
  else put('displayName', nameField(d.displayName, 'Display name'));
  put('tagline', plainText(d.tagline, 'Tagline', TEXT_LIMITS.tagline));
  put('metaDescription', plainText(d.metaDescription, 'Meta description', TEXT_LIMITS.metaDescription));
  put('description', plainText(d.description, 'Description', TEXT_LIMITS.description, true));
  put('nameTemplate', plainText(d.nameTemplate, 'Event name template', TEXT_LIMITS.nameTemplate));
  put('supportEmail', emailField(d.supportEmail, 'Support email'));
  put('emailReplyTo', emailField(d.emailReplyTo, 'Reply-to'));
  const sender = d.emailFromName.trim().replace(SENDER_STRIP, '').replace(/\s+/g, ' ').trim();
  if (sender.length > TEXT_LIMITS.emailFromName) e.emailFromName = `Sender name must be at most ${TEXT_LIMITS.emailFromName} characters`;
  else if (sender && reserved(sender)) e.emailFromName = "Sender name can't use a reserved name";
  if (d.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.eventDate)) e.eventDate = 'Use a valid date';
  for (const k of ['eventStartTime', 'eventEndTime'] as const) {
    if (d[k] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d[k])) e[k] = 'Use HH:MM (24-hour)';
  }
  return e;
}

/** Only the fields that differ from the saved settings, trimmed, with empty text sent as null. */
export function identityPatch(d: IdentityDraft, saved: BrandSettings): Record<string, unknown> {
  const base = draftFromSettings(saved);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(d) as Array<keyof IdentityDraft>) {
    const a = d[k];
    if (a === base[k]) continue;
    if (typeof a === 'boolean') out[k] = a;
    else {
      const t = a.trim();
      if (t === (base[k] as string).trim()) continue;
      out[k] = t === '' ? null : t;
    }
  }
  return out;
}

// ---------------------------------------------------------------- theme

export type ThemeDraft = Omit<ThemeTokens, 'overrides'>;

export const COLOR_FIELDS: Array<{ key: 'bg' | 'surface' | 'text' | 'textMuted' | 'accent' | 'onAccent' | 'border'; label: string }> = [
  { key: 'bg', label: 'Page background' },
  { key: 'surface', label: 'Cards and header' },
  { key: 'text', label: 'Main text' },
  { key: 'textMuted', label: 'Muted text' },
  { key: 'accent', label: 'Accent (buttons)' },
  { key: 'onAccent', label: 'Text on accent' },
  { key: 'border', label: 'Borders' },
];

export const RADIUS_OPTIONS: Array<{ value: ThemeRadius; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'soft', label: 'Soft' },
  { value: 'round', label: 'Round' },
  { value: 'pill', label: 'Pill' },
];

export const FONT_LABELS: Record<FontKey, string> = {
  system: 'System default',
  inter: 'Inter',
  nunito: 'Nunito',
  kanit: 'Kanit',
  satoshi: 'Satoshi',
  rubik: 'Rubik',
  'space-grotesk': 'Space Grotesk',
  'dm-sans': 'DM Sans',
  poppins: 'Poppins',
  montserrat: 'Montserrat',
  outfit: 'Outfit',
  'work-sans': 'Work Sans',
  'playfair-display': 'Playfair Display',
  lora: 'Lora',
  'jetbrains-mono': 'JetBrains Mono',
};
export const FONT_OPTIONS: Array<{ value: FontKey; label: string }> = FONT_KEYS.map((k) => ({ value: k, label: FONT_LABELS[k] ?? k }));

/** Starting point when a brand has no tokens yet (passes the AA checks). */
export const DEFAULT_THEME_DRAFT: ThemeDraft = {
  mode: 'dark',
  bg: '#0f0f10',
  surface: '#1c1c1e',
  text: '#ffffff',
  textMuted: '#a1a1aa',
  accent: '#e6212f',
  onAccent: '#ffffff',
  border: '#3f3f46',
  radius: 'soft',
  fontHeading: 'system',
  fontBody: 'system',
};

export function draftFromTokens(t: BrandSettings['themeTokens']): ThemeDraft {
  if (!t) return { ...DEFAULT_THEME_DRAFT };
  const { overrides: _o, ...rest } = t;
  return { ...DEFAULT_THEME_DRAFT, ...rest };
}

export const themeOverrides = (t: BrandSettings['themeTokens']): Record<string, string> | undefined =>
  t && t.overrides && Object.keys(t.overrides).length ? t.overrides : undefined;

export interface ThemeEvaluation {
  /** Block Save. */
  errors: string[];
  /** Allowed but worth a look (accent against the page). */
  warnings: string[];
  failures: ContrastFailure[];
  /** Normalised tokens when the shape is valid (drives the live preview), else null. */
  tokens: ThemeTokens | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function evaluateTheme(draft: ThemeDraft, overrides?: Record<string, string>): ThemeEvaluation {
  const shape = parseThemeTokens(draft, { allowOverrides: false });
  const colorsOk = (['bg', 'surface', 'text', 'textMuted', 'accent', 'onAccent', 'border'] as const).every((k) => HEX.test(draft[k]));
  const failures = colorsOk ? checkThemeContrast(draft) : [];
  const msg = (f: ContrastFailure) => `${f.pair}: ${f.ratio}:1 (needs ${f.min}:1)`;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!shape.ok) errors.push(...shape.errors.map((x) => x.replace(/^contrast too low: /, 'Contrast too low: ')));
  else warnings.push(...failures.filter((f) => !f.blocking).map((f) => `Low contrast, ${msg(f)}`));
  // Preview tokens: shape-valid with colours normalised, even when contrast fails.
  const loose = parseThemeTokens(draft, { allowOverrides: false, contrast: false });
  let tokens: ThemeTokens | null = null;
  if (loose.ok) tokens = overrides ? { ...loose.tokens, overrides } : loose.tokens;
  return { errors, warnings, failures, tokens };
}

/** Body for PATCH themeTokens: never carries `overrides` (the server keeps the super-admin ones). */
export function tokensPayload(draft: ThemeDraft, savedTokens: BrandSettings['themeTokens']): ThemeDraft {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (k === 'hideHeaderName' || k === 'hideHeroLogo') {
      if (v === true || (savedTokens && typeof (savedTokens as unknown as Record<string, unknown>)[k] === 'boolean')) out[k] = !!v;
      continue;
    }
    out[k] = typeof v === 'string' && v.startsWith('#') ? v.toLowerCase() : v;
  }
  return out as unknown as ThemeDraft;
}

export const sameTheme = (a: ThemeDraft, b: ThemeDraft): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(o: object): object {
  return Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== false)
      .map(([k, v]) => [k, typeof v === 'string' ? v.toLowerCase() : v] as [string, unknown])
      .sort(([x], [y]) => x.localeCompare(y)),
  );
}

export type { ThemeMode };
