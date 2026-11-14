/**
 * Hackathon participant eligibility (plans/hackathon-platform.md §6, §16 Q1/Q3/Q6).
 *
 * A caller may create or join a team when:
 *   - they are logged in (JWT email), and
 *   - the hackathon is published and not disabled, and
 *   - they are not an active judge of this hackathon (judges can't join teams), and
 *   - their email (case-insensitive) matches a guest row of the party that is
 *       not declined (approved !== false), approved (approved === true) when the party requires
 *       approval, CONFIRMED (not waitlisted), and checked in when eligibility = 'checked_in'.
 * Co-hosts are not special: they can join when they RSVP'd like anyone else.
 */
import { prisma } from '../../config/database.js';

export type IneligibleReason =
  | 'login'
  | 'not_available'
  | 'judge'
  | 'no_rsvp'
  | 'declined'
  | 'pending_approval'
  | 'waitlisted'
  | 'not_checked_in';

export interface Eligibility {
  eligible: boolean;
  reason: IneligibleReason | null;
  /** The matching guest row (stored on the member row so hosts see who's on which team). */
  guestId: string | null;
}

export interface GuestLike {
  id: string;
  approved: boolean | null;
  status: string | null;
  checkedInAt: Date | null;
}

export interface HackathonLike {
  id: string;
  publishedAt: Date | null;
  disabledAt: Date | null;
  eligibility: string;
}

/** Order of "how close is this guest row to eligible" (best first), for multi-RSVP emails. */
function rank(g: GuestLike, requireApproval: boolean, checkedInMode: boolean): number {
  if (g.approved === false) return 5;
  if (requireApproval && g.approved !== true) return 4;
  if ((g.status ?? 'CONFIRMED') !== 'CONFIRMED') return 3;
  if (checkedInMode && !g.checkedInAt) return 2;
  return 0;
}

/** Pure decision for a set of guest rows (unit-tested). */
export function decideEligibility(
  h: HackathonLike | null,
  guests: GuestLike[],
  opts: { loggedIn: boolean; isJudge: boolean; requireApproval: boolean },
): Eligibility {
  const no = (reason: IneligibleReason, guestId: string | null = null): Eligibility => ({ eligible: false, reason, guestId });
  if (!h || !h.publishedAt || h.disabledAt) return no('not_available');
  if (!opts.loggedIn) return no('login');
  if (opts.isJudge) return no('judge');
  if (!guests.length) return no('no_rsvp');
  const checkedInMode = h.eligibility === 'checked_in';
  const best = [...guests].sort((a, b) => rank(a, opts.requireApproval, checkedInMode) - rank(b, opts.requireApproval, checkedInMode))[0];
  const r = rank(best, opts.requireApproval, checkedInMode);
  if (r === 5) return no('declined');
  if (r === 4) return no('pending_approval', best.id);
  if (r === 3) return no('waitlisted', best.id);
  if (r === 2) return no('not_checked_in', best.id);
  return { eligible: true, reason: null, guestId: best.id };
}

export async function isActiveJudge(hackathonId: string, email: string | undefined): Promise<boolean> {
  if (!email) return false;
  const j = await prisma.hackathonJudge.findFirst({
    where: { hackathonId, email: email.trim().toLowerCase(), status: 'active' },
    select: { id: true },
  });
  return !!j;
}

/** DB-backed eligibility for the caller. */
export async function checkEligibility(
  partyId: string,
  h: HackathonLike | null,
  email: string | undefined,
): Promise<Eligibility & { isJudge: boolean }> {
  if (!h || !h.publishedAt || h.disabledAt || !email) {
    return { ...decideEligibility(h, [], { loggedIn: !!email, isJudge: false, requireApproval: false }), isJudge: false };
  }
  const [isJudge, party, guests] = await Promise.all([
    isActiveJudge(h.id, email),
    prisma.party.findUnique({ where: { id: partyId }, select: { requireApproval: true } }),
    prisma.guest.findMany({
      where: { partyId, email: { equals: email.trim(), mode: 'insensitive' } },
      select: { id: true, approved: true, status: true, checkedInAt: true },
      take: 10,
    }),
  ]);
  return {
    ...decideEligibility(h, guests, { loggedIn: true, isJudge, requireApproval: !!party?.requireApproval }),
    isJudge,
  };
}
