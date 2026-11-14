/**
 * Voting DB access (PR 7). Everything that touches hackathon_votes / hackathon_voting goes
 * through here, so the rules in voting.ts stay pure and the routes can be tested against an
 * in-memory store. Raw SQL is used where Prisma can't express the query:
 *   - the upsert ON CONFLICT on the expression index hackathon_votes_one_per_scope;
 *   - the own-team match by user id OR exact lower(email) (account or RSVP email; never ILIKE,
 *     see eligibility.findGuestsByEmail);
 *   - the counted-votes query (submitted projects only, self-votes dropped).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { decideEligibility, findGuestsByEmail, type Eligibility } from './eligibility.js';
import type { VotingSettings } from './voting.js';

type Tx = Prisma.TransactionClient | typeof prisma;

/** Hackathon + what voting needs (gallery rule fields, tracks, prizes, the settings row). */
export async function loadVotingHackathon(partyId: string) {
  return prisma.hackathon.findUnique({
    where: { partyId },
    include: {
      tracks: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
      prizes: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
      voting: true,
    },
  });
}

export async function loadVoting(hackathonId: string, tx: Tx = prisma): Promise<VotingSettings | null> {
  return tx.hackathonVoting.findUnique({ where: { hackathonId } });
}

/**
 * Inside a vote transaction: FOR SHARE on the settings row, so a host's open / close / settings
 * write (which locks / updates this row) waits for in-flight votes and vice versa. null = no row.
 *
 * Lock ORDER matters: the vote INSERT's FK check takes FOR KEY SHARE on the hackathons row, and
 * host writes take FOR UPDATE on that row and then the settings row. If a vote locked the
 * settings row first and the hackathons row only at INSERT time, a concurrent host write would
 * deadlock with it (40P01, seen on a real Postgres in votingStore.db.test.ts). So the vote takes
 * FOR KEY SHARE on the hackathons row FIRST: both sides lock hackathons -> hackathon_voting.
 */
export async function lockVotingShared(tx: Prisma.TransactionClient, hackathonId: string): Promise<VotingSettings | null> {
  await tx.$queryRaw`SELECT id FROM hackathons WHERE id = ${hackathonId}::uuid FOR KEY SHARE`;
  const rows = await tx.$queryRaw<Array<{ enabled: boolean; scope: string; eligibility: string; opens_at: Date | null; closes_at: Date | null }>>`
    SELECT enabled, scope, eligibility, opens_at, closes_at FROM hackathon_voting WHERE hackathon_id = ${hackathonId}::uuid FOR SHARE`;
  const r = rows[0];
  return r ? { enabled: r.enabled, scope: r.scope, eligibility: r.eligibility, opensAt: r.opens_at, closesAt: r.closes_at } : null;
}

/** Host writes: the hackathon row FOR UPDATE (same lock as the PR 4-5 host writes). */
export async function lockHackathonRow(tx: Prisma.TransactionClient, hackathonId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM hackathons WHERE id = ${hackathonId}::uuid FOR UPDATE`;
}

/**
 * Host writes, after lockHackathonRow: FOR UPDATE on the settings row. Votes hold FOR SHARE on
 * it for their whole transaction, so this waits until in-flight votes commit, and the vote count
 * read next (scope lock) can't miss one. No row = no votes can exist (voting was never on).
 */
export async function lockVotingForUpdate(tx: Prisma.TransactionClient, hackathonId: string): Promise<void> {
  await tx.$queryRaw`SELECT hackathon_id FROM hackathon_voting WHERE hackathon_id = ${hackathonId}::uuid FOR UPDATE`;
}

/** People's Choice awards of this hackathon (they block re-opening a closed vote). */
export async function peoplesChoiceAwardCount(tx: Prisma.TransactionClient, hackathonId: string): Promise<number> {
  return tx.hackathonAward.count({ where: { hackathonId, prize: { kind: 'peoples_choice' } } });
}

export async function saveVoting(tx: Prisma.TransactionClient, hackathonId: string, v: VotingSettings): Promise<void> {
  const data = { enabled: v.enabled, scope: v.scope, eligibility: v.eligibility, opensAt: v.opensAt, closesAt: v.closesAt };
  await tx.hackathonVoting.upsert({ where: { hackathonId }, create: { hackathonId, ...data }, update: data });
}

/**
 * Voter eligibility with the VOTING setting ('registered' | 'checked_in'), same guest matching
 * as participants (exact lower(email), approval / waitlist / check-in). Judges are not excluded
 * from voting (they're only barred from joining teams).
 */
export async function voterEligibility(
  partyId: string,
  h: { id: string; publishedAt: Date | null; disabledAt: Date | null },
  eligibility: string,
  email: string | undefined,
): Promise<Eligibility> {
  const hv = { ...h, eligibility };
  if (!email || !h.publishedAt || h.disabledAt) return decideEligibility(hv, [], { loggedIn: !!email, isJudge: false, requireApproval: false });
  const [party, guests] = await Promise.all([
    prisma.party.findUnique({ where: { id: partyId }, select: { requireApproval: true } }),
    findGuestsByEmail(partyId, email),
  ]);
  return decideEligibility(hv, guests, { loggedIn: true, isJudge: false, requireApproval: !!party?.requireApproval });
}

export async function findSubmissionBySlug(hackathonId: string, slug: string, tx: Tx = prisma) {
  const s = await tx.hackathonSubmission.findUnique({
    where: { hackathonId_slug: { hackathonId, slug } },
    select: { id: true, status: true, teamId: true, tracks: { select: { trackId: true } } },
  });
  return s ? { id: s.id, status: s.status, teamId: s.teamId, trackIds: s.tracks.map((t) => t.trackId) } : null;
}

/**
 * Team ids the voter belongs to in this hackathon: member by user id, or by exact
 * case-insensitive email match on a member's account email or RSVP (guest) email.
 */
export async function ownTeamIds(hackathonId: string, userId: string, email: string | undefined, tx: Tx = prisma): Promise<string[]> {
  const e = (email ?? '').trim();
  const rows = await tx.$queryRaw<Array<{ team_id: string }>>`
    SELECT DISTINCT m.team_id
      FROM hackathon_team_members m
      LEFT JOIN "User" u ON u.id = m.user_id
      LEFT JOIN guests g ON g.id = m.guest_id
     WHERE m.hackathon_id = ${hackathonId}::uuid
       AND (m.user_id = ${userId}
            OR (${e} <> '' AND (lower(u.email) = lower(${e}) OR lower(g.email) = lower(${e}))))`;
  return rows.map((r) => r.team_id);
}

/** Slugs of the voter's own team's project(s) (to disable those vote buttons in the UI). */
export async function ownProjectSlugs(hackathonId: string, teamIds: string[]): Promise<string[]> {
  if (!teamIds.length) return [];
  const subs = await prisma.hackathonSubmission.findMany({ where: { hackathonId, teamId: { in: teamIds } }, select: { slug: true } });
  return subs.map((s) => s.slug);
}

/** The voter's current votes: [{trackId (null = event), projectSlug}]. */
export async function myVotes(hackathonId: string, userId: string) {
  const rows = await prisma.hackathonVote.findMany({
    where: { hackathonId, voterUserId: userId },
    select: { trackId: true, submission: { select: { slug: true } } },
    take: 200,
  });
  return rows.map((r) => ({ trackId: r.trackId, projectSlug: r.submission.slug }));
}

/**
 * Cast or change the voter's vote in this scope: one atomic INSERT ... ON CONFLICT on the
 * one-per-scope expression index, so concurrent requests can't create two rows. Returns
 * whether an existing vote was changed. The nil uuid is a LITERAL, not a bind parameter: once
 * the prepared statement goes generic, `COALESCE(track_id, $n)` no longer matches the index
 * expression and Postgres can't infer the arbiter index (42P10).
 */
export async function upsertVote(
  tx: Prisma.TransactionClient,
  v: { hackathonId: string; trackId: string | null; submissionId: string; voterUserId: string; ipHash: string },
): Promise<{ changed: boolean }> {
  const rows = await tx.$queryRaw<Array<{ changed: boolean }>>`
    INSERT INTO hackathon_votes (hackathon_id, track_id, submission_id, voter_user_id, ip_hash)
    VALUES (${v.hackathonId}::uuid, ${v.trackId}::uuid, ${v.submissionId}::uuid, ${v.voterUserId}, ${v.ipHash})
    ON CONFLICT (hackathon_id, (COALESCE(track_id, '00000000-0000-0000-0000-000000000000'::uuid)), voter_user_id)
    DO UPDATE SET submission_id = EXCLUDED.submission_id, ip_hash = EXCLUDED.ip_hash, updated_at = now()
    RETURNING (xmax <> 0) AS changed`;
  return { changed: !!rows[0]?.changed };
}

export async function deleteVote(tx: Prisma.TransactionClient, hackathonId: string, trackId: string | null, voterUserId: string): Promise<number> {
  const r = await tx.hackathonVote.deleteMany({ where: { hackathonId, trackId, voterUserId } });
  return r.count;
}

/** Total votes + distinct voters (all rows; what the host may see while voting is open). */
export async function voteTotals(hackathonId: string): Promise<{ votes: number; voters: number }> {
  const [r] = await prisma.$queryRaw<Array<{ votes: number; voters: number }>>`
    SELECT count(*)::int AS votes, count(DISTINCT voter_user_id)::int AS voters
      FROM hackathon_votes WHERE hackathon_id = ${hackathonId}::uuid`;
  return { votes: r?.votes ?? 0, voters: r?.voters ?? 0 };
}

/** Votes per ip_hash bucket (abuse review). Never selects anything that identifies a voter. */
export async function ipBucketRows(hackathonId: string): Promise<Array<{ ipHash: string | null; votes: number }>> {
  const rows = await prisma.$queryRaw<Array<{ ip_hash: string | null; votes: number }>>`
    SELECT ip_hash, count(*)::int AS votes FROM hackathon_votes
     WHERE hackathon_id = ${hackathonId}::uuid GROUP BY ip_hash ORDER BY votes DESC LIMIT 500`;
  return rows.map((r) => ({ ipHash: r.ip_hash, votes: r.votes }));
}

/**
 * Votes that count (only called once voting is closed): projects still `submitted`, and not
 * a vote by a current member of the project's own team (by user id or email, as above; a
 * backstop for someone who joined the team after voting).
 */
export async function countedVotes(hackathonId: string): Promise<Array<{ submissionId: string; trackId: string | null }>> {
  const rows = await prisma.$queryRaw<Array<{ submission_id: string; track_id: string | null }>>`
    SELECT v.submission_id, v.track_id
      FROM hackathon_votes v
      JOIN hackathon_submissions s ON s.id = v.submission_id AND s.hackathon_id = v.hackathon_id
      LEFT JOIN "User" vu ON vu.id = v.voter_user_id
     WHERE v.hackathon_id = ${hackathonId}::uuid
       AND s.status = 'submitted'
       AND NOT EXISTS (
         SELECT 1 FROM hackathon_team_members m
           LEFT JOIN "User" u ON u.id = m.user_id
           LEFT JOIN guests g ON g.id = m.guest_id
          WHERE m.team_id = s.team_id
            AND (m.user_id = v.voter_user_id
                 OR (vu.email IS NOT NULL AND (lower(u.email) = lower(vu.email) OR lower(g.email) = lower(vu.email)))))
     LIMIT 200000`;
  return rows.map((r) => ({ submissionId: r.submission_id, trackId: r.track_id }));
}

/** Submitted projects (id, name, team, tracks) for the host tally. */
export async function submittedProjects(hackathonId: string) {
  const subs = await prisma.hackathonSubmission.findMany({
    where: { hackathonId, status: 'submitted' },
    select: { id: true, name: true, slug: true, team: { select: { name: true } }, tracks: { select: { trackId: true } } },
    orderBy: { submittedAt: 'asc' },
    take: 2000,
  });
  return subs.map((s) => ({ id: s.id, name: s.name, slug: s.slug, teamName: s.team?.name ?? null, trackIds: s.tracks.map((t) => t.trackId) }));
}
