import type { CorsOptions, CorsOptionsDelegate } from 'cors';
import type { Request } from 'express';
import { AppError } from '../middleware/error.js';

/**
 * CORS origin check. Vercel preview URLs are only trusted for the pizza-dao team:
 *   rsvpizza-git-<branch>-pizza-dao.vercel.app, rsvpizza-<hash>-pizza-dao.vercel.app,
 *   rsvpizza-team1-git-...-pizza-dao.vercel.app, and the bare rsvpizza.vercel.app alias.
 * (The old pattern accepted any host starting with "rsvpizza", e.g. other teams' projects.)
 */
export const VERCEL_PREVIEW_ORIGIN = /^https:\/\/rsvpizza([a-z0-9-]*-pizza-dao)?\.vercel\.app$/;

export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.includes(origin) || VERCEL_PREVIEW_ORIGIN.test(origin);
}

/**
 * tax-form-cors: the pizzadao-org app hosts the payee tax-form page and calls the public,
 * token-authed /api/tax-form-requests/* routes straight from the browser (so req.ip stays the
 * payee). Hardcoded here, NOT in ALLOWED_ORIGINS, so a prod env var can't drop them.
 * The preview suffix -pizza-dao.vercel.app is reserved for the pizza-dao Vercel team.
 */
export const PIZZADAO_APP_ORIGINS: readonly string[] = ['https://pizzadao.org', 'https://app.pizzadao.org'];
export const PIZZADAO_PREVIEW_ORIGIN = /^https:\/\/onboarding(-v7lj)?-[a-z0-9-]+-pizza-dao\.vercel\.app$/;

/** Public token routes only. Must NOT match /api/admin/tax-form-requests. */
export function isTaxFormRequestPublicPath(path: string): boolean {
  return /^\/api\/tax-form-requests(\/|$)/.test(path);
}

export function isAllowedTaxFormOrigin(origin: string, allowed: readonly string[]): boolean {
  return isAllowedOrigin(origin, allowed) || PIZZADAO_APP_ORIGINS.includes(origin) || PIZZADAO_PREVIEW_ORIGIN.test(origin);
}

/**
 * Per-request CORS options. Tax-form public paths additionally trust the pizzadao-org origins
 * and never use credentials (no cookies on these routes). All other paths: unchanged behavior.
 */
export function corsOptionsDelegate(allowed: readonly string[]): CorsOptionsDelegate<Request> {
  return (req, cb) => {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const taxForm = isTaxFormRequestPublicPath(path);
    const options: CorsOptions = {
      origin: (origin, done) => {
        // No origin (mobile apps, curl, etc.)
        if (!origin) return done(null, true);
        const ok = taxForm ? isAllowedTaxFormOrigin(origin, allowed) : isAllowedOrigin(origin, allowed);
        if (ok) return done(null, true);
        // AppError so the error handler answers 403 instead of 500.
        done(new AppError('Not allowed by CORS', 403, 'CORS_FORBIDDEN'));
      },
      credentials: !taxForm,
    };
    cb(null, options);
  };
}
