/**
 * Co-host escalation guard (PATCH /api/parties/:id).
 *
 * Owners, admins and in-scope underbosses may change the co-host list freely. Every other editor
 * (a co-host) may still save it (HostsManager / FlyerGenerator edit cosmetic fields, partner and
 * non-editor entries), but must not ESCALATE permissions: change canEdit / allowedTabs of an
 * existing entry, add an entry that can edit or carries allowedTabs, remove an entry that can
 * edit, or change the id/email of an editor entry (which reads as remove + add).
 */
function tabsKey(h: any): string | null {
  return Array.isArray(h?.allowedTabs) ? JSON.stringify([...h.allowedTabs].map(String).sort()) : null;
}

function keyOf(h: any): string {
  return h?.id != null ? `id:${h.id}` : `email:${String(h?.email ?? '').trim().toLowerCase()}`;
}

export function coHostEscalation(existing: unknown, incoming: unknown): boolean {
  const oldList: any[] = Array.isArray(existing) ? existing : [];
  const newList: any[] = Array.isArray(incoming) ? incoming : [];
  const oldBy = new Map(oldList.map((h) => [keyOf(h), h]));
  const newBy = new Map(newList.map((h) => [keyOf(h), h]));

  for (const [k, i] of newBy) {
    const e = oldBy.get(k);
    if (!e) {
      if (i?.canEdit === true || Array.isArray(i?.allowedTabs)) return true;
      continue;
    }
    if ((e.canEdit === true) !== (i?.canEdit === true)) return true;
    if (tabsKey(e) !== tabsKey(i)) return true;
    if (e.canEdit === true) {
      const em = (x: any) => String(x?.email ?? '').trim().toLowerCase();
      if (em(e) !== em(i)) return true;
    }
  }
  for (const [k, e] of oldBy) {
    if (!newBy.has(k) && e?.canEdit === true) return true;
  }
  return false;
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
