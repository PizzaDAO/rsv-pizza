import { prisma } from '../config/database.js';
import { isSuperAdmin, isAdmin, isUnderboss } from '../middleware/auth.js';
import { getUnderbossScope, partyMatchesScope } from './underbossScope.js';

/**
 * Emails that automatically get editor access to ALL GPP events.
 * These users don't appear in the co_hosts array, so they're invisible
 * in host settings and on the public event page.
 */
export const GPP_GLOBAL_EDITORS = [
  'hunter@rarepizzas.com',
];

/**
 * Valid tab IDs that can appear in a co-host's allowedTabs array.
 * Used for validation when saving co-host permissions.
 */
export const VALID_TAB_IDS = [
  'dashboard',
  'party-guide',
  'details',
  'guests',
  'pizza',
  'photos',
  'partners',
  'venue',
  'music',
  'report',
  'staff',
  'displays',
  'raffle',
  'budget',
  'checklist',
  'gpp',
  'promo',
  'flyer',
  'payments',
  'print',
  'apps',
] as const;

export type TabId = typeof VALID_TAB_IDS[number];

/**
 * Check if a user can edit a party.
 * Returns true if the user is:
 *   1. A super admin
 *   2. The party owner
 *   3. A co-host with canEdit === true
 */
export async function canUserEditParty(
  partyId: string,
  userId?: string,
  userEmail?: string
): Promise<boolean> {
  // Super admin can edit any party
  if (await isSuperAdmin(userEmail)) {
    return true;
  }

  // Fetch the party
  const party = await prisma.party.findUnique({
    where: { id: partyId },
  });

  if (!party) {
    return false;
  }

  // Check if user is the owner
  if (party.userId === userId) {
    return true;
  }

  // Check if user is a GPP global editor
  if (userEmail && (party as any).eventType === 'gpp') {
    if (GPP_GLOBAL_EDITORS.some(e => e.toLowerCase() === userEmail.toLowerCase())) {
      return true;
    }
  }

  // For GPP events, admins, scoped underbosses, and graphics admins can edit.
  // Underbosses are scoped: their assigned regions OR cities (mozzarella-25815).
  // `isUnderboss(userEmail)` alone is NOT sufficient — they must match scope.
  if (userEmail && (party as any).eventType === 'gpp') {
    if (await isAdmin(userEmail)) return true;
    if (await isUnderboss(userEmail)) {
      const scope = await getUnderbossScope(userEmail);
      if (partyMatchesScope(party as any, scope)) return true;
    }
    const gfxAdmin = await prisma.graphicsAdmin.findUnique({
      where: { email: userEmail.toLowerCase() },
    });
    if (gfxAdmin) return true;
  }

  // Check if user is a co-host with edit permissions
  if (userEmail) {
    const coHosts = party.coHosts as Array<{ email?: string; canEdit?: boolean }> | null;
    if (coHosts) {
      const isEditor = coHosts.some(
        (h) => h.email?.toLowerCase() === userEmail.toLowerCase() && h.canEdit === true
      );
      if (isEditor) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a user can access a specific tab on a party.
 * Returns true if the user is:
 *   1. The party owner
 *   2. A super admin
 *   3. A co-host with allowedTabs === undefined (all tabs, legacy behavior)
 *   4. A co-host with allowedTabs array that includes the specified tabName
 * Returns false otherwise.
 *
 * Note: This should be called AFTER canUserEditParty has already confirmed
 * the user has edit access to the party.
 */
export async function canUserAccessTab(
  partyId: string,
  userEmail: string | undefined,
  userId: string | undefined,
  tabName: string
): Promise<boolean> {
  // Super admin can access all tabs
  if (await isSuperAdmin(userEmail)) {
    return true;
  }

  // Fetch the party to check ownership and co-host permissions
  // `region` + `name` are needed for the underboss city/region scope check below.
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { userId: true, coHosts: true, eventType: true, region: true, name: true },
  });

  if (!party) {
    return false;
  }

  // Party owner can access all tabs
  if (party.userId === userId) {
    return true;
  }

  // GPP global editors can access all tabs
  if (userEmail && party.eventType === 'gpp') {
    if (GPP_GLOBAL_EDITORS.some(e => e.toLowerCase() === userEmail.toLowerCase())) {
      return true;
    }
  }

  // For GPP events, admins, scoped underbosses, and graphics admins can access all tabs.
  // Underbosses are scoped: their assigned regions OR cities (mozzarella-25815).
  if (userEmail && party.eventType === 'gpp') {
    if (await isAdmin(userEmail)) return true;
    if (await isUnderboss(userEmail)) {
      const scope = await getUnderbossScope(userEmail);
      if (partyMatchesScope(party, scope)) return true;
    }
    const gfxAdmin = await prisma.graphicsAdmin.findUnique({
      where: { email: userEmail.toLowerCase() },
    });
    if (gfxAdmin) return true;
  }

  // Check co-host tab permissions
  if (userEmail) {
    const coHosts = party.coHosts as Array<{
      email?: string;
      canEdit?: boolean;
      allowedTabs?: string[];
    }> | null;

    if (coHosts) {
      const coHost = coHosts.find(
        (h) => h.email?.toLowerCase() === userEmail.toLowerCase() && h.canEdit === true
      );

      if (coHost) {
        // No allowedTabs field = legacy behavior, all tabs allowed
        if (!Array.isArray(coHost.allowedTabs)) {
          return true;
        }
        // Check if the specific tab is in the allowed list
        // Accept both 'sponsors' and 'partners' for backwards compatibility
        if (tabName === 'partners' || tabName === 'sponsors') {
          return coHost.allowedTabs.includes('partners') || coHost.allowedTabs.includes('sponsors');
        }
        return coHost.allowedTabs.includes(tabName);
      }
    }
  }

  return false;
}

export { isSuperAdmin };
