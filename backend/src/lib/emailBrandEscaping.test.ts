import { describe, it, expect, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('../config/database.js', () => ({ prisma: {} }));
vi.mock('./resendSend.js', () => ({ sendBrandedEmail: (...a: any[]) => send(...a) }));
vi.mock('../config/secrets.js', () => ({ getJwtSecret: () => 'test-secret' }));

import { escapeHtml } from './escapeHtml.js';
import { sendMagicLinkEmail } from './loginCode.js';
import { renderUnsubscribePage, buildReminderHtml } from '../routes/reminder.routes.js';

const EVIL = '"><img src=x onerror=alert(1)>';

describe('escapeHtml', () => {
  it('escapes the five HTML specials and leaves plain text alone', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
    expect(escapeHtml('Team1 Pizza')).toBe('Team1 Pizza');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('brand name in emails is escaped', () => {
  it('login code email (title and heading)', async () => {
    send.mockResolvedValue({ ok: true, json: async () => ({ id: "e1" }) });
    await sendMagicLinkEmail('u@example.org', 'https://x.example.org/auth', '123456', 'k', {
      url: 'https://x.example.org', name: EVIL, fromEmail: 'X <noreply@example.org>',
    });
    const html: string = send.mock.calls[0][0].payload.html;
    expect(html).not.toContain('<img');
    expect(html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g)).toHaveLength(2);
  });

  it('login code email for an ordinary name is unchanged', async () => {
    send.mockClear();
    send.mockResolvedValue({ ok: true, json: async () => ({ id: "e1" }) });
    await sendMagicLinkEmail('u@example.org', 'https://x.example.org/auth', '123456', 'k', {
      url: 'https://x.example.org', name: 'Team1 Pizza', fromEmail: 'X <noreply@example.org>',
    });
    const html: string = send.mock.calls[0][0].payload.html;
    expect(html).toContain('<title>Sign In to Team1 Pizza</title>');
    expect(html).toContain('🍕 Sign In to Team1 Pizza</h1>');
  });

  it('unsubscribe page back link', () => {
    const html = renderUnsubscribePage('T', 'M', true, { url: 'https://x.example.org', name: EVIL });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('reminder email footer', () => {
    const html = buildReminderHtml({
      guestName: 'G', whenText: 'w', addressText: 'a', partyName: 'P', eventUrl: 'https://x.example.org/e',
      unsubUrl: 'https://x.example.org/u', venueName: null, address: null, imageUrl: null, siteName: EVIL,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
