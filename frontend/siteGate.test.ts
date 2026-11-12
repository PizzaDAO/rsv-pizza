// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { siteGate, isOpenAsset, GATE_COOKIE } from './siteGate';

const PW = 'hunter2';
const req = (path: string, init?: RequestInit) => new Request(`https://x.test${path}`, init);

async function login(password: string, next = '/') {
  const body = new URLSearchParams({ password, next });
  return siteGate(
    req('/__gate', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    PW
  );
}

describe('siteGate', () => {
  it('is inert when SITE_PASSWORD is unset', async () => {
    expect(await siteGate(req('/anything'), undefined)).toBeNull();
    expect(await siteGate(req('/anything'), '')).toBeNull();
  });

  it('shows the form (401) for pages and html without a cookie', async () => {
    for (const p of ['/', '/some-event', '/gpp', '/index.html', '/host/abc/guests']) {
      const res = await siteGate(req(p), PW);
      expect(res?.status).toBe(401);
      expect(await res!.text()).toContain('type="password"');
    }
  });

  it('lets static assets through', async () => {
    for (const p of ['/assets/a.js', '/logo.png', '/brands/x/logo.png', '/favicon.ico', '/cdn/a/b.jpg', '/fonts/a.woff2']) {
      expect(isOpenAsset(p)).toBe(true);
      expect(await siteGate(req(p), PW)).toBeNull();
    }
  });

  it('rejects a wrong password and sets no cookie', async () => {
    const res = await login('nope');
    expect(res?.status).toBe(401);
    expect(res?.headers.get('set-cookie')).toBeNull();
  });

  it('sets an HttpOnly/Secure/SameSite=Lax HMAC cookie on the right password, never the raw value', async () => {
    const res = await login(PW, '/some-event?x=1');
    expect(res?.status).toBe(303);
    expect(res?.headers.get('location')).toBe('/some-event?x=1');
    const cookie = res!.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toContain(PW);

    const value = cookie.split(';')[0];
    expect(value.startsWith(`${GATE_COOKIE}=`)).toBe(true);
    // The cookie then unlocks pages; a tampered one does not.
    expect(await siteGate(req('/some-event', { headers: { cookie: value } }), PW)).toBeNull();
    expect((await siteGate(req('/some-event', { headers: { cookie: `${GATE_COOKIE}=deadbeef` } }), PW))?.status).toBe(401);
  });

  it('does not allow open redirects via next', async () => {
    for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      const res = await login(PW, evil);
      expect(res?.headers.get('location')).toBe('/');
    }
  });
});
