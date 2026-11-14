import { describe, it, expect } from 'vitest';
import { hackathonAutoStates } from './checklistRules.js';
import { eventEnd, hackathonDefaults } from './defaults.js';
import { parseJudge, parseSettings, normalizeEmail, parseTrack, parsePrize, parseCriterion } from './validate.js';
import { hostHackathon, isPubliclyVisible, publicHackathon } from './serialize.js';

const base = {
  publishedAt: new Date(),
  disabledAt: null,
  submissionDeadline: new Date(),
  trackCount: 1,
  prizeCount: 1,
  criterionCount: 1,
  activeJudgeCount: 1,
};

describe('hackathon checklist auto rules', () => {
  it('all three done on a complete setup', () => {
    expect(hackathonAutoStates(base)).toEqual({
      hackathon_published: true,
      hackathon_submissions_ready: true,
      hackathon_judges_added: true,
      hackathon_judging_closed: false,
      hackathon_results_revealed: false,
      hackathon_prizes_paid: false,
    });
  });

  it('PR 5: results revealed; prizes paid needs >= 1 award and none unpaid / pending', () => {
    expect(hackathonAutoStates({ ...base, resultsRevealedAt: new Date() }).hackathon_results_revealed).toBe(true);
    expect(hackathonAutoStates({ ...base, resultsRevealedAt: null }).hackathon_results_revealed).toBe(false);
    expect(hackathonAutoStates({ ...base, resultsRevealedAt: new Date(), disabledAt: new Date() }).hackathon_results_revealed).toBe(false);
    expect(hackathonAutoStates({ ...base, awardCount: 3, openPayoutCount: 0 }).hackathon_prizes_paid).toBe(true);
    expect(hackathonAutoStates({ ...base, awardCount: 3, openPayoutCount: 1 }).hackathon_prizes_paid).toBe(false);
    // Zero awards is not "all prizes sent".
    expect(hackathonAutoStates({ ...base, awardCount: 0, openPayoutCount: 0 }).hackathon_prizes_paid).toBe(false);
    // Older callers without counts: not done.
    expect(hackathonAutoStates(base).hackathon_prizes_paid).toBe(false);
  });

  it('judging closed only when judging_status = closed', () => {
    expect(hackathonAutoStates({ ...base, judgingStatus: 'closed' }).hackathon_judging_closed).toBe(true);
    expect(hackathonAutoStates({ ...base, judgingStatus: 'open' }).hackathon_judging_closed).toBe(false);
    expect(hackathonAutoStates({ ...base, judgingStatus: 'closed', disabledAt: new Date() }).hackathon_judging_closed).toBe(false);
  });

  it('published needs published_at AND >= 1 track AND >= 1 prize', () => {
    expect(hackathonAutoStates({ ...base, publishedAt: null }).hackathon_published).toBe(false);
    expect(hackathonAutoStates({ ...base, trackCount: 0 }).hackathon_published).toBe(false);
    expect(hackathonAutoStates({ ...base, prizeCount: 0 }).hackathon_published).toBe(false);
  });

  it('submissions ready needs a deadline AND >= 1 rubric criterion', () => {
    expect(hackathonAutoStates({ ...base, submissionDeadline: null }).hackathon_submissions_ready).toBe(false);
    expect(hackathonAutoStates({ ...base, criterionCount: 0 }).hackathon_submissions_ready).toBe(false);
  });

  it('judges added needs >= 1 active judge', () => {
    expect(hackathonAutoStates({ ...base, activeJudgeCount: 0 }).hackathon_judges_added).toBe(false);
  });

  it('missing or disabled hackathon completes nothing', () => {
    const none = {
      hackathon_published: false, hackathon_submissions_ready: false, hackathon_judges_added: false, hackathon_judging_closed: false,
      hackathon_results_revealed: false, hackathon_prizes_paid: false,
    };
    expect(hackathonAutoStates(null)).toEqual(none);
    expect(hackathonAutoStates({ ...base, disabledAt: new Date() })).toEqual(none);
  });
});

describe('hackathon defaults', () => {
  it('deadline = end time, else start + duration, else null', () => {
    expect(eventEnd({ endTime: new Date('2027-01-02T00:00:00Z') })?.toISOString()).toBe('2027-01-02T00:00:00.000Z');
    expect(eventEnd({ date: new Date('2027-01-01T10:00:00Z'), duration: 2.5 })?.toISOString()).toBe('2027-01-01T12:30:00.000Z');
    expect(eventEnd({ date: new Date('2027-01-01T10:00:00Z') })).toBeNull();
  });

  it('plan defaults: team 1-5, 1 track, registered, blind off, after_reveal', () => {
    expect(hackathonDefaults({})).toEqual({
      submissionDeadline: null, teamMinSize: 1, teamMaxSize: 5, maxTracksPerSubmission: 1,
      eligibility: 'registered', blindJudging: false, galleryVisibility: 'after_reveal',
    });
  });
});

describe('validation', () => {
  const cur = { teamMinSize: 1, teamMaxSize: 5, submissionsOpenAt: null, submissionDeadline: null, publishedAt: null };

  it('cross-field checks use the stored value for fields not sent', () => {
    expect(() => parseSettings({ teamMinSize: 6 }, cur)).toThrow(/Maximum team size/);
    expect(parseSettings({ teamMinSize: 6, teamMaxSize: 6 }, cur)).toEqual({ teamMinSize: 6, teamMaxSize: 6 });
  });

  it('publish keeps the original published_at; unpublish clears it', () => {
    const at = new Date('2027-01-01T00:00:00Z');
    expect(parseSettings({ published: true }, { ...cur, publishedAt: at }).publishedAt).toBe(at);
    expect(parseSettings({ published: false }, { ...cur, publishedAt: at }).publishedAt).toBeNull();
  });

  it('empty rules become null', () => {
    expect(parseSettings({ rules: '   ' }, cur)).toEqual({ rules: null });
  });

  it('NUL characters are rejected in every text input (Postgres text cannot store them)', () => {
    expect(() => parseSettings({ rules: 'ok\u0000bad' }, cur)).toThrow(/invalid character/);
    expect(() => parseTrack({ name: 'a\u0000' }, false)).toThrow(/invalid character/);
    expect(() => parsePrize({ name: 'P', amountText: '\u0000' }, false)).toThrow(/invalid character/);
    expect(() => parseCriterion({ name: 'C', description: 'x\u0000' }, false)).toThrow(/invalid character/);
    expect(() => parseJudge({ email: 'a@b.co', name: '\u0000' }, false)).toThrow(/invalid character/);
    expect(() => normalizeEmail('a\u0000@b.co')).toThrow();
  });

  it('dates must be within 1970-9999', () => {
    expect(() => parseSettings({ submissionDeadline: '1969-12-31T23:59:59Z' }, cur)).toThrow(/1970 and 9999/);
    expect(() => parseSettings({ submissionDeadline: '+010000-01-01T00:00:00Z' }, cur)).toThrow(/1970 and 9999/);
    expect(() => parseSettings({ submissionsOpenAt: '0001-01-01T00:00:00Z' }, cur)).toThrow(/1970 and 9999/);
    expect(parseSettings({ submissionDeadline: '2027-03-06T23:00:00Z' }, cur).submissionDeadline).toEqual(new Date('2027-03-06T23:00:00Z'));
  });

  it('emails are trimmed + lowercased and must look like an email', () => {
    expect(normalizeEmail('  A@B.Co ')).toBe('a@b.co');
    expect(() => normalizeEmail('a@b')).toThrow();
    expect(() => normalizeEmail(42)).toThrow();
  });

  it('judge trackIds are deduped; non-uuids rejected', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    expect(parseJudge({ email: 'a@b.co', trackIds: [id, id] }, false).trackIds).toEqual([id]);
    expect(() => parseJudge({ email: 'a@b.co', trackIds: ['x'] }, false)).toThrow();
  });
});

describe('serializers', () => {
  const row = {
    id: 'h1', partyId: 'p1', rules: 'r', submissionsOpenAt: null, submissionDeadline: null, teamMinSize: 1, teamMaxSize: 5,
    maxTracksPerSubmission: 1, eligibility: 'registered', blindJudging: false, judgingStatus: 'open', galleryVisibility: 'after_reveal',
    publishedAt: new Date(), resultsRevealedAt: null, disabledAt: null, createdAt: new Date(), updatedAt: new Date(),
    secretFutureColumn: 'LEAK',
    tracks: [{ id: 't2', name: 'B', sortOrder: 1, hackathonId: 'h1', secret: 'LEAK' }, { id: 't1', name: 'A', sortOrder: 0, hackathonId: 'h1' }],
    prizes: [], criteria: [],
    judges: [{ id: 'j1', email: 'j@x.co', userId: 'USERID', status: 'active', tracks: [] }],
  };

  it('public: allowlisted fields only, sorted tracks, no unknown columns', () => {
    const out = JSON.stringify(publicHackathon(row));
    expect(out).not.toContain('LEAK');
    expect(out).not.toContain('j@x.co');
    expect(out).not.toContain('h1');
    expect(publicHackathon(row).tracks.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('host: judges with emails, never the judge user id or unknown columns', () => {
    const out = JSON.stringify(hostHackathon(row));
    expect(out).toContain('j@x.co');
    expect(out).not.toContain('USERID');
    expect(out).not.toContain('LEAK');
    expect(hostHackathon(row).judges[0].trackIds).toEqual([]);
  });

  it('visible only when published and not disabled', () => {
    expect(isPubliclyVisible(row)).toBe(true);
    expect(isPubliclyVisible({ ...row, publishedAt: null })).toBe(false);
    expect(isPubliclyVisible({ ...row, disabledAt: new Date() })).toBe(false);
    expect(isPubliclyVisible(null)).toBe(false);
  });
});
