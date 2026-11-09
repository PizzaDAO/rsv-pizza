/** Who may make a sizzle reel (pure; callers resolve the booleans). */

export interface ReelPermissionInput {
  /** Host, owner, co-host with edit rights, GPP editor, or admin (canUserEditParty). */
  canEdit: boolean;
  /** Admin / super admin: may make a reel before the event date. */
  isAdmin: boolean;
  partyDate: Date | null;
  cancelledAt: Date | null;
  now: Date;
}

export type ReelPermission = { ok: true } | { ok: false; code: string; message: string };

export function checkReelPermission(i: ReelPermissionInput): ReelPermission {
  if (!i.canEdit && !i.isAdmin) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only the host, co-hosts or admins can make a reel' };
  }
  if (i.cancelledAt && !i.isAdmin) {
    return { ok: false, code: 'CANCELLED', message: 'This event was cancelled' };
  }
  if (!i.isAdmin) {
    if (!i.partyDate) {
      return { ok: false, code: 'EVENT_NOT_HAPPENED', message: 'Set the event date first' };
    }
    if (i.partyDate.getTime() > i.now.getTime()) {
      return { ok: false, code: 'EVENT_NOT_HAPPENED', message: 'Reels can be made once the event has started' };
    }
  }
  return { ok: true };
}
