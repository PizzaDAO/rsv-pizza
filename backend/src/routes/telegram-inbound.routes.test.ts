import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({ party: { update: vi.fn() } }));
const resolveCtx = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const forward = vi.hoisted(() => vi.fn());
const saveWallet = vi.hoisted(() => vi.fn());

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/refundTag.js', () => ({ recomputeRefundTags: vi.fn() }));
vi.mock('../services/hostInboundResolve.js', () => ({ resolveSubmitterContext: resolveCtx, downloadTelegramFile: vi.fn() }));
vi.mock('../services/telegramSend.js', () => ({ sendTelegramMessage: send }));
vi.mock('../services/pizzadaoFollowupInbound.js', () => ({ tryForwardFollowUpReply: forward }));
vi.mock('../services/ocr.service.js', () => ({ analyzeReceipt: vi.fn() }));
vi.mock('../services/fx.service.js', () => ({ convertToUSD: vi.fn() }));
vi.mock('../services/pdfRasterize.js', () => ({ rasterizePdfFirstPage: vi.fn() }));
vi.mock('../services/pizzaCountAutofill.js', () => ({ pizzaAutofillColumns: vi.fn(), receiptUsdTotal: vi.fn() }));
vi.mock('../services/ens.service.js', () => ({
  resolveWalletInput: vi.fn(async (v: string) => v),
  looksLikeEnsName: (v: string) => v.endsWith('.eth'),
}));
vi.mock('../services/payout-snapshot.js', () => ({ saveHostPayoutWallet: saveWallet }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import router from './telegram-inbound.routes.js';

const KEY = 'inbound-secret-0123456789';
const WALLET = '0x' + 'a'.repeat(40);
const party = { id: 'p1', name: 'Test Party', customUrl: 'test', inviteCode: 'abc', date: null, country: 'US', user: { id: 'u1', email: 'h@example.com' } };

const post = (body: Record<string, unknown>) => {
  const a = express();
  a.use(express.json());
  a.use('/api/telegram', router);
  return request(a).post('/api/telegram/host-inbound').set('x-api-key', KEY).send(body);
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_LINK_CALLBACK_SECRET = KEY;
  send.mockResolvedValue({ ok: true });
  forward.mockResolvedValue(null);
});

describe('host-inbound: forwarding unmatched DMs as follow-up replies', () => {
  it('no party: a claimed reply sends only the ack, not the "not sure which event" message', async () => {
    resolveCtx.mockResolvedValue(null);
    forward.mockResolvedValue({ claimed: true, ack: 'Got it' });
    const res = await post({ chatId: 555, kind: 'text', text: 'on it', messageId: 9 });
    expect(res.body).toMatchObject({ ok: true, reason: 'followup-reply' });
    expect(forward).toHaveBeenCalledWith('555', { kind: 'text', text: 'on it', messageId: 9 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('555', 'Got it');
  });
  it('a claimed reply with an empty ack sends nothing', async () => {
    resolveCtx.mockResolvedValue(null);
    forward.mockResolvedValue({ claimed: true, ack: '' });
    await post({ chatId: 555, kind: 'text', text: 'on it' });
    expect(send).not.toHaveBeenCalled();
  });
  it('no party, unclaimed (or timeout/error): the existing reply is sent unchanged', async () => {
    resolveCtx.mockResolvedValue(null);
    const res = await post({ chatId: 555, kind: 'text', text: 'hello' });
    expect(res.body).toMatchObject({ reason: 'no-party' });
    expect(send).toHaveBeenCalledWith('555', expect.stringContaining('not sure which event'));
  });
  it('host: other text is forwarded before the pointer reply; claimed skips it', async () => {
    resolveCtx.mockResolvedValue({ role: 'host', party });
    forward.mockResolvedValue({ claimed: true, ack: 'Thanks' });
    const res = await post({ chatId: 555, kind: 'text', text: 'will do' });
    expect(res.body).toMatchObject({ reason: 'followup-reply' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('555', 'Thanks');
  });
  it('host: unclaimed other text still gets the pointer reply', async () => {
    resolveCtx.mockResolvedValue({ role: 'host', party });
    const res = await post({ chatId: 555, kind: 'text', text: 'will do' });
    expect(res.body).toMatchObject({ reason: 'non-numeric' });
    expect(send).toHaveBeenCalledWith('555', expect.stringContaining('I can add a receipt photo'));
  });
  it('contributor text is forwarded before the host-only rejection', async () => {
    resolveCtx.mockResolvedValue({ role: 'contributor', party, contributorUsername: 'x' });
    forward.mockResolvedValue({ claimed: true, ack: '' });
    expect((await post({ chatId: 555, kind: 'text', text: 'ok' })).body).toMatchObject({ reason: 'followup-reply' });
    forward.mockResolvedValue(null);
    expect((await post({ chatId: 555, kind: 'text', text: 'ok' })).body).toMatchObject({ reason: 'host_only' });
  });
  it('a host headcount number and a wallet are never forwarded', async () => {
    resolveCtx.mockResolvedValue({ role: 'host', party });
    mockPrisma.party.update.mockResolvedValue({});
    expect((await post({ chatId: 555, kind: 'text', text: '40' })).body).toMatchObject({ action: 'attendance' });
    expect((await post({ chatId: 555, kind: 'text', text: WALLET })).body).toMatchObject({ action: 'wallet' });
    expect(forward).not.toHaveBeenCalled();
  });
});
