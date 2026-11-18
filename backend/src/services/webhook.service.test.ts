import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  apiKey: { findMany: vi.fn() },
  webhook: { update: vi.fn(async () => ({})), findUnique: vi.fn() },
  webhookDelivery: { create: vi.fn(async () => ({ id: 'd1' })), update: vi.fn(async () => ({})) },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../middleware/apiKey.js', () => ({ createWebhookSignature: () => 'sig' }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { triggerWebhook, sendTestWebhook } from './webhook.service.js';

function hookTo(url: string) {
  mockPrisma.apiKey.findMany.mockResolvedValue([
    { webhooks: [{ id: 'w1', url, secret: 's', failCount: 0 }] },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('webhook delivery SSRF guard', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/admin',
    'http://[::1]/',
    'http://10.0.0.5/hook',
    'http://localhost/hook',
    'file:///etc/passwd',
  ])('never fetches %s', async (url) => {
    hookTo(url);
    await triggerWebhook('guest.registered', { guest: { id: 'g' } }, 'owner-1');
    expect(mockFetch).not.toHaveBeenCalled();
    // recorded as a failed delivery, without burning the retry schedule
    expect(mockPrisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed', attempts: 1 }) }),
    );
  });

  it('delivers to a public https endpoint, without following redirects', async () => {
    hookTo('https://93.184.216.34/hook');
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    await triggerWebhook('guest.registered', { guest: { id: 'g' } }, 'owner-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual', method: 'POST' });
  });

  it('stores only a short, truncated response body', async () => {
    hookTo('https://93.184.216.34/hook');
    mockFetch.mockResolvedValue(new Response('A'.repeat(200_000), { status: 200 }));
    await triggerWebhook('guest.registered', { guest: { id: 'g' } }, 'owner-1');
    const data = (mockPrisma.webhookDelivery.update.mock.calls as any[][])[0][0].data;
    expect(data.status).toBe('success');
    expect(data.responseBody.length).toBeLessThanOrEqual(500);
  });

  it('singleAttempt makes exactly one fetch and records one attempt on failure', async () => {
    hookTo('https://93.184.216.34/hook');
    mockFetch.mockResolvedValue(new Response('no', { status: 500 }));
    await triggerWebhook('guest.registered', { guest: { id: 'g' } }, 'owner-1', { singleAttempt: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockPrisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed', attempts: 1 }) }),
    );
  });

  it('the test-webhook endpoint is guarded too', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({ id: 'w1', url: 'http://169.254.169.254/', secret: 's' });
    const r = await sendTestWebhook('w1');
    expect(r.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
