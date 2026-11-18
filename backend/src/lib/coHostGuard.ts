/**
 * Co-host escalation guard (PATCH /api/parties/:id).
 *
 * A co-host may edit the event but must not be able to rewrite the co-host list: that would let a
 * tab-restricted co-host drop their own `allowedTabs`, grant themselves/others `canEdit`, or
 * remove other co-hosts. Only the owner or an admin may change it.
 *
 * To keep ordinary co-host saves working (the edit form re-sends the list it loaded), a payload
 * whose security-relevant projection is unchanged is silently ignored; any real difference is
 * rejected by the caller with 403.
 */
export function coHostSecurityProjection(list: unknown): string {
  const entries = Array.isArray(list) ? list : [];
  const rows = entries.map((h: any) => ({
    id: h?.id ?? null,
    email: typeof h?.email === 'string' ? h.email.trim().toLowerCase() : null,
    canEdit: h?.canEdit === true,
    // null = unrestricted; [] = restricted to nothing. Order is irrelevant.
    allowedTabs: Array.isArray(h?.allowedTabs) ? [...h.allowedTabs].map(String).sort() : null,
    isUnderboss: h?.isUnderboss === true,
    isPartner: h?.isPartner === true,
  }));
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(rows);
}

export function coHostListChanged(existing: unknown, incoming: unknown): boolean {
  return coHostSecurityProjection(existing) !== coHostSecurityProjection(incoming);
}

/**
 * reimbursementCapUsd: an in-scope underboss may set it, unless they own the event or are a
 * (non-system) co-host of it. `inScope` is partyMatchesScope(party, underbossScope).
 */
export function underbossMayWriteCap(
  party: { userId?: string | null; coHosts?: unknown },
  caller: { userId?: string; email?: string },
  inScope: boolean,
): boolean {
  if (!inScope) return false;
  if (caller.userId && party.userId === caller.userId) return false;
  const email = caller.email?.trim().toLowerCase();
  if (email && Array.isArray(party.coHosts)) {
    const isCoHost = (party.coHosts as any[]).some(
      (h) => h?.isUnderboss !== true && typeof h?.email === 'string' && h.email.trim().toLowerCase() === email,
    );
    if (isCoHost) return false;
  }
  return true;
}
