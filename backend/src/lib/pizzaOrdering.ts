/**
 * basil-14648: who may use AI / OPOP ordering, and for which party.
 *
 * Two gates, both required, on every party route:
 *   1. The caller is the party's host (owner) or a co-host with edit rights. Admins and
 *      underbosses are deliberately NOT included: an order is placed in the caller's own name.
 *   2. The party id is in PIZZA_ORDERING_PARTY_IDS (comma separated). Empty/unset = off for everyone.
 * The frontend flag VITE_AI_ORDERING=1 only decides whether the UI is built in; this allowlist is
 * the authoritative switch.
 */
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { computeEffectiveCapUsd } from '../helpers/reimbursementCap.js';
import { isBlocking } from './pizzaOrderStatus.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pizzaOrderingAllowlist(): Set<string> {
  return new Set(
    (process.env.PIZZA_ORDERING_PARTY_IDS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isPizzaOrderingEnabledFor(partyId: string): boolean {
  return pizzaOrderingAllowlist().has(partyId.toLowerCase());
}

export interface OrderingParty {
  id: string;
  name: string;
  userId: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  customUrl: string | null;
  inviteCode: string;
  capCents: number | null;
}

function emailsMatch(a?: string | null, b?: string | null) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Load the party and prove the caller hosts it. Throws a 404 (never 403) for everything else, so
 * the existence of other people's parties is not revealed. `requireEnabled: false` is for the
 * /config probe that tells the UI whether to show the flow.
 */
export async function loadPartyForOrdering(
  partyId: string,
  caller: { userId?: string; userEmail?: string },
  opts: { requireEnabled?: boolean } = {}
): Promise<{ party: OrderingParty; enabled: boolean }> {
  const notFound = () => new AppError('Party not found', 404, 'NOT_FOUND');
  if (!caller.userId || !UUID_RE.test(partyId)) throw notFound();
  const row = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      id: true,
      name: true,
      userId: true,
      coHosts: true,
      address: true,
      latitude: true,
      longitude: true,
      customUrl: true,
      inviteCode: true,
      reimbursementCapUsd: true,
      eventTags: true,
    },
  });
  if (!row) throw notFound();
  const isOwner = !!row.userId && row.userId === caller.userId;
  const coHosts = Array.isArray(row.coHosts) ? (row.coHosts as Array<{ email?: string; canEdit?: boolean }>) : [];
  const isCoHost = coHosts.some((h) => h && h.canEdit === true && emailsMatch(h.email, caller.userEmail));
  if (!isOwner && !isCoHost) throw notFound();

  const enabled = isPizzaOrderingEnabledFor(partyId);
  if (!enabled && opts.requireEnabled !== false) throw notFound();

  const capUsd = computeEffectiveCapUsd({
    reimbursementCapUsd: row.reimbursementCapUsd,
    eventTags: row.eventTags,
  });
  return {
    enabled,
    party: {
      id: row.id,
      name: row.name,
      userId: row.userId,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      customUrl: row.customUrl,
      inviteCode: row.inviteCode,
      // null (or $0) means NO budget: ordering is refused, never treated as "no cap"
      capCents: capUsd != null && capUsd > 0 ? Math.round(capUsd * 100) : null,
    },
  };
}

/**
 * What the host may still spend through an order: the party's reimbursement cap, minus eligible
 * uploaded receipts, minus what open (or confirmed, not yet receipted) orders could cost. Refuses
 * when there is no cap or nothing left. A confirmed order whose receipt is uploaded counts once (see budgetUsedCents).
 */
export async function remainingCapCents(party: OrderingParty): Promise<number> {
  if (party.capCents === null) {
    throw new AppError(
      'This party has no reimbursement cap yet, so AI ordering is off. Ask your underboss to set one.',
      422,
      'NO_REIMBURSEMENT_CAP'
    );
  }
  const [docs, orders] = await Promise.all([
    prisma.payoutDocument.findMany({
      where: { partyId: party.id, kind: 'receipt', source: 'upload', isDuplicate: false, ineligible: false },
      select: { ocrAmount: true },
    }),
    prisma.pizzaOrder.findMany({ where: { partyId: party.id } }),
  ]);
  const receipts = docs
    .map((d) => (d.ocrAmount != null ? Math.round(Number(d.ocrAmount.toString()) * 100) : 0))
    .filter((c) => c > 0);
  const used = budgetUsedCents(receipts, orders);
  const remaining = party.capCents - used;
  if (remaining <= 0) {
    throw new AppError(
      "There is no reimbursement budget left for another order (cap minus receipts and open orders).",
      422,
      'CAP_EXHAUSTED'
    );
  }
  return remaining;
}

interface BudgetOrder {
  status: string;
  ceilingCents?: number | null;
  confirmedTotalCents?: number | null;
  receiptCoveredAt?: Date | string | null;
  releasedAt?: Date | string | null;
  nextAction?: unknown;
  lastView?: unknown;
}

const CONFIRMED_STATUSES = new Set(['confirmed_by_shop', 'needs_review', 'completed', 'placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']);

/**
 * Budget already spoken for: uploaded receipts + what open orders could still cost. A confirmed order
 * whose real receipt is uploaded counts ONCE: either the host said so (`receiptCoveredAt`) or an
 * uploaded receipt matches its total (within 5% or $1; each receipt covers one order).
 * Orders that hold nothing (released, refused, IVR needs_review...) cost nothing.
 */
export function budgetUsedCents(receiptsCents: number[], orders: BudgetOrder[]): number {
  const free = [...receiptsCents];
  let open = 0;
  for (const o of orders.filter((x) => isBlocking(x))) {
    const view = o.lastView as { totals?: { total_cents?: number } } | null;
    const amount = o.confirmedTotalCents ?? o.ceilingCents ?? view?.totals?.total_cents ?? 0;
    if (CONFIRMED_STATUSES.has(o.status) && o.confirmedTotalCents != null) {
      if (o.receiptCoveredAt) continue;
      const tol = Math.max(100, Math.round(o.confirmedTotalCents * 0.05));
      const i = free.findIndex((r) => Math.abs(r - o.confirmedTotalCents!) <= tol);
      if (i >= 0) {
        free.splice(i, 1);
        continue;
      }
    }
    open += amount;
  }
  return receiptsCents.reduce((a, b) => a + b, 0) + open;
}
