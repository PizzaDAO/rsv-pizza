/**
 * Who approved a brand-series event, from `party_status_audit` (no schema change).
 *
 * Brand admins write their rows with actor_kind 'admin' and reason 'brand admin'
 * (lib/seriesEventStatus.ts). PizzaDAO actors (super-admins, underbosses) write actor_kind 'admin' /
 * 'underboss' with any other reason. Two consequences:
 *  - veto: once a PizzaDAO actor has set a status, brand admins can't change it again;
 *  - money: an approval that came ONLY from a brand admin does not open the payout gate.
 * Events approved before brand admins existed have no 'brand admin' row, so they are unaffected.
 */
import { prisma } from '../config/database.js';

export const BRAND_ADMIN_REASON = 'brand admin';

/** Audit rows written by a PizzaDAO actor (anything but a brand admin or the host / system). */
const PIZZADAO_ACTOR = {
  actorKind: { in: ['admin', 'underboss'] },
  OR: [{ reason: null }, { reason: { not: BRAND_ADMIN_REASON } }],
};

/**
 * Prisma `where` fragment for parties: excludes those whose approval came only from a brand admin
 * (a brand-admin approval row exists and no PizzaDAO approval row does). Spread into any payout
 * `where` next to `underbossStatus: 'approved'`.
 */
export const notBrandOnlyApproved = {
  NOT: {
    AND: [
      { statusAudit: { some: { newStatus: 'approved', reason: BRAND_ADMIN_REASON } } },
      { statusAudit: { none: { newStatus: 'approved', ...PIZZADAO_ACTOR } } },
    ],
  },
};

/** Point check of the same rule, for single-party gates. */
export async function isBrandOnlyApproved(partyId: string): Promise<boolean> {
  const [byBrand, byPizzadao] = await Promise.all([
    prisma.partyStatusAudit.count({ where: { partyId, newStatus: 'approved', reason: BRAND_ADMIN_REASON } }),
    prisma.partyStatusAudit.count({ where: { partyId, newStatus: 'approved', ...PIZZADAO_ACTOR } }),
  ]);
  return byBrand > 0 && byPizzadao === 0;
}

/** True when the newest status change was made by a PizzaDAO actor (brand admins must not override it). */
export function isPizzadaoSet(last: { actorKind: string; reason: string | null } | null | undefined): boolean {
  return !!last && (last.actorKind === 'admin' || last.actorKind === 'underboss') && last.reason !== BRAND_ADMIN_REASON;
}
