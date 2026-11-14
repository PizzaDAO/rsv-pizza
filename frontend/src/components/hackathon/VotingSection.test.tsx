import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HostVoting } from '../../lib/hackathonVotingApi';

const api = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock('../../lib/hackathonVotingApi', async (orig) => ({
  ...(await orig<typeof import('../../lib/hackathonVotingApi')>()),
  hackathonVotingHostApi: api,
}));

import { VotingSection } from './VotingSection';

const NOTICE = 'Gallery now opens at the submission deadline so attendees can vote before winners are announced.';
const payload = (over: Partial<HostVoting> = {}, settings: Partial<HostVoting['settings']> = {}): HostVoting => ({
  settings: { enabled: false, scope: 'event', eligibility: 'checked_in', opensAt: null, closesAt: null, status: 'off', ...settings },
  galleryOpen: false,
  galleryVisibility: 'after_reveal',
  resultsRevealedAt: null,
  tracks: [],
  peoplesChoicePrizes: [],
  totals: { votes: 0, voters: 0 },
  ip: { buckets: [], bucketCount: 0, unknownVotes: 0 },
  results: null,
  ...over,
});

describe('VotingSection gallery auto-switch (PR 7)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explains the switch before voting is on, and shows the server notice after turning it on', async () => {
    api.get.mockResolvedValue(payload());
    api.open.mockResolvedValue({ ...payload({ galleryVisibility: 'after_deadline', galleryOpen: true }, { enabled: true, status: 'open' }), notice: NOTICE });
    render(<VotingSection partyId="p1" onOpenWinners={() => {}} onOpenSetup={() => {}} />);
    expect(await screen.findByText(/Turning voting on also makes the gallery open at the submission deadline/)).toBeTruthy();
    await userEvent.click(screen.getByTestId('voting-open'));
    expect((await screen.findByTestId('voting-notice')).textContent).toContain(NOTICE);
    expect(screen.queryByText(/Turning voting on also makes/)).toBeNull();
    expect(screen.queryByTestId('voting-gallery-warning')).toBeNull();
    await userEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByTestId('voting-notice')).toBeNull();
  });

  it('no notice when the server sends none; the after_reveal warning shows if the host set it back', async () => {
    api.get.mockResolvedValue(payload({}, { enabled: true, status: 'open' }));
    render(<VotingSection partyId="p1" onOpenWinners={() => {}} onOpenSetup={() => {}} />);
    expect((await screen.findByTestId('voting-gallery-warning')).textContent).toMatch(/open when you reveal the results/);
    expect(screen.queryByTestId('voting-notice')).toBeNull();
    expect(screen.queryByText(/Turning voting on also makes/)).toBeNull();
  });
});
