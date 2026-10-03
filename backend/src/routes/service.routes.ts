/**
 * Service-to-service routes for PizzaDAO's member app (pizzadao.org).
 *
 *   POST /api/service/gpp-host-lookup
 *     "Did the person with these identifiers host or onboard an approved /
 *     listed Global Pizza Party (Bitcoin Pizza Day) event?" Feeds the L6.1
 *     mission verifier on pizzadao.org. Logic: lib/gppHostLookup.ts.
 *
 *     Auth: header `x-service-key` must equal `PIZZADAO_SERVICE_KEY`
 *       (constant-time compare).
 *       - env unset -> 503 { ok:false, reason:'not configured' }
 *       - mismatch  -> 401
 *     Body: { emails?: string[], wallets?: string[], telegrams?: string[] }
 *       (singular `email` / `wallet` / `telegram` strings also accepted;
 *       max 10 per kind, at least one identifier). Identifiers go in the body,
 *       never the URL, so they don't land in access logs.
 *     200: { ok:true, matched:boolean, events:[{ slug, city, status, type,
 *            date, role, matchedBy }] }  (no PII beyond what was sent)
 *     Rate limit: 60 requests / minute per IP on top of the global /api limiter.
 */
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { findGppHostEvents, IdentifierError, parseIdentifiers } from '../lib/gppHostLookup.js';

const router = Router();

/** Constant-time string equality (hash first so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** `x-service-key` against PIZZADAO_SERVICE_KEY: 503 when unset, 401 on mismatch. */
export function requireServiceKey(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.PIZZADAO_SERVICE_KEY?.trim();
  if (!secret) {
    return res.status(503).json({ ok: false, reason: 'not configured' });
  }
  const provided = req.header('x-service-key') || '';
  if (!provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }
  next();
}

const serviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { ok: false, reason: 'rate limited' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

router.post('/gpp-host-lookup', serviceLimiter, requireServiceKey, async (req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'private, no-store');
  let ids;
  try {
    ids = parseIdentifiers(req.body);
  } catch (e) {
    if (e instanceof IdentifierError) return res.status(400).json({ ok: false, reason: e.message });
    return next(e);
  }
  try {
    const events = await findGppHostEvents(ids);
    res.json({ ok: true, matched: events.length > 0, events });
  } catch (error) {
    next(error);
  }
});

export default router;
