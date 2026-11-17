import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVercelAdapter, createResendAdapter, DomainApiError, getVercel, getResend, adapterAvailability, setDomainAdaptersForTest } from './domainAdapters.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.useRealTimers();
  setDomainAdaptersForTest({});
  delete process.env.VERCEL_DOMAINS_TOKEN; delete process.env.VERCEL_TEAM_ID; delete process.env.RESEND_ADMIN_KEY;
});

describe('Vercel adapter', () => {
  it('scopes every call to the team and sends the bearer token', async () => {
    const f = vi.fn(async () => json(200, { name: 'a.example.org', verified: true, verification: [{ type: 'TXT', domain: '_vercel.example.org', value: 'vc-domain-verify=x' }] }));
    const v = createVercelAdapter('tok-123', 'team_1', f as any);
    const d = await v.addProjectDomain('prj 1', 'a.example.org');
    expect(d.verification).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://api.vercel.com/v10/projects/prj%201/domains?teamId=team_1');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('setRedirect sends a 308, and null clears it', async () => {
    const f = vi.fn(async () => json(200, {}));
    const v = createVercelAdapter('t', 'team', f as any);
    await v.setRedirect('p', 'old.example.org', 'new.example.org');
    await v.setRedirect('p', 'old.example.org', null);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toEqual({ redirect: 'new.example.org', redirectStatusCode: 308 });
    expect(JSON.parse((f.mock.calls[1] as any)[1].body)).toEqual({ redirect: null, redirectStatusCode: null });
  });
  it('config picks the best recommended CNAME and strips the dot', async () => {
    const v = createVercelAdapter('t', 'team', (async () => json(200, { misconfigured: false, recommendedCNAME: [{ rank: 2, value: 'b.vercel-dns-017.com.' }, { rank: 1, value: 'A.vercel-dns-016.com.' }] })) as any);
    expect(await v.getDomainConfig('x.example.org')).toEqual({ misconfigured: false, cnameTarget: 'a.vercel-dns-016.com' });
  });
  it('a 404 on read is null; other errors never carry the token', async () => {
    const v = createVercelAdapter('SECRET-TOKEN', 'team', (async () => json(404, { error: { code: 'not_found', message: 'nope' } })) as any);
    expect(await v.getProjectDomain('p', 'x.example.org')).toBeNull();
    const bad = createVercelAdapter('SECRET-TOKEN', 'team', (async () => json(500, { error: { message: 'boom' } })) as any);
    const e = await bad.addProjectDomain('p', 'x.example.org').catch((x) => x);
    expect(e).toBeInstanceOf(DomainApiError);
    expect(JSON.stringify([e.message, e.status])).not.toContain('SECRET-TOKEN');
  });
  it('times out quickly instead of hanging', async () => {
    vi.useFakeTimers();
    const hang = ((_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))))) as any;
    const p = createVercelAdapter('t', 'team', hang).getDomainConfig('x.example.org').catch((x) => x);
    await vi.advanceTimersByTimeAsync(9000);
    const e = await p;
    expect(e).toBeInstanceOf(DomainApiError);
    expect(e.status).toBe(504);
  });
});

describe('Resend adapter', () => {
  it('creates, reads and verifies with the admin key', async () => {
    const f = vi.fn(async (url: string) => json(200, { id: 'd1', name: 'Mail.Example.org', status: 'not_started', records: [{ record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: 'p=K', ttl: 'Auto', status: 'not_started' }] }));
    const r = createResendAdapter('re_admin', f as any);
    const d = await r.createDomain('mail.example.org');
    expect(d).toMatchObject({ id: 'd1', name: 'mail.example.org', status: 'not_started' });
    expect(d.records[0].value).toBe('p=K');
    await r.verifyDomain('d1');
    await r.getDomain('d1');
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer re_admin');
    expect((f.mock.calls[1] as any)[0]).toBe('https://api.resend.com/domains/d1/verify');
  });
  it('maps non-2xx to a DomainApiError', async () => {
    const r = createResendAdapter('k', (async () => json(403, { message: 'domain limit reached' })) as any);
    const e = await r.createDomain('x.example.org').catch((x) => x);
    expect(e).toMatchObject({ provider: 'resend', status: 403, message: 'domain limit reached' });
  });
});

describe('configuration', () => {
  it('a missing secret is a 503 NOT_CONFIGURED and never falls back to RESEND_API_KEY', () => {
    process.env.RESEND_API_KEY = 're_send_only';
    expect(() => getResend()).toThrowError(expect.objectContaining({ statusCode: 503, code: 'NOT_CONFIGURED' }));
    expect(() => getVercel()).toThrowError(expect.objectContaining({ statusCode: 503, code: 'NOT_CONFIGURED' }));
    process.env.VERCEL_DOMAINS_TOKEN = 't';
    expect(adapterAvailability()).toEqual({ vercel: false, resend: false }); // team id still missing
    process.env.VERCEL_TEAM_ID = 'team'; process.env.RESEND_ADMIN_KEY = 'k';
    expect(adapterAvailability()).toEqual({ vercel: true, resend: true });
    delete process.env.RESEND_API_KEY;
  });
});
