import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({ appConfig: { findUnique: vi.fn() } }));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import { lookupNametagMembers, nametagBaseUrl, sanitizeMember, DEFAULT_NAMETAG_URL } from './pizzadaoNametags.js';

const H = 'a'.repeat(64);
const W = '0x' + '1'.repeat(40);
const env = { PIZZADAO_NAMETAG_KEY: 'secret-key-value' } as NodeJS.ProcessEnv;
const okBody = (matches: unknown[]) => ({ ok: true, json: async () => ({ ok: true, matches }) }) as Response;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.appConfig.findUnique.mockResolvedValue(null);
});

describe('sanitizeMember', () => {
  it('keeps only known typed fields and requires an http(s) picture', () => {
    const m = sanitizeMember({ memberId: '5', name: 'Pat', pfpUrl: 'https://i.example/p.png', city: 'Austin', email: 'leak@example.com', levelCompleted: 3, levelTitle: 'Chef', crews: [{ id: 'a', label: 'A', extra: 1 }] });
    expect(m).toEqual({ memberId: '5', name: 'Pat', pfpUrl: 'https://i.example/p.png', city: 'Austin', levelCompleted: 3, levelTitle: 'Chef', crews: [{ id: 'a', label: 'A' }] });
    expect(sanitizeMember({ memberId: '5', name: 'Pat', pfpUrl: 'javascript:alert(1)' })).toBeNull();
    expect(sanitizeMember({ name: 'No id', pfpUrl: 'https://i.example/p.png' })).toBeNull();
  });
});

describe('nametagBaseUrl', () => {
  it('env wins, then app_config, then the default; non-https is ignored', async () => {
    expect(await nametagBaseUrl({ PIZZADAO_NAMETAG_URL: 'https://preview.example.com/' } as NodeJS.ProcessEnv)).toBe('https://preview.example.com');
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify('https://cfg.example.com') });
    expect(await nametagBaseUrl({} as NodeJS.ProcessEnv)).toBe('https://cfg.example.com');
    expect(await nametagBaseUrl({ PIZZADAO_NAMETAG_URL: 'http://evil.example.com' } as NodeJS.ProcessEnv)).toBe(DEFAULT_NAMETAG_URL);
  });
});

describe('lookupNametagMembers', () => {
  it('is null without a key and makes no request', async () => {
    const f = vi.fn();
    expect(await lookupNametagMembers({ emailHashes: [H], wallets: [] }, { maxIdentifiers: 10, fetchImpl: f as never, env: {} as NodeJS.ProcessEnv })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('sends hashes in the body with a bearer key (never in the URL) and returns sanitized matches', async () => {
    const f = vi.fn().mockResolvedValue(okBody([{ emailHash: H, member: { memberId: '1', name: 'Pat', pfpUrl: 'https://i.example/p.png' } }, { emailHash: 'bad', member: { memberId: '2', name: 'X', pfpUrl: 'https://i.example/p.png' } }]));
    const r = await lookupNametagMembers({ emailHashes: [H], wallets: [W] }, { maxIdentifiers: 10, fetchImpl: f as never, env });
    expect(r).toEqual([{ emailHash: H, member: { memberId: '1', name: 'Pat', pfpUrl: 'https://i.example/p.png' } }]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://pizzadao.org/api/service/nametag-members');
    expect(String(url)).not.toContain(H);
    expect(init.headers.Authorization).toBe('Bearer secret-key-value');
    expect(JSON.parse(init.body)).toEqual({ emailHashes: [H], wallets: [W] });
  });
  it('chunks to maxIdentifiers', async () => {
    const hashes = Array.from({ length: 25 }, (_, i) => String(i).padStart(64, '0'));
    const f = vi.fn().mockResolvedValue(okBody([]));
    await lookupNametagMembers({ emailHashes: hashes, wallets: [] }, { maxIdentifiers: 10, fetchImpl: f as never, env });
    expect(f).toHaveBeenCalledTimes(3);
    expect(JSON.parse(f.mock.calls[2][1].body).emailHashes).toHaveLength(5);
  });
  it('returns null (never throws, logs no identifiers) on bad status, bad body or network error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = [vi.fn().mockResolvedValue({ ok: false, status: 503 }), vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) }), vi.fn().mockRejectedValue(new Error(`boom ${H}`))];
    for (const f of bad) expect(await lookupNametagMembers({ emailHashes: [H], wallets: [] }, { maxIdentifiers: 10, fetchImpl: f as never, env })).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(H);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-key-value');
    warn.mockRestore();
  });
});
