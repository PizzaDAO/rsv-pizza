/**
 * Runtime theme tokens (plans/wl-self-serve-brands.md, PR 8).
 *
 * On VITE_BRAND_RUNTIME=1 builds, brand.ts calls `applyThemeTokens(window.__BRAND__)` at startup.
 * With valid tokens it switches on the generic `.wl-theme` layer (src/index.css): the class on the
 * document root, the derived variables as inline custom properties (setProperty, never CSS text),
 * and the chosen fonts' stylesheets. The blocking /brand-config.js usually applied the same class
 * and variables already; this is idempotent and also covers the app's own font loading.
 *
 * Nothing here runs unless tokens are present AND pass validation, so every site without tokens is
 * untouched.
 */

import { normalizeThemeTokens, deriveThemeVars, themeFontHrefs } from './themeTokens';

export function applyThemeTokens(rt: { tokens?: unknown } | null | undefined, doc: Document = document): boolean {
  if (!rt || typeof rt !== 'object') return false;
  const tokens = normalizeThemeTokens(rt.tokens);
  if (!tokens) return false;
  const root = doc.documentElement;
  const vars = deriveThemeVars(tokens);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.classList.add('wl-theme');
  root.classList.toggle('wl-light', tokens.mode === 'light');
  for (const href of themeFontHrefs(tokens)) {
    const exists = Array.from(doc.querySelectorAll('link[data-wl-font]')).some((l) => l.getAttribute('href') === href);
    if (exists) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-wl-font', '');
    doc.head.appendChild(link);
  }
  return true;
}
