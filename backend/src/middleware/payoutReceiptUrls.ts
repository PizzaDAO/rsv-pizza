/**
 * SECURITY: sign private payout-receipt paths on the way OUT, and un-sign them
 * on the way IN — ONLY on the routers that serve or accept receipts. See
 * services/payoutReceiptStorage.service.ts for the storage model.
 *
 * Why a middleware instead of per-route serialization: receipt URLs reach the
 * client through many serializers (admin payouts list/detail, host payout
 * views, receipts library, shipping, pizza-index review, authenticity checks).
 * Converting bare `payouts/<partyUuid>/...` paths into signed URLs at the
 * `res.json` choke point of those routers keeps them all working.
 *
 * It must NOT become a signing oracle (echo a user-controlled string and get a
 * signed URL back), so signing is gated three ways:
 *   1. Mounted only on the receipt routers (mountPayoutReceiptUrlMiddleware),
 *      never globally.
 *   2. Only values directly under a receipt key (RECEIPT_URL_KEYS) are signed;
 *      a matching string anywhere else (names, notes, …) is left alone.
 *   3. Per-caller party check at signing time:
 *        - party router (/api/parties/:partyId/payouts): only paths in that
 *          party's folder, and only if the caller can access that party's
 *          receipts;
 *        - staff routers: payment admins/admins get everything; anyone else
 *          only paths of parties they can access (scoped underbosses,
 *          editors, and — on the shipping router — shipping coordinators).
 *      Unauthenticated callers never get anything signed.
 *
 * Outbound: for a PDF under `url`, a sibling `thumbUrl` (signed
 * `<path>.thumb.png`, or null) is added because clients can no longer derive
 * the thumbnail by appending `.thumb.png` to a signed URL. The body is copied
 * on write, never mutated (handlers may return cached objects). Values that
 * are not signed are left as-is (a bare path is not a usable URL).
 *
 * Inbound (req.body / req.query on the same routers): our signed
 * payout-receipts URLs → bare paths, so round-tripped values persist as paths.
 * Deliberately NOT applied elsewhere — e.g. /api/heic/convert needs the full
 * signed URL it is given.
 *
 * budget-receipts-private: the same machinery covers BUDGET receipts
 * (budget_items.receipt_url, `receipts/<partyUuid>/...` in the same private
 * bucket) through a second namespace (BUDGET_RECEIPT_NAMESPACE): mounted only
 * on /api/parties/:partyId/budget, signs only `receiptUrl` values that are
 * budget paths of the route party, for callers who pass the budget routes'
 * own gate (canAccessPartyBudget). Payout routers never sign budget paths and
 * the budget router never signs payout paths.
 */
import type { Express, Request, Response, NextFunction, RequestHandler } from 'express';
import {
  isPrivateReceiptPath,
  partyIdFromPrivateReceiptPath,
  privatePathFromSignedUrl,
  isBudgetReceiptPath,
  partyIdFromBudgetReceiptPath,
  budgetPathFromSignedUrl,
  signReceiptPaths,
} from '../services/payoutReceiptStorage.service.js';
import { canAccessPartyReceipts, canAccessPartyBudget, ReceiptCaller } from '../helpers/payoutReceiptAccess.js';
import { isPaymentAdmin } from './auth.js';

const MAX_DEPTH = 40;

/** Object keys whose values may hold a receipt storage reference. */
export const RECEIPT_URL_KEYS: ReadonlySet<string> = new Set([
  'url', // payout_documents.url
  'thumbUrl', // PDF thumbnail sibling
  'externalProofUrl', // payouts.external_proof_url
  'imageUrl', // image_authenticity_checks.image_url
  'elaArtifactUrl', // image_authenticity_checks.ela_artifact_url
  'documentUrl', // pizza-index review lines (payout_documents.url AS document_url)
]);

/** budget-receipts-private: the only receipt key the budget routes return. */
export const BUDGET_RECEIPT_URL_KEYS: ReadonlySet<string> = new Set([
  'receiptUrl', // budget_items.receipt_url
]);

/**
 * Which receipt paths a middleware instance recognises, under which keys, and
 * how to read the party id / un-sign them. One per private-bucket prefix.
 */
export interface ReceiptNamespace {
  keys: ReadonlySet<string>;
  isPath: (value: unknown) => value is string;
  partyIdOf: (path: string) => string | null;
  fromSignedUrl: (value: unknown) => string | null;
  /** Key whose PDF values get a signed `thumbUrl` sibling (payouts only). */
  pdfThumbKey: string | null;
}

export const PAYOUT_RECEIPT_NAMESPACE: ReceiptNamespace = {
  keys: RECEIPT_URL_KEYS,
  isPath: isPrivateReceiptPath,
  partyIdOf: partyIdFromPrivateReceiptPath,
  fromSignedUrl: privatePathFromSignedUrl,
  pdfThumbKey: 'url',
};

export const BUDGET_RECEIPT_NAMESPACE: ReceiptNamespace = {
  keys: BUDGET_RECEIPT_URL_KEYS,
  isPath: isBudgetReceiptPath,
  partyIdOf: partyIdFromBudgetReceiptPath,
  fromSignedUrl: budgetPathFromSignedUrl,
  pdfThumbKey: null,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

/**
 * Collect bare private paths found directly under receipt keys (plus PDF
 * thumb siblings for `url` keys).
 */
export function collectPrivateReceiptPaths(
  body: unknown,
  ns: ReceiptNamespace = PAYOUT_RECEIPT_NAMESPACE,
): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (!isPlainObject(v)) return;
    for (const k of Object.keys(v)) {
      const val = v[k];
      if (typeof val === 'string') {
        if (ns.keys.has(k) && ns.isPath(val)) {
          out.add(val);
          if (k === ns.pdfThumbKey && isPdfPath(val)) out.add(`${val}.thumb.png`);
        }
      } else {
        visit(val, depth + 1);
      }
    }
  };
  visit(body, 0);
  return out;
}

/**
 * Copy-on-write replacement of receipt-key values found in `signed` with
 * their signed URL. Anything not in `signed` is left untouched.
 */
export function replacePrivateReceiptPaths(
  body: unknown,
  signed: Map<string, string>,
  ns: ReceiptNamespace = PAYOUT_RECEIPT_NAMESPACE,
): unknown {
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return v;
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
    if (!isPlainObject(v)) return v;
    let copy: Record<string, unknown> | null = null;
    for (const k of Object.keys(v)) {
      const orig = v[k];
      let next: unknown = orig;
      if (typeof orig === 'string') {
        if (ns.keys.has(k) && ns.isPath(orig) && signed.has(orig)) next = signed.get(orig);
      } else {
        next = visit(orig, depth + 1);
      }
      if (next !== orig) {
        if (!copy) copy = { ...v };
        copy[k] = next;
      }
      if (
        k === ns.pdfThumbKey && typeof orig === 'string' && ns.isPath(orig) && signed.has(orig) &&
        isPdfPath(orig) && !('thumbUrl' in v)
      ) {
        if (!copy) copy = { ...v };
        copy.thumbUrl = signed.get(`${orig}.thumb.png`) ?? null;
      }
    }
    return copy ?? v;
  };
  return visit(body, 0);
}

/** Copy-on-write: our signed payout-receipts URLs → bare private paths. */
export function unsignReceiptUrls(
  value: unknown,
  ns: ReceiptNamespace = PAYOUT_RECEIPT_NAMESPACE,
): unknown {
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return v;
    if (typeof v === 'string') return ns.fromSignedUrl(v) ?? v;
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

export type ReceiptSigningPolicy =
  | { kind: 'party' }
  | { kind: 'staff'; allowShippingCoordinator?: boolean }
  // budget-receipts-private: /api/parties/:partyId/budget — route party only,
  // caller must pass the budget routes' gate (canAccessPartyBudget).
  | { kind: 'budget' };

/** Access checks, injectable for tests. */
export interface ReceiptAccessDeps {
  isPaymentAdmin: (email?: string) => Promise<boolean>;
  canAccessPartyReceipts: (
    caller: ReceiptCaller,
    partyId: string,
    opts?: { allowShippingCoordinator?: boolean },
  ) => Promise<boolean>;
  signReceiptPaths: (paths: Iterable<string>) => Promise<Map<string, string>>;
  /** Budget gate. Optional so test deps can omit it; missing → nothing signed (fail closed). */
  canAccessPartyBudget?: (caller: ReceiptCaller, partyId: string) => Promise<boolean>;
}

const defaultDeps: ReceiptAccessDeps = {
  isPaymentAdmin,
  canAccessPartyReceipts,
  signReceiptPaths,
  canAccessPartyBudget,
};

/** Reduce `paths` to the ones this caller may get signed URLs for. */
export async function filterAuthorizedReceiptPaths(
  caller: ReceiptCaller,
  paths: Set<string>,
  policy: ReceiptSigningPolicy,
  routePartyId: string | null,
  deps: ReceiptAccessDeps = defaultDeps,
  ns: ReceiptNamespace = PAYOUT_RECEIPT_NAMESPACE,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (paths.size === 0 || (!caller.userId && !caller.userEmail)) return out;

  if (policy.kind === 'budget') {
    if (!routePartyId || !deps.canAccessPartyBudget) return out;
    const inParty = [...paths].filter((p) => ns.isPath(p) && ns.partyIdOf(p)?.toLowerCase() === routePartyId);
    if (inParty.length === 0) return out;
    if (!(await deps.canAccessPartyBudget(caller, routePartyId))) return out;
    inParty.forEach((p) => out.add(p));
    return out;
  }

  if (policy.kind === 'party') {
    if (!routePartyId) return out;
    const inParty = [...paths].filter((p) => ns.partyIdOf(p)?.toLowerCase() === routePartyId);
    if (inParty.length === 0) return out;
    if (!(await deps.canAccessPartyReceipts(caller, routePartyId, { allowShippingCoordinator: true }))) return out;
    inParty.forEach((p) => out.add(p));
    return out;
  }

  if (await deps.isPaymentAdmin(caller.userEmail)) return new Set(paths);
  const byParty = new Map<string, string[]>();
  for (const p of paths) {
    const pid = ns.partyIdOf(p)?.toLowerCase();
    if (!pid) continue;
    const list = byParty.get(pid) ?? [];
    list.push(p);
    byParty.set(pid, list);
  }
  const verdicts = await Promise.all(
    [...byParty.keys()].map(async (pid) => [pid, await deps.canAccessPartyReceipts(caller, pid, {
      allowShippingCoordinator: !!policy.allowShippingCoordinator,
    })] as const),
  );
  for (const [pid, ok] of verdicts) if (ok) byParty.get(pid)!.forEach((p) => out.add(p));
  return out;
}

export function payoutReceiptUrls(
  policy: ReceiptSigningPolicy,
  deps: ReceiptAccessDeps = defaultDeps,
  ns: ReceiptNamespace = PAYOUT_RECEIPT_NAMESPACE,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Inbound: un-sign round-tripped URLs.
    if (req.body && typeof req.body === 'object') {
      req.body = unsignReceiptUrls(req.body, ns);
    }
    if (req.query && typeof req.query === 'object') {
      const q = unsignReceiptUrls(req.query, ns);
      if (q !== req.query) {
        for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
          (req.query as Record<string, unknown>)[k] = v;
        }
      }
    }

    // Capture now: req.params is rewritten as routing descends.
    const rawPartyId = (req.params as Record<string, string | undefined>)?.partyId;
    const routePartyId = rawPartyId && UUID_RE.test(rawPartyId) ? rawPartyId.toLowerCase() : null;

    const originalJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      let paths: Set<string>;
      try {
        paths = collectPrivateReceiptPaths(body, ns);
      } catch {
        return originalJson(body);
      }
      if (paths.size === 0) return originalJson(body);
      // requireAuth has run by now (it sets these on the request).
      const r = req as Request & { userId?: string; userEmail?: string };
      const caller: ReceiptCaller = { userId: r.userId, userEmail: r.userEmail };
      filterAuthorizedReceiptPaths(caller, paths, policy, routePartyId, deps, ns)
        .then((allowed) => (allowed.size ? deps.signReceiptPaths(allowed) : new Map<string, string>()))
        .catch((err) => {
          console.error('[payout-receipts] signing failed:', err?.message || err);
          return new Map<string, string>();
        })
        .then((signed) => {
          if (res.headersSent) return;
          originalJson(replacePrivateReceiptPaths(body, signed, ns));
        })
        .catch((err) => next(err));
      return res;
    }) as Response['json'];

    next();
  };
}

/**
 * Mount on exactly the routers that serve/accept payout receipts. Call after
 * express.json() and before those routers are mounted.
 */
export function mountPayoutReceiptUrlMiddleware(app: Express, deps: ReceiptAccessDeps = defaultDeps): void {
  app.use('/api/parties/:partyId/payouts', payoutReceiptUrls({ kind: 'party' }, deps));
  app.use('/api/parties/:partyId/reimbursement', payoutReceiptUrls({ kind: 'party' }, deps));
  app.use('/api/admin/payouts', payoutReceiptUrls({ kind: 'staff' }, deps));
  app.use('/api/admin/image-authenticity', payoutReceiptUrls({ kind: 'staff' }, deps));
  app.use('/api/admin/pizza-index', payoutReceiptUrls({ kind: 'staff' }, deps));
  app.use('/api/shipping', payoutReceiptUrls({ kind: 'staff', allowShippingCoordinator: true }, deps));
  // budget-receipts-private: budget routes only (GET budget, item create/
  // update/toggle responses). Budget namespace: `receiptUrl` + `receipts/...`.
  app.use('/api/parties/:partyId/budget', payoutReceiptUrls({ kind: 'budget' }, deps, BUDGET_RECEIPT_NAMESPACE));
}
