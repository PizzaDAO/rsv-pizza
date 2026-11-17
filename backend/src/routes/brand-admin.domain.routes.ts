/**
 * Domain + sending-domain routes of the brand-admin API (plans/wl-self-serve-brands.md PR 16).
 * Registered on the series-scoped router in brand-admin.routes.ts, so every route here sits behind
 * `requireAuth` + `requireSeriesAdmin` and reads the series ONLY from `req.seriesAdmin`.
 *
 *   GET    /:seriesId/domain                 State + the DNS records to add
 *   PUT    /:seriesId/domain {domain}        Request a custom domain (subdomain only; issues the ownership TXT)
 *   DELETE /:seriesId/domain                 Cancel a request (before it is attached)
 *   POST   /:seriesId/domain/check           Live DNS / hosting status check (rate limited)
 *   POST   /:seriesId/domain/attach          SUPER-ADMIN: attach the TXT-verified host to the brand's Vercel project
 *   POST   /:seriesId/domain/cutover         SUPER-ADMIN: make it the site address (old origin kept as an alias)
 *   POST   /:seriesId/domain/rollback        SUPER-ADMIN: undo the cutover
 *   GET    /:seriesId/email-domain           State + the SPF/DKIM/MX records to add
 *   PUT    /:seriesId/email-domain           {emailDomain, emailFromAddress}: create the Resend domain
 *   DELETE /:seriesId/email-domain           Remove the sending domain (back to the default sender)
 *   POST   /:seriesId/email-domain/check     Verify with Resend now (rate limited)
 *
 * Cron (CRON_SECRET, /api/cron): recheck-domains (15 min) and recheck-email-domains (hourly).
 * Missing VERCEL_DOMAINS_TOKEN / VERCEL_TEAM_ID / RESEND_ADMIN_KEY: the endpoints that need that
 * system answer 503 NOT_CONFIGURED; GET state still answers (with `configured` flags).
 */
import { Router, Response, NextFunction } from 'express';
import { AppError } from '../middleware/error.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { SeriesAdminRequest } from '../lib/seriesAccess.js';
import {
  reserveUserBucket, reserveKeyBucket,
  DOMAIN_WRITE_BUCKET, DOMAIN_WRITE_LIMIT, DOMAIN_CHECK_BUCKET, DOMAIN_CHECK_LIMIT,
  DOMAIN_CHECK_SERIES_BUCKET, DOMAIN_CHECK_SERIES_LIMIT, DOMAIN_READ_BUCKET, DOMAIN_READ_LIMIT,
} from '../lib/seriesInviteLimit.js';
import {
  getDomain, requestDomain, cancelDomain, checkDomain, attachDomain, cutoverDomain, rollbackDomain,
  getEmailDomain, setEmailDomain, removeEmailDomain, checkEmailDomain,
  recheckPendingDomains, recheckEmailDomains,
} from '../lib/domainService.js';

type Handler = (req: SeriesAdminRequest, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => async (req: SeriesAdminRequest, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (e) {
    next(e);
  }
};

const unavailable = (err: unknown) => {
  console.error('[brand-admin/domain] rate store unavailable', err);
  return new AppError('Please try again shortly', 503, 'UNAVAILABLE');
};
const limited = () => new AppError('Too many requests. Try again later.', 429, 'RATE_LIMITED');

function userLimit(bucket: string, limit: number) {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      let ok: boolean;
      try { ok = await reserveUserBucket(bucket, req.userId || req.userEmail || 'unknown', limit); } catch (e) { throw unavailable(e); }
      if (!ok) throw limited();
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Live checks hit DNS / Vercel / Resend: capped per user and per series. */
async function checkLimit(req: SeriesAdminRequest, _res: Response, next: NextFunction) {
  try {
    let ok: boolean;
    try {
      ok = await reserveUserBucket(DOMAIN_CHECK_BUCKET, req.userId || req.userEmail || 'unknown', DOMAIN_CHECK_LIMIT)
        && await reserveKeyBucket(DOMAIN_CHECK_SERIES_BUCKET, req.seriesAdmin!.seriesId, DOMAIN_CHECK_SERIES_LIMIT, 60 * 60 * 1000);
    } catch (e) { throw unavailable(e); }
    if (!ok) throw new AppError('Too many checks. Wait a few minutes and try again.', 429, 'RATE_LIMITED');
    next();
  } catch (e) {
    next(e);
  }
}

const writeLimit = userLimit(DOMAIN_WRITE_BUCKET, DOMAIN_WRITE_LIMIT);
const readLimit = userLimit(DOMAIN_READ_BUCKET, DOMAIN_READ_LIMIT);

/** Before any limit or work: brand admins get 403 on the PizzaDAO-only steps. */
function superOnly(req: SeriesAdminRequest, _res: Response, next: NextFunction) {
  if (req.seriesAdmin?.actorKind !== 'super_admin') return next(new AppError('Only PizzaDAO admins can do this', 403, 'FORBIDDEN'));
  next();
}

const ctx = (req: SeriesAdminRequest) => ({
  seriesId: req.seriesAdmin!.seriesId,
  actor: { actorEmail: req.seriesAdmin!.email, actorKind: req.seriesAdmin!.actorKind },
});
const body = (req: SeriesAdminRequest): Record<string, unknown> => {
  const b = req.body;
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b)) throw new AppError('Expected a JSON object', 400, 'VALIDATION_ERROR');
  return b as Record<string, unknown>;
};

/** Register on the series-scoped router (already behind requireSeriesAdmin). */
export function registerDomainRoutes(scoped: Router): void {
  scoped.get('/domain', readLimit, wrap(async (req, res) => res.json(await getDomain(req.seriesAdmin!.seriesId))));
  scoped.put('/domain', writeLimit, wrap(async (req, res) => res.json(await requestDomain({ ...ctx(req), domain: body(req).domain }))));
  scoped.delete('/domain', writeLimit, wrap(async (req, res) => res.json(await cancelDomain(ctx(req)))));
  scoped.post('/domain/check', checkLimit, wrap(async (req, res) => res.json(await checkDomain(ctx(req)))));
  scoped.post('/domain/attach', superOnly, writeLimit, wrap(async (req, res) => res.json(await attachDomain(ctx(req)))));
  scoped.post('/domain/cutover', superOnly, writeLimit, wrap(async (req, res) => {
    const b = body(req);
    if (b.redirectOld !== undefined && typeof b.redirectOld !== 'boolean') throw new AppError('redirectOld must be true or false', 400, 'VALIDATION_ERROR');
    res.json(await cutoverDomain({ ...ctx(req), redirectOld: b.redirectOld as boolean | undefined }));
  }));
  scoped.post('/domain/rollback', superOnly, writeLimit, wrap(async (req, res) => res.json(await rollbackDomain(ctx(req)))));

  scoped.get('/email-domain', readLimit, wrap(async (req, res) => res.json(await getEmailDomain(req.seriesAdmin!.seriesId))));
  scoped.put('/email-domain', writeLimit, wrap(async (req, res) => {
    const b = body(req);
    res.json(await setEmailDomain({ ...ctx(req), emailDomain: b.emailDomain, emailFromAddress: b.emailFromAddress }));
  }));
  scoped.delete('/email-domain', writeLimit, wrap(async (req, res) => res.json(await removeEmailDomain(ctx(req)))));
  scoped.post('/email-domain/check', checkLimit, wrap(async (req, res) => res.json(await checkEmailDomain(ctx(req)))));
}

// ---------- cron ----------

export const domainsCronRouter = Router();
function cron(run: () => Promise<unknown>) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret || (req.headers.authorization || '') !== `Bearer ${secret}`) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
      res.json(await run());
    } catch (e) {
      next(e);
    }
  };
}
domainsCronRouter.get('/recheck-domains', cron(() => recheckPendingDomains()));
domainsCronRouter.post('/recheck-domains', cron(() => recheckPendingDomains()));
domainsCronRouter.get('/recheck-email-domains', cron(() => recheckEmailDomains()));
domainsCronRouter.post('/recheck-email-domains', cron(() => recheckEmailDomains()));
