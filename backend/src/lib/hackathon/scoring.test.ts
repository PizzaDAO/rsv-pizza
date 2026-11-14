import { describe, it, expect } from 'vitest';
import { aggregateSubmission, buildLeaderboard, computeTotal, parseScoreInput, rankRows, readCriterionScores } from './scoring.js';
import { isConflicted, judgeScopeWhere } from './judge.js';
import { judgeQueueItem, judgeSubmission } from './serialize.js';

const C = [
  { id: 'impact', name: 'Impact', weight: 3, maxScore: 5 },
  { id: 'tech', name: 'Tech', weight: 1, maxScore: 10 },
];

describe('computeTotal', () => {
  it('100 * sum(w * s / max) / sum(w), 2 decimals', () => {
    // (3 * 4/5 + 1 * 7/10) / 4 = (2.4 + 0.7) / 4 = 0.775
    expect(computeTotal({ impact: 4, tech: 7 }, C)).toBe(77.5);
    expect(computeTotal({ impact: 5, tech: 10 }, C)).toBe(100);
    expect(computeTotal({ impact: 1, tech: 1 }, C)).toBe(17.5); // (0.6 + 0.1) / 4
    // 1/3 -> rounds to 2 decimals
    expect(computeTotal({ a: 1 }, [{ id: 'a', weight: 1, maxScore: 3 }])).toBe(33.33);
  });

  it('weights change the total; missing criteria are left out; none -> null', () => {
    const heavyTech = [{ ...C[0], weight: 1 }, { ...C[1], weight: 3 }];
    expect(computeTotal({ impact: 4, tech: 7 }, heavyTech)).toBe(72.5); // (0.8 + 2.1) / 4
    expect(computeTotal({ impact: 4 }, C)).toBe(80);
    expect(computeTotal({}, C)).toBeNull();
  });
});

describe('parseScoreInput', () => {
  it('accepts whole numbers 1..max for every criterion and computes the total', () => {
    const r = parseScoreInput({ scores: { impact: 4, tech: '7' }, privateComment: '  solid  ', teamFeedback: '' }, C);
    expect(r).toEqual({ criterionScores: { impact: 4, tech: 7 }, total: 77.5, privateComment: 'solid', teamFeedback: null });
  });

  it.each([
    [{ impact: 6, tech: 5 }, /Impact must be scored from 1 to 5/],
    [{ impact: 0, tech: 5 }, /1 to 5/],
    [{ impact: 2.5, tech: 5 }, /1 to 5/],
    [{ impact: 3, tech: 11 }, /1 to 10/],
    [{ impact: 3 }, /missing: Tech/],
    [{ impact: 3, tech: 3, bogus: 1 }, /Unknown criterion/],
  ])('rejects %j', (scores, msg) => {
    expect(() => parseScoreInput({ scores }, C)).toThrow(msg);
  });

  it('rejects a missing scores object, long comments, and an empty rubric', () => {
    expect(() => parseScoreInput({}, C)).toThrow(/scores must be an object/);
    expect(() => parseScoreInput({ scores: [] }, C)).toThrow(/scores must be an object/);
    expect(() => parseScoreInput({ scores: { impact: 1, tech: 1 }, privateComment: 'x'.repeat(2001) }, C)).toThrow(/at most 2000/);
    expect(() => parseScoreInput({ scores: {} }, [])).toThrow(/no criteria/);
  });

  it('readCriterionScores drops junk', () => {
    expect(readCriterionScores({ a: 1, b: 'x', c: null })).toEqual({ a: 1 });
    expect(readCriterionScores(null)).toEqual({});
    expect(readCriterionScores([1])).toEqual({});
  });
});

describe('leaderboard math', () => {
  const s = (judgeId: string, impact: number, tech: number, counted = true) => ({ judgeId, criterionScores: { impact, tech }, counted });

  it('mean of judge totals, count, spread, per-criterion means; removed judges not averaged', () => {
    const row = aggregateSubmission('p1', [s('j1', 4, 7), s('j2', 5, 10), s('j3', 1, 1, false)], C);
    expect(row).toEqual({
      submissionId: 'p1',
      average: 88.75, // (77.5 + 100) / 2
      scoreCount: 2,
      min: 77.5,
      max: 100,
      criterionAverages: { impact: 4.5, tech: 8.5 },
    });
  });

  it('unscored -> average null, count 0', () => {
    expect(aggregateSubmission('p', [], C)).toMatchObject({ average: null, scoreCount: 0, min: null, max: null, criterionAverages: { impact: null, tech: null } });
  });

  it('ties share a rank (1, 1, 3) and are flagged; unscored come last with rank null', () => {
    const rows = rankRows([
      { submissionId: 'c', average: 50, scoreCount: 1, min: 50, max: 50, criterionAverages: {} },
      { submissionId: 'none', average: null, scoreCount: 0, min: null, max: null, criterionAverages: {} },
      { submissionId: 'a', average: 80, scoreCount: 2, min: 80, max: 80, criterionAverages: {} },
      { submissionId: 'b', average: 80, scoreCount: 1, min: 80, max: 80, criterionAverages: {} },
    ]);
    expect(rows.map((r) => [r.submissionId, r.rank, r.tied])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['c', 3, false],
      ['none', null, false],
    ]);
  });

  it('overall + per track (a project in two tracks ranks in both)', () => {
    const subs = [{ id: 'p1', trackIds: ['t1', 't2'] }, { id: 'p2', trackIds: ['t1'] }, { id: 'p3', trackIds: [] }];
    const scores = new Map([['p1', [s('j1', 5, 10)]], ['p2', [s('j1', 1, 1)]]]);
    const lb = buildLeaderboard(subs, scores, C, ['t1', 't2', 't3']);
    expect(lb.overall.map((r) => [r.submissionId, r.rank])).toEqual([['p1', 1], ['p2', 2], ['p3', null]]);
    expect(lb.tracks.map((t) => [t.trackId, t.rows.map((r) => r.submissionId)])).toEqual([['t1', ['p1', 'p2']], ['t2', ['p1']], ['t3', []]]);
  });
});

describe('judge scope + conflicts', () => {
  it('scope: submitted only; tracks filter only when the judge has tracks', () => {
    expect(judgeScopeWhere('h', [])).toEqual({ hackathonId: 'h', status: 'submitted' });
    expect(judgeScopeWhere('h', ['t1'])).toEqual({ hackathonId: 'h', status: 'submitted', tracks: { some: { trackId: { in: ['t1'] } } } });
  });

  it('conflict when a member account or RSVP email is the judge email (case-insensitive)', () => {
    const sub = { team: { members: [{ user: { email: 'A@x.com' }, guest: null }, { user: { email: 'b@x.com' }, guest: { email: 'Judge@Y.com ' } }] } };
    expect(isConflicted(sub, 'a@x.com')).toBe(true);
    expect(isConflicted(sub, 'judge@y.com')).toBe(true);
    expect(isConflicted(sub, 'c@x.com')).toBe(false);
    expect(isConflicted({ team: null }, 'a@x.com')).toBe(false);
  });
});

describe('judge serializer (blind mode)', () => {
  const sub = {
    id: 's1', name: 'Slice', tagline: 'tl', description: 'd', tableNumber: 'A1', coverPath: 'c.png', screenshotPaths: ['s.png'],
    repoUrl: 'https://github.com/x', demoVideoUrl: 'https://youtu.be/x', deckUrl: null, liveUrl: 'https://x.app',
    tracks: [{ trackId: 't1' }], inviteCode: 'secretcode', status: 'submitted',
    team: { name: 'Crust', inviteCode: 'secretcode', members: [{ userId: 'u1', guestId: 'g1', user: { name: 'Alice', email: 'alice@x.com', profilePictureUrl: 'https://a' } }] },
  };
  const urls = { 'c.png': 'https://signed/c', 's.png': 'https://signed/s' };
  const score = { criterionScores: { a: 3 }, privateComment: 'pc', teamFeedback: 'tf', updatedAt: new Date('2027-01-01T00:00:00Z') };
  const json = (v: unknown) => JSON.stringify(v);

  it('blind, not yet scored: no team, no member names, no links', () => {
    const v = judgeSubmission(sub, { blind: true, urls, myScore: null, myTotal: null });
    expect(v.team).toBeNull();
    expect(v.teamName).toBeNull();
    expect(v.links).toBeNull();
    expect(v.linksLocked).toBe(true);
    const s = json(v);
    for (const leak of ['Crust', 'Alice', 'alice@x.com', 'github.com', 'youtu.be', 'x.app', 'secretcode', 'u1', 'g1']) expect(s).not.toContain(leak);
    expect(v.screenshots).toEqual([{ path: 's.png', url: 'https://signed/s' }]);
  });

  it('blind, scored by this judge: links unlock, names stay hidden', () => {
    const v = judgeSubmission(sub, { blind: true, urls, myScore: score, myTotal: 60 });
    expect(v.linksLocked).toBe(false);
    expect(v.links).toEqual({ repoUrl: 'https://github.com/x', demoVideoUrl: 'https://youtu.be/x', deckUrl: null, liveUrl: 'https://x.app' });
    expect(v.team).toBeNull();
    expect(json(v)).not.toContain('Alice');
    expect(v.myScore).toEqual({ criterionScores: { a: 3 }, total: 60, privateComment: 'pc', teamFeedback: 'tf', updatedAt: '2027-01-01T00:00:00.000Z' });
  });

  it('not blind: team name + member names/avatars and links, never emails or ids', () => {
    const v = judgeSubmission(sub, { blind: false, urls, myScore: null, myTotal: null });
    expect(v.team).toEqual({ name: 'Crust', members: [{ name: 'Alice', avatarUrl: 'https://a' }] });
    expect(v.links?.repoUrl).toBe('https://github.com/x');
    const s = json(v);
    for (const leak of ['alice@x.com', 'secretcode', '"u1"', '"g1"']) expect(s).not.toContain(leak);
  });

  it('queue item hides the team name when blind', () => {
    expect(judgeQueueItem(sub, { blind: true, urls, myScore: null, myTotal: null }).teamName).toBeNull();
    expect(judgeQueueItem(sub, { blind: false, urls, myScore: score, myTotal: 60 })).toMatchObject({ teamName: 'Crust', scored: true, myTotal: 60 });
  });
});
