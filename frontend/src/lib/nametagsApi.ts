import { apiRequest } from './api';
import type { NametagMember } from '../components/print/nametags/nametagData';

/** Whether PizzaDAO member tags are switched on for this event (guests-tab permission). */
export async function fetchNametagStatus(partyId: string): Promise<boolean> {
  const res = await apiRequest<{ available: boolean }>(`/api/parties/${encodeURIComponent(partyId)}/nametags/status`);
  return res.available === true;
}

export interface NametagMembersResult {
  memberLookup: 'ok' | 'unavailable' | 'disabled';
  /** guest id -> PizzaDAO member. Carries no emails or wallets. */
  members: Record<string, NametagMember>;
}

export function fetchNametagMembers(partyId: string): Promise<NametagMembersResult> {
  return apiRequest<NametagMembersResult>(`/api/parties/${encodeURIComponent(partyId)}/nametags`, { timeoutMs: 60_000 });
}
