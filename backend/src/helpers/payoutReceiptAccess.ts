/**
 * payout-receipts-private: who may see (get signed URLs for) / upload private
 * payout receipts of a given party.
 *
 * A caller may access party P's receipts when they are:
 *   - a payment admin / admin / super admin (any party), or
 *   - able to edit P (owner, editing co-host, super admin, scoped GPP roles), or
 *   - an aggregator for P (full admin or an underboss whose scope covers P), or
 *   - (opt-in) an active shipping coordinator: they file shipping receipts for
 *     any party with a kit, so the shipping + party-payout routers allow them.
 * This is the union of the existing gates on POST /payouts and the admin
 * payout views; it never grants more than those routes already do.
 */
import { prisma } from '../config/database.js';
import { isPaymentAdmin } from '../middleware/auth.js';
import { canUserEditParty } from './partyAccess.js';
import { isAggregatorForParty } from '../services/payout-recipients.js';

export interface ReceiptCaller {
  userId?: string;
  userEmail?: string;
}

export async function isActiveShippingCoordinator(email?: string): Promise<boolean> {
  const e = email?.toLowerCase();
  if (!e) return false;
  const coord = await prisma.shippingCoordinator.findFirst({
    where: { email: e, isActive: true },
    select: { id: true },
  });
  return !!coord;
}

export async function canAccessPartyReceipts(
  caller: ReceiptCaller,
  partyId: string,
  opts: { allowShippingCoordinator?: boolean } = {},
): Promise<boolean> {
  if (!caller.userId && !caller.userEmail) return false;
  if (await isPaymentAdmin(caller.userEmail)) return true;
  if (await canUserEditParty(partyId, caller.userId, caller.userEmail)) return true;
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { userId: true, region: true, name: true, city: true, eventType: true },
  });
  if (!party) return false;
  if (caller.userEmail && (await isAggregatorForParty(caller.userEmail, party))) return true;
  if (opts.allowShippingCoordinator && (await isActiveShippingCoordinator(caller.userEmail))) return true;
  return false;
}
