import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Minimal in-memory stand-in for the pizzadao_service_sends table.
const store = vi.hoisted(() => new Map<string, any>());

const mockPrisma = vi.hoisted(() => ({
  cityTelegramGroup: { findMany: vi.fn() },
  pizzadaoServiceSend: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
const mockSendToCityGroup = vi.hoisted(() => vi.fn());

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/cityTelegramGroup.js', () => ({ sendToCityGroup: mockSendToCityGroup }));

import router, { resetCityFloor, resetDirectoryCache } from './service-telegram.routes.js';
import { Prisma } from '@prisma/client';
import { errorHandler } from '../middleware/error.js';

const KEY = 'test-telegram-key-0123456789abcdef';
const fetchMock = vi.fn();

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/service/telegram', router);
  a.use(errorHandler);
  return a;
}

const post = (route: string, body: unknown, key: string | null = KEY) => {
  const r = request(app()).post(`/api/service/telegram${route}`);
  if (key !== null) r.set('x-pizzadao-telegram-key', key);
  return r.send(body as object);
};

const tgJson = (body: unknown, status = 200) =>
  Promise.resolve({ status, ok: status < 300, json: async () => body } as any);

let seq = 0;
const dmBody = (over: Record<string, unknown> = {}) => ({
  telegramUserId: '12345',
  text: 'hello',
  idempotencyKey: `dm-key-${++seq}-aaaa`,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  resetCityFloor();
  resetDirectoryCache();
  process.env.PIZZADAO_TELEGRAM_SERVICE_KEY = KEY;
  process.env.PIZZADAO_TELEGRAM_DM_ENABLED = '1';
  process.env.PIZZADAO_TELEGRAM_GROUPS_ENABLED = '1';
  process.env.PIZZADAO_TELEGRAM_BUTTON_HOSTS = 'app.example.org';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(() => tgJson({ ok: true, result: { message_id: 77 } }));

  mockPrisma.pizzadaoServiceSend.findUnique.mockImplementation(async ({ where }: any) => store.get(where.idempotencyKey) ?? null);
  mockPrisma.pizzadaoServiceSend.create.mockImplementation(async ({ data }: any) => {
    if (store.has(data.idempotencyKey)) {
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    }
    store.set(data.idempotencyKey, { messageId: null, code: null, ...data });
    return data;
  });
  mockPrisma.pizzadaoServiceSend.update.mockImplementation(async ({ where, data }: any) => {
    store.set(where.idempotencyKey, { ...store.get(where.idempotencyKey), ...data });
  });
  mockPrisma.pizzadaoServiceSend.updateMany.mockImplementation(async ({ where, data }: any) => {
    const row = store.get(where.idempotencyKey);
    if (row && row.status === where.status && row.code === where.code) {
      store.set(where.idempotencyKey, { ...row, ...data });
      return { count: 1 };
    }
    return { count: 0 };
  });
  mockPrisma.pizzadaoServiceSend.delete.mockImplementation(async ({ where }: any) => {
    store.delete(where.idempotencyKey);
  });
  mockPrisma.pizzadaoServiceSend.deleteMany.mockResolvedValue({ count: 0 });
  mockSendToCityGroup.mockResolvedValue({ ok: true, chatId: '-100', messageId: 5 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth and flags', () => {
  it('503 when the service key is unset', async () => {
    delete process.env.PIZZADAO_TELEGRAM_SERVICE_KEY;
    const res = await post('/dm', dmBody());
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('not configured');
  });
  it('401 on a missing or wrong key', async () => {
    expect((await post('/dm', dmBody(), null)).status).toBe(401);
    expect((await post('/dm', dmBody(), 'nope')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('503 disabled when a per-part flag is unset', async () => {
    delete process.env.PIZZADAO_TELEGRAM_DM_ENABLED;
    const res = await post('/dm', dmBody());
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('disabled');
    expect((await post('/probe', { telegramUserId: '1' })).status).toBe(503);
    delete process.env.PIZZADAO_TELEGRAM_GROUPS_ENABLED;
    expect((await post('/city-post', { cityKey: 'x', text: 't', idempotencyKey: 'abcdefgh' })).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sets no-store', async () => {
    const res = await post('/dm', dmBody());
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('POST /dm validation', () => {
  it.each([
    ['negative id', { telegramUserId: '-100123' }],
    ['non-numeric id', { telegramUserId: 'abc' }],
    ['zero id', { telegramUserId: '0' }],
    ['oversize text', { text: 'x'.repeat(3501) }],
    ['empty text', { text: '  ' }],
    ['bad key', { idempotencyKey: 'short' }],
    ['http button', { buttons: [[{ text: 'a', url: 'http://app.example.org/x' }]] }],
    ['foreign button host', { buttons: [[{ text: 'a', url: 'https://evil.example.com/x' }]] }],
    ['4 rows', { buttons: [0, 1, 2, 3].map(() => [{ text: 'a', url: 'https://app.example.org/' }]) }],
    ['4 per row', { buttons: [[0, 1, 2, 3].map(() => ({ text: 'a', url: 'https://app.example.org/' }))] }],
  ])('400 on %s', async (_n, over) => {
    const res = await post('/dm', dmBody(over));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects all buttons when no hosts are configured', async () => {
    delete process.env.PIZZADAO_TELEGRAM_BUTTON_HOSTS;
    const res = await post('/dm', dmBody({ buttons: [[{ text: 'a', url: 'https://app.example.org/' }]] }));
    expect(res.status).toBe(400);
  });
});

describe('POST /dm sending', () => {
  it('sends plain text with url buttons and no parse_mode', async () => {
    const res = await post(
      '/dm',
      dmBody({ buttons: [[{ text: 'Open', url: 'https://app.example.org/fu/abc' }]] }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, messageId: 77 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/sendMessage');
    const sent = JSON.parse(init.body);
    expect(sent.chat_id).toBe('12345');
    expect(sent.parse_mode).toBeUndefined();
    expect(sent.disable_web_page_preview).toBe(true);
    expect(sent.reply_markup.inline_keyboard[0][0].url).toBe('https://app.example.org/fu/abc');
  });

  it.each([
    [400, 'Bad Request: chat not found', 'not_started'],
    [403, "Forbidden: bot can't initiate conversation with a user", 'not_started'],
    [403, 'Forbidden: bot was blocked by the user', 'blocked'],
    [403, 'Forbidden: user is deactivated', 'blocked'],
    [400, 'Bad Request: something else', 'bad_request'],
    [500, 'Internal', 'uncertain'],
  ])('maps %s %s -> %s', async (status, description, code) => {
    fetchMock.mockImplementation(() => tgJson({ ok: false, error_code: status, description }, status));
    const res = await post('/dm', dmBody());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, code });
  });

  it('maps 429 with retryAfter', async () => {
    fetchMock.mockImplementation(() =>
      tgJson({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 12 } }, 429),
    );
    const res = await post('/dm', dmBody());
    expect(res.body).toEqual({ ok: false, code: 'rate_limited', retryAfter: 12 });
  });

  it('maps a network error to uncertain', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const res = await post('/dm', dmBody());
    expect(res.body).toEqual({ ok: false, code: 'uncertain' });
  });

  it('503 and no stored key when the bot token is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const body = dmBody();
    const res = await post('/dm', body);
    expect(res.status).toBe(503);
    expect(store.has(body.idempotencyKey)).toBe(false);
  });

  it('replays a stored result without a second fetch', async () => {
    const body = dmBody();
    expect((await post('/dm', body)).body).toEqual({ ok: true, messageId: 77 });
    const again = await post('/dm', body);
    expect(again.body).toEqual({ ok: true, messageId: 77, replay: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replays an uncertain outcome as uncertain, never re-sending', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const body = dmBody();
    await post('/dm', body);
    fetchMock.mockClear();
    const again = await post('/dm', body);
    expect(again.body).toEqual({ ok: false, code: 'uncertain', replay: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a retry of the same key after rate_limited', async () => {
    fetchMock.mockImplementationOnce(() =>
      tgJson({ ok: false, error_code: 429, description: 'x', parameters: { retry_after: 1 } }, 429),
    );
    const body = dmBody();
    expect((await post('/dm', body)).body.code).toBe('rate_limited');
    const again = await post('/dm', body);
    expect(again.body).toEqual({ ok: true, messageId: 77 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('409 when a key is reused for a different target', async () => {
    const body = dmBody();
    await post('/dm', body);
    const res = await post('/dm', { ...body, telegramUserId: '999' });
    expect(res.status).toBe(409);
  });
});

describe('POST /probe', () => {
  it('reachable on success, sending a typing action', async () => {
    fetchMock.mockImplementation(() => tgJson({ ok: true, result: true }));
    const res = await post('/probe', { telegramUserId: '12345' });
    expect(res.body).toEqual({ ok: true, reachable: true });
    expect(fetchMock.mock.calls[0][0]).toContain('/sendChatAction');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe('typing');
  });
  it('maps failures to codes', async () => {
    fetchMock.mockImplementation(() =>
      tgJson({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403),
    );
    const res = await post('/probe', { telegramUserId: '12345' });
    expect(res.body).toEqual({ ok: true, reachable: false, code: 'blocked' });
  });
  it('400 on a negative id', async () => {
    expect((await post('/probe', { telegramUserId: '-5' })).status).toBe(400);
  });
});

describe('POST /city-post', () => {
  const cp = (over: Record<string, unknown> = {}) => ({
    cityKey: '  Test City ',
    text: 'hi',
    idempotencyKey: `city-key-${++seq}-aaaa`,
    ...over,
  });

  it('normalises the city key and calls sendToCityGroup', async () => {
    mockSendToCityGroup.mockResolvedValue({ ok: true, migratedTo: '-200', messageId: 9 });
    const res = await post('/city-post', cp());
    expect(res.body).toEqual({ ok: true, messageId: 9, migratedTo: '-200' });
    expect(mockSendToCityGroup).toHaveBeenCalledWith('test city', 'hi');
  });

  it('maps skipped to no_group', async () => {
    mockSendToCityGroup.mockResolvedValue({ ok: false, skipped: true, reason: 'no city TG group set' });
    expect((await post('/city-post', cp())).body).toEqual({ ok: false, code: 'no_group' });
  });

  it.each([
    [{ ok: false, errorCode: 403, reason: 'Forbidden: bot was kicked from the group chat' }, 'kicked'],
    [{ ok: false, errorCode: 400, reason: 'Bad Request: whatever' }, 'bad_request'],
    [{ ok: false, reason: 'Network error' }, 'uncertain'],
  ])('maps %j -> %s', async (result, code) => {
    mockSendToCityGroup.mockResolvedValue(result);
    expect((await post('/city-post', cp())).body.code).toBe(code);
  });

  it('maps 429 with retryAfter', async () => {
    mockSendToCityGroup.mockResolvedValue({ ok: false, errorCode: 429, reason: 'x', retryAfter: 7 });
    expect((await post('/city-post', cp())).body).toEqual({ ok: false, code: 'rate_limited', retryAfter: 7 });
  });

  it('replays by idempotency key', async () => {
    const body = cp();
    await post('/city-post', body);
    const again = await post('/city-post', body);
    expect(again.body.replay).toBe(true);
    expect(mockSendToCityGroup).toHaveBeenCalledTimes(1);
  });

  it('enforces the per-city floor (min gap, then 10/min) without sending', async () => {
    expect((await post('/city-post', cp())).body.ok).toBe(true);
    const second = await post('/city-post', cp());
    expect(second.body.code).toBe('rate_limited');
    expect(second.body.retryAfter).toBeGreaterThan(0);
    expect(mockSendToCityGroup).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      resetCityFloor();
      for (let i = 0; i < 10; i++) {
        vi.setSystemTime(Date.now() + 5_100);
        // 10 posts spaced 5.1s apart fit in 51s < 60s
        expect((await post('/city-post', cp({ cityKey: 'busy' }))).body.ok).toBe(true);
      }
      vi.setSystemTime(Date.now() + 5_100);
      expect((await post('/city-post', cp({ cityKey: 'busy' }))).body.code).toBe('rate_limited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('400 on a bad city key or oversize text', async () => {
    expect((await post('/city-post', cp({ cityKey: '' }))).status).toBe(400);
    expect((await post('/city-post', cp({ cityKey: 'x'.repeat(81) }))).status).toBe(400);
    expect((await post('/city-post', cp({ text: 'x'.repeat(3501) }))).status).toBe(400);
  });
});

describe('GET /city-groups', () => {
  it('returns the directory without chat ids, cached', async () => {
    mockPrisma.cityTelegramGroup.findMany.mockResolvedValue([
      { cityKey: 'a', title: 'A', country: 'X', region: 'r', chatUrl: 'https://t.me/a', chatId: BigInt(-1001234) },
      { cityKey: 'b', title: null, country: null, region: null, chatUrl: null, chatId: null },
    ]);
    const res = await request(app()).get('/api/service/telegram/city-groups').set('x-pizzadao-telegram-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([
      { cityKey: 'a', title: 'A', country: 'X', region: 'r', chatUrl: 'https://t.me/a', hasChat: true },
      { cityKey: 'b', title: null, country: null, region: null, chatUrl: null, hasChat: false },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/chatId|chat_id|1001234/);
    await request(app()).get('/api/service/telegram/city-groups').set('x-pizzadao-telegram-key', KEY);
    expect(mockPrisma.cityTelegramGroup.findMany).toHaveBeenCalledTimes(1);
  });
  it('needs no per-part flag but does need the key', async () => {
    delete process.env.PIZZADAO_TELEGRAM_DM_ENABLED;
    delete process.env.PIZZADAO_TELEGRAM_GROUPS_ENABLED;
    mockPrisma.cityTelegramGroup.findMany.mockResolvedValue([]);
    expect((await request(app()).get('/api/service/telegram/city-groups').set('x-pizzadao-telegram-key', KEY)).status).toBe(200);
    expect((await request(app()).get('/api/service/telegram/city-groups')).status).toBe(401);
  });
});

describe('send-only guarantee', () => {
  it('route and sender sources never touch updates or webhook configuration', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      path.join(dir, 'service-telegram.routes.ts'),
      path.join(dir, '..', 'services', 'telegramSend.ts'),
    ];
    for (const f of files) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/setWebhook|deleteWebhook|getUpdates|setMyCommands|setdomain/i);
    }
  });
});
