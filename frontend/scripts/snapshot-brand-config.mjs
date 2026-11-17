// Build-time snapshot of the runtime brand config (plans/wl-self-serve-brands.md, PR 7).
//
// Runs as `prebuild`. A complete no-op unless VITE_BRAND_RUNTIME=1, so default and current brand
// builds are untouched. When enabled it fetches /api/brand-config for this build's series (slug, or
// else VITE_BRAND_DOMAIN) and merges it into api/_brand-snapshot.json, which api/brand-config.ts
// serves if the backend is down at request time. A fetch failure never fails the build: the
// committed snapshot stays as it was.
import { readFileSync, writeFileSync } from 'node:fs';

if ((process.env.VITE_BRAND_RUNTIME || '').trim() !== '1') process.exit(0);

const API = (process.env.VITE_API_URL || 'https://backend-pizza-dao.vercel.app').replace(/\/+$/, '');
const slug = (process.env.VITE_BRAND_SERIES_SLUG || '').trim().toLowerCase();
const host = (process.env.VITE_BRAND_DOMAIN || '').trim().toLowerCase().replace(/\/+$/, '');
const file = new URL('../api/_brand-snapshot.json', import.meta.url);

if (!slug && !host) {
  console.log('[brand-snapshot] no VITE_BRAND_SERIES_SLUG / VITE_BRAND_DOMAIN; skipping');
  process.exit(0);
}

try {
  const qs = slug ? `slug=${encodeURIComponent(slug)}` : `host=${encodeURIComponent(host)}`;
  const r = await fetch(`${API}/api/brand-config?${qs}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const cfg = await r.json();
  if (!cfg || typeof cfg.slug !== 'string') throw new Error('unexpected response');
  let current = { configs: [] };
  try {
    current = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* start fresh */
  }
  const configs = (Array.isArray(current.configs) ? current.configs : []).filter((c) => c && c.slug !== cfg.slug);
  configs.push(cfg);
  writeFileSync(file, JSON.stringify({ configs }, null, 2) + '\n');
  console.log(`[brand-snapshot] wrote ${cfg.slug} (v${cfg.v})`);
} catch (err) {
  console.warn(`[brand-snapshot] could not refresh (${err.message}); keeping the committed snapshot`);
}
