// Hackathon platform (plans/hackathon-platform.md): host setup + public read.
// Backend: backend/src/routes/hackathon.routes.ts, hackathon-public.routes.ts.
import { apiRequest } from './api';
import { supabase } from './supabase';

export type HackathonEligibility = 'registered' | 'checked_in';
export type GalleryVisibility = 'hidden' | 'after_deadline' | 'after_reveal';
export type PrizeKind = 'judged' | 'peoples_choice';

export interface HackathonTrack {
  id: string;
  name: string;
  description: string | null;
  sponsorName: string | null;
  sortOrder: number;
}

export interface HackathonPrize {
  id: string;
  trackId: string | null;
  name: string;
  description: string | null;
  rank: number | null;
  amountText: string | null;
  amountValue: number | null;
  currency: string | null;
  quantity: number;
  kind: PrizeKind;
  sortOrder: number;
}

export interface HackathonCriterion {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  maxScore: number;
  sortOrder: number;
}

export interface HackathonJudge {
  id: string;
  email: string;
  name: string | null;
  status: 'active' | 'removed';
  /** Empty = judges every track. */
  trackIds: string[];
  linked: boolean;
  createdAt: string | null;
}

/** One revealed winner on the event page (PR 5). No recipient / payout data, ever. */
export interface PublicWinner {
  prizeId: string;
  prizeName: string;
  prizeAmount: string | null;
  prizeKind: PrizeKind;
  trackId: string | null;
  trackName: string | null;
  place: number | null;
  projectName: string;
  /** PR 6: the project's gallery page slug (/:slug/projects/:projectSlug). */
  projectSlug?: string | null;
  projectTagline: string | null;
  teamName: string | null;
}

/** Event-page shape (published only). */
export interface PublicHackathon {
  rules: string | null;
  submissionsOpenAt: string | null;
  submissionDeadline: string | null;
  teamMinSize: number;
  teamMaxSize: number;
  maxTracksPerSubmission: number;
  eligibility: HackathonEligibility;
  publishedAt: string | null;
  tracks: HackathonTrack[];
  prizes: HackathonPrize[];
  criteria: HackathonCriterion[];
  /** PR 5: set once the host reveals results; winners is [] before that. */
  resultsRevealedAt?: string | null;
  winners?: PublicWinner[];
  /** PR 6: the public project gallery (/:slug/projects) is open per the host's gallery setting. */
  galleryOpen?: boolean;
}

/** Host / co-host / admin shape. */
export interface HostHackathon extends PublicHackathon {
  id: string;
  partyId: string;
  enabled: boolean;
  disabledAt: string | null;
  blindJudging: boolean;
  judgingStatus: 'not_started' | 'open' | 'closed';
  galleryVisibility: GalleryVisibility;
  resultsRevealedAt: string | null;
  judges: HackathonJudge[];
}

export interface HackathonResponse<T = HostHackathon | PublicHackathon> {
  hackathon: T | null;
  canManage: boolean;
  softRemoved?: boolean;
}

export type HackathonSettingsInput = Partial<{
  rules: string | null;
  submissionsOpenAt: string | null;
  submissionDeadline: string | null;
  teamMinSize: number;
  teamMaxSize: number;
  maxTracksPerSubmission: number;
  eligibility: HackathonEligibility;
  blindJudging: boolean;
  galleryVisibility: GalleryVisibility;
  published: boolean;
}>;

export type TrackInput = Partial<Pick<HackathonTrack, 'name' | 'description' | 'sponsorName' | 'sortOrder'>>;
export type PrizeInput = Partial<Omit<HackathonPrize, 'id'>>;
export type CriterionInput = Partial<Omit<HackathonCriterion, 'id'>>;
export type JudgeInput = Partial<{ email: string; name: string | null; status: 'active' | 'removed'; trackIds: string[] }>;

const base = (partyId: string) => `/api/parties/${partyId}/hackathon`;
type HostRes = HackathonResponse<HostHackathon>;

/** Public read; hosts get the full setup (canManage). Works logged out. */
export function getHackathon(partyId: string) {
  return apiRequest<HackathonResponse>(base(partyId), { requireAuth: false });
}

export const hackathonHostApi = {
  get: (partyId: string) => apiRequest<HostRes>(base(partyId)),
  enable: (partyId: string) => apiRequest<HostRes>(`${base(partyId)}/enable`, { method: 'POST' }),
  disable: (partyId: string) => apiRequest<HostRes>(base(partyId), { method: 'DELETE' }),
  updateSettings: (partyId: string, body: HackathonSettingsInput) => apiRequest<HostRes>(base(partyId), { method: 'PUT', body }),

  addTrack: (partyId: string, body: TrackInput) => apiRequest<HostRes>(`${base(partyId)}/tracks`, { method: 'POST', body }),
  updateTrack: (partyId: string, id: string, body: TrackInput) => apiRequest<HostRes>(`${base(partyId)}/tracks/${id}`, { method: 'PATCH', body }),
  deleteTrack: (partyId: string, id: string) => apiRequest<HostRes>(`${base(partyId)}/tracks/${id}`, { method: 'DELETE' }),

  addPrize: (partyId: string, body: PrizeInput) => apiRequest<HostRes>(`${base(partyId)}/prizes`, { method: 'POST', body }),
  updatePrize: (partyId: string, id: string, body: PrizeInput) => apiRequest<HostRes>(`${base(partyId)}/prizes/${id}`, { method: 'PATCH', body }),
  deletePrize: (partyId: string, id: string) => apiRequest<HostRes>(`${base(partyId)}/prizes/${id}`, { method: 'DELETE' }),

  addCriterion: (partyId: string, body: CriterionInput) => apiRequest<HostRes>(`${base(partyId)}/criteria`, { method: 'POST', body }),
  updateCriterion: (partyId: string, id: string, body: CriterionInput) => apiRequest<HostRes>(`${base(partyId)}/criteria/${id}`, { method: 'PATCH', body }),
  deleteCriterion: (partyId: string, id: string) => apiRequest<HostRes>(`${base(partyId)}/criteria/${id}`, { method: 'DELETE' }),

  addJudge: (partyId: string, body: JudgeInput) => apiRequest<HostRes>(`${base(partyId)}/judges`, { method: 'POST', body }),
  updateJudge: (partyId: string, id: string, body: JudgeInput) => apiRequest<HostRes>(`${base(partyId)}/judges/${id}`, { method: 'PATCH', body }),
  deleteJudge: (partyId: string, id: string) => apiRequest<HostRes>(`${base(partyId)}/judges/${id}`, { method: 'DELETE' }),
};

/** `datetime-local` value (viewer's local time) <-> ISO. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------- teams + submissions (PR 3)
// Backend: backend/src/routes/hackathon-participant.routes.ts (+ host list/moderation/CSV in
// hackathon.routes.ts). Images go straight to the private `hackathon-media` bucket with a
// signed upload token; the API only ever returns short-lived signed read URLs.

export type SubmissionStatus = 'draft' | 'submitted' | 'withdrawn' | 'disqualified';
export type IneligibleReason =
  | 'login' | 'not_available' | 'judge' | 'no_rsvp' | 'declined' | 'pending_approval' | 'waitlisted' | 'not_checked_in';

export interface HackathonImage { path: string; url: string | null }

export interface HackathonSubmission {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  repoUrl: string | null;
  demoVideoUrl: string | null;
  deckUrl: string | null;
  liveUrl: string | null;
  trackIds: string[];
  cover: HackathonImage | null;
  screenshots: HackathonImage[];
  status: SubmissionStatus;
  submittedAt: string | null;
  disqualifiedReason: string | null;
  tableNumber: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface HackathonTeamMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: 'captain' | 'member';
  isMe: boolean;
  joinedAt: string | null;
}

export interface MyHackathonTeam {
  id: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  members: HackathonTeamMember[];
  submission: HackathonSubmission | null;
}

export interface HostHackathonTeam extends Omit<MyHackathonTeam, 'members'> {
  createdAt: string | null;
  members: Array<HackathonTeamMember & { email: string | null; guestId: string | null }>;
}

export interface HackathonMe {
  serverTime: string;
  deadlinePassed: boolean;
  loggedIn: boolean;
  eligibility: { eligible: boolean; reason: IneligibleReason | null };
  isJudge: boolean;
  canManage: boolean;
  team: MyHackathonTeam | null;
  /** PR 5: after the reveal, the team's own awards + judge feedback (text only). */
  results?: TeamResults | null;
}

export type PayoutStatus = 'unpaid' | 'pending' | 'paid' | 'not_applicable';

export interface TeamAward {
  prizeName: string;
  prizeAmount: string | null;
  place: number | null;
  payoutStatus: PayoutStatus;
  isRecipient: boolean;
  recipientName: string | null;
  /** Only filled in for the recipient. */
  recipientWallet: string | null;
  payoutReference: string | null;
  paidAt: string | null;
}

export interface TeamResults {
  revealedAt: string;
  awards: TeamAward[];
  feedback: string[];
}

export type SubmissionInput = Partial<{
  name: string;
  tagline: string | null;
  description: string | null;
  repoUrl: string | null;
  demoVideoUrl: string | null;
  deckUrl: string | null;
  liveUrl: string | null;
  trackIds: string[];
}>;

export const HACKATHON_MEDIA_BUCKET = 'hackathon-media';
export const HACKATHON_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
export const HACKATHON_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const HACKATHON_MAX_SCREENSHOTS = 6;

type TeamRes = { team: MyHackathonTeam | null };
const teamBase = (partyId: string, teamId: string) => `${base(partyId)}/teams/${teamId}`;

export const hackathonParticipantApi = {
  me: (partyId: string) => apiRequest<HackathonMe>(`${base(partyId)}/me`, { requireAuth: false }),
  createTeam: (partyId: string, name: string) => apiRequest<TeamRes>(`${base(partyId)}/teams`, { method: 'POST', body: { name } }),
  joinTeam: (partyId: string, code: string) => apiRequest<TeamRes>(`${base(partyId)}/teams/join`, { method: 'POST', body: { code } }),
  leaveTeam: (partyId: string, teamId: string) => apiRequest<TeamRes>(`${teamBase(partyId, teamId)}/leave`, { method: 'POST' }),
  renameTeam: (partyId: string, teamId: string, name: string) => apiRequest<TeamRes>(teamBase(partyId, teamId), { method: 'PATCH', body: { name } }),
  removeMember: (partyId: string, teamId: string, memberId: string) =>
    apiRequest<TeamRes>(`${teamBase(partyId, teamId)}/members/${memberId}`, { method: 'DELETE' }),
  regenerateCode: (partyId: string, teamId: string) => apiRequest<TeamRes>(`${teamBase(partyId, teamId)}/regenerate-code`, { method: 'POST' }),
  saveSubmission: (partyId: string, teamId: string, body: SubmissionInput) =>
    apiRequest<TeamRes>(`${teamBase(partyId, teamId)}/submission`, { method: 'PUT', body }),
  submit: (partyId: string, teamId: string) => apiRequest<TeamRes>(`${teamBase(partyId, teamId)}/submission/submit`, { method: 'POST' }),
  withdraw: (partyId: string, teamId: string) => apiRequest<TeamRes>(`${teamBase(partyId, teamId)}/submission/withdraw`, { method: 'POST' }),
  removeImage: (partyId: string, teamId: string, path: string) =>
    apiRequest<TeamRes>(`${teamBase(partyId, teamId)}/submission/images`, { method: 'DELETE', body: { path } }),

  /** Signed upload, then attach (the server verifies the bytes and moves the file). */
  async uploadImage(partyId: string, teamId: string, file: File, kind: 'cover' | 'screenshot'): Promise<TeamRes> {
    const target = await apiRequest<{ path: string; token: string }>(`${teamBase(partyId, teamId)}/submission/upload-url`, {
      method: 'POST',
      body: { mimeType: file.type, fileSize: file.size, kind },
    });
    const up = await supabase.storage.from(HACKATHON_MEDIA_BUCKET).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
    if (up.error) throw new Error('The upload failed. Please try again.');
    return apiRequest<TeamRes>(`${teamBase(partyId, teamId)}/submission/images`, { method: 'POST', body: { path: target.path, kind } });
  },
};

export interface HostSubmissionsResponse {
  teams: HostHackathonTeam[];
  counts: { teams: number; draft: number; submitted: number; withdrawn: number; disqualified: number };
}

export const hackathonModerationApi = {
  list: (partyId: string) => apiRequest<HostSubmissionsResponse>(`${base(partyId)}/submissions`),
  moderate: (partyId: string, submissionId: string, body: { action?: 'disqualify' | 'restore'; reason?: string; tableNumber?: string | null }) =>
    apiRequest<{ team: HostHackathonTeam | null }>(`${base(partyId)}/submissions/${submissionId}`, { method: 'PATCH', body }),

  /** Downloads the CSV through the authenticated API (a plain link can't send the token). */
  async exportCsv(partyId: string, kind: 'projects' | 'members' | 'awards'): Promise<void> {
    const token = localStorage.getItem('authToken');
    if (!token) throw new Error('Not authenticated');
    const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
    const res = await fetch(`${apiUrl}${base(partyId)}/export.csv?kind=${kind}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hackathon-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// ---------------------------------------------------------------- judging (PR 4)
// Backend: backend/src/routes/hackathon-judge.routes.ts + hackathon.routes.ts (judging,
// leaderboard). Blind mode is enforced server-side: teamName / team / links come back null.

export type JudgingStatus = 'not_started' | 'open' | 'closed';

export interface JudgeQueueItem {
  id: string;
  name: string;
  tagline: string | null;
  trackIds: string[];
  tableNumber: string | null;
  cover: HackathonImage | null;
  /** null while blind judging is on. */
  teamName: string | null;
  scored: boolean;
  myTotal: number | null;
  scoredAt: string | null;
}

export interface JudgeMyScore {
  criterionScores: Record<string, number>;
  total: number | null;
  privateComment: string | null;
  teamFeedback: string | null;
  updatedAt: string | null;
}

export interface JudgeSubmission extends JudgeQueueItem {
  description: string | null;
  screenshots: HackathonImage[];
  /** Blind mode: true until this judge saves a score. */
  linksLocked: boolean;
  links: { repoUrl: string | null; demoVideoUrl: string | null; deckUrl: string | null; liveUrl: string | null } | null;
  team: { name: string; members: Array<{ name: string; avatarUrl: string | null }> } | null;
  myScore: JudgeMyScore | null;
}

export interface JudgeQueueResponse {
  judge: { name: string | null; trackIds: string[] };
  judgingStatus: JudgingStatus;
  blindJudging: boolean;
  criteria: HackathonCriterion[];
  tracks: HackathonTrack[];
  queue: JudgeQueueItem[];
  progress: { scored: number; total: number };
  /** Submitted projects hidden because the judge is on that team (conflict of interest). */
  ownTeamHidden?: number;
}

export interface JudgeSubmissionResponse {
  judgingStatus: JudgingStatus;
  blindJudging: boolean;
  submission: JudgeSubmission;
}

export interface ScoreInput {
  scores: Record<string, number>;
  privateComment?: string | null;
  teamFeedback?: string | null;
}

const judgeBase = (partyId: string) => `/api/hackathon-judge/${partyId}`;

export const hackathonJudgeApi = {
  queue: (partyId: string) => apiRequest<JudgeQueueResponse>(`${judgeBase(partyId)}/queue`),
  submission: (partyId: string, id: string) => apiRequest<JudgeSubmissionResponse>(`${judgeBase(partyId)}/submissions/${id}`),
  score: (partyId: string, id: string, body: ScoreInput) =>
    apiRequest<JudgeSubmissionResponse>(`${judgeBase(partyId)}/submissions/${id}/score`, { method: 'PUT', body }),
};

/** Same math as backend lib/hackathon/scoring.ts computeTotal (live preview in the form). */
export function weightedTotal(scores: Record<string, number>, criteria: Pick<HackathonCriterion, 'id' | 'weight' | 'maxScore'>[]): number | null {
  let num = 0;
  let den = 0;
  for (const c of criteria) {
    const s = scores[c.id];
    if (typeof s !== 'number' || c.maxScore <= 0) continue;
    num += c.weight * (Math.min(Math.max(s, 0), c.maxScore) / c.maxScore);
    den += c.weight;
  }
  return den === 0 ? null : Math.round((10000 * num) / den) / 100;
}

export interface LeaderboardRow {
  submissionId: string;
  average: number | null;
  scoreCount: number;
  min: number | null;
  max: number | null;
  criterionAverages: Record<string, number | null>;
  rank: number | null;
  tied: boolean;
}

export interface LeaderboardScore {
  judgeId: string;
  judgeName: string | null;
  judgeEmail: string | null;
  /** false = removed judge (listed, not averaged). */
  counted: boolean;
  total: number | null;
  criterionScores: Record<string, number>;
  privateComment: string | null;
  teamFeedback: string | null;
  updatedAt: string | null;
}

export interface LeaderboardProject {
  id: string;
  name: string;
  tagline: string | null;
  teamName: string | null;
  trackIds: string[];
  tableNumber: string | null;
  scores: LeaderboardScore[];
}

export interface JudgeProgress {
  id: string;
  name: string | null;
  email: string;
  status: 'active' | 'removed';
  trackIds: string[];
  linked: boolean;
  assigned: number;
  scored: number;
  lastScoredAt: string | null;
}

export interface LeaderboardResponse {
  judgingStatus: JudgingStatus;
  blindJudging: boolean;
  criteria: HackathonCriterion[];
  tracks: HackathonTrack[];
  overall: LeaderboardRow[];
  byTrack: Array<{ trackId: string; rows: LeaderboardRow[] }>;
  projects: Record<string, LeaderboardProject>;
  judges: JudgeProgress[];
}

export const hackathonJudgingHostApi = {
  setJudging: (partyId: string, status: 'open' | 'closed') =>
    apiRequest<HostRes>(`${base(partyId)}/judging`, { method: 'POST', body: { status } }),
  leaderboard: (partyId: string) => apiRequest<LeaderboardResponse>(`${base(partyId)}/leaderboard`),
};

/** Copyable judge link (plans §10: no judge-invite email; the host shares it). */
export function judgeLink(inviteCode: string): string {
  return `${window.location.origin}/judge/${inviteCode}`;
}

export function eligibilityMessage(reason: IneligibleReason | null): string {
  switch (reason) {
    case 'login': return "Log in with the email you RSVP'd with to join the hackathon.";
    case 'judge': return "You're a judge for this hackathon, so you can't join a team.";
    case 'no_rsvp': return "We couldn't find an RSVP for your email. RSVP first, or log in with the email you RSVP'd with.";
    case 'declined': return "Your RSVP wasn't approved, so you can't join the hackathon.";
    case 'pending_approval': return "Your RSVP is waiting for host approval. You can join a team once it's approved.";
    case 'waitlisted': return "You're on the waitlist. You can join a team once you're off it.";
    case 'not_checked_in': return 'Check in at the event to join a team.';
    case 'not_available': return 'The hackathon is not open yet.';
    default: return '';
  }
}

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  withdrawn: 'Withdrawn',
  disqualified: 'Disqualified',
};

/** "$5,000", "2,500 USDC", or a formatted value + currency. */
export function prizeAmount(p: Pick<HackathonPrize, 'amountText' | 'amountValue' | 'currency'>): string | null {
  if (p.amountText) return p.amountText;
  if (p.amountValue != null) return `${p.amountValue.toLocaleString()}${p.currency ? ` ${p.currency}` : ''}`;
  return null;
}

// ---------------------------------------------------------------- winners + payouts (PR 5)
// Backend: backend/src/routes/hackathon-awards.routes.ts (host only). Payout tracking is
// bookkeeping only: no money moves from here.

export interface HostAward {
  id: string;
  prizeId: string;
  submissionId: string;
  place: number | null;
  awardedAt: string | null;
  projectName: string | null;
  projectStatus: SubmissionStatus | null;
  teamId: string | null;
  teamName: string | null;
  payoutStatus: PayoutStatus;
  recipient: { name: string | null; email: string | null } | null;
  /** Team member row of the recipient (for the picker), when still on the team. */
  recipientMemberId: string | null;
  recipientWallet: string | null;
  payoutReference: string | null;
  paidAt: string | null;
  payoutNotes: string | null;
  updatedAt: string | null;
}

export interface AwardCandidate {
  id: string;
  name: string;
  tagline: string | null;
  teamName: string | null;
  trackIds: string[];
  members: Array<{ id: string; name: string; email: string | null; role: 'captain' | 'member' }>;
}

export interface RankEntry { submissionId: string; rank: number | null; tied: boolean; average: number | null; scoreCount: number }

export interface AwardsResponse {
  judgingStatus: JudgingStatus;
  resultsRevealedAt: string | null;
  tracks: HackathonTrack[];
  prizes: HackathonPrize[];
  awards: HostAward[];
  candidates: AwardCandidate[];
  /** prizeId -> suggested submission ids: judged prizes from the leaderboard, People's Choice from the closed vote. */
  suggestions: Record<string, string[]>;
  ranking: { overall: RankEntry[]; byTrack: Array<{ trackId: string; rows: RankEntry[] }> };
  /** PR 7: public voting status; the vote ranking only once voting is closed (and a People's Choice prize exists). */
  voting?: { status: 'off' | 'scheduled' | 'open' | 'closed'; ranking: { overall: VoteRankEntry[]; byTrack: Array<{ trackId: string; rows: VoteRankEntry[] }> } | null };
}

export interface VoteRankEntry { submissionId: string; votes: number; rank: number | null; tied: boolean }

export type PayoutInput = Partial<{
  status: PayoutStatus;
  recipientMemberId: string | null;
  recipientWallet: string | null;
  payoutReference: string | null;
  paidAt: string | null;
  payoutNotes: string | null;
}>;

export const hackathonAwardsApi = {
  list: (partyId: string) => apiRequest<AwardsResponse>(`${base(partyId)}/awards`),
  create: (partyId: string, prizeId: string, submissionId: string) =>
    apiRequest<AwardsResponse>(`${base(partyId)}/awards`, { method: 'POST', body: { prizeId, submissionId } }),
  updatePayout: (partyId: string, awardId: string, body: PayoutInput) =>
    apiRequest<AwardsResponse>(`${base(partyId)}/awards/${awardId}/payout`, { method: 'PATCH', body }),
  remove: (partyId: string, awardId: string) => apiRequest<AwardsResponse>(`${base(partyId)}/awards/${awardId}`, { method: 'DELETE' }),
  reveal: (partyId: string) => apiRequest<HostRes>(`${base(partyId)}/reveal`, { method: 'POST' }),
  unreveal: (partyId: string) => apiRequest<HostRes>(`${base(partyId)}/unreveal`, { method: 'POST' }),
};

export const PAYOUT_LABEL: Record<PayoutStatus, string> = {
  unpaid: 'Unpaid',
  pending: 'Pending',
  paid: 'Paid',
  not_applicable: 'Not applicable',
};

/** Mirrors backend awards.hasRecordedPayout: such an award can't be removed. */
export function hasRecordedPayout(a: Pick<HostAward, 'payoutStatus' | 'paidAt' | 'payoutReference'>): boolean {
  return a.payoutStatus === 'paid' || a.payoutStatus === 'pending' || !!a.paidAt || !!a.payoutReference;
}

/** "1st", "2nd", "3rd", "11th", "22nd"... */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
