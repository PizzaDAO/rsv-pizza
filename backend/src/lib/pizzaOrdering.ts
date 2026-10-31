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
      capCents: capUsd != null && capUsd > 0 ? Math.round(capUsd * 100) : null,
    },
  };
}
