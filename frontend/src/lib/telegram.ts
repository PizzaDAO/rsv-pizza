import { apiRequest } from './api';

export interface TelegramGroup {
  /** DB row id (cuid). Used for CRUD; distinct from the Telegram chatId. */
  id: string;
  country: string;
  city: string;
  underboss: string;
  region: string;
  chatUrl: string;
  /** Telegram chat_id (numeric string). Historically named groupId. */
  groupId: string;
  /** Linked GPP party id, or null when the group isn't linked to an event. */
  partyId: string | null;
  /** True when the group is FK-linked to a party (drives {link}/{appLink}). */
  partyLinked: boolean;
}

interface GroupsResponse {
  groups: Array<{
    id: string;
    chatId: string;
    chatUrl: string;
    city: string;
    country: string;
    region: string;
    underboss: string;
    partyId: string | null;
    partyLinked: boolean;
  }>;
}

/**
 * calzone-58481: city Telegram groups now come from the DB (UB-scoped), not the
 * Google Sheet. The backend returns the same fields the broadcast UI used, plus
 * `partyId`/`partyLinked` for per-recipient {link}/{appLink} resolution.
 */
export async function fetchTelegramGroups(): Promise<TelegramGroup[]> {
  const res = await apiRequest<GroupsResponse>('/api/underboss/telegram/groups');
  return res.groups.map((g) => ({
    id: g.id,
    country: g.country,
    city: g.city,
    underboss: g.underboss,
    region: g.region,
    chatUrl: g.chatUrl,
    groupId: g.chatId,
    partyId: g.partyId,
    partyLinked: g.partyLinked,
  }));
}

// ===== CRUD (admin/UB-scoped) for the /underboss "Telegram Groups" tab =====

export interface TelegramGroupInput {
  chatId: string;
  chatUrl?: string;
  city: string;
  country: string;
  region?: string;
  underboss?: string;
  partyId?: string | null;
}

export async function createTelegramGroup(input: TelegramGroupInput): Promise<TelegramGroup> {
  const res = await apiRequest<{ group: GroupsResponse['groups'][number] }>(
    '/api/underboss/telegram/groups',
    { method: 'POST', body: input }
  );
  const g = res.group;
  return {
    id: g.id, country: g.country, city: g.city, underboss: g.underboss,
    region: g.region, chatUrl: g.chatUrl, groupId: g.chatId,
    partyId: g.partyId, partyLinked: g.partyLinked,
  };
}

export async function updateTelegramGroup(
  id: string,
  input: Partial<TelegramGroupInput>
): Promise<TelegramGroup> {
  const res = await apiRequest<{ group: GroupsResponse['groups'][number] }>(
    `/api/underboss/telegram/groups/${id}`,
    { method: 'PATCH', body: input }
  );
  const g = res.group;
  return {
    id: g.id, country: g.country, city: g.city, underboss: g.underboss,
    region: g.region, chatUrl: g.chatUrl, groupId: g.chatId,
    partyId: g.partyId, partyLinked: g.partyLinked,
  };
}

export async function deleteTelegramGroup(id: string): Promise<void> {
  await apiRequest(`/api/underboss/telegram/groups/${id}`, { method: 'DELETE' });
}
