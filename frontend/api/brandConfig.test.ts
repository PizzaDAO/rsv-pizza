// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import vm from 'node:vm';
import { FONTS } from '../src/config/themeTokens';
import { jsonForScript, renderBrandScript, cleanThemeVars, FONT_HREFS, fontHrefsFor, pickFromSnapshot, cleanHost, EMPTY_SCRIPT } from './_brandConfig';
import handler from './brand-config';

const EVIL = '</script><script>alert(1)</script>"\u2028\u2029&\'';

/** Run the script in a sandbox with a minimal DOM and return what it did. */
function runScript(code: string) {
  const classes: string[] = [];
  const vars: Record<string, string> = {};
  const appended: Array<Record<string, unknown>> = [];
  const listeners: Array<() => void> = [];
  const link: { rel?: string; href?: string } = {};
  const doc = {
    title: 'static',
    documentElement: {
      classList: { add: (c: string) => classes.push(c) },
      style: { setProperty: (k: string, v: string) => { vars[k] = v; } },
    },
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    querySelector: () => link,
    createElement: () => ({ setAttribute() {} } as Record<string, unknown>),
    head: { appendChild: (e: Record<string, unknown>) => { appended.push(e); } },
  };
  const win: Record<string, unknown> = {};
  vm.runInNewContext(code, { window: win, document: doc });
  listeners.forEach((fn) => fn());
  return { win, doc, classes, link, vars, appended };
}

describe('jsonForScript', () => {
  it('escapes </script>, < > &, and U+2028/9 so nothing can close the tag or break the literal', () => {
    const out = jsonForScript({ name: EVIL });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
    expect(JSON.parse(out).name).toBe(EVIL);
  });
});

describe('renderBrandScript', () => {
  it('a malicious brand name / tagline round-trips as data and never appears as markup or code', () => {
    const code = renderBrandScript({ slug: 'example', name: EVIL, tagline: EVIL, themeClass: 'example-theme', faviconUrl: '/f.png' });
    expect(code).not.toContain('</script>');
    expect(code.toLowerCase()).not.toContain('<script');
    const { win, doc, classes, link } = runScript(code);
    expect((win.__BRAND__ as { name: string }).name).toBe(EVIL);
    expect(doc.title).toBe(`${EVIL} - ${EVIL}`);
    expect(classes).toEqual(['example-theme']);
    expect(link.href).toBe('/f.png');
    expect(win.alert).toBeUndefined();
  });

  it('is a harmless no-op when optional fields are missing', () => {
    const { win, classes, doc } = runScript(renderBrandScript({ slug: 'example' }));
    expect(win.__BRAND__).toEqual({ slug: 'example' });
    expect(classes).toEqual([]);
    expect(doc.title).toBe('static');
  });

  it('applies derived theme variables and the wl-theme classes before first paint', () => {
    const themeVars = { '--bg-main': '#0b0b10', '--font-body': "'Inter', ui-sans-serif, system-ui, sans-serif", '--radius-btn': '9999px' };
    const dark = runScript(renderBrandScript({ slug: 'example', themeClass: 'example-theme', tokens: { mode: 'dark' }, themeVars }));
    expect(dark.vars).toEqual(themeVars);
    expect(dark.classes).toEqual(['example-theme', 'wl-theme']);
    const light = runScript(renderBrandScript({ slug: 'example', tokens: { mode: 'light' }, themeVars }));
    expect(light.classes).toEqual(['wl-theme', 'wl-light']);
  });

  it('injects preconnect + stylesheet links for the chosen fonts before first paint', () => {
    const themeVars = { '--bg-main': '#0b0b10' };
    const r = runScript(renderBrandScript({ slug: 'example', tokens: { mode: 'dark', fontHeading: 'kanit', fontBody: 'inter' }, themeVars }));
    const sheets = r.appended.filter((e) => e.rel === 'stylesheet').map((e) => e.href);
    expect(sheets).toEqual([FONT_HREFS.kanit, FONT_HREFS.inter]);
    const pre = r.appended.filter((e) => e.rel === 'preconnect').map((e) => e.href);
    expect(pre).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
    const sys = runScript(renderBrandScript({ slug: 'example', tokens: { mode: 'dark', fontHeading: 'system', fontBody: 'system' }, themeVars }));
    expect(sys.appended).toEqual([]);
  });

  it('never turns an unknown or malicious font key into a link', () => {
    const themeVars = { '--bg-main': '#0b0b10' };
    const r = runScript(renderBrandScript({ slug: 'example', tokens: { mode: 'dark', fontHeading: 'https://evil.example.org/x.css', fontBody: 'constructor' }, themeVars }));
    expect(r.appended).toEqual([]);
    expect(fontHrefsFor({ fontHeading: '__proto__', fontBody: 'toString' })).toEqual([]);
    expect(fontHrefsFor(null)).toEqual([]);
  });

  it('adds no fonts when the theme vars are rejected', () => {
    const r = runScript(renderBrandScript({ slug: 'example', tokens: { fontBody: 'inter' }, themeVars: { '--x': 'a;b' } }));
    expect(r.appended).toEqual([]);
  });

  it('adds no theme classes or variables when there are none, or when all are malformed', () => {
    expect(runScript(renderBrandScript({ slug: 'example' })).classes).toEqual([]);
    const bad = runScript(renderBrandScript({ slug: 'example', themeVars: { '--x': 'red; background:url(//evil.example.org)', color: '#000000' } }));
    expect(bad.classes).toEqual([]);
    expect(bad.vars).toEqual({});
  });

  it('the empty script is valid JS', () => {
    expect(() => vm.runInNewContext(EMPTY_SCRIPT, {})).not.toThrow();
  });
});

describe('FONT_HREFS', () => {
  it('matches the FONTS table in src/config/themeTokens.ts exactly', () => {
    const expected = Object.fromEntries(Object.entries(FONTS).filter(([, f]) => f.href).map(([k, f]) => [k, f.href]));
    expect(FONT_HREFS).toEqual(expected);
  });
});

describe('cleanThemeVars', () => {
  it('keeps well-formed pairs and drops injection attempts', () => {
    expect(cleanThemeVars({
      '--accent': '#e6212f', '--bg-overlay': 'rgba(0, 0, 0, 0.7)', '--font-body': "'Inter', sans-serif",
      '--a': 'x;y', '--b': 'url(//evil.example.org/x)', '--b2': 'URL(evil)', '--c': '{}', '--d': '</style>', '--e': 'a\nb', Color: '#fff',
      '--f': 5, '--G': '#fff', '--h': 'a:b', '--i': 'a\\b',
    })).toEqual({ '--accent': '#e6212f', '--bg-overlay': 'rgba(0, 0, 0, 0.7)', '--font-body': "'Inter', sans-serif" });
  });
  it('rejects non-objects and caps the count', () => {
    for (const v of [null, undefined, 'x', [], 5]) expect(cleanThemeVars(v)).toBeUndefined();
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`--v${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, '#000000']));
    expect(Object.keys(cleanThemeVars(many)!).length).toBe(40);
  });
});

describe('helpers', () => {
  it('cleanHost accepts hostnames only', () => {
    expect(cleanHost('Pizza.Example.org')).toBe('pizza.example.org');
    for (const bad of ['', 'a/b', 'x y', '<s>', undefined, 5]) expect(cleanHost(bad)).toBe('');
  });
  it('pickFromSnapshot prefers slug, else host', () => {
    const snap = { configs: [{ slug: 'a', domain: 'a.example.org' }, { slug: 'b', domain: 'b.example.org' }] };
    expect(pickFromSnapshot(snap, 'b', '')?.slug).toBe('b');
    expect(pickFromSnapshot(snap, '', 'a.example.org')?.slug).toBe('a');
    expect(pickFromSnapshot(snap, '', 'zzz.example.org')).toBeNull();
    expect(pickFromSnapshot(null, 'a', '')).toBeNull();
  });
});

function call(query: Record<string, string> = { host: 'pizza.example.org' }) {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    body: '',
    status(c: number) { res.statusCode = c; return res; },
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; return res; },
    send(b: string) { res.body = b; return res; },
  };
  return handler({ query, headers: {} } as any, res).then(() => ({ res, headers }));
}

describe('/brand-config.js handler', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.stubEnv('VITE_BRAND_RUNTIME', '1');
    vi.stubEnv('VITE_BRAND_SERIES_SLUG', '');
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it('404s on deploys that did not opt in', async () => {
    vi.stubEnv('VITE_BRAND_RUNTIME', '');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const { res } = await call();
    expect(res.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves the script with SWR cache headers when the backend answers', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ slug: 'example', name: 'Example Pizza' }), { status: 200 })) as any;
    const { res, headers } = await call();
    expect(res.statusCode).toBe(200);
    expect(headers['content-type']).toContain('text/javascript');
    expect(headers['cache-control']).toBe('public, max-age=60, s-maxage=60, stale-while-revalidate=86400');
    expect(res.body).toContain('"name":"Example Pizza"');
  });

  it('unknown host: an empty script (the app keeps its env defaults), not an error', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as any;
    const { res } = await call({ host: 'unknown.example.org' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(EMPTY_SCRIPT);
  });

  it('API 500 falls back to this instance last good copy', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ slug: 'lg', name: 'Last Good' }), { status: 200 })) as any;
    await call({ host: 'lg.example.org' });
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    const { res, headers } = await call({ host: 'lg.example.org' });
    expect(res.body).toContain('Last Good');
    expect(headers['cache-control']).toContain('max-age=10');
  });

  it('API down with no last good: the build-time snapshot, then an empty script', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('down'); }) as any;
    const { res } = await call({ host: 'never-seen.example.org' });
    // The committed snapshot has no entry for this host, so the app keeps its env defaults.
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(EMPTY_SCRIPT);
  });

  it('rejects an invalid host without calling the backend', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const { res } = await call({ host: 'a/../b' });
    expect(res.body).toBe(EMPTY_SCRIPT);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
