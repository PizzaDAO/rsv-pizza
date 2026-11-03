import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tryForwardFollowUpReply, followupInboundEnabled, fallbackExternalKey } from './pizzadaoFollowupInbound.js';

const env = {
  PIZZADAO_FOLLOWUP_INBOUND_ENABLED: '1',
  PIZZADAO_FOLLOWUP_INBOUND_KEY: 'test-inbound-key-0123456789',
} as unknown as NodeJS.ProcessEnv;

const ok = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 300, status, json: async () => body } as any);

describe('tryForwardFollowUpReply', () => {
  it('claimed: returns the ack and posts with the bearer key and a message-id key', async () => {
    const f = vi.fn(() => ok({ claimed: true, ack: 'Got it' }));
    const r = await tryForwardFollowUpReply('555', { kind: 'text', text: ' on it ', messageId: 42 }, { fetchImpl: f as any, env });
    expect(r).toEqual({ claimed: true, ack: 'Got it' });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://app.pizzadao.org/api/followups/inbound');
    expect(init.headers.Authorization).toBe('Bearer test-inbound-key-0123456789');
    expect(JSON.parse(init.body)).toEqual({ senderId: '555', kind: 'text', text: 'on it', externalKey: 'telegram:555:42' });
  });
  it('uses PIZZADAO_FOLLOWUP_INBOUND_URL when set', async () => {
    const f = vi.fn(() => ok({ claimed: false }));
    await tryForwardFollowUpReply('555', { kind: 'text', text: 'hi' }, { fetchImpl: f as any, env: { ...env, PIZZADAO_FOLLOWUP_INBOUND_URL: 'https://example.com/in' } as any });
    expect((f.mock.calls[0] as any)[0]).toBe('https://example.com/in');
  });
  it('without a message id the key is stable within a minute and differs for other text', async () => {
    const now = Date.UTC(2026, 10, 10, 12, 0, 5);
    const a = await fallbackExternalKey('555', 'hi', now);
    expect(a).toBe(await fallbackExternalKey('555', 'hi', now + 20000));
    expect(a).not.toBe(await fallbackExternalKey('555', 'hello', now));
    expect(a).not.toBe(await fallbackExternalKey('555', 'hi', now + 61000));
    expect(a.length).toBeLessThanOrEqual(120);
  });
  it('unclaimed, HTTP error, bad JSON, timeout and network error all return null', async () => {
    for (const f of [
      vi.fn(() => ok({ claimed: false })),
      vi.fn(() => ok({}, 500)),
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad'); } } as any)),
      vi.fn(() => Promise.reject(new DOMException('timeout', 'TimeoutError'))),
      vi.fn(() => Promise.reject(new Error('net'))),
    ]) {
      expect(await tryForwardFollowUpReply('555', { kind: 'text', text: 'hi' }, { fetchImpl: f as any, env })).toBeNull();
    }
  });
  it('is off without the flag or the key, and never calls out', async () => {
    const f = vi.fn(() => ok({ claimed: true, ack: '' }));
    expect(followupInboundEnabled({} as any)).toBe(false);
    expect(await tryForwardFollowUpReply('555', { kind: 'text', text: 'hi' }, { fetchImpl: f as any, env: { ...env, PIZZADAO_FOLLOWUP_INBOUND_ENABLED: '0' } as any })).toBeNull();
    expect(await tryForwardFollowUpReply('555', { kind: 'text', text: 'hi' }, { fetchImpl: f as any, env: { PIZZADAO_FOLLOWUP_INBOUND_ENABLED: '1' } as any })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('never forwards group chats (negative ids) or commands', async () => {
    const f = vi.fn(() => ok({ claimed: true, ack: '' }));
    expect(await tryForwardFollowUpReply('-100123', { kind: 'text', text: 'hi' }, { fetchImpl: f as any, env })).toBeNull();
    expect(await tryForwardFollowUpReply('555', { kind: 'text', text: '/start' }, { fetchImpl: f as any, env })).toBeNull();
    expect(await tryForwardFollowUpReply('555', { kind: 'text', text: '   ' }, { fetchImpl: f as any, env })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('a photo is forwarded without bytes', async () => {
    const f = vi.fn(() => ok({ claimed: true, ack: '' }));
    expect(await tryForwardFollowUpReply('555', { kind: 'photo' }, { fetchImpl: f as any, env })).toEqual({ claimed: true, ack: '' });
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toMatchObject({ senderId: '555', kind: 'photo' });
    expect((f.mock.calls[0] as any)[1].body).not.toMatch(/imageBase64|fileId/);
  });
  it('does not touch Telegram updates or webhooks, and never logs', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(dir, 'pizzadaoFollowupInbound.ts'), 'utf8');
    expect(src).not.toMatch(/setWebhook|deleteWebhook|getUpdates|setMyCommands|setdomain/i);
    expect(src).not.toMatch(/console\./);
  });
});
