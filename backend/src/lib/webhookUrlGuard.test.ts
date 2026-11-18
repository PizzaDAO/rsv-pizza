import { describe, it, expect } from 'vitest';
import { isBlockedIp, assertPublicWebhookUrl, BlockedWebhookUrlError, readTruncatedBody } from './webhookUrlGuard.js';

const pub = async () => [{ address: '93.184.216.34' }];

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', 'ff02::1', 'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('assertPublicWebhookUrl', () => {
  it('accepts a public https host', async () => {
    await expect(assertPublicWebhookUrl('https://hooks.example.org/x', pub)).resolves.toBeUndefined();
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicWebhookUrl('file:///etc/passwd', pub)).rejects.toBeInstanceOf(BlockedWebhookUrlError);
    await expect(assertPublicWebhookUrl('ftp://hooks.example.org/', pub)).rejects.toBeInstanceOf(BlockedWebhookUrlError);
  });

  it('rejects metadata, loopback and private literals', async () => {
    for (const u of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:3000/', 'http://[::1]/', 'http://10.0.0.5/', 'http://localhost/', 'http://x.localhost/']) {
      await expect(assertPublicWebhookUrl(u, pub)).rejects.toBeInstanceOf(BlockedWebhookUrlError);
    }
  });

  it('rejects a hostname resolving to a private address, even if another record is public', async () => {
    const mixed = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.7' }];
    await expect(assertPublicWebhookUrl('https://rebind.example.org/', mixed)).rejects.toBeInstanceOf(BlockedWebhookUrlError);
  });

  it('rejects unresolvable hosts and embedded credentials', async () => {
    const fail = async () => { throw new Error('ENOTFOUND'); };
    await expect(assertPublicWebhookUrl('https://nope.example.org/', fail)).rejects.toBeInstanceOf(BlockedWebhookUrlError);
    await expect(assertPublicWebhookUrl('https://u:p@hooks.example.org/', pub)).rejects.toBeInstanceOf(BlockedWebhookUrlError);
  });
});

describe('readTruncatedBody', () => {
  it('caps the stored body', async () => {
    const res = new Response('x'.repeat(100_000));
    const out = await readTruncatedBody(res, 500);
    expect(out.length).toBe(500);
  });
  it('returns short bodies whole', async () => {
    expect(await readTruncatedBody(new Response('ok'), 500)).toBe('ok');
  });
});
