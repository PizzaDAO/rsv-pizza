/**
 * White-label links that used to be hardcoded to the deploy origin: payout nudges, NFT metadata,
 * payout / host-telegram emails. A branded series' party points at its own site (and sender);
 * everything else is byte-identical to before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  prisma: {
    eventSeries: { findMany: vi.fn() },
    payout: { findUnique: vi.fn() },
    party: { findUnique: vi.fn() },
    guest: { findFirst: vi.fn() },
  },
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
// nft.routes builds its own PrismaClient.
vi.mock('@prisma/client', async (orig) => {
  const actual: any = await orig();
  return { ...actual, PrismaClient: function PrismaClient() { return m.prisma; } };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { _resetSiteBrandCache } from '../lib/siteBrand.js';
import { buildReminderCopy, reminderSiteHost } from './admin-payout.routes.js';
import nftRoutes from './nft.routes.js';
import { emailHostOfPaymentExecution } from '../services/payoutEmailNotify.js';
import { sendBroadcastFallbackEmail } from '../services/hostTelegramEmail.js';

const SERIES = {
  id: 'series-t1',
  slug: 'team1',
  siteUrl: 'https://team1.rsv.pizza',
  brandName: 'Team1 Pizza',
  displayName: 'Team1',
  name: 'Team1 Pizza Parties',
};
const ADDR = '0x' + 'a'.repeat(40);
const resendCalls = () => mockFetch.mock.calls.filter((c) => c[0] === 'https://api.resend.com/emails').map((c) => JSON.parse(c[1].body));

beforeEach(() => {
  vi.clearAllMocks();
  _resetSiteBrandCache();
  process.env.RESEND_API_KEY = 're_test';
  m.prisma.eventSeries.findMany.mockResolvedValue([SERIES]);
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'r1' }), text: async () => '', headers: new Headers() });
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe('payout nudge copy', () => {
  it('default host keeps the exact current text', () => {
    const c = buildReminderCopy('photos', 'my-party', null);
    expect(c.dmText).toBe("Make sure you've uploaded your event photos! Just reply here with them or upload them to rsv.pizza/my-party");
    expect(buildReminderCopy('wallet', 'p', null).dmText).toBe(
      "We need your payout wallet to reimburse you! Just reply here with it or add it at rsv.pizza/host/p/payments",
    );
    const g = buildReminderCopy('receipts', 'p', 'https://t.me/bot?start=x');
    expect(g.groupText).toContain('upload them to rsv.pizza/p');
    expect(g.groupHtml).toBe(true);
  });

  it('a branded host is pointed at the series site for every nudge type', () => {
    for (const type of ['photos', 'receipts', 'attendance', 'wallet'] as const) {
      const c = buildReminderCopy(type, 'my-party', 'https://t.me/bot?start=x', 'team1.rsv.pizza');
      expect(c.dmText).toContain('team1.rsv.pizza/');
      expect(c.groupText).toContain('team1.rsv.pizza/');
      expect(c.dmText).not.toMatch(/(^|\s)rsv\.pizza\//); // no bare rsv.pizza link left
    }
    expect(buildReminderCopy('wallet', 'p', null, 'team1.rsv.pizza').dmText).toContain('team1.rsv.pizza/host/p/payments');
  });

  it('reminderSiteHost resolves the series host, or rsv.pizza when unbranded', async () => {
    expect(await reminderSiteHost({ eventSeriesId: 'series-t1' })).toBe('team1.rsv.pizza');
    expect(await reminderSiteHost({ eventSeriesId: null })).toBe('rsv.pizza');
    expect(await reminderSiteHost({ eventSeriesId: 'unknown-series' })).toBe('rsv.pizza');
  });
});

describe('GET /api/nft/metadata external_url', () => {
  const app = () => {
    const a = express();
    a.use('/api/nft', nftRoutes);
    return a;
  };
  const party = (eventSeriesId: string | null) => ({
    name: 'P', eventImageUrl: null, date: null, venueName: null, address: null, customUrl: 'my-party', inviteCode: 'abc', eventSeriesId,
  });

  it('branded party: the series origin', async () => {
    m.prisma.party.findUnique.mockResolvedValue(party('series-t1'));
    m.prisma.guest.findFirst.mockResolvedValue(null);
    const res = await request(app()).get(`/api/nft/metadata/p1/${ADDR}`);
    expect(res.status).toBe(200);
    expect(res.body.external_url).toBe('https://team1.rsv.pizza/my-party');
  });

  it('unbranded party: exactly https://rsv.pizza/<slug> as before', async () => {
    m.prisma.party.findUnique.mockResolvedValue(party(null));
    m.prisma.guest.findFirst.mockResolvedValue(null);
    const res = await request(app()).get(`/api/nft/metadata/p1/${ADDR}`);
    expect(res.body.external_url).toBe('https://rsv.pizza/my-party');
  });
});

describe('payout email (emailHostOfPaymentExecution)', () => {
  const payout = (eventSeriesId: string | null) => ({
    finalAmountUsd: 25, payoutMethod: 'wire',
    party: { name: 'Global Pizza Party Austin', customUrl: 'austin', inviteCode: 'abc', eventSeriesId },
    host: { email: 'host@example.com', name: 'Hal' },
  });

  it('branded party: link on the series site, sent from the series sender', async () => {
    m.prisma.payout.findUnique.mockResolvedValue(payout('series-t1'));
    await emailHostOfPaymentExecution('po1', 'paid');
    const [body] = resendCalls();
    expect(body.from).toBe('Team1 Pizza <noreply@rsv.pizza>');
    expect(body.html).toContain('href="https://team1.rsv.pizza/host/austin/payments"');
    expect(body.to).toBe('host@example.com');
  });

  it('unbranded party: byte-identical link and sender', async () => {
    m.prisma.payout.findUnique.mockResolvedValue(payout(null));
    await emailHostOfPaymentExecution('po1', 'paid');
    const [body] = resendCalls();
    expect(body.from).toBe('RSV.Pizza <noreply@rsv.pizza>');
    expect(body.html).toContain('href="https://rsv.pizza/host/austin/payments"');
    expect(Object.keys(body)).toEqual(['from', 'to', 'subject', 'html']);
  });
});

describe('host telegram fallback email', () => {
  const args = { toEmail: 'h@example.com', hostName: 'Hal', cityName: 'Austin', message: 'hi' };

  it('branded party: series sender', async () => {
    expect(await sendBroadcastFallbackEmail({ ...args, party: { eventSeriesId: 'series-t1' } })).toBe(true);
    expect(resendCalls()[0].from).toBe('Team1 Pizza <noreply@rsv.pizza>');
  });

  it('no party / unbranded: the deploy-level sender, same body shape', async () => {
    await sendBroadcastFallbackEmail(args);
    await sendBroadcastFallbackEmail({ ...args, party: { eventSeriesId: null } });
    for (const b of resendCalls()) {
      expect(b.from).toBe('RSV.Pizza <noreply@rsv.pizza>');
      expect(Object.keys(b)).toEqual(['from', 'to', 'subject', 'html']);
    }
  });
});
