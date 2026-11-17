/**
 * Theme tokens (plans/wl-self-serve-brands.md §2.3, PR 8).
 *
 * THIS FILE EXISTS TWICE, BYTE FOR BYTE: backend/src/lib/themeTokens.ts and
 * frontend/src/config/themeTokens.ts (frontend/src/config/themeTokens.test.ts fails if they drift,
 * and both test files run the shared fixture themeTokens.fixture.json). It has no imports on purpose.
 *
 * A token set is a tiny, closed vocabulary: hex colours, a font KEY from a fixed list, a radius KEY
 * and light/dark. Nothing a partner supplies is ever pasted into CSS text:
 *   - colours must match ^#[0-9a-f]{6}$ (normalised to lowercase),
 *   - fonts are keys into FONTS (family + stylesheet URL live in code),
 *   - radius is an enum mapped to fixed lengths,
 *   - `overrides` (super-admin only) take an allowlisted variable name and a strict hex/rgb(a) value.
 * Derived variables are applied with CSSStyleDeclaration.setProperty, never concatenated into a
 * stylesheet.
 */

export const THEME_MODES = ['dark', 'light'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_RADII = ['square', 'soft', 'round', 'pill'] as const;
export type ThemeRadius = (typeof THEME_RADII)[number];

export interface FontDef {
  /** Full CSS font-family value (family + generic fallbacks). Code-side constant. */
  family: string;
  /** Stylesheet to load, or null for fonts that need no download (system). */
  href: string | null;
}

const SANS = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const SERIF = 'ui-serif, Georgia, Cambria, "Times New Roman", serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const google = (family: string, axis = 'wght@400;500;600;700') =>
  `https://fonts.googleapis.com/css2?family=${family}:${axis}&display=swap`;

/**
 * The only fonts a brand can pick. Free Google Fonts, plus Satoshi from Fontshare (what Stand With
 * Crypto uses today). Nothing outside this map is ever fetched.
 */
export const FONTS = {
  system: { family: SANS, href: null },
  inter: { family: `'Inter', ${SANS}`, href: google('Inter', 'wght@400;500;600;700') },
  nunito: { family: `'Nunito', ${SANS}`, href: google('Nunito', 'wght@400;600;700;800;900') },
  kanit: { family: `'Kanit', ${SANS}`, href: google('Kanit', 'wght@400;500;600;700') },
  satoshi: { family: `'Satoshi', ${SANS}`, href: 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap' },
  rubik: { family: `'Rubik', ${SANS}`, href: google('Rubik') },
  'space-grotesk': { family: `'Space Grotesk', ${SANS}`, href: google('Space+Grotesk') },
  'dm-sans': { family: `'DM Sans', ${SANS}`, href: google('DM+Sans') },
  poppins: { family: `'Poppins', ${SANS}`, href: google('Poppins') },
  montserrat: { family: `'Montserrat', ${SANS}`, href: google('Montserrat') },
  outfit: { family: `'Outfit', ${SANS}`, href: google('Outfit') },
  'work-sans': { family: `'Work Sans', ${SANS}`, href: google('Work+Sans') },
  'playfair-display': { family: `'Playfair Display', ${SERIF}`, href: google('Playfair+Display') },
  lora: { family: `'Lora', ${SERIF}`, href: google('Lora') },
  'jetbrains-mono': { family: `'JetBrains Mono', ${MONO}`, href: google('JetBrains+Mono') },
} as const satisfies Record<string, FontDef>;
export type FontKey = keyof typeof FONTS;
export const FONT_KEYS = Object.keys(FONTS) as FontKey[];

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ['bg', 'surface', 'text', 'textMuted', 'accent', 'onAccent', 'border'] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

/** CSS variables a super-admin may pin with `overrides` (brand admins cannot send `overrides`). */
export const OVERRIDE_VARS = [
  '--bg-main', '--bg-card', '--bg-card-hover', '--bg-surface', '--bg-surface-hover',
  '--bg-input', '--bg-input-focus', '--bg-header', '--bg-overlay',
  '--text-primary', '--text-secondary', '--text-muted', '--text-faint', '--text-inverted',
  '--stroke', '--stroke-hover', '--stroke-strong',
  '--accent', '--accent-hover', '--accent-contrast', '--success', '--warning', '--error',
] as const;
const OVERRIDE_SET: ReadonlySet<string> = new Set(OVERRIDE_VARS);
const MAX_OVERRIDES = 24;
const MAX_JSON_BYTES = 4096;

export interface ThemeTokens {
  mode: ThemeMode;
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  border: string;
  radius: ThemeRadius;
  fontHeading: FontKey;
  fontBody: FontKey;
  overrides?: Record<string, string>;
}

const TOKEN_KEYS: readonly string[] = [
  'mode', ...COLOR_KEYS, 'radius', 'fontHeading', 'fontBody', 'overrides',
];

// ---- colour maths -------------------------------------------------------------------------

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function rgbToHex([r, g, b]: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
/** Mix `a` toward `b` by `t` (0 = a, 1 = b). */
function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function luminance(hex: string): number {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG 2.x contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastFailure {
  pair: string;
  ratio: number;
  min: number;
  /** Text pairs block a save; the accent-vs-page UI check only warns (plan 2.3). */
  blocking: boolean;
}

/** The derived secondary text colour (also what deriveThemeVars emits). */
export function secondaryText(t: Pick<ThemeTokens, 'text' | 'textMuted'>): string {
  return mix(t.text, t.textMuted, 0.5);
}

/** Relative luminance of a #rrggbb colour (0 to 1). */
export function colorLuminance(hex: string): number {
  return luminance(hex);
}

/** `mode` must agree with the page colour: dark needs a dark bg, light a light one. */
export const MODE_LUMINANCE_THRESHOLD = 0.18;

/**
 * WCAG AA checks for a (valid) token set. Text pairs (text, textMuted, the derived secondary text,
 * onAccent) need 4.5:1 and block. The accent as a UI colour against the page needs 3:1 (WCAG
 * 1.4.11) and only warns. Ratios are rounded down to 2 decimals so a borderline 4.497 never reads
 * as 4.5.
 */
export function checkThemeContrast(t: Pick<ThemeTokens, ColorKey>): ContrastFailure[] {
  const second = secondaryText(t);
  const checks: Array<[string, string, string, number, boolean]> = [
    ['text on bg', t.text, t.bg, 4.5, true],
    ['text on surface', t.text, t.surface, 4.5, true],
    ['textMuted on bg', t.textMuted, t.bg, 4.5, true],
    ['textMuted on surface', t.textMuted, t.surface, 4.5, true],
    ['secondary text (derived) on bg', second, t.bg, 4.5, true],
    ['secondary text (derived) on surface', second, t.surface, 4.5, true],
    ['onAccent on accent', t.onAccent, t.accent, 4.5, true],
    ['accent on bg', t.accent, t.bg, 3, false],
  ];
  const out: ContrastFailure[] = [];
  for (const [pair, fg, bgc, min, blocking] of checks) {
    const ratio = Math.floor(contrastRatio(fg, bgc) * 100) / 100;
    if (ratio < min) out.push({ pair, ratio, min, blocking });
  }
  return out;
}

// ---- validation ---------------------------------------------------------------------------

const OVERRIDE_VALUE =
  /^(?:#[0-9a-fA-F]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\))$/;

function overrideValueOk(v: string): boolean {
  if (!OVERRIDE_VALUE.test(v)) return false;
  if (v.startsWith('#')) return true;
  const channels = v.replace(/^rgba?\(/, '').replace(/\)$/, '').split(',').slice(0, 3).map(Number);
  return channels.every((c) => Number.isInteger(c) && c >= 0 && c <= 255);
}

export type ThemeTokensResult =
  | { ok: true; tokens: ThemeTokens; warnings: string[] }
  | { ok: false; errors: string[] };

export interface ParseOptions {
  /** Accept the super-admin-only `overrides` key (brand-admin writes pass false). */
  allowOverrides?: boolean;
  /** Enforce WCAG AA (writes do; serving an already-stored set does not). Default true. */
  contrast?: boolean;
}

/**
 * Validate and normalise a token set. Strict: unknown keys, wrong types, non-hex colours, unknown
 * fonts/radius/mode, oversize input and (by default) failing contrast are all rejected. Defaults:
 * radius `soft`, fonts `system`. Colours are lowercased.
 */
export function parseThemeTokens(input: unknown, opts: ParseOptions = {}): ThemeTokensResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['themeTokens must be an object'] };
  }
  let size = 0;
  try {
    size = JSON.stringify(input).length;
  } catch {
    return { ok: false, errors: ['themeTokens must be plain JSON'] };
  }
  if (size > MAX_JSON_BYTES) return { ok: false, errors: [`themeTokens is too large (max ${MAX_JSON_BYTES} characters)`] };

  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!TOKEN_KEYS.includes(k)) errors.push(`unknown token: ${k.slice(0, 40)}`);
  }
  if ('overrides' in o && !opts.allowOverrides) errors.push('overrides can only be set by a super-admin');

  const mode = o.mode;
  if (!(THEME_MODES as readonly unknown[]).includes(mode)) errors.push('mode must be "dark" or "light"');

  const colors = {} as Record<ColorKey, string>;
  for (const k of COLOR_KEYS) {
    const v = o[k];
    if (typeof v !== 'string' || !HEX.test(v)) errors.push(`${k} must be a #rrggbb colour`);
    else colors[k] = v.toLowerCase();
  }

  const radius = o.radius === undefined ? 'soft' : o.radius;
  if (!(THEME_RADII as readonly unknown[]).includes(radius)) errors.push(`radius must be one of ${THEME_RADII.join(', ')}`);
  const fontOf = (k: 'fontHeading' | 'fontBody') => {
    const v = o[k] === undefined ? 'system' : o[k];
    if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(FONTS, v)) {
      errors.push(`${k} must be one of the allowed fonts`);
      return 'system' as FontKey;
    }
    return v as FontKey;
  };
  const fontHeading = fontOf('fontHeading');
  const fontBody = fontOf('fontBody');

  let overrides: Record<string, string> | undefined;
  if (o.overrides !== undefined && opts.allowOverrides) {
    const ov = o.overrides;
    if (!ov || typeof ov !== 'object' || Array.isArray(ov)) errors.push('overrides must be an object');
    else {
      const entries = Object.entries(ov as Record<string, unknown>);
      if (entries.length > MAX_OVERRIDES) errors.push(`at most ${MAX_OVERRIDES} overrides`);
      overrides = {};
      for (const [name, val] of entries.slice(0, MAX_OVERRIDES)) {
        if (!OVERRIDE_SET.has(name)) errors.push(`override not allowed: ${name.slice(0, 40)}`);
        else if (typeof val !== 'string' || !overrideValueOk(val.trim())) errors.push(`override ${name} must be #rrggbb or rgb()/rgba()`);
        else overrides[name] = val.trim();
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  const warnings: string[] = [];
  if (opts.contrast !== false) {
    const lum = luminance(colors.bg);
    if (mode === 'dark' && lum >= MODE_LUMINANCE_THRESHOLD) {
      return { ok: false, errors: ['mode is "dark" but bg is a light colour; pick a dark bg or set mode to "light"'] };
    }
    if (mode === 'light' && lum < MODE_LUMINANCE_THRESHOLD) {
      return { ok: false, errors: ['mode is "light" but bg is a dark colour; pick a light bg or set mode to "dark"'] };
    }
    const fails = checkThemeContrast(colors);
    const msg = (f: ContrastFailure) => `contrast too low: ${f.pair} is ${f.ratio}:1, needs ${f.min}:1`;
    const blocking = fails.filter((f) => f.blocking);
    if (blocking.length) return { ok: false, errors: blocking.map(msg) };
    for (const f of fails) warnings.push(msg(f));
  }

  const tokens: ThemeTokens = {
    mode: mode as ThemeMode,
    ...colors,
    radius: radius as ThemeRadius,
    fontHeading,
    fontBody,
  };
  if (overrides && Object.keys(overrides).length) tokens.overrides = overrides;
  return { ok: true, tokens, warnings };
}

/** For serving: the normalised tokens, or null when absent/invalid (shape only, no contrast gate). */
export function normalizeThemeTokens(input: unknown, opts: ParseOptions = {}): ThemeTokens | null {
  if (input === null || input === undefined) return null;
  const r = parseThemeTokens(input, { allowOverrides: true, contrast: false, ...opts });
  return r.ok ? r.tokens : null;
}

// ---- derivation ---------------------------------------------------------------------------

const RADIUS: Record<ThemeRadius, { btn: string; card: string }> = {
  square: { btn: '0px', card: '0px' },
  soft: { btn: '8px', card: '12px' },
  round: { btn: '12px', card: '18px' },
  pill: { btn: '9999px', card: '24px' },
};

/**
 * The full CSS variable set for a (valid) token set. Pure; hover and tint steps are mixes toward
 * the text/bg colours. Status hues come from the dark or light AA set already used by the light
 * brand themes in index.css.
 */
export function deriveThemeVars(t: ThemeTokens): Record<string, string> {
  const dark = t.mode === 'dark';
  const vars: Record<string, string> = {
    '--bg-main': t.bg,
    '--bg-card': t.surface,
    '--bg-card-hover': mix(t.surface, t.text, 0.06),
    '--bg-surface': t.surface,
    '--bg-surface-hover': mix(t.surface, t.text, 0.06),
    '--bg-input': t.surface,
    '--bg-input-focus': mix(t.surface, t.text, 0.04),
    '--bg-header': t.surface,
    '--bg-overlay': dark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(17, 17, 17, 0.55)',
    '--text-primary': t.text,
    '--text-secondary': secondaryText(t),
    '--text-muted': t.textMuted,
    '--text-faint': mix(t.textMuted, t.bg, 0.3),
    '--text-inverted': t.bg,
    '--stroke': t.border,
    '--stroke-hover': mix(t.border, t.text, 0.25),
    '--stroke-strong': mix(t.border, t.text, 0.5),
    '--accent': t.accent,
    '--accent-hover': mix(t.accent, t.text, 0.15),
    '--accent-contrast': t.onAccent,
    '--success': dark ? '#39d98a' : '#1f7a45',
    '--warning': dark ? '#ffb347' : '#8a5a00',
    '--error': dark ? '#ff393a' : '#b3261e',
    '--color-scheme': t.mode,
    '--radius-btn': RADIUS[t.radius].btn,
    '--radius-card': RADIUS[t.radius].card,
    '--font-heading': FONTS[t.fontHeading].family,
    '--font-body': FONTS[t.fontBody].family,
    '--accent-tint': rgba(t.accent, 0.14),
  };
  if (t.overrides) {
    for (const [k, v] of Object.entries(t.overrides)) if (OVERRIDE_SET.has(k)) vars[k] = v;
  }
  return vars;
}

/** Distinct stylesheet URLs needed for the heading and body fonts (system needs none). */
export function themeFontHrefs(t: Pick<ThemeTokens, 'fontHeading' | 'fontBody'>): string[] {
  const out: string[] = [];
  for (const k of [t.fontHeading, t.fontBody]) {
    const href = FONTS[k].href;
    if (href && !out.includes(href)) out.push(href);
  }
  return out;
}
