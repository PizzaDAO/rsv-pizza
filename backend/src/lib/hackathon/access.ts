/**
 * Hackathon host authz (plans/hackathon-platform.md §6-7): the same rule as the other host apps:
 * canUserEditParty (owner, super admin, co-host with canEdit, GPP editors) AND canUserAccessTab
 * 'hackathon' (restricted co-hosts need the tab). Judges are a separate role (PR 4).
 */
import { AppError } from '../../middleware/error.js';
import { canUserEditParty, canUserAccessTab } from '../../helpers/partyAccess.js';
import { isUuid } from '../guestToken.js';

export const HACKATHON_TAB = 'hackathon';

/** True when the caller may manage this party's hackathon. Never throws. */
export async function isHackathonHost(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  if (!userId && !userEmail) return false;
  if (!(await canUserEditParty(partyId, userId, userEmail))) return false;
  return canUserAccessTab(partyId, userEmail, userId, HACKATHON_TAB);
}

/** Throws 404 (bad id) / 403 (not a host, or co-host without the hackathon tab). */
export async function requireHackathonHost(partyId: string, userId?: string, userEmail?: string): Promise<void> {
  if (!isUuid(partyId)) throw new AppError('Party not found', 404, 'NOT_FOUND');
  if (!(await canUserEditParty(partyId, userId, userEmail))) {
    throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
  }
  if (!(await canUserAccessTab(partyId, userEmail, userId, HACKATHON_TAB))) {
    throw new AppError('You do not have access to the hackathon tab', 403, 'TAB_ACCESS_DENIED');
  }
}
