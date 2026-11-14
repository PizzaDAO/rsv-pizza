import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { HackathonMe, HostHackathonTeam, MyHackathonTeam, PublicHackathon } from '../../lib/hackathonApi';

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, signIn: vi.fn() }) }));
const me = vi.hoisted(() => vi.fn());
vi.mock('../../lib/hackathonApi', async (orig) => {
  const real = await orig<typeof import('../../lib/hackathonApi')>();
  return { ...real, hackathonParticipantApi: { ...real.hackathonParticipantApi, me } };
});

import { ParticipantPanel, inviteLink } from './ParticipantPanel';
import { imageProblem } from './SubmissionForm';
import { filterTeams } from './TeamsSubmissionsSection';

const H: PublicHackathon = {
  rules: null, submissionsOpenAt: null, submissionDeadline: '2099-01-01T00:00:00Z', teamMinSize: 1, teamMaxSize: 4,
  maxTracksPerSubmission: 1, eligibility: 'registered', publishedAt: '2027-01-01T00:00:00Z',
  tracks: [{ id: 't1', name: 'DeFi', description: null, sponsorName: null, sortOrder: 0 }], prizes: [], criteria: [],
};
const baseMe: HackathonMe = {
  serverTime: '', deadlinePassed: false, loggedIn: true, eligibility: { eligible: true, reason: null }, isJudge: false, canManage: false, team: null,
};
const team: MyHackathonTeam = {
  id: 'team1', name: 'Crust Coders', inviteCode: 'abcdefgh23', memberCount: 2,
  members: [
    { id: 'm1', name: 'Alice', avatarUrl: null, role: 'captain', isMe: true, joinedAt: null },
    { id: 'm2', name: 'Bob', avatarUrl: null, role: 'member', isMe: false, joinedAt: null },
  ],
  submission: null,
};

const renderPanel = (path = '/e') =>
  render(<MemoryRouter initialEntries={[path]}><ParticipantPanel partyId="p1" hackathon={H} /></MemoryRouter>);

beforeEach(() => me.mockReset());

describe('ParticipantPanel', () => {
  it('logged out: log-in CTA', async () => {
    me.mockResolvedValue({ ...baseMe, loggedIn: false, eligibility: { eligible: false, reason: 'login' } });
    renderPanel();
    expect(await screen.findByTestId('hackathon-login')).toBeTruthy();
  });

  it('ineligible: explains why, no create button', async () => {
    me.mockResolvedValue({ ...baseMe, eligibility: { eligible: false, reason: 'pending_approval' } });
    renderPanel();
    expect((await screen.findByTestId('hackathon-ineligible')).textContent).toMatch(/waiting for host approval/);
    expect(screen.queryByTestId('hackathon-create-team')).toBeNull();
  });

  it('eligible without a team: create + join; ?hackJoin prefills the code', async () => {
    me.mockResolvedValue(baseMe);
    renderPanel('/e?hackJoin=abcdefgh23');
    await waitFor(() => expect(screen.getByDisplayValue('abcdefgh23')).toBeTruthy());
  });

  it('on a team: members, invite link, start project', async () => {
    me.mockResolvedValue({ ...baseMe, team });
    renderPanel();
    expect(await screen.findByText('Crust Coders')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByTestId('hackathon-invite-link').textContent).toContain('hackJoin=abcdefgh23');
    expect(screen.getByTestId('hackathon-edit-project').textContent).toMatch(/Start your project/);
  });

  it('after the deadline: read-only', async () => {
    me.mockResolvedValue({
      ...baseMe, deadlinePassed: true,
      team: { ...team, submission: { id: 's', name: 'App', slug: 'app', tagline: null, description: null, repoUrl: null, demoVideoUrl: null, deckUrl: null, liveUrl: null, trackIds: [], cover: null, screenshots: [], status: 'submitted', submittedAt: null, disqualifiedReason: null, tableNumber: null, createdAt: null, updatedAt: null } },
    });
    renderPanel();
    expect(await screen.findByText(/read-only/)).toBeTruthy();
    expect(screen.queryByTestId('hackathon-edit-project')).toBeNull();
    expect(screen.queryByTestId('hackathon-invite-link')).toBeNull();
  });
});

describe('helpers', () => {
  it('inviteLink keeps the event path and drops other params', () => {
    expect(inviteLink('abcdefgh23', 'https://monad.rsv.pizza/blitz?x=1#y')).toBe('https://monad.rsv.pizza/blitz?hackJoin=abcdefgh23');
  });
  it('imageProblem', () => {
    expect(imageProblem(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull();
    expect(imageProblem(new File(['x'], 'a.svg', { type: 'image/svg+xml' }))).toMatch(/JPEG/);
    const big = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    expect(imageProblem(big)).toMatch(/10 MB/);
  });
  it('filterTeams', () => {
    const mk = (id: string, status: string | null, email: string): HostHackathonTeam => ({
      id, name: `Team ${id}`, inviteCode: 'x', createdAt: null, memberCount: 1,
      members: [{ id: 'm', name: 'M', avatarUrl: null, role: 'captain', isMe: false, joinedAt: null, email, guestId: null }],
      submission: status ? ({ id: 's' + id, name: `Proj ${id}`, status, trackIds: [] } as any) : null,
    });
    const teams = [mk('a', 'submitted', 'a@x.com'), mk('b', 'draft', 'b@x.com'), mk('c', null, 'c@x.com'), mk('d', 'disqualified', 'd@x.com')];
    expect(filterTeams(teams, 'submitted', '').map((t) => t.id)).toEqual(['a']);
    expect(filterTeams(teams, 'none', '').map((t) => t.id)).toEqual(['c']);
    expect(filterTeams(teams, 'all', 'B@X').map((t) => t.id)).toEqual(['b']);
    expect(filterTeams(teams, 'disqualified', '').map((t) => t.id)).toEqual(['d']);
  });
});
