// Host trust: admin report + settings (backend/src/routes/host-trust.routes.ts). Read-only report.
import { apiRequest } from './api';

export type TrustTier = 'restricted' | 'new' | 'building' | 'trusted';

export interface TrustReason {
  signal: string;
  points: number;
  detail: string;
}

export interface TrustGate {
  id: string;
  met: boolean;
  have: number | null;
  need: number | null;
}

export interface HostPartyRow {
  partyId: string;
  name: string;
  date: string | null;
  completed: boolean;
  rsvps: number;
  checkIns: number;
  reportedAttendance: number | null;
  photos: number;
  payoutPhotos: number;
  receiptsOnTime: boolean;
  payoutStatuses: string[];
  fakeRisk: string;
}

export interface HostTrustItem {
  userId: string;
  name: string | null;
  email: string;
  tier: TrustTier;
  score: number;
  reasons: TrustReason[];
  gates: TrustGate[];
  blockers: string[];
  verifiedParties: number;
  verifiedPartiesRaw: number;
  completedParties: number;
  accountAgeDays: number;
  medianTurnout: number | null;
  turnoutParties: number;
  pizzadao: 'not_checked' | 'unavailable' | 'ok' | 'ambiguous';
  todayTier: 'fast_pass' | 'building' | 'new' | 'flagged';
  disagrees: boolean;
  /** Fake-event risk not scored in the list; open the row to check. */
  provisional?: boolean;
  parties?: HostPartyRow[];
}

export interface HostTrustPage {
  generatedAt: string;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  hosts: HostTrustItem[];
}

export interface HostTrustSetting {
  key: string;
  area: string;
  label: string;
  help: string;
  min: number;
  max: number;
  default: number;
  unit: string | null;
  stricterOnly: boolean;
  looserWhen: 'higher' | 'lower' | null;
  value: number;
  source: 'stored' | 'default' | 'failure';
}

export interface HostTrustAuditRow {
  key: string;
  oldValue: number;
  newValue: number;
  actorEmail: string;
  note: string | null;
  createdAt: string;
}

export function fetchHostTrustEnabled(): Promise<{ enabled: boolean }> {
  return apiRequest('/api/admin/host-trust/enabled');
}

export function fetchHostTrust(params: { q?: string; tier?: string; offset?: number; limit?: number }): Promise<HostTrustPage> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.tier) qs.set('tier', params.tier);
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.limit) qs.set('limit', String(params.limit));
  const s = qs.toString();
  return apiRequest(`/api/admin/host-trust${s ? `?${s}` : ''}`, { timeoutMs: 120_000 });
}

export async function fetchHostTrustDetail(userId: string): Promise<HostTrustItem> {
  const res = await apiRequest<{ host: HostTrustItem }>(`/api/admin/host-trust/${encodeURIComponent(userId)}`, { timeoutMs: 120_000 });
  return res.host;
}

export function fetchHostTrustSettings(): Promise<{ readFailed: boolean; settings: HostTrustSetting[]; audit: HostTrustAuditRow[] }> {
  return apiRequest('/api/admin/host-trust/settings');
}

export function saveHostTrustSetting(key: string, value: number, note?: string): Promise<{ ok: boolean; value: number }> {
  return apiRequest('/api/admin/host-trust/settings', { method: 'PUT', body: { key, value, note } });
}
