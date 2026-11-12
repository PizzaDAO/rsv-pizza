import { describe, it, expect, vi, afterEach } from 'vitest';
import { isBcryptHash, hashSecret, verifySecret, secretForWrite, redactPartySecrets } from './secretHash.js';

describe('secretHash', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hashSecret produces a bcrypt hash that isBcryptHash recognises', async () => {
    const h = await hashSecret('cowabunga');
    expect(isBcryptHash(h)).toBe(true);
    expect(h).not.toContain('cowabunga');
    expect(h.startsWith('$2')).toBe(true);
  });

  it('isBcryptHash rejects plaintext, nulls and near-misses', () => {
    expect(isBcryptHash('cowabunga')).toBe(false);
    expect(isBcryptHash('')).toBe(false);
    expect(isBcryptHash(null)).toBe(false);
    expect(isBcryptHash(undefined)).toBe(false);
    expect(isBcryptHash('$2b$10$tooShort')).toBe(false);
  });

  it('verifySecret accepts the right password against a hash and rejects a wrong one', async () => {
    const h = await hashSecret('cowabunga');
    expect(await verifySecret(h, 'cowabunga')).toBe(true);
    expect(await verifySecret(h, 'Cowabunga')).toBe(false);
    expect(await verifySecret(h, '')).toBe(false);
  });

  it('verifySecret falls back to a constant-time compare for legacy plaintext and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await verifySecret('legacy-pw', 'legacy-pw')).toBe(true);
    expect(await verifySecret('legacy-pw', 'legacy-pX')).toBe(false);
    expect(await verifySecret('legacy-pw', 'legacy-pw-longer')).toBe(false);
    expect(warn).toHaveBeenCalledWith('[secretHash] legacy plaintext compare');
    // The log line never carries the secret.
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain('legacy-pw');
  });

  it('verifySecret never matches when nothing is stored', async () => {
    expect(await verifySecret(null, '')).toBe(false);
    expect(await verifySecret(undefined, 'x')).toBe(false);
    expect(await verifySecret('', '')).toBe(false);
  });

  it('secretForWrite: undefined keeps, null/empty clears, string hashes', async () => {
    expect(await secretForWrite(undefined)).toBeUndefined();
    expect(await secretForWrite(null)).toBeNull();
    expect(await secretForWrite('')).toBeNull();
    const h = await secretForWrite('pw');
    expect(isBcryptHash(h)).toBe(true);
    expect(await verifySecret(h as string, 'pw')).toBe(true);
  });

  it('redactPartySecrets swaps secrets for flags and leaves absent keys absent', () => {
    const out = redactPartySecrets({ id: 'p', password: 'x', reportPassword: null, name: 'n' }) as any;
    expect(out).toEqual({ id: 'p', name: 'n', hasPassword: true, hasReportPassword: false });
    expect('password' in out).toBe(false);
    expect('reportPassword' in out).toBe(false);
    expect('hasVenueReportPassword' in out).toBe(false);
    expect(redactPartySecrets(null)).toBeNull();
  });
});
