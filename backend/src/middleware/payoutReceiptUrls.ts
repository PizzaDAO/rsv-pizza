/**
 * SECURITY: sign private payout-receipt paths on the way OUT, and un-sign them
 * on the way IN. See services/payoutReceiptStorage.service.ts for the storage
 * model.
 *
 * Why a middleware instead of per-route serialization: receipt URLs reach the
 * client through dozens of serializers (admin payouts list/detail, host payout
 * views, receipts library, shipping, pizza-index review queue, authenticity
 * checks, fast pass, …). Converting a bare `payouts/<partyUuid>/...` path into
 * a signed URL at the single `res.json` choke point keeps every one of them
 * working without touching each, and can't silently miss one.
 *
 * Access is NOT widened: this only rewrites values a route already decided to
 * return to an already-authorized caller. A bare path is unguessable (party
 * uuid + group id + timestamp + random suffix) and is just a pointer, so
 * signing what a route echoes back grants nothing a holder of the path didn't
 * already have when the bucket was public.
 *
 * Outbound (res.json):
 *   - every string that is a bare private receipt path → signed URL
 *   - additionally, for an object key named `url` that holds a PDF path, a
 *     sibling `thumbUrl` is added (signed `<path>.thumb.png`) because clients
 *     can no longer derive the thumbnail by appending `.thumb.png` to a signed
 *     URL. Missing thumbnails yield `thumbUrl: null`.
 *   - the body is copied on write, never mutated (handlers may return cached
 *     objects).
 *
 * Inbound (req.body / req.query):
 *   - every string that is one of OUR signed payout-receipts URLs → bare path,
 *     so round-tripped values (library re-attach, authenticity cache key,
 *     externalProofUrl edits, …) persist as paths, not expiring URLs.
 */
import type { Request, Response, NextFunction } from 'express';
import {
  isPrivateReceiptPath,
  privatePathFromSignedUrl,
  signReceiptPaths,
} from '../services/payoutReceiptStorage.service.js';

const MAX_DEPTH = 40;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

/** Collect every bare private path (plus PDF thumb siblings for `url` keys). */
export function collectPrivateReceiptPaths(body: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown, key: string | null, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (typeof v === 'string') {
      if (isPrivateReceiptPath(v)) {
        out.add(v);
        if (key === 'url' && isPdfPath(v)) out.add(`${v}.thumb.png`);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, null, depth + 1);
      return;
    }
    if (isPlainObject(v)) {
      for (const k of Object.keys(v)) visit(v[k], k, depth + 1);
    }
  };
  visit(body, null, 0);
  return out;
}

/**
 * Copy-on-write replacement of bare private paths with signed URLs from
 * `signed`. A path that couldn't be signed (object missing / storage error) is
 * left as-is: it is not a usable URL on its own (renders as a broken image)
 * and keeping a string avoids crashing clients that expect one.
 */
export function replacePrivateReceiptPaths(body: unknown, signed: Map<string, string>): unknown {
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return v;
    if (typeof v === 'string') {
      return isPrivateReceiptPath(v) ? (signed.get(v) ?? v) : v;
    }
    if (Array.isArray(v)) {
      let copy: unknown[] | null = null;
      for (let i = 0; i < v.length; i++) {
        const next = visit(v[i], depth + 1);
        if (next !== v[i]) {
          if (!copy) copy = v.slice();
          copy[i] = next;
        }
      }
      return copy ?? v;
    }
    if (isPlainObject(v)) {
      let copy: Record<string, unknown> | null = null;
      for (const k of Object.keys(v)) {
        const orig = v[k];
        const next = visit(orig, depth + 1);
        if (next !== orig) {
          if (!copy) copy = { ...v };
          copy[k] = next;
        }
        if (k === 'url' && isPrivateReceiptPath(orig) && isPdfPath(orig) && !('thumbUrl' in v)) {
          if (!copy) copy = { ...v };
          copy.thumbUrl = signed.get(`${orig}.thumb.png`) ?? null;
        }
      }
      return copy ?? v;
    }
    return v;
  };
  return visit(body, 0);
}

/** Copy-on-write: our signed payout-receipts URLs → bare private paths. */
export function unsignReceiptUrls(value: unknown): unknown {
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return v;
    if (typeof v === 'string') return privatePathFromSignedUrl(v) ?? v;
    if (Array.isArray(v)) {
      let copy: unknown[] | null = null;
      for (let i = 0; i < v.length; i++) {
        const next = visit(v[i], depth + 1);
        if (next !== v[i]) {
          if (!copy) copy = v.slice();
          copy[i] = next;
        }
      }
      return copy ?? v;
    }
    if (isPlainObject(v)) {
      let copy: Record<string, unknown> | null = null;
      for (const k of Object.keys(v)) {
        const next = visit(v[k], depth + 1);
        if (next !== v[k]) {
          if (!copy) copy = { ...v };
          copy[k] = next;
        }
      }
      return copy ?? v;
    }
    return v;
  };
  return visit(value, 0);
}

export function payoutReceiptUrlsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Inbound: un-sign round-tripped URLs.
  if (req.body && typeof req.body === 'object') {
    req.body = unsignReceiptUrls(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    const q = unsignReceiptUrls(req.query);
    if (q !== req.query) {
      for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
        (req.query as Record<string, unknown>)[k] = v;
      }
    }
  }

  // Outbound: sign bare private paths.
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    let paths: Set<string>;
    try {
      paths = collectPrivateReceiptPaths(body);
    } catch {
      return originalJson(body);
    }
    if (paths.size === 0) return originalJson(body);
    signReceiptPaths(paths)
      .catch((err) => {
        console.error('[payout-receipts] signing failed:', err?.message || err);
        return new Map<string, string>();
      })
      .then((signed) => {
        if (res.headersSent) return;
        originalJson(replacePrivateReceiptPaths(body, signed));
      })
      .catch((err) => next(err));
    return res;
  }) as Response['json'];

  next();
}
