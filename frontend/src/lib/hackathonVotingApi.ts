// Hackathon public (People's Choice) voting (plans/hackathon-platform.md §3, PR 7).
// Backend: backend/src/routes/hackathon-voting.routes.ts (+ lib/hackathon/voting.ts).
// The public / voter shapes never carry vote counts; the host gets per-project tallies only
// once voting is closed.
import { apiRequest } from './api';
import type { IneligibleReason } from './hackathonApi';

export type VotingStatus = 'off' | 'scheduled' | 'open' | 'closed';
export type VotingScope = 'event' | 'track';
export type VotingEligibility = 'registered' | 'checked_in';

export interface PublicVoting {
  status: VotingStatus;
  scope: VotingScope;
  eligibility: VotingEligibility;
  opensAt: string | null;
  closesAt: string | null;
}

export interface MyVote {
  /** null = the event-wide vote */
  trackId: string | null;
  projectSlug: string;
}

export interface VoterState {
  voting: PublicVoting | null;
  galleryOpen: boolean;
  tracks: Array<{ id: string; name: string }>;
  me: null | {
    loggedIn: boolean;
    eligible: boolean;
    reason: IneligibleReason | null;
    message: string | null;
    votes: MyVote[];
    ownProjectSlugs: string[];
  };
  canManage?: boolean;
  /** POST only: true when an existing vote was changed. */
  changed?: boolean;
}

export interface TallyRow {
  submissionId: string;
  votes: number;
  rank: number | null;
  tied: boolean;
  name: string;
  slug: string;
  teamName: string | null;
}

export interface HostVotingSettings {
  enabled: boolean;
  scope: VotingScope;
  eligibility: VotingEligibility;
  opensAt: string | null;
  closesAt: string | null;
  status: VotingStatus;
}

export interface HostVoting {
  settings: HostVotingSettings;
  galleryOpen: boolean;
  galleryVisibility: 'hidden' | 'after_deadline' | 'after_reveal';
  resultsRevealedAt: string | null;
  tracks: Array<{ id: string; name: string }>;
  peoplesChoicePrizes: Array<{ id: string; name: string; trackId: string | null; quantity: number }>;
  totals: { votes: number; voters: number };
  ip: { buckets: Array<{ label: string; votes: number }>; bucketCount: number; unknownVotes: number };
  /** Only once voting is closed. */
  results: null | {
    countedVotes: number;
    overall: TallyRow[];
    byTrack: Array<{ trackId: string; rows: TallyRow[] }>;
    suggestions: Record<string, string[]>;
  };
  /** Writes only: e.g. turning voting on switched an 'after_reveal' gallery to 'after_deadline'. */
  notice?: string | null;
}

export type VotingSettingsInput = Partial<Pick<HostVotingSettings, 'enabled' | 'scope' | 'eligibility' | 'opensAt' | 'closesAt'>>;

const base = (partyId: string) => `/api/parties/${partyId}/hackathon`;

export const hackathonVotingApi = {
  state: (partyId: string) => apiRequest<VoterState>(`${base(partyId)}/voting`, { requireAuth: false }),
  vote: (partyId: string, projectSlug: string, trackId: string | null) =>
    apiRequest<VoterState>(`${base(partyId)}/votes`, { method: 'POST', body: { projectSlug, ...(trackId ? { trackId } : {}) } }),
  retract: (partyId: string, trackId: string | null) =>
    apiRequest<VoterState>(`${base(partyId)}/votes${trackId ? `?trackId=${encodeURIComponent(trackId)}` : ''}`, { method: 'DELETE' }),
};

export const hackathonVotingHostApi = {
  get: (partyId: string) => apiRequest<HostVoting>(`${base(partyId)}/voting/host`),
  update: (partyId: string, body: VotingSettingsInput) => apiRequest<HostVoting>(`${base(partyId)}/voting`, { method: 'PUT', body }),
  open: (partyId: string) => apiRequest<HostVoting>(`${base(partyId)}/voting/open`, { method: 'POST' }),
  close: (partyId: string) => apiRequest<HostVoting>(`${base(partyId)}/voting/close`, { method: 'POST' }),
};

// ---------------------------------------------------------------- helpers (unit-tested)

/** The track a vote button votes in: null in event scope; else the filtered / only track. */
export function voteTrackFor(scope: VotingScope, projectTrackIds: string[], filterTrackId: string | null): string | null | undefined {
  if (scope === 'event') return null;
  if (filterTrackId && projectTrackIds.includes(filterTrackId)) return filterTrackId;
  if (projectTrackIds.length === 1) return projectTrackIds[0];
  return undefined; // ambiguous: the card links to the project page, which shows one button per track
}

/** The voter's vote in a scope (event: trackId null). */
export function myVoteIn(votes: MyVote[] | undefined, trackId: string | null): MyVote | null {
  return (votes ?? []).find((v) => (v.trackId ?? null) === (trackId ?? null)) ?? null;
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One-line voting status for voters. */
export function votingHeadline(v: PublicVoting | null): string | null {
  if (!v || v.status === 'off') return null;
  if (v.status === 'scheduled') return v.opensAt ? `People's Choice voting opens ${fmtWhen(v.opensAt)}.` : "People's Choice voting opens soon.";
  if (v.status === 'closed') return "People's Choice voting has closed. Winners are announced with the results.";
  const scope = v.scope === 'track' ? 'one vote per track' : 'one vote';
  return `People's Choice voting is open${v.closesAt ? ` until ${fmtWhen(v.closesAt)}` : ''}: ${scope}, and you can change it until voting closes.`;
}

export const VOTING_STATUS_LABEL: Record<VotingStatus, string> = {
  off: 'Off',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
};
