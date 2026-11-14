import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { myVoteIn, voteTrackFor, votingHeadline, type VoterState } from '../../lib/hackathonVotingApi';
import type { AwardsResponse } from '../../lib/hackathonApi';
import { VoteButton, VotingBanner, votingLive, type VotingHandle } from './VoteControls';
import { galleryWarning } from './VotingSection';
import { peoplesChoiceHint, rankedCandidates } from './WinnersSection';

vi.mock('../LoginModal', () => ({ LoginModal: () => null }));

const open = { status: 'open' as const, scope: 'event' as const, eligibility: 'checked_in' as const, opensAt: null, closesAt: null };
const state = (over: Partial<VoterState> = {}, me: Partial<NonNullable<VoterState['me']>> = {}): VoterState => ({
  voting: open,
  galleryOpen: true,
  tracks: [],
  me: { loggedIn: true, eligible: true, reason: null, message: null, votes: [], ownProjectSlugs: [], ...me },
  ...over,
});
const handle = (s: VoterState | null): VotingHandle => ({
  state: s, toggle: vi.fn(), busyKey: null, error: null, clearError: vi.fn(), showLogin: false, setShowLogin: vi.fn(),
});

describe('voting helpers (PR 7)', () => {
  it('voteTrackFor: event scope = null; track scope = filtered or only track, else ambiguous', () => {
    expect(voteTrackFor('event', ['t1', 't2'], 't1')).toBeNull();
    expect(voteTrackFor('track', ['t1'], null)).toBe('t1');
    expect(voteTrackFor('track', ['t1', 't2'], 't2')).toBe('t2');
    expect(voteTrackFor('track', ['t1', 't2'], null)).toBeUndefined();
    expect(voteTrackFor('track', ['t1', 't2'], 't9')).toBeUndefined();
  });
  it('myVoteIn matches the scope', () => {
    const votes = [{ trackId: null, projectSlug: 'a' }, { trackId: 't1', projectSlug: 'b' }];
    expect(myVoteIn(votes, null)?.projectSlug).toBe('a');
    expect(myVoteIn(votes, 't1')?.projectSlug).toBe('b');
    expect(myVoteIn(votes, 't2')).toBeNull();
  });
  it('headline per status; never mentions counts', () => {
    expect(votingHeadline(null)).toBeNull();
    expect(votingHeadline({ ...open, status: 'off' })).toBeNull();
    expect(votingHeadline({ ...open, status: 'scheduled' })).toMatch(/opens soon/);
    expect(votingHeadline(open)).toMatch(/change it until voting closes/);
    expect(votingHeadline({ ...open, scope: 'track' })).toMatch(/one vote per track/);
    expect(votingHeadline({ ...open, status: 'closed' })).toMatch(/closed/);
  });
  it('votingLive needs open voting AND an open gallery', () => {
    expect(votingLive(state())).toBe(true);
    expect(votingLive(state({ galleryOpen: false }))).toBe(false);
    expect(votingLive(state({ voting: { ...open, status: 'scheduled' } }))).toBe(false);
    expect(votingLive(null)).toBe(false);
  });
  it('host gallery warning', () => {
    expect(galleryWarning({ galleryOpen: true, galleryVisibility: 'after_reveal' })).toBeNull();
    expect(galleryWarning({ galleryOpen: false, galleryVisibility: 'hidden' })).toMatch(/hidden/);
    expect(galleryWarning({ galleryOpen: false, galleryVisibility: 'after_reveal' })).toMatch(/reveal/);
    expect(galleryWarning({ galleryOpen: false, galleryVisibility: 'after_deadline' })).toMatch(/deadline/);
  });
  it("People's Choice picker ranks by votes once voting is closed, and its hint follows the status", () => {
    const data: Pick<AwardsResponse, 'candidates' | 'ranking' | 'voting'> = {
      candidates: [
        { id: 'a', name: 'Alpha', tagline: null, teamName: null, trackIds: [], members: [] },
        { id: 'b', name: 'Bravo', tagline: null, teamName: null, trackIds: [], members: [] },
      ],
      ranking: { overall: [{ submissionId: 'a', rank: 1, tied: false, average: 90, scoreCount: 1 }], byTrack: [] },
      voting: { status: 'closed', ranking: { overall: [{ submissionId: 'b', votes: 7, rank: 1, tied: false }, { submissionId: 'a', votes: 2, rank: 2, tied: false }], byTrack: [] } },
    };
    expect(rankedCandidates({ trackId: null, kind: 'peoples_choice' }, data).map((o) => [o.c.id, o.r?.average])).toEqual([['b', 7], ['a', 2]]);
    expect(rankedCandidates({ trackId: null, kind: 'judged' }, data)[0].c.id).toBe('a');
    expect(peoplesChoiceHint('open')).toMatch(/Close voting/);
    expect(peoplesChoiceHint('closed')).toMatch(/public vote/);
    expect(peoplesChoiceHint(undefined)).toMatch(/pick the winner yourself/);
  });
});

describe('VoteButton / VotingBanner', () => {
  it('eligible voter: "Vote", then "Your vote" on their pick and "Switch vote" elsewhere', () => {
    const { rerender } = render(<VoteButton v={handle(state())} projectSlug="a" trackId={null} />);
    expect(screen.getByTestId('vote-button').textContent).toContain('Vote');
    rerender(<VoteButton v={handle(state({}, { votes: [{ trackId: null, projectSlug: 'a' }] }))} projectSlug="a" trackId={null} />);
    expect(screen.getByTestId('vote-button').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('vote-button').textContent).toContain('Your vote');
    rerender(<VoteButton v={handle(state({}, { votes: [{ trackId: null, projectSlug: 'a' }] }))} projectSlug="b" trackId={null} />);
    expect(screen.getByTestId('vote-button').textContent).toContain('Switch vote');
  });
  it('own project: no button; ineligible / logged out / closed: no button', () => {
    const { rerender, container } = render(<VoteButton v={handle(state({}, { ownProjectSlugs: ['a'] }))} projectSlug="a" trackId={null} />);
    expect(screen.queryByTestId('vote-button')).toBeNull();
    expect(screen.getByTestId('vote-own')).toBeTruthy();
    for (const s of [state({}, { eligible: false }), state({}, { loggedIn: false }), state({ voting: { ...open, status: 'closed' } })]) {
      rerender(<VoteButton v={handle(s)} projectSlug="a" trackId={null} />);
      expect(container.querySelector('[data-testid="vote-button"]')).toBeNull();
    }
  });
  it('banner: log-in button when logged out, the reason when ineligible', () => {
    const { rerender } = render(<VotingBanner v={handle(state({}, { loggedIn: false, eligible: false, reason: 'login' }))} />);
    expect(screen.getByTestId('voting-login')).toBeTruthy();
    rerender(<VotingBanner v={handle(state({}, { eligible: false, reason: 'not_checked_in', message: 'Voting is for checked-in attendees.' }))} />);
    expect(screen.getByTestId('voting-ineligible').textContent).toMatch(/checked-in/);
    rerender(<VotingBanner v={handle(state({ galleryOpen: false }))} />);
    expect(screen.queryByTestId('voting-banner')).toBeNull();
  });
});
