/// <reference types="vitest" />
/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Substitute brand values into the static index.html so crawlers that don't run
 * JS see the right title/OG/favicon. Defaults equal the literals in index.html,
 * so with no VITE_BRAND_* set the output is byte-identical.
 */
/** Runtime brand config (plans/wl-self-serve-brands.md, PR 7): opt-in per build via VITE_BRAND_RUNTIME=1. */
function brandRuntimeEnabled(mode: string): boolean {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return (env.VITE_BRAND_RUNTIME || process.env.VITE_BRAND_RUNTIME || '').trim() === '1';
}

function brandIndexHtml(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const runtime = brandRuntimeEnabled(mode);
  const v = (k: string, d: string) => (env[k] || process.env[k] || d).trim();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const name = v('VITE_BRAND_NAME', 'RSV.Pizza'); // brand-check-ignore-line
  const tagline = v('VITE_BRAND_TAGLINE', 'Pizza Party Planner');
  const domain = v('VITE_BRAND_DOMAIN', 'rsv.pizza').replace(/\/+$/, ''); // brand-check-ignore-line
  const logo = v('VITE_BRAND_LOGO_URL', '/logo.png');
  // Tab icon. Defaults to the logo URL (previous behavior); set to a square favicon asset to override.
  const favicon = v('VITE_BRAND_FAVICON_URL', logo);
  // A brand-supplied OG image is a wide share card, not the 512px logo.
  const customOg = !!(env.VITE_BRAND_OG_IMAGE || process.env.VITE_BRAND_OG_IMAGE || '').trim();
  const ogRaw = v('VITE_BRAND_OG_IMAGE', '/logo.png');
  const description = v('VITE_BRAND_DESCRIPTION', 'Invite your friends to share some pizza!');
  const origin = `https://${domain}`;
  const og = /^https?:\/\//i.test(ogRaw) ? ogRaw : `${origin}/${ogRaw.replace(/^\/+/, '')}`;
  const title = `${name} - ${tagline}`;
  return {
    name: 'brand-index-html',
    transformIndexHtml(html) {
      let out = html
        .replace('<link rel="icon" type="image/png" href="/logo.png" />', () => `<link rel="icon" type="image/png" href="${esc(favicon)}" />`)
        .replaceAll('RSV.Pizza - Pizza Party Planner', () => esc(title)) // brand-check-ignore-line
        .replaceAll('Invite your friends to share some pizza!', () => esc(description))
        .replaceAll('content="https://rsv.pizza/logo.png"', () => `content="${esc(og)}"`) // brand-check-ignore-line
        .replaceAll('content="https://rsv.pizza/"', () => `content="${esc(origin)}/"`) // brand-check-ignore-line
        .replace('content="RSV.Pizza" />', () => `content="${esc(name)}" />`); // brand-check-ignore-line
      if (customOg) {
        out = out
          .replace('<meta property="og:image:width" content="512" />', () => '<meta property="og:image:width" content="1200" />')
          .replace('<meta property="og:image:height" content="512" />', () => '<meta property="og:image:height" content="630" />')
          .replace('<meta name="twitter:card" content="summary" />', () => '<meta name="twitter:card" content="summary_large_image" />');
      }
      // Runtime-brand builds load /brand-config.js (window.__BRAND__) as the FIRST, blocking head
      // script so the brand never flashes. Without the flag the HTML is returned untouched.
      if (runtime) {
        return { html: out, tags: [{ tag: 'script', attrs: { src: '/brand-config.js' }, injectTo: 'head-prepend' as const }] };
      }
      return out;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), brandIndexHtml(mode)],
  base: '/',
  // Compile-time flag read by src/config/brand.ts. When false the runtime overlay is dead code and
  // is removed from the bundle, so builds without VITE_BRAND_RUNTIME are unchanged.
  define: { __BRAND_RUNTIME__: JSON.stringify(brandRuntimeEnabled(mode)) },
  build: {
    // forno-81402: iPhone 8 tops out at iOS 16 (Safari 16).
    target: ['es2020', 'safari15'],
  },
  server: {
    port: 5176,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // e2e/ holds Playwright specs (run by `playwright test`); vitest can't execute them.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_API_URL: 'http://localhost:3001',
      VITE_GOOGLE_MAPS_API_KEY: 'test-api-key',
      // napoletana-58547: the app defaults to the keyless `osm` provider; tests exercise the
      // Google branch (src/test/setup.ts documents this, but its import.meta.env override
      // does not reach src/lib/maps/provider.ts, so set it here where vitest injects env).
      VITE_MAP_PROVIDER: 'google',
    },
  },
}));
