/**
 * Hackathon judge identity + scope (plans/hackathon-platform.md §6-7, PR 4).
 *
 * A judge is a logged-in user whose email matches an ACTIVE hackathon_judges row of the
 * hackathon (exact lower(email) = lower($1), like findGuestsByEmail: Prisma's insensitive mode
 * is ILIKE, where `_` / `%` in an email are wildcards). The row's user_id is linked on the
 * first authenticated visit. Judges get no host-page access.
 *
 * Scope: hackathon_judge_tracks rows for the judge; none = every track. A judge only ever sees
 * `submitted` projects in scope, minus conflicts (a team that has a member whose account or
 * RSVP email is the judge's email: judges can't join teams, but a member who RSVP'd and later
 * became a judge, or a judge added after joining, must still not score their own team).
 */
import { prisma } from '../../config/database.js';

export interface JudgeRow {
  id: string;
  name: string | null;
  userId: string | null;
  status: string;
}

/** The judge row of this hackathon for `email` (any status), or null. */
export async function findJudgeByEmail(hackathonId: string, email: string): Promise<JudgeRow | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null; user_id: string | null; status: string }>>`
    SELECT id, name, user_id, status
      FROM hackathon_judges
     WHERE hackathon_id = ${hackathonId}::uuid AND lower(email) = lower(${email.trim()})
     LIMIT 1`;
  const r = rows[0];
  return r ? { id: r.id, name: r.name, userId: r.user_id, status: r.status } : null;
}

/** Link the judge row to the caller's account on first visit (never re-points a linked row). */
export async function linkJudgeUser(judge: JudgeRow, userId: string): Promise<void> {
  if (judge.userId) return;
  await prisma.hackathonJudge.updateMany({ where: { id: judge.id, userId: null }, data: { userId } });
}

export async function judgeTrackIds(judgeId: string): Promise<string[]> {
  const rows = await prisma.hackathonJudgeTrack.findMany({ where: { judgeId }, select: { trackId: true } });
  return rows.map((r) => r.trackId);
}

/** Prisma `where` for the projects a judge may see. */
export function judgeScopeWhere(hackathonId: string, trackIds: string[]) {
  return {
    hackathonId,
    status: 'submitted',
    ...(trackIds.length ? { tracks: { some: { trackId: { in: trackIds } } } } : {}),
  };
}

/** Include for judge reads: tracks + team members (names for the non-blind view, emails for the conflict check only). */
export const JUDGE_SUBMISSION_INCLUDE = {
  tracks: { select: { trackId: true } },
  team: {
    select: {
      name: true,
      members: {
        orderBy: { joinedAt: 'asc' as const },
        include: {
          user: { select: { name: true, email: true, profilePictureUrl: true } },
          guest: { select: { name: true, email: true } },
        },
      },
    },
  },
};

/** True when the judge's email belongs to a member of the project's team. */
export function isConflicted(sub: { team?: { members?: Array<{ user?: { email?: string | null } | null; guest?: { email?: string | null } | null }> } | null }, judgeEmail: string): boolean {
  const e = judgeEmail.trim().toLowerCase();
  return (sub.team?.members ?? []).some((m) =>
    [m.user?.email, m.guest?.email].some((x) => typeof x === 'string' && x.trim().toLowerCase() === e));
}
