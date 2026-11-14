import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasRecordedPayout, ordinal, type AwardsResponse, type PublicWinner } from '../../lib/hackathonApi';
import { rankedCandidates } from './WinnersSection';
import { WinnersStrip } from './WinnersStrip';
import { TeamResults } from './TeamResults';

describe('hackathon winners helpers (PR 5)', () => {
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });

  it('hasRecordedPayout mirrors the backend delete guard', () => {
    expect(hasRecordedPayout({ payoutStatus: 'unpaid', paidAt: null, payoutReference: null })).toBe(false);
    expect(hasRecordedPayout({ payoutStatus: 'not_applicable', paidAt: null, payoutReference: null })).toBe(false);
    expect(hasRecordedPayout({ payoutStatus: 'pending', paidAt: null, payoutReference: null })).toBe(true);
    expect(hasRecordedPayout({ payoutStatus: 'unpaid', paidAt: null, payoutReference: '0x1' })).toBe(true);
  });

  it('rankedCandidates: track prizes only list that track, ranked first, unscored last', () => {
    const data: Pick<AwardsResponse, 'candidates' | 'ranking'> = {
      candidates: [
        { id: 'a', name: 'Alpha', tagline: null, teamName: null, trackIds: ['t1'], members: [] },
        { id: 'b', name: 'Bravo', tagline: null, teamName: null, trackIds: ['t2'], members: [] },
        { id: 'c', name: 'Charlie', tagline: null, teamName: null, trackIds: ['t1'], members: [] },
      ],
      ranking: {
        overall: [
          { submissionId: 'b', rank: 1, tied: false, average: 90, scoreCount: 2 },
          { submissionId: 'c', rank: 2, tied: false, average: 80, scoreCount: 2 },
        ],
        byTrack: [{ trackId: 't1', rows: [{ submissionId: 'c', rank: 1, tied: false, average: 80, scoreCount: 2 }] }],
      },
    };
    expect(rankedCandidates({ trackId: null }, data).map((o) => o.c.id)).toEqual(['b', 'c', 'a']);
    expect(rankedCandidates({ trackId: 't1' }, data).map((o) => o.c.id)).toEqual(['c', 'a']);
  });
});

describe('WinnersStrip / TeamResults', () => {
  const w: PublicWinner = {
    prizeId: 'p1', prizeName: 'Honorable mention', prizeAmount: '$500', prizeKind: 'judged', trackId: 't1', trackName: 'DeFi',
    place: 2, projectName: 'Slice Router', projectTagline: 'Split bills', teamName: 'Crust Coders',
  };
  it('renders prize, place (multi-quantity only), project, team and track', () => {
    render(<WinnersStrip winners={[w]} quantities={{ p1: 3 }} />);
    expect(screen.getByText('Honorable mention · 2nd')).toBeTruthy();
    expect(screen.getByText('Slice Router')).toBeTruthy();
    expect(screen.getByText('Crust Coders')).toBeTruthy();
    expect(screen.getByText('DeFi')).toBeTruthy();
  });
  it('renders nothing without winners', () => {
    const { container } = render(<WinnersStrip winners={[]} />);
    expect(container.innerHTML).toBe('');
  });
  it('team results: feedback list + recipient-only wallet line', () => {
    render(
      <TeamResults
        results={{
          revealedAt: '2027-03-07T00:00:00Z',
          feedback: ['Great demo.'],
          awards: [{ prizeName: 'Grand prize', prizeAmount: '$5,000', place: 1, payoutStatus: 'pending', isRecipient: true, recipientName: 'Alice', recipientWallet: '0xabc', payoutReference: null, paidAt: null }],
        }}
      />,
    );
    expect(screen.getByText('Great demo.')).toBeTruthy();
    expect(screen.getByText('Wallet: 0xabc')).toBeTruthy();
    expect(screen.getByText(/you are the recipient/)).toBeTruthy();
  });
  it('team results with no awards and no feedback', () => {
    render(<TeamResults results={{ revealedAt: 'x', feedback: [], awards: [] }} />);
    expect(screen.getByText(/didn't leave written feedback/)).toBeTruthy();
  });
});
