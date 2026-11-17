/**
 * Pure helpers for /brand-config.js (api/brand-config.ts). The leading underscore keeps Vercel from
 * deploying this file as its own function. Runs as unbundled Node ESM: no relative imports.
 */

/** The public brand config served by the backend's /api/brand-config (a subset is all we rely on). */
export interface RuntimeBrandConfig {
  v?: number;
  slug?: string;
  seriesId?: string;
  name?: string | null;
  tagline?: string | null;
  description?: string | null;
  domain?: string | null;
  url?: string | null;
  logoUrl?: string | null;
  logoLightUrl?: string | null;
  faviconUrl?: string | null;
  ogImageUrl?: string | null;
  hasCustomOgImage?: boolean;
  supportEmail?: string | null;
  themeClass?: string | null;
  tokens?: Record<string, unknown> | null;
  /** Derived CSS variables (backend deriveThemeVars). Re-validated here before they reach the page. */
  themeVars?: Record<string, unknown> | null;
  flyer?: { templateKey?: string | null; art?: Record<string, unknown> | null } | null;
}

/**
 * JSON that is safe inside an inline <script>: `<`, `>`, `&` and the JS line separators U+2028/9
 * are \u-escaped, so no config string can close the script tag or break the literal.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const VAR_NAME = /^--[a-z][a-z-]{0,40}$/;
/** Hex / rgba / lengths / the two scheme words / quoted font stacks. No `;{}<>/:@\` or newlines, no url(). */
const VAR_VALUE = /^(?![^]*url\()[A-Za-z0-9 #,.'"()%_-]{1,200}$/i;

/**
 * font key -> stylesheet URL, mirrored from src/config/themeTokens.ts FONTS (this file is unbundled
 * Node ESM and cannot import it; api/brandConfig.test.ts asserts the two tables match). A partner
 * only ever supplies a key; the URL always comes from this table.
 */
export const FONT_HREFS: Record<string, string> = {
  inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  nunito: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap',
  kanit: 'https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700&display=swap',
  satoshi: 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap',
  rubik: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap',
  'space-grotesk': 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap',
  'dm-sans': 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap',
  poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
  montserrat: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap',
  outfit: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap',
  'work-sans': 'https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap',
  'playfair-display': 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap',
  lora: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&display=swap',
  'jetbrains-mono': 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap',
};

/** Stylesheet URLs for the heading/body font keys in `tokens` (unknown keys and `system` give none). */
export function fontHrefsFor(tokens: unknown): string[] {
  if (!tokens || typeof tokens !== 'object') return [];
  const t = tokens as Record<string, unknown>;
  const out: string[] = [];
  for (const k of [t.fontHeading, t.fontBody]) {
    if (typeof k !== 'string' || !Object.prototype.hasOwnProperty.call(FONT_HREFS, k)) continue;
    const href = FONT_HREFS[k];
    if (!out.includes(href)) out.push(href);
  }
  return out;
}

/** Defence in depth for the applier: only well-formed `--name: value` pairs survive (at most 40).
 * The backend already derives these from validated tokens; this keeps a poisoned snapshot or
 * response from reaching the page. Returns undefined when nothing is left.
 */
export function cleanThemeVars(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
    if (VAR_NAME.test(k) && typeof val === 'string' && VAR_VALUE.test(val)) out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The body of /brand-config.js. Part 1 hands the data to the app (`window.__BRAND__`, read by
 * src/config/brand.ts at module eval). Part 2 is a tiny synchronous applier that only reads the
 * (already JSON-parsed) data: no config string is ever concatenated into code. Title and favicon
 * wait for DOMContentLoaded because this script runs before <head> has been parsed.
 */
export function renderBrandScript(input: RuntimeBrandConfig): string {
  const cfg: RuntimeBrandConfig = { ...input };
  const vars = cleanThemeVars(input.themeVars);
  if (vars) cfg.themeVars = vars;
  else delete cfg.themeVars;
  const fonts = vars ? fontHrefsFor(input.tokens) : [];
  const preconnect: string[] = [];
  if (fonts.some((h) => h.startsWith('https://fonts.googleapis.com/'))) preconnect.push('https://fonts.googleapis.com', 'https://fonts.gstatic.com');
  if (fonts.some((h) => h.startsWith('https://api.fontshare.com/'))) preconnect.push('https://api.fontshare.com', 'https://cdn.fontshare.com');
  return `window.__BRAND__=${jsonForScript(cfg)};
(function(){
try{
var b=window.__BRAND__,d=document,r=d.documentElement;
if(b.themeClass){r.classList.add(b.themeClass);}
if(b.themeVars){var n=0;for(var k in b.themeVars){n++;r.style.setProperty(k,b.themeVars[k]);}
if(n){r.classList.add('wl-theme');
var P=${jsonForScript(preconnect)},F=${jsonForScript(fonts)},i,e;
for(i=0;i<P.length;i++){e=d.createElement('link');e.rel='preconnect';e.href=P[i];if(P[i].indexOf('gstatic')>0||P[i].indexOf('cdn.')>0){e.crossOrigin='anonymous';}d.head.appendChild(e);}
for(i=0;i<F.length;i++){e=d.createElement('link');e.rel='stylesheet';e.href=F[i];e.setAttribute('data-wl-font','');d.head.appendChild(e);}
if(b.tokens&&b.tokens.mode==='light'){r.classList.add('wl-light');}}}
d.addEventListener('DOMContentLoaded',function(){
try{
if(b.name){d.title=b.name+(b.tagline?' - '+b.tagline:'');}
if(b.faviconUrl){
var l=d.querySelector('link[rel="icon"]');
if(!l){l=d.createElement('link');l.rel='icon';d.head.appendChild(l);}
l.href=b.faviconUrl;
}
}catch(e){}
});
}catch(e){}
})();
`;
}

/** A syntactically valid, side-effect-free script for "no config available". */
export const EMPTY_SCRIPT = '/* brand-config: none */\n';

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/;

/** Lowercased host if it is a plausible hostname, else ''. */
export function cleanHost(v: unknown): string {
  const one = Array.isArray(v) ? v[0] : v;
  if (typeof one !== 'string') return '';
  const h = one.trim().toLowerCase();
  return HOST_RE.test(h) ? h : '';
}

/** Pick a config out of a build-time snapshot by slug (preferred) or host. */
export function pickFromSnapshot(
  snapshot: { configs?: RuntimeBrandConfig[] } | null | undefined,
  slug: string,
  host: string,
): RuntimeBrandConfig | null {
  const list = Array.isArray(snapshot?.configs) ? snapshot!.configs! : [];
  if (slug) return list.find((c) => c && c.slug === slug) ?? null;
  return list.find((c) => c && c.domain && c.domain.toLowerCase() === host) ?? null;
}
