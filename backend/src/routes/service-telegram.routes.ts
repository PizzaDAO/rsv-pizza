/**
 * Send-only Telegram proxy for PizzaDAO's member app (app.pizzadao.org).
 *
 * The app never holds the bot token: it asks this service to send. Nothing
 * here reads or changes the bot's inbound configuration; the inbound side
 * belongs to a different service.
 *
 * Auth: header `x-pizzadao-telegram-key` must equal PIZZADAO_TELEGRAM_SERVICE_KEY
 *   (constant-time). Env unset -> 503 { ok:false, reason:'not configured' };
 *   mismatch -> 401. Each route family also needs its own flag set to `1`
 *   (else 503 { ok:false, reason:'disabled' }):
 *     /dm, /probe   PIZZADAO_TELEGRAM_DM_ENABLED
 *     /city-post    PIZZADAO_TELEGRAM_GROUPS_ENABLED
 *   /city-groups needs only the key. Identifiers go in bodies, never URLs.
 *
 *   GET  /city-groups -> { ok, groups:[{ cityKey, title, country, region, chatUrl, hasChat }] }
 *   POST /dm       { telegramUserId, text, buttons?, idempotencyKey }
 *                  -> { ok:true, messageId, replay? } | { ok:false, code, retryAfter? }
 *   POST /probe    { telegramUserId } -> { ok, reachable, code? }
 *   POST /city-post { cityKey, text, idempotencyKey }
 *                  -> { ok:true, messageId?, migratedTo?, replay? } | { ok:false, code, retryAfter? }
 *
 * Every Telegram outcome is HTTP 200; 4xx/5xx mean our own validation, auth or
 * config. DM codes: not_started | blocked | rate_limited | bad_request | uncertain.
 * City-post codes: no_group | kicked | rate_limited | bad_request | uncertain.
 * `uncertain` means the message may have been delivered; do not auto-retry.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { safeEqual } from './service.routes.js';
import { sendServiceDm, sendServiceTyping, TelegramApiResult } from '../services/telegramSend.js';
import { sendToCityGroup } from '../services/cityTelegramGroup.js';

const router = Router();

const MAX_TEXT = 3500;
const KEY_RE = /^[A-Za-z0-9:_-]{8,80}$/;
const USER_ID_RE = /^\d{1,20}$/;

class BadInput extends Error {}
class NotConfigured extends Error {}

// --- auth / flags / limiter -------------------------------------------------

function requireTelegramServiceKey(req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'private, no-store');
  const secret = process.env.PIZZADAO_TELEGRAM_SERVICE_KEY?.trim();
  if (!secret) return res.status(503).json({ ok: false, reason: 'not configured' });
  const provided = req.header('x-pizzadao-telegram-key') || '';
  if (!provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }
  next();
}

function requireFlag(envName: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (process.env[envName]?.trim() !== '1') {
      return res.status(503).json({ ok: false, reason: 'disabled' });
    }
    next();
  };
}

// Per key (not per Vercel IP). Runs after auth so strangers can't drain it.
const telegramLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: () => 'pizzadao',
  message: { ok: false, reason: 'rate limited' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

router.use(requireTelegramServiceKey, telegramLimiter);

// --- outcome classification -------------------------------------------------

type DmCode = 'not_started' | 'blocked' | 'rate_limited' | 'bad_request' | 'uncertain';
type PostCode = 'no_group' | 'kicked' | 'rate_limited' | 'bad_request' | 'uncertain';
type Outcome<C extends string> =
  | { ok: true; messageId?: number; migratedTo?: string }
  | { ok: false; code: C; retryAfter?: number };

export function classifyDmFailure(
  r: Extract<TelegramApiResult, { ok: false }>,
): { code: DmCode; retryAfter?: number } {
  if (r.network) return { code: 'uncertain' };
  const desc = r.description || '';
  if (r.errorCode === 429) return { code: 'rate_limited', retryAfter: r.retryAfter };
  if (r.errorCode === 400) {
    return { code: /chat not found|user not found/i.test(desc) ? 'not_started' : 'bad_request' };
  }
  if (r.errorCode === 403) {
    if (/can'?t initiate|cannot initiate/i.test(desc)) return { code: 'not_started' };
    return { code: 'blocked' }; // blocked by the user, deactivated, or otherwise forbidden
  }
  return { code: 'uncertain' };
}

// --- idempotency ------------------------------------------------------------

type Kind = 'dm' | 'city_post';

const PRUNE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;
let lastPrune = 0;
function maybePrune() {
  if (Date.now() - lastPrune < 60 * 60 * 1000) return;
  lastPrune = Date.now();
  Promise.resolve(
    prisma.pizzadaoServiceSend.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - PRUNE_AFTER_MS) } },
    }),
  ).catch(() => undefined);
}

function storedToResponse(row: { status: string; messageId: bigint | null; code: string | null }) {
  if (row.status === 'sent') {
    return { ok: true, messageId: row.messageId === null ? undefined : Number(row.messageId), replay: true };
  }
  if (row.status === 'failed' && row.code) return { ok: false, code: row.code, replay: true };
  return { ok: false, code: 'uncertain', replay: true }; // pending / uncertain
}

/**
 * Claim `key` (insert `pending`), run `send`, record the outcome. A repeated key
 * returns the stored result without sending again. A previous `rate_limited`
 * failure was definitely not delivered, so that key may be retried.
 * Returns null when the key was already used for a different kind/target.
 * `precheck` runs only for a brand-new key (a replay is never throttled).
 */
async function sendOnce<C extends string>(
  kind: Kind,
  target: string,
  key: string,
  send: () => Promise<Outcome<C>>,
  precheck?: () => Outcome<C> | null,
): Promise<Record<string, unknown> | null> {
  maybePrune();
  const existing = await prisma.pizzadaoServiceSend.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.kind !== kind || existing.target !== target) return null;
    const retryable = existing.status === 'failed' && existing.code === 'rate_limited';
    if (!retryable) return storedToResponse(existing);
    const claimed = await prisma.pizzadaoServiceSend.updateMany({
      where: { idempotencyKey: key, status: 'failed', code: 'rate_limited' },
      data: { status: 'pending', code: null },
    });
    if (claimed.count === 0) {
      const row = await prisma.pizzadaoServiceSend.findUnique({ where: { idempotencyKey: key } });
      return row ? storedToResponse(row) : { ok: false, code: 'uncertain', replay: true };
    }
  } else {
    const early = precheck?.();
    if (early) return { ...early };
    try {
      await prisma.pizzadaoServiceSend.create({
        data: { idempotencyKey: key, kind, target, status: 'pending' },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const row = await prisma.pizzadaoServiceSend.findUnique({ where: { idempotencyKey: key } });
        if (row && (row.kind !== kind || row.target !== target)) return null;
        return row ? storedToResponse(row) : { ok: false, code: 'uncertain', replay: true };
      }
      throw e;
    }
  }

  let outcome: Outcome<C>;
  try {
    outcome = await send();
  } catch (e) {
    if (e instanceof NotConfigured) {
      // Nothing was sent: free the key so a retry after configuring works.
      await prisma.pizzadaoServiceSend.delete({ where: { idempotencyKey: key } }).catch(() => undefined);
      throw e;
    }
    outcome = { ok: false, code: 'uncertain' as C };
  }
  const status = outcome.ok ? 'sent' : outcome.code === 'uncertain' ? 'uncertain' : 'failed';
  try {
    await prisma.pizzadaoServiceSend.update({
      where: { idempotencyKey: key },
      data: {
        status,
        messageId: outcome.ok && outcome.messageId !== undefined ? BigInt(outcome.messageId) : null,
        code: outcome.ok ? null : outcome.code,
      },
    });
  } catch (e) {
    console.error('[service-telegram] failed to record send outcome:', (e as Error)?.message);
  }
  return { ...outcome };
}

// --- validation -------------------------------------------------------------

function parseUserId(v: unknown): string {
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : v;
  if (typeof s !== 'string' || !USER_ID_RE.test(s) || BigInt(s) <= 0n) {
    throw new BadInput('telegramUserId must be a positive integer id');
  }
  return s;
}

function parseText(v: unknown): string {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > MAX_TEXT) {
    throw new BadInput(`text must be a non-empty string of at most ${MAX_TEXT} characters`);
  }
  return v;
}

function parseKey(v: unknown): string {
  if (typeof v !== 'string' || !KEY_RE.test(v)) throw new BadInput('invalid idempotencyKey');
  return v;
}

function allowedButtonHosts(): Set<string> {
  return new Set(
    (process.env.PIZZADAO_TELEGRAM_BUTTON_HOSTS || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseButtons(v: unknown): { text: string; url: string }[][] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > 3) throw new BadInput('buttons: at most 3 rows');
  const hosts = allowedButtonHosts();
  return v.map((row) => {
    if (!Array.isArray(row) || row.length === 0 || row.length > 3) {
      throw new BadInput('buttons: each row needs 1 to 3 buttons');
    }
    return row.map((b) => {
      if (!b || typeof b.text !== 'string' || b.text.length === 0 || b.text.length > 40 || typeof b.url !== 'string') {
        throw new BadInput('buttons: invalid button');
      }
      let u: URL;
      try {
        u = new URL(b.url);
      } catch {
        throw new BadInput('buttons: invalid url');
      }
      if (u.protocol !== 'https:' || u.username || u.password || !hosts.has(u.hostname.toLowerCase())) {
        throw new BadInput('buttons: url must be https on an allowed host');
      }
      return { text: b.text, url: u.toString() };
    });
  });
}

/** Maps validation / config errors to responses; anything else goes to the error handler. */
function fail(res: Response, next: NextFunction, e: unknown) {
  if (e instanceof BadInput) return res.status(400).json({ ok: false, reason: e.message });
  if (e instanceof NotConfigured) return res.status(503).json({ ok: false, reason: 'not configured' });
  return next(e);
}

// --- GET /city-groups -------------------------------------------------------

const DIRECTORY_TTL_MS = 5 * 60 * 1000;
let directoryCache: { at: number; groups: unknown[] } | null = null;
export function resetDirectoryCache() {
  directoryCache = null;
}

router.get('/city-groups', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!directoryCache || Date.now() - directoryCache.at > DIRECTORY_TTL_MS) {
      const rows = await prisma.cityTelegramGroup.findMany({
        select: { cityKey: true, title: true, country: true, region: true, chatUrl: true, chatId: true },
        orderBy: { cityKey: 'asc' },
      });
      directoryCache = {
        at: Date.now(),
        groups: rows.map((r) => ({
          cityKey: r.cityKey,
          title: r.title,
          country: r.country,
          region: r.region,
          chatUrl: r.chatUrl,
          hasChat: r.chatId !== null,
        })),
      };
    }
    res.json({ ok: true, groups: directoryCache.groups });
  } catch (e) {
    next(e);
  }
});

// --- POST /dm and /probe ----------------------------------------------------

const dmFlag = requireFlag('PIZZADAO_TELEGRAM_DM_ENABLED');

router.post('/dm', dmFlag, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseUserId(req.body?.telegramUserId);
    const text = parseText(req.body?.text);
    const key = parseKey(req.body?.idempotencyKey);
    const buttons = parseButtons(req.body?.buttons);
    const out = await sendOnce<DmCode>('dm', userId, key, async () => {
      const r = await sendServiceDm(userId, text, buttons);
      if (r.ok) return { ok: true, messageId: r.messageId };
      if (r.notConfigured) throw new NotConfigured();
      return { ok: false, ...classifyDmFailure(r) };
    });
    if (out === null) return res.status(409).json({ ok: false, reason: 'idempotencyKey reused' });
    res.json(out);
  } catch (e) {
    fail(res, next, e);
  }
});

router.post('/probe', dmFlag, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseUserId(req.body?.telegramUserId);
    const r = await sendServiceTyping(userId);
    if (r.ok) return res.json({ ok: true, reachable: true });
    if (r.notConfigured) throw new NotConfigured();
    const c = classifyDmFailure(r);
    res.json({
      ok: true,
      reachable: false,
      code: c.code,
      ...(c.retryAfter !== undefined && { retryAfter: c.retryAfter }),
    });
  } catch (e) {
    fail(res, next, e);
  }
});

// --- POST /city-post --------------------------------------------------------

const CITY_MIN_GAP_MS = 5_000;
const CITY_PER_MIN = 10;
const cityPosts = new Map<string, number[]>();
export function resetCityFloor() {
  cityPosts.clear();
}

/** Returns a rate_limited outcome if this city is over its floor; else records the post. */
function cityFloor(cityKey: string): Outcome<PostCode> | null {
  const now = Date.now();
  const recent = (cityPosts.get(cityKey) || []).filter((t) => now - t < 60_000);
  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < CITY_MIN_GAP_MS) {
    return { ok: false, code: 'rate_limited', retryAfter: Math.ceil((CITY_MIN_GAP_MS - (now - last)) / 1000) };
  }
  if (recent.length >= CITY_PER_MIN) {
    return { ok: false, code: 'rate_limited', retryAfter: Math.max(1, Math.ceil((60_000 - (now - recent[0])) / 1000)) };
  }
  recent.push(now);
  cityPosts.set(cityKey, recent);
  return null;
}

router.post(
  '/city-post',
  requireFlag('PIZZADAO_TELEGRAM_GROUPS_ENABLED'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawCity = req.body?.cityKey;
      if (typeof rawCity !== 'string' || rawCity.trim().length === 0 || rawCity.length > 80) {
        throw new BadInput('cityKey must be a non-empty string of at most 80 characters');
      }
      const cityKey = rawCity.toLowerCase().trim();
      const text = parseText(req.body?.text);
      const key = parseKey(req.body?.idempotencyKey);
      const out = await sendOnce<PostCode>(
        'city_post',
        cityKey,
        key,
        async () => {
          const r = await sendToCityGroup(cityKey, text);
          if (r.ok) return { ok: true, messageId: r.messageId, ...(r.migratedTo && { migratedTo: r.migratedTo }) };
          if (r.skipped) return { ok: false, code: 'no_group' };
          if (r.reason?.startsWith('TELEGRAM_BOT_TOKEN')) throw new NotConfigured();
          const desc = r.reason || '';
          if (r.errorCode === 429) return { ok: false, code: 'rate_limited', retryAfter: r.retryAfter };
          if (r.errorCode === 403 || /kicked|not a member|bot was blocked/i.test(desc)) {
            return { ok: false, code: 'kicked' };
          }
          if (r.errorCode === 400) return { ok: false, code: 'bad_request' };
          return { ok: false, code: 'uncertain' };
        },
        () => cityFloor(cityKey),
      );
      if (out === null) return res.status(409).json({ ok: false, reason: 'idempotencyKey reused' });
      res.json(out);
    } catch (e) {
      fail(res, next, e);
    }
  },
);

export default router;
