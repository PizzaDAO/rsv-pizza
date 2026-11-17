// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import middleware, { rewriteMeta, homeMeta, isOpenAsset } from './middleware';
import viteConfig from './vite.config';

const INDEX = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const EVIL = '"><script>alert(1)</script> $& $1';

const CFG = {
  seriesId: 'series-ex',
  slug: 'example',
  name: 'Example Pizza',
  tagline: 'Slices for all',
  description: 'About Example',
  url: 'https://pizza.example.org',
  logoUrl: '/brands/example/logo.png',
  faviconUrl: 'https://cdn.example.org/fav.png',
  ogImageUrl: 'https://cdn.example.org/og.png',
  hasCustomOgImage: true,
};

describe('rewriteMeta / homeMeta', () => {
  it('rewrites the static tags for a runtime brand home page', () => {
    const out = rewriteMeta(INDEX, homeMeta(CFG));
    expect(out).toContain('<title>Example Pizza - Slices for all</title>');
    expect(out).toContain('<meta property="og:title" content="Example Pizza - Slices for all" />');
    expect(out).toContain('<meta property="og:description" content="About Example" />');
    expect(out).toContain('<meta property="og:url" content="https://pizza.example.org/" />');
    expect(out).toContain('<meta property="og:image" content="https://cdn.example.org/og.png" />');
    expect(out).toContain('<meta property="og:image:width" content="1200" />');
    expect(out).toContain('<meta property="og:site_name" content="Example Pizza" />');
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(out).toContain('<link rel="icon" type="image/png" href="https://cdn.example.org/fav.png" />');
  });

  it('escapes a malicious name, tagline, description and image URL', () => {
    const out = rewriteMeta(INDEX, homeMeta({ ...CFG, name: EVIL, tagline: EVIL, description: EVIL, ogImageUrl: `https://x.example.org/a.png?q="${EVIL}` }));
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).not.toMatch(/content="[^"]*"><script/);
    expect(out).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; $1');
  });

  it('leaves untouched tags alone when optional values are omitted', () => {
    const out = rewriteMeta(INDEX, { docTitle: 'T', title: 'T', url: 'https://x.example.org/', image: 'https://x.example.org/i.png', imageWidth: 1, imageHeight: 1, twitterCard: 'summary' });
    expect(out).toContain('content="Invite your friends to share some pizza!"');
    expect(out).toContain('og:site_name" content="RSV.Pizza"');
    expect(out).toContain('href="/logo.png"');
  });
});

describe('middleware', () => {
  const realFetch = globalThis.fetch;
  const crawler = { 'user-agent': 'facebookexternalhit/1.1' };
  const isNext = (r: Response | undefined) => !!r && r.headers.get('x-middleware-next') === '1';

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.org');
    globalThis.fetch = vi.fn(async (input: any) => {
      const u = String(input);
      if (u.startsWith('https://api.example.org/api/brand-config')) return new Response(JSON.stringify(CFG), { status: 200 });
      return new Response(INDEX, { status: 200 });
    }) as any;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it('serves the brand home meta to crawlers on a runtime host', async () => {
    vi.stubEnv('VITE_BRAND_RUNTIME', '1');
    const res = await middleware(new Request('https://hostA.example.org/', { headers: crawler }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Example Pizza - Slices for all" />');
  });

  it('leaves / completely unchanged when the flag is off (rsv.pizza and current brands)', async () => {
    const res = await middleware(new Request('https://rsv.example.org/', { headers: crawler }));
    expect(isNext(res)).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not rewrite / for browsers even when the flag is on', async () => {
    vi.stubEnv('VITE_BRAND_RUNTIME', '1');
    const res = await middleware(new Request('https://hostB.example.org/', { headers: { 'user-agent': 'Mozilla/5.0' } }));
    expect(isNext(res)).toBe(true);
  });

  it('unknown host (config 404) falls through to the SPA', async () => {
    vi.stubEnv('VITE_BRAND_RUNTIME', '1');
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as any;
    const res = await middleware(new Request('https://hostC.example.org/', { headers: crawler }));
    expect(isNext(res)).toBe(true);
  });

  it('config API down falls through to the SPA', async () => {
    vi.stubEnv('VITE_BRAND_RUNTIME', '1');
    globalThis.fetch = vi.fn(async () => { throw new Error('down'); }) as any;
    const res = await middleware(new Request('https://hostD.example.org/', { headers: crawler }));
    expect(isNext(res)).toBe(true);
  });

  it('event pages on a runtime host use the brand origin/name and refuse another series', async () => {
    vi.stubEnv('VITE_BRAND_RUNTIME', '1');
    globalThis.fetch = vi.fn(async (input: any) => {
      const u = String(input);
      if (u.includes('/api/brand-config')) return new Response(JSON.stringify(CFG), { status: 200 });
      if (u.includes('/api/events/')) return new Response(JSON.stringify({ event: { id: 'p1', name: 'London Night', eventSeriesId: u.includes('other') ? 'series-other' : 'series-ex' } }), { status: 200 });
      return new Response(INDEX, { status: 200 });
    }) as any;
    const ok = await middleware(new Request('https://hostE.example.org/london', { headers: crawler }));
    const html = await ok.text();
    expect(html).toContain('<title>London Night | Example Pizza</title>');
    expect(html).toContain('og:url" content="https://pizza.example.org/london"');
    const other = await middleware(new Request('https://hostE.example.org/other', { headers: crawler }));
    expect(isNext(other)).toBe(true);
  });
});

describe('open assets', () => {
  it('allows /brand-config.js and uploaded brand assets, but not other /cdn/ paths', () => {
    expect(isOpenAsset('/brand-config.js')).toBe(true);
    expect(isOpenAsset('/cdn/brand-assets/series-1/logo.png')).toBe(true);
    expect(isOpenAsset('/cdn/hackathon-media/x.png')).toBe(false);
    expect(isOpenAsset('/cdn/brand-assetsx/x.png')).toBe(false);
  });
});

describe('index.html with and without VITE_BRAND_RUNTIME', () => {
  const run = (flag: string | undefined) => {
    if (flag === undefined) vi.stubEnv('VITE_BRAND_RUNTIME', '');
    else vi.stubEnv('VITE_BRAND_RUNTIME', flag);
    const cfg = (viteConfig as unknown as (a: { mode: string }) => { plugins: Array<{ name?: string; transformIndexHtml?: (h: string) => unknown }> })({ mode: 'test' });
    const plugin = cfg.plugins.flat().find((p) => p && p.name === 'brand-index-html')!;
    return plugin.transformIndexHtml!(INDEX);
  };
  afterEach(() => vi.unstubAllEnvs());

  it('without the flag the output is a plain string with no brand-config script', () => {
    const out = run(undefined);
    expect(typeof out).toBe('string');
    expect(out as string).not.toContain('/brand-config.js');
    expect(out).toBe(INDEX);
  });

  it('with the flag a blocking /brand-config.js script is prepended to <head>', () => {
    const out = run('1') as { html: string; tags: Array<{ tag: string; attrs: Record<string, string>; injectTo: string }> };
    expect(out.tags).toEqual([{ tag: 'script', attrs: { src: '/brand-config.js' }, injectTo: 'head-prepend' }]);
  });
});
