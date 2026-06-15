/**
 * caciocavallo-58535: shared payout-recipient attribution helpers.
 *
 * A payout's recipient (`payouts.host_user_id`) and its money destination
 * (wallet/method snapshot) are derived from the authenticated uploader on the
 * implicit assumption uploader == person being reimbursed. That holds when a
 * host uploads their own receipts, but is silently wrong when an
 * underboss/admin does data-entry on behalf of a local host — the payout would
 * pay the aggregator instead of the local host.
 *
 * These helpers let all three payout-create paths share ONE notion of:
 *   - who is acting as an aggregator on a party (`isAggregatorForParty`),
 *   - which Users may legitimately receive the reimbursement
 *     (`buildPartyRecipientCandidates`), and
 *   - validation that a picked recipient is actually a host of the party
 *     (`assertRecipientIsPartyHost`).
 *
 * Kept in its own module so both `payout.routes.ts` and (potentially) other
 * route files can import without a require cycle.
 */
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import {
  getUnderbossScope,
  partyMatchesScope,
} from '../helpers/underbossScope.js';

/** A host a payout can legitimately be attributed to. */
export type PartyRecipientCandidate = {
  userId: string;
  name: string | null;
  email: string | null;
  isPrimaryHost: boolean;
};

/**
 * Minimal party shape needed to decide aggregator status. `userId` is the
 * primary host (a `User.id`); `region`/`name`/`city`/`eventType` feed
 * `partyMatchesScope`.
 */
export type PartyForAggregatorCheck = {
  userId: string | null;
  region?: string | null;
  name?: string | null;
  city?: string | null;
  eventType?: string | null;
};

/**
 * True when the authenticated caller is acting as an AGGREGATOR for this party:
 * a full admin OR an active underboss whose scope (regions/cities from the
 * `underbosses` TABLE — NOT the co_hosts JSON `isUnderboss` flag) covers the
 * party.
 *
 * NOTE: this is "is an aggregator at all". "Acting on behalf of a local host"
 * is the stricter `isAggregatorForParty(...) && party.userId !== req.userId`;
 * callers compose that themselves so the intent is explicit at the call site.
 */
export async function isAggregatorForParty(
  userEmail: string | null | undefined,
  party: PartyForAggregatorCheck,
): Promise<boolean> {
  const scope = await getUnderbossScope(userEmail);
  if (scope.isAdmin) return true;
  return partyMatchesScope(party, scope);
}

/**
 * Build the set of Users a payout for this party may be attributed to:
 *   - the primary host (`party.user_id`) — always present, flagged
 *     `isPrimaryHost: true`.
 *   - co-hosts from `parties.co_hosts` JSON that resolve to real `User` rows
 *     by email (case-insensitive). Entries without an email, or `partner-*`
 *     placeholder ids, or with no matching `User`, are skipped — the payout's
 *     `host_user_id` must be a real `User.id`.
 *
 * Extracted from the per-party candidate logic that previously lived inline in
 * `admin-payout.routes.ts` (~1124 / ~1540) so every create path shares ONE
 * builder. (Unlike the admin external-payment picker, this builder does NOT
 * drop org insiders — an underboss who genuinely fronted money for their own
 * event is a legitimate recipient and may pick themselves.)
 */
export async function buildPartyRecipientCandidates(
  partyId: string,
): Promise<PartyRecipientCandidate[]> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      userId: true,
      coHosts: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!party) return [];

  const candidates: PartyRecipientCandidate[] = [];
  const seenUserIds = new Set<string>();

  // Primary host always first.
  if (party.user) {
    candidates.push({
      userId: party.user.id,
      name: party.user.name,
      email: party.user.email,
      isPrimaryHost: true,
    });
    seenUserIds.add(party.user.id);
  }

  // Collect co-host emails (skip partner-* placeholders / no-email entries),
  // then resolve them to real User rows in a single query.
  const cohostList = Array.isArray(party.coHosts) ? (party.coHosts as any[]) : [];
  const cohostEmails = new Set<string>();
  for (const ch of cohostList) {
    if (!ch || typeof ch !== 'object') continue;
    // partner-* ids are placeholder co-hosts with no backing User account.
    if (typeof ch.id === 'string' && ch.id.startsWith('partner-')) continue;
    const email = typeof ch.email === 'string' ? ch.email.trim().toLowerCase() : '';
    if (!email) continue;
    cohostEmails.add(email);
  }

  if (cohostEmails.size > 0) {
    const cohostUsers = await prisma.user.findMany({
      where: { email: { in: Array.from(cohostEmails) } },
      select: { id: true, name: true, email: true },
    });
    const byEmail = new Map<string, { id: string; name: string | null; email: string }>();
    for (const u of cohostUsers) byEmail.set(u.email.toLowerCase(), u);

    // Preserve co_hosts order for a stable picker list.
    for (const ch of cohostList) {
      if (!ch || typeof ch !== 'object') continue;
      const email = typeof ch.email === 'string' ? ch.email.trim().toLowerCase() : '';
      if (!email) continue;
      const u = byEmail.get(email);
      if (!u) continue;
      if (seenUserIds.has(u.id)) continue; // dedupe (host listed as co-host)
      seenUserIds.add(u.id);
      candidates.push({
        userId: u.id,
        name: u.name,
        email: u.email,
        isPrimaryHost: false,
      });
    }
  }

  return candidates;
}

/**
 * Throw 400 INVALID_RECIPIENT_HOST_USER_ID if `recipientHostUserId` is not in
 * the party's candidate set. Prevents an aggregator attributing a reimbursement
 * to an arbitrary User. Returns the matched candidate on success so callers can
 * reuse its email for audit notes.
 */
export async function assertRecipientIsPartyHost(
  recipientHostUserId: string,
  partyId: string,
): Promise<PartyRecipientCandidate> {
  const candidates = await buildPartyRecipientCandidates(partyId);
  const match = candidates.find((c) => c.userId === recipientHostUserId);
  if (!match) {
    throw new AppError(
      'The selected recipient is not a host of this event.',
      400,
      'INVALID_RECIPIENT_HOST_USER_ID',
    );
  }
  return match;
}
