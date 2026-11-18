export const NEXT_STEPS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const key = (partyId: string) => `nextStepsDismissed:${partyId}`;

/** First-run "Next steps" card: a party created within 7 days that has no guests yet. */
export function shouldShowNextSteps(
  party: { createdAt?: string | null },
  guestCount: number,
  now = Date.now(),
): boolean {
  if (guestCount > 0 || !party.createdAt) return false;
  const created = new Date(party.createdAt).getTime();
  return Number.isFinite(created) && now - created < NEXT_STEPS_MAX_AGE_MS;
}

export function isNextStepsDismissed(partyId: string): boolean {
  try { return localStorage.getItem(key(partyId)) === '1'; } catch { return false; }
}

export function dismissNextSteps(partyId: string): void {
  try { localStorage.setItem(key(partyId), '1'); } catch { /* ignore */ }
}
