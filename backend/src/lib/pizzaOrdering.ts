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
import { isBlocking, mayExistAtShop } from './pizzaOrderStatus.js';

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

/** A real uploaded receipt, as the budget sees it. `cents` is 0 until OCR has read an amount. */
export interface BudgetReceipt {
  cents: number;
  createdAt: Date | string;
}

/** Eligible receipts for the party. Reminder lines (`source` != 'upload') are never receipts. */
export async function partyReceipts(partyId: string): Promise<BudgetReceipt[]> {
  const docs = await prisma.payoutDocument.findMany({
    where: { partyId, kind: 'receipt', source: 'upload', isDuplicate: false, ineligible: false },
    select: { ocrAmount: true, createdAt: true },
  });
  return docs.map((d) => ({
    cents: d.ocrAmount != null ? Math.round(Number(d.ocrAmount.toString()) * 100) : 0,
    createdAt: d.createdAt,
  }));
}

/** Only a receipt uploaded after the order can be that order's receipt. Unknown dates never match. */
export function isLaterReceipt(receipt: Pick<BudgetReceipt, 'createdAt'>, order: { createdAt?: Date | string | null }): boolean {
  if (!order.createdAt) return false;
  return new Date(receipt.createdAt).getTime() > new Date(order.createdAt).getTime();
}

/**
 * What the host may still spend through an order: the party's reimbursement cap, minus eligible
 * uploaded receipts, minus what open (or confirmed, not yet receipted) orders could cost. Refuses
 * when there is no cap or nothing left, naming the order that holds the budget if there is one.
 * A confirmed order and its real receipt count once (see budgetBreakdown).
 */
export async function remainingCapCents(party: OrderingParty): Promise<number> {
  if (party.capCents === null) {
    throw new AppError(
      'This party has no reimbursement cap yet, so AI ordering is off. Ask your underboss to set one.',
      422,
      'NO_REIMBURSEMENT_CAP'
    );
  }
  const [receipts, orders] = await Promise.all([
    partyReceipts(party.id),
    prisma.pizzaOrder.findMany({ where: { partyId: party.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  const { usedCents, held } = budgetBreakdown(receipts, orders);
  const remaining = party.capCents - usedCents;
  if (remaining <= 0) {
    const holder = held[0];
    throw new AppError(
      'There is no reimbursement budget left for another order (cap minus receipts and open orders).',
      422,
      'CAP_EXHAUSTED',
      holder ? { existingOrderId: holder.opopOrderId, existingStatus: holder.status } : undefined
    );
  }
  return remaining;
}

interface BudgetOrder {
  opopOrderId?: string;
  status: string;
  ceilingCents?: number | null;
  confirmedTotalCents?: number | null;
  receiptCoveredAt?: Date | string | null;
  releasedAt?: Date | string | null;
  nextAction?: unknown;
  lastView?: unknown;
  createdAt?: Date | string | null;
}

const CONFIRMED_STATUSES = new Set(['confirmed_by_shop', 'needs_review', 'completed', 'placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']);
/** An order that can have a real receipt, so that receipt must not be counted on top of its hold. */
const hasReceiptToCount = (o: BudgetOrder) => CONFIRMED_STATUSES.has(o.status) || mayExistAtShop(o);

/**
 * Budget already spoken for: uploaded receipts + what open orders could still cost. A confirmed order
 * counts once with its real receipt, and only a receipt uploaded after the order can be that receipt:
 *  - Automatically, when one matches its total (within 5% or $1; each receipt covers one order).
 *  - When the host says so (`receiptCoveredAt`). The click is unverified, so it only pairs: later
 *    receipts offset the order up to their own amounts, and with none the order stays held in full.
 *    If the shop gave no total the hold is only the ceiling, so one later receipt replaces it.
 * Orders that hold nothing (released, nothing_ordered true, IVR needs_review...) cost nothing. An ended order that
 * may exist at the shop (`canceled` or `unreachable` too) is held until a host releases it or its receipt offsets it.
 */
export function budgetBreakdown<T extends BudgetOrder>(receipts: BudgetReceipt[], orders: T[]): { usedCents: number; held: T[]; covered: T[] } {
  const free = receipts.filter((r) => r.cents > 0).map((r) => ({ ...r, left: r.cents }));
  const available = (o: T) => free.filter((r) => r.left > 0 && isLaterReceipt(r, o));
  const held: T[] = [];
  const covered: T[] = [];

  // Exact matches first, so a host's "this receipt covers it" cannot take another order's receipt.
  const unmatched = orders.filter(isBlocking).filter((o) => {
    const total = o.confirmedTotalCents;
    if (!hasReceiptToCount(o) || total == null) return true;
    const tol = Math.max(100, Math.round(total * 0.05));
    const match = available(o).find((r) => r.left === r.cents && Math.abs(r.cents - total) <= tol);
    if (!match) return true;
    match.left = 0;
    covered.push(o);
    return false;
  });

  let open = 0;
  for (const o of unmatched) {
    const view = o.lastView as { totals?: { total_cents?: number } } | null;
    let owed = o.confirmedTotalCents ?? o.ceilingCents ?? view?.totals?.total_cents ?? 0;
    if (o.receiptCoveredAt && hasReceiptToCount(o)) {
      if (o.confirmedTotalCents == null) {
        const receipt = available(o)[0];
        if (receipt) {
          receipt.left = 0;
          owed = 0;
        }
      } else {
        for (const r of available(o)) {
          const taken = Math.min(r.left, owed);
          r.left -= taken;
          owed -= taken;
        }
      }
    }
    if (owed > 0) held.push(o);
    else covered.push(o);
    open += owed;
  }
  return { usedCents: receipts.reduce((a, r) => a + Math.max(r.cents, 0), 0) + open, held, covered };
}

export function budgetUsedCents(receipts: BudgetReceipt[], orders: BudgetOrder[]): number {
  return budgetBreakdown(receipts, orders).usedCents;
}
