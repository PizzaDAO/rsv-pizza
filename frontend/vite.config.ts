/// <reference types="vitest" />
/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Substitute brand values into the static index.html so crawlers that don't run
 * JS see the right title/OG/favicon. Defaults equal the literals in index.html,
 * so with no VITE_BRAND_* set the output is byte-identical.
 */
function brandIndexHtml(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const v = (k: string, d: string) => (env[k] || process.env[k] || d).trim();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const name = v('VITE_BRAND_NAME', 'RSV.Pizza'); // brand-check-ignore-line
  const tagline = v('VITE_BRAND_TAGLINE', 'Pizza Party Planner');
  const domain = v('VITE_BRAND_DOMAIN', 'rsv.pizza').replace(/\/+$/, ''); // brand-check-ignore-line
  const logo = v('VITE_BRAND_LOGO_URL', '/logo.png');
  const ogRaw = v('VITE_BRAND_OG_IMAGE', '/logo.png');
  const description = v('VITE_BRAND_DESCRIPTION', 'Invite your friends to share some pizza!');
  const origin = `https://${domain}`;
  const og = /^https?:\/\//i.test(ogRaw) ? ogRaw : `${origin}/${ogRaw.replace(/^\/+/, '')}`;
  const title = `${name} - ${tagline}`;
  return {
    name: 'brand-index-html',
    transformIndexHtml(html) {
      return html
        .replace('<link rel="icon" type="image/png" href="/logo.png" />', `<link rel="icon" type="image/png" href="${esc(logo)}" />`)
        .replaceAll('RSV.Pizza - Pizza Party Planner', esc(title)) // brand-check-ignore-line
        .replaceAll('Invite your friends to share some pizza!', esc(description))
        .replaceAll('content="https://rsv.pizza/logo.png"', `content="${esc(og)}"`) // brand-check-ignore-line
        .replaceAll('content="https://rsv.pizza/"', `content="${esc(origin)}/"`) // brand-check-ignore-line
        .replace('content="RSV.Pizza" />', `content="${esc(name)}" />`); // brand-check-ignore-line
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), brandIndexHtml(mode)],
  base: '/',
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
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_API_URL: 'http://localhost:3001',
      VITE_GOOGLE_MAPS_API_KEY: 'test-api-key',
    },
  },
}));
