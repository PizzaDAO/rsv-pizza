import { prisma } from '../config/database.js';
import { isSuperAdmin } from '../middleware/auth.js';

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

export { isSuperAdmin };
