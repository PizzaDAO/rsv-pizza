/**
 * PR 7 voting store against a REAL Postgres with hackathon-1-core + hackathon-2-voting applied
 * (skipped unless HACKATHON_VOTING_TEST_DB is set; never point it at prod, it writes and wipes
 * rows). What only a real DB can show:
 *   - one vote per scope: concurrent casts for the same voter + scope leave exactly one row
 *     (the ON CONFLICT upsert on the expression index), and a second cast changes it;
 *   - event and per-track votes are separate scopes;
 *   - own-team matching by user id or exact lower(email) (account or RSVP email);
 *   - counted votes drop non-submitted projects and self-votes;
 *   - the window re-check under FOR SHARE: a close committed first is seen by the vote.
 *
 * Local run (Postgres 17, stub "User"(id, email) / guests(id, party_id, email) / parties(id)):
 *   HACKATHON_VOTING_TEST_DB=postgresql://postgres@127.0.0.1:54337/hk npx vitest run src/lib/hackathon/votingStore.db.test.ts
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const URL = process.env.HACKATHON_VOTING_TEST_DB;
const client = vi.hoisted(() => ({ db: null as any }));
vi.mock('../../config/database.js', () => ({
  get prisma() {
    return client.db;
  },
}));

import * as store from './votingStore.js';
import { votingStatus } from './voting.js';

const PARTY = '11111111-0000-4000-8000-0000000000a1';
const HID = '22222222-0000-4000-8000-0000000000a1';
const T1 = '33333333-0000-4000-8000-0000000000a1';
const T2 = '33333333-0000-4000-8000-0000000000a2';
const TEAM_A = '44444444-0000-4000-8000-0000000000a1';
const TEAM_B = '44444444-0000-4000-8000-0000000000a2';
const S_A = '55555555-0000-4000-8000-0000000000a1';
const S_B = '55555555-0000-4000-8000-0000000000a2';
const G_ALICE = '66666666-0000-4000-8000-0000000000a1';
const IP = 'a'.repeat(64);

(URL ? describe : describe.skip)('votingStore on a real Postgres', () => {
  let db: PrismaClient;
  const exec = (sql: string) => db.$executeRawUnsafe(sql);

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: URL });
    client.db = db;
  });
  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  async function wipe() {
    await exec(`DELETE FROM hackathon_votes WHERE hackathon_id = '${HID}'`);
    await exec(`DELETE FROM hackathon_voting WHERE hackathon_id = '${HID}'`);
    await exec(`DELETE FROM hackathon_submission_tracks WHERE hackathon_id = '${HID}'`);
    await exec(`DELETE FROM hackathon_submissions WHERE hackathon_id = '${HID}'`);
    await exec(`DELETE FROM hackathons WHERE id = '${HID}'`);
    await exec(`DELETE FROM guests WHERE party_id = '${PARTY}'`);
    await exec(`DELETE FROM parties WHERE id = '${PARTY}'`);
    await exec(`DELETE FROM "User" WHERE id LIKE 'vt-%'`);
  }

  beforeEach(async () => {
    await wipe();
    await exec(`INSERT INTO parties(id) VALUES ('${PARTY}')`);
    await exec(`INSERT INTO "User"(id, email) VALUES ('vt-alice', 'Alice@Example.com'), ('vt-bob', 'bob@example.com'), ('vt-voter', 'voter@example.com'), ('vt-rsvp', 'alice.rsvp@example.com')`);
    await exec(`INSERT INTO guests(id, party_id, email) VALUES ('${G_ALICE}', '${PARTY}', 'Alice.RSVP@example.com')`);
    await exec(`INSERT INTO hackathons(id, party_id, published_at) VALUES ('${HID}', '${PARTY}', now())`);
    await exec(`INSERT INTO hackathon_tracks(id, hackathon_id, name) VALUES ('${T1}', '${HID}', 'DeFi'), ('${T2}', '${HID}', 'Consumer')`);
    await exec(`INSERT INTO hackathon_teams(id, hackathon_id, name, invite_code) VALUES ('${TEAM_A}', '${HID}', 'A', 'vtaaaaaaaa'), ('${TEAM_B}', '${HID}', 'B', 'vtbbbbbbbb')`);
    await exec(`INSERT INTO hackathon_team_members(team_id, hackathon_id, user_id, guest_id, role) VALUES ('${TEAM_A}', '${HID}', 'vt-alice', '${G_ALICE}', 'captain'), ('${TEAM_B}', '${HID}', 'vt-bob', NULL, 'captain')`);
    await exec(`INSERT INTO hackathon_submissions(id, hackathon_id, team_id, name, slug, status) VALUES ('${S_A}', '${HID}', '${TEAM_A}', 'Slice', 'slice', 'submitted'), ('${S_B}', '${HID}', '${TEAM_B}', 'Pep', 'pep', 'submitted')`);
    await exec(`INSERT INTO hackathon_submission_tracks(submission_id, track_id, hackathon_id) VALUES ('${S_A}', '${T1}', '${HID}'), ('${S_B}', '${T2}', '${HID}')`);
  });

  const cast = (voter: string, submissionId: string, trackId: string | null = null) =>
    db.$transaction((tx) => store.upsertVote(tx, { hackathonId: HID, trackId, submissionId, voterUserId: voter, ipHash: IP }));

  it('one vote per scope under a race: 12 concurrent casts -> 1 row; a later cast changes it', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => cast('vt-voter', i % 2 ? S_A : S_B)));
    expect(results.filter((r) => !r.changed)).toHaveLength(1); // exactly one insert, the rest updates
    expect(await db.hackathonVote.count({ where: { hackathonId: HID, voterUserId: 'vt-voter' } })).toBe(1);
    const changed = await cast('vt-voter', S_A);
    expect(changed.changed).toBe(true);
    expect((await store.myVotes(HID, 'vt-voter'))).toEqual([{ trackId: null, projectSlug: 'slice' }]);
  });

  it('event and per-track votes are separate scopes; delete retracts only that scope', async () => {
    await cast('vt-voter', S_A, null);
    await cast('vt-voter', S_A, T1);
    await cast('vt-voter', S_B, T2);
    expect(await db.hackathonVote.count({ where: { hackathonId: HID, voterUserId: 'vt-voter' } })).toBe(3);
    await db.$transaction((tx) => store.deleteVote(tx, HID, T1, 'vt-voter'));
    expect((await store.myVotes(HID, 'vt-voter')).map((v) => v.trackId).sort()).toEqual([null, T2].sort());
  });

  it('own team: by user id, account email (any case) or RSVP email', async () => {
    expect(await store.ownTeamIds(HID, 'vt-alice', 'x@x.com')).toEqual([TEAM_A]);
    expect(await store.ownTeamIds(HID, 'vt-other', 'alice@example.com')).toEqual([TEAM_A]);
    expect(await store.ownTeamIds(HID, 'vt-rsvp', 'ALICE.rsvp@example.com')).toEqual([TEAM_A]);
    expect(await store.ownTeamIds(HID, 'vt-voter', 'voter@example.com')).toEqual([]);
    // no ILIKE wildcards: '_' does not match '.'
    expect(await store.ownTeamIds(HID, 'vt-voter', 'alice_rsvp@example.com')).toEqual([]);
    expect(await store.ownProjectSlugs(HID, [TEAM_A])).toEqual(['slice']);
  });

  it('counted votes: submitted projects only, self-votes dropped (incl. by RSVP email)', async () => {
    await cast('vt-voter', S_A);
    await cast('vt-bob', S_A); // bob is on team B: counts
    await cast('vt-rsvp', S_A); // same email as alice's RSVP: a self-vote, dropped
    await cast('vt-alice', S_B); // counts
    let counted = await store.countedVotes(HID);
    expect(counted.filter((v) => v.submissionId === S_A)).toHaveLength(2);
    expect(counted.filter((v) => v.submissionId === S_B)).toHaveLength(1);
    await exec(`UPDATE hackathon_submissions SET status = 'disqualified' WHERE id = '${S_A}'`);
    counted = await store.countedVotes(HID);
    expect(counted.map((v) => v.submissionId)).toEqual([S_B]);
    expect(await store.voteTotals(HID)).toEqual({ votes: 4, voters: 4 });
    expect(await store.ipBucketRows(HID)).toEqual([{ ipHash: IP, votes: 4 }]);
  });

  it('window: a vote re-checks under FOR SHARE and sees a close that committed first', async () => {
    await db.$transaction((tx) => store.saveVoting(tx, HID, { enabled: true, scope: 'event', eligibility: 'checked_in', opensAt: new Date(Date.now() - 60_000), closesAt: null }));
    expect(votingStatus(await store.loadVoting(HID))).toBe('open');
    // Host closes (holds the row lock) while a vote waits on FOR SHARE.
    let release!: () => void;
    const hostTx = db.$transaction(async (tx) => {
      await store.lockHackathonRow(tx, HID);
      await store.saveVoting(tx, HID, { enabled: true, scope: 'event', eligibility: 'checked_in', opensAt: new Date(Date.now() - 60_000), closesAt: new Date() });
      await new Promise<void>((r) => { release = r; setTimeout(r, 300); });
    });
    await new Promise((r) => setTimeout(r, 50));
    const voteTx = db.$transaction(async (tx) => {
      const fresh = await store.lockVotingShared(tx, HID);
      return votingStatus(fresh);
    });
    await hostTx;
    expect(await voteTx).toBe('closed');
    release?.();
  });

  it('cascade: deleting a project removes its votes', async () => {
    await cast('vt-voter', S_B);
    await exec(`DELETE FROM hackathon_submission_tracks WHERE submission_id = '${S_B}'`);
    await exec(`DELETE FROM hackathon_submissions WHERE id = '${S_B}'`);
    expect(await db.hackathonVote.count({ where: { hackathonId: HID } })).toBe(0);
  });
});
