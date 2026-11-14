// Hackathon platform (plans/hackathon-platform.md): host setup + public read.
// Backend: backend/src/routes/hackathon.routes.ts, hackathon-public.routes.ts.
import { apiRequest } from './api';

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

/** "$5,000", "2,500 USDC", or a formatted value + currency. */
export function prizeAmount(p: Pick<HackathonPrize, 'amountText' | 'amountValue' | 'currency'>): string | null {
  if (p.amountText) return p.amountText;
  if (p.amountValue != null) return `${p.amountValue.toLocaleString()}${p.currency ? ` ${p.currency}` : ''}`;
  return null;
}
